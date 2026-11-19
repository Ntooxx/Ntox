import { existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../config.js";
import type { Message } from "../../types/index.js";
import type { AgentConfig } from "../agent.js";

export interface ContextWindowState {
  messages: Message[];
  tokenCache: number[];
}

async function flushMemory(cfg: AgentConfig, state: ContextWindowState, anchorEnd: number): Promise<void> {
  const toKeep = Math.max(4, Math.floor(state.messages.length / 3));
  const toSummarize = state.messages.slice(anchorEnd, state.messages.length - toKeep);
  if (toSummarize.length < 4) return;

  const convoText = toSummarize
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const prompt = [
    "Summarize this conversation segment. Keep key facts, decisions, code changes, and user preferences.",
    "Be concise. Write in bullet points. Include:",
    "- What the user wanted",
    "- What was done/changed",
    "- Any important filenames or code patterns",
    "- User preferences or personal info shared",
    "",
    "Conversation:",
    convoText.slice(0, 8000),
    "",
    "Summary:",
  ].join("\n");

  try {
    let summary = "";
    const stream = cfg.llm.stream(
      [{ role: "user", content: prompt }],
      "You are a conversation summarizer. Output only the summary, no introduction.",
    );
    for await (const chunk of stream) {
      if (chunk.delta) summary += chunk.delta;
    }

    if (summary.length > 20) {
      const memoryDir = MEMORY_DIR;
      if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      appendFileSync(join(memoryDir, "memory.md"), `\n## ${stamp}\n${summary.trim()}\n`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[memory-flush] Summarization failed:", msg);
  }
}

export async function runContextWindow(cfg: AgentConfig, state: ContextWindowState): Promise<void> {
  const { messages, tokenCache } = state;
  const budget = cfg.contextTokenBudget;
  const msgCap = cfg.maxContextMessages;
  let currentTokens = tokenCache.reduce((s, t) => s + t, 0);
  const anchorEnd = messages.length > 0 && messages[0].role === "system" ? 1 : 0;

  if (messages.length <= msgCap && currentTokens <= budget * 0.8) return;

  if (currentTokens > budget * 0.8 && messages.length > anchorEnd + 4) {
    await flushMemory(cfg, state, anchorEnd);
  }

  const minKeep = anchorEnd + 2;
  while (messages.length > minKeep && (currentTokens > budget || messages.length > msgCap)) {
    currentTokens -= tokenCache[anchorEnd] ?? 0;
    messages.splice(anchorEnd, 1);
    tokenCache.splice(anchorEnd, 1);
  }
}
