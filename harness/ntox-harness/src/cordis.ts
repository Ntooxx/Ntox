import type { NtoxHarnessBridge } from "./bridge.js";

type EventHandler = (...args: any[]) => unknown;

export interface CordisContext {
  on(event: string, handler: EventHandler): void;
}

export interface CordisAdapters {
  sessionId?: (payload: any) => string;
  userMessage?: (payload: any) => string;
  turnId?: (payload: any) => string | undefined;
  toolName?: (execution: any) => string;
  success?: (execution: any, result: any) => boolean;
}

function lastUserMessage(payload: any): string {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string") return message.content;
  }
  return typeof payload?.userMessage === "string" ? payload.userMessage : "";
}

/**
 * Maps the three DeepSeek Harness lifecycle events into the Ntox bridge.
 * The exact decision object returned by `agent/pre-step` depends on the DSH
 * version, so the cognitive context is returned verbatim instead of being
 * shaped here: the plugin that registers this bridge decides how to inject it.
 */
export function attachCordisEvents(
  ctx: CordisContext,
  bridge: NtoxHarnessBridge,
  adapters: CordisAdapters = {},
): Record<string, EventHandler> {
  const handlers: Record<string, EventHandler> = {};

  handlers["agent/pre-step"] = async (payload: any) => {
    const sessionId = adapters.sessionId?.(payload) ?? payload?.sessionId ?? payload?.session?.id ?? "dsh-session";
    const turnId = adapters.turnId?.(payload) ?? payload?.turnId;
    const userMessage = adapters.userMessage?.(payload) ?? lastUserMessage(payload);
    return bridge.preStep({ sessionId, turnId, userMessage });
  };

  handlers["tools/result"] = async (execution: any, result: any) => {
    const sessionId = adapters.sessionId?.(execution) ?? execution?.sessionId ?? "dsh-session";
    const turnId = adapters.turnId?.(execution) ?? execution?.turnId;
    await bridge.onToolResult({
      sessionId,
      turnId,
      toolName: adapters.toolName?.(execution) ?? execution?.name ?? execution?.toolName ?? "unknown",
      success: adapters.success?.(execution, result) ?? result?.success !== false,
      error: result?.error,
      durationMs: result?.durationMs,
    });
  };

  handlers["session/event"] = async (session: any, event: any) => {
    if (event?.type !== "turn-end" && event?.type !== "turn_end") return;
    const sessionId = adapters.sessionId?.(session) ?? session?.id ?? "dsh-session";
    await bridge.onTurnEnd({
      sessionId,
      turnId: String(event.turnId ?? session?.turnId ?? "dsh-turn"),
      userMessage: adapters.userMessage?.(event) ?? lastUserMessage(event),
      assistantResponse: String(event.assistantResponse ?? event.response ?? ""),
    });
  };

  for (const [event, handler] of Object.entries(handlers)) ctx.on(event, handler);
  return handlers;
}
