import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const integrationDir = resolve(workspace, "integrations", "deepseek-harness");
const reportDir = resolve(workspace, "experiments", "verification");
const reportPath = resolve(reportDir, "report.json");
const checks = [];

function summarizeOutput(output) {
  if (output.length <= 6000) return output;
  return `${output.slice(0, 3000)}\n\n... output truncated ...\n\n${output.slice(-3000)}`;
}

function run(name, command, args, cwd) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const passed = !result.error && result.status === 0 && !result.signal;
  checks.push({
    name,
    cwd,
    command: [command, ...args].join(" "),
    startedAt,
    durationMs: Date.now() - startedMs,
    passed,
    exitCode: result.status,
    signal: result.signal,
    output: summarizeOutput(output),
    error: result.error?.message,
  });
}

function runNpm(name, args, cwd) {
  if (process.platform === "win32") {
    run(name, process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], cwd);
    return;
  }
  run(name, "npm", args, cwd);
}

const artifactSmoke = `
import { NtoxCognitiveLayer } from "./dist/cognition/index.js";
import { AliveEngine } from "./dist/alive/index.js";

const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false, strategyEnabled: false });
await layer.afterTurn({ sessionId: "verify", userMessage: "harbor=blue-ember", assistantResponse: "harbor=blue-ember" });
await layer.afterTurn({ sessionId: "verify", userMessage: "Correct harbor=navy-ember", assistantResponse: "harbor=navy-ember", correction: { topicKey: "harbor", correction: "harbor=navy-ember", wrongAnswer: "harbor=blue-ember" } });
await layer.afterTool({ sessionId: "verify", turnId: "tool-turn", toolName: "read", success: false, error: "ENOENT: manifest" });
await layer.afterTurn({ sessionId: "verify", turnId: "tool-turn", userMessage: "Read the manifest", assistantResponse: "The read failed" });
const context = await layer.beforeStep({ sessionId: "verify", turnId: "next-turn", userMessage: "What is harbor? Continue release validation." });
if (!context.diagnostics.correctionIncluded || !context.diagnostics.recoveryIncluded) throw new Error("Expected correction and recovery context.");
const correctionsAt = context.prompt.indexOf("Previous Corrections: Authoritative");
const memoriesAt = context.prompt.indexOf("Relevant Past Memories");
if (memoriesAt >= 0 && correctionsAt > memoriesAt) throw new Error("Correction context must precede memories.");
const alive = new AliveEngine({ wakePredictionError: 0.5 });
const prediction = alive.createPrediction({ statement: "The check will pass.", confidence: 0.8, expectation: { eventType: "check_finished", payload: { status: "passed" } } });
const pulse = alive.recordEvent({ type: "check_finished", source: "verify", predictionId: prediction.id, payload: { status: "failed" } });
if (!pulse.actions.some((action) => action.kind === "wake")) throw new Error("Expected prediction error to wake the host.");
console.log("Built cognition and alive artifact smoke test passed.");
`;

runNpm("root typecheck", ["run", "typecheck"], workspace);
runNpm("root lint", ["run", "lint"], workspace);
runNpm("root tests", ["test"], workspace);
runNpm("root build", ["run", "build"], workspace);
runNpm("root format check", ["run", "format:check"], workspace);
runNpm("root package dry run", ["pack", "--dry-run"], workspace);
run("CLI help", process.execPath, [resolve(workspace, "dist", "index.js"), "--help"], workspace);
run("built cognition smoke", process.execPath, ["--input-type=module", "--eval", artifactSmoke], workspace);
runNpm("adapter typecheck", ["run", "typecheck"], integrationDir);
runNpm("adapter tests", ["test"], integrationDir);
runNpm("adapter build", ["run", "build"], integrationDir);
runNpm("adapter package dry run", ["pack", "--dry-run"], integrationDir);

const report = {
  generatedAt: new Date().toISOString(),
  passed: checks.every((check) => check.passed),
  passedCount: checks.filter((check) => check.passed).length,
  totalCount: checks.length,
  checks,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
