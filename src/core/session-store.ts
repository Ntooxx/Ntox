import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getBaseDir } from "./config.js";
import type { AgentTurnTrace, Message } from "../types/index.js";

const SESSION_VERSION = 1;
const MAX_SESSIONS = 100;

export interface SessionContextSnapshot {
  intent: string;
  startedAt: number;
  queryCount: number;
  consecutiveTechnical: number;
  lastIntentShift: number;
  shiftCount: number;
}

export interface SessionSnapshot {
  version: number;
  sessionId: string;
  source: string;
  savedAt: number;
  createdAt: number;
  messages: Message[];
  lastAssistantResponse: string | null;
  lastUserMessage: string | null;
  sessionStartTime: number;
  correctionsThisSession: number;
  toolUsageThisSession: Record<string, number>;
  sessionContext?: SessionContextSnapshot;
  lastTrace?: AgentTurnTrace | null;
}

export interface SessionSummary {
  id: string;
  source: string;
  savedAt: number;
  createdAt: number;
  messageCount: number;
  title: string;
}

interface SessionIndex {
  sessions: SessionSummary[];
}

function sessionsDir(): string {
  return join(getBaseDir(), "sessions");
}

function indexPath(): string {
  return join(sessionsDir(), "index.json");
}

function safeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "default";
}

function sessionPath(sessionId: string): string {
  return join(sessionsDir(), `${safeId(sessionId)}.json`);
}

function writeJson(path: string, value: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(value, null, 2);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, body);
  try {
    renameSync(temp, path);
  } catch {
    writeFileSync(path, body);
    try {
      unlinkSync(temp);
    } catch {
      /* best effort */
    }
  }
}

function summarize(snapshot: SessionSnapshot): SessionSummary {
  const firstUser = snapshot.messages.find((message) => message.role === "user");
  const title = (firstUser?.content || "Untitled session").replace(/\s+/g, " ").trim().slice(0, 80);
  const messageCount = snapshot.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  ).length;
  return {
    id: snapshot.sessionId,
    source: snapshot.source,
    savedAt: snapshot.savedAt,
    createdAt: snapshot.createdAt,
    messageCount,
    title,
  };
}

function readIndexFromDisk(): SessionIndex | null {
  const path = indexPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as SessionIndex;
    if (!parsed || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rebuildIndex(): SessionIndex {
  const dir = sessionsDir();
  if (!existsSync(dir)) return { sessions: [] };
  const sessions: SessionSummary[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    try {
      const snapshot = JSON.parse(readFileSync(join(dir, file), "utf-8")) as SessionSnapshot;
      if (snapshot.version !== SESSION_VERSION || !snapshot.sessionId || !Array.isArray(snapshot.messages)) continue;
      sessions.push(summarize(snapshot));
    } catch {
      /* skip corrupt snapshot */
    }
  }
  sessions.sort((a, b) => b.savedAt - a.savedAt);
  return { sessions };
}

function readIndex(): SessionIndex {
  return readIndexFromDisk() ?? rebuildIndex();
}

function writeIndex(index: SessionIndex): void {
  writeJson(indexPath(), { sessions: index.sessions.slice(0, MAX_SESSIONS) });
}

export function saveSessionSnapshot(snapshot: SessionSnapshot): void {
  if (!snapshot.sessionId) throw new Error("sessionId is required");
  const normalized: SessionSnapshot = {
    ...snapshot,
    version: SESSION_VERSION,
    savedAt: snapshot.savedAt || Date.now(),
    messages: snapshot.messages.slice(-200),
  };
  writeJson(sessionPath(normalized.sessionId), normalized);

  const index = readIndex();
  const summary = summarize(normalized);
  index.sessions = [summary, ...index.sessions.filter((item) => item.id !== summary.id)];
  const removed = index.sessions.slice(MAX_SESSIONS);
  index.sessions = index.sessions.slice(0, MAX_SESSIONS);
  writeIndex(index);
  for (const item of removed) {
    try {
      unlinkSync(sessionPath(item.id));
    } catch {
      /* best effort */
    }
  }
}

export function loadSessionSnapshot(sessionId: string): SessionSnapshot | null {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as SessionSnapshot;
    if (snapshot.version !== SESSION_VERSION) return null;
    if (snapshot.sessionId !== sessionId) return null;
    if (!Array.isArray(snapshot.messages)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function deleteSessionSnapshot(sessionId: string): boolean {
  const index = readIndex();
  const before = index.sessions.length;
  index.sessions = index.sessions.filter((item) => item.id !== sessionId);
  if (index.sessions.length !== before) writeIndex(index);
  try {
    unlinkSync(sessionPath(sessionId));
    return true;
  } catch {
    return false;
  }
}

export function listSessionSnapshots(limit = 20): SessionSummary[] {
  return readIndex().sessions.slice(0, Math.max(1, Math.min(limit, MAX_SESSIONS)));
}

export function getLastSessionId(source = "repl"): string | null {
  return readIndex().sessions.find((item) => item.source === source)?.id ?? null;
}
