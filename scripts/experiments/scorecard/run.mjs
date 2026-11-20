#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const suitePath = join(here, "suite.json");
const argv = process.argv.slice(2);
const checkMode = argv.includes("--check");
const helpMode = argv.includes("--help") || argv.includes("-h");

function distUrl(relative) {
  return pathToFileURL(join(root, "dist", relative)).href;
}

function requireBuild() {
  if (!existsSync(join(root, "dist", "evaluation", "scorecard.js"))) {
    console.error("Build output missing. Run `npm run build` first (or use npm run eval:scorecard).");
    process.exit(1);
  }
}

function printHelp() {
  console.log(`ntox capability scorecard

Usage:
  npm run eval:scorecard              Run all frozen tasks and write the report.
  npm run eval:scorecard -- --check   Verify the suite hash and run every task twice to prove determinism.

The suite is pinned by sha256 in scripts/experiments/scorecard/suite.json.
All probes run offline in an isolated temporary NTOX_DIR with provider keys cleared.
Reports are written to experiments/review/scorecard-eval/.
`);
}

function skillSlug(request) {
  return request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
}

function fakeSkill(request) {
  const slug = skillSlug(request);
  return {
    name: `recover-${slug}`,
    description: `Repeatable recovery procedure for: ${request.slice(0, 80)}`,
    category: "self-authored",
    prompt:
      "1. Inspect the current state and identify the failing step. " +
      "2. Apply the smallest safe correction. 3. Verify the outcome with a read-only check. " +
      "4. Record what changed for the next session.",
    triggers: [request.slice(0, 30).toLowerCase(), `fix ${slug.slice(0, 20)}`],
    tools: ["read", "shell"],
    examples: [request],
  };
}

function fakeLLM(request) {
  const payload = JSON.stringify(fakeSkill(request));
  return {
    stream() {
      return (async function* () {
        yield { delta: payload };
      })();
    },
  };
}

function rubricChecks(skill) {
  if (!skill) return {};
  return {
    validKebabName: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name),
    descriptiveDescription: typeof skill.description === "string" && skill.description.trim().length >= 10,
    selfAuthoredCategory: skill.category === "self-authored",
    actionablePrompt: typeof skill.prompt === "string" && skill.prompt.trim().length >= 40,
    hasTriggers: Array.isArray(skill.triggers) && skill.triggers.length >= 2 && skill.triggers.length <= 5,
    hasTools: Array.isArray(skill.tools) && skill.tools.length > 0,
    hasExample: Array.isArray(skill.examples) && skill.examples.length >= 1,
  };
}

async function main() {
  if (helpMode) {
    printHelp();
    return;
  }
  requireBuild();

  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  const score = await import(distUrl("evaluation/scorecard.js"));
  if (!score.verifySuite(suite)) {
    console.error(`Suite fingerprint mismatch. Expected ${suite.sha256}, got ${score.suiteFingerprint(suite)}.`);
    process.exit(1);
  }

  const isolationDir = mkdtempSync(join(tmpdir(), "ntox-scorecard-"));
  process.env.NTOX_DIR = isolationDir;
  for (const key of [
    "NTOX_API_KEY",
    "NTOX_API_KEY_PROVIDER",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "DEEPSEEK_API_KEY",
    "TOGETHER_API_KEY",
    "MISTRAL_API_KEY",
  ]) {
    delete process.env[key];
  }

  const evaluation = await import(distUrl("evaluation/index.js"));
  const cognition = await import(distUrl("cognition/index.js"));
  const episodic = await import(distUrl("memory/episodic.js"));
  const mistakes = await import(distUrl("meta/mistakes.js"));
  const embedding = await import(distUrl("memory/embedding-service.js"));
  const autoLearner = await import(distUrl("skills/auto-learner.js"));

  const necessity = await evaluation.runNecessityChecks();
  const moduleCache = new Map();
  async function loadModule(relative) {
    if (!moduleCache.has(relative)) moduleCache.set(relative, await import(distUrl(relative)));
    return moduleCache.get(relative);
  }

  const clamp = (value) => Math.max(0, Math.min(1, value));
  const makeResult = (task, measured, value, detail) => ({
    id: task.id,
    label: task.label,
    score: clamp(value),
    passed: clamp(value) >= 1,
    detail: detail.replace(/\s+/g, " ").trim(),
    measured,
  });
  const unmeasured = (task, detail) => makeResult(task, false, 0, detail);

  async function runTask(task) {
    switch (task.kind) {
      case "necessity": {
        const check = necessity.checks.find((item) => item.id === task.checkId);
        if (!check) return unmeasured(task, `necessity check ${task.checkId} missing`);
        return makeResult(task, true, check.passed ? 1 : 0, check.detail);
      }

      case "memory-recall": {
        const memory = new episodic.MemoryStore();
        memory.clearAll();
        for (const fact of task.facts) {
          const { vector, model } = embedding.localEmbedder.embedSync(fact.fact);
          memory.addEpisode(`scorecard-${task.id}`, fact.fact, `Recorded: ${fact.fact}`, vector, model);
        }
        let hits = 0;
        for (const fact of task.facts) {
          const { vector, model } = embedding.localEmbedder.embedSync(fact.query);
          const results = memory.retrieve(vector, 5, 0.5, model);
          if (results.some((item) => item.episode.userMessage === fact.fact)) hits++;
        }
        return makeResult(task, true, hits / task.facts.length, `retrieved ${hits}/${task.facts.length} frozen facts at R@5, threshold 0.5`);
      }

      case "correction-precedence": {
        let ordered = 0;
        for (const item of task.cases) {
          const memory = new episodic.MemoryStore();
          memory.clearAll();
          memory.addDurableMemory("fact", item.fact, "scorecard", 0.95);
          const journal = new mistakes.MistakeJournal();
          journal.clearAll();
          journal.add(item.topic, item.query, item.wrong, item.correct, "user-correction");
          const { vector, model } = embedding.localEmbedder.embedSync(item.query);
          const layer = new cognition.NtoxCognitiveLayer(
            {
              cognitionEnabled: false,
              theoryEnabled: false,
              strategyEnabled: false,
              mistakesEnabled: true,
              memoryEnabled: true,
            },
            { memory, mistakes: journal },
          );
          const context = await layer.beforeStep({
            sessionId: `scorecard-${task.id}-${item.topic}`,
            userMessage: item.query,
            embedding: vector,
            embeddingModel: model,
          });
          const correctionAt = context.prompt.indexOf("Previous Corrections");
          const memoryAt = context.prompt.indexOf("Relevant Past Memories");
          if (
            context.diagnostics.correctionIncluded &&
            correctionAt >= 0 &&
            (memoryAt < 0 || correctionAt < memoryAt) &&
            context.prompt.includes(item.correct)
          ) {
            ordered++;
          }
        }
        return makeResult(task, true, ordered / task.cases.length, `ordered ${ordered}/${task.cases.length} corrections`);
      }

      case "skill-author": {
        let authored = 0;
        let accepted = 0;
        for (const request of task.requests) {
          const skill = await autoLearner.authorSkillFromStruggle(fakeLLM(request), {
            userInput: request,
            response: `Recovered from the failed step for ${skillSlug(request)}.`,
            toolCalls: [{ name: "read", success: false, args: { path: "/tmp/x" } }],
            corrected: false,
            falseSuccess: false,
            toolFailures: 1,
            retries: 1,
            critiqueGaps: 1,
          });
          if (!skill) continue;
          authored++;
          const checks = Object.values(rubricChecks(skill));
          if (checks.length > 0 && checks.every(Boolean)) accepted++;
        }
        return makeResult(
          task,
          true,
          accepted / task.requests.length,
          `${accepted}/${task.requests.length} rubric-accepted, ${authored}/${task.requests.length} authored`,
        );
      }

      case "embed-offline": {
        const { vector, model } = embedding.localEmbedder.embedSync("ntox scorecard offline privacy probe");
        const valid = Array.isArray(vector) && vector.length > 0 && typeof model === "string" && model.length > 0;
        return makeResult(task, true, valid ? 1 : 0, `model=${model}, dim=${vector?.length ?? 0}, keys cleared`);
      }

      case "trace-diagnostics": {
        const memory = new episodic.MemoryStore();
        memory.clearAll();
        memory.addDurableMemory("fact", "scorecard trace probe fact", "scorecard", 0.9);
        const { vector, model } = embedding.localEmbedder.embedSync("scorecard trace probe fact");
        const layer = new cognition.NtoxCognitiveLayer(
          {
            cognitionEnabled: false,
            theoryEnabled: false,
            strategyEnabled: false,
            mistakesEnabled: false,
            memoryEnabled: true,
          },
          { memory },
        );
        const context = await layer.beforeStep({
          sessionId: "scorecard-trace",
          userMessage: "scorecard trace probe fact",
          embedding: vector,
          embeddingModel: model,
        });
        const valid =
          Array.isArray(context.sections) &&
          typeof context.prompt === "string" &&
          context.prompt.length > 0 &&
          context.diagnostics !== null &&
          typeof context.diagnostics === "object" &&
          "memoryIncluded" in context.diagnostics;
        return makeResult(
          task,
          true,
          valid ? 1 : 0,
          `sections=${context.sections?.length ?? 0}, promptChars=${context.prompt?.length ?? 0}, diagnostics=${Object.keys(context.diagnostics ?? {}).length}`,
        );
      }

      case "capability-exports": {
        let found = 0;
        let total = 0;
        const missing = [];
        for (const check of task.checks) {
          const module = await loadModule(check.module);
          for (const name of check.names) {
            total++;
            if (typeof module[name] !== "undefined") found++;
            else missing.push(`${check.module}:${name}`);
          }
        }
        return makeResult(task, true, found / total, `${found}/${total} exports present; missing: ${missing.join(", ") || "none"}`);
      }

      case "source-contains": {
        const file = join(root, task.file);
        if (!existsSync(file)) return makeResult(task, true, 0, `source file missing: ${task.file}`);
        const text = readFileSync(file, "utf8");
        const missing = task.required.filter((needle) => !text.includes(needle));
        const present = task.required.length - missing.length;
        return makeResult(
          task,
          true,
          present / task.required.length,
          `${present}/${task.required.length} tokens present; missing: ${missing.join(", ") || "none"}`,
        );
      }

      case "files-exist": {
        const missing = task.files.filter((file) => !existsSync(join(root, file)));
        const present = task.files.length - missing.length;
        return makeResult(task, true, present / task.files.length, `${present}/${task.files.length} files; missing: ${missing.join(", ") || "none"}`);
      }

      case "package-scripts": {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const scripts = pkg.scripts ?? {};
        const missing = task.scripts.filter((name) => typeof scripts[name] !== "string");
        const present = task.scripts.length - missing.length;
        return makeResult(task, true, present / task.scripts.length, `${present}/${task.scripts.length} scripts; missing: ${missing.join(", ") || "none"}`);
      }

      case "artifact-metric": {
        const file = join(root, task.path);
        if (!existsSync(file)) return unmeasured(task, `artifact missing: ${task.path}`);
        const data = JSON.parse(readFileSync(file, "utf8"));
        const value = task.pointer.split(".").reduce((current, key) => (current == null ? undefined : current[key]), data);
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return unmeasured(task, `metric not numeric: ${task.pointer}`);
        }
        const valueScore = score.metricScore(value, task.direction, task.target);
        return makeResult(
          task,
          true,
          valueScore,
          `${task.pointer}=${value} (${task.direction} ${task.target}); artifact ${data.generatedAt ?? "n/a"}`,
        );
      }

      default:
        return unmeasured(task, `unknown task kind: ${task.kind}`);
    }
  }

  async function runPass() {
    const results = [];
    for (const dimension of suite.dimensions) {
      for (const task of dimension.tasks) {
        const result = await runTask(task);
        results.push(result);
        if (!checkMode) console.log(`  ${dimension.id}/${task.id}: ${result.measured ? result.score.toFixed(2) : "skip"}`);
      }
    }
    const dimensions = suite.dimensions.map((dimension) => score.dimensionResult(dimension, results));
    const totals = score.totalScore(dimensions);
    return { results, dimensions, totals };
  }

  const first = await runPass();
  if (checkMode) {
    const second = await runPass();
    const firstScores = JSON.stringify(first.results.map((item) => [item.id, item.score, item.measured]));
    const secondScores = JSON.stringify(second.results.map((item) => [item.id, item.score, item.measured]));
    const deterministic = firstScores === secondScores && first.totals.total === second.totals.total;
    console.log(`Suite hash: ${score.verifySuite(suite) ? "PASS" : "FAIL"} (${suite.sha256.slice(0, 12)}…)`);
    console.log(`Determinism: ${deterministic ? "PASS" : "FAIL"} (two identical passes, ${first.results.length} tasks)`);
    console.log(`Total: ${first.totals.total.toFixed(1)}/100, coverage ${(first.totals.coverage * 100).toFixed(0)}%`);
    process.exit(deterministic ? 0 : 1);
    return;
  }

  const report = {
    suiteId: suite.suiteId,
    suiteSha256: suite.sha256,
    generatedAt: new Date().toISOString(),
    mode: "deterministic-offline",
    total: first.totals.total,
    coverage: first.totals.coverage,
    dimensions: first.dimensions,
    referenceBaselines: suite.referenceBaselines,
    isolationDir,
  };
  const outDir = join(root, "experiments", "review", "scorecard-eval");
  mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.slice(0, 10);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = score.renderScorecardMarkdown(report);
  for (const name of ["latest.json", `scorecard-${stamp}.json`]) writeFileSync(join(outDir, name), json);
  for (const name of ["latest.md", `scorecard-${stamp}.md`]) writeFileSync(join(outDir, name), markdown);

  console.log("");
  console.log(markdown);
  console.log(`Saved: ${join(outDir, "latest.json")}`);
  console.log(`Saved: ${join(outDir, "latest.md")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
