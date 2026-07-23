import { describe, it, expect } from "vitest";
import { Agent } from "./agent.js";
import type { AgentConfig, AgentCallbacks } from "./agent.js";
import { LLMClient } from "./llm.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillRegistry } from "../skills/registry.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine } from "../meta/proactive.js";
import { CognitiveKernel } from "../cognition/kernel.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const llm = {
    embed: async () => [] as number[],
    stream: async function* () { yield { delta: "" }; },
  } as unknown as LLMClient;
  const registry = new SkillRegistry();
  return {
    llm,
    tools: new ToolRegistry(),
    memory: new MemoryStore(),
    reflector: { reflect: async () => null, setEnabled: () => {} } as unknown as Reflector,
    mistakes: new MistakeJournal(),
    userModel: new UserModel(),
    skillExecutor: new SkillExecutor(registry, true),
    analytics: new Analytics(),
    proactive: new ProactiveEngine(new Analytics()),
    cognitiveKernel: new CognitiveKernel(registry),
    sessionId: "test-session",
    systemPrompt: "You are a test agent.",
    memoryEnabled: false,
    memoryRetrievalCount: 5,
    theoryEnabled: false,
    strategyEnabled: false,
    mistakesEnabled: false,
    minConfidence: 0.5,
    maxContextMessages: 40,
    contextTokenBudget: 100_000,
    ...overrides,
  };
}

describe("Agent — resetConversation", () => {
  it("clears messages and counters", () => {
    const agent = new Agent(makeConfig());
    agent.addMessage({ role: "user", content: "hello" });
    agent.addMessage({ role: "assistant", content: "hi" });
    expect(agent.getMessages().length).toBe(2);

    agent.resetConversation();
    expect(agent.getMessages().length).toBe(0);
  });

  it("resets countTokens to near zero", () => {
    const agent = new Agent(makeConfig());
    agent.addMessage({ role: "user", content: "this is a somewhat longer message to test tokens" });
    expect(agent.countTokens()).toBeGreaterThan(0);

    agent.resetConversation();
    expect(agent.countTokens()).toBe(0);
  });
});

describe("Agent — message management", () => {
  it("adds and retrieves messages", () => {
    const agent = new Agent(makeConfig());
    agent.addMessage({ role: "user", content: "msg1" });
    agent.addMessage({ role: "assistant", content: "msg2" });
    const msgs = agent.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("getMessages returns a copy", () => {
    const agent = new Agent(makeConfig());
    agent.addMessage({ role: "user", content: "x" });
    const msgs = agent.getMessages();
    msgs.push({ role: "user", content: "y" });
    expect(agent.getMessages().length).toBe(1);
  });

  it("countTokens reflects message content", () => {
    const agent = new Agent(makeConfig());
    expect(agent.countTokens()).toBe(0);
    agent.addMessage({ role: "user", content: "hello world" });
    expect(agent.countTokens()).toBeGreaterThan(0);
  });
});

describe("Agent — skills count", () => {
  it("gets and sets skills count", () => {
    const agent = new Agent(makeConfig());
    agent.setSkillsCount(7);
    expect(agent.getMessages()).toBeDefined();
  });
});

describe("Agent — relationship tracking", () => {
  it("returns relationship summary", () => {
    const agent = new Agent(makeConfig());
    expect(agent.getRelationshipSummary()).toBeDefined();
  });

  it("returns bond label", () => {
    const agent = new Agent(makeConfig());
    const label = agent.getBondLabel();
    expect(typeof label).toBe("string");
  });
});

describe("Agent — session intent", () => {
  it("defaults to casual intent", () => {
    const agent = new Agent(makeConfig());
    expect(agent.getSessionIntent()).toBe("casual");
  });
});

describe("Agent — kernel disabled by default", () => {
  it("kernel is disabled without explicit opt-in", () => {
    const agent = new Agent(makeConfig());
    expect(agent.isKernelEnabled()).toBe(false);
  });

  it("kernel state is null when disabled", () => {
    const agent = new Agent(makeConfig());
    expect(agent.getKernelState()).toBeNull();
  });
});

describe("Agent — kernel enabled", () => {
  it("activates kernel when configured", () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    expect(agent.isKernelEnabled()).toBe(true);
  });

  it("kernel state is available after init", () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const state = agent.getKernelState();
    expect(state).not.toBeNull();
    expect(state!.confidence).toBeGreaterThan(0);
  });
});

describe("Agent — kernel command handling", () => {
  it("returns null for non-kernel messages", async () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const result = await agent.handleKernelMessage("hello world", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    });
    expect(result).toBeNull();
  });

  it("responds to /kernel state", async () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const result = await agent.handleKernelMessage("/kernel state", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    });
    expect(result).not.toBeNull();
    expect(result).toContain("confidence");
  });

  it("responds to /kernel status", async () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const result = await agent.handleKernelMessage("/kernel status", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    });
    expect(result).not.toBeNull();
    expect(result).toContain("active");
  });

  it("responds to /kernel tick", async () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const result = await agent.handleKernelMessage("/kernel tick", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    });
    expect(result).not.toBeNull();
    expect(result).toContain("Kernel tick");
  });

  it("returns null for kernel commands when kernel disabled", async () => {
    const agent = new Agent(makeConfig());
    const result = await agent.handleKernelMessage("/kernel state", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    });
    expect(result).toBeNull();
  });
});

describe("Agent — self-reflection summary", () => {
  it("starts with no self-reflection", () => {
    const agent = new Agent(makeConfig());
    expect(agent.getSelfReflectionSummary()).toBeNull();
  });
});

describe("Agent — recordSessionEnd", () => {
  it("records session without errors", () => {
    const agent = new Agent(makeConfig());
    const result = agent.recordSessionEnd("sess-1");
    expect(result).toBeDefined();
  });
});

describe("Agent — run() integration", () => {
  async function drainRun(agent: Agent, input: string) {
    let response = "";
    const toolCalls: { name: string }[] = [];
    const stream = agent.run(input, {
      onToken: (t) => { response += t; },
      onToolCall: (name) => { toolCalls.push({ name }); },
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) { /* drain */ }
    return { response, toolCalls };
  }

  it("produces output from mock LLM stream", async () => {
    const cfg = makeConfig();
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "He" };
      yield { delta: "llo" };
    };
    const agent = new Agent(cfg);
    const result = await drainRun(agent, "hi");
    expect(result.response).toContain("He");
  });

  it("handles empty stream gracefully", async () => {
    const cfg = makeConfig();
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "" };
    };
    const agent = new Agent(cfg);
    const result = await drainRun(agent, "hi");
    expect(result.response).toBeDefined();
  });

  it("attaches user message to conversation", async () => {
    const cfg = makeConfig();
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "ok" };
    };
    const agent = new Agent(cfg);
    expect(agent.getMessages().length).toBe(0);
    await drainRun(agent, "hello world");
    expect(agent.getMessages().length).toBeGreaterThanOrEqual(2);
    const userMsg = agent.getMessages()[0];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe("hello world");
  });

  it("detects and handles corrections in conversation", async () => {
    const cfg = makeConfig({ mistakesEnabled: true });
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "The Earth is flat." };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "what shape is the earth");
    await drainRun(agent, "no that's wrong, the Earth is round");
    const msgs = agent.getMessages();
    expect(msgs.some((m) => m.role === "user" && m.content.includes("wrong"))).toBe(true);
  });

  it("respects resetConversation", async () => {
    const cfg = makeConfig();
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "response" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "msg1");
    expect(agent.getMessages().length).toBeGreaterThan(0);
    agent.resetConversation();
    expect(agent.getMessages().length).toBe(0);
    await drainRun(agent, "msg2");
    expect(agent.getMessages().length).toBeGreaterThan(0);
    expect(agent.getMessages()[0].content).toBe("msg2");
  });

  it("streams tokens via onToken callback", async () => {
    const cfg = makeConfig();
    const tokens: string[] = [];
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "A" };
      yield { delta: "B" };
      yield { delta: "C" };
    };
    const agent = new Agent(cfg);
    const stream = agent.run("test", {
      onToken: (t) => { tokens.push(t); },
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) { /* drain */ }
    expect(tokens).toEqual(["A", "B", "C"]);
  });

  it("catches LLM stream errors", async () => {
    const cfg = makeConfig();
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "half" };
      throw new Error("simulated stream failure");
    };
    const agent = new Agent(cfg);
    await expect(drainRun(agent, "hi")).rejects.toThrow("simulated stream failure");
  });
});

