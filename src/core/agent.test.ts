import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, commitsToImmediateAction, extractLegacyXmlToolCalls } from "./agent.js";
import type { AgentConfig, AgentCallbacks } from "./agent.js";
import { Mind } from "../mind/mind.js";
import { LLMClient } from "./llm.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/episodic.js";
import { UserModel } from "../memory/user-model.js";
import { Reflector } from "../meta/reflector.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillLibrary } from "../skills/library.js";
import { Analytics } from "../meta/analytics.js";
import { ProactiveEngine } from "../meta/proactive.js";
import { CognitiveKernel } from "../cognition/kernel.js";
import { AliveEngine } from "../alive/engine.js";
import { NtoxAliveBridge } from "../alive/ntox.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const llm = {
    embed: async () => [] as number[],
    embedWithMeta: async () => null as { vector: number[]; model: string } | null,
    stream: async function* () {
      yield { delta: "" };
    },
  } as unknown as LLMClient;
  const registry = new SkillRegistry();
  return {
    llm,
    tools: new ToolRegistry(),
    memory: new MemoryStore(),
    reflector: { reflect: async () => null, setEnabled: () => {} } as unknown as Reflector,
    mistakes: new MistakeJournal(),
    userModel: new UserModel(),
    skillExecutor: new SkillExecutor(registry, new SkillLibrary(), true),
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

  it("removes the last user turn and following assistant/tool messages", () => {
    const agent = new Agent(makeConfig());
    agent.addMessage({ role: "user", content: "first" });
    agent.addMessage({ role: "assistant", content: "one" });
    agent.addMessage({ role: "user", content: "second" });
    agent.addMessage({ role: "assistant", content: "two" });
    agent.addMessage({ role: "tool", content: "tool" });
    expect(agent.removeLastTurn()).toBe(true);
    expect(agent.getMessages()).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "one" },
    ]);
  });

  it("returns false when there is no user turn to remove", () => {
    const agent = new Agent(makeConfig());
    expect(agent.removeLastTurn()).toBe(false);
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

  it("does not hijack plain natural-language run/read messages", async () => {
    const agent = new Agent(makeConfig({ kernelEnabled: true }));
    agent.initKernel("test-base");
    const callbacks = {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    };
    expect(await agent.handleKernelMessage("run tests", callbacks)).toBeNull();
    expect(await agent.handleKernelMessage("read about photosynthesis", callbacks)).toBeNull();
    expect(await agent.handleKernelMessage("run npm test", callbacks)).toBeNull();
  });

  it("still handles explicit /kernel run and /kernel read", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "read",
      description: "read",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async () => ({ success: true, data: "file-content" }),
    });
    const agent = new Agent(makeConfig({ kernelEnabled: true, tools }));
    agent.initKernel("test-base");
    const callbacks = {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    };
    const result = await agent.handleKernelMessage("/kernel read notes.txt", callbacks);
    expect(result).toContain("file-content");
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
      onToken: (t) => {
        response += t;
      },
      onToolCall: (name) => {
        toolCalls.push({ name });
      },
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
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

  it("injects queued Alive wake context into the next model prompt", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    bridge.recordToolOutcome(
      { sessionId: "session", toolName: "shell", success: false, error: "test failure" },
      { command: "npm test" },
    );
    const cfg = makeConfig({ alive: bridge });
    let systemPrompt = "";
    (
      cfg.llm as unknown as { stream: (messages: unknown[], system: string) => AsyncGenerator<{ delta: string }> }
    ).stream = async function* (_messages, system) {
      systemPrompt = system;
      yield { delta: "ok" };
    };

    await drainRun(new Agent(cfg), "What changed?");

    expect(systemPrompt).toContain("NTOX Alive");
    expect(systemPrompt).toContain("Significant test_finished event");
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

  it("applies user corrections to durable memories", async () => {
    const cfg = makeConfig({ mistakesEnabled: true, memoryEnabled: true });
    cfg.memory.addDurableMemory("fact", "the harbor token is blue-ember", "test", 0.95);
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "the harbor token is blue-ember" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "what is the harbor token");
    await drainRun(agent, "no, that is wrong. the harbor token is navy-ember.");
    const memories = cfg.memory.listDurableMemories();
    expect(memories).toHaveLength(1);
    expect(memories[0].text).toContain("navy-ember");
    expect(memories[0].contradictionCount).toBeGreaterThanOrEqual(1);
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
      onToken: (t) => {
        tokens.push(t);
      },
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
    expect(tokens).toEqual(["A", "B", "C"]);
  });

  it("records trace for a normal turn", async () => {
    const cfg = makeConfig({ strategyEnabled: true });
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "ok" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "explain this system");
    const trace = agent.getLastTrace();
    expect(trace).not.toBeNull();
    expect(trace!.responseMode).toBe("simple-query");
    expect(trace!.strategy).toBeDefined();
    expect(trace!.finalResponseLength).toBe(2);
    expect(trace!.toolCalls).toEqual([]);
  });

  it("records trace for tool calls with redacted args", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "fake",
      description: "fake tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({ success: true, data: "done" }),
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    (
      cfg.llm as unknown as {
        stream: () => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* () {
      calls++;
      if (calls === 1) {
        yield {
          delta: "",
          toolCalls: [
            { id: "tc_1", name: "fake", arguments: JSON.stringify({ apiKey: "sk-secret", content: "x".repeat(250) }) },
          ],
        };
        return;
      }
      yield { delta: "done" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "run fake");
    const trace = agent.getLastTrace();
    expect(trace!.toolCalls).toHaveLength(1);
    expect(trace!.toolCalls[0].success).toBe(true);
    expect(trace!.toolCalls[0].args.apiKey).toBe("[redacted]");
    expect(String(trace!.toolCalls[0].args.content)).toHaveLength(200);
  });

  it("skips repeated identical failed tool calls in one turn", async () => {
    const tools = new ToolRegistry();
    let executed = 0;
    tools.register({
      name: "fake",
      description: "fake tool",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        executed++;
        return { success: false, error: "boom" };
      },
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    (
      cfg.llm as unknown as {
        stream: () => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* () {
      calls++;
      if (calls <= 2) {
        yield { delta: "", toolCalls: [{ id: `tc_${calls}`, name: "fake", arguments: JSON.stringify({ q: "same" }) }] };
        return;
      }
      yield { delta: "done" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "run fake");
    const trace = agent.getLastTrace();
    expect(executed).toBe(1);
    expect(trace!.toolCalls).toHaveLength(2);
    expect(trace!.toolCalls[1].success).toBe(false);
    expect(trace!.toolCalls[1].reason).toBe("repeat-skipped");
    expect(trace!.toolCalls[1].error).toContain("Repeated failed tool call skipped");
  });

  it("runs parallel-safe tool calls concurrently", async () => {
    const tools = new ToolRegistry();
    let active = 0;
    let maxActive = 0;
    tools.register({
      name: "slow_read",
      description: "slow read",
      parallelSafe: true,
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 40));
        active--;
        return { success: true, data: "ok" };
      },
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    (
      cfg.llm as unknown as {
        stream: () => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* () {
      calls++;
      if (calls === 1) {
        yield {
          delta: "",
          toolCalls: [
            { id: "tc_1", name: "slow_read", arguments: JSON.stringify({ n: 1 }) },
            { id: "tc_2", name: "slow_read", arguments: JSON.stringify({ n: 2 }) },
          ],
        };
        return;
      }
      yield { delta: "done" };
    };

    await drainRun(new Agent(cfg), "read both");
    expect(maxActive).toBe(2);
  });

  it("keeps unsafe tools as ordering barriers around parallel reads", async () => {
    const tools = new ToolRegistry();
    const observed: boolean[] = [];
    let mutated = false;
    tools.register({
      name: "observe",
      description: "observe",
      parallelSafe: true,
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        observed.push(mutated);
        return { success: true, data: mutated };
      },
    });
    tools.register({
      name: "mutate",
      description: "mutate",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        mutated = true;
        return { success: true, data: "mutated" };
      },
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    (
      cfg.llm as unknown as {
        stream: () => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* () {
      calls++;
      if (calls === 1) {
        yield {
          delta: "",
          toolCalls: [
            { id: "tc_1", name: "observe", arguments: JSON.stringify({ n: 1 }) },
            { id: "tc_2", name: "mutate", arguments: "{}" },
            { id: "tc_3", name: "observe", arguments: JSON.stringify({ n: 2 }) },
          ],
        };
        return;
      }
      yield { delta: "done" };
    };

    await drainRun(new Agent(cfg), "observe, mutate, observe");
    expect(observed).toEqual([false, true]);
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

  it("feeds failed tools into the cognitive layer recovery context on the next turn", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "fake_fail",
      description: "always fails",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({ success: false, error: "ENOENT: missing manifest" }),
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    let capturedSystem = "";
    (
      cfg.llm as unknown as {
        stream: (
          messages: unknown[],
          system: string,
        ) => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* (_messages, system) {
      calls++;
      capturedSystem = system;
      if (calls === 1) {
        yield { delta: "", toolCalls: [{ id: "tc_1", name: "fake_fail", arguments: "{}" }] };
        return;
      }
      yield { delta: "ok" };
    };
    const agent = new Agent(cfg);
    await drainRun(agent, "try the failing tool");
    await drainRun(agent, "what happened?");
    expect(capturedSystem).toContain("Tool Recovery Guidance");
    expect(capturedSystem).toContain("missing manifest");
  });
});

describe("Agent — prediction and surprise (M2)", () => {
  async function drainRun(agent: Agent, input: string) {
    let response = "";
    const stream = agent.run(input, {
      onToken: (t) => {
        response += t;
      },
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
    return response;
  }

  function predictionAwareLLM(cfg: AgentConfig, mainText: string) {
    let calls = 0;
    let predictionCalls = 0;
    (cfg.llm as unknown as { stream: (m: unknown[], s?: string) => AsyncGenerator<{ delta: string }> }).stream =
      async function* (_messages, system) {
        calls++;
        if (system && system.includes("predict the outcome of the next turn")) {
          predictionCalls++;
          yield {
            delta:
              '{"intent":"fact","answerShape":"explanation","expectedTools":[],"expectedOutcome":"gives the right answer","confidence":0.95}',
          };
          return;
        }
        yield { delta: mainText };
      };
    return { stats: () => ({ calls, predictionCalls }) };
  }

  it("uses the LLM prediction and stores it on the ledger row", async () => {
    const cfg = makeConfig({
      predictionLlmEnabled: true,
      mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-agent-mind-")) }),
    });
    const llm = predictionAwareLLM(cfg, "The capital of France is Paris.");
    await drainRun(new Agent(cfg), "what is the capital of france and why is it the capital exactly");
    expect(llm.stats().predictionCalls).toBe(1);
    const row = cfg.mind!.ledger.recent(1)[0];
    expect(row.predictionSource).toBe("llm");
    expect(row.prediction?.expectedOutcome).toBe("gives the right answer");
  });

  it("skips the LLM prediction for casual short queries", async () => {
    const cfg = makeConfig({
      predictionLlmEnabled: true,
      mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-agent-mind-")) }),
    });
    const llm = predictionAwareLLM(cfg, "hello there");
    await drainRun(new Agent(cfg), "hi");
    expect(llm.stats().predictionCalls).toBe(0);
    expect(cfg.mind!.ledger.recent(1)[0].predictionSource).toBe("heuristic");
  });

  it("stores a surprise memory, forces reflection, and resolves the alive prediction on a corrected turn", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    let reflections = 0;
    const cfg = makeConfig({
      predictionLlmEnabled: true,
      alive: bridge,
      mind: new Mind({ rootDir: mkdtempSync(join(tmpdir(), "ntox-agent-mind-")) }),
      memoryEnabled: true,
      mistakesEnabled: true,
      skipReflection: true,
    });
    cfg.reflector = {
      reflect: async () => {
        reflections++;
        return null;
      },
      setEnabled: () => {},
    } as unknown as Reflector;
    predictionAwareLLM(cfg, "The Earth is flat.");

    const agent = new Agent(cfg);
    await drainRun(agent, "what shape is the earth really");
    expect(reflections).toBe(0);

    await drainRun(agent, "no that's wrong, the Earth is actually round");

    const surpriseNotes = cfg.memory.listDurableMemories().filter((m) => m.provenance === "surprise");
    expect(surpriseNotes.length).toBeGreaterThanOrEqual(1);
    expect(surpriseNotes[0].text).toContain("Surprise:");
    expect(surpriseNotes[0].text).toContain("gives the right answer");

    expect(reflections).toBe(1);

    const state = bridge.engine.getState();
    expect(state.predictions.some((p) => p.status === "falsified")).toBe(true);
    expect(bridge.inspect().pendingActions.some((a) => a.kind === "wake")).toBe(true);

    const row = cfg.mind!.ledger.recent(1)[0];
    expect(row.predictionError).toBeGreaterThan(0.6);
    expect(cfg.mind!.bandit.explorationRemaining(`${row.queryType}:${row.responseMode}`)).toBe(2);
  });

  it("creates open loops from assistant commitments with next-evidence steps", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const cfg = makeConfig({ alive: bridge });
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "I'll check the build cache configuration later today." };
    };
    await drainRun(new Agent(cfg), "how is the build performance lately");
    const loops = bridge.engine.getState().openLoops;
    expect(loops).toHaveLength(1);
    expect(loops[0].goal).toContain("Check the build cache configuration");
    expect(loops[0].nextEvidence).toContain("Verify");
    expect(loops[0].status).toBe("waiting_evidence");

    await drainRun(new Agent(cfg), "how is the build performance lately");
    expect(bridge.engine.getState().openLoops).toHaveLength(1);
  });
});

describe("Agent — model critique (M3)", () => {
  async function drainRun(agent: Agent, input: string) {
    let response = "";
    const stream = agent.run(input, {
      onToken: (t) => {
        response += t;
      },
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
    return response;
  }

  function highStakesLLM(cfg: AgentConfig) {
    let critiqueCalls = 0;
    let mainCalls = 0;
    (
      cfg.llm as unknown as {
        stream: (
          m: unknown[],
          s?: string,
        ) => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* (_messages, system) {
      if (system && system.includes("strict reviewer")) {
        critiqueCalls++;
        yield { delta: '{"gaps":["misses the escaping edge case"],"retry":true}' };
        return;
      }
      mainCalls++;
      if (mainCalls === 1) {
        yield { delta: "", toolCalls: [{ id: "tc_1", name: "edit", arguments: JSON.stringify({ path: "a.ts" }) }] };
        return;
      }
      if (mainCalls === 2) {
        yield { delta: "Edited the file; the parser now handles quotes." };
        return;
      }
      yield { delta: "Fixed the parser by escaping backslashes before quote matching." };
    };
    return { critiqueCalls: () => critiqueCalls, mainCalls: () => mainCalls };
  }

  it("critiques a high-stakes turn once and retries with structured gaps", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "edit",
      description: "edit a file",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({ success: true, data: "ok" }),
    });
    const cfg = makeConfig({ tools, modelCritiqueEnabled: true, mistakesEnabled: true });
    const llm = highStakesLLM(cfg);
    const agent = new Agent(cfg);
    const response = await drainRun(agent, "please edit the broken parser file and explain the fix");

    expect(llm.critiqueCalls()).toBe(1);
    expect(llm.mainCalls()).toBeGreaterThanOrEqual(3);
    expect(response).toContain("escaping backslashes");

    const trace = agent.getLastTrace();
    expect(trace!.modelCritique).toEqual({ gaps: 1, retried: true });

    const journal = cfg.mistakes.getAll().find((m) => m.topicKey === "model-critique");
    expect(journal).toBeDefined();
    expect(journal?.correction).toContain("escaping edge case");
  });

  it("does not call the model critic when the flag is off", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "edit",
      description: "edit a file",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => ({ success: true, data: "ok" }),
    });
    const cfg = makeConfig({ tools });
    const llm = highStakesLLM(cfg);
    const agent = new Agent(cfg);
    const response = await drainRun(agent, "please edit the broken parser file and explain the fix");

    expect(llm.critiqueCalls()).toBe(0);
    expect(response).toContain("handles quotes");
    expect(agent.getLastTrace()?.modelCritique).toBeUndefined();
  });
});

describe("Agent � session resume", () => {
  const baseDir = process.env.NTOX_DIR!;
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(baseDir, "agent-resume-"));
    process.env.NTOX_DIR = dir;
  });

  afterEach(() => {
    process.env.NTOX_DIR = baseDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and restores conversation state", () => {
    const agent = new Agent(makeConfig({ sessionId: "resume-1", sessionSource: "test" }));
    agent.addMessage({ role: "user", content: "remember the plan" });
    agent.addMessage({ role: "assistant", content: "noted" });
    agent.saveSession();

    const next = new Agent(makeConfig({ sessionId: "resume-1", sessionSource: "test" }));
    const result = next.restoreSession();
    expect(result.restored).toBe(true);
    expect(result.messageCount).toBe(2);
    expect(result.source).toBe("test");
    expect(next.getMessages().map((message) => message.content)).toEqual(["remember the plan", "noted"]);
  });

  it("refuses to restore a session under a different id", () => {
    const agent = new Agent(makeConfig({ sessionId: "resume-2", sessionSource: "test" }));
    agent.addMessage({ role: "user", content: "private" });
    agent.saveSession();

    const other = new Agent(makeConfig({ sessionId: "resume-other", sessionSource: "test" }));
    expect(other.restoreSession("resume-2").restored).toBe(false);
  });

  it("deletes the snapshot when the conversation is reset", () => {
    const agent = new Agent(makeConfig({ sessionId: "resume-3", sessionSource: "test" }));
    agent.addMessage({ role: "user", content: "temporary" });
    agent.saveSession();
    agent.resetConversation();

    const next = new Agent(makeConfig({ sessionId: "resume-3", sessionSource: "test" }));
    expect(next.restoreSession().restored).toBe(false);
  });

  it("auto-saves after a completed turn", async () => {
    const cfg = makeConfig({ sessionId: "resume-turn", sessionSource: "test" });
    (cfg.llm as unknown as { stream: () => AsyncGenerator<{ delta: string }> }).stream = async function* () {
      yield { delta: "saved answer" };
    };
    const agent = new Agent(cfg);
    const stream = agent.run("persist this", {
      onToken: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }

    const next = new Agent(makeConfig({ sessionId: "resume-turn", sessionSource: "test" }));
    const restored = next.restoreSession();
    expect(restored.restored).toBe(true);
    expect(next.getMessages().some((message) => message.role === "user" && message.content === "persist this")).toBe(
      true,
    );
    expect(next.getMessages().some((message) => message.content === "saved answer")).toBe(true);
  });
});

describe("Agent — legacy XML tool calls and action nudges", () => {
  it("detects commitment language without tool intent", () => {
    expect(commitsToImmediateAction("Creating it now — one sec.")).toBe(true);
    expect(commitsToImmediateAction("Building it now.")).toBe(true);
    expect(commitsToImmediateAction("Let me create the file and I'll get back to you")).toBe(true);
    expect(commitsToImmediateAction("Working on it.")).toBe(true);
    expect(commitsToImmediateAction("Here is the answer to your question about photosynthesis.")).toBe(false);
    expect(commitsToImmediateAction("")).toBe(false);
    expect(commitsToImmediateAction("x".repeat(3000))).toBe(false);
  });

  it("extracts legacy XML tool calls and strips them from the response", () => {
    const text =
      'Working on it. <tool_call>{"name":"write","args":{"path":"game.html","content":"<h1>hi</h1>"}}</tool_call> Done.';
    const { calls, cleaned } = extractLegacyXmlToolCalls(text, (name) => name === "write");
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("write");
    expect(JSON.parse(calls[0].arguments).path).toBe("game.html");
    expect(cleaned).not.toContain("tool_call");
    expect(cleaned).toContain("Working on it.");
  });

  it("ignores unknown tool names and malformed JSON", () => {
    expect(
      extractLegacyXmlToolCalls('<tool_call>{"name":"evil","args":{}}</tool_call>', () => false).calls,
    ).toHaveLength(0);
    expect(extractLegacyXmlToolCalls("<tool_call>{not json}</tool_call>", () => true).calls).toHaveLength(0);
  });

  it("executes legacy XML tool calls from the response stream", async () => {
    const tools = new ToolRegistry();
    let executed = 0;
    tools.register({
      name: "write",
      description: "write a file",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async (args) => {
        executed++;
        return { success: true, data: String(args.path) };
      },
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    (
      cfg.llm as unknown as {
        stream: () => AsyncGenerator<{ delta: string; toolCalls?: { id: string; name: string; arguments: string }[] }>;
      }
    ).stream = async function* () {
      calls++;
      if (calls === 1) {
        yield {
          delta:
            'Creating the file now.  tool_call{"name":"write","args":{"path":"game.html","content":"x"}}  tool_call',
        };
        return;
      }
      yield { delta: "File created." };
    };
    const agent = new Agent(cfg);
    const toolCalls: { name: string }[] = [];
    const stream = agent.run("make a placeholder", {
      onToken: () => {},
      onToolCall: (name) => {
        toolCalls.push({ name });
      },
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
    expect(executed).toBe(1);
    expect(toolCalls.map((t) => t.name)).toContain("write");
    const assistantTexts = agent
      .getMessages()
      .filter((m) => m.role === "assistant" && !m.tool_calls)
      .map((m) => m.content);
    expect(assistantTexts.every((t) => !t.includes("tool_call"))).toBe(true);
    expect(agent.getLastTrace()?.toolCalls.some((t) => t.name === "write" && t.success)).toBe(true);
  });

  it("nudges the model when it promises action but emits no tool call", async () => {
    const tools = new ToolRegistry();
    let executed = 0;
    tools.register({
      name: "write",
      description: "write a file",
      parameters: { type: "object", properties: {}, required: [] },
      execute: async () => {
        executed++;
        return { success: true, data: "ok" };
      },
    });
    const cfg = makeConfig({ tools });
    let calls = 0;
    const seenPrompts: string[] = [];
    (
      cfg.llm as unknown as {
        stream: (messages: { role: string; content: string }[]) => AsyncGenerator<{
          delta: string;
          toolCalls?: { id: string; name: string; arguments: string }[];
        }>;
      }
    ).stream = async function* (messages) {
      calls++;
      seenPrompts.push(messages.map((m) => m.content).join("\n"));
      if (calls === 1) {
        yield { delta: "Creating it now — one sec." };
        return;
      }
      if (calls === 2) {
        yield {
          delta: "",
          toolCalls: [{ id: "tc_1", name: "write", arguments: JSON.stringify({ path: "a.txt", content: "x" }) }],
        };
        return;
      }
      yield { delta: "Done — file written." };
    };
    const agent = new Agent(cfg);
    let response = "";
    const toolCalls: { name: string }[] = [];
    const stream = agent.run("help me organize my project files into a cleaner structure", {
      onToken: (t) => {
        response += t;
      },
      onToolCall: (name) => {
        toolCalls.push({ name });
      },
      onToolResult: () => {},
      onUsage: () => {},
      onThinking: () => {},
    } as AgentCallbacks);
    for await (const _ of stream) {
      /* drain */
    }
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(executed).toBe(1);
    expect(seenPrompts.some((p) => p.includes("[ACTION REQUIRED]"))).toBe(true);
    expect(response).toContain("Done");
  });
});
