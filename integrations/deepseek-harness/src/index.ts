import type { Context } from "@deepseek-ai/cordis";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { createCognitiveLayer, extractCorrection, isUserCorrection } from "ntox/cognition";
import type { CognitiveLayer, CognitiveLayerOptions } from "ntox/cognition";

export const name = "ntox-cognition";
export const inject = ["agents", "tools"];

export interface Config {
  cognitionEnabled?: boolean;
  memoryEnabled?: boolean;
  theoryEnabled?: boolean;
  mistakesEnabled?: boolean;
  strategyEnabled?: boolean;
  storeEnabled?: boolean;
  memoryRetrievalCount?: number;
  maxToolOutcomesPerTurn?: number;
}

export const Config: z<Config> = z.object({
  cognitionEnabled: z.boolean().default(true),
  memoryEnabled: z.boolean().default(true),
  theoryEnabled: z.boolean().default(true),
  mistakesEnabled: z.boolean().default(true),
  strategyEnabled: z.boolean().default(true),
  storeEnabled: z.boolean().default(true),
  memoryRetrievalCount: z.number().step(1).min(1).default(5),
  maxToolOutcomesPerTurn: z.number().step(1).min(1).default(20),
});

interface TurnState {
  userMessage: string;
  assistantResponse: string;
  correction?: {
    topicKey: string;
    correction: string;
    wrongAnswer?: string;
  };
}

function blocksToText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function latestUserText(messages: readonly UserMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.source.kind === "plugin" && message.source.plugin === name) continue;
    const text = blocksToText(message.content).trim();
    if (text) return text;
  }
  return "";
}

function latestTurn(agent: Agent): number | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index--) {
    const event = agent.session.events[index];
    if (event.type === "turn/start") return event.data.turn;
  }
  return undefined;
}

function stateKey(sessionId: string, turn: number): string {
  return `${sessionId}:${turn}`;
}

function correctionFor(userMessage: string, previousAssistantResponse?: string): TurnState["correction"] {
  if (!isUserCorrection(userMessage)) return undefined;
  const assignmentKeys = [...userMessage.matchAll(/\b([a-z][a-z0-9_-]*)\s*=/gi)].map((match) => match[1]);
  const extracted = extractCorrection(userMessage, previousAssistantResponse ?? "");
  return {
    topicKey: assignmentKeys.length > 0 ? assignmentKeys.join(" ") : extracted.topicKey,
    correction: extracted.correction,
    ...(previousAssistantResponse ? { wrongAnswer: previousAssistantResponse } : {}),
  };
}

function layerOptions(config: Config): CognitiveLayerOptions {
  return {
    cognitionEnabled: config.cognitionEnabled,
    memoryEnabled: config.memoryEnabled,
    theoryEnabled: config.theoryEnabled,
    mistakesEnabled: config.mistakesEnabled,
    strategyEnabled: config.strategyEnabled,
    storeEnabled: config.storeEnabled,
    memoryRetrievalCount: config.memoryRetrievalCount,
    maxToolOutcomesPerTurn: config.maxToolOutcomesPerTurn,
  };
}

export function apply(ctx: Context, config: Config = {}): void {
  const layer = createCognitiveLayer(layerOptions(config));
  registerCognitiveLayer(ctx, layer);
}

export function registerCognitiveLayer(ctx: Context, layer: CognitiveLayer): void {
  const turns = new Map<string, TurnState>();
  const toolWork = new Map<string, Promise<void>>();
  const lastAssistantResponses = new Map<string, string>();

  ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next();
    if (decision.kind === "reject" || step !== 1 || signal.aborted) return decision;
    const userMessage = latestUserText(messages);
    if (!userMessage) return decision;
    const turnId = String(turn);
    const context = await layer.beforeStep({
      sessionId: String(agent.id),
      turnId,
      userMessage,
      workspace: agent.session.header.cwd,
    });
    if (signal.aborted) return decision;
    if (context.diagnostics.errors.length > 0) {
      ctx.logger.warn(`ntox-cognition context completed with errors: ${context.diagnostics.errors.join("; ")}`);
    }
    const sessionId = String(agent.id);
    turns.set(stateKey(sessionId, turn), {
      userMessage,
      assistantResponse: "",
      correction: correctionFor(userMessage, lastAssistantResponses.get(sessionId)),
    });
    if (!context.prompt) return decision;
    const cognitiveMessage = createUserMessage({
      content: [{ type: "text", text: context.prompt }],
      source: {
        kind: "plugin",
        plugin: name,
        form: "snapshot",
        sections: context.sections.map((section) => ({ name: section.name, text: section.content })),
      },
    });
    return { kind: "enter", messages: [...decision.messages, cognitiveMessage] };
  });

  ctx.on("tools/result", (exec: ToolExecution, result: ToolExecutionResult) => {
    const agent = exec.agent;
    const turn = agent ? latestTurn(agent) : undefined;
    if (!agent || turn === undefined || exec.signal.aborted) return;
    const key = stateKey(String(agent.id), turn);
    const previous = toolWork.get(key) ?? Promise.resolve();
    const next = previous
      .then(() =>
        layer.afterTool({
          sessionId: String(agent.id),
          turnId: String(turn),
          toolName: exec.name,
          success: !result.isError,
          ...(result.isError ? { error: result.error.message } : {}),
        }),
      )
      .catch((error: unknown) => {
        ctx.logger.warn(`ntox-cognition tool observer failed: ${String(error)}`);
      });
    toolWork.set(key, next);
  });

  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    if (event.type === "assistant/message") {
      const key = stateKey(String(session.id), event.data.turn);
      const state = turns.get(key);
      if (!state) return;
      const text = blocksToText(event.data.message.content).trim();
      if (text) state.assistantResponse = [state.assistantResponse, text].filter(Boolean).join("\n");
      return;
    }
    if (event.type !== "turn/end") return;
    const key = stateKey(String(session.id), event.data.turn);
    const state = turns.get(key);
    turns.delete(key);
    if (!state) return;
    const finish = async (): Promise<void> => {
      await toolWork.get(key);
      toolWork.delete(key);
      const learning = await layer.afterTurn({
        sessionId: String(session.id),
        turnId: String(event.data.turn),
        userMessage: state.userMessage,
        assistantResponse: state.assistantResponse,
        ...(state.correction ? { correction: state.correction } : {}),
      });
      if (state.assistantResponse) {
        lastAssistantResponses.set(String(session.id), state.assistantResponse);
      }
      if (learning.errors.length > 0) {
        ctx.logger.warn(`ntox-cognition learning completed with errors: ${learning.errors.join("; ")}`);
      }
    };
    void finish().catch((error: unknown) => {
      ctx.logger.warn(`ntox-cognition turn observer failed: ${String(error)}`);
    });
  });
}
