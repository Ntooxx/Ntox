#!/usr/bin/env node
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const distPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
if (!existsSync(distPath)) {
  console.error("dist/index.js not found. Run: npm run build");
  process.exit(1);
}

const RUNS = Number(process.env.BENCH_RUNS || 5);
const BUDGET_MS = Number(process.env.BENCH_STARTUP_BUDGET_MS || 0);

function timeOnce(args) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [distPath, ...args], { stdio: "ignore" });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`ntox exited with code ${code}`));
      resolve(performance.now() - start);
    });
    child.on("error", reject);
  });
}

async function bench(label, args) {
  await timeOnce(args);
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(await timeOnce(args));
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];
  console.log(`${label.padEnd(24)} median ${median.toFixed(0)}ms  (min ${min.toFixed(0)}ms, max ${max.toFixed(0)}ms)`);
  return median;
}

function timeImportProcess(moduleUrl) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const code = `await import(${JSON.stringify(moduleUrl)})`;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", code], { stdio: "ignore" });
    child.on("exit", (code2) => {
      if (code2 !== 0) return reject(new Error(`import probe exited with code ${code2}`));
      resolve(performance.now() - start);
    });
    child.on("error", reject);
  });
}

const EMPTY_MODULE = pathToFileURL(fileURLToPath(new URL("./bench-empty-module.mjs", import.meta.url))).href;

async function benchImport(label, modulePath) {
  const moduleUrl = pathToFileURL(modulePath).href;
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(await timeImportProcess(moduleUrl));
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const emptySamples = [];
  for (let i = 0; i < RUNS; i++) emptySamples.push(await timeImportProcess(EMPTY_MODULE));
  emptySamples.sort((a, b) => a - b);
  const baseline = emptySamples[Math.floor(emptySamples.length / 2)];
  console.log(
    `${label.padEnd(24)} median ${median.toFixed(0)}ms  graph cost ~${(median - baseline).toFixed(0)}ms`,
  );
  return median - baseline;
}

const cold = await bench("cold start (--version)", ["--version"]);
const replLoad = await benchImport("repl module load", fileURLToPath(new URL("../dist/cli/repl.js", import.meta.url)));
const agentLoad = await benchImport("agent module load", fileURLToPath(new URL("../dist/core/agent.js", import.meta.url)));

if (BUDGET_MS > 0 && cold > BUDGET_MS) {
  console.error(`\nFAIL: cold start ${cold.toFixed(0)}ms exceeds budget ${BUDGET_MS}ms`);
  process.exit(1);
}
console.log(`\nOK: cold start ${cold.toFixed(0)}ms, repl graph ${replLoad.toFixed(0)}ms over ${RUNS} runs`);
