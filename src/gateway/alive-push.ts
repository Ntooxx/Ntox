import type { AliveAction, AliveEvent } from "../alive/engine.js";
import { describeAliveEvent } from "../alive/describe.js";

export const ALIVE_PUSH_MIN_INTERVAL_MS = 60_000;

const IN_TURN_SOURCES = new Set(["ntox-tool"]);

export interface AlivePushTarget {
  channel: string;
  chatId: string;
}

export function splitSessionId(sessionId: string): AlivePushTarget | null {
  const separator = sessionId.indexOf("_");
  if (separator <= 0 || separator === sessionId.length - 1) return null;
  return { channel: sessionId.slice(0, separator), chatId: sessionId.slice(separator + 1) };
}

function headline(action: AliveAction, event: AliveEvent): string {
  return describeAliveEvent(event) ?? `${event.type} — ${action.reason}`;
}

export function renderAlivePush(action: AliveAction, event?: AliveEvent): string | null {
  if (action.kind !== "wake" && action.kind !== "notify") return null;
  if (event && IN_TURN_SOURCES.has(event.source)) return null;
  const text = event ? headline(action, event) : action.reason;
  return `Alive · ${text}`;
}

export interface AlivePusherOptions {
  targets: () => AlivePushTarget[];
  send: (channel: string, chatId: string, message: string) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
}

export class AlivePusher {
  private readonly lastPushedAt = new Map<string, number>();
  private readonly targets: () => AlivePushTarget[];
  private readonly send: (channel: string, chatId: string, message: string) => Promise<void>;
  private readonly now: () => number;
  private readonly minIntervalMs: number;

  constructor(options: AlivePusherOptions) {
    this.targets = options.targets;
    this.send = options.send;
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? ALIVE_PUSH_MIN_INTERVAL_MS;
  }

  handle(action: AliveAction, event?: AliveEvent): void {
    const message = renderAlivePush(action, event);
    if (!message) return;
    const now = this.now();
    for (const target of this.targets()) {
      const key = `${target.channel}:${target.chatId}`;
      const last = this.lastPushedAt.get(key);
      if (last !== undefined && now - last < this.minIntervalMs) continue;
      this.lastPushedAt.set(key, now);
      try {
        void Promise.resolve(this.send(target.channel, target.chatId, message)).catch((error: unknown) => {
          console.error(
            `[alive] push to ${target.channel}:${target.chatId} failed: ${error instanceof Error ? error.message : error}`,
          );
        });
      } catch (error) {
        console.error(
          `[alive] push to ${target.channel}:${target.chatId} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }
}
