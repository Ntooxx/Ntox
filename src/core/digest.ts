import type { AliveAction, AliveEvent, AliveOpenLoop } from "../alive/engine.js";
import { describeAliveEvent } from "../alive/describe.js";
import { renderPlan } from "../tools/plan.js";
import type { PlanState } from "../tools/plan.js";
import { formatCost, formatTokenCount } from "./llm.js";

export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

const MIN_EVENT_SIGNIFICANCE = 0.5;
const MAX_EVENT_LINES = 6;
const MAX_LOOP_LINES = 5;

export interface DigestAliveSnapshot {
  events: AliveEvent[];
  openLoops: AliveOpenLoop[];
  pendingActions: AliveAction[];
}

export interface DigestAliveSource {
  inspect(limit: number): DigestAliveSnapshot;
}

export interface DigestCosts {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

export interface DigestOptions {
  alive?: DigestAliveSource;
  plan?: PlanState | null;
  costs?: DigestCosts;
  title?: string;
  now?: number;
  windowMs?: number;
}

export function isDigestPrompt(prompt: string): boolean {
  return prompt.trim().toLowerCase() === "/digest";
}

function ago(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function windowLabel(windowMs: number): string {
  const HOUR_MS = 60 * 60 * 1000;
  if (windowMs % DIGEST_WINDOW_MS === 0) return `${windowMs / DIGEST_WINDOW_MS}d`;
  if (windowMs % HOUR_MS === 0) return `${windowMs / HOUR_MS}h`;
  return `${Math.max(1, Math.round(windowMs / 60_000))}m`;
}

function inboxWorthy(events: AliveEvent[], now: number, windowMs: number): AliveEvent[] {
  return events
    .filter(
      (event) =>
        event.timestamp >= now - windowMs && (event.significance >= MIN_EVENT_SIGNIFICANCE || event.requiresHuman),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EVENT_LINES);
}

export function renderDigest(options: DigestOptions = {}): string {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DIGEST_WINDOW_MS;
  const lines: string[] = [`${options.title || "Digest"} — ${new Date(now).toLocaleString()}`, ""];

  lines.push("Plan");
  if (options.plan) {
    lines.push(
      ...renderPlan(options.plan)
        .split("\n")
        .map((line) => `  ${line}`),
    );
  } else {
    lines.push("  No active plan.");
  }
  lines.push("");

  const snapshot = options.alive?.inspect(50) ?? { events: [], openLoops: [], pendingActions: [] };
  lines.push(`Alive (last ${windowLabel(windowMs)})`);
  const events = inboxWorthy(snapshot.events, now, windowMs);
  if (events.length === 0) {
    lines.push("  Nothing notable.");
  } else {
    for (const event of events) {
      lines.push(`  - ${ago(event.timestamp, now)} · ${describeAliveEvent(event) ?? event.type}`);
    }
  }
  lines.push("");

  const loops = snapshot.openLoops.filter((loop) => loop.status !== "completed").slice(0, MAX_LOOP_LINES);
  lines.push("Open loops");
  if (loops.length === 0) {
    lines.push("  None.");
  } else {
    for (const loop of loops) lines.push(`  - [${loop.status}] ${loop.goal}`);
  }
  lines.push("");

  lines.push("Costs");
  if (options.costs) {
    const { totalInputTokens, totalOutputTokens, totalCost } = options.costs;
    lines.push(
      `  ${formatTokenCount(totalInputTokens)} in · ${formatTokenCount(totalOutputTokens)} out · ${formatCost(totalCost)} lifetime`,
    );
  } else {
    lines.push("  Usage tracking unavailable.");
  }

  return lines.join("\n");
}
