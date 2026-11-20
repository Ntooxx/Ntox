import { localEmbed } from "../core/local-embed.js";
import { LOCAL_HASH_TAG, type Embedder, type EmbeddedVector } from "./embedding-service.js";

/** Opt-in, lazily-loaded local semantic embeddings. The heavy ONNX dependency is
 *  imported only when NTOX_LOCAL_MINILM=1 (or `force` is set) and `embed()` is
 *  actually called, so startup and normal installs are never blocked. */
export const LOCAL_MINILM_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_MINILM_DIM = 384;

export interface LocalSemanticOptions {
  modelId?: string;
  dim?: number;
  /** Bypass the environment gate (used by measurement harnesses). */
  force?: boolean;
  /** Dependency import + first-run model download budget (ms). */
  initTimeoutMs?: number;
}

type FeaturePipe = (
  text: string,
  options: Record<string, unknown>,
) => Promise<{ data: ArrayLike<number>; dims?: number[] }>;

export class LocalSemanticEmbedder implements Embedder {
  readonly kind = "local" as const;
  readonly currentModel = "local-minilm";
  private pipelinePromise: Promise<FeaturePipe | null> | null = null;
  private unavailableReason = "";

  constructor(private readonly options: LocalSemanticOptions = {}) {}

  get modelId(): string {
    return this.options.modelId ?? LOCAL_MINILM_MODEL_ID;
  }

  get dim(): number {
    return this.options.dim ?? LOCAL_MINILM_DIM;
  }

  get reason(): string {
    return this.unavailableReason;
  }

  /** Non-blocking capability probe: resolves false without importing the model
   *  when the feature is disabled. */
  async available(): Promise<boolean> {
    return (await this.getPipeline()) !== null;
  }

  private getPipeline(): Promise<FeaturePipe | null> {
    if (this.pipelinePromise) return this.pipelinePromise;
    const enabled = this.options.force ?? process.env.NTOX_LOCAL_MINILM === "1";
    if (!enabled) {
      this.unavailableReason = "disabled (set NTOX_LOCAL_MINILM=1 and install @huggingface/transformers)";
      return Promise.resolve(null);
    }

    this.pipelinePromise = (async () => {
      try {
        const moduleName = "@huggingface/transformers";
        const mod = (await import(moduleName)) as {
          pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<FeaturePipe>;
        };
        const timeoutMs = this.options.initTimeoutMs ?? 120_000;
        const pipe = await Promise.race([
          mod.pipeline("feature-extraction", this.modelId, { dtype: "q8" }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("model init timed out")), timeoutMs)),
        ]);
        return pipe;
      } catch (error) {
        this.unavailableReason = error instanceof Error ? error.message : String(error);
        return null;
      }
    })();
    return this.pipelinePromise;
  }

  async embed(text: string): Promise<EmbeddedVector | null> {
    const pipe = await this.getPipeline();
    if (!pipe) return { vector: localEmbed(text), model: LOCAL_HASH_TAG };
    try {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data).slice(0, this.dim);
      if (vector.length === 0) return { vector: localEmbed(text), model: LOCAL_HASH_TAG };
      return { vector, model: "local-minilm" };
    } catch {
      return { vector: localEmbed(text), model: LOCAL_HASH_TAG };
    }
  }
}

/** Factory used by reembed and the recall harness. */
export function createLocalSemanticEmbedder(options?: LocalSemanticOptions): LocalSemanticEmbedder {
  return new LocalSemanticEmbedder(options);
}
