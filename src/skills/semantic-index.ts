import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { LOCAL_HASH_TAG, type Embedder } from "../memory/embedding-service.js";
import { cosineSimilarity } from "../utils/math.js";

const CACHE_PATH = join(NTOX_DIR, "skills", "semantic-vectors.json");
const MIN_SIMILARITY = 0.2;

interface VectorEntry {
  vector: number[];
  contentHash: string;
}

interface VectorCache {
  version: 1;
  model: string;
  dim: number;
  entries: Record<string, VectorEntry>;
}

export interface SkillSemanticCandidate {
  name: string;
  description: string;
}

export interface SkillSemanticMatch {
  name: string;
  similarity: number;
}

function contentHash(candidate: SkillSemanticCandidate): string {
  return createHash("sha256").update(`${candidate.name}\n${candidate.description}`).digest("hex").slice(0, 16);
}

/** Embeds bundled skill descriptions with the active model and caches them per
 *  model/dimension. Only remote-model vectors are semantic; local-hash queries
 *  fall back to keyword triggers. Vectors are filled incrementally to avoid a
 *  burst of embedding calls on the first turn. */
export class SkillSemanticIndex {
  private cache: VectorCache | null = null;

  constructor(
    private readonly embedder: Embedder,
    private readonly maxEmbedsPerCall: number = 8,
    private readonly path: string = CACHE_PATH,
  ) {}

  private load(): VectorCache {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as VectorCache;
      if (parsed.version === 1 && typeof parsed.model === "string" && parsed.entries) {
        this.cache = parsed;
        return this.cache;
      }
    } catch {
      /* no usable cache */
    }
    this.cache = { version: 1, model: "", dim: 0, entries: {} };
    return this.cache;
  }

  private save(): void {
    if (!this.cache) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.cache, null, 2));
    } catch {
      /* cache write is best-effort */
    }
  }

  async find(
    candidates: SkillSemanticCandidate[],
    query: number[],
    queryModel: string | undefined,
    limit: number = 5,
  ): Promise<SkillSemanticMatch[]> {
    if (!query.length || !queryModel || queryModel === LOCAL_HASH_TAG) return [];
    const cache = this.load();
    if (cache.model !== queryModel || cache.dim !== query.length) {
      cache.model = queryModel;
      cache.dim = query.length;
      cache.entries = {};
    }

    let embedded = 0;
    for (const candidate of candidates) {
      if (embedded >= this.maxEmbedsPerCall) break;
      const hash = contentHash(candidate);
      const entry = cache.entries[candidate.name];
      if (entry?.contentHash === hash) continue;
      embedded += 1;
      try {
        const result = await this.embedder.embed(`${candidate.name}: ${candidate.description}`);
        if (!result || result.model !== queryModel || result.vector.length !== query.length) continue;
        cache.entries[candidate.name] = { vector: result.vector, contentHash: hash };
      } catch {
        /* skip skills whose embedding failed */
      }
    }
    if (embedded > 0) this.save();

    const matches: SkillSemanticMatch[] = [];
    for (const candidate of candidates) {
      const vector = cache.entries[candidate.name]?.vector;
      if (!vector) continue;
      const similarity = cosineSimilarity(query, vector);
      if (similarity > MIN_SIMILARITY) matches.push({ name: candidate.name, similarity });
    }
    return matches.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
}
