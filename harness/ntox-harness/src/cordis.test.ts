import { describe, expect, it, vi } from "vitest";
import type { NtoxHarnessBridge } from "./bridge.js";
import { attachCordisEvents } from "./cordis.js";
import type { CordisContext } from "./cordis.js";

function fakeContext() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ctx: CordisContext = {
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  return { ctx, handlers };
}

describe("attachCordisEvents", () => {
  it("registers the three DSH lifecycle events", () => {
    const { ctx, handlers } = fakeContext();
    const bridge = {
      preStep: vi.fn().mockResolvedValue({ prompt: "context" }),
      onToolResult: vi.fn(),
      onTurnEnd: vi.fn(),
    } as unknown as NtoxHarnessBridge;
    attachCordisEvents(ctx, bridge);
    expect([...handlers.keys()]).toEqual(["agent/pre-step", "tools/result", "session/event"]);
  });

  it("extracts the last user message and forwards tool outcomes", async () => {
    const { ctx, handlers } = fakeContext();
    const preStep = vi.fn().mockResolvedValue({ prompt: "context" });
    const onToolResult = vi.fn();
    const bridge = { preStep, onToolResult, onTurnEnd: vi.fn() } as unknown as NtoxHarnessBridge;
    attachCordisEvents(ctx, bridge);

    await handlers.get("agent/pre-step")!({
      sessionId: "s1",
      turnId: "t1",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "verify the harbor ledger" },
      ],
    });
    expect(preStep).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", turnId: "t1", userMessage: "verify the harbor ledger" }),
    );

    await handlers.get("tools/result")!({ sessionId: "s1", name: "read" }, { success: true });
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ toolName: "read", success: true }));
  });

  it("ignores session events that are not turn-end", async () => {
    const { ctx, handlers } = fakeContext();
    const onTurnEnd = vi.fn();
    const bridge = { preStep: vi.fn(), onToolResult: vi.fn(), onTurnEnd } as unknown as NtoxHarnessBridge;
    attachCordisEvents(ctx, bridge);
    await handlers.get("session/event")!({ id: "s1" }, { type: "message" });
    expect(onTurnEnd).not.toHaveBeenCalled();
  });
});
