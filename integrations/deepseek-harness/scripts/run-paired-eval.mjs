import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const integrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(integrationDir, "..", "..");
const proofDir = resolve(workspace, "experiments", "harness-proof");
const evaluationWorkspace = resolve(proofDir, "paired-eval-workspace");
const toolchainDir = resolve(proofDir, "toolchain");
const dshBin = resolve(toolchainDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const adapterUrl = pathToFileURL(resolve(integrationDir, "dist", "index.js")).href;
const model = process.env.NTOX_HARNESS_MODEL ?? "deepseek/deepseek-chat-v3.1";

const groups = [
  [
    ["harbor", "blue-ember"],
    ["cinder", "fox-signal"],
    ["mosaic", "river-echo"],
    ["quartz", "lime-orbit"],
  ],
  [
    ["beacon", "amber-pulse"],
    ["willow", "north-delta"],
    ["tundra", "violet-pine"],
    ["comet", "silver-bay"],
  ],
  [
    ["orbit", "copper-dawn"],
    ["meadow", "jade-crest"],
    ["lantern", "pearl-wind"],
    ["summit", "coral-ridge"],
  ],
  [
    ["fable", "indigo-stone"],
    ["kestrel", "golden-mist"],
    ["grove", "crimson-vale"],
    ["prism", "teal-harbor"],
  ],
  [
    ["cipher", "onyx-wave"],
    ["raven", "mint-flare"],
    ["solstice", "ruby-fjord"],
    ["thistle", "ivory-field"],
  ],
];

const corrections = new Map([
  ["harbor", "navy-ember"],
  ["cinder", "wolf-signal"],
  ["mosaic", "lake-echo"],
  ["quartz", "orange-orbit"],
  ["beacon", "scarlet-pulse"],
  ["willow", "south-delta"],
  ["tundra", "violet-cedar"],
  ["comet", "bronze-bay"],
]);

if (!existsSync(dshBin)) {
  throw new Error(
    `Harness CLI is missing at ${dshBin}. Run npm install --prefix experiments/harness-proof/toolchain @deepseek-ai/dsh@0.1.0-rc.6 first.`,
  );
}

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required for the paired evaluation.");
}

function run(home, task) {
  const result = spawnSync(process.execPath, [dshBin, "--profile", "headless", task], {
    cwd: evaluationWorkspace,
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_HOME: home,
      NTOX_DIR: resolve(home, "ntox"),
    },
    timeout: 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Harness run failed for \"${task}\".\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function prepareHome(name, cognition) {
  const home = resolve(proofDir, name, ".dsh");
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const init = spawnSync(process.execPath, [dshBin, "--profile", "headless", "--help"], {
    cwd: evaluationWorkspace,
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: home, NTOX_DIR: resolve(home, "ntox") },
    timeout: 60000,
  });
  if (init.error) throw init.error;
  if (init.status !== 0) throw new Error(`Harness profile initialization failed.\n${init.stderr || init.stdout}`);
  writeFileSync(
    resolve(home, "settings.yaml"),
    `llm-pi-ai:\n  providers:\n    openrouter:\n      apiKeyEnv: OPENROUTER_API_KEY\n      models:\n        - id: ${model}\n          contextWindow: 163840\n          maxTokens: 256\n`,
  );
  const plugin = cognition
    ? `\n- insert:\n    - id: ntox-cognition\n      name: ${adapterUrl}\n      config:\n        cognitionEnabled: true\n        memoryEnabled: true\n        theoryEnabled: true\n        mistakesEnabled: true\n        strategyEnabled: true\n`
    : "\n";
  writeFileSync(
    resolve(home, "profiles", "headless", "cordis.patch.yml"),
    `- id: system-prompt\n  config:\n    persona: >-\n      You are an evaluation agent. Answer only from information included in the current conversation and supplied context. Do not call tools, inspect files, or create files. Follow any reply-only instruction exactly.\n- id: agent-default-model\n  config:\n    provider: openrouter\n    model: ${model}${plugin}`,
  );
  return home;
}

function ledgerText(entries, prefix) {
  return `${prefix} ${entries.map(([key, value]) => `${key}=${value}`).join("; ")}. Reply only acknowledged.`;
}

function normalize(answer) {
  return answer
    .trim()
    .toLowerCase()
    .replace(/^[`"']|[`"'.]$/g, "");
}

function passed(answer, expected, alternatives) {
  const normalized = normalize(answer);
  return (
    normalized.includes(expected) && alternatives.every((value) => value === expected || !normalized.includes(value))
  );
}

async function contextCost(home, sampleKey) {
  process.env.NTOX_DIR = resolve(home, "ntox");
  const { createCognitiveLayer } = await import("ntox/cognition");
  const layer = createCognitiveLayer();
  const context = await layer.beforeStep({
    sessionId: "paired-eval-cost",
    turnId: "1",
    userMessage: `What is the ledger value for ${sampleKey}? Reply only the exact value.`,
  });
  return {
    characters: context.prompt.length,
    estimatedTokens: Math.ceil(context.prompt.length / 4),
    sections: context.sections.map((section) => section.name),
  };
}

async function toolObserver(home) {
  process.env.NTOX_DIR = resolve(home, "ntox");
  const { createCognitiveLayer } = await import("ntox/cognition");
  const layer = createCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false });
  await layer.afterTool({
    sessionId: "paired-eval-tool",
    turnId: "1",
    toolName: "read",
    success: false,
    error: "ENOENT",
  });
  const result = await layer.afterTurn({
    sessionId: "paired-eval-tool",
    turnId: "1",
    userMessage: "Read the release manifest.",
    assistantResponse: "The read failed; use the fallback manifest.",
  });
  return {
    observed: result.toolOutcomes.length === 1 && result.toolOutcomes[0].error === "ENOENT",
    reinjectedIntoLaterPrompt: false,
  };
}

rmSync(evaluationWorkspace, { recursive: true, force: true });
mkdirSync(evaluationWorkspace, { recursive: true });
const baselineHome = prepareHome("paired-eval-baseline", false);
const cognitionHome = prepareHome("paired-eval-ntox", true);
const seeds = groups.map((group) => ledgerText(group, "Remember this ledger:"));
const correctionGroups = groups.slice(0, 2).map((group) =>
  ledgerText(
    group.map(([key, value]) => [key, corrections.get(key) ?? value]),
    "Correct the ledger now:",
  ),
);

for (const task of seeds) {
  run(baselineHome, task);
  run(cognitionHome, task);
}

for (const task of correctionGroups) {
  run(baselineHome, task);
  run(cognitionHome, task);
}

const cases = groups.flat().map(([key, initial]) => ({
  key,
  expected: corrections.get(key) ?? initial,
  corrected: corrections.has(key),
  task: `What is the ledger value for ${key}? Reply only the exact value.`,
}));

const results = cases.map((entry) => {
  const baseline = run(baselineHome, entry.task);
  const ntox = run(cognitionHome, entry.task);
  const alternatives = [
    ...groups
      .flat()
      .filter(([key]) => key === entry.key)
      .map(([, value]) => value),
    ...(corrections.has(entry.key) ? [corrections.get(entry.key)] : []),
  ];
  return {
    ...entry,
    baseline,
    ntox,
    baselinePassed: passed(baseline, entry.expected, alternatives),
    ntoxPassed: passed(ntox, entry.expected, alternatives),
  };
});

const baselinePassed = results.filter((entry) => entry.baselinePassed).length;
const ntoxPassed = results.filter((entry) => entry.ntoxPassed).length;
const correctionResults = results.filter((entry) => entry.corrected);
const baselineCorrections = correctionResults.filter((entry) => entry.baselinePassed).length;
const ntoxCorrections = correctionResults.filter((entry) => entry.ntoxPassed).length;
const cost = await contextCost(cognitionHome, cases[0].key);
const toolRecovery = await toolObserver(cognitionHome);
const report = {
  model,
  taskCount: results.length,
  methodology: {
    baseline: "Fresh Harness headless session per task with no NTOX plugin.",
    ntox: "Fresh Harness headless session per task with the NTOX cognitive plugin and one isolated persistent NTOX store.",
    scoring: "The answer must contain the expected value and no competing historical value for that key.",
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
    toolRecovery: {
      outcomeObserved: toolRecovery.observed,
      modelVisibleRecoveryEvidence: toolRecovery.reinjectedIntoLaterPrompt,
      status:
        "Tool outcomes are captured through afterTurn, but they are not yet turned into model-visible recovery guidance on later turns.",
    },
    contextCost: {
      baselineAddedCharacters: 0,
      ntoxAddedCharacters: cost.characters,
      ntoxEstimatedAddedTokens: cost.estimatedTokens,
      sections: cost.sections,
    },
  },
  cases: results,
};

writeFileSync(resolve(proofDir, "paired-eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
