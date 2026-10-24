import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProactiveSuggestion } from "../meta/proactive.js";
import { getNtoxDir } from "./config.js";

export const PROACTIVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const MAX_TRACKED_CHATS = 200;

const TYPE_LABELS: Record<ProactiveSuggestion["type"], string> = {
  "goal-reminder": "Goal",
  "skill-suggestion": "Suggestion",
  "pattern-insight": "Insight",
  tip: "Tip",
  habit: "Habit",
  milestone: "Milestone",
  "feedback-prompt": "Question",
};

export function renderProactiveSuggestion(suggestion: ProactiveSuggestion): string {
  return `${TYPE_LABELS[suggestion.type] ?? "Suggestion"}: ${suggestion.message}`;
}

export interface ProactiveThrottleOptions {
  file?: string | null;
  now?: () => number;
}

export class ProactiveThrottle {
  private file: string | null;
  private now: () => number;
  private lastSent = new Map<string, number>();

  constructor(options: ProactiveThrottleOptions = {}) {
    this.file = options.file === undefined ? join(getNtoxDir(), "proactive.json") : options.file;
    this.now = options.now ?? Date.now;
    this.lastSent = this.load();
  }

  claim(key: string): boolean {
    const now = this.now();
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < PROACTIVE_COOLDOWN_MS) return false;
    this.lastSent.set(key, now);
    this.persist();
    return true;
  }

  private load(): Map<string, number> {
    if (!this.file || !existsSync(this.file)) return new Map();
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      const cutoff = this.now() - PROACTIVE_COOLDOWN_MS;
      const entries = Object.entries(raw).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > cutoff,
      );
      return new Map(entries);
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      const cutoff = this.now() - PROACTIVE_COOLDOWN_MS;
      const entries = [...this.lastSent.entries()]
        .filter(([, sentAt]) => sentAt > cutoff)
        .sort((a, b) => a[1] - b[1])
        .slice(-MAX_TRACKED_CHATS);
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
    } catch {
      /* throttle state is best-effort */
    }
  }
}

export interface ProactivePushOptions {
  throttle: ProactiveThrottle;
  key: string;
  chatId: string;
  suggestion: ProactiveSuggestion;
  sender: ((chatId: string, message: string) => Promise<void>) | null | undefined;
  delayMs?: number;
}

export function pushProactiveSuggestion(options: ProactivePushOptions): boolean {
  const { throttle, key, chatId, suggestion, sender } = options;
  if (!sender) return false;
  if (!throttle.claim(key)) return false;
  const text = renderProactiveSuggestion(suggestion);
  const fire = () => {
    sender(chatId, text).catch((error: unknown) => {
      console.error(`[proactive] push failed: ${error instanceof Error ? error.message : error}`);
    });
  };
  const delayMs = options.delayMs ?? 0;
  if (delayMs <= 0) {
    fire();
    return true;
  }
  const timer = setTimeout(fire, delayMs);
  if (typeof timer.unref === "function") timer.unref();
  return true;
}
