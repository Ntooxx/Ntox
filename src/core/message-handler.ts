import type { Agent, AgentCallbacks } from "./agent.js";

const SYSTEM_REMINDER_OPEN = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";

export class TokenFilter {
  private inSystemReminder = false;

  filter(token: string): string {
    let out = "";
    let pending = "";
    let discard = "";

    for (const ch of token) {
      if (this.inSystemReminder) {
        discard += ch;
        if (discard.includes(SYSTEM_REMINDER_CLOSE)) {
          this.inSystemReminder = false;
          discard = "";
        }
        continue;
      }
      pending += ch;
      if (pending.includes(SYSTEM_REMINDER_OPEN)) {
        out += pending.slice(0, pending.indexOf(SYSTEM_REMINDER_OPEN));
        pending = "";
        this.inSystemReminder = true;
        discard = "";
        continue;
      }
      let keep = 0;
      for (let i = 1; i <= pending.length; i++) {
        const suffix = pending.slice(pending.length - i);
        if (SYSTEM_REMINDER_OPEN.startsWith(suffix)) keep = i;
      }
      if (keep < pending.length) {
        out += pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
      }
    }
    return out + (this.inSystemReminder ? "" : pending);
  }
}

export function createTokenFilter(): { filter: (token: string) => string } {
  return new TokenFilter();
}

export interface StreamResult {
  outputTokenCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error: Error | null;
  cancelled: boolean;
  timedOut: boolean;
}

const TURN_TIMEOUT_MS = 10 * 60 * 1000;

export async function runAgentStream(
  agent: Agent,
  input: string,
  callbacks: Partial<AgentCallbacks>,
  signal?: AbortSignal
): Promise<StreamResult> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let outputTokenCount = 0;
  let streamError: Error | null = null;
  let cancelled = false;
  let timedOut = false;

  const controller = new AbortController();
  const watchdog = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("turn timeout"));
  }, TURN_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  const tokenFilter = new TokenFilter();
  const agentCallbacks: AgentCallbacks = {
    onToken: (token) => {
      const filtered = tokenFilter.filter(token);
      if (filtered) {
        outputTokenCount++;
        callbacks.onToken?.(filtered);
      }
    },
    onToolCall: (name, args) => callbacks.onToolCall?.(name, args),
    onToolResult: (name, result, args) => callbacks.onToolResult?.(name, result, args),
    onUsage: (usage) => {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      callbacks.onUsage?.(usage);
    },
    onThinking: (thought) => callbacks.onThinking?.(thought),
    onPhase: (phase) => callbacks.onPhase?.(phase),
    onMemoryRecall: (count) => callbacks.onMemoryRecall?.(count),
    onMemoryStore: () => callbacks.onMemoryStore?.(),
    onStrategy: (type) => callbacks.onStrategy?.(type),
    onReflection: (reflection) => callbacks.onReflection?.(reflection),
    onCorrectionDetected: (topicKey, correction) => callbacks.onCorrectionDetected?.(topicKey, correction),
    onSkillTriggered: (name, confidence) => callbacks.onSkillTriggered?.(name, confidence),
    onProactiveSuggestion: (suggestion) => callbacks.onProactiveSuggestion?.(suggestion),
    onCognitive: (summary) => callbacks.onCognitive?.(summary),
    onStyleGuidance: (guidance) => callbacks.onStyleGuidance?.(guidance),
    onSelfAwareness: (message) => callbacks.onSelfAwareness?.(message),
    onFeedbackRequest: (question) => callbacks.onFeedbackRequest?.(question),
    onIntervention: (intervention) => callbacks.onIntervention?.(intervention),
    onDisagreement: (disagreement) => callbacks.onDisagreement?.(disagreement),
  };

  try {
    const stream = agent.run(input, agentCallbacks, { signal: controller.signal });
    for await (const _ of stream) { void _; }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err));
    cancelled = (signal?.aborted || streamError.message.includes("cancelled")) && !timedOut;
    if (!timedOut && streamError.message.includes("turn timeout")) {
      timedOut = true;
    }
  } finally {
    clearTimeout(watchdog);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }

  return { outputTokenCount, totalInputTokens, totalOutputTokens, error: streamError, cancelled, timedOut };
}