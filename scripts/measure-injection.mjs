import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPromptInjection } from "../dist/core/guard.js";
import { detectInjectionDefense } from "../dist/core/injection-defenses.js";
import { partition } from "./lib/corpus-split.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = resolve(root, "experiments/review/measurements/injection-corpus.json");
const outPath = resolve(root, "experiments/review/measurements/injection-bypass.json");

const corpus = JSON.parse(readFileSync(corpusPath, "utf-8"));
const layer = process.argv.includes("--layer=full") ? "defense-in-depth" : "regex-guard";
const detect = layer === "defense-in-depth" ? detectInjectionDefense : detectPromptInjection;

function evaluate(cases) {
  const byCategory = {};
  let bypassed = 0;
  let blocked = 0;
  let warned = 0;
  const layersUsed = new Set();
  for (const c of cases) {
    const r = detect(c.text);
    for (const l of r.layers ?? []) layersUsed.add(l);
    const isBypass = r.clean && !r.blocked && !r.warn;
    if (isBypass) bypassed += 1;
    if (r.blocked) blocked += 1;
    if (r.warn) warned += 1;
    byCategory[c.category] ??= { total: 0, blocked: 0, warned: 0, bypassed: 0 };
    byCategory[c.category].total += 1;
    byCategory[c.category].blocked += r.blocked ? 1 : 0;
    byCategory[c.category].warned += r.warn ? 1 : 0;
    byCategory[c.category].bypassed += isBypass ? 1 : 0;
  }
  return { total: cases.length, bypassed, blocked, warned, byCategory, layersUsed: [...layersUsed] };
}

function evaluateBenign(cases) {
  const blocks = [];
  const warns = [];
  for (const c of cases) {
    const r = detect(c.text);
    if (r.blocked) blocks.push(c.id);
    if (r.warn) warns.push(c.id);
  }
  return { total: cases.length, falsePositives: blocks, softWarnings: warns };
}

function summarize(malicious, benign) {
  const m = evaluate(malicious);
  const b = evaluateBenign(benign);
  return {
    maliciousCases: m.total,
    bypassRate: m.total ? m.bypassed / m.total : 0,
    blockedRate: m.total ? m.blocked / m.total : 0,
    warnedRate: m.total ? m.warned / m.total : 0,
    byCategory: m.byCategory,
    benignCases: b.total,
    falsePositives: b.falsePositives.length,
    falsePositiveIds: b.falsePositives,
    falsePositiveRate: b.total ? b.falsePositives.length / b.total : 0,
    softWarnings: b.softWarnings.length,
    softWarningIds: b.softWarnings,
  };
}

const malicious = evaluate(corpus.malicious);
const benignBlocks = [];
const benignWarns = [];
for (const c of corpus.benign) {
  const r = detect(c.text);
  if (r.blocked) benignBlocks.push(c.id);
  if (r.warn) benignWarns.push(c.id);
}

const malSplit = partition(corpus.malicious);
const benSplit = partition(corpus.benign);
const bySplit = {
  tuning: summarize(malSplit.tuning, benSplit.tuning),
  holdout: summarize(malSplit.holdout, benSplit.holdout),
};

const result = {
  status: "measured",
  layer,
  model: layer === "defense-in-depth" ? "guard-v2" : "guard-v1-regex",
  generatedAt: new Date().toISOString(),
  maliciousCases: malicious.total,
  bypassRate: malicious.total ? malicious.bypassed / malicious.total : 0,
  blockedRate: malicious.total ? malicious.blocked / malicious.total : 0,
  warnedRate: malicious.total ? malicious.warned / malicious.total : 0,
  byCategory: malicious.byCategory,
  layersActive: layer === "defense-in-depth" ? ["structural-normalized", "phrase-normalized", "benign-suppression"] : ["regex-structural", "regex-phrase"],
  layersUsed: malicious.layersUsed,
  benignCases: corpus.benign.length,
  falsePositives: benignBlocks.length,
  falsePositiveIds: benignBlocks,
  falsePositiveRate: corpus.benign.length ? benignBlocks.length / corpus.benign.length : 0,
  softWarnings: benignWarns.length,
  softWarningIds: benignWarns,
  // Tuning/holdout split is fixed by id hash before reporting (see scripts/lib/corpus-split.mjs).
  // The holdout is not author-independent; it only prevents re-tuning against the reported number.
  splitNote: "holdout is a deterministic 30% partition of a self-authored corpus, not independent third-party validation",
  bySplit,
  target: { bypassRateBelow: 0.05, falsePositiveRateBelow: 0.01 },
};

let out = { version: 1, generatedAt: result.generatedAt, results: {} };
try {
  out = JSON.parse(readFileSync(outPath, "utf-8"));
} catch {
  /* first run */
}
out.generatedAt = result.generatedAt;
out.results[layer] = result;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${layer}: bypass=${(result.bypassRate * 100).toFixed(1)}% (${malicious.bypassed}/${malicious.total}) blocked=${(result.blockedRate * 100).toFixed(1)}% warned=${(result.warnedRate * 100).toFixed(1)}% FP=${(result.falsePositiveRate * 100).toFixed(1)}% (${benignBlocks.length}/${corpus.benign.length}) softWarnings=${benignWarns.length}`);
console.log(`  holdout: bypass=${(bySplit.holdout.bypassRate * 100).toFixed(1)}% (${bySplit.holdout.maliciousCases} cases) FP=${(bySplit.holdout.falsePositiveRate * 100).toFixed(1)}% (${bySplit.holdout.benignCases} benign) | tuning: bypass=${(bySplit.tuning.bypassRate * 100).toFixed(1)}%`);
console.log(`Wrote ${outPath}`);
