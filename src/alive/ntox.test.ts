import { describe, expect, it } from "vitest";
import { AliveEngine } from "./engine.js";
import { failedToolNextStep, NtoxAliveBridge, toolOutcomeToAliveEvent } from "./ntox.js";

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

  it("adds concise next-step guidance to failed tool wake context", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());

    bridge.recordToolOutcome({
      sessionId: "session",
      toolName: "read",
      success: false,
      error: "ENOENT: release manifest",
    });

    expect(failedToolNextStep({ sessionId: "session", toolName: "read", success: false, error: "ENOENT" })).toContain(
      "Verify the path",
    );
    expect(bridge.consumeWakeContext()).toContain("Next step: Verify the path or discover the target before retrying.");
  });

  it("exposes an inspection snapshot without consuming pending actions", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());

    bridge.recordEvent({ type: "file_changed", source: "test", significance: 0.9, payload: { path: "src/a.ts" } });

    const snapshot = bridge.inspect();
    expect(snapshot.events[0].type).toBe("file_changed");
    expect(snapshot.pendingActions[0].kind).toBe("wake");
    expect(bridge.consumeWakeContext()).toContain("Significant file_changed event");
  });
});
