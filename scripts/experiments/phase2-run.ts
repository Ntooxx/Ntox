/**
 * Phase 2 runner — ONE condition per process (NTOX_DIR must be set before any NTOX
 * module loads, hence every repo import below is dynamic).
 * Env: PHASE2_CONDITION, PHASE2_STATE, PHASE2_OUT, PHASE2_RUNS
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const cond = process.env.PHASE2_CONDITION;
const stateDir = process.env.PHASE2_STATE;
const outPath = process.env.PHASE2_OUT;
if (!cond || !stateDir || !outPath) {
  console.error("missing PHASE2_CONDITION / PHASE2_STATE / PHASE2_OUT");
  process.exit(1);
}

// isolation FIRST — paths.ts freezes NTOX_DIR at module load
process.env.NTOX_DIR = stateDir;
if (cond === "titan-pure") process.env.NTOX_MEMORY_SCORING = "cosine";
process.env.NTOX_EMBED_BUDGET_MS = "8000";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "phase2-suite.json"), "utf8"));

const { runArena } = await import("../../src/arena/runner.js");
const { NtoxAdapter } = await import("../../src/arena/adapters/ntox.js");

const adapter = new NtoxAdapter({});
adapter.id = cond;
adapter.label = cond;
console.log(`[${cond}] detail:`, JSON.stringify(adapter.detail));

const unavailable = await adapter.available();
if (unavailable) {
  console.error(`[${cond}] unavailable: ${unavailable}`);
  process.exit(2);
}

const report = await runArena({
  suite,
  agents: [adapter],
  runs: Number(process.env.PHASE2_RUNS ?? "1"),
  ...(process.env.PHASE2_TASKS ? { taskIds: process.env.PHASE2_TASKS.split(",") } : {}),
  timeoutMs: 120000,
  // Windows EPERM on rmdir (lingering handles) killed an arm once — keep workspaces unless explicitly told not to
  keepWorkspaces: process.env.PHASE2_KEEP_WS !== "0",
  onProgress: (m) => console.log(`[${cond}] ${m}`),
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`[${cond}] report -> ${outPath}`);
