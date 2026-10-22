#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [inputPath, turnsArg, seedsArg = "1000", outArg = "loop-study-report"] = process.argv.slice(2);
if (!inputPath || !turnsArg) {
  console.error("Usage: node scripts/analyze-loop-study.mjs <labeled-turns.json> <turns-per-user> [seeds=1000] [output-prefix=loop-study-report]");
  process.exit(2);
}
const evaluationPath = resolve("dist/evaluation/index.js");
const evaluation = await import(pathToFileURL(evaluationPath).href);
const rows = evaluation.validateLabeledTurns(JSON.parse(readFileSync(inputPath, "utf8")));
const report = evaluation.analyzeLabeledTurns(rows, {
  turnsPerUser: Number(turnsArg),
  seeds: Number(seedsArg),
});
const prefix = resolve(outArg);
mkdirSync(dirname(prefix), { recursive: true });
writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2));
writeFileSync(`${prefix}.md`, evaluation.generateLoopStudyMarkdown(report));
console.log(evaluation.generateLoopStudyMarkdown(report));
console.log(`Saved ${prefix}.json and ${prefix}.md`);
