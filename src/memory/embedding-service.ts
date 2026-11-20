import { localEmbed } from "../core/local-embed.js";

/** Provenance tag for vectors produced by the deterministic local hash embedder. */
export const LOCAL_HASH_TAG = "local-hash";

/** Provenance tag for vectors produced by the opt-in local MiniLM embedder. */
export const LOCAL_MINILM_TAG = "local-minilm";

export interface EmbeddedVector {
  vector: number[];
  /** Provenance tag: `remote:<provider>/<model>` or `local-hash`. */
  model: string;
}

export interface Embedder {
  embed(text: string): Promise<EmbeddedVector | null>;
  /** Provenance tag this embedder aims to produce (per-result tags may differ on fallback). */
  readonly currentModel: string;
  readonly kind: "remote" | "local";
}

/** Minimal LLM surface the remote embedder needs; `LLMClient` satisfies it structurally. */
export interface EmbeddingClient {
  embedWithMeta(text: string): Promise<{ vector: number[]; model: string } | null>;
  getEmbeddingModelTag(): string;
}

/** Remote-first embedder wrapping `llm.embedWithMeta` (budgeted, cached, ada-002 fallback). */
export class EmbeddingService implements Embedder {
  readonly kind = "remote" as const;

  constructor(private readonly llm: EmbeddingClient) {}

  get currentModel(): string {
    return this.llm.getEmbeddingModelTag();
  }

  embed(text: string): Promise<EmbeddedVector | null> {
    return this.llm.embedWithMeta(text);
  }
}

/** Deterministic local hash embedder for offline/eval/sync store use; tags every vector `local-hash`. */
export class LocalOnlyEmbedder implements Embedder {
  readonly kind = "local" as const;
  readonly currentModel = LOCAL_HASH_TAG;

  embedSync(text: string): EmbeddedVector {
    return { vector: localEmbed(text), model: LOCAL_HASH_TAG };
  }

  embed(text: string): Promise<EmbeddedVector | null> {
    return Promise.resolve(this.embedSync(text));
  }
}

/** Shared sync embedder for stores that must embed synchronously (theories, transfer). */
export const localEmbedder = new LocalOnlyEmbedder();

/** Legacy/untagged vectors are treated as `local-hash`, the historical local producer. */
export function tagOrHash(model: string | undefined): string {
  return model || LOCAL_HASH_TAG;
}

/** Per-model provenance breakdown of stored vectors, plus the skip totals the
 *  model-mismatch and dim-mismatch guards would incur for an active query model/dim. */
export interface EmbeddingStats {
  totalEpisodes: number;
  withVector: number;
  byModel: Record<string, number>;
  byDim: Record<number, number>;
  activeModel?: string;
  activeDim?: number;
  /** True when activeDim was inferred from stored vectors rather than configured. */
  dimInferred?: boolean;
  skippedByModel: number;
  skippedByDim: number;
  /** skippedByModel / withVector (0 when no vectors are stored). */
  mismatchRatio: number;
}

interface VectorRow {
  embedding?: number[];
  embeddingModel?: string;
}

/** Computes provenance counts + skip totals without needing a live embed call. */
export function embeddingStats(rows: readonly VectorRow[], activeModel?: string, activeDim?: number): EmbeddingStats {
  const byModel: Record<string, number> = {};
  const byDim: Record<number, number> = {};
  const dimsByModel: Record<string, Record<number, number>> = {};
  const vectors: { model: string; dim: number }[] = [];

  for (const row of rows) {
    if (!row.embedding || row.embedding.length === 0) continue;
    const model = row.embeddingModel ?? LOCAL_HASH_TAG;
    const dim = row.embedding.length;
    vectors.push({ model, dim });
    byModel[model] = (byModel[model] ?? 0) + 1;
    byDim[dim] = (byDim[dim] ?? 0) + 1;
    dimsByModel[model] ??= {};
    dimsByModel[model][dim] = (dimsByModel[model][dim] ?? 0) + 1;
  }

  // With no configured dimension, the dominant dimension among rows already tagged
  // with the active model is the best signal for that model's query output size.
  let effectiveDim = activeDim;
  let dimInferred = false;
  if (effectiveDim === undefined && activeModel && dimsByModel[activeModel]) {
    const ranked = Object.entries(dimsByModel[activeModel]).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
    if (ranked.length > 0) {
      effectiveDim = Number(ranked[0][0]);
      dimInferred = true;
    }
  }

  let skippedByModel = 0;
  let skippedByDim = 0;
  for (const { model, dim } of vectors) {
    if (activeModel && model !== activeModel) skippedByModel += 1;
    if (effectiveDim !== undefined && dim !== effectiveDim) skippedByDim += 1;
  }

  return {
    totalEpisodes: rows.length,
    withVector: vectors.length,
    byModel,
    byDim,
    ...(activeModel ? { activeModel } : {}),
    ...(effectiveDim !== undefined ? { activeDim: effectiveDim } : {}),
    ...(dimInferred ? { dimInferred: true } : {}),
    skippedByModel,
    skippedByDim,
    mismatchRatio: vectors.length > 0 ? skippedByModel / vectors.length : 0,
  };
}
