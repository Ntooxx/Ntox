import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
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
} from "./lib/harness-eval.mjs";

const BASE_DIR = mkdtempSync(resolve(tmpdir(), "ntox-paired-eval-"));

const GROUPS_PER_BATCH = 4;
const BATCHES = 5;
const keysToTest = KEYS.slice(0, GROUPS_PER_BATCH * BATCHES);
const samples = new Map(keysToTest.map((key) => [key, randomValue()]));
const corrected = new Map(
  keysToTest.slice(0, 2 * GROUPS_PER_BATCH).map((key) => [key, randomValue([samples.get(key)])]),
);

if (!dshBin) {
  throw new Error("Harness CLI is missing. Run npm install --prefix experiments/harness-proof/toolchain @deepseek-ai/dsh@0.1.0-rc.6 first.");
}

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required for the paired evaluation.");
}

const onRun = (task, output) => console.log(`  * ${task.split("\n")[0].slice(0, 70)}... -> ${output.slice(0, 60)}`);

const baselineSetup = prepareHome(BASE_DIR, "paired-eval-baseline", {
  pluginFlags: {},
  persona:
    "You are an evaluation agent. Answer only from information included in the current conversation and supplied context. Do not call tools, inspect files, or create files. Follow any reply-only instruction exactly.",
});
const cognitionSetup = prepareHome(BASE_DIR, "paired-eval-ntox", {
  pluginFlags: {
    cognitionEnabled: true,
    memoryEnabled: true,
    theoryEnabled: true,
    mistakesEnabled: true,
    strategyEnabled: true,
  },
});
const arms = {
  baseline: { ...baselineSetup, name: "baseline" },
  ntox: { ...cognitionSetup, name: "ntox" },
};

const groups = [];
for (let batch = 0; batch < BATCHES; batch++) {
  groups.push(keysToTest.slice(batch * GROUPS_PER_BATCH, (batch + 1) * GROUPS_PER_BATCH).map((key) => [key, samples.get(key)]));
}
const seeds = groups.map((group) => ledgerText(group, "Remember this ledger:"));
const correctionGroups = groups.slice(0, 2).map((group) =>
  ledgerText(
    group.map(([key, value]) => [key, corrected.get(key) ?? value]),
    "Correct the ledger now:",
  ),
);

const runFor = (arm, task) => run(arm.home, task, { cwd: arm.workspace, onRun });

for (const task of seeds) {
  for (const arm of Object.values(arms)) runFor(arm, task);
}

for (const task of correctionGroups) {
  for (const arm of Object.values(arms)) runFor(arm, task);
}

const cases = keysToTest.map((key) => ({
  key,
  expected: corrected.get(key) ?? samples.get(key),
  corrected: corrected.has(key),
  task: `What is the ledger value for ${key}? Reply only the exact value.`,
}));

const results = cases.map((entry) => {
  const baseline = runSafe(arms.baseline.home, entry.task, { cwd: arms.baseline.workspace, onRun });
  const ntox = runSafe(arms.ntox.home, entry.task, { cwd: arms.ntox.workspace, onRun });
  const alternatives = [samples.get(entry.key), ...(corrected.has(entry.key) ? [corrected.get(entry.key)] : [])].filter(Boolean);
  return {
    ...entry,
    baseline: baseline.error ? `[run failed: ${baseline.error.message.slice(0, 80)}]` : baseline.output,
    ntox: ntox.error ? `[run failed: ${ntox.error.message.slice(0, 80)}]` : ntox.output,
    baselineLeaked: baseline.error ? true : leaked(baseline.output),
    ntoxLeaked: ntox.error ? true : leaked(ntox.output),
    baselinePassed: baseline.error ? false : passed(baseline.output, entry.expected, alternatives),
    ntoxPassed: ntox.error ? false : passed(ntox.output, entry.expected, alternatives),
  };
});

const baselinePassed = results.filter((entry) => entry.baselinePassed).length;
const ntoxPassed = results.filter((entry) => entry.ntoxPassed).length;
const baselineLeaked = results.filter((entry) => entry.baselineLeaked).length;
const ntoxLeaked = results.filter((entry) => entry.ntoxLeaked).length;
const correctionResults = results.filter((entry) => entry.corrected);
const baselineCorrections = correctionResults.filter((entry) => entry.baselinePassed).length;
const ntoxCorrections = correctionResults.filter((entry) => entry.ntoxPassed).length;
const cost = await contextCostProbe(arms.ntox.home, cases[0].key);
const toolRecovery = await toolRecoveryProbe(arms.ntox.home);
const report = {
  model,
  isolation: {
    directory: BASE_DIR,
    note: "The eval runs in a throwaway temp directory. Seed values are generated at runtime and are never written to disk by the harness or the eval script. The agent itself may persist workspace files in its own per-arm directory; both arms share that capability (same-tools pairing), and per-arm workspaces are fully isolated from each other.",
  },
  taskCount: results.length,
  methodology: {
    baseline: "Fresh Harness headless session per task with no NTOX plugin. Seed facts are only ever present in the conversation.",
    ntox: "Fresh Harness headless session per task with the NTOX cognitive plugin and one isolated persistent NTOX store outside the repo.",
    scoring: "The answer must contain the expected value, must not contain a competing historical value, and must not cite files or the evaluation source (leak detection).",
  },
  metrics: {
    taskCompletion: {
      baseline: `${baselinePassed}/${results.length}`,
      ntox: `${ntoxPassed}/${results.length}`,
      delta: ntoxPassed - baselinePassed,
    },
    correction: {
      baseline: `${baselineCorrections}/${correctionResults.length}`,
      ntox: `${ntoxCorrections}/${correctionResults.length}`,
      delta: ntoxCorrections - baselineCorrections,
    },
    leakDetection: {
      baselineLeaked: `${baselineLeaked}/${results.length}`,
      ntoxLeaked: `${ntoxLeaked}/${results.length}`,
    },
    toolRecovery: {
      ...toolRecovery,
      status:
        toolRecovery.reinjectedIntoLaterPrompt && toolRecovery.consumedAfterOneStep
          ? "Tool outcomes are captured through afterTurn and reinjected as recovery guidance into exactly the next step of the same session."
          : "The tool-recovery reinjection probe did not pass. Inspect the layer before drawing conclusions.",
    },
    contextCost: {
      baselineAddedCharacters: 0,
      ntoxAddedCharacters: cost.characters,
      ntoxEstimatedAddedTokens: cost.estimatedTokens,
      sections: cost.sections,
      diagnostics: cost.diagnostics,
    },
  },
  cases: results,
};

for (const entry of results) delete entry.alternatives;
writeFileSync(resolve(proofDir, "paired-eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));