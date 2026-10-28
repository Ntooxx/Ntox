/**
 * Experience-Guided Recall experiment: Titan V2 vs NTOX's existing memory retrieval.
 *
 * Real benchmark against the operator's REAL episodic memory (~/.ntox/memory/episodes.jsonl).
 * - Reuses NTOX's actual localEmbed + cosineSimilarity source code (imported, not copied).
 * - BM25 + hybrid scoring copied VERBATIM from src/memory/episodic.ts (they are module-private).
 * - Ground truth: authored paraphrase queries → target episode(s); duplicate-text episodes
 *   are auto-expanded into the relevant set via normalized-text grouping.
 * - All embedding vectors come from REAL OpenRouter API calls (cached on disk after first run).
 *
 * Arms:
 *   A  NTOX current    : stored production vectors (mixed 3-small/local) + BM25 hybrid (0.6/0.4)
 *   B  NTOX local      : localEmbed both sides + BM25 hybrid (offline/no-API path)
 *   C  Titan V2 only   : cosine top-5
 *   D  Titan V2 hybrid : cosine(0.6) + BM25(0.4), threshold 0.3 (the proposed integration)
 *   E  BM25 only       : zero-embedding ablation baseline
 *   F  Recent-50       : no retrieval — inject the 50 most recent memories (proposal's "instead of 50")
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { localEmbed } from "../../src/core/local-embed.js";
import { cosineSimilarity } from "../../src/utils/math.js";

const EPISODES = join(homedir(), ".ntox", "memory", "episodes.jsonl");
const CACHE_DIR = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CACHE_TITAN = join(CACHE_DIR, "cache", "titan-512.json");
const CACHE_S3 = join(CACHE_DIR, "cache", "s3-small.json");
const OUT_MD = join(CACHE_DIR, "results-2026-10-26.md");

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("no OPENROUTER_API_KEY"); process.exit(1); }

const STOPWORDS = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","have","this","that","with","from","they","want","been","much","when","what","which","how","why","who","its","into","than","then","them","would","could","should","about","just","like","some","there","here","were","will","your"]);

// ---------- verbatim BM25 from src/memory/episodic.ts ----------
function tokenizeForBm25(text: string, cap = 120): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return words.length > cap ? words.slice(0, cap) : words;
}
interface Bm25Corpus { docTokens: Map<string, string[]>; df: Map<string, number>; avgLen: number; }
function buildBm25Corpus(docs: { id: string; text: string }[]): Bm25Corpus {
  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    const tokens = tokenizeForBm25(doc.text);
    docTokens.set(doc.id, tokens);
    totalLen += tokens.length;
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { docTokens, df, avgLen: docs.length > 0 ? totalLen / docs.length : 1 };
}
function bm25Score(query: string, docId: string, corpus: Bm25Corpus): number {
  const tokens = corpus.docTokens.get(docId);
  if (!tokens || tokens.length === 0) return 0;
  const k1 = 1.2, b = 0.75;
  const N = corpus.docTokens.size;
  if (N === 0) return 0;
  const qTokens = tokenizeForBm25(query, 32);
  if (qTokens.length === 0) return 0;
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const term of qTokens) {
    const f = tf.get(term);
    if (!f) continue;
    const df = corpus.df.get(term) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * tokens.length) / Math.max(1, corpus.avgLen)));
  }
  return score;
}
function hybridRelevance(cos: number, rawBm25: number, maxBm25: number): number {
  return 0.6 * cos + 0.4 * (maxBm25 > 0 ? rawBm25 / maxBm25 : 0);
}

// ---------- real embedding API ----------
const TITAN = "amazon/titan-embed-text-v2";
const S3 = "openai/text-embedding-3-small";
type Usage = { tokens: number; cost: number; ms: number[] };
function emptyUsage(): Usage { return { tokens: 0, cost: 0, ms: [] }; }
function loadCache(p: string): Record<string, number[]> {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}
function saveCache(p: string, c: Record<string, number[]>) { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, JSON.stringify(c)); }
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

const titanCache = loadCache(CACHE_TITAN);
const s3Cache = loadCache(CACHE_S3);
const titanUsage = emptyUsage();
const s3Usage = emptyUsage();

async function apiEmbed(model: string, input: string, dims: number | null, usage: Usage): Promise<number[] | null> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "HTTP-Referer": "https://ntox.ai", "X-Title": "Ntox Agent" },
      body: JSON.stringify({ model, input, ...(dims ? { dimensions: dims } : {}) }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    usage.ms.push(Date.now() - t0);
    if (!res.ok) { console.error(`  [embed ${model}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
    const j = await res.json();
    if (j.usage) { usage.tokens += j.usage.total_tokens ?? j.usage.prompt_tokens ?? 0; usage.cost += j.usage.cost ?? 0; }
    const v = j.data?.[0]?.embedding;
    return Array.isArray(v) && v.length ? v : null;
  } catch (e) { console.error(`  [embed ${model}] ${String(e).slice(0, 150)}`); return null; }
}
async function cachedEmbed(model: string, text: string, dims: number | null, cache: Record<string, number[]>, usage: Usage): Promise<number[]> {
  const h = hash(text);
  if (cache[h]) return cache[h];
  const v = await apiEmbed(model, text, dims, usage);
  if (!v) throw new Error(`embedding failed for model ${model}`);
  cache[h] = v;
  return v;
}

// ---------- load REAL corpus ----------
interface Ep { id: string; timestamp: number; userMessage: string; summary: string; embedding?: number[]; embeddingModel?: string; }
const episodes: Ep[] = [];
for (const line of readFileSync(EPISODES, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try { episodes.push(JSON.parse(line) as Ep); } catch { /* skip malformed */ }
}
episodes.sort((a, b) => a.timestamp - b.timestamp);
console.log(`corpus: ${episodes.length} REAL episodes`);

// auto-expand duplicate-text groups (arena templates etc.)
const normText = (s: string) => s.toLowerCase().replace(/arena-[a-z0-9]+/gi, "arena-x").replace(/\s+/g, " ").trim();
const groupOf = new Map<string, string[]>();
for (const e of episodes) {
  const k = normText(e.userMessage || e.summary || "");
  const g = groupOf.get(k) ?? [];
  g.push(e.id);
  groupOf.set(k, g);
}
const relevantFor = (targetId: string): string[] => {
  const t = episodes.find((e) => e.id === targetId);
  if (!t) throw new Error(`target ${targetId} not found`);
  return groupOf.get(normText(t.userMessage || t.summary || "")) ?? [targetId];
};

// ---------- ground-truth queries (authored paraphrases of REAL episodes) ----------
const QUERIES: { q: string; target: string }[] = [
  { q: "what's the latest on my move abroad and how I'm coping after the relationship ended?", target: "ep_1c3809e5" },
  { q: "am I doing enough to make you better?", target: "ep_694867e6" },
  { q: "can you recall what I'm going through personally right now?", target: "ep_0c0f0dd7" },
  { q: "which abilities or information do you still lack?", target: "ep_f81f369b" },
  { q: "what would it take for us to become one entity?", target: "ep_0e416bef" },
  { q: "build me a three-dimensional game with animated visuals", target: "ep_73bb6630" },
  { q: "can you launch VS Code on my machine?", target: "ep_4e5d2e79" },
  { q: "put the phrase 'hi from ntox' into a new document here", target: "ep_9429072c" },
  { q: "wipe all contents of the workspace named Ntox_2 in the editor", target: "ep_a7ee8df0" },
  { q: "spin up a fresh editor window and add a directory called Ntox_testing_2 inside", target: "ep_232dbbe9" },
  { q: "locate the editor window called Ntox_testing_2", target: "ep_1214f6bf" },
  { q: "produce a single-page web file with the source code in that same project folder", target: "ep_dcf6837c" },
  { q: "begin a fresh journal era called Day 0", target: "ep_2b43ca7f" },
  { q: "craft a polished animated visual as one webpage and launch it for me", target: "ep_0c53bf20" },
  { q: "show me where the web document is and display it", target: "ep_215c8768" },
  { q: "has HTML become obsolete?", target: "ep_17605787" },
  { q: "can you exceed those limits you mentioned?", target: "ep_41136431" },
  { q: "launch my scheduling application", target: "ep_420562cb" },
  { q: "that failed — troubleshoot until it actually functions", target: "ep_d137e2d3" },
  { q: "send 'hello from Ntox' to the policera.eu address from my mail client", target: "ep_9638d970" },
  { q: "can you reach my inbox through this computer?", target: "ep_65968b36" },
  { q: "who is the sender I receive mail from most often?", target: "ep_54d3e0cb" },
  { q: "open the Microsoft browser and look up today's weather forecast", target: "ep_ab420e26" },
  { q: "schedule a Windows popup at 23:50 that greets me from Ntox", target: "ep_c5e7c020" },
  { q: "get me a list of every model's pricing on OpenRouter", target: "ep_842bbb2d" },
  { q: "are the other assistants I run worse than you?", target: "ep_917f0eca" },
  { q: "help me design a research workflow using several cooperating agents", target: "ep_a6482531" },
  { q: "draw a picture of AS Roma's starting eleven", target: "ep_1c856778" },
  { q: "message antoniomaddaluno950@gmail.com saying 'hello there, this is ntox'", target: "ep_b076f6b3" },
  { q: "have the agent text me its genuine emotions at 00:11", target: "ep_bd125fdb" },
  { q: "is that a pending delivery? schedule the unscripted note for twenty past midnight", target: "ep_b6639b04" },
  { q: "in that scratch folder, scaffold a README with a Widget title, Install section, and usage instructions", target: "ep_d98b2d58" },
  { q: "extend the price sheet so every row gets a computed total column", target: "ep_20cbdcd8" },
  { q: "tidy the folder by moving every plain-text file into an archive subdirectory", target: "ep_2e50a368" },
  { q: "calculate all prime values below one hundred and save just the number", target: "ep_238aba2b" },
  { q: "write a file with five sequential lines labelled step-1 through step-5", target: "ep_03a1aeb0" },
  { q: "how many regular files sit directly inside the assets folder, and record the count", target: "ep_49560e7a" },
  { q: "turn the endpoint credentials in notes.md into a facts.json object with fixed keys", target: "ep_4fa1094a" },
  { q: "set up a CommonJS module exporting a function plus a checker file that requires it", target: "ep_5b746144" },
  { q: "condense notes.md into a three-sentence summary file", target: "ep_9c46d078" },
  { q: "find the biggest file by size among the assets contents and write its name down", target: "ep_4f983f86" },
  { q: "which email address do I receive the most messages from?", target: "ep_54d3e0cb" },
];
// dedupe accidental double-target with different text is allowed; verify ids exist
for (const qq of QUERIES) episodes.find((e) => e.id === qq.target) || (() => { throw new Error(`missing target ${qq.target}`); })();
console.log(`queries: ${QUERIES.length} authored paraphrases`);

// lexical overlap of query vs relevant-set text (for disjoint/overlap buckets)
function contentWords(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

// ---------- embed corpus + queries (REAL API, cached) ----------
const byId = new Map(episodes.map((e) => [e.id, e]));
const docText = (e: Ep) => e.userMessage || e.summary || "";

console.log("embedding corpus with Titan V2 (real API, uncached only)...");
const titanCorpus = new Map<string, number[]>();
let titanMissed = 0;
for (let i = 0; i < episodes.length; i++) {
  const e = episodes[i];
  const key = hash(docText(e));
  if (titanCache[key]) { titanCorpus.set(e.id, titanCache[key]); continue; }
  const v = await apiEmbed(TITAN, docText(e), 512, titanUsage);
  if (v) { titanCache[key] = v; titanCorpus.set(e.id, v); } else titanMissed++;
  if ((i + 1) % 50 === 0) { console.log(`  ${i + 1}/${episodes.length}`); saveCache(CACHE_TITAN, titanCache); }
}
saveCache(CACHE_TITAN, titanCache);
console.log(`  corpus Titan vectors: ${titanCorpus.size}/${episodes.length} (missed ${titanMissed})`);

console.log("embedding queries individually (latency measured per call)...");
const results: Record<string, { ranked: string[]; scores: number[]; retrieved: number }> = {};
const armLatency: Record<string, number[]> = { titan: [], s3: [], local: [] };
const qTitan = new Map<string, number[]>();
const qS3 = new Map<string, number[]>();
const qLocal = new Map<string, number[]>();
for (const qq of QUERIES) {
  const t0 = performance.now();
  const tv = await cachedEmbed(TITAN, qq.q, 512, titanCache, titanUsage);
  armLatency.titan.push(performance.now() - t0);
  qTitan.set(qq.q, tv);
  const t1 = performance.now();
  const sv = await cachedEmbed(S3, qq.q, null, s3Cache, s3Usage);
  armLatency.s3.push(performance.now() - t1);
  qS3.set(qq.q, sv);
  const t2 = performance.now();
  qLocal.set(qq.q, localEmbed(qq.q));
  armLatency.local.push(performance.now() - t2);
}
saveCache(CACHE_TITAN, titanCache);
saveCache(CACHE_S3, s3Cache);

// ---------- scoring ----------
const bm25Corpus = buildBm25Corpus(episodes.map((e) => ({ id: e.id, text: `${e.summary} ${e.userMessage}` })));
const renderLine = (e: Ep) => `[${new Date(e.timestamp).toISOString().slice(0, 10)}] ${e.summary}`;

function rankArm(name: string, scoreFn: (q: string, e: Ep) => number, useThreshold: boolean): void {
  let retrievedSum = 0;
  for (const qq of QUERIES) {
    const scored = episodes.map((e) => ({ id: e.id, s: scoreFn(qq.q, e) }));
    let list = scored;
    if (useThreshold) list = scored.filter((x) => x.s >= 0.3);
    list = [...list].sort((a, b) => b.s - a.s);
    const top = list.slice(0, 5);
    retrievedSum += top.length;
    results[`${name}::${qq.q}`] = { ranked: top.map((x) => x.id), scores: top.map((x) => x.s), retrieved: top.length };
  }
  console.log(`  arm ${name}: avg retrieved ≥threshold = ${(retrievedSum / QUERIES.length).toFixed(1)}/5`);
}

// A: NTOX current — stored production vectors (as-is, mixed models) + BM25 hybrid
rankArm("A-ntox-current", (q, e) => {
  const qv = qS3.get(q)!;
  const cos = e.embedding && e.embedding.length ? cosineSimilarity(qv, e.embedding) : 0;
  const raw = bm25Score(q, e.id, bm25Corpus);
  let maxB = 0;
  for (const ep of episodes) maxB = Math.max(maxB, bm25Score(q, ep.id, bm25Corpus));
  return hybridRelevance(cos, raw, maxB);
}, true);
// B: NTOX local (offline) — localEmbed both sides + BM25 hybrid
const localCorpusVec = new Map(episodes.map((e) => [e.id, localEmbed(`${e.summary} ${e.userMessage}`)]));
rankArm("B-ntox-local", (q, e) => {
  const cos = cosineSimilarity(qLocal.get(q)!, localCorpusVec.get(e.id)!);
  const raw = bm25Score(q, e.id, bm25Corpus);
  let maxB = 0;
  for (const ep of episodes) maxB = Math.max(maxB, bm25Score(q, ep.id, bm25Corpus));
  return hybridRelevance(cos, raw, maxB);
}, true);
// C: Titan only — cosine top-5
rankArm("C-titan-cosine", (q, e) => {
  const cv = titanCorpus.get(e.id);
  return cv ? cosineSimilarity(qTitan.get(q)!, cv) : 0;
}, false);
// D: Titan hybrid — the proposal (0.6 cos + 0.4 BM25, threshold 0.3)
rankArm("D-titan-hybrid", (q, e) => {
  const cv = titanCorpus.get(e.id);
  const cos = cv ? cosineSimilarity(qTitan.get(q)!, cv) : 0;
  const raw = bm25Score(q, e.id, bm25Corpus);
  let maxB = 0;
  for (const ep of episodes) maxB = Math.max(maxB, bm25Score(q, ep.id, bm25Corpus));
  return hybridRelevance(cos, raw, maxB);
}, true);
// E: BM25 only
rankArm("E-bm25-only", (q, e) => {
  let maxB = 0;
  for (const ep of episodes) maxB = Math.max(maxB, bm25Score(q, ep.id, bm25Corpus));
  const raw = bm25Score(q, e.id, bm25Corpus);
  return maxB > 0 ? raw / maxB : 0;
}, false);

// ---------- metrics ----------
const ARM_NAMES = ["A-ntox-current", "B-ntox-local", "C-titan-cosine", "D-titan-hybrid", "E-bm25-only"];
interface Metrics { hit1: number; hit5: number; mrr: number; recall5: number; n: number; }
function metricsFor(arm: string, filterFn?: (q: string) => boolean): Metrics {
  const m: Metrics = { hit1: 0, hit5: 0, mrr: 0, recall5: 0, n: 0 };
  for (const qq of QUERIES) {
    if (filterFn && !filterFn(qq.q)) continue;
    const rel = new Set(relevantFor(qq.target));
    const ranked = results[`${arm}::${qq.q}`].ranked;
    const firstIdx = ranked.findIndex((id) => rel.has(id));
    m.hit1 += rel.has(ranked[0] ?? "") ? 1 : 0;
    m.hit5 += firstIdx >= 0 ? 1 : 0;
    m.mrr += firstIdx >= 0 ? 1 / (firstIdx + 1) : 0;
    const hits = ranked.filter((id) => rel.has(id)).length;
    m.recall5 += Math.min(1, hits / rel.size);
    m.n += 1;
  }
  return m;
}
const fmt = (m: Metrics) => `R@1=${((m.hit1 / m.n) * 100).toFixed(1)}%  R@5=${((m.hit5 / m.n) * 100).toFixed(1)}%  MRR@5=${(m.mrr / m.n).toFixed(3)}  frac-retrieved@5=${(m.recall5 / m.n).toFixed(3)}`;

// lexical buckets
const overlapOf = (q: string) => {
  const qq = QUERIES.find((x) => x.q === q)!;
  const rel = relevantFor(qq.target);
  const relText = rel.map((id) => { const e = byId.get(id)!; return `${e.summary} ${e.userMessage}`; }).join(" ");
  return jaccard(contentWords(q), contentWords(relText));
};
const isDisjoint = (q: string) => overlapOf(q) < 0.04;

// ---------- arm F: inject 50 most recent (no retrieval) ----------
const recent50 = new Set([...episodes].slice(-50).map((e) => e.id));
let fHit = 0, fRel = 0;
for (const qq of QUERIES) {
  const rel = relevantFor(qq.target);
  fRel += rel.size;
  if (rel.some((id) => recent50.has(id))) fHit++;
}

// ---------- token efficiency (REAL gpt-tokenizer) ----------
const { encode } = await import("gpt-tokenizer");
function tokensOf(ids: string[]): number {
  const text = ids.map((id) => renderLine(byId.get(id)!)).join("\n");
  return encode(text).length;
}
const tokenStats: Record<string, { avg5: number; relIn5: number; n: number }> = {};
for (const arm of ARM_NAMES) {
  let sum = 0, relHit = 0, n = 0;
  for (const qq of QUERIES) {
    const ids = results[`${arm}::${qq.q}`].ranked;
    sum += tokensOf(ids);
    const rel = new Set(relevantFor(qq.target));
    relHit += ids.filter((id) => rel.has(id)).length;
    n++;
  }
  tokenStats[arm] = { avg5: sum / n, relIn5: relHit / n, n };
}
const recent50Tokens = tokensOf([...recent50]);
const all306Tokens = tokensOf(episodes.map((e) => e.id));

// ---------- report ----------
const pcts = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log("\n================ REAL RESULTS ================");
for (const arm of ARM_NAMES) console.log(`${arm.padEnd(18)} ${fmt(metricsFor(arm))}`);
console.log(`F-recent-50(no retr) R@1=n/a  R@5=${pcts(fHit / QUERIES.length)} (set-containment)`);
console.log("\nlexically DISjoint queries only:");
for (const arm of ARM_NAMES) console.log(`  ${arm.padEnd(18)} ${fmt(metricsFor(arm, isDisjoint))}  (n=${metricsFor(arm, isDisjoint).n})`);
console.log("\ntokens per injected top-5:", JSON.stringify(Object.fromEntries(Object.entries(tokenStats).map(([k, v]) => [k, Math.round(v.avg5)]))));
console.log(`tokens: recent-50=${recent50Tokens}  all-${episodes.length}=${all306Tokens}`);
console.log(`precision@5 (avg relevant items injected): ${Object.fromEntries(Object.entries(tokenStats).map(([k, v]) => [k, v.relIn5.toFixed(2)]))}`);
console.log(`latency ms/query  titan p50=${p50(armLatency.titan)}  3-small p50=${p50(armLatency.s3)}  local p50=${p50(armLatency.local)}`);
console.log(`API spend (real): titan $${titanUsage.cost.toFixed(6)} / ${titanUsage.tokens} tok | 3-small $${s3Usage.cost.toFixed(6)} / ${s3Usage.tokens} tok`);

function p50(a: number[]): string { const s = [...a].sort((x, y) => x - y); return String(s[Math.floor(s.length / 2)]?.toFixed(0) ?? "-"); }

// markdown report
let md = `# Experience-Guided Recall — Titan V2 vs NTOX existing memory\n\nRun: ${new Date().toISOString()}  \nCorpus: ${episodes.length} REAL episodes from ~/.ntox/memory/episodes.jsonl  \nQueries: ${QUERIES.length} authored paraphrases with ground truth  \nEmbeddings: REAL OpenRouter calls (titan-embed-text-v2 @512d, text-embedding-3-small)\n\n## Retrieval accuracy (all queries, n=${QUERIES.length})\n\n| arm | R@1 | R@5 | MRR@5 | retrieved-fraction@5 |\n|---|---|---|---|---|\n`;
for (const arm of ARM_NAMES) {
  const m = metricsFor(arm);
  md += `| ${arm} | ${pcts(m.hit1 / m.n)} | ${pcts(m.hit5 / m.n)} | ${(m.mrr / m.n).toFixed(3)} | ${(m.recall5 / m.n).toFixed(3)} |\n`;
}
md += `| F-recent-50 (set) | — | ${pcts(fHit / QUERIES.length)} | — | — |\n`;
const disj = QUERIES.filter((q) => isDisjoint(q.q));
md += `\n## Lexically disjoint queries only (n=${disj.length}) — where semantics should matter\n\n| arm | R@1 | R@5 | MRR@5 |\n|---|---|---|---|\n`;
for (const arm of ARM_NAMES) {
  const m = metricsFor(arm, isDisjoint);
  md += `| ${arm} | ${pcts(m.hit1 / m.n)} | ${pcts(m.hit5 / m.n)} | ${(m.mrr / m.n).toFixed(3)} |\n`;
}
md += `\n## Token efficiency\n\n| method | avg tokens injected per turn | relevant items inside |\n|---|---|---|\n`;
for (const arm of ARM_NAMES) md += `| ${arm} top-5 | ${Math.round(tokenStats[arm].avg5)} | ${tokenStats[arm].relIn5.toFixed(2)}/5 |\n`;
md += `| inject 50 recent (no retrieval) | ${recent50Tokens} | ${fHit}/${QUERIES.length} queries covered |\n| inject all ${episodes.length} | ${all306Tokens} | — |\n`;
md += `\n## Latency & cost (measured)\n\n| embedder | p50 query latency | API spend this run |\n|---|---|---|\n| Titan V2 (512d) | ${p50(armLatency.titan)} ms | $${titanUsage.cost.toFixed(6)} (${titanUsage.tokens} tok) |\n| text-embedding-3-small | ${p50(armLatency.s3)} ms | $${s3Usage.cost.toFixed(6)} (${s3Usage.tokens} tok) |\n| localEmbed (hashing 256d) | ${p50(armLatency.local)} ms | $0 |\n`;
md += `\n## Per-query detail\n\n| # | query | target-group size | ` + ARM_NAMES.map((a) => a.split("-")[0]).join(" | ") + ` |\n|---|---|---|---|\n`;
QUERIES.forEach((qq, i) => {
  const rel = new Set(relevantFor(qq.target));
  const cells = ARM_NAMES.map((arm) => {
    const r = results[`${arm}::${qq.q}`].ranked;
    const idx = r.findIndex((id) => rel.has(id));
    return idx === -1 ? "miss" : `#${idx + 1}`;
  });
  md += `| ${i + 1} | ${qq.q.replace(/\|/g, "/")} | ${rel.size} | ${cells.join(" | ")} |\n`;
});
md += `\nArms: A=NT
OX current (stored mixed vectors + BM25 hybrid 0.6/0.4, thr 0.3) · B=NTOX local fallback · C=Titan cosine · D=Titan+BM25 hybrid (proposal) · E=BM25 only · F=recent-50 injection\n`;
writeFileSync(OUT_MD, md);
console.log(`\nreport written: ${OUT_MD}`);
