import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillSemanticIndex } from "./semantic-index.js";
import { LOCAL_HASH_TAG, type Embedder } from "../memory/embedding-service.js";

const MODEL = "remote:test/model";
const candidates = [
  { name: "alpha skill", description: "alpha procedures" },
  { name: "beta skill", description: "beta procedures" },
];

function fakeEmbedder(model = MODEL): Embedder & { embed: ReturnType<typeof vi.fn> } {
  return {
    kind: "remote",
    currentModel: model,
    embed: vi.fn(async (text: string) => ({
      vector: text.includes("alpha") ? [1, 0] : [0, 1],
      model,
    })),
  } as Embedder & { embed: ReturnType<typeof vi.fn> };
}

describe("SkillSemanticIndex", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ntox-test-semantic-"));
    cachePath = join(dir, "vectors.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("skips semantic matching for local-hash queries", async () => {
    const embedder = fakeEmbedder();
    const index = new SkillSemanticIndex(embedder, 8, cachePath);

    expect(await index.find(candidates, [1, 0], LOCAL_HASH_TAG)).toEqual([]);
    expect(await index.find(candidates, [1, 0], undefined)).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("embeds candidates, caches vectors by content, and reuses them", async () => {
    const embedder = fakeEmbedder();
    const index = new SkillSemanticIndex(embedder, 8, cachePath);

    const first = await index.find(candidates, [1, 0], MODEL);
    expect(first).toEqual([{ name: "alpha skill", similarity: 1 }]);
    expect(embedder.embed).toHaveBeenCalledTimes(2);

    const second = await index.find(candidates, [1, 0], MODEL);
    expect(second).toEqual(first);
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(cachePath, "utf-8")).entries["alpha skill"].vector).toEqual([1, 0]);
  });

  it("re-embeds when the active model changes", async () => {
    const embedder = fakeEmbedder();
    const index = new SkillSemanticIndex(embedder, 8, cachePath);
    await index.find(candidates, [1, 0], MODEL);
    expect(embedder.embed).toHaveBeenCalledTimes(2);

    const next = fakeEmbedder("remote:test/other");
    const nextIndex = new SkillSemanticIndex(next, 8, cachePath);
    expect(await nextIndex.find(candidates, [1, 0], "remote:test/other")).toEqual([
      { name: "alpha skill", similarity: 1 },
    ]);
    expect(next.embed).toHaveBeenCalledTimes(2);
  });

  it("caps the number of embeddings per call", async () => {
    const embedder = fakeEmbedder();
    const index = new SkillSemanticIndex(embedder, 1, cachePath);

    await index.find(candidates, [1, 0], MODEL);
    expect(embedder.embed).toHaveBeenCalledTimes(1);

    await index.find(candidates, [1, 0], MODEL);
    expect(embedder.embed).toHaveBeenCalledTimes(2);
  });

  it("ignores embeddings with a different dimension", async () => {
    const embedder = fakeEmbedder();
    const index = new SkillSemanticIndex(embedder, 8, cachePath);

    const results = await index.find(candidates, [1, 0, 0], MODEL);
    expect(results).toEqual([]);
  });
});
