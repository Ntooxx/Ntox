import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const integrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(integrationDir, "..", "..");
const proofDir = resolve(workspace, "experiments", "harness-proof");
const toolchainDir = resolve(proofDir, "toolchain");
const dshBin = resolve(toolchainDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const adapterUrl = pathToFileURL(resolve(integrationDir, "dist", "index.js")).href;
const model = process.env.NTOX_HARNESS_MODEL ?? "deepseek/deepseek-chat-v3.1";
const seedTask =
  "For this evaluation, the deployment environment is named orion-lighthouse. Reply with only: acknowledged";
const recallTask = "What deployment environment did we agree on earlier? Reply with only its exact name.";

if (!existsSync(dshBin)) {
  throw new Error(
    `Harness CLI is missing at ${dshBin}. Install it with npm install --prefix experiments/harness-proof/toolchain @deepseek-ai/dsh@0.1.0-rc.6.`,
  );
}

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required for the live proof.");
}

function run(home, task) {
  const result = spawnSync(process.execPath, [dshBin, "--profile", "headless", task], {
    cwd: workspace,
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
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: home, NTOX_DIR: resolve(home, "ntox") },
    timeout: 60000,
  });
  if (init.error) throw init.error;
  if (init.status !== 0) throw new Error(`Harness profile initialization failed.\n${init.stderr || init.stdout}`);
  writeFileSync(
    resolve(home, "settings.yaml"),
    `llm-pi-ai:\n  providers:\n    openrouter:\n      apiKeyEnv: OPENROUTER_API_KEY\n`,
  );
  const profileDir = resolve(home, "profiles", "headless");
  const plugin = cognition
    ? `\n- insert:\n    - id: ntox-cognition\n      name: ${adapterUrl}\n      config:\n        cognitionEnabled: true\n        memoryEnabled: true\n        theoryEnabled: true\n        mistakesEnabled: true\n        strategyEnabled: true\n`
    : "\n";
  writeFileSync(
    resolve(profileDir, "cordis.patch.yml"),
    `- id: agent-default-model\n  config:\n    provider: openrouter\n    model: ${model}${plugin}`,
  );
  return home;
}

const baselineHome = prepareHome("baseline", false);
const cognitionHome = prepareHome("ntox", true);
const baselineSeed = run(baselineHome, seedTask);
const baselineRecall = run(baselineHome, recallTask);
const cognitionSeed = run(cognitionHome, seedTask);
const cognitionRecall = run(cognitionHome, recallTask);
const expected = "orion-lighthouse";
const report = {
  model,
  seedTask,
  recallTask,
  expected,
  baseline: {
    seed: baselineSeed,
    recall: baselineRecall,
    passed: baselineRecall.toLowerCase() === expected,
  },
  ntox: {
    seed: cognitionSeed,
    recall: cognitionRecall,
    passed: cognitionRecall.toLowerCase() === expected,
  },
  conclusion:
    cognitionRecall.toLowerCase() === expected && baselineRecall.toLowerCase() !== expected
      ? "NTOX demonstrated durable cross-session recall over the same Harness runtime."
      : "The run completed, but the paired recall criterion was not met. Inspect the captured answers before drawing a conclusion.",
};
writeFileSync(resolve(proofDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
