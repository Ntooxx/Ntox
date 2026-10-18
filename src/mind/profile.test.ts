import { describe, expect, it } from "vitest";
import {
  buildProfile,
  deriveNarrative,
  freshProfile,
  profileComponents,
  profileDivergence,
  profileHash,
  voiceFromLedger,
  type CognitiveProfile,
} from "./profile.js";
import type { IdentityData } from "./identity.js";
import type { LedgerStats } from "./outcome-ledger.js";

function identity(overrides: Partial<IdentityData> = {}): IdentityData {
  return {
    narrative: "",
    values: ["evidence over fluency", "learn from correction"],
    activeProjects: [],
    positions: [],
    revisionLog: [],
    ...overrides,
  };
}

function trainedIdentity(overrides: Partial<IdentityData> = {}): IdentityData {
  return identity({
    narrative: "I am shaped by many turns",
    values: ["evidence over fluency", "learn from correction", "prefer tests"],
    positions: [
      { topic: "testing", stance: "prefer property tests", confidence: 0.8, evidence: ["c:1"], updatedAt: 1 },
      { topic: "style", stance: "be terse", confidence: 0.7, evidence: ["c:2"], updatedAt: 2 },
    ],
    ...overrides,
  });
}

function ledgerStats(overrides: Partial<LedgerStats> = {}): LedgerStats {
  return {
    total: 100,
    avgScore: 0.1,
    correctedRate: 0.05,
    thankedRate: 0.3,
    abandonedRate: 0.02,
    toolFailureRate: 0.01,
    avgPredictionError: 0.2,
    avgLatencyMs: 500,
    avgTokens: 800,
    predictionSources: {},
    avgPredictionTokens: 0,
    byKind: [],
    byStrategy: [],
    ...overrides,
  };
}

describe("buildProfile", () => {
  it("sorts and caps profile sections", () => {
    const profile = buildProfile({
      identity: trainedIdentity(),
      patterns: [
        { name: "weak", strength: 0.2, domains: ["a"] },
        { name: "strong", strength: 0.9, domains: ["b"] },
      ],
      theories: [
        { name: "t1", confidence: 0.4 },
        { name: "t2", confidence: 0.9 },
      ],
      skills: ["beta", "alpha", "alpha"],
      strategyWeights: { coding: { verify: 1 } },
      voice: { directness: 0.8, verbosity: 0.3 },
    });
    expect(profile.patterns[0].name).toBe("strong");
    expect(profile.topTheories[0].name).toBe("t2");
    expect(profile.skills).toEqual(["alpha", "beta"]);
    expect(profile.voice).toEqual({ directness: 0.8, verbosity: 0.3 });
    expect(profile.positions.map((p) => p.topic)).toEqual(["style", "testing"]);
  });
});

describe("profileDivergence", () => {
  it("is zero for identical profiles", () => {
    const a = buildProfile({ identity: trainedIdentity() });
    const b = buildProfile({ identity: trainedIdentity() });
    expect(profileDivergence(a, b)).toBe(0);
  });

  it("is high between trained and fresh profiles", () => {
    const trained = buildProfile({
      identity: trainedIdentity(),
      patterns: [{ name: "feedback loops", strength: 0.8, domains: ["physics"] }],
      theories: [{ name: "Theory: feedback", confidence: 0.7 }],
      skills: ["debugging"],
      strategyWeights: { coding: { verify: 1 } },
      voice: { directness: 0.9, verbosity: 0.2 },
    });
    const divergence = profileDivergence(trained, freshProfile());
    expect(divergence).toBeGreaterThan(0.4);
    const components = profileComponents(trained, freshProfile());
    expect(components.positions).toBeGreaterThan(0);
    expect(components.strategies).toBeGreaterThan(0);
  });

  it("detects stance changes on shared topics", () => {
    const a: CognitiveProfile = buildProfile({
      identity: identity({
        positions: [{ topic: "testing", stance: "prefer unit tests", confidence: 0.7, evidence: [], updatedAt: 1 }],
      }),
    });
    const b: CognitiveProfile = buildProfile({
      identity: identity({
        positions: [{ topic: "testing", stance: "prefer property tests", confidence: 0.7, evidence: [], updatedAt: 1 }],
      }),
    });
    expect(profileDivergence(a, b)).toBeGreaterThan(0);
  });
});

describe("profileHash", () => {
  it("changes when the profile changes", () => {
    const before = profileHash(buildProfile({ identity: trainedIdentity() }));
    const after = profileHash(
      buildProfile({
        identity: trainedIdentity({
          positions: [
            { topic: "testing", stance: "prefer property tests", confidence: 0.8, evidence: [], updatedAt: 1 },
            { topic: "style", stance: "be verbose", confidence: 0.7, evidence: [], updatedAt: 2 },
          ],
        }),
      }),
    );
    expect(after).not.toBe(before);
  });
});

describe("voiceFromLedger", () => {
  it("defaults to neutral on empty ledger", () => {
    expect(voiceFromLedger(undefined)).toEqual({ directness: 0.5, verbosity: 0.5 });
    expect(voiceFromLedger(ledgerStats({ total: 0 }))).toEqual({ directness: 0.5, verbosity: 0.5 });
  });

  it("rewards thanked turns and penalizes corrections", () => {
    const voice = voiceFromLedger(ledgerStats({ thankedRate: 0.6, correctedRate: 0.1 }));
    expect(voice.directness).toBeGreaterThan(0.5);
  });
});

describe("deriveNarrative", () => {
  it("mentions domains and positions", () => {
    const narrative = deriveNarrative({
      identity: trainedIdentity(),
      strongDomains: ["programming"],
      weakDomains: ["economics"],
      totalTurns: 250,
    });
    expect(narrative).toContain("250");
    expect(narrative).toContain("programming");
    expect(narrative).toContain("economics");
    expect(narrative.length).toBeLessThanOrEqual(600);
  });

  it("handles an empty identity", () => {
    const narrative = deriveNarrative({ identity: identity() });
    expect(narrative).toContain("evidence-first");
  });
});
