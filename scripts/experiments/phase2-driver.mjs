/**
 * Phase 2 driver: runs each condition in its own process (clean NTOX_DIR module state),
 * then aggregates pass rates and writes the results report.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "C:/Users/anton/Desktop/Ntox";
const PHASE2 = join(homedir(), "AppData/Local/Temp/opencode/phase2");
const OUT_DIR = join(REPO, "scripts/experiments");
const RUNS = process.env.PHASE2_RUNS ?? "1";

const CONDS = ["fresh", "current", "titan-dropin", "titan-pure"];
const KNOW = (id) => id.startsWith("know-");

mkdirSync(join(PHASE2, "reports"), { recursive: true });
// stale reports from a previous (contaminated) run must never be aggregated
for (const cond of CONDS) {
  const stale = join(PHASE2, "reports", `${cond}.json`);
  if (existsSync(stale)) rmSync(stale);
}

for (const cond of CONDS) {
  const out = join(PHASE2, "reports", `${cond}.json`);
  console.log(`\n================ CONDITION: ${cond} ================`);
  const res = spawnSync("npx", ["tsx", "scripts/experiments/phase2-run.ts"], {
    cwd: REPO,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PHASE2_CONDITION: cond,
      PHASE2_STATE: join(PHASE2, `state-${cond}`),
      PHASE2_OUT: out,
      PHASE2_RUNS: RUNS,
      NTOX_ARENA_SHELL: "disabled",
    },
  });
  if (res.status !== 0) console.error(`condition ${cond} exited with ${res.status}`);
}

// ---------- aggregate ----------
const reports = {};
for (const cond of CONDS) {
  const p = join(PHASE2, "reports", `${cond}.json`);
  reports[cond] = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function summarize(cond) {
  const r = reports[cond];
  if (!r) return { cond, missing: true };
  const trials = r.trials;
  const know = trials.filter((t) => KNOW(t.taskId));
  const ctrl = trials.filter((t) => !KNOW(t.taskId));
  const pass = (list) => list.filter((t) => t.passed).length;
  return {
    cond,
    total: trials.length,
    overall: `${pass(trials)}/${trials.length}`,
    knowledge: `${pass(know)}/${know.length}`,
    control: `${pass(ctrl)}/${ctrl.length}`,
    meanTokens: Math.round(trials.reduce((s, t) => s + (t.tokens || 0), 0) / trials.length),
    costUsd: Number(trials.reduce((s, t) => s + (t.costUsd || 0), 0).toFixed(4)),
    meanMs: Math.round(trials.reduce((s, t) => s + (t.durationMs || 0), 0) / trials.length),
  };
}

// per knowledge task × condition matrix, with the value actually written (from check detail)
const knowTaskIds = reports.current
  ? reports.current.trials.filter((t) => KNOW(t.taskId)).map((t) => t.taskId)
  : [];
const matrix = knowTaskIds.map((taskId) => {
  const row = { taskId, cells: {} };
  for (const cond of CONDS) {
    const r = reports[cond];
    const t = r?.trials.find((x) => x.taskId === taskId);
    if (!t) { row.cells[cond] = "n/a"; continue; }
    const detail = (t.checks || []).map((c) => c.detail).filter(Boolean).join(" | ");
    row.cells[cond] = t.passed ? "PASS" : `FAIL${detail ? ` (${detail.slice(0, 140)})` : ""}`;
  }
  return row;
});

const summaries = CONDS.map(summarize);

// paired diffs (knowledge tasks): treatment - baseline in pass count
function paired(a, b) {
  if (!reports[a] || !reports[b]) return null;
  let win = 0, loss = 0, same = 0;
  for (const taskId of knowTaskIds) {
    const pa = reports[a].trials.find((t) => t.taskId === taskId)?.passed ? 1 : 0;
    const pb = reports[b].trials.find((t) => t.taskId === taskId)?.passed ? 1 : 0;
    if (pa > pb) win++; else if (pa < pb) loss++; else same++;
  }
  return { a, b, aBetter: win, bBetter: loss, same };
}
const pairs = [
  paired("titan-pure", "current"),
  paired("titan-pure", "fresh"),
  paired("current", "fresh"),
  paired("titan-dropin", "titan-pure"),
];

console.log("\n================ PHASE 2 SUMMARY ================");
console.table(summaries);
console.log("knowledge task matrix:");
for (const row of matrix) console.log(` ${row.taskId}: ${JSON.stringify(row.cells)}`);
console.log("paired (knowledge):", JSON.stringify(pairs));

// ---------- report ----------
let md = `# Phase 2 — Does better recall improve task success?\n\nRun: ${new Date().toISOString()} · runs per task: ${RUNS} · model: mimo-v2.6-flash (live) · verification: frozen command checks, fresh temp workspace\n\nConditions:\n- **fresh** — memory off (agent knows nothing past the prompt)\n- **current** — NTOX today: 3-small + hybrid scoring, episodes as stored (mixed vector dims)\n- **titan-dropin** — proposal wired literally: Titan vectors + unchanged 0.6cos/0.4BM25 hybrid\n- **titan-pure** — Titan vectors + pure-cosine ranking (the Phase-1-recommended configuration)\n\nTasks: 6 knowledge tasks whose required values exist ONLY in seeded memory episodes (worded differently from the task; 6 same-topic distractor episodes present) + 4 frozen pilot controls (self-contained; detect degradation).\n\n## Headline\n\n| condition | overall | knowledge (of 6) | controls (of 4) | mean tokens/trial | cost | mean duration |\n|---|---|---|---|---|---|---|\n`;
for (const s of summaries) {
  if (s.missing) { md += `| ${s.cond} | MISSING | — | — | — | — | — |\n`; continue; }
  md += `| ${s.cond} | ${s.overall} | **${s.knowledge}** | ${s.control} | ${s.meanTokens} | $${s.costUsd} | ${(s.meanMs / 1000).toFixed(1)}s |\n`;
}
md += `\n## Knowledge-task outcome matrix (what the check actually found written)\n\n| task | ${CONDS.join(" | ")} |\n|---|---|\n`;
for (const row of matrix) md += `| ${row.taskId} | ${CONDS.map((c) => String(row.cells[c]).replace(/\|/g, "/")).join(" | ")} |\n`;
md += `\n## Paired comparisons (knowledge tasks, per-task win/loss)\n\n`;
for (const p of pairs) if (p) md += `- **${p.a}** vs **${p.b}**: ${p.a} better on ${p.aBetter}, ${p.b} better on ${p.bBetter}, tied on ${p.same}\n`;
md += `\n## Caveats\n\n- Constructed memory seeds (disclosed): the six required values were seeded as realistic past-interaction episodes; all agent executions, LLM decisions, and pass/fail outcomes are real.\n- Sample size is small (${knowTaskIds.length} knowledge tasks × ${RUNS} run(s)); paired win/loss counts are more informative than any single pass rate, and no significance claim is made from n alone.\n- Controls are self-contained by design: high control pass rates are expected and only demonstrate that memory injection does not degrade ordinary work.\n`;
const outMd = join(OUT_DIR, "results-phase2-2026-10-26.md");
writeFileSync(outMd, md);
console.log(`\nreport -> ${outMd}`);
