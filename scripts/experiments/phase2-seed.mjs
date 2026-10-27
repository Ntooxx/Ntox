/**
 * Phase 2 state seeder (v2 — dimension-matched).
 *
 * Bug found in run 2: NTOX's embed path (llm.ts) sends {model, input} WITHOUT `dimensions`,
 * so Titan queries come back 1024-dim while the corpus was embedded at 512 -> cosineSimilarity
 * length guard returned 0 for every candidate -> Titan arms degenerated to BM25-only.
 * Fix: embed the Titan corpus at DEFAULT dims (no dimensions field) so it matches what the
 * production query path actually produces. No source changes; the failure is documented.
 *
 * Conditions:
 *   fresh        memory off
 *   current      memory on, 3-small vectors, episodes as stored today (mixed dims — production reality)
 *   titan-dropin memory on, embeddingModel=Titan V2 (hybrid scoring unchanged — literal drop-in)
 *   titan-pure   same vectors, agent process runs with NTOX_MEMORY_SCORING=cosine
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "C:/Users/anton/Desktop/Ntox";
const PHASE2 = join(homedir(), "AppData/Local/Temp/opencode/phase2");
const REAL_MEMORY = join(homedir(), ".ntox/memory");
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("no OPENROUTER_API_KEY"); process.exit(1); }

const TAG_S3 = "remote:openrouter/openai/text-embedding-3-small";
const TAG_TITAN = "remote:openrouter/amazon/titan-embed-text-v2";
const S3 = "openai/text-embedding-3-small";
const TITAN = "amazon/titan-embed-text-v2";
const hash = (s) => createHash("sha256").update(s).digest("hex");

let apiTokens = 0, apiCost = 0;
async function embed(model, text) {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "HTTP-Referer": "https://ntox.ai", "X-Title": "Ntox Agent" },
    body: JSON.stringify({ model, input: text }), // NO dimensions — exactly what NTOX's llm.ts sends
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  apiTokens += j.usage?.total_tokens ?? 0;
  apiCost += j.usage?.cost ?? 0;
  return j.data[0].embedding;
}

// ---------- constructed experiences (6 targets + 6 distractors) ----------
const SEEDS = [
  { id: "ph2_t1", um: "Post-incident follow-up for billing: which upkeep slot now applies going forward?", ar: "The billing cluster's maintenance window is Sundays 02:00-04:00 UTC from now on." },
  { id: "ph2_d1", um: "And the dry-run slot for billing in staging?", ar: "Billing staging rehearsals run Saturdays 23:00-23:30 UTC." },
  { id: "ph2_t2", um: "Design tokens workshop outcome — which primary hex did we lock for product?", ar: "We locked #1A2B3C as the primary across product surfaces." },
  { id: "ph2_d2", um: "Did the secondary palette change in that workshop too?", ar: "Secondary stays #4E7A9C; only accent colours were revisited." },
  { id: "ph2_t3", um: "After last week's outage, what cap did we agree for retries?", ar: "Retries are capped at 7 attempts with exponential backoff." },
  { id: "ph2_d3", um: "Does staging share the same retry behaviour?", ar: "Staging allows 5 attempts before it gives up." },
  { id: "ph2_t4", um: "Rota discussion — which handle takes the pages for the platform crew?", ar: "Platform pages go to core-infra-oncall." },
  { id: "ph2_d4", um: "And the fallback contact when nobody picks up?", ar: "After two unanswered rings it escalates to secops-nightdesk." },
  { id: "ph2_t5", um: "Migration notes: what literal must X-Tenant carry during cutover?", ar: "X-Tenant must carry epoch-2024-11 for the cutover." },
  { id: "ph2_d5", um: "What does the canary wave use in the meantime?", ar: "Canary keeps epoch-2024-09 until the freeze." },
  { id: "ph2_t6", um: "Promotion procedure — which clearance string gates a build going live?", ar: "A build ships only with clearance string Q-7741." },
  { id: "ph2_d6", um: "Is there a different code for hotfix releases?", ar: "Hotfixes bypass with clearance Q-1180." },
];

const realLines = readFileSync(join(REAL_MEMORY, "episodes.jsonl"), "utf8").split("\n").filter((l) => l.trim());
const realEps = realLines.map((l) => JSON.parse(l));
console.log(`real episodes: ${realEps.length}`);

// ---------- titan corpus at DEFAULT dims (matches production query path) ----------
const TITAN_CACHE = join(REPO, "scripts/experiments/cache/titan-1024.json");
let titanCache = {};
try { titanCache = JSON.parse(readFileSync(TITAN_CACHE, "utf8")); } catch { /* first run */ }
let titanEmbedded = 0;
async function titanVectorFor(ep) {
  const key = hash(ep.userMessage || ep.summary || "");
  if (titanCache[key]) return titanCache[key];
  const v = await embed(TITAN, ep.userMessage || ep.summary || "");
  titanCache[key] = v;
  titanEmbedded++;
  if (titanEmbedded % 50 === 0) { writeFileSync(TITAN_CACHE, JSON.stringify(titanCache)); console.log(`  titan corpus ${titanEmbedded} embedded...`); }
  return v;
}

async function seedEpisodes(model, tag) {
  const out = [];
  for (const s of SEEDS) {
    const vector = await embed(model, s.um);
    out.push({
      id: s.id,
      timestamp: Date.now() - 20 * 24 * 3600 * 1000,
      sessionId: "phase2-seed",
      userMessage: s.um,
      assistantResponse: s.ar,
      summary: s.um.length <= 120 ? s.um : s.um.slice(0, 117) + "...",
      embedding: vector,
      embeddingModel: tag,
    });
  }
  return out;
}

const baseConfig = JSON.parse(readFileSync(join(homedir(), ".ntox/config.json"), "utf8"));
const CONDS = [
  { name: "fresh", memory: false, embeddingModel: baseConfig.embeddingModel },
  { name: "current", memory: true, embeddingModel: S3 },
  { name: "titan-dropin", memory: true, embeddingModel: TITAN },
  { name: "titan-pure", memory: true, embeddingModel: TITAN },
];

let seedsS3 = null, seedsTitan = null;
for (const cond of CONDS) {
  const dir = join(PHASE2, `state-${cond.name}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "memory"), { recursive: true });
  const cfg = { ...baseConfig, memoryEnabled: cond.memory, embeddingModel: cond.embeddingModel };
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg, null, 2));
  for (const f of ["credentials.json", "credentials.enc.json", "models-cache.json"]) {
    const src = join(homedir(), ".ntox", f);
    if (existsSync(src)) cpSync(src, join(dir, f));
  }
  const skillsSrc = join(homedir(), ".ntox/skills");
  if (existsSync(skillsSrc)) cpSync(skillsSrc, join(dir, "skills"), { recursive: true });
  const md = join(REAL_MEMORY, "memory.md");
  if (existsSync(md)) cpSync(md, join(dir, "memory/memory.md"));
  writeFileSync(join(dir, "memory/durable.json"), "[]");

  if (!cond.memory) {
    writeFileSync(join(dir, "memory/episodes.jsonl"), "");
    console.log(`${cond.name}: memory OFF, state at ${dir}`);
    continue;
  }
  if (cond.embeddingModel === S3) {
    if (!seedsS3) seedsS3 = await seedEpisodes(S3, TAG_S3);
    writeFileSync(join(dir, "memory/episodes.jsonl"), [...realLines, ...seedsS3.map((e) => JSON.stringify(e))].join("\n") + "\n");
    console.log(`${cond.name}: ${realEps.length} real (as-stored, mixed) + ${seedsS3.length} seeds (3-small)`);
  } else {
    if (!seedsTitan) seedsTitan = await seedEpisodes(TITAN, TAG_TITAN);
    const converted = [];
    for (const ep of realEps) {
      converted.push({ ...ep, embedding: await titanVectorFor(ep), embeddingModel: TAG_TITAN });
    }
    writeFileSync(join(dir, "memory/episodes.jsonl"), [...converted.map((e) => JSON.stringify(e)), ...seedsTitan.map((e) => JSON.stringify(e))].join("\n") + "\n");
    console.log(`${cond.name}: ${converted.length} real (titan-1024) + ${seedsTitan.length} seeds (titan-1024)`);
  }
}
writeFileSync(TITAN_CACHE, JSON.stringify(titanCache));
// sanity: confirm dimensions actually match what the query path produces
const sample = JSON.parse(readFileSync(join(PHASE2, "state-titan-pure/memory/episodes.jsonl"), "utf8").split("\n")[0]);
console.log(`corpus vector dims: ${sample.embedding.length} (query path default: 1024)`);
console.log(`seed API spend this run: $${apiCost.toFixed(6)} / ${apiTokens} tokens | newly embedded: ${titanEmbedded}`);
console.log(`state dirs under ${PHASE2}`);
