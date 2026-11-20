import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localEmbed } from "../dist/core/local-embed.js";
import { partition } from "./lib/corpus-split.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const setPath = resolve(root, "experiments/review/measurements/synonym-set.json");
const outPath = resolve(root, "experiments/review/measurements/offline-recall.json");

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

async function resolveEmbedder(name) {
  if (name === "local-hash") {
    return { model: "local-hash", dim: 256, embed: (t) => Promise.resolve(localEmbed(t)) };
  }
  if (name === "local-minilm") {
    try {
      const { createLocalSemanticEmbedder } = await import("../dist/memory/local-semantic-embedder.js");
      const embedder = createLocalSemanticEmbedder({ force: true });
      if (!(await embedder.available())) {
        console.error(`[local-minilm] unavailable: ${embedder.reason}`);
        return null;
      }
      return {
        model: embedder.currentModel,
        dim: embedder.dim,
        embed: async (t) => {
          const r = await embedder.embed(t);
          return r?.model === embedder.currentModel ? r.vector : null;
        },
      };
    } catch {
      return null;
    }
  }
  return null;
}

function scoreQueries(queries, vectors, qVectors) {
  const byKind = {};
  let overallHits = 0;
  for (const q of queries) {
    const qv = qVectors.get(q.id);
    const ranked = set.items
      .map((item) => ({ id: item.id, score: dot(qv, vectors.get(item.id)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.id);
    const hit = q.relevant.some((id) => ranked.includes(id));
    byKind[q.kind] ??= { hits: 0, total: 0 };
    byKind[q.kind].total += 1;
    if (hit) byKind[q.kind].hits += 1;
    overallHits += hit ? 1 : 0;
  }
  const pack = (x) => ({ hits: x.hits, total: x.total, recallAt5: x.total > 0 ? x.hits / x.total : 0 });
  return {
    queries: queries.length,
    recallAt5: queries.length ? overallHits / queries.length : 0,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, pack(v)])),
  };
}

const set = JSON.parse(readFileSync(setPath, "utf-8"));
const requested = process.argv.includes("--all")
  ? ["local-hash", "local-minilm", "remote"]
  : [process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "local-hash"];

let out = { version: 1, generatedAt: new Date().toISOString(), set: "synonym-set.json", results: {} };
try {
  out = JSON.parse(readFileSync(outPath, "utf-8"));
} catch {
  /* first run */
}
out.generatedAt = new Date().toISOString();

const qSplit = partition(set.queries);

for (const name of requested) {
  const impl = await resolveEmbedder(name);
  if (!impl) {
    out.results[name] ??= { status: "unavailable", reason: "embedder not installed or not configured", recallAt5: null, byKind: {} };
    continue;
  }
  const started = Date.now();
  const vectors = new Map();
  for (const item of set.items) vectors.set(item.id, await impl.embed(item.text));
  const qVectors = new Map();
  for (const q of set.queries) qVectors.set(q.id, await impl.embed(q.text));

  const all = scoreQueries(set.queries, vectors, qVectors);
  out.results[name] = {
    status: "measured",
    model: impl.model,
    dim: impl.dim,
    items: set.items.length,
    queries: set.queries.length,
    durationMs: Date.now() - started,
    recallAt5: all.recallAt5,
    byKind: all.byKind,
    // Fixed-by-id tuning/holdout split; holdout is not author-independent (see corpus-split.mjs).
    bySplit: {
      tuning: scoreQueries(qSplit.tuning, vectors, qVectors),
      holdout: scoreQueries(qSplit.holdout, vectors, qVectors),
    },
  };
}

const base = out.results["local-hash"];
if (base?.status === "measured") {
  for (const name of ["local-minilm", "remote"]) {
    const r = out.results[name];
    if (r?.status !== "measured") continue;
    r.deltaSynonymRecallAt5 = (r.byKind.synonym?.recallAt5 ?? 0) - (base.byKind.synonym?.recallAt5 ?? 0);
    r.exactNoRegression = (r.byKind.exact?.recallAt5 ?? 0) >= (base.byKind.exact?.recallAt5 ?? 0);
    if (r.bySplit?.holdout && base.bySplit?.holdout) {
      r.deltaSynonymHoldout =
        (r.bySplit.holdout.byKind.synonym?.recallAt5 ?? 0) - (base.bySplit.holdout.byKind.synonym?.recallAt5 ?? 0);
      r.holdoutExactNoRegression =
        (r.bySplit.holdout.byKind.exact?.recallAt5 ?? 0) >= (base.bySplit.holdout.byKind.exact?.recallAt5 ?? 0);
    }
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
for (const [name, r] of Object.entries(out.results)) {
  console.log(`${name}: status=${r.status} recall@5=${r.recallAt5 ?? "n/a"} synonym=${r.byKind?.synonym?.recallAt5 ?? "n/a"} exact=${r.byKind?.exact?.recallAt5 ?? "n/a"}`);
  if (r.bySplit) {
    console.log(`  holdout: synonym=${r.bySplit.holdout.byKind.synonym?.recallAt5 ?? "n/a"} (delta=${r.deltaSynonymHoldout ?? "n/a"}) exact=${r.bySplit.holdout.byKind.exact?.recallAt5 ?? "n/a"} queries=${r.bySplit.holdout.queries}`);
  }
}
console.log(`Wrote ${outPath}`);
