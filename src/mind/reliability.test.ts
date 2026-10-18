import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReliabilityStore } from "./reliability.js";

function tempStore(): ReliabilityStore {
  return new ReliabilityStore({ path: join(mkdtempSync(join(tmpdir(), "ntox-rel-")), "reliability.json") });
}

describe("ReliabilityStore", () => {
  it("starts at neutral", () => {
    const store = tempStore();
    expect(store.score("memory", "ep_1")).toBeCloseTo(0.5, 5);
  });

  it("raises score for repeated positives", () => {
    const store = tempStore();
    for (let i = 0; i < 5; i++) store.record("memory", "ep_good", true);
    expect(store.score("memory", "ep_good")).toBeGreaterThan(0.7);
  });

  it("lowers score for repeated negatives", () => {
    const store = tempStore();
    for (let i = 0; i < 5; i++) store.record("memory", "ep_bad", false);
    expect(store.score("memory", "ep_bad")).toBeLessThan(0.3);
  });

  it("ranks by relevance times reliability", () => {
    const store = tempStore();
    store.record("memory", "ep_a", true);
    store.record("memory", "ep_a", true);
    store.record("memory", "ep_b", false);
    store.record("memory", "ep_b", false);
    const ranked = store.rank([
      { kind: "memory", id: "ep_a", relevance: 0.9 },
      { kind: "memory", id: "ep_b", relevance: 0.9 },
    ]);
    expect(ranked[0].id).toBe("ep_a");
  });

  it("keeps a neutral new memory competitive with an unreliable old one", () => {
    const store = tempStore();
    store.record("memory", "ep_old", false);
    const ranked = store.rank([
      { kind: "memory", id: "ep_old", relevance: 0.6 },
      { kind: "memory", id: "ep_new", relevance: 0.6 },
    ]);
    expect(ranked[0].id).toBe("ep_new");
  });

  it("ranks three good turns above ten corrected turns at equal relevance", () => {
    const store = tempStore();
    for (let i = 0; i < 3; i++) store.record("memory", "ep_good", true, 0.6);
    for (let i = 0; i < 10; i++) store.record("memory", "ep_bad", false, -0.8);
    const ranked = store.rank([
      { kind: "memory", id: "ep_good", relevance: 0.7 },
      { kind: "memory", id: "ep_bad", relevance: 0.7 },
    ]);
    expect(ranked[0].id).toBe("ep_good");
    expect(store.score("memory", "ep_good")).toBeGreaterThan(store.score("memory", "ep_bad"));
  });

  it("decays stale entries below fresh ones of equal reliability", () => {
    const base = 1_700_000_000_000;
    let now = base;
    const store = new ReliabilityStore({
      path: join(mkdtempSync(join(tmpdir(), "ntox-rel-")), "reliability.json"),
      now: () => now,
    });
    store.record("memory", "ep_old", true, 0.5);
    store.record("memory", "ep_old", true, 0.5);
    now = base + 180 * 86_400_000;
    store.record("memory", "ep_new", true, 0.5);
    store.record("memory", "ep_new", true, 0.5);

    const ranked = store.rank([
      { kind: "memory", id: "ep_old", relevance: 0.8 },
      { kind: "memory", id: "ep_new", relevance: 0.8 },
    ]);
    expect(ranked[0].id).toBe("ep_new");
  });

  it("credit term separates equal-reliability items by outcome history", () => {
    const store = tempStore();
    for (let i = 0; i < 4; i++) {
      store.record("memory", "ep_positive", true, 0.6);
      store.record("memory", "ep_neutral", true, 0);
    }
    const ranked = store.rank([
      { kind: "memory", id: "ep_neutral", relevance: 0.8 },
      { kind: "memory", id: "ep_positive", relevance: 0.8 },
    ]);
    expect(ranked[0].id).toBe("ep_positive");
  });
});
