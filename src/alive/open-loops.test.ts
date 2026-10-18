import { describe, expect, it } from "vitest";
import { extractOpenLoops, normalizeLoopGoal } from "./open-loops.js";
import { AliveEngine } from "./engine.js";

describe("extractOpenLoops", () => {
  it("extracts a commitment with next evidence", () => {
    const loops = extractOpenLoops("I'll check the build config and get back to you.");
    expect(loops).toHaveLength(1);
    expect(loops[0].goal).toContain("Check the build config");
    expect(loops[0].nextEvidence).toContain("Verify or refute");
    expect(loops[0].status).toBe("waiting_evidence");
  });

  it("extracts unresolved questions", () => {
    const loops = extractOpenLoops("We still don't know whether the cache invalidation order matters.");
    expect(loops).toHaveLength(1);
    expect(loops[0].goal).toContain("Resolve open question");
  });

  it("extracts todos", () => {
    const loops = extractOpenLoops("TODO: update the readme with the new commands");
    expect(loops).toHaveLength(1);
    expect(loops[0].goal).toBe("update the readme with the new commands");
  });

  it("dedupes repeated commitments and caps at max", () => {
    const text =
      "I'll check the build config. I'll check the build config again. TODO: update readme. TODO: fix flaky test.";
    const loops = extractOpenLoops(text, 2);
    expect(loops).toHaveLength(2);
    const goals = loops.map((l) => normalizeLoopGoal(l.goal));
    expect(new Set(goals).size).toBe(2);
  });

  it("returns nothing for plain statements", () => {
    expect(extractOpenLoops("The weather is nice today and the tests pass.")).toEqual([]);
  });

  it("always gives every loop a next evidence step", () => {
    const loops = extractOpenLoops("I'll verify the token budget math. We still don't know the p95 latency.");
    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) {
      expect(loop.nextEvidence).toBeTruthy();
      expect(loop.nextEvidence!.length).toBeGreaterThan(3);
    }
  });
});

describe("open loops in AliveEngine", () => {
  it("creates loops that the engine surfaces", () => {
    const engine = new AliveEngine();
    for (const loop of extractOpenLoops("I'll check the deployment pipeline health checks.")) {
      engine.createOpenLoop(loop);
    }
    expect(engine.getState().openLoops).toHaveLength(1);
    expect(engine.getState().openLoops[0].nextEvidence).toContain("Verify");
  });

  it("completes loops with evidence and ignores unknown ids", () => {
    const engine = new AliveEngine();
    const loop = engine.createOpenLoop({ goal: "Check cache config", nextEvidence: "verify" });
    const completed = engine.completeOpenLoop(loop.id, "process_exited: cache warm");
    expect(completed?.status).toBe("completed");
    expect(completed?.lastEvidence).toContain("cache warm");
    expect(engine.completeOpenLoop(loop.id, "again")).toBeNull();
    expect(engine.completeOpenLoop("missing", "x")).toBeNull();
  });

  it("resolves turn predictions and wakes on high error", () => {
    const engine = new AliveEngine();
    const prediction = engine.createPrediction({
      statement: "Turn: produces a plan",
      confidence: 0.9,
      expectation: { eventType: "turn_resolved", payload: { outcome: "ok" } },
    });
    const pulse = engine.recordEvent({
      type: "turn_resolved",
      source: "ntox-mind",
      payload: { outcome: "bad", score: -0.8, corrected: true },
      predictionId: prediction.id,
      significance: 0.9,
    });
    expect(pulse.resolvedPredictions).toHaveLength(1);
    expect(pulse.resolvedPredictions[0].status).toBe("falsified");
    expect(pulse.resolvedPredictions[0].predictionError).toBeGreaterThanOrEqual(0.6);
    expect(pulse.actions.some((a) => a.kind === "wake")).toBe(true);
  });

  it("confirms turn predictions when the expectation holds", () => {
    const engine = new AliveEngine();
    const prediction = engine.createPrediction({
      statement: "Turn: brief reply",
      confidence: 0.6,
      expectation: { eventType: "turn_resolved", payload: { outcome: "ok" } },
    });
    const pulse = engine.recordEvent({
      type: "turn_resolved",
      source: "ntox-mind",
      payload: { outcome: "ok", score: 0.6 },
      predictionId: prediction.id,
    });
    expect(pulse.resolvedPredictions[0].status).toBe("confirmed");
    expect(pulse.resolvedPredictions[0].predictionError).toBeLessThan(0.6);
  });
});
