import { describe, expect, it } from "vitest";
import { AliveEngine } from "./engine.js";
import { NtoxAliveBridge, toolOutcomeToAliveEvent } from "./ntox.js";

describe("NtoxAliveBridge", () => {
  it("maps NTOX test tool outcomes into benchmark events", () => {
    const event = toolOutcomeToAliveEvent(
      { sessionId: "session", toolName: "shell", success: true },
      { command: "npm test" },
    );

    expect(event).toMatchObject({
      type: "test_finished",
      source: "ntox-tool",
      payload: { status: "passed", toolName: "shell" },
    });
  });

  it("turns a failed test prediction into wake context for the next NTOX turn", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine({ wakePredictionError: 0.6 }));
    const prediction = bridge.engine.createPrediction({
      statement: "The suite will pass.",
      confidence: 0.8,
      expectation: { eventType: "test_finished", payload: { status: "passed" } },
    });

    const pulse = bridge.recordToolOutcome(
      { sessionId: "session", toolName: "shell", success: false, error: "tests failed" },
      { command: "npm test" },
    );
    const resolved = bridge.recordEvent({
      type: "test_finished",
      source: "ntox-tool",
      predictionId: prediction.id,
      payload: { status: "failed" },
    });

    expect(pulse.actions).toContainEqual(expect.objectContaining({ kind: "wake" }));
    expect(resolved.actions).toContainEqual(expect.objectContaining({ kind: "learn" }));
    expect(bridge.consumeWakeContext()).toContain("NTOX Alive");
  });
});
