/**
 * Phase 3 harness — PREFLIGHT. Refuses execution (exit 1) unless all four reviewer
 * blockers are provably closed:
 *   P1 the signer is not accessible to the agent,
 *   P2 evidence is version-bound,
 *   P3 candidates can never count as verified reuse,
 *   P4 frozen fixtures and checks are present and valid.
 * Runnable standalone: `tsx scripts/experiments/phase3/preflight.ts`.
 * This is a harness gate, not experiment execution — it never runs a task trial.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool, WorkspaceProfile } from "../../../src/types/index.js";
import { createPolicyRuntime, enforceToolPolicy } from "../../../src/core/policy.js";
import { PROCEDURES_DIR } from "../../../src/core/config.js";
import {
  ProcedureStore,
  currentVersionOf,
  hashProcedureVersion,
  harnessKeypairPaths,
  type EvidenceContent,
  type StoredProcedure,
  type VerificationEvidence,
} from "../../../src/memory/procedure-store.js";
import { signEvidence } from "../../../src/memory/procedure-harness.js";
import {
  classifyReuse,
  loadSuite,
  suiteSha256,
  canPromote,
  derivePolicyBypasses,
  policyGate,
  pairedCB,
  snapshotMemoryState,
  restoreMemoryState,
  memoryStateHash,
  type Phase3Suite,
  type Phase3Task,
} from "./lib.js";

export interface PreflightCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export interface PreflightReport {
  generatedAt: string;
  suitePath: string;
  suiteSha256: string;
  checks: PreflightCheck[];
  passed: boolean;
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function check(id: string, title: string, passed: boolean, detail: string): PreflightCheck {
  return { id, title, passed, detail };
}

/* ---------------- P1: signer is not accessible to the agent ---------------- */

function preflightSignerIsolation(): PreflightCheck {
  const srcRoot = join(REPO_ROOT, "src");
  const offenders: string[] = [];
  const SIGNING = /\b(signEvidence|ensureHarnessKeypair|createPrivateKey|generateKeyPairSync)\b|\bprivateKey\b/;
  const IMPORTS_HARNESS = /from\s+["'][^"']*procedure-harness(\.js)?["']/;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      if (entry.name === "procedure-harness.ts") continue;
      const source = readFileSync(full, "utf-8");
      const hit = source.match(SIGNING) ?? source.match(IMPORTS_HARNESS);
      if (hit) offenders.push(`${relative(srcRoot, full)} → ${hit[0]}`);
    }
  };
  walk(srcRoot);

  const policyProbe = ((): boolean => {
    const profile: WorkspaceProfile = {
      id: "preflight",
      name: "Preflight",
      workspaceRoot: PROCEDURES_DIR,
      readRoots: [PROCEDURES_DIR],
      writeRoots: [PROCEDURES_DIR],
      allowedTools: ["read", "write", "shell", "ls", "grep", "image"],
      shellPolicy: "workspace",
      networkPolicy: "fetch-only",
      autoCheckpoint: false,
      memoryAccess: "full",
    };
    const tool = (name: string): Tool => ({
      name,
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    });
    let denied = true;
    for (const attempt of [
      { name: "read", args: { path: harnessKeypairPaths().privateKeyPath } },
      { name: "read", args: { path: join(PROCEDURES_DIR, "procedures.json") } },
      { name: "write", args: { path: join(PROCEDURES_DIR, "procedures.json"), content: "[]" } },
    ]) {
      const runtime = createPolicyRuntime(profile);
      void enforceToolPolicy(tool(attempt.name), runtime).execute(attempt.args);
      if (runtime.decisions.at(-1)?.allowed !== false) denied = false;
    }
    return denied;
  })();

  const passed = offenders.length === 0 && policyProbe;
  return check(
    "P1-signer-isolation",
    "Signer not accessible to the agent",
    passed,
    passed
      ? `no agent-surface module references signing; policy denies ${PROCEDURES_DIR} (read/write) with no grant that opens it`
      : `signer leak or policy gap: ${offenders.join("; ") || "policy probe failed"}`,
  );
}

/* ---------------- P2: evidence is version-bound ---------------- */

function preflightVersionBinding(): PreflightCheck {
  const dir = mkdtempSync(join(tmpdir(), "ntox-preflight-"));
  try {
    const store = new ProcedureStore({ path: join(dir, "procedures.json"), keyDir: dir });
    const proc = store.addProcedure({
      name: "preflight-probe",
      description: "probe",
      steps: [{ id: "s1", description: "step" }],
      prerequisites: [],
      scope: { applies: [], doesNotApply: [] },
    });
    const content = (p: StoredProcedure): EvidenceContent => {
      const version = currentVersionOf(p);
      return {
        procedureId: p.id,
        procedureVersion: p.currentVersion,
        procedureHash: hashProcedureVersion(version),
        taskId: "preflight",
        envFingerprint: "env-preflight",
        checkOutputs: [{ target: "workspace", type: "command", passed: true, detail: "exit 0" }],
        timestamps: [Date.now()],
      };
    };
    const sign = (c: EvidenceContent): VerificationEvidence => ({ ...c, harnessSignature: signEvidence(c, dir) });

    const fresh = sign(content(store.get(proc.id)!));
    const stale = sign(content(store.get(proc.id)!));
    store.updateProcedure(proc.id, { scope: { applies: ["x"], doesNotApply: [] } }, "revision");
    const staleRejection = store.promoteWithEvidence(proc.id, stale);
    const transplantRejection = store.promoteWithEvidence(
      store.addProcedure({
        name: "other",
        description: "other",
        steps: [],
        prerequisites: [],
        scope: { applies: [], doesNotApply: [] },
      }).id,
      fresh,
    );
    const drift: VerificationEvidence = { ...sign(content(store.get(proc.id)!)), procedureHash: "sha256:deadbeef" };
    const driftRejection = store.promoteWithEvidence(proc.id, drift);
    const positive = store.promoteWithEvidence(proc.id, sign(content(store.get(proc.id)!)));

    const passed =
      !staleRejection.ok &&
      staleRejection.reason.includes("not bound to current version") &&
      !transplantRejection.ok &&
      transplantRejection.reason.includes("bound to procedure") &&
      !driftRejection.ok &&
      driftRejection.reason.includes("hash mismatch") &&
      positive.ok;
    return check(
      "P2-version-binding",
      "Evidence is version-bound",
      passed,
      passed
        ? "stale-version, cross-procedure, and content-drift evidence all rejected; bound evidence promotes"
        : `stale="${staleRejection.reason}" transplant="${transplantRejection.reason}" drift="${driftRejection.reason}" positive=${positive.ok}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------- P3: candidates cannot count as verified reuse ---------------- */

function preflightReuseAccounting(): PreflightCheck {
  const cases: { input: Parameters<typeof classifyReuse>[0]; expected: string }[] = [
    {
      input: { taskClass: "transfer", procedureState: "candidate", checksPassed: true, literalViolations: [] },
      expected: "candidate-reuse",
    },
    {
      input: { taskClass: "transfer", procedureState: "verified", checksPassed: true, literalViolations: [] },
      expected: "verified-reuse",
    },
    {
      input: { taskClass: "transfer", procedureState: "candidate", checksPassed: true, literalViolations: ["x"] },
      expected: "incorrect-reuse",
    },
    {
      input: { taskClass: "decoy", procedureState: "verified", checksPassed: false, literalViolations: [] },
      expected: "incorrect-reuse",
    },
    {
      input: { taskClass: "decoy", procedureState: "verified", checksPassed: true, literalViolations: [] },
      expected: "no-reuse",
    },
    {
      input: { taskClass: "transfer", procedureState: null, checksPassed: true, literalViolations: [] },
      expected: "no-reuse",
    },
  ];
  const failures = cases.filter((c) => classifyReuse(c.input) !== c.expected);
  const passed = failures.length === 0;
  return check(
    "P3-reuse-accounting",
    "Candidates can never count as verified reuse",
    passed,
    passed
      ? `${cases.length} accounting cases hold (candidate→candidate-reuse, decoy never verified-reuse, replay→incorrect-reuse)`
      : failures.map((f) => `expected ${f.expected}, got ${classifyReuse(f.input)}`).join("; "),
  );
}

/* ---------------- P5: promotion requires recorded procedural execution ----------------
 * Solving the verification task is NOT evidence of reuse (reviewer blocker 1). */

function preflightPromotionGate(): PreflightCheck {
  const good = {
    applicabilityPassed: true,
    steps: [{ stepId: "s1", executed: true, ok: true, detail: "ok" }],
    checksPassed: true,
    literalViolations: [],
  };
  const cases: { label: string; input: Parameters<typeof canPromote>[0]; expectOk: boolean }[] = [
    { label: "all three conditions", input: good, expectOk: true },
    { label: "applicability missing", input: { ...good, applicabilityPassed: false }, expectOk: false },
    { label: "no step execution", input: { ...good, steps: [] }, expectOk: false },
    {
      label: "descriptive step not executed",
      input: {
        ...good,
        steps: [{ stepId: "s1", executed: false, ok: true, detail: "descriptive step — adapt manually, not executed" }],
      },
      expectOk: false,
    },
    {
      label: "step failed",
      input: { ...good, steps: [{ stepId: "s1", executed: true, ok: false, detail: "POLICY_DENIED" }] },
      expectOk: false,
    },
    { label: "checks failed", input: { ...good, checksPassed: false }, expectOk: false },
    { label: "replay literals", input: { ...good, literalViolations: ["out.txt:SEED-E1"] }, expectOk: false },
  ];
  const failures = cases.filter((c) => canPromote(c.input).ok !== c.expectOk);
  const passed = failures.length === 0;
  return check(
    "P5-promotion-gate",
    "Promotion requires recorded procedural execution",
    passed,
    passed
      ? `${cases.length} gate cases hold: applicability + executed steps + clean checks are ALL required — solving the task alone never promotes`
      : failures.map((f) => `${f.label}: expected ok=${f.expectOk}, got ${canPromote(f.input).ok}`).join("; "),
  );
}

/* ---------------- P6: policy-bypass metric is derived and fail-closed ----------------
 * The gate must derive from real execution events; missing evidence must FAIL it
 * (reviewer blocker 2). */

function preflightPolicyAccounting(): PreflightCheck {
  const cases: {
    label: string;
    input: Parameters<typeof derivePolicyBypasses>[0];
    bypasses: number;
    missing: number;
    gate: boolean;
  }[] = [
    {
      label: "clean evidence",
      input: [
        {
          toolCalls: 2,
          policyDecisions: [{ allowed: true }],
          callLedger: [{ tool: "write", success: true, decisions: [{ allowed: true }] }],
        },
      ],
      bypasses: 0,
      missing: 0,
      gate: true,
    },
    {
      label: "tool activity without policy evidence (must FAIL the gate)",
      input: [{ toolCalls: 3, policyDecisions: [], callLedger: [] }],
      bypasses: 0,
      missing: 1,
      gate: false,
    },
    {
      label: "call executed with zero allowed decisions (bypass)",
      input: [
        {
          toolCalls: 1,
          policyDecisions: [{ allowed: false }],
          callLedger: [{ tool: "shell", success: true, decisions: [{ allowed: false }] }],
        },
      ],
      bypasses: 1,
      missing: 0,
      gate: false,
    },
    {
      label: "call executed with no recorded decisions (missing evidence, fails gate)",
      input: [{ toolCalls: 0, policyDecisions: [], callLedger: [{ tool: "shell", success: true, decisions: [] }] }],
      bypasses: 0,
      missing: 1,
      gate: false,
    },
    {
      label: "denied call that failed is not a bypass",
      input: [
        {
          toolCalls: 1,
          policyDecisions: [{ allowed: false }],
          callLedger: [{ tool: "shell", success: false, decisions: [{ allowed: false }] }],
        },
      ],
      bypasses: 0,
      missing: 0,
      gate: true,
    },
  ];
  const failures = cases.filter((c) => {
    const derived = derivePolicyBypasses(c.input);
    return derived.bypasses !== c.bypasses || derived.missingEvidence !== c.missing || policyGate(derived) !== c.gate;
  });
  const passed = failures.length === 0;
  return check(
    "P6-policy-accounting",
    "Policy-bypass metric is derived and fail-closed",
    passed,
    passed
      ? `${cases.length} accounting cases hold — the metric counts real events; missing policy evidence fails the gate instead of counting as safe`
      : failures.map((f) => `${f.label}: got ${JSON.stringify(derivePolicyBypasses(f.input))}`).join("; "),
  );
}

/* ---------------- P7: arms comparable — paired C–B + episodic-state control ---- */

function preflightArmComparability(): PreflightCheck {
  const outcomes = [
    ...["t1", "t2", "t3", "t4"].map((key) => ({ key, taskClass: "transfer" as const, arm: "C", passed: key !== "t4" })),
    ...["t1", "t2", "t3", "t4"].map((key) => ({ key, taskClass: "transfer" as const, arm: "B", passed: key === "t4" })),
    // Non-transfer rows must not leak into the paired transfer scoring.
    { key: "s1", taskClass: "solve" as const, arm: "C", passed: true },
    { key: "s1", taskClass: "solve" as const, arm: "B", passed: true },
  ];
  const pairedResult = pairedCB(outcomes);
  const pairedOk =
    pairedResult.wins === 3 && pairedResult.losses === 1 && pairedResult.net === 2 && pairedResult.pairs.length === 4;

  const dir = mkdtempSync(join(tmpdir(), "ntox-preflight-mem-"));
  try {
    const stateDir = dir;
    mkdirSync(join(stateDir, "memory"), { recursive: true });
    mkdirSync(join(stateDir, "procedures"), { recursive: true });
    writeFileSync(join(stateDir, "memory", "episodes.jsonl"), '{"episode":"keep"}\n');
    writeFileSync(join(stateDir, "procedures", "procedures.json"), "[]");
    const snapshot = snapshotMemoryState(stateDir);
    const before = memoryStateHash(snapshot);
    // Simulate a C-only phase polluting memory and the procedure store evolving.
    writeFileSync(join(stateDir, "memory", "episodes.jsonl"), '{"episode":"keep"}\n{"episode":"C-only leak"}\n');
    writeFileSync(join(stateDir, "memory", "extra.json"), "{}");
    writeFileSync(join(stateDir, "procedures", "procedures.json"), '[{"id":"proc_x"}]');
    restoreMemoryState(stateDir, snapshot);
    const after = memoryStateHash(snapshotMemoryState(stateDir));
    const memoryOk =
      before === after &&
      readFileSync(join(stateDir, "memory", "episodes.jsonl"), "utf-8") === '{"episode":"keep"}\n' &&
      !existsSync(join(stateDir, "memory", "extra.json")) &&
      // procedures (harness state) must NOT be touched by the episodic restore
      readFileSync(join(stateDir, "procedures", "procedures.json"), "utf-8") === '[{"id":"proc_x"}]';

    const passed = pairedOk && memoryOk;
    return check(
      "P7-arm-comparability",
      "Paired C–B scoring and episodic-state control",
      passed,
      passed
        ? `pairedCB scores matched transfer tasks only (C vs B, net ${pairedResult.net}); memory snapshot/restore round-trips byte-identical and never touches the procedure store`
        : `pairedOk=${pairedOk} memoryOk=${memoryOk} paired=${JSON.stringify(pairedResult)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------- P4: frozen fixtures and checks are present and valid ---------------- */
function checkCodeCompiles(code: string, tmpDir: string): boolean {
  const file = join(tmpDir, `check-${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(file, code);
  const proc = spawnSync(process.execPath, ["--check", file], { encoding: "utf-8" });
  return proc.status === 0;
}

function preflightFixtures(suitePath: string, suite: Phase3Suite): PreflightCheck {
  const errors: string[] = [];
  if (suite.families.length < 6) errors.push(`need ≥ 6 families, found ${suite.families.length}`);
  const ids = new Set<string>();
  const tmpDir = mkdtempSync(join(tmpdir(), "ntox-preflight-checks-"));
  try {
    for (const family of suite.families) {
      const byClass = (c: string): Phase3Task[] => family.tasks.filter((t) => t.class === c);
      if (byClass("solve").length !== 1) errors.push(`${family.id}: needs exactly 1 solve task`);
      if (byClass("verify").length !== 1) errors.push(`${family.id}: needs exactly 1 verify task`);
      const transfers = byClass("transfer");
      if (transfers.length < 2) errors.push(`${family.id}: needs ≥ 2 transfer tasks (distinct E2 environments)`);
      const envIds = new Set(transfers.map((t) => t.env.id));
      if (envIds.size < 2) errors.push(`${family.id}: transfer environments must be distinct`);
      if (byClass("decoy").length !== 1) errors.push(`${family.id}: needs exactly 1 decoy task`);
      for (const task of family.tasks) {
        const label = `${task.id}`;
        if (ids.has(task.id)) errors.push(`duplicate task id ${task.id}`);
        ids.add(task.id);
        if (!task.prompt.includes("{workspace}")) errors.push(`${label}: prompt must contain {workspace}`);
        if (task.class !== "solve" && (!task.forbiddenLiterals || task.forbiddenLiterals.length === 0)) {
          errors.push(`${label}: forbiddenLiterals required on verify/transfer/decoy tasks`);
        }
        if (!task.checks || task.checks.length === 0) errors.push(`${label}: no checks`);
        for (const c of task.checks) {
          if (c.spec.type !== "command") errors.push(`${label}: checks must be command type`);
          else {
            const code = c.spec.args.filter((a) => a !== "-e").join(" ");
            if (!checkCodeCompiles(code, tmpDir)) errors.push(`${label}: check code does not compile`);
          }
        }
        for (const [rel, content] of Object.entries(task.setup.files)) {
          if (!content) errors.push(`${label}: empty setup file ${rel}`);
        }
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const passed = errors.length === 0;
  return check(
    "P4-frozen-fixtures",
    "Frozen fixtures and checks present and valid",
    passed,
    passed
      ? `${suite.families.length} families, ${ids.size} tasks, all checks compile (${suiteSha256(suitePath)})`
      : errors.slice(0, 10).join("; "),
  );
}

export function runPreflight(suitePath: string): PreflightReport {
  const suite = loadSuite(suitePath);
  const checks = [
    preflightSignerIsolation(),
    preflightVersionBinding(),
    preflightReuseAccounting(),
    preflightPromotionGate(),
    preflightPolicyAccounting(),
    preflightArmComparability(),
    preflightFixtures(suitePath, suite),
  ];
  return {
    generatedAt: new Date().toISOString(),
    suitePath: relative(REPO_ROOT, suitePath).replace(/\\/g, "/"),
    suiteSha256: suiteSha256(suitePath),
    checks,
    passed: checks.every((c) => c.passed),
  };
}

export function renderPreflightMarkdown(report: PreflightReport): string {
  return [
    "# Phase 3 — Preflight Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Suite: \`${report.suitePath}\` (${report.suiteSha256})`,
    `Result: **${report.passed ? "PASS — execution may proceed" : "REFUSED — blockers remain"}**`,
    "",
    "| Check | Verdict | Detail |",
    "|---|---|---|",
    ...report.checks.map((c) => `| ${c.id} — ${c.title} | ${c.passed ? "✅ pass" : "❌ refuse"} | ${c.detail} |`),
    "",
    "Gates (reviewer decision 2026-10-27): harness implementation approved, experimental execution NOT authorized.",
    "This report certifies only that the pre-execution blockers are closed.",
    "",
  ].join("\n");
}

// CLI entry
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() === (process.argv[1] as string).toLowerCase();
if (invokedDirectly) {
  const suitePath = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "phase3-tasks.json");
  const report = runPreflight(suitePath);
  const outDir = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(outDir, "preflight-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "preflight-report.md"), renderPreflightMarkdown(report));
  console.log(renderPreflightMarkdown(report));
  process.exit(report.passed ? 0 : 1);
}
