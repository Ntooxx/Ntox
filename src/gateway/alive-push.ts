import type { AliveAction, AliveEvent } from "../alive/engine.js";

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

function shortText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function headline(action: AliveAction, event: AliveEvent): string {
  const payload = event.payload;
  const changedFiles = typeof payload.changedFiles === "number" ? payload.changedFiles : undefined;
  switch (event.type) {
    case "git_commit": {
      const head = shortText(payload.head, 7);
      const files = changedFiles === undefined ? "" : ` (${changedFiles} file${changedFiles === 1 ? "" : "s"})`;
      return `Git: new commit ${head}${files}`;
    }
    case "git_state_changed":
      return `Git: working tree now has ${changedFiles ?? 0} changed file${changedFiles === 1 ? "" : "s"}`;
    case "file_changed": {
      const change = shortText(payload.change, 20);
      return `Workspace: ${shortText(payload.path)}${change ? ` (${change})` : ""}`;
    }
    case "tool_succeeded":
    case "tool_failed":
    case "process_exited":
    case "test_finished": {
      const tool = shortText(payload.toolName) || event.type;
      const status = shortText(payload.status) || (event.type === "tool_failed" ? "failed" : "finished");
      const error = shortText(payload.error, 100);
      return `${tool}: ${status}${error ? ` — ${error}` : ""}`;
    }
    default:
      return `${event.type} — ${action.reason}`;
  }
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
