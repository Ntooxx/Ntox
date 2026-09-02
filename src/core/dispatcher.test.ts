import { describe, expect, it, vi } from "vitest";
import { GatewayOutput, SessionManager, runAgentMessage } from "./dispatcher.js";
import { Agent } from "./agent.js";
import type { AgentConfig } from "./agent.js";

describe("GatewayOutput", () => {
  it("buffers tokens", () => {
    const out = new GatewayOutput();
    out.onToken("hello ");
    out.onToken("world");
    expect(out.flush()).toBe("hello world");
  });

  it("calls notifyTyping every 50 tokens", () => {
    const notify = vi.fn();
    const out = new GatewayOutput(notify);
    for (let i = 0; i < 100; i++) out.onToken("a ");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("calls notifyTyping on tool call", () => {
    const notify = vi.fn();
    const out = new GatewayOutput(notify);
    out.onToolCall("read", {});
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("tracks tool calls", () => {
    const out = new GatewayOutput();
    out.onToolCall("read", {});
    out.onToolCall("write", {});
    expect(out.toolCalls).toEqual(["read", "write"]);
  });

  it("emits structured UI events", () => {
    const onEvent = vi.fn();
    const out = new GatewayOutput(undefined, undefined, onEvent);
    out.onToolCall("read", { path: "README.md" });
    out.onPhase("thinking");
    expect(onEvent).toHaveBeenCalledWith({ type: "tool_call", name: "read", args: { path: "README.md" } });
    expect(onEvent).toHaveBeenCalledWith({ type: "phase", phase: "thinking" });
  });

  it("trims buffer on flush", () => {
    const out = new GatewayOutput();
    out.onToken("  hello  ");
    expect(out.flush()).toBe("hello");
  });
});

describe("SessionManager", () => {
  it("creates and returns the same agent for same id", () => {
    const sm = new SessionManager();
    const agent1 = sm.getOrCreate("chat1", {} as AgentConfig);
    const agent2 = sm.getOrCreate("chat1", {} as AgentConfig);
    expect(agent1).toBe(agent2);
  });

  it("creates different agents for different ids", () => {
    const sm = new SessionManager();
    const agent1 = sm.getOrCreate("chat1", {} as AgentConfig);
    const agent2 = sm.getOrCreate("chat2", {} as AgentConfig);
    expect(agent1).not.toBe(agent2);
  });

  it("tracks active sessions", () => {
    const sm = new SessionManager(10_000);
    sm.getOrCreate("chat1", {} as AgentConfig);
    sm.getOrCreate("chat2", {} as AgentConfig);
    const status = sm.status();
    expect(status.sessions).toBe(2);
    expect(status.ids).toContain("chat1");
    expect(status.ids).toContain("chat2");
  });

  it("locks and unlocks", () => {
    const sm = new SessionManager();
    expect(sm.lock("chat1")).toBe(true);
    expect(sm.lock("chat1")).toBe(false);
    expect(sm.isLocked("chat1")).toBe(true);
    sm.unlock("chat1");
    expect(sm.isLocked("chat1")).toBe(false);
  });

  it("purges expired sessions", () => {
    const sm = new SessionManager(-1);
    sm.getOrCreate("chat1", {} as AgentConfig);
    sm.getOrCreate("chat2", {} as AgentConfig);
    const purged = sm.purge();
    expect(purged).toContain("chat1");
    expect(purged).toContain("chat2");
    expect(sm.status().sessions).toBe(0);
  });

  it("implements SessionStore interface", () => {
    const sm = new SessionManager();
    const agent = sm.getOrCreate("chat1", {} as AgentConfig);
    expect(sm.get("chat1")).toBe(agent);
    expect(sm.get("chat2")).toBeUndefined();
    sm.touch("chat1");
    expect(sm.getLastActivity("chat1")).toBeGreaterThan(0);
    expect(sm.getLastActivity("chat2")).toBe(0);
    expect(sm.getActiveChats()).toEqual(["chat1"]);
    sm.set("chat2", agent);
    expect(sm.get("chat2")).toBe(agent);
    sm.delete("chat1");
    expect(sm.get("chat1")).toBeUndefined();
  });

  it("set stores agent and updates activity", () => {
    const sm = new SessionManager();
    sm.getOrCreate("chat1", {} as AgentConfig);
    const agent2 = {} as Agent;
    sm.set("chat1", agent2);
    expect(sm.get("chat1")).toBe(agent2);
  });
});

describe("runAgentMessage", () => {
  it("returns error when agent.run throws", async () => {
    const agent = { run: vi.fn().mockReturnValue((async function*() { yield "x"; throw new Error("fail"); })()) } as unknown as Agent;
    const output = new GatewayOutput();
    const result = await runAgentMessage(agent, "hello", output);
    expect(result.error).toBe("fail");
  });
});
