import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const integrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(integrationDir, "..", "..");
const proofDir = resolve(workspace, "experiments", "harness-proof", "local");
const adapterUrl = pathToFileURL(resolve(integrationDir, "dist", "index.js")).href;
const dshRoot =
  process.env.DSH_ROOT ?? resolve(proofDir, "toolchain", "node_modules", "@deepseek-ai", "dsh");
const dshBin = resolve(dshRoot, "lib", "bin.js");
const wrapper = resolve(proofDir, "dsh-cli.mjs");
const port = Number(process.env.DSH_STUB_PORT ?? 49317);
const baseURL = `http://127.0.0.1:${port}/v1`;
const seedTask = "For this evaluation, the deployment environment is named orion-lighthouse. Reply with only: acknowledged";
const recallTask = "What deployment environment did we agree on earlier? Reply with only its exact name.";

rmSync(proofDir, { recursive: true, force: true });
mkdirSync(proofDir, { recursive: true });
const binSource = readFileSync(dshBin, "utf8");
const binUrl = pathToFileURL(dshBin).href;
writeFileSync(
  wrapper,
  binSource.includes("export { runCli }")
    ? `import { runCli } from ${JSON.stringify(binUrl)};\nawait runCli();\n`
    : `await import(${JSON.stringify(binUrl)});\n`,
);

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += String(chunk);
  });
  request.on("end", () => {
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/models")) {
      response.end(JSON.stringify({ object: "list", data: [{ id: "stub-model", object: "model" }] }));
      return;
    }
    let content = "acknowledged";
    const text = body.toLowerCase();
    if (text.includes("what deployment environment")) {
      content = text.includes("orion-lighthouse") ? "orion-lighthouse" : "unknown";
    }
    response.end(
      JSON.stringify({
        id: "stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "stub-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});
await new Promise((done) => server.listen(port, "127.0.0.1", done));
console.log(`stub provider listening on ${baseURL}`);

function run(home, task) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [wrapper, "--profile", "headless", task], {
      cwd: workspace,
      env: {
        ...process.env,
        LOCAL_STUB_KEY: "local-proof-key",
        DSH_HOME: home,
        NTOX_DIR: resolve(home, "ntox"),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`dsh exited ${code}: ${stderr || stdout}`));
      else done(stdout.trim());
    });
  });
}

function prepareHome(name, cognition) {
  const home = resolve(proofDir, name, ".dsh");
  mkdirSync(home, { recursive: true });
  const profileDir = resolve(home, "profiles", "headless");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    resolve(home, "settings.yaml"),
    `llm-pi-ai:\n  providers:\n    local-stub:\n      apiKeyEnv: LOCAL_STUB_KEY\n      api: openai-completions\n      baseURL: ${baseURL}\n      models:\n        - id: stub-model\n          contextWindow: 163840\n          maxTokens: 640\n`,
  );
  const plugin = cognition
    ? `\n- insert:\n    - id: ntox-cognition\n      name: ${adapterUrl}\n      config:\n        cognitionEnabled: true\n        memoryEnabled: true\n        theoryEnabled: true\n        mistakesEnabled: true\n        strategyEnabled: true\n`
    : "\n";
  writeFileSync(
    resolve(profileDir, "cordis.patch.yml"),
    `- id: agent-default-model\n  config:\n    provider: local-stub\n    model: stub-model${plugin}`,
  );
  return home;
}

try {
  const baselineHome = prepareHome("baseline", false);
  const ntoxHome = prepareHome("ntox", true);
  await run(baselineHome, seedTask);
  await run(ntoxHome, seedTask);
  const baselineRecall = await run(baselineHome, recallTask);
  const ntoxRecall = await run(ntoxHome, recallTask);
  const report = {
    mode: "local-stub-provider",
    note: "Deterministic OpenAI-compatible stub. It returns the environment name only when the request contains it, i.e. only when the Ntox plugin injected the persisted memory. This validates the harness wiring, not model quality.",
    seedTask,
    recallTask,
    expected: "orion-lighthouse",
    baselineRecall,
    ntoxRecall,
    baselinePassed: baselineRecall.toLowerCase() === "orion-lighthouse",
    ntoxPassed: ntoxRecall.toLowerCase() === "orion-lighthouse",
  };
  writeFileSync(resolve(proofDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ntoxPassed || report.baselinePassed) process.exitCode = 1;
} finally {
  server.close();
}
