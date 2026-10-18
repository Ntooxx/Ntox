import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { MemoryStore, cosineSimilarity } from "./episodic.js";
import { DURABLE_MEMORY_PATH, EPISODES_PATH, EPISODES_JSONL_PATH } from "../core/config.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0);
  });

  it("handles different length vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("handles negative values", () => {
    const sim = cosineSimilarity([1, -1], [-1, 1]);
    expect(sim).toBeCloseTo(-1);
  });

  it("handles scalar multiples", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

describe("MemoryStore", () => {
  afterEach(() => {
    if (existsSync(EPISODES_PATH)) unlinkSync(EPISODES_PATH);
    if (existsSync(EPISODES_JSONL_PATH)) unlinkSync(EPISODES_JSONL_PATH);
    if (existsSync(DURABLE_MEMORY_PATH)) unlinkSync(DURABLE_MEMORY_PATH);
  });

  const makeEmbedding = (seed: number): number[] => {
    const v = new Array(10).fill(0);
    v[seed % 10] = 1;
    return v;
  };

  it("starts empty", () => {
    const store = new MemoryStore();
    expect(store.count()).toBe(0);
    expect(store.getAll().length).toBe(0);
    expect(store.buildMemoryContext(null)).toBe("");
  });

  it("adds and retrieves episodes", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "hello world", "hi there", makeEmbedding(1));
    expect(store.count()).toBe(1);
    expect(store.getRecent(1).length).toBe(1);
  });

  it("persists episodes as append-only JSONL and reloads them", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "first message", "first reply", makeEmbedding(1));
    store.addEpisode("s1", "second message", "second reply", makeEmbedding(2));
    expect(existsSync(EPISODES_JSONL_PATH)).toBe(true);

    const raw = readFileSync(EPISODES_JSONL_PATH, "utf-8");
    expect(raw.trimEnd().split("\n").length).toBe(2);

    const reloaded = new MemoryStore();
    expect(reloaded.count()).toBe(2);
    expect(reloaded.getRecent(1)[0].userMessage).toBe("second message");
  });

  it("migrates legacy episodes.json to JSONL on load", () => {
    const legacy = [
      {
        id: "ep_legacy",
        timestamp: Date.now(),
        sessionId: "s1",
        userMessage: "legacy msg",
        assistantResponse: "legacy reply",
        summary: "legacy msg",
        embedding: makeEmbedding(3),
      },
    ];
    writeFileSync(EPISODES_PATH, JSON.stringify(legacy));

    const store = new MemoryStore();
    expect(store.count()).toBe(1);
    expect(existsSync(EPISODES_JSONL_PATH)).toBe(true);

    const reloaded = new MemoryStore();
    expect(reloaded.count()).toBe(1);
    expect(reloaded.getRecent(1)[0].id).toBe("ep_legacy");
  });

  it("compacts oversized stores on load", () => {
    const store = new MemoryStore();
    for (let i = 0; i < 1201; i++) {
      store.addEpisode("s1", `msg ${i}`, `reply ${i}`, makeEmbedding(i));
    }

    const reloaded = new MemoryStore();
    expect(reloaded.count()).toBe(1000);
    expect(reloaded.getRecent(1)[0].userMessage).toBe("msg 1200");
  });

  it("retrieves by embedding similarity", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "about dogs", "woof", makeEmbedding(1));
    store.addEpisode("s2", "about cats", "meow", makeEmbedding(2));

    const results = store.retrieve(makeEmbedding(1), 5, 0.5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].episode.userMessage).toBe("about dogs");
  });

  it("searches by keyword", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "meeting with John about project Alpha", "scheduled", makeEmbedding(1));
    store.addEpisode("s2", "grocery list: milk eggs", "noted", makeEmbedding(2));

    const results = store.search("project", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].userMessage).toContain("Alpha");
  });

  it("stores searchable durable memories by lane", () => {
    const store = new MemoryStore();
    const memory = store.addDurableMemory("preference", "Anton prefers concise summaries", "test");

    expect(store.listDurableMemories("preference")[0].id).toBe(memory.id);
    expect(store.searchDurableMemories("concise")[0].id).toBe(memory.id);
    expect(store.getDurableMemory(memory.id)?.provenance).toBe("test");
    expect(store.buildMemoryContext(null)).toContain("preference: Anton prefers concise summaries");
    expect(store.deleteDurableMemory(memory.id)).toBe(true);
    expect(store.listDurableMemories()).toHaveLength(0);
  });

  it("updates durable memories with history and contradiction tracking", () => {
    const store = new MemoryStore();
    const memory = store.addDurableMemory("fact", "Ntox uses plain fetch", "test", 0.9);

    const updated = store.updateDurableMemory(memory.id, "Ntox uses web_read for reliable URL reading", "better fact");
    expect(updated?.text).toContain("web_read");
    expect(updated?.history[0].text).toBe("Ntox uses plain fetch");

    const contradicted = store.markDurableMemoryContradicted(memory.id, "old fact was incomplete");
    expect(contradicted?.contradictionCount).toBe(1);
    expect(contradicted?.confidence).toBeLessThan(0.9);
    expect(store.getDurableMemory(memory.id)?.history.length).toBe(2);
  });

  it("rewrites durable memory when a user correction names the old answer", () => {
    const store = new MemoryStore();
    const memory = store.addDurableMemory("fact", "harbor=blue-ember", "test", 0.8);

    const corrected = store.applyCorrectionToDurableMemories({
      topicKey: "harbor",
      wrongAnswer: "harbor=blue-ember",
      correction: "harbor=navy-ember",
    });

    const stored = store.getDurableMemory(memory.id);
    expect(corrected).toHaveLength(1);
    expect(stored?.text).toBe("harbor=navy-ember");
    expect(stored?.confidence).toBeGreaterThanOrEqual(0.95);
    expect(stored?.history[0].text).toBe("harbor=blue-ember");
  });

  it("demotes topic-matched durable memories when a correction may supersede them", () => {
    const store = new MemoryStore();
    const memory = store.addDurableMemory("fact", "The harbor ledger uses the old deployment value", "test", 0.9);

    store.applyCorrectionToDurableMemories({
      topicKey: "harbor",
      correction: "harbor=navy-ember",
    });

    const stored = store.getDurableMemory(memory.id);
    expect(stored?.confidence).toBeLessThan(0.4);
    expect(stored?.contradictionCount).toBe(1);
  });

  it("filters by threshold", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "random text", "ok", makeEmbedding(1));
    store.addEpisode("s2", "different topic", "ok", makeEmbedding(2));

    const results = store.retrieve(makeEmbedding(1), 5, 0.99);
    if (results.length > 0) {
      expect(results[0].similarity).toBeGreaterThanOrEqual(0.99);
    }
  });

  it("builds memory context", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "user likes sushi", "noted your preference", makeEmbedding(1));
    const ctx = store.buildMemoryContext(makeEmbedding(1), 5);
    expect(ctx).toContain("sushi");
  });

  it("deletes episodes by id", () => {
    const store = new MemoryStore();
    const ep = store.addEpisode("s1", "test", "ok", makeEmbedding(1));
    expect(store.count()).toBe(1);
    expect(store.deleteEpisode(ep.id)).toBe(true);
    expect(store.count()).toBe(0);
  });

  it("returns false when deleting non-existent", () => {
    const store = new MemoryStore();
    expect(store.deleteEpisode("nonexistent")).toBe(false);
  });

  it("clears all episodes", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "a", "b", makeEmbedding(1));
    store.addEpisode("s2", "c", "d", makeEmbedding(2));
    store.clearAll();
    expect(store.count()).toBe(0);
  });

  it("tracks stats", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "a", "b", makeEmbedding(1));
    store.addEpisode("s1", "c", "d", makeEmbedding(2));
    const stats = store.getStats();
    expect(stats.totalEpisodes).toBe(2);
    expect(stats.totalSessions).toBe(1);
    expect(stats.newestTimestamp).toBeGreaterThan(0);
  });

  it("returns recent episodes in reverse order", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "first", "ok", makeEmbedding(1));
    store.addEpisode("s1", "second", "ok", makeEmbedding(2));
    const recent = store.getRecent(2);
    expect(recent[0].userMessage).toBe("second");
    expect(recent[1].userMessage).toBe("first");
  });

  it("handles empty retrieval gracefully", () => {
    const store = new MemoryStore();
    expect(store.retrieve(null, 5, 0.5)).toEqual([]);
    expect(store.retrieve([], 5, 0.5)).toEqual([]);
  });

  it("skips episodes embedded with a different model", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "about dogs", "woof", makeEmbedding(1), "remote:openrouter/openai/text-embedding-3-small");
    store.addEpisode("s2", "about cats", "meow", makeEmbedding(1), "local-hash");

    const remote = store.retrieve(makeEmbedding(1), 5, 0.1, "remote:openrouter/openai/text-embedding-3-small");
    expect(remote).toHaveLength(1);
    expect(remote[0].episode.userMessage).toBe("about dogs");

    const local = store.retrieve(makeEmbedding(1), 5, 0.1, "local-hash");
    expect(local).toHaveLength(1);
    expect(local[0].episode.userMessage).toBe("about cats");
  });

  it("includes legacy episodes without an embedding model tag", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "legacy episode", "ok", makeEmbedding(1));

    const results = store.retrieve(makeEmbedding(1), 5, 0.1, "local-hash");
    expect(results).toHaveLength(1);
    expect(results[0].episode.userMessage).toBe("legacy episode");
  });

  it("persists and reloads from disk", () => {
    const store1 = new MemoryStore();
    store1.addEpisode("s1", "persisted message", "ok", makeEmbedding(1));
    const store2 = new MemoryStore();
    expect(store2.count()).toBe(1);
    expect(store2.getAll()[0].userMessage).toBe("persisted message");
  });

  it("hybrid retrieval surfaces keyword-strong docs that cosine alone misses", () => {
    const store = new MemoryStore();
    const queryVec = [1, 0];
    const weakCosTarget = [0.1, Math.sqrt(0.99)];
    const midCosNoise = [0.5, Math.sqrt(0.75)];
    store.addEpisode("s1", "nginx port configuration lives in ports.conf", "ok", weakCosTarget, "local-hash");
    store.addEpisode("s1", "tomato soup recipe with basil", "ok", midCosNoise, "local-hash");

    const cosineOnly = store.buildMemoryItems(queryVec, 3, "local-hash");
    expect(cosineOnly).toHaveLength(1);
    expect(cosineOnly[0].text).toContain("tomato soup");

    const hybrid = store.buildMemoryItems(queryVec, 3, "local-hash", "nginx port configuration");
    expect(hybrid[0].text).toContain("nginx port configuration");
  });

  it("falls back to BM25 keyword retrieval when no embedding exists", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "the quarterly revenue report is ready", "ok", makeEmbedding(1));
    store.addEpisode("s1", "cat pictures are funny", "ok", makeEmbedding(2));

    const items = store.buildMemoryItems(null, 2, undefined, "quarterly revenue report");
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("quarterly revenue report");
  });

  it("consolidates near-duplicate episodes into a durable fact with provenance", () => {
    const store = new MemoryStore();
    store.addEpisode("s1", "user prefers dark mode in the editor", "ok", makeEmbedding(1));
    store.addEpisode("s2", "user prefers dark mode in the editor.", "ok", makeEmbedding(2));

    const report = store.consolidateEpisodes({ threshold: 0.6 });
    expect(report.clusters).toBe(1);
    expect(report.created).toBe(1);

    const fact = store.listDurableMemories().find((m) => m.provenance === "consolidation");
    expect(fact).toBeDefined();
    expect(fact?.sourceEpisodeIds).toHaveLength(2);
    expect(fact?.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("merges clustered candidates into matching durable memories", () => {
    const store = new MemoryStore();
    store.addDurableMemory("preference", "user prefers dark mode in editor", "test", 0.8);
    store.addEpisode("s1", "user prefers dark mode in the editor", "ok", makeEmbedding(1));
    store.addEpisode("s2", "user prefers dark mode in the editor.", "ok", makeEmbedding(2));

    const report = store.consolidateEpisodes({ threshold: 0.6 });
    expect(report.merged).toBe(1);
    expect(report.created).toBe(0);
    const fact = store.listDurableMemories()[0];
    expect(fact.sourceEpisodeIds).toHaveLength(2);
    expect(fact.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("challenges both sides when a cluster contradicts an existing durable fact", () => {
    const store = new MemoryStore();
    const existing = store.addDurableMemory("preference", "user prefers dark mode in the editor", "test", 0.9);
    store.addEpisode("s1", "user does not prefer dark mode in the editor", "ok", makeEmbedding(1));
    store.addEpisode("s2", "user does not prefer dark mode in the editor.", "ok", makeEmbedding(2));

    const report = store.consolidateEpisodes({ threshold: 0.6 });
    expect(report.challenged).toBe(2);

    const after = store.listDurableMemories();
    const oldFact = after.find((m) => m.id === existing.id);
    const newFact = after.find((m) => m.id !== existing.id);
    expect(oldFact?.contradictionCount).toBeGreaterThanOrEqual(1);
    expect(newFact?.contradictionCount).toBeGreaterThanOrEqual(1);
    expect(oldFact?.confidence).toBeLessThan(0.9);
    expect(newFact?.confidence).toBeLessThan(0.5);
  });
});
