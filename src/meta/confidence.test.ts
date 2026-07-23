import { describe, it, expect } from "vitest";
import {
  computeDriftConfidence,
  computeBeliefContradictionConfidence,
  computePatternConfidence,
  formatConfidenceResult,
} from "./confidence.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";

function makeObservation(topics: string[], sessionIntent: string = "casual"): ObservedSession {
  return {
    id: `obs_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "test",
    timestamp: Date.now(),
    topics,
    toolUsage: {},
    durationMinutes: 5,
    messageCount: 1,
    correctionsCount: 0,
    sentiment: "neutral",
    sentimentScore: 0,
    energy: "medium",
    sessionIntent,
  };
}

function makeBelief(statement: string, mentionCount: number = 1): MentalModelEntry {
  return {
    id: `mm_${Math.random().toString(36).slice(2, 8)}`,
    statement,
    category: "opinion",
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    mentionCount,
    sourceContext: "",
    contradictions: [],
    status: "active",
  };
}

describe("computeDriftConfidence", () => {
  it("returns none when no stated focus", () => {
    const result = computeDriftConfidence([], null);
    expect(result.score).toBe(0);
    expect(result.label).toBe("none");
  });

  it("returns none when no observations", () => {
    const result = computeDriftConfidence([], "launch Sentinel");
    expect(result.score).toBe(0);
    expect(result.label).toBe("none");
  });

  it("returns low confidence with few observations", () => {
    const obs = [makeObservation(["unrelated topic"])];
    const result = computeDriftConfidence(obs, "launch Sentinel");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.5);
  });

  it("returns higher confidence with consistent drift", () => {
    const obs = Array.from({ length: 10 }, () =>
      makeObservation(["css styling", "color palette", "animation"])
    );
    const result = computeDriftConfidence(obs, "launch Sentinel");
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.reasoning).toContain("launch Sentinel");
  });

  it("returns low confidence when aligned", () => {
    const obs = Array.from({ length: 5 }, () =>
      makeObservation(["launch sentinel", "github stars", "marketing"])
    );
    const result = computeDriftConfidence(obs, "launch Sentinel");
    expect(result.score).toBeLessThan(0.2);
  });

  it("weights recent observations more heavily", () => {
    const early = Array.from({ length: 5 }, () =>
      makeObservation(["launch sentinel"])
    );
    const late = Array.from({ length: 5 }, () =>
      makeObservation(["css styling", "animations"])
    );
    const result = computeDriftConfidence([...early, ...late], "launch Sentinel");
    expect(result.score).toBeGreaterThan(0.2);
  });
});

describe("computeBeliefContradictionConfidence", () => {
  it("returns high confidence for opposite word pairs", () => {
    const belief = makeBelief("CLI users hate GUIs");
    const result = computeBeliefContradictionConfidence(belief, "users like graphical interfaces");
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.label).toBe("high");
  });

  it("returns high confidence for negation mismatch with shared words", () => {
    const belief = makeBelief("Users never read documentation");
    const result = computeBeliefContradictionConfidence(belief, "Users always read documentation");
    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.label).not.toBe("none");
  });

  it("returns moderate confidence for negation with 1 shared word", () => {
    const belief = makeBelief("The test suite is never run");
    const result = computeBeliefContradictionConfidence(belief, "The test suite is sometimes run");
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasoning).toContain("Negation mismatch");
  });

  it("returns none when no contradiction signals", () => {
    const belief = makeBelief("I like coffee");
    const result = computeBeliefContradictionConfidence(belief, "I prefer tea over coffee");
    expect(result.score).toBe(0);
    expect(result.label).toBe("none");
  });

  it("returns moderate confidence for strongly held beliefs being contradicted", () => {
    const belief = makeBelief("Speed performance matters most in the project", 5);
    const result = computeBeliefContradictionConfidence(belief, "Code quality performance matters most in the project");
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("computePatternConfidence", () => {
  it("returns none with no observations", () => {
    const result = computePatternConfidence(0, 0);
    expect(result.score).toBe(0);
    expect(result.label).toBe("none");
  });

  it("returns low confidence with few observations", () => {
    const result = computePatternConfidence(3, 5);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.5);
  });

  it("returns higher confidence with more observations", () => {
    const result = computePatternConfidence(8, 10);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("returns high confidence for consistent pattern", () => {
    const result = computePatternConfidence(9, 10);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.label).toBe("high");
  });

  it("returns low confidence for rare pattern", () => {
    const result = computePatternConfidence(1, 10);
    expect(result.score).toBeLessThan(0.2);
  });
});

describe("formatConfidenceResult", () => {
  it("formats high confidence", () => {
    const result = computePatternConfidence(9, 10);
    const formatted = formatConfidenceResult(result);
    expect(formatted).toContain("Confidence:");
    expect(formatted).toContain("%");
  });

  it("formats none confidence", () => {
    const result = computePatternConfidence(0, 0);
    const formatted = formatConfidenceResult(result);
    expect(formatted).toContain("Confidence:");
    expect(formatted).toContain("none");
  });
});