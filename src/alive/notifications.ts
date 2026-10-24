import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getNtoxDir } from "../core/config.js";

export interface NtoxNotification {
  id: string;
  kind: string;
  reason: string;
  detail?: Record<string, unknown>;
  at: number;
}

const MAX_STORED = 50;

function notificationPath(): string {
  return join(getNtoxDir(), "notifications.json");
}

export function listNotifications(limit = 20): NtoxNotification[] {
  try {
    const path = notificationPath();
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as NtoxNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, Math.max(1, Math.min(limit, MAX_STORED)));
  } catch {
    return [];
  }
}

export function pushNotification(input: { kind: string; reason: string; detail?: Record<string, unknown> }): NtoxNotification {
  const entry: NtoxNotification = { id: `ntf_${randomUUID().slice(0, 12)}`, kind: input.kind, reason: input.reason.slice(0, 2000), at: Date.now() };
  if (input.detail) entry.detail = input.detail;
  try {
    const dir = getNtoxDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stored = listNotifications(MAX_STORED);
    stored.unshift(entry);
    writeFileSync(notificationPath(), JSON.stringify(stored.slice(0, MAX_STORED), null, 2), "utf-8");
  } catch (error) {
    console.error("[alive] could not persist notification:", error);
  }
  return entry;
}

export function clearNotifications(): number {
  try {
    const path = notificationPath();
    if (!existsSync(path)) return 0;
    const stored = listNotifications(MAX_STORED);
    writeFileSync(path, "[]", "utf-8");
    return stored.length;
  } catch {
    return 0;
  }
}