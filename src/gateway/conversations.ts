import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getNtoxDir } from "../core/config.js";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
}

export type ConversationSummary = Omit<Conversation, "messages"> & { messageCount: number };

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 400;
const DEFAULT_PATH = () => join(getNtoxDir(), "conversations.json");

export function newConversationId(): string {
  return `conv_${randomUUID().slice(0, 12)}`;
}

export function isValidConversationId(id: string): boolean {
  return /^conv_[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function titleFromMessage(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

export class ConversationStore {
  private conversations = new Map<string, Conversation>();
  private loaded = false;
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? DEFAULT_PATH();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as Record<string, Conversation>;
      for (const [id, conv] of Object.entries(raw)) {
        if (conv && typeof conv.id === "string" && Array.isArray(conv.messages)) {
          conv.messages = conv.messages.slice(-MAX_MESSAGES);
          this.conversations.set(id, conv);
        }
      }
    } catch {
      this.conversations = new Map();
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const obj: Record<string, Conversation> = {};
      for (const conv of this.conversations.values()) obj[conv.id] = conv;
      writeFileSync(this.path, JSON.stringify(obj, null, 2));
    } catch {
      /* best effort */
    }
  }

  private prune(): void {
    if (this.conversations.size <= MAX_CONVERSATIONS) return;
    const sorted = [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const conv of sorted.slice(MAX_CONVERSATIONS)) {
      this.conversations.delete(conv.id);
    }
  }

  create(id?: string, title?: string): Conversation {
    this.load();
    const convId = id && isValidConversationId(id) ? id : newConversationId();
    const now = Date.now();
    const existing = this.conversations.get(convId);
    if (existing) return existing;
    const conv: Conversation = {
      id: convId,
      title: title?.trim() || "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.conversations.set(convId, conv);
    this.prune();
    this.save();
    return conv;
  }

  get(id: string): Conversation | null {
    this.load();
    return this.conversations.get(id) ?? null;
  }

  list(): ConversationSummary[] {
    this.load();
    return [...this.conversations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ messages, ...rest }) => ({ ...rest, messageCount: messages.length }));
  }

  appendMessage(id: string, message: Omit<ConversationMessage, "timestamp">): Conversation {
    this.load();
    let conv = this.conversations.get(id);
    if (!conv) conv = this.create(id);
    conv.messages.push({ ...message, timestamp: Date.now() });
    if (conv.messages.length > MAX_MESSAGES) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES);
    }
    conv.updatedAt = Date.now();
    if (conv.title === "New chat" && message.role === "user") {
      conv.title = titleFromMessage(message.content);
    }
    this.save();
    return conv;
  }

  rename(id: string, title: string): Conversation | null {
    this.load();
    const conv = this.conversations.get(id);
    if (!conv) return null;
    const next = title.trim().slice(0, 80);
    if (!next) return conv;
    conv.title = next;
    conv.updatedAt = Date.now();
    this.save();
    return conv;
  }

  delete(id: string): boolean {
    this.load();
    const ok = this.conversations.delete(id);
    if (ok) this.save();
    return ok;
  }

  clearMessages(id: string): boolean {
    this.load();
    const conv = this.conversations.get(id);
    if (!conv) return false;
    conv.messages = [];
    conv.updatedAt = Date.now();
    this.save();
    return true;
  }

  popLastExchange(id: string): Conversation | null {
    this.load();
    const conv = this.conversations.get(id);
    if (!conv) return null;
    let removed = false;
    while (conv.messages.length && conv.messages[conv.messages.length - 1].role !== "user") {
      conv.messages.pop();
      removed = true;
    }
    if (conv.messages.length && conv.messages[conv.messages.length - 1].role === "user") {
      conv.messages.pop();
      removed = true;
    }
    if (removed) {
      conv.updatedAt = Date.now();
      this.save();
    }
    return conv;
  }
}
