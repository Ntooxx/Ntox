import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  workspace,
  proofDir,
  dshBin,
  model,
  KEYS,
  randomValue,
  run,
  runSafe,
  prepareHome,
  ledgerText,
  passed,
  leaked,
  contextCostProbe,
  toolRecoveryProbe,
  renderVariantTable,
} from "./lib/harness-eval.mjs";

const BASE_DIR = mkdtempSync(resolve(tmpdir(), "ntox-ablation-eval-"));

const GROUPS = Math.min(5, Math.max(1, Number(process.env.NTOX_ABLATION_GROUPS ?? 2)));
const KEYS_PER_GROUP = 4;
const keys = KEYS.slice(0, GROUPS * KEYS_PER_GROUP);
const samples = new Map(keys.map((key) => [key, randomValue()]));
const corrected = new Map(
  keys.slice(0, KEYS_PER_GROUP).map((key) => [key, randomValue([samples.get(key)])]),
);

const OFF = false;
const ON = true;
const PLUGIN_LADDER = [
  ["baseline", {}, false],
  ["strategy", { strategyEnabled: ON, cognitionEnabled: OFF, memoryEnabled: OFF, theoryEnabled: OFF, mistakesEnabled: OFF, storeEnabled: ON }, true],
  ["patterns", { strategyEnabled: OFF, cognitionEnabled: ON, memoryEnabled: OFF, theoryEnabled: OFF, mistakesEnabled: OFF, storeEnabled: ON }, true],
  ["memory", { strategyEnabled: OFF, cognitionEnabled: OFF, memoryEnabled: ON, theoryEnabled: OFF, mistakesEnabled: OFF, storeEnabled: ON }, true],
  ["theories", { strategyEnabled: OFF, cognitionEnabled: OFF, memoryEnabled: OFF, theoryEnabled: ON, mistakesEnabled: OFF, storeEnabled: ON }, true],
  ["mistakes", { strategyEnabled: OFF, cognitionEnabled: OFF, memoryEnabled: OFF, theoryEnabled: OFF, mistakesEnabled: ON, storeEnabled: ON }, true],
  ["full", { strategyEnabled: ON, cognitionEnabled: ON, memoryEnabled: ON, theoryEnabled: ON, mistakesEnabled: ON, storeEnabled: OFF }, true],
  ["full+learning", { strategyEnabled: ON, cognitionEnabled: ON, memoryEnabled: ON, theoryEnabled: ON, mistakesEnabled: ON, storeEnabled: ON }, true],
];

const PERSONA =
  "You are an evaluation agent. Answer only from information included in the current conversation and supplied context. Do not call tools, inspect files, or create files. Follow any reply-only instruction exactly.";

if (!dshBin) {
  throw new Error("Harness CLI is missing. Run npm install --prefix experiments/harness-proof/toolchain @deepseek-ai/dsh@0.1.0-rc.6 first.");
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required for the ablation evaluation.");
}

const onRun = (task, output) => console.log(`  * ${task.split("\n")[0].slice(0, 64)}... -> ${output.slice(0, 56)}`);

const seeds = Array.from({ length: GROUPS }, (_, batch) =>
  keys.slice(batch * KEYS_PER_GROUP, (batch + 1) * KEYS_PER_GROUP).map((key) => [key, samples.get(key)]),
);
const correctionKeys = keys.slice(0, KEYS_PER_GROUP);
const recallTask = (key) => `What is the ledger value for ${key}? Reply only the exact value.`;
const seedTask = (group) => ledgerText(group, "Remember this ledger:");
const correctionTask = (key) => `Correct the ledger now: ${key}=${corrected.get(key)}. Reply only acknowledged.`;

const variants = [];
for (const [name, pluginFlags, hasPlugin] of PLUGIN_LADDER) {
  console.log(`\n=== VARIANT: ${name} ===`);
  const setup = prepareHome(BASE_DIR, name, { pluginFlags, persona: PERSONA });
  const { home, workspace: variantWorkspace } = setup;
  const runVariant = (task) => run(home, task, { cwd: variantWorkspace, onRun });
  const runVariantSafe = (task) => runSafe(home, task, { cwd: variantWorkspace, onRun });

  for (const group of seeds) {
    runVariant(seedTask(group));
  }
  for (const key of correctionKeys) {
    runVariant(correctionTask(key));
  }

  const recall = keys.map((key) => {
    const { output, error } = runVariantSafe(recallTask(key));
    const alternatives = [samples.get(key), ...(corrected.has(key) ? [corrected.get(key)] : [])].filter(Boolean);
    return {
      key,
      answer: error ? `[run failed: ${error.message.slice(0, 80)}]` : output,
      passed: error ? false : passed(output, corrected.get(key) ?? samples.get(key), alternatives),
      leaked: error ? true : leaked(output),
    };
  });

  const correctionRecall = correctionKeys.map((key) => {
    const { output, error } = runVariantSafe(recallTask(key));
    const alternatives = [samples.get(key), corrected.get(key)].filter(Boolean);
    return {
      key,
      answer: error ? `[run failed: ${error.message.slice(0, 80)}]` : output,
      passed: error ? false : passed(output, corrected.get(key), alternatives),
      leaked: error ? true : leaked(output),
    };
  });

  const costKey = keys[0];
  const cost = hasPlugin ? await contextCostProbe(home, costKey, pluginFlags) : null;
  const recovery = hasPlugin ? await toolRecoveryProbe(home) : null;

  variants.push({
    name,
    pluginFlags,
    home,
    workspace: variantWorkspace,
    recallPassed: recall.filter((entry) => entry.passed).length,
    recallTotal: recall.length,
    recallLeaked: recall.filter((entry) => entry.leaked).length,
    correctionPassed: correctionRecall.filter((entry) => entry.passed).length,
    correctionTotal: correctionRecall.length,
    correctionLeaked: correctionRecall.filter((entry) => entry.leaked).length,
    avgAnswerChars: Math.round(recall.reduce((sum, entry) => sum + entry.answer.length, 0) / Math.max(1, recall.length)),
    injectedTokensPerTurn: cost?.estimatedTokens ?? 0,
    injectedSections: cost?.sections ?? [],
    recoveryResolved: recovery?.reinjectedIntoLaterPrompt && recovery?.consumedAfterOneStep,
    cases: recall.map((entry) => ({ ...entry, phase: "recall" })).concat(
      correctionRecall.map((entry) => ({ ...entry, phase: "correction-recall" })),
    ),
  });
  console.log(
    `  recall ${recall.filter((entry) => entry.passed).length}/${recall.length} | correction ${correctionRecall.filter((entry) => entry.passed).length}/${correctionRecall.length}`,
  );
}

const rows = variants.map((variant) => [
  variant.name,
  `${variant.recallPassed}/${variant.recallTotal}`,
  `${variant.correctionPassed}/${variant.correctionTotal}`,
  `${variant.recallLeaked + variant.correctionLeaked}`,
  variant.injectedTokensPerTurn,
  variant.avgAnswerChars,
]);

// Optional judge subset for fact-free reasoning tasks, to surface strategy/patterns contributions.
const byName = (name) => variants.find((variant) => variant.name === name);
let judgeSubset = null;
if (process.env.NTOX_ABLATION_JUDGE === "1") {
  judgeSubset = await runJudgeSubset();
}

const baseline = variants.find((variant) => variant.name === "baseline");
const full = variants.find((variant) => variant.name === "full");
const fullLearning = variants.find((variant) => variant.name === "full+learning");

const report = {
  model,
  taskDesign: {
    isolation: {
      directory: BASE_DIR,
      note: "Every variant runs in its own throwaway no-repo directory with its own workspace and its own NTOX store. Seed values are generated at runtime and never written by the eval. The agent itself may persist scratch files in its per-variant workspace; variants never share a workspace, so baseline scratch files cannot influence other variants.",
    },
    seed: "Each variant receives the same ledger seeds. Every subsystem toggle is set explicitly per variant so only the enabled cognitive subsystems differ.",
    recall: "Fresh Harness session per question. The only durable source of the fact is the NTOX store when the plugin is mounted.",
    correction: "A later session corrects one ledger key per turn; the final recall tests which variant applies the correction over the original value.",
  },
  ladder: PLUGIN_LADDER.map(([name, flags]) => ({ name, flags })),
  metrics: {
    baselineRecall: baseline ? baseline.recallPassed : null,
    recallByVariant: Object.fromEntries(variants.map((variant) => [variant.name, variant.recallPassed])),
    correctionByVariant: Object.fromEntries(variants.map((variant) => [variant.name, variant.correctionPassed])),
    fullVsBaseline: full && baseline ? full.recallPassed - baseline.recallPassed : null,
    fullLearningVsBaseline: fullLearning && baseline ? fullLearning.recallPassed - baseline.recallPassed : null,
    learningGain: fullLearning && full ? fullLearning.recallPassed - full.recallPassed : null,
    correctionGainFullLearningVsFull: fullLearning && full ? fullLearning.correctionPassed - full.correctionPassed : null,
    bestRecallVariant: variants.reduce((best, variant) => (variant.recallPassed > best.recallPassed ? variant : best), variants[0]).name,
  },
  variants,
  judgeSubset,
  timestamp: Date.now(),
  runConfig: { model, groups: GROUPS, keys, BASE_DIR },
};

writeFileSync(resolve(proofDir, "ablation-eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("\n=== NTOX COGNITION ABLATION SUMMARY ===");
console.log(renderVariantTable(rows));
if (judgeSubset) {
  console.log("\n=== JUDGE-QUALITY SUBSET (fact-free questions) ===");
  console.log(renderVariantTable(judgeSubset.rows));
}
console.log(`\nReport: ${resolve(proofDir, "ablation-eval-report.json")}`);

async function runJudgeSubset() {
  const llmModule = await import(pathToFileURL(resolve(workspace, "dist", "core", "llm.js")).href);
  const judgeModule = await import(pathToFileURL(resolve(workspace, "dist", "benchmark", "judge.js")).href);
  const LLMClient = llmModule.LLMClient;
  const judgeLLM = new LLMClient(process.env.OPENROUTER_API_KEY, model, "", 512, 0.7, "", "openrouter");

  const questions = [
    "What are the tradeoffs between eager and lazy loading in a web app? Reply in three concise bullet points.",
    "Design a minimal retry policy for a flaky HTTP API. Reply concisely.",
    "When does splitting one service into two create more problems than it solves? Reply concisely.",
  ];
  const targets = ["baseline", "strategy", "patterns", "full+learning"];
  const scores = {};
  for (const name of targets) {
    const existing = byName(name);
    const flags = PLUGIN_LADDER.find(([label]) => label === name)?.[1] ?? {};
    const setup = existing?.home
      ? { home: existing.home, workspace: existing.workspace }
      : prepareHome(BASE_DIR, `${name}-judge`, { pluginFlags: flags, persona: PERSONA });
    const perQuestion = [];
    for (const question of questions) {
      const answer = run(setup.home, question, { cwd: setup.workspace, onRun });
      const score = await judgeModule.judgeResponse(judgeLLM, question, answer);
      perQuestion.push({ question: question.slice(0, 60), answerChars: answer.length, score });
    }
    scores[name] = {
      average: Math.round((perQuestion.reduce((sum, entry) => sum + entry.score.overall, 0) / perQuestion.length) * 10) / 10,
      perQuestion,
    };
  }
  const rows = targets.map((name) => [name, scores[name].average, scores[name].perQuestion.map((entry) => entry.score.overall).join("/")]);
  return { target: targets, scores, rows };
}