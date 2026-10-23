import type { Agent, AgentCallbacks } from "./agent.js";
import { createStreamingSanitizer } from "./guard.js";

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
const TURN_HARD_CAP_MS = 45 * 60 * 1000;
const TOKENS_PER_SECOND_ASSUMED = 40;
const GENERATION_HEADROOM = 2;

export function computeTurnTimeoutMs(maxTokens: number): number {
  const generationSeconds = (maxTokens / TOKENS_PER_SECOND_ASSUMED) * GENERATION_HEADROOM;
  const scaled = generationSeconds * 1000;
  return Math.min(Math.max(scaled, TURN_TIMEOUT_MS), TURN_HARD_CAP_MS);
}

export async function runAgentStream(
  agent: Agent,
  input: string,
  callbacks: Partial<AgentCallbacks>,
  signal?: AbortSignal,
  options: { timeoutMs?: number; absoluteTimeoutMs?: number } = {},
): Promise<StreamResult> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let outputTokenCount = 0;
  let streamError: Error | null = null;
  let cancelled = false;
  let timedOut = false;

  const controller = new AbortController();
  const idleMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const absoluteMs = options.absoluteTimeoutMs ?? TURN_HARD_CAP_MS;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    if (timedOut || cancelled) return;
    timedOut = true;
    controller.abort(new Error("turn timeout"));
  };
  const armIdleWatchdog = () => {
    if (timedOut) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(expire, idleMs);
  };
  armIdleWatchdog();
  const absoluteTimer = setTimeout(expire, absoluteMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  const tokenFilter = new TokenFilter();
  const sanitizer = createStreamingSanitizer();
  const agentCallbacks: AgentCallbacks = {
    onToken: (token) => {
      armIdleWatchdog();
      const filtered = tokenFilter.filter(token);
      if (!filtered) return;
      const safe = sanitizer.push(filtered);
      if (safe) {
        outputTokenCount++;
        callbacks.onToken?.(safe);
      }
    },
    onToolCall: (name, args) => {
      armIdleWatchdog();
      callbacks.onToolCall?.(name, args);
    },
    onToolResult: (name, result, args) => {
      armIdleWatchdog();
      callbacks.onToolResult?.(name, result, args);
    },
    onUsage: (usage) => {
      armIdleWatchdog();
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      callbacks.onUsage?.(usage);
    },
    onThinking: (thought) => {
      armIdleWatchdog();
      callbacks.onThinking?.(thought);
    },
    onPhase: (phase) => callbacks.onPhase?.(phase),
    onMemoryRecall: (count) => callbacks.onMemoryRecall?.(count),
    onMemoryStore: () => callbacks.onMemoryStore?.(),
    onStrategy: (type) => callbacks.onStrategy?.(type),
    onReflection: (reflection) => callbacks.onReflection?.(reflection),
    onCorrectionDetected: (topicKey, correction) => callbacks.onCorrectionDetected?.(topicKey, correction),
    onSkillTriggered: (name, confidence) => callbacks.onSkillTriggered?.(name, confidence),
    onSkillProposal: (skill) => callbacks.onSkillProposal?.(skill),
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
    for await (const _ of stream) {
      void _;
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err));
    cancelled = (signal?.aborted || streamError.message.includes("cancelled")) && !timedOut;
    if (!timedOut && streamError.message.includes("turn timeout")) {
      timedOut = true;
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(absoluteTimer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }

  const tail = sanitizer.flush();
  if (tail) {
    outputTokenCount++;
    callbacks.onToken?.(tail);
  }

  return { outputTokenCount, totalInputTokens, totalOutputTokens, error: streamError, cancelled, timedOut };
}
