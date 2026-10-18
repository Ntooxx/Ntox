import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mind } from "./mind.js";

function tempMind(now?: () => number): Mind {
  return new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-mind-")), ...(now ? { now } : {}) });
}

const neutralSignals = {
  corrected: false,
  rephrased: false,
  thanked: false,
  abandoned: false,
  falseSuccess: false,
  toolFailure: false,
};

describe("Mind integration", () => {
  it("begins and finishes a turn with ledger rows", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "turn-1",
      sessionId: "s1",
      query: "read src/core/agent.ts and explain the loop",
      queryType: "coding",
      responseMode: "tool-execute",
    });
    expect(handle).not.toBeNull();
    if (!handle) return;

    mind.recordContextText(handle, "memory", "ep_1", "[2026-01-01] discussed loops", 0.8);
    mind.recordTool(handle, { name: "read", success: true, durationMs: 10 });

    const result = mind.finishTurn(handle, { ...neutralSignals, thanked: true }, { tokens: 100, latencyMs: 50 });
    expect(result?.score).toBeGreaterThan(0);
    expect(mind.ledger.recent(5)).toHaveLength(1);
    expect(mind.calibration.stats().count).toBe(1);
  });

  it("attributes credit to present context items", () => {
    const mind = tempMind();
    for (let i = 0; i < 3; i++) {
      const handle = mind.beginTurn({
        turnId: `turn-g${i}`,
        sessionId: "s1",
        query: "explain recursion with python",
        queryType: "coding",
        responseMode: "chat",
      });
      if (!handle) continue;
      mind.recordContextText(handle, "memory", "ep_good", "python recursion notes", 0.8);
      mind.finishTurn(handle, { ...neutralSignals, thanked: true });
    }
    let badId = "turn-bad";
    while (mind.ledger.shouldDisable(badId) === "memory") badId += "x";
    const badHandle = mind.beginTurn({
      turnId: badId,
      sessionId: "s1",
      query: "explain recursion",
      queryType: "coding",
      responseMode: "chat",
    });
    if (badHandle) {
      mind.recordContextText(badHandle, "memory", "ep_bad", "wrong recursion notes", 0.8);
      mind.finishTurn(badHandle, { ...neutralSignals, corrected: true });
    }

    expect(mind.reliability.score("memory", "ep_good")).toBeGreaterThan(mind.reliability.score("memory", "ep_bad"));
    expect(mind.reliability.score("memory", "ep_good")).toBeGreaterThan(0.5);
    expect(mind.reliability.score("memory", "ep_bad")).toBeLessThan(0.5);
  });

  it("skips context items whose kind is counterfactually disabled", () => {
    let tick = 0;
    const mind = tempMind(() => 1_700_000_000_000 + tick++);
    let sawDisabled = false;
    let sawEnabled = false;
    for (let i = 0; i < 40; i++) {
      const handle = mind.beginTurn({
        turnId: `turn-${i}-abcdef`,
        sessionId: "s1",
        query: "what is the capital of france",
        queryType: "factual",
        responseMode: "chat",
      });
      if (!handle) continue;
      if (handle.disabledKind === "memory") sawDisabled = true;
      else sawEnabled = true;
      mind.recordContextText(handle, "memory", `ep_${i}`, "some memory", 0.5);
      mind.finishTurn(handle, { ...neutralSignals });
    }
    expect(sawDisabled).toBe(true);
    expect(sawEnabled).toBe(true);
  });

  it("records corrections into identity positions", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "turn-c1",
      sessionId: "s1",
      query: "no, that is wrong about memory",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.finishTurn(
      handle,
      { ...neutralSignals, corrected: true },
      { correction: { topicKey: "memory", correction: "use cosine similarity, not dot product" } },
    );
    expect(mind.identity.get().positions).toHaveLength(1);
    expect(mind.identity.get().positions[0].topic).toBe("memory");
  });

  it("updates bandit rewards", () => {
    const mind = tempMind();
    for (let i = 0; i < 10; i++) {
      const handle = mind.beginTurn({
        turnId: `turn-band-${i}`,
        sessionId: "s1",
        query: "write a function that parses dates",
        queryType: "coding",
        responseMode: "chat",
      });
      if (!handle) continue;
      mind.finishTurn(handle, { ...neutralSignals, thanked: true });
    }
    const stats = mind.bandit.stats();
    expect(stats.contexts).toBeGreaterThan(0);
    expect(stats.arms.some((arm) => arm.pulls > 0)).toBe(true);
  });

  it("keys bandit by queryType:responseMode", () => {
    const mind = tempMind();
    for (let i = 0; i < 5; i++) {
      const h1 = mind.beginTurn({
        turnId: `t-key-${i}-a`,
        sessionId: "s1",
        query: "parse dates",
        queryType: "coding",
        responseMode: "chat",
      });
      if (h1) mind.finishTurn(h1, { ...neutralSignals, thanked: true });
      const h2 = mind.beginTurn({
        turnId: `t-key-${i}-b`,
        sessionId: "s1",
        query: "parse dates",
        queryType: "coding",
        responseMode: "tool-execute",
      });
      if (h2) mind.finishTurn(h2, { ...neutralSignals });
    }
    const stats = mind.bandit.stats();
    expect(Object.keys(stats.preferred)).toContain("coding:chat");
    expect(Object.keys(stats.preferred)).toContain("coding:tool-execute");
  });

  it("records per-variant calibration", () => {
    const mind = tempMind();
    for (let i = 0; i < 5; i++) {
      const handle = mind.beginTurn({
        turnId: `t-cal-${i}`,
        sessionId: "s1",
        query: "write a parser",
        queryType: "coding",
        responseMode: "chat",
      });
      if (!handle) continue;
      mind.finishTurn(handle, { ...neutralSignals, thanked: true });
    }
    const by = mind.stats().calibrationByStrategy;
    const total = Object.values(by).reduce((sum, s) => sum + s.count, 0);
    expect(total).toBe(5);
    expect(Object.values(by).some((s) => s.count > 0)).toBe(true);
  });

  it("stores banditReward on the ledger row", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-reward",
      sessionId: "s1",
      query: "write a parser",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.finishTurn(handle, { ...neutralSignals, thanked: true }, { costUsd: 0, latencyMs: 100 });
    const row = mind.ledger.recent(1)[0];
    expect(row.banditReward).toBeGreaterThanOrEqual(0);
    expect(row.banditReward).toBeLessThanOrEqual(1);
  });

  it("records droppedSections when provided", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-drop",
      sessionId: "s1",
      query: "write a parser",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.finishTurn(handle, { ...neutralSignals }, { droppedSections: ["theory", "search"] });
    const row = mind.ledger.recent(1)[0];
    expect(row.droppedSections).toEqual(["theory", "search"]);
  });

  it("bumps bandit exploration on high prediction error", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-surprise",
      sessionId: "s1",
      query: "write a parser for csv files",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    handle.prediction = { ...handle.prediction, confidence: 0.92 };
    const result = mind.finishTurn(handle, { ...neutralSignals, corrected: true });
    expect(result?.prediction.error).toBeGreaterThan(0.6);
    expect(mind.bandit.explorationRemaining("coding:chat")).toBe(2);
  });

  it("strengthens present context items on low prediction error with neutral score", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-calm",
      sessionId: "s1",
      query: "explain how the retry loop works",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.recordContextText(handle, "memory", "ep_steady", "retry loop notes", 0.7);
    const outcome = mind.predictor.resolve(
      handle.prediction,
      neutralSignals,
      handle.row.tools.map((t) => t.name),
    ).outcome;
    handle.prediction = { ...handle.prediction, confidence: outcome };
    const result = mind.finishTurn(handle, { ...neutralSignals });
    expect(result?.prediction.error).toBeLessThan(0.2);
    expect(result?.score).toBe(0);
    expect(mind.reliability.score("memory", "ep_steady")).toBeGreaterThan(0.5);
  });

  it("records prediction source and tokens on the row and in stats", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-src",
      sessionId: "s1",
      query: "write a parser",
      queryType: "coding",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.finishTurn(handle, { ...neutralSignals, thanked: true }, { predictionSource: "llm", predictionTokens: 90 });
    const row = mind.ledger.recent(1)[0];
    expect(row.predictionSource).toBe("llm");
    expect(row.predictionTokens).toBe(90);
    const stats = mind.stats();
    expect(stats.ledger.predictionSources["llm"]).toBe(1);
    expect(stats.ledger.avgPredictionTokens).toBe(90);
  });

  it("stores a query preview on rows for surprise review", () => {
    const mind = tempMind();
    const handle = mind.beginTurn({
      turnId: "t-preview",
      sessionId: "s1",
      query: "what is the deploy port for staging",
      queryType: "factual",
      responseMode: "chat",
    });
    if (!handle) return;
    mind.finishTurn(handle, { ...neutralSignals });
    const row = mind.ledger.recent(1)[0];
    expect(row.queryPreview).toBe("what is the deploy port for staging");
  });

  it("exposes identity summary and capability guidance", () => {
    const mind = tempMind();
    mind.identity.addPosition("tests", "always write tests", 0.9);
    expect(mind.identitySummary()).toContain("tests");
    expect(mind.capabilityGuidance(["unknown"])).toBe("");
  });

  it("returns null handles when disabled", () => {
    const mind = new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-mind-")), enabled: false });
    const handle = mind.beginTurn({
      turnId: "t",
      sessionId: "s",
      query: "hello",
      queryType: "general",
      responseMode: "chat",
    });
    expect(handle).toBeNull();
  });

  it("derives and refreshes the identity narrative from live stats", () => {
    const mind = tempMind();
    expect(mind.identity.get().narrative).toBe("");
    expect(mind.refreshNarrative()).toBe(true);
    const narrative = mind.identity.get().narrative;
    expect(narrative.length).toBeGreaterThan(10);
    expect(mind.refreshNarrative()).toBe(false);
    mind.identity.addPosition("tests", "always write tests", 0.9);
    expect(mind.refreshNarrative()).toBe(true);
    expect(mind.identity.get().narrative).toContain("tests");
  });

  it("builds a cognitive profile from bandit and ledger state", () => {
    const mind = tempMind();
    mind.bandit.update("coding:chat", "verify", 0.9);
    mind.bandit.flush();
    for (let i = 0; i < 3; i++) {
      const handle = mind.beginTurn({
        turnId: `t-prof-${i}`,
        sessionId: "s1",
        query: "write tests",
        queryType: "coding",
        responseMode: "chat",
      });
      if (!handle) continue;
      mind.finishTurn(handle, { ...neutralSignals, thanked: true }, { tokens: 200 });
    }
    const profile = mind.cognitiveProfile({
      patterns: [{ name: "feedback", strength: 0.8, domains: ["physics"] }],
      theories: [{ name: "Theory: feedback", confidence: 0.7 }],
      skills: ["debugging"],
    });
    expect(profile.patterns).toHaveLength(1);
    expect(profile.topTheories).toHaveLength(1);
    expect(profile.skills).toEqual(["debugging"]);
    expect(Object.keys(profile.strategyWeights).length).toBeGreaterThan(0);
    expect(profile.voice.directness).toBeGreaterThan(0.5);
  });
});
