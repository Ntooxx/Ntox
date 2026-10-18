import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrategyBandit, banditContextKey, computeBanditReward } from "./bandit.js";
import { compileContext, type CompilableItem } from "./context-compiler.js";
import { CapabilityModel } from "./capability.js";

function tempBandit(rng?: () => number): StrategyBandit {
  return new StrategyBandit({
    path: join(mkdtempSync(join(tmpdir(), "ntox-bandit-")), "bandit.json"),
    ...(rng ? { rng } : {}),
  });
}

describe("StrategyBandit", () => {
  it("selects a variant for a context", () => {
    const bandit = tempBandit(() => 0.99);
    const variant = bandit.select("coding");
    expect(["standard", "direct", "verify", "clarify"]).toContain(variant);
  });

  it("prefers rewarded arms over time", () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const bandit = tempBandit(rng);
    for (let i = 0; i < 60; i++) {
      bandit.update("coding", "direct", 1);
      bandit.update("coding", "standard", 0);
    }
    const stats = bandit.stats();
    const direct = stats.arms.find((a) => a.strategy === "coding" && a.variant === "direct");
    const standard = stats.arms.find((a) => a.strategy === "coding" && a.variant === "standard");
    expect(direct?.mean ?? 0).toBeGreaterThan(standard?.mean ?? 1);
  });

  it("returns guidance only for non-standard variants", () => {
    const bandit = tempBandit();
    expect(bandit.guidance("standard")).toBe("");
    expect(bandit.guidance("verify")).toContain("Verify First");
  });

  it("keeps composite context keys independent", () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const bandit = tempBandit(rng);
    for (let i = 0; i < 40; i++) {
      bandit.update("coding:chat", "direct", 1);
      bandit.update("coding:tool-execute", "standard", 0);
    }
    const stats = bandit.stats();
    const chatDirect = stats.arms.find((a) => a.strategy === "coding:chat" && a.variant === "direct");
    const toolStandard = stats.arms.find((a) => a.strategy === "coding:tool-execute" && a.variant === "standard");
    expect(chatDirect?.mean ?? 0).toBeGreaterThan(toolStandard?.mean ?? 1);
  });

  it("forces exploration after a bump, then returns to posterior sampling", () => {
    const bandit = tempBandit(() => 0.75);
    for (let i = 0; i < 60; i++) bandit.update("coding:chat", "standard", 1);
    bandit.update("coding:chat", "clarify", 0);

    expect(bandit.select("coding:chat")).toBe("standard");

    bandit.bumpExploration("coding:chat", 2);
    expect(bandit.explorationRemaining("coding:chat")).toBe(2);
    expect(bandit.select("coding:chat")).toBe("clarify");
    expect(bandit.explorationRemaining("coding:chat")).toBe(1);
    expect(bandit.select("coding:chat")).toBe("clarify");
    expect(bandit.explorationRemaining("coding:chat")).toBe(0);
    expect(bandit.select("coding:chat")).toBe("standard");
  });
});

describe("banditContextKey", () => {
  it("joins queryType and responseMode", () => {
    expect(banditContextKey("coding", "tool-execute")).toBe("coding:tool-execute");
  });

  it("falls back to queryType when mode is empty", () => {
    expect(banditContextKey("coding", "")).toBe("coding");
    expect(banditContextKey("coding", "   ")).toBe("coding");
  });
});

describe("computeBanditReward", () => {
  it("returns base reward when cost and latency are zero", () => {
    expect(computeBanditReward(1, 0, 0)).toBeCloseTo(1, 5);
    expect(computeBanditReward(-1, 0, 0)).toBeCloseTo(0, 5);
  });

  it("penalizes cost and latency", () => {
    const clean = computeBanditReward(1, 0, 0);
    const costly = computeBanditReward(1, 0.1, 10_000);
    expect(costly).toBeLessThan(clean);
    expect(costly).toBeGreaterThan(0);
  });

  it("clamps to [0, 1]", () => {
    expect(computeBanditReward(-1, 100, 1_000_000)).toBe(0);
    expect(computeBanditReward(1, 0, 0)).toBeLessThanOrEqual(1);
    expect(computeBanditReward(1, 0, 0)).toBeGreaterThanOrEqual(0);
  });

  it("respects custom weights", () => {
    const noPenalty = computeBanditReward(1, 100, 100_000, { lambdaCost: 0, muLatency: 0 });
    expect(noPenalty).toBeCloseTo(1, 5);
  });
});

describe("compileContext", () => {
  const items: CompilableItem[] = [
    { kind: "memory", id: "a", tokens: 100, relevance: 0.9, reliability: 0.9 },
    { kind: "theory", id: "b", tokens: 400, relevance: 0.8, reliability: 0.5 },
    { kind: "skill", id: "c", tokens: 50, relevance: 0.4, reliability: 0.5 },
  ];

  it("includes everything under budget", () => {
    const result = compileContext(items, 1000);
    expect(result.included).toHaveLength(3);
    expect(result.dropped).toHaveLength(0);
  });

  it("drops low-utility expensive items over budget", () => {
    const result = compileContext(items, 200);
    expect(result.included.length).toBeLessThan(3);
    expect(result.included[0].id).toBe("a");
    expect(result.dropped.length).toBeGreaterThan(0);
  });

  it("always includes at least one item", () => {
    const result = compileContext(items, 1);
    expect(result.included.length).toBeGreaterThanOrEqual(1);
  });

  it("always includes pinned items first", () => {
    const pinned: CompilableItem[] = [
      ...items,
      { kind: "identity", id: "pin", tokens: 500, relevance: 0.1, reliability: 0.1, pinned: true },
    ];
    const result = compileContext(pinned, 100);
    expect(result.included.some((i) => i.id === "pin")).toBe(true);
  });

  it("sorts included items by order descending", () => {
    const ordered: CompilableItem[] = [
      { kind: "memory", id: "low", tokens: 10, relevance: 0.9, reliability: 0.9, order: 10 },
      { kind: "theory", id: "high", tokens: 10, relevance: 0.9, reliability: 0.9, order: 90 },
    ];
    const result = compileContext(ordered, 1000);
    expect(result.included.map((i) => i.id)).toEqual(["high", "low"]);
  });
});

describe("CapabilityModel", () => {
  it("tracks domain confidence", () => {
    const model = new CapabilityModel({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cap-")), "capability.json"),
    });
    for (let i = 0; i < 6; i++) model.record(["programming"], 0.5);
    expect(model.confidence("programming")).toBeGreaterThan(0.7);
    expect(model.guidance(["programming"])).toContain("high");
  });

  it("warns on weak domains", () => {
    const model = new CapabilityModel({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cap-")), "capability.json"),
    });
    for (let i = 0; i < 8; i++) model.record(["rust"], -0.6);
    expect(model.confidence("rust")).toBeLessThan(0.4);
    expect(model.guidance(["rust"])).toContain("low");
  });

  it("returns empty guidance for unknown domains", () => {
    const model = new CapabilityModel({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cap-")), "capability.json"),
    });
    expect(model.guidance(["unknown"])).toBe("");
    expect(model.guidance([])).toBe("");
  });
});

describe("CapabilityModel.decideStance", () => {
  function tempCap(): CapabilityModel {
    return new CapabilityModel({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cap-")), "capability.json"),
    });
  }

  it("overrides direct to clarify when a domain is weak", () => {
    const cap = tempCap();
    for (let i = 0; i < 10; i++) cap.record(["programming"], -0.5);
    const stance = cap.decideStance(["programming"], "direct");
    expect(stance.variantOverride).toBe("clarify");
    expect(stance.reason).toContain("programming");
    expect(stance.skipDebate).toBe(false);
  });

  it("overrides standard to verify when a domain is weak", () => {
    const cap = tempCap();
    for (let i = 0; i < 10; i++) cap.record(["programming"], -0.5);
    expect(cap.decideStance(["programming"], "standard").variantOverride).toBe("verify");
  });

  it("keeps verify and clarify when the domain is weak", () => {
    const cap = tempCap();
    for (let i = 0; i < 10; i++) cap.record(["programming"], -0.5);
    expect(cap.decideStance(["programming"], "verify").variantOverride).toBeUndefined();
    expect(cap.decideStance(["programming"], "clarify").variantOverride).toBeUndefined();
  });

  it("does not override when the domain is confident", () => {
    const cap = tempCap();
    for (let i = 0; i < 10; i++) cap.record(["programming"], 0.6);
    const stance = cap.decideStance(["programming"], "direct");
    expect(stance.variantOverride).toBeUndefined();
    expect(stance.skipDebate).toBe(true);
  });

  it("allows debate and keeps the variant with no capability data", () => {
    const cap = tempCap();
    const stance = cap.decideStance(["unknown-domain"], "direct");
    expect(stance.skipDebate).toBe(false);
    expect(stance.variantOverride).toBeUndefined();
  });

  it("does not treat under-sampled domains as known", () => {
    const cap = tempCap();
    cap.record(["fresh"], -0.9);
    const stance = cap.decideStance(["fresh"], "direct");
    expect(stance.variantOverride).toBeUndefined();
    expect(stance.skipDebate).toBe(false);
  });

  it("allows debate when any known domain is weak", () => {
    const cap = tempCap();
    for (let i = 0; i < 10; i++) cap.record(["strong"], 0.6);
    for (let i = 0; i < 10; i++) cap.record(["weak"], -0.5);
    const stance = cap.decideStance(["strong", "weak"], "verify");
    expect(stance.skipDebate).toBe(false);
    expect(stance.variantOverride).toBeUndefined();
  });
});
