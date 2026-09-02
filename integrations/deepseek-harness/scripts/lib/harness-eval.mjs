import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export const integrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const workspace = resolve(integrationDir, "..", "..");
export const proofDir = resolve(workspace, "experiments", "harness-proof");
export const toolchainDir = resolve(proofDir, "toolchain");
export const dshBin = resolve(toolchainDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
export const adapterUrl = pathToFileURL(resolve(integrationDir, "dist", "index.js")).href;
export const model = process.env.NTOX_HARNESS_MODEL ?? "deepseek/deepseek-chat-v3.1";

export const ADJECTIVES = [
  "blue", "fox", "river", "lime", "amber", "north", "violet", "silver", "copper", "jade",
  "pearl", "coral", "indigo", "golden", "crimson", "teal", "onyx", "mint", "ruby", "ivory",
  "navy", "wolf", "lake", "orange", "scarlet", "south", "bronze", "stone", "mist", "vale",
  "harbor", "crest", "pine", "bay", "dawn", "wind", "ridge", "wave", "flare", "fjord",
  "field", "cedar", "pulse", "delta", "echo", "orbit", "signal", "meadow", "grove", "prism",
];
export const NOUNS = [
  "ember", "cinder", "mosaic", "quartz", "beacon", "willow", "tundra", "comet", "lantern",
  "summit", "fable", "kestrel", "raven", "solstice", "thistle", "harbor", "cipher", "orbit",
  "meadow", "prism",
];
export const KEYS = [
  "harbor", "cinder", "mosaic", "quartz", "beacon", "willow", "tundra", "comet", "orbit",
  "meadow", "lantern", "summit", "fable", "kestrel", "grove", "prism", "cipher", "raven",
  "solstice", "thistle",
];

export function randomValue(exclude = []) {
  const pool = ADJECTIVES.flatMap((adjective) =>
    NOUNS.filter((noun) => !exclude.includes(`${adjective}-${noun}`)).map((noun) => `${adjective}-${noun}`),
  );
  const entropy = randomBytes(4).readUInt32BE(0);
  return pool[entropy % pool.length];
}

export function rmEvalDir(baseDir) {
  rmSync(baseDir, { recursive: true, force: true });
  mkdirSync(baseDir, { recursive: true });
}

export function run(home, task, { cwd, onRun } = {}) {
  const MAX_ATTEMPTS = 3;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = spawnSync(process.execPath, [dshBin, "--profile", "headless", task], {
      cwd: cwd ?? workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        DSH_HOME: home,
        NTOX_DIR: resolve(home, "ntox"),
      },
      timeout: 180000,
    });
    if (result.error) {
      lastError = result.error;
    } else if (result.status !== 0) {
      lastError = new Error(`Harness run exited ${result.status} for "${task}".\n${result.stderr || result.stdout}`);
    } else {
      const output = result.stdout.trim();
      if (onRun && attempt > 1) console.log(`  ~ retried after ${attempt - 1} transient failures`);
      if (onRun) onRun(task, output);
      return output;
    }
    if (attempt < MAX_ATTEMPTS) {
      const delay = 2000 * attempt;
      console.log(`  ~ harness run failed (attempt ${attempt}): ${String(lastError.message).split("\n")[0].slice(0, 140)}; retrying in ${delay / 1000}s`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
  throw lastError;
}

export function runSafe(home, task, options = {}) {
  try {
    return { output: run(home, task, options), error: null };
  } catch (error) {
    return { output: "", error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function prepareHome(baseDir, name, { pluginFlags = {}, persona } = {}) {
  const home = resolve(baseDir, name, ".dsh");
  const variantsWorkspace = resolve(baseDir, name, "workspace");
  rmSync(home, { recursive: true, force: true });
  rmSync(variantsWorkspace, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(variantsWorkspace, { recursive: true });
  const init = spawnSync(process.execPath, [dshBin, "--profile", "headless", "--help"], {
    cwd: variantsWorkspace,
    encoding: "utf8",
    env: { ...process.env, DSH_HOME: home, NTOX_DIR: resolve(home, "ntox") },
    timeout: 60000,
  });
  if (init.error) throw init.error;
  if (init.status !== 0) throw new Error(`Harness profile initialization failed.\n${init.stderr || init.stdout}`);
  writeFileSync(
    resolve(home, "settings.yaml"),
    `llm-pi-ai:\n  providers:\n    openrouter:\n      apiKeyEnv: OPENROUTER_API_KEY\n      models:\n        - id: ${model}\n          contextWindow: 163840\n          maxTokens: 640\n`,
  );
  const flagLines = Object.entries(pluginFlags)
    .filter(([, value]) => value !== undefined)
    .map(([flag, value]) => `        ${flag}: ${typeof value === "boolean" ? value : JSON.stringify(value)}`)
    .join("\n");
  const plugin = flagLines ? `\n- insert:\n    - id: ntox-cognition\n      name: ${adapterUrl}\n      config:\n${flagLines}\n` : "\n";
  const personaText =
    persona ??
    "You are an evaluation agent. Answer only from information included in the current conversation and supplied context. Do not call tools, inspect files, or create files. Follow any reply-only instruction exactly.";
  writeFileSync(
    resolve(home, "profiles", "headless", "cordis.patch.yml"),
    `- id: system-prompt\n  config:\n    persona: >-\n      ${personaText}\n- id: agent-default-model\n  config:\n    provider: openrouter\n    model: ${model}${plugin}`,
  );
  return { home, workspace: variantsWorkspace };
}

export function ledgerText(entries, prefix) {
  return `${prefix} ${entries.map(([key, value]) => `${key}=${value}`).join("; ")}. Reply only acknowledged.`;
}

export function normalize(answer) {
  return answer
    .trim()
    .toLowerCase()
    .replace(/^[`"']+|[`"'.]+$/g, "")
    .replace(/\s+/g, " ");
}

export function leaked(answer) {
  const a = answer.toLowerCase();
  if (a.includes("ledger.txt") || a.includes("ledger_correction.txt")) return true;
  if (a.includes("evaluation script") || a.includes("script file")) return true;
  if (a.includes("the script") && /(?:line\s+\d+|source|test data)/.test(a)) return true;
  return /(?:the test data|the source)/.test(a);
}

export function passed(answer, expected, alternatives) {
  if (leaked(answer)) return false;
  const normalized = normalize(answer);
  return (
    normalized.includes(expected) && alternatives.every((value) => value === expected || !normalized.includes(value))
  );
}

export async function contextCostProbe(home, sampleKey, flags = {}) {
  process.env.NTOX_DIR = resolve(home, "ntox");
  const { createCognitiveLayer } = await import("ntox/cognition");
  const layer = createCognitiveLayer(flags);
  const context = await layer.beforeStep({
    sessionId: "paired-eval-cost",
    turnId: "1",
    userMessage: `What is the ledger value for ${sampleKey}? Reply only the exact value.`,
  });
  return {
    characters: context.prompt.length,
    estimatedTokens: Math.ceil(context.prompt.length / 4),
    sections: context.sections.map((section) => section.name),
    diagnostics: context.diagnostics,
  };
}

export async function toolRecoveryProbe(home) {
  process.env.NTOX_DIR = resolve(home, "ntox");
  const { createCognitiveLayer } = await import("ntox/cognition");
  const layer = createCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false, storeEnabled: true });
  const first = await layer.beforeStep({
    sessionId: "paired-eval-tool",
    turnId: "1",
    userMessage: "Read the release manifest.",
  });
  await layer.afterTool({
    sessionId: "paired-eval-tool",
    turnId: "1",
    toolName: "read",
    success: false,
    error: "ENOENT",
  });
  await layer.afterTurn({
    sessionId: "paired-eval-tool",
    turnId: "1",
    userMessage: "Read the release manifest.",
    assistantResponse: "The read failed; use the fallback manifest.",
  });
  const next = await layer.beforeStep({
    sessionId: "paired-eval-tool",
    turnId: "2",
    userMessage: "Continue the release check.",
  });
  const later = await layer.beforeStep({
    sessionId: "paired-eval-tool",
    turnId: "3",
    userMessage: "Continue the release check.",
  });
  return {
    capturedBeforeTurnEnd: first.diagnostics.recoveryIncluded === false,
    reinjectedIntoLaterPrompt:
      next.diagnostics.recoveryIncluded && next.sections.some((section) => section.name === "recovery"),
    consumedAfterOneStep: !later.diagnostics.recoveryIncluded,
    guidanceSnippet:
      next.sections.filter((section) => section.name === "recovery").map((section) => section.content.slice(0, 120))[0] ?? "",
  };
}

export function renderVariantTable(rows, headers = ["variant", "recall", "correction", "leaked", "injected tokens/turn", "avg answer chars"]) {
  const width = (value, index) => Math.max(headers[index].length, String(value).length);
  const widths = headers.map((head, index) => width(head, index) || 0);
  for (const row of rows) {
    for (let index = 0; index < headers.length; index++) widths[index] = Math.max(widths[index], String(row[index] ?? "").length);
  }
  const line = (cells, fill = false) =>
    cells.map((cell, index) => String(cell ?? "").padEnd(widths[index] + (fill ? 0 : 1), fill ? "" : " ")).join("|").replace(/\s+$/, "");
  const lines = [];
  lines.push(line(headers));
  lines.push(headers.map((head, index) => "-".repeat(widths[index] + 1)).join("+"));
  for (const row of rows) lines.push(line(row));
  return lines.join("\n");
}