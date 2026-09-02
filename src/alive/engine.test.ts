import { describe, expect, it } from "vitest";
import { AliveEngine } from "./engine.js";
import { InMemoryAliveStore } from "./store.js";

describe("AliveEngine", () => {
  it("ignores low-significance events without waking cognition", () => {
    const engine = new AliveEngine();

    const pulse = engine.recordEvent({ type: "file_changed", source: "filesystem" });

    expect(pulse.actions).toEqual([
      expect.objectContaining({ kind: "ignore", reason: "Low-significance file_changed event" }),
    ]);
  });

  it("learns from a falsified prediction and wakes only for material error", () => {
    const engine = new AliveEngine({ wakePredictionError: 0.6 });
    const prediction = engine.createPrediction({
      statement: "The memory benchmark will pass.",
      confidence: 0.81,
      expectation: { eventType: "test_finished", payload: { status: "passed" } },
    });

    const pulse = engine.recordEvent({
      type: "test_finished",
      source: "process",
      predictionId: prediction.id,
      payload: { status: "failed" },
    });

    expect(pulse.resolvedPredictions[0]).toMatchObject({
      status: "falsified",
      predictionError: 0.81,
    });
    expect(pulse.actions.map((action) => action.kind)).toEqual(["learn", "wake"]);
  });

  it("persists open loops and links later evidence to them", () => {
    const store = new InMemoryAliveStore();
    const engine = new AliveEngine({ store, now: () => 100 });
    const loop = engine.createOpenLoop({ goal: "Improve memory retrieval", nextEvidence: "Run an A/B benchmark" });
    const prediction = engine.createPrediction({
      statement: "Prediction-error weighting improves recall.",
      confidence: 0.7,
      expectation: { eventType: "benchmark_finished", payload: { winner: "weighted" } },
      openLoopId: loop.id,
    });

    engine.recordEvent({
      type: "benchmark_finished",
      source: "benchmark",
      predictionId: prediction.id,
      payload: { winner: "weighted" },
    });
    const restored = new AliveEngine({ store });

    expect(restored.getState().openLoops[0].lastEvidence).toBe("confirmed: benchmark_finished");
    expect(restored.getState().predictions[0].status).toBe("confirmed");
  });

  it("notifies the host when an open-loop deadline passes without invoking a model", () => {
    const engine = new AliveEngine({ now: () => 100 });
    const loop = engine.createOpenLoop({ goal: "Review release risk", deadline: 200 });

    const pulse = engine.pulse(200);

    expect(pulse.actions).toEqual([expect.objectContaining({ kind: "notify", openLoopId: loop.id })]);
    expect(engine.getState().openLoops[0].status).toBe("blocked");
  });
});
