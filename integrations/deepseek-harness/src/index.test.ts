import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import type { CognitiveLayer, CognitiveStepContext } from "ntox/cognition";
import { registerCognitiveLayer } from "./index.js";

type Handler = (...args: never[]) => unknown;

function createContext(): {
  ctx: Context;
  handlers: Map<string, Handler>;
} {
  const handlers = new Map<string, Handler>();
  const ctx = {
    logger: { warn: vi.fn() },
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
  };
  return { ctx: ctx as unknown as Context, handlers };
}

function createLayer(): {
  layer: CognitiveLayer;
  beforeStep: ReturnType<typeof vi.fn>;
  afterTool: ReturnType<typeof vi.fn>;
  afterTurn: ReturnType<typeof vi.fn>;
} {
  const context: CognitiveStepContext = {
    sessionId: "session-1",
    turnId: "1",
    queryType: "coding",
    embedding: null,
    sections: [{ name: "strategy", content: "Use the coding strategy." }],
    prompt: "## NTOX Cognitive Context\n\nUse the coding strategy.",
    diagnostics: {
      patternCount: 0,
      memoryIncluded: false,
      theoryIncluded: false,
      correctionIncluded: false,
      recoveryIncluded: false,
      errors: [],
    },
  };
  const beforeStep = vi.fn(async () => context);
  const afterTool = vi.fn(async () => undefined);
  const afterTurn = vi.fn(async () => ({
    sessionId: "session-1",
    turnId: "1",
    theoryUpdated: true,
    compiledPatterns: [],
    toolOutcomes: [],
    review: { gaps: [], shouldRetry: false, correctionPrompt: "" },
    errors: [],
  }));
  return {
    layer: { beforeStep, afterTool, afterTurn },
    beforeStep,
    afterTool,
    afterTurn,
  };
}

function createAgent(): Agent {
  return {
    id: "session-1",
    session: {
      id: "session-1",
      header: { cwd: "C:/workspace" },
      events: [{ type: "turn/start", data: { turn: 1 } }],
    },
  } as unknown as Agent;
}

describe("registerCognitiveLayer", () => {
  it("translates Harness lifecycle events into cognitive layer calls", async () => {
    const { ctx, handlers } = createContext();
    const { layer, beforeStep, afterTool, afterTurn } = createLayer();
    const agent = createAgent();
    let releaseTool: () => void = () => undefined;
    const toolSettled = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    afterTool.mockImplementationOnce(async () => toolSettled);
    registerCognitiveLayer(ctx, layer);

    const preStep = handlers.get("agent/pre-step") as unknown as (
      payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ) => Promise<PreStepDecision>;
    const userMessage = createUserMessage({
      content: [{ type: "text", text: "Implement the adapter" }],
      source: { kind: "user" },
    });
    const runtimeContext = createUserMessage({
      content: [{ type: "text", text: "Current runtime context." }],
      source: { kind: "user" },
    });
    const decision = await preStep(
      { agent, messages: [userMessage], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({
        kind: "enter",
        messages: [userMessage, runtimeContext],
      }),
    );

    expect(beforeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        turnId: "1",
        userMessage: "Implement the adapter",
        workspace: "C:/workspace",
      }),
    );
    expect(decision.kind).toBe("enter");
    if (decision.kind === "enter") {
      expect(decision.messages).toHaveLength(3);
      expect(decision.messages[2].source.kind).toBe("plugin");
    }

    const toolResult = handlers.get("tools/result") as unknown as (
      exec: ToolExecution,
      result: ToolExecutionResult,
    ) => void;
    toolResult(
      {
        agent,
        name: "read",
        signal: new AbortController().signal,
      } as unknown as ToolExecution,
      { isError: false, value: {}, content: [] } as ToolExecutionResult,
    );
    await vi.waitFor(() =>
      expect(afterTool).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          turnId: "1",
          toolName: "read",
          success: true,
        }),
      ),
    );

    const sessionEvent = handlers.get("session/event") as unknown as (session: Session, event: SessionEvent) => void;
    sessionEvent(agent.session, {
      type: "assistant/message",
      data: {
        turn: 1,
        step: 1,
        message: {
          content: [{ type: "text", text: "Adapter implemented." }],
        },
      },
    } as SessionEvent);
    sessionEvent(agent.session, {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "stop" } },
    } as SessionEvent);

    expect(afterTurn).not.toHaveBeenCalled();
    releaseTool();
    await vi.waitFor(() =>
      expect(afterTurn).toHaveBeenCalledWith({
        sessionId: "session-1",
        turnId: "1",
        userMessage: "Implement the adapter",
        assistantResponse: "Adapter implemented.",
      }),
    );
  });

  it("turns Harness correction messages into cognitive corrections", async () => {
    const { ctx, handlers } = createContext();
    const { layer, afterTurn } = createLayer();
    const agent = createAgent();
    registerCognitiveLayer(ctx, layer);

    const preStep = handlers.get("agent/pre-step") as unknown as (
      payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ) => Promise<PreStepDecision>;
    const userMessage = createUserMessage({
      content: [{ type: "text", text: "Correct the deployment ledger: harbor=navy-ember." }],
      source: { kind: "user" },
    });
    await preStep(
      { agent, messages: [userMessage], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: "enter", messages: [userMessage] }),
    );

    const sessionEvent = handlers.get("session/event") as unknown as (session: Session, event: SessionEvent) => void;
    sessionEvent(agent.session, {
      type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "Acknowledged." }] } },
    } as SessionEvent);
    sessionEvent(agent.session, {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "stop" } },
    } as SessionEvent);

    await vi.waitFor(() =>
      expect(afterTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          correction: expect.objectContaining({
            topicKey: "harbor",
            correction: expect.stringContaining("harbor=navy-ember"),
          }),
        }),
      ),
    );
  });
});
