import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  workspace,
  proofDir,
  dshBin,
  model,
  run,
  runSafe,
  prepareHome,
  renderVariantTable,
} from "./lib/harness-eval.mjs";

const BASE_DIR = mkdtempSync(resolve(tmpdir(), "ntox-ablation-judge-"));

const OFF = false;
const ON = true;
const TARGETS = [
  ["baseline", {}],
  ["strategy", { strategyEnabled: ON, cognitionEnabled: OFF, memoryEnabled: OFF, theoryEnabled: OFF, mistakesEnabled: OFF, storeEnabled: ON }],
  ["patterns", { strategyEnabled: OFF, cognitionEnabled: ON, memoryEnabled: OFF, theoryEnabled: OFF, mistakesEnabled: OFF, storeEnabled: ON }],
  ["full+learning", { strategyEnabled: ON, cognitionEnabled: ON, memoryEnabled: ON, theoryEnabled: ON, mistakesEnabled: ON, storeEnabled: ON }],
];

const QUESTIONS = [
  "What are the tradeoffs between eager and lazy loading in a web app? Reply in three concise bullet points.",
  "Design a minimal retry policy for a flaky HTTP API. Reply concisely.",
  "When does splitting one service into two create more problems than it solves? Reply concisely.",
];

const PERSONA =
  "You are an evaluation agent. Answer only from information included in the current conversation and supplied context. Do not use tools or files. Answer the question directly and concisely.";

if (!dshBin) {
  throw new Error("Harness CLI is missing. Run npm install --prefix experiments/harness-proof/toolchain @deepseek-ai/dsh@0.1.0-rc.6 first.");
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required for the judge subset.");
}

const llmModule = await import(pathToFileURL(resolve(workspace, "dist", "core", "llm.js")).href);
const judgeModule = await import(pathToFileURL(resolve(workspace, "dist", "benchmark", "judge.js")).href);
const judgeLLM = new llmModule.LLMClient(process.env.OPENROUTER_API_KEY, model, "", 512, 0.7, "", "openrouter");

const onRun = (task, output) => console.log(`  * ${task.split("\n")[0].slice(0, 64)}... -> ${output.slice(0, 56)}`);

const scores = {};
for (const [name, flags] of TARGETS) {
  console.log(`\n=== JUDGE TARGET: ${name} ===`);
  const { home, workspace: variantWorkspace } = prepareHome(BASE_DIR, name, { pluginFlags: flags, persona: PERSONA });
  const runVariantSafe = (task) => runSafe(home, task, { cwd: variantWorkspace, onRun });
  const perQuestion = [];
  for (const question of QUESTIONS) {
    const { output, error } = runVariantSafe(question);
    if (error) {
      perQuestion.push({ question: question.slice(0, 60), answerChars: 0, error: error.message.slice(0, 120), score: null });
      continue;
    }
    const score = await judgeModule.judgeResponse(judgeLLM, question, output);
    perQuestion.push({ question: question.slice(0, 60), answerChars: output.length, score });
  }
  const rated = perQuestion.filter((entry) => entry.score);
  scores[name] = {
    average: Math.round((rated.reduce((sum, entry) => sum + entry.score.overall, 0) / Math.max(1, rated.length)) * 10) / 10,
    perQuestion,
  };
}

const rows = TARGETS.map(([name]) => [
  name,
  scores[name].average,
  scores[name].perQuestion.map((entry) => (entry.score ? entry.score.overall : "err")).join("/"),
  scores[name].perQuestion.reduce((sum, entry) => sum + entry.answerChars, 0),
]);

const report = {
  model,
  taskDesign: {
    note: "Fact-free reasoning questions scored by an LLM judge (1-10 accuracy/depth/completeness). No stored facts are involved, so this isolates strategy/pattern/prompt-composition effects from memory.",
    questions: QUESTIONS.length,
  },
  targets: TARGETS.map(([name, flags]) => ({ name, flags })),
  scores,
  timestamp: Date.now(),
};

writeFileSync(resolve(proofDir, "ablation-judge-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("\n=== JUDGE-QUALITY SUBSET (fact-free questions) ===");
console.log(renderVariantTable(rows, ["target", "avg score", "per-question", "total answer chars"]));
console.log(`\nReport: ${resolve(proofDir, "ablation-judge-report.json")}`);
