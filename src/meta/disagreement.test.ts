import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DisagreementEngine } from "./disagreement.js";
import type { DisagreementContext } from "./disagreement.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { Risk } from "./executive.js";

const TEST_PATH = join(tmpdir(), `ntox-disag-test-${randomUUID().slice(0, 8)}.json`);

function makeObs(topics: string[]): ObservedSession {
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
    sessionIntent: "casual",
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

function makeRisk(description: string, severity: "high" | "medium" | "low" = "high", mentionCount: number = 5): Risk {
  return {
    description,
    severity,
    firstIdentified: Date.now() - 86400000 * 5,
    lastMentioned: Date.now(),
    mentionCount,
  };
}

function defaultCtx(overrides: Partial<DisagreementContext> = {}): DisagreementContext {
  return {
    proposal: "",
    observations: [],
    beliefs: [],
    risks: [],
    mistakeHistory: [],
    bondLevel: 70,
    sessionCount: 10,
    ...overrides,
  };
}

describe("DisagreementEngine", () => {
  let engine: DisagreementEngine;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    engine = new DisagreementEngine();
    engine.clearAll();
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("returns null when bond level too low", () => {
    const ctx = defaultCtx({ proposal: "rewrite everything in Rust", bondLevel: 30 });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("returns null when proposal too short", () => {
    const ctx = defaultCtx({ proposal: "hi" });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("detects past failure", () => {
    const ctx = defaultCtx({
      proposal: "rewrite the parser module from scratch",
      mistakeHistory: ["Rewrote parser module — introduced 3 regressions"],
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence.some((e) => e.includes("parser"))).toBe(true);
  });

  it("detects risk neglect", () => {
    const ctx = defaultCtx({
      proposal: "build new features for the product",
      risks: [makeRisk("No distribution channel", "high", 5)],
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence.some((e) => e.includes("distribution"))).toBe(true);
  });

  it("detects pattern repetition", () => {
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["refactoring", "code cleanup", "type safety"])
    );
    const ctx = defaultCtx({
      proposal: "let's do more refactoring on the core modules",
      observations,
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence.some((e) => e.includes("refactoring"))).toBe(true);
  });

  it("detects belief contradiction", () => {
    const beliefs = [makeBelief("CLI users hate GUIs", 5)];
    const ctx = defaultCtx({
      proposal: "let's build a GUI because CLI users like graphical interfaces",
      beliefs,
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence.some((e) => e.includes("hate"))).toBe(true);
  });

  it("combines multiple evidence sources", () => {
    const beliefs = [makeBelief("CLI users hate GUIs", 5)];
    const observations = Array.from({ length: 6 }, () =>
      makeObs(["refactoring", "code cleanup"])
    );
    const ctx = defaultCtx({
      proposal: "let's add a GUI and also rewrite the parser",
      beliefs,
      observations,
      mistakeHistory: ["Rewrote parser — broke everything"],
      risks: [makeRisk("No distribution", "high", 5)],
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence.length).toBeGreaterThan(1);
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it("returns null with insufficient evidence", () => {
    const ctx = defaultCtx({
      proposal: "let's write some unit tests for the auth module",
    });
    expect(engine.evaluate(ctx)).toBeNull();
  });

  it("records outcome", () => {
    const ctx = defaultCtx({
      proposal: "rewrite the parser",
      mistakeHistory: ["Rewrote parser — broke everything"],
    });
    const result = engine.evaluate(ctx);
    if (result) {
      engine.recordOutcome(result.id, "accepted");
      expect(engine.getSuccessRate()).toBe(1);
    }
  });

  it("tracks history", () => {
    const ctx = defaultCtx({
      proposal: "rewrite the parser",
      mistakeHistory: ["Rewrote parser — broke everything"],
    });
    engine.evaluate(ctx);
    expect(engine.getHistory()).toHaveLength(1);
  });

  it("formats disagreement message", () => {
    const ctx = defaultCtx({
      proposal: "rewrite the parser from scratch",
      mistakeHistory: ["Rewrote parser — introduced regressions"],
    });
    const result = engine.evaluate(ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("parser");
    expect(result!.confidence).toBeGreaterThan(0);
  });
});