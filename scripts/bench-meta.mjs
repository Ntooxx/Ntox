#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEvaluation = join(root, "dist", "evaluation", "index.js");

function parseArgs(argv) {
  const parsed = { _: [] };
  for (const token of argv) {
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const [key, value] = token.replace(/^--/, "").split("=");
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

function requireBuild() {
  if (existsSync(distEvaluation)) return;
  console.error("Build output missing. Run `npm run build` first.");
  process.exit(1);
}

async function loadEvaluation() {
  return import(pathToFileURL(distEvaluation).href);
}

function outputDir(name) {
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = join(root, "experiments", "meta-eval", `${name}-${stamp}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function runNecessity() {
  const { runNecessityChecks, saveNecessityReport, generateNecessityMarkdown } = await loadEvaluation();
  const report = await runNecessityChecks();
  const dir = outputDir("necessity");
  const { jsonPath, mdPath } = saveNecessityReport(report, dir);
  console.log(generateNecessityMarkdown(report));
  console.log(`Passed ${report.summary.passed}/${report.summary.total}`);
  console.log(`Saved: ${jsonPath}`);
  console.log(`Saved: ${mdPath}`);
  if (!report.passed) process.exit(1);
}

async function runWorker(args) {
  const arm = args.arm;
  const out = args.out;
  const reps = Number(args.reps ?? 1);
  if (!arm || !out) throw new Error("--worker requires --arm and --out");
  const checkpointPath = out + ".checkpoint.jsonl";
  const evaluation = await loadEvaluation();
  const { loadConfig } = await import(pathToFileURL(join(root, "dist", "core", "config.js")).href);
  const { createAgentInfra, createAgentConfig } = await import(
    pathToFileURL(join(root, "dist", "core", "dispatcher.js")).href
  );
  const { Agent } = await import(pathToFileURL(join(root, "dist", "core", "agent.js")).href);
  const { ToolRegistry } = await import(pathToFileURL(join(root, "dist", "tools", "registry.js")).href);

  const config = loadConfig();
  if (args.model) config.model = args.model;
  const curriculum = evaluation.buildCurriculum({ variantsPerFamily: Number(args.variants ?? 6) });
  const overrides = evaluation.armOverrides(arm);
  const cognitionOn = evaluation.armEnablesCognition(arm);

  const buildAgent = () => {
    const infra = createAgentInfra(config);
    infra.cognitiveKernel.setEnabled(cognitionOn);
    const sessionId = `meta-${arm}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentConfig = createAgentConfig(infra, config, sessionId, overrides);
    agentConfig.tools = new ToolRegistry();
    return new Agent(agentConfig);
  };

  const factory = () => {
    let agent = buildAgent();
    return {
      async send(prompt) {
        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            let response = "";
            let tokens = 0;
            const started = Date.now();
            console.log(`  >> ${prompt.replace(/\s+/g, " ").slice(0, 60)}`);
            const callbacks = {
              onToken: (token) => {
                response += token;
              },
              onToolCall: () => {},
              onToolResult: () => {},
              onUsage: (usage) => {
                tokens += (usage.inputTokens || 0) + (usage.outputTokens || 0);
              },
              onThinking: () => {},
            };
            for await (const _chunk of agent.run(prompt, callbacks)) {
              /* drain */
            }
            console.log(`  << ${((Date.now() - started) / 1000).toFixed(1)}s, ${response.length} chars`);
            return { response, tokens };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const isTransient =
              msg.includes("Network error") ||
              msg.includes("fetch failed") ||
              msg.includes("ECONNRESET") ||
              msg.includes("ETIMEDOUT") ||
              msg.includes("stream stalled") ||
              msg.includes("cancelled");
            if (attempt < maxRetries - 1 && isTransient) {
              const wait = (attempt + 1) * 5000;
              console.log(`  !! retry ${attempt + 1}/${maxRetries} in ${wait / 1000}s: ${msg.slice(0, 80)}`);
              await new Promise((resolve) => setTimeout(resolve, wait));
              continue;
            }
            throw error;
          }
        }
        throw new Error("unreachable");
      },
      async reset() {
        agent = buildAgent();
      },
    };
  };

  const report = await evaluation.runLongitudinal({
    curriculum,
    arms: [arm],
    factory,
    repetitions: reps,
    onProgress: (message) => console.log(message),
    onTaskComplete: (_arm, result) => {
      appendFileSync(checkpointPath, JSON.stringify(result) + "\n");
    },
  });
  writeFileSync(out, JSON.stringify(report.arms[0], null, 2));
}

async function runLongitudinal(args) {
  const evaluation = await loadEvaluation();
  const arms = String(args.arms ?? "off,raw-context,full")
    .split(",")
    .map((arm) => arm.trim())
    .filter(Boolean);
  const reps = Number(args.reps ?? 1);
  const variants = Number(args.variants ?? 6);
  if (arms.length < 2) throw new Error("Provide at least two arms, e.g. --arms=off,full");
  const curriculum = evaluation.buildCurriculum({ variantsPerFamily: variants });
  const dir = outputDir("longitudinal");

  const configSourceDir = process.env.NTOX_DIR || join(homedir(), ".ntox");
  const configSource = join(configSourceDir, "config.json");

  console.log(`Tasks: ${curriculum.tasks.length} | Arms: ${arms.join(", ")} | Reps: ${reps}`);

  const armResults = [];
  for (const arm of arms) {
    const isolatedDir = mkdtempSync(join(tmpdir(), `ntox-meta-${arm}-`));
    if (existsSync(configSource)) {
      copyFileSync(configSource, join(isolatedDir, "config.json"));
    } else {
      console.warn(`No config at ${configSource}; worker will fall back to defaults.`);
    }
    const out = join(dir, `arm-${arm}.json`);
    const workerArgs = [
      fileURLToPath(import.meta.url),
      "--worker",
      `--arm=${arm}`,
      `--out=${out}`,
      `--reps=${reps}`,
      `--variants=${variants}`,
    ];
    if (args.model) workerArgs.push(`--model=${args.model}`);
    console.log(`\n=== arm: ${arm} | tasks: ${curriculum.tasks.length} | NTOX_DIR=${isolatedDir} ===`);
    const result = spawnSync(process.execPath, workerArgs, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NTOX_DIR: isolatedDir, NTOX_EMBED_BUDGET_MS: "5000" },
    });
    if (result.status !== 0) {
      console.error(`Arm ${arm} failed with status ${result.status}`);
      process.exit(result.status ?? 1);
    }
    armResults.push(JSON.parse(readFileSync(out, "utf-8")));
  }

  const comparisons = [];
  const baseline = armResults[0];
  for (const treatment of armResults.slice(1)) {
    const diffs = evaluation.pairedDifferences(
      baseline.tasks.map((task) => task.score),
      treatment.tasks.map((task) => task.score),
    );
    const ci = evaluation.bootstrapCI(diffs);
    const effectSize = evaluation.cohensD(diffs);
    comparisons.push({
      baseline: baseline.arm,
      treatment: treatment.arm,
      meanDelta: evaluation.mean(diffs),
      ci,
      effectSize,
      significant: ci.significant,
      requiredN: evaluation.requiredPairedSampleSize(effectSize),
      observedN: diffs.length,
    });
  }

  const report = {
    curriculum: curriculum.id,
    repetitions: reps,
    arms: armResults,
    comparisons,
    primary: comparisons.some((comparison) => comparison.baseline === "raw-context" && comparison.treatment === "full")
      ? { baseline: "raw-context", treatment: "full" }
      : comparisons.length > 0
        ? { baseline: baseline.arm, treatment: comparisons[0].treatment }
        : null,
    generatedAt: Date.now(),
  };

  const { jsonPath, mdPath } = evaluation.saveEvaluationReport(report, dir);
  console.log("\n" + evaluation.generateEvaluationReport(report));
  console.log(`Saved: ${jsonPath}`);
  console.log(`Saved: ${mdPath}`);
  writeFileSync(join(dir, "arms.json"), JSON.stringify(arms, null, 2));
}

function printHelp() {
  console.log(`ntox meta-cognition evaluation

Usage:
  node scripts/bench-meta.mjs --necessity
      Run deterministic necessity checks (no LLM, no API key).

  node scripts/bench-meta.mjs --longitudinal [--arms=off,raw-context,full] [--reps=1] [--variants=6] [--model=id]
      Run the ordered curriculum for each arm in an isolated NTOX_DIR using your
      configured provider, then compute paired bootstrap confidence intervals.
      --variants sets tasks per family (6 = 30 tasks, 18 = 90 tasks).
      --model overrides the agent model for the run.
  Default primary contrast: raw-context vs full. 'all' = every subsystem on, no reflection. 'full' = + reflection (slow).

  node scripts/bench-meta.mjs --worker --arm=<id> --out=<file> [--reps=1]
      Internal worker used by --longitudinal.

Arms: off, kernel, memory, theory, strategy, mistakes, raw-context, full
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.necessity) {
    requireBuild();
    await runNecessity();
    return;
  }
  if (args.worker) {
    requireBuild();
    await runWorker(args);
    return;
  }
  if (args.longitudinal) {
    requireBuild();
    await runLongitudinal(args);
    return;
  }
  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
