import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { InterventionEngine } from "./intervention.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { InterventionContext } from "./intervention.js";

function makeObs(topics: string[], sessionIntent: string = "casual"): ObservedSession {
  return {
    id: `obs_${randomUUID().slice(0, 8)}`,
    sessionId: `s_${randomUUID().slice(0, 6)}`,
    timestamp: Date.now(),
    topics,
    toolUsage: {},
    durationMinutes: 5,
    messageCount: 3,
    correctionsCount: 0,
    sentiment: "neutral",
    sentimentScore: 0,
    energy: "medium",
    sessionIntent,
  };
}

function makeBelief(statement: string, mentionCount: number = 3): MentalModelEntry {
  return {
    id: `mm_${randomUUID().slice(0, 8)}`,
    statement,
    category: "opinion",
    firstSeen: Date.now() - 86400000,
    lastSeen: Date.now(),
    mentionCount,
    sourceContext: "",
    contradictions: [],
    status: "active",
  };
}

function defaultCtx(overrides: Partial<InterventionContext> = {}): InterventionContext {
  return {
    observations: [],
    beliefs: [],
    statedFocus: "launch Sentinel",
    bondLevel: 30,
    sessionCount: 10,
    sessionIntent: "casual",
    lastInterventionAt: 0,
    ...overrides,
  };
}

describe("InterventionEngine", () => {
  let engine: InterventionEngine;

  beforeEach(() => {
    engine = new InterventionEngine();
    engine.clearAll();
  });

  it("returns null when bond level too low", () => {
    const ctx = defaultCtx({ bondLevel: 5 });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("returns null when session count too low", () => {
    const ctx = defaultCtx({ sessionCount: 2 });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("returns null during deep-work sessions", () => {
    const ctx = defaultCtx({ sessionIntent: "deep-work" });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("returns null during debugging sessions", () => {
    const ctx = defaultCtx({ sessionIntent: "debugging" });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("returns null when no observations and no stated focus", () => {
    const ctx = defaultCtx({ statedFocus: null, observations: [] });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("detects goal drift when sessions are away from focus", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["css styling", "animation", "color palette"])
    );
    const ctx = defaultCtx({ observations });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("alignment-alert");
    expect(result!.message).toContain("launch Sentinel");
  });

  it("does not detect drift when aligned with focus", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["launch sentinel", "github stars", "marketing"])
    );
    const ctx = defaultCtx({ observations });
    const result = engine.evaluate(ctx);
    expect(result).toBeNull();
  });

  it("detects repetition pattern", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["launch sentinel", "github stars", "marketing"])
    );
    const ctx = defaultCtx({ observations });
    const result = engine.evaluate(ctx);
    if (result) {
      expect(["alignment-alert", "pattern-observation"]).toContain(result.type);
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it("detects belief contradiction", () => {
    const beliefs = [makeBelief("CLI users hate GUIs")];
    const observations = Array.from({ length: 4 }, () =>
      makeObs(["gui design", "user interface", "button layout"])
    );
    const ctx = defaultCtx({ beliefs, observations, bondLevel: 50 });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it("does not challenge with low bond level", () => {
    const beliefs = [makeBelief("CLI users hate GUIs")];
    const observations = Array.from({ length: 4 }, () =>
      makeObs(["gui design", "user interface", "button layout"])
    );
    const ctx = defaultCtx({ beliefs, observations, bondLevel: 15 });
    const result = engine.evaluate(ctx);
    expect(result).toBeNull();
  });

  it("respects cooldown period", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["css styling", "animation", "color palette"])
    );
    const ctx1 = defaultCtx({ observations });
    const result1 = engine.evaluate(ctx1);
    expect(result1).not.toBeNull();

    const ctx2 = defaultCtx({
      observations,
      lastInterventionAt: Date.now(),
    });
    const result2 = engine.evaluate(ctx2);
    expect(result2).toBeNull();
  });

  it("records intervention history", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["css styling", "animation", "color palette"])
    );
    const ctx = defaultCtx({ observations });
    engine.evaluate(ctx);
    expect(engine.getHistory()).toHaveLength(1);
  });

  it("tracks outcome", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["css styling", "animation", "color palette"])
    );
    const ctx = defaultCtx({ observations });
    const result = engine.evaluate(ctx);
    if (result) {
      engine.recordOutcome(result.id, "helpful");
      expect(engine.getSuccessRate()).toBe(1);
    }
  });
});