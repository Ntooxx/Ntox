import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore, isValidConversationId, newConversationId, titleFromMessage } from "./conversations.js";

const dir = mkdtempSync(join(tmpdir(), "ntox-convs-"));
const path = join(dir, "conversations.json");

afterEach(() => {
  if (existsSync(path)) unlinkSync(path);
});

describe("conversation id helpers", () => {
  it("generates valid ids", () => {
    const id = newConversationId();
    expect(id).toMatch(/^conv_/);
    expect(isValidConversationId(id)).toBe(true);
  });

  it("rejects invalid ids", () => {
    expect(isValidConversationId("")).toBe(false);
    expect(isValidConversationId("../../etc/passwd")).toBe(false);
    expect(isValidConversationId("web_socket123")).toBe(false);
  });

  it("derives titles from messages", () => {
    expect(titleFromMessage("  hello   world ")).toBe("hello world");
    expect(titleFromMessage("x".repeat(80))).toHaveLength(48);
    expect(titleFromMessage("")).toBe("New chat");
  });
});

describe("ConversationStore", () => {
  it("creates, lists, renames, and deletes", () => {
    const store = new ConversationStore(path);
    const conv = store.create(undefined, "First chat");
    expect(conv.title).toBe("First chat");
    expect(store.list()).toHaveLength(1);

    store.rename(conv.id, "Renamed");
    expect(store.get(conv.id)?.title).toBe("Renamed");

    expect(store.delete(conv.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.delete(conv.id)).toBe(false);
  });

  it("appends messages and auto-titles from first user message", () => {
    const store = new ConversationStore(path);
    const conv = store.create();
    store.appendMessage(conv.id, { role: "user", content: "Fix the login bug please" });
    store.appendMessage(conv.id, { role: "assistant", content: "Done." });
    const loaded = store.get(conv.id);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.title).toBe("Fix the login bug please");
  });

  it("persists across instances", () => {
    const first = new ConversationStore(path);
    const conv = first.create(undefined, "Persisted");
    first.appendMessage(conv.id, { role: "user", content: "remember me" });

    const second = new ConversationStore(path);
    const loaded = second.get(conv.id);
    expect(loaded?.title).toBe("Persisted");
    expect(loaded?.messages[0].content).toBe("remember me");
    expect(second.list()[0].messageCount).toBe(1);
  });

  it("clears messages but keeps the conversation", () => {
    const store = new ConversationStore(path);
    const conv = store.create();
    store.appendMessage(conv.id, { role: "user", content: "hi" });
    expect(store.clearMessages(conv.id)).toBe(true);
    expect(store.get(conv.id)?.messages).toHaveLength(0);
    expect(store.list()).toHaveLength(1);
  });

  it("returns summaries without message bodies", () => {
    const store = new ConversationStore(path);
    const conv = store.create(undefined, "Summary test");
    store.appendMessage(conv.id, { role: "user", content: "secret content" });
    const summary = store.list()[0];
    expect(summary).not.toHaveProperty("messages");
    expect(summary.messageCount).toBe(1);
  });

  it("pops the last exchange for regenerate", () => {
    const store = new ConversationStore(path);
    const conv = store.create(undefined, "Regen");
    store.appendMessage(conv.id, { role: "user", content: "first" });
    store.appendMessage(conv.id, { role: "assistant", content: "answer one" });
    store.appendMessage(conv.id, { role: "user", content: "second" });
    store.appendMessage(conv.id, { role: "assistant", content: "answer two" });

    const after = store.popLastExchange(conv.id);
    expect(after?.messages.map((m) => m.content)).toEqual(["first", "answer one"]);

    const reloaded = new ConversationStore(path);
    expect(reloaded.get(conv.id)?.messages).toHaveLength(2);
  });
});
