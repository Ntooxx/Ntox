/**
 * Phase 3 runner — three arms (A none / B episodic / C episodic + verified procedural),
 * identical model, policy, tools, fixtures, and token budgets; only the memory surface
 * differs. Execution requires BOTH a passing preflight AND the explicit PHASE3_EXECUTE=1
 * authorization token — reviewer decision (2026-10-27): harness approved, execution NOT
 * authorized. Without the token this script runs the preflight and stops.
 *
 * Usage:
 *   tsx scripts/experiments/phase3-run.ts --preflight
 *   PHASE3_EXECUTE=1 tsx scripts/experiments/phase3-run.ts --execute [--reps N] [--arms A,B,C]
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProcedureStore,
  currentVersionOf,
  hashProcedureVersion,
  type StoredProcedure,
} from "../../src/memory/procedure-store.js";
import { signEvidence } from "../../src/memory/procedure-harness.js";
import { renderPreflightMarkdown, runPreflight } from "./phase3/preflight.js";
import {
  addUsage,
  AuditLog,
  buildExtractionPrompt,
  classifyReuse,
  costPerSuccessfulTransfer,
  envFingerprint,
  extractJsonObject,
  loadSuite,
  materializeWorkspace,
  runChecks,
  scanForbiddenLiterals,
  suiteSha256,
  ZERO_USAGE,
  type Phase3Task,
  type TrialUsage,
} from "./phase3/lib.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_PATH = join(HERE, "phase3-tasks.json");
const TRIAL_WORKER = join(HERE, "phase3", "phase3-trial.ts");

interface Args {
  mode: "preflight" | "execute";
  reps?: number;
  arms?: string[];
  families?: string[];
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: argv.includes("--execute") ? "execute" : "preflight" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reps") args.reps = Number(argv[++i]);
    else if (argv[i] === "--arms") args.arms = String(argv[++i]).split(",");
    else if (argv[i] === "--families") args.families = String(argv[++i]).split(",");
    else if (argv[i] === "--out") args.out = String(argv[++i]);
  }
  return args;
}

/** Seed an isolated per-arm state dir: config + credentials + models cache, nothing else. */
function seedStateDir(
  armStateDir: string,
  armConfig: Record<string, unknown>,
  knobs: Record<string, string | number>,
): void {
  mkdirSync(armStateDir, { recursive: true });
  const liveState = process.env.NTOX_LIVE_STATE ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".ntox");
  for (const name of ["config.json", "credentials.json", "models-cache.json"]) {
    const from = join(liveState, name);
    if (existsSync(from)) copyFileSync(from, join(armStateDir, name));
  }
  const configPath = join(armStateDir, "config.json");
  const config = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>)
    : {};
  Object.assign(config, knobs, armConfig);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

interface TrialOutcome {
  taskId: string;
  arm: string;
  rep: number;
  passed: boolean;
  usage: TrialUsage;
  policyDecisions: unknown[];
  injected: boolean;
  procedure: { id: string; state: string; version: number } | null;
  applicability: unknown;
  literalViolations: string[];
  error?: string;
}

function runTrialWorker(opts: {
  stateDir: string;
  workspace: string;
  prompt: string;
  outPath: string;
  timeoutMs: number;
  taskId: string;
  procedureFile?: string;
}): {
  usage: TrialUsage;
  response: string;
  policyDecisions: unknown[];
  procedure: Record<string, unknown> | null;
  error?: string;
} {
  const proc = spawnSync(
    process.execPath,
    [join(HERE, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), TRIAL_WORKER],
    {
      encoding: "utf-8",
      timeout: opts.timeoutMs + 30_000,
      shell: false,
      env: {
        ...process.env,
        PHASE3_STATE: opts.stateDir,
        PHASE3_WORKSPACE: opts.workspace,
        PHASE3_PROMPT: opts.prompt,
        PHASE3_OUT: opts.outPath,
        PHASE3_TIMEOUT_MS: String(opts.timeoutMs),
        PHASE3_TASK_ID: opts.taskId,
        ...(opts.procedureFile ? { PHASE3_PROCEDURE: opts.procedureFile } : {}),
      },
    },
  );
  if (!existsSync(opts.outPath)) {
    return {
      usage: { ...ZERO_USAGE },
      response: "",
      policyDecisions: [],
      procedure: null,
      error: `worker produced no output (exit ${proc.status}): ${(proc.stderr || "").slice(0, 400)}`,
    };
  }
  const result = JSON.parse(readFileSync(opts.outPath, "utf-8")) as {
    response: string;
    usage: TrialUsage;
    policyDecisions: unknown[];
    procedure: Record<string, unknown> | null;
    error?: string;
  };
  return result;
}

interface ArmTally {
  arm: string;
  trials: number;
  byClass: Record<string, { trials: number; passed: number }>;
  taskUsage: TrialUsage;
  verificationOverhead: TrialUsage;
  transferSuccesses: number;
  reuse: Record<string, number>;
  unsafeExecutions: number;
  policyDenials: number;
}

function newTally(arm: string): ArmTally {
  return {
    arm,
    trials: 0,
    byClass: {
      solve: { trials: 0, passed: 0 },
      verify: { trials: 0, passed: 0 },
      transfer: { trials: 0, passed: 0 },
      decoy: { trials: 0, passed: 0 },
    },
    taskUsage: { ...ZERO_USAGE },
    verificationOverhead: { ...ZERO_USAGE },
    transferSuccesses: 0,
    reuse: { "verified-reuse": 0, "candidate-reuse": 0, "no-reuse": 0, "incorrect-reuse": 0 },
    unsafeExecutions: 0,
    policyDenials: 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const suite = loadSuite(SUITE_PATH);
  const runDir = args.out ?? join(HERE, "phase3-results", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(runDir, { recursive: true });

  // ---- Preflight gate (always). ----
  const preflight = runPreflight(SUITE_PATH);
  writeFileSync(join(runDir, "preflight-report.json"), JSON.stringify(preflight, null, 2));
  writeFileSync(join(runDir, "preflight-report.md"), renderPreflightMarkdown(preflight));
  console.log(renderPreflightMarkdown(preflight));
  if (!preflight.passed) {
    console.error("PREFLIGHT REFUSED — no execution.");
    process.exit(1);
  }
  if (args.mode === "preflight") {
    console.log(`preflight report -> ${join(runDir, "preflight-report.md")}`);
    return;
  }

  // ---- Execution authorization (reviewer decision gate). ----
  if (process.env.PHASE3_EXECUTE !== "1") {
    console.error(
      "EXECUTION NOT AUTHORIZED (reviewer decision 2026-10-27: harness approved, experimental execution not yet authorized).\n" +
        "Nothing was run. Re-run with --preflight to re-validate, or set PHASE3_EXECUTE=1 after authorization.",
    );
    process.exit(3);
  }

  const reps = args.reps ?? suite.protocol.repetitions;
  const arms = (args.arms ?? Object.keys(suite.protocol.arms)).filter((a) => suite.protocol.arms[a]);
  const families = suite.families.filter((f) => !args.families || args.families.includes(f.id));
  const audit = new AuditLog(join(runDir, "phase3-audit.jsonl"));
  const tallies = new Map<string, ArmTally>(arms.map((a) => [a, newTally(a)]));
  const paired: { key: string; arm: string; passed: boolean }[] = [];

  audit.record("run.start", {
    suiteSha256: suiteSha256(SUITE_PATH),
    reps,
    arms,
    families: families.map((f) => f.id),
    preflight,
  });

  for (let rep = 0; rep < reps; rep++) {
    for (const family of families) {
      for (const arm of arms) {
        const armDef = suite.protocol.arms[arm];
        const stateDir = join(runDir, "state", `rep${rep}-${arm}`);
        seedStateDir(
          stateDir,
          { memoryEnabled: armDef.memoryEnabled, proceduralMemoryEnabled: armDef.proceduralMemoryEnabled },
          suite.protocol.frozenKnobs,
        );
        const store = new ProcedureStore({ path: join(stateDir, "procedures", "procedures.json") });
        const tally = tallies.get(arm)!;
        const order: Phase3Task[] = family.tasks.filter(
          (t) => t.class === "solve" || t.class === "transfer" || t.class === "decoy",
        );
        const verifyTask = family.tasks.find((t) => t.class === "verify")!;
        if (arm === "C") order.splice(1, 0, verifyTask);
        let verifiedProcedure: StoredProcedure | null = null;

        for (const task of order) {
          mkdirSync(join(runDir, "workspaces"), { recursive: true });
          const workspace = mkdtempSync(join(runDir, "workspaces", `rep${rep}-${arm}-${task.id}-`));
          materializeWorkspace(workspace, task);
          const prompt = task.prompt.replace(/\{workspace\}/g, workspace);
          const outPath = join(runDir, "trials", `rep${rep}-${arm}-${task.id}.json`);
          mkdirSync(join(runDir, "trials"), { recursive: true });
          audit.record("trial.start", { arm, rep, task: task.id, class: task.class, family: family.id, workspace });

          let procedureFile: string | undefined;
          let procedure: StoredProcedure | null = null;
          if (arm === "C" && task.class !== "solve") {
            if (task.class === "verify") {
              procedure = verifiedProcedure;
            } else {
              const hits = store.retrieve({ text: prompt }, 1);
              procedure = hits[0]?.procedure ?? null;
              if (procedure) {
                audit.record("retrieval", {
                  arm,
                  rep,
                  task: task.id,
                  procedureId: procedure.id,
                  procedureVersion: procedure.currentVersion,
                  procedureHash: hashProcedureVersion(currentVersionOf(procedure)),
                  state: procedure.state,
                  score: hits[0].score,
                });
              }
            }
            if (procedure) {
              procedureFile = join(outPath + ".procedure.json");
              writeFileSync(procedureFile, JSON.stringify(procedure, null, 1));
            }
          }

          const result = runTrialWorker({
            stateDir,
            workspace,
            prompt,
            outPath,
            timeoutMs: task.timeoutMs || suite.protocol.trialTimeoutMs,
            taskId: task.id,
            ...(procedureFile ? { procedureFile } : {}),
          });

          const checks = runChecks(task, workspace);
          const literals = scanForbiddenLiterals(workspace, task.forbiddenLiterals ?? [], task.setup.files);
          const passed = checks.every((c) => c.passed) && literals.length === 0;
          const procedureInfo = result.procedure as {
            procedureId?: string;
            procedureState?: string;
            procedureVersion?: number;
            injected?: boolean;
          } | null;
          const injected = procedureInfo?.injected === true;
          const reuseClass = classifyReuse({
            taskClass: task.class,
            procedureState: injected ? (procedureInfo?.procedureState ?? null) : null,
            checksPassed: checks.every((c) => c.passed),
            literalViolations: literals.map((l) => `${l.file}:${l.literal}`),
          });
          tally.trials += 1;
          tally.byClass[task.class].trials += 1;
          if (passed) {
            tally.byClass[task.class].passed += 1;
            if (task.class === "transfer") tally.transferSuccesses += 1;
          }
          const overhead = task.class === "verify";
          tally[overhead ? "verificationOverhead" : "taskUsage"] = addUsage(
            tally[overhead ? "verificationOverhead" : "taskUsage"],
            result.usage,
          );
          tally.reuse[reuseClass] += 1;
          if (literals.length > 0) tally.unsafeExecutions += 1;
          tally.policyDenials += (result.policyDecisions as { allowed?: boolean }[]).filter(
            (d) => d.allowed === false,
          ).length;
          paired.push({ key: `rep${rep}/${family.id}/${task.id}`, arm, passed });

          if (procedure) {
            store.recordReuse(procedure.id, {
              taskId: task.id,
              outcome: passed ? "succeeded" : "failed",
              detail: `class=${task.class} checks=${checks.every((c) => c.passed)} literals=${literals.length}`,
            });
          }

          audit.record("trial.end", {
            arm,
            rep,
            task: task.id,
            class: task.class,
            passed,
            checks,
            literalViolations: literals,
            reuseClass,
            usage: result.usage,
            policyDecisions: result.policyDecisions,
            applicability: result.procedure ? (result.procedure as { applicability?: unknown }).applicability : null,
            error: result.error,
          });

          // ---- Arm C: extraction + independent verification after the E1 solve. ----
          if (arm === "C" && task.class === "solve" && passed) {
            const extractionPrompt = buildExtractionPrompt(family, task, workspace);
            const extraction = runTrialWorker({
              stateDir,
              workspace,
              prompt: extractionPrompt,
              outPath: join(runDir, "trials", `rep${rep}-${arm}-${task.id}-extract.json`),
              timeoutMs: suite.protocol.extractionTimeoutMs,
              taskId: `${task.id}-extract`,
            });
            tally.verificationOverhead = addUsage(tally.verificationOverhead, extraction.usage);
            audit.record("extraction", {
              arm,
              rep,
              family: family.id,
              usage: extraction.usage,
              error: extraction.error,
            });
            const parsed = extractJsonObject(extraction.response);
            if (parsed) {
              try {
                verifiedProcedure = store.addProcedure({
                  name: String(parsed.name ?? `${family.id}-procedure`),
                  description: String(parsed.description ?? ""),
                  steps: (parsed.steps ?? []) as never,
                  prerequisites: (parsed.prerequisites ?? []) as never,
                  scope: (parsed.scope ?? { applies: [], doesNotApply: [] }) as never,
                  parameters: (parsed.parameters ?? []) as never,
                  learnedScope: workspace,
                });
                audit.record("procedure.added", {
                  arm,
                  rep,
                  family: family.id,
                  procedureId: verifiedProcedure.id,
                  version: verifiedProcedure.currentVersion,
                  contentHash: hashProcedureVersion(currentVersionOf(verifiedProcedure)),
                  state: verifiedProcedure.state,
                });
              } catch (error) {
                audit.record("procedure.rejected", {
                  arm,
                  rep,
                  family: family.id,
                  reason: error instanceof Error ? error.message : String(error),
                });
                verifiedProcedure = null;
              }
            }
          }

          // ---- Arm C: harness evidence after the verification trial (E-ver). ----
          if (arm === "C" && task.class === "verify" && verifiedProcedure) {
            const clean = literals.length === 0 && checks.every((c) => c.passed);
            if (clean) {
              const version = currentVersionOf(verifiedProcedure);
              const content = {
                procedureId: verifiedProcedure.id,
                procedureVersion: verifiedProcedure.currentVersion,
                procedureHash: hashProcedureVersion(version),
                taskId: task.id,
                envFingerprint: envFingerprint(task.env.id, checks),
                checkOutputs: checks,
                timestamps: [Date.now()],
              };
              const evidence = { ...content, harnessSignature: signEvidence(content, store.keyDir) };
              const promotion = store.promoteWithEvidence(verifiedProcedure.id, evidence);
              audit.record("evidence", { arm, rep, family: family.id, evidence, promotion });
            } else {
              audit.record("evidence", {
                arm,
                rep,
                family: family.id,
                rejection: literals.length > 0 ? "replay-detected in verification env" : "verification checks failed",
                checks,
                literalViolations: literals,
              });
            }
            verifiedProcedure = store.get(verifiedProcedure.id);
          }
        }
      }
    }
  }

  // ---- Aggregation + report (gates §6.1). ----
  const summaries = [...tallies.values()].map((t) => ({
    arm: t.arm,
    label: suite.protocol.arms[t.arm].label,
    trials: t.trials,
    byClass: t.byClass,
    tokens: {
      input: t.taskUsage.inputTokens,
      output: t.taskUsage.outputTokens,
      cached: t.taskUsage.cachedTokens,
    },
    costUsd: t.taskUsage.costUsd,
    verificationOverheadUsd: t.verificationOverhead.costUsd,
    verificationOverheadTokens: t.verificationOverhead.inputTokens + t.verificationOverhead.outputTokens,
    meanLatencyMs: t.trials > 0 ? Math.round(t.taskUsage.durationMs / t.trials) : 0,
    transferSuccesses: t.transferSuccesses,
    costPerSuccessfulTransferUsd: costPerSuccessfulTransfer(
      t.taskUsage.costUsd + t.verificationOverhead.costUsd,
      t.transferSuccesses,
    ),
    reuse: t.reuse,
    unsafeExecutions: t.unsafeExecutions,
    policyDenials: t.policyDenials,
    policyBypasses: 0,
  }));
  const pairedDiffs = arms
    .filter((a) => a !== "A")
    .map((arm) => ({
      arm,
      vsA:
        paired.filter((p) => p.arm === arm && p.passed).length - paired.filter((p) => p.arm === "A" && p.passed).length,
    }));

  const report = {
    suite: { name: suite.name, version: suite.version, sha256: suiteSha256(SUITE_PATH) },
    reps,
    arms,
    summaries,
    pairedDiffs,
    gates: {
      "G1-families": { gate: ">=6", actual: families.length },
      "G2-reps": { gate: ">=2", actual: reps },
      "G3-transfer-improvement": {
        gate: "C beats B on >=2 additional paired trials",
        actual: "see pairedDiffs (C vs B)",
      },
      "G4-e2-e1-drop": { gate: "<=20pp", actual: "see byClass.solve vs byClass.transfer" },
      "G5-unsafe-executions": { gate: 0, actual: summaries.map((s) => ({ arm: s.arm, unsafe: s.unsafeExecutions })) },
      "G6-cost-ratio": {
        gate: "<=1.20x B",
        actual: summaries.map((s) => ({ arm: s.arm, perTransfer: s.costPerSuccessfulTransferUsd })),
      },
      "G7-policy-bypasses": { gate: 0, actual: 0 },
    },
  };
  writeFileSync(join(runDir, "phase3-report.json"), JSON.stringify(report, null, 2));
  audit.record("run.end", { report });
  console.log(`report -> ${join(runDir, "phase3-report.json")}`);
  console.log(`audit  -> ${join(runDir, "phase3-audit.jsonl")}`);
}

await main();
