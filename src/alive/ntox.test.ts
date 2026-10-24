import { afterEach, describe, expect, it, vi } from "vitest";
import { AliveEngine } from "./engine.js";
import { failedToolNextStep, NtoxAliveBridge, toolOutcomeToAliveEvent } from "./ntox.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("delivers wake and notify actions to subscribers together with their event", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const seen: Array<{ kind: string; type?: string }> = [];
    const unsubscribe = bridge.subscribe((action, event) => seen.push({ kind: action.kind, type: event?.type }));

    bridge.recordEvent({ type: "git_commit", source: "git-watcher", significance: 0.8, payload: { head: "abcdef1" } });
    bridge.recordEvent({
      type: "file_changed",
      source: "workspace-watcher",
      significance: 0.1,
      payload: { path: "src/a.ts" },
    });

    expect(seen).toEqual([{ kind: "wake", type: "git_commit" }]);

    unsubscribe();
    bridge.recordEvent({ type: "git_commit", source: "git-watcher", significance: 0.9 });
    expect(seen).toHaveLength(1);
  });

  it("notifies subscribers when pulse() blocks an open loop on its deadline", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const seen: string[] = [];
    bridge.subscribe((action) => seen.push(action.reason));

    bridge.createOpenLoop({ goal: "Ship 4.2", deadline: 1000 });
    bridge.pulse(2000);

    expect(seen).toEqual(["Open loop deadline reached: Ship 4.2"]);
  });

  it("keeps recording when a subscriber throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bridge = new NtoxAliveBridge(new AliveEngine());
    bridge.subscribe(() => {
      throw new Error("listener boom");
    });

    const pulse = bridge.recordEvent({ type: "git_commit", source: "git-watcher", significance: 0.9 });

    expect(pulse.actions).toContainEqual(expect.objectContaining({ kind: "wake" }));
    expect(log).toHaveBeenCalledWith("[alive] action listener failed:", expect.any(Error));
    expect(bridge.inspect().pendingActions.length).toBeGreaterThan(0);
  });
});
