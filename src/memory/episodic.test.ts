import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { MemoryStore, cosineSimilarity } from "./episodic.js";
import { DURABLE_MEMORY_PATH, EPISODES_PATH } from "../core/config.js";

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

  it("persists and reloads from disk", () => {
    const store1 = new MemoryStore();
    store1.addEpisode("s1", "persisted message", "ok", makeEmbedding(1));
    const store2 = new MemoryStore();
    expect(store2.count()).toBe(1);
    expect(store2.getAll()[0].userMessage).toBe("persisted message");
  });
});
