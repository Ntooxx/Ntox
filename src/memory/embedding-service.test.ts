import { describe, it, expect, vi } from "vitest";
import {
  EmbeddingService,
  LOCAL_HASH_TAG,
  LocalOnlyEmbedder,
  localEmbedder,
  tagOrHash,
  type EmbeddingClient,
} from "./embedding-service.js";

function mockClient(overrides: Partial<EmbeddingClient> = {}): EmbeddingClient & {
  embedWithMeta: ReturnType<typeof vi.fn>;
} {
  return {
    embedWithMeta: vi.fn().mockResolvedValue({ vector: [0.1, 0.2], model: "remote:test/active-model" }),
    getEmbeddingModelTag: () => "remote:test/active-model",
    ...overrides,
  } as EmbeddingClient & { embedWithMeta: ReturnType<typeof vi.fn> };
}

describe("EmbeddingService", () => {
  it("delegates to llm.embedWithMeta and returns the tagged result", async () => {
    const llm = mockClient();
    const service = new EmbeddingService(llm);

    const result = await service.embed("some text");

    expect(llm.embedWithMeta).toHaveBeenCalledWith("some text");
    expect(result).toEqual({ vector: [0.1, 0.2], model: "remote:test/active-model" });
  });

  it("reports the active model from the wrapped client", () => {
    const service = new EmbeddingService(mockClient());
    expect(service.currentModel).toBe("remote:test/active-model");
    expect(service.kind).toBe("remote");
  });

  it("propagates null (budget exhausted) without substituting a vector", async () => {
    const llm = mockClient({ embedWithMeta: vi.fn().mockResolvedValue(null) });
    const service = new EmbeddingService(llm);
    expect(await service.embed("text")).toBeNull();
  });
});

describe("LocalOnlyEmbedder", () => {
  it("tags every vector local-hash", () => {
    const embedder = new LocalOnlyEmbedder();
    const { vector, model } = embedder.embedSync("the vault code is delta-9");

    expect(model).toBe(LOCAL_HASH_TAG);
    expect(vector.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same text", () => {
    const embedder = new LocalOnlyEmbedder();
    expect(embedder.embedSync("same input").vector).toEqual(embedder.embedSync("same input").vector);
  });

  it("exposes local-hash as currentModel and kind local", async () => {
    const embedder = new LocalOnlyEmbedder();
    expect(embedder.currentModel).toBe("local-hash");
    expect(embedder.kind).toBe("local");
    expect(await embedder.embed("async path")).toEqual(embedder.embedSync("async path"));
  });

  it("shared localEmbedder instance tags local-hash", () => {
    expect(localEmbedder.embedSync("anything").model).toBe("local-hash");
  });
});

describe("tagOrHash", () => {
  it("falls back to local-hash for missing tags", () => {
    expect(tagOrHash(undefined)).toBe(LOCAL_HASH_TAG);
    expect(tagOrHash("")).toBe(LOCAL_HASH_TAG);
    expect(tagOrHash("remote:x/y")).toBe("remote:x/y");
  });
});
