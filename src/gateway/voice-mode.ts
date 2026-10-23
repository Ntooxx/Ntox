import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBaseDir } from "../core/config.js";

export type VoiceMode = "on" | "off" | "auto";

const DEFAULT_MODE: VoiceMode = "auto";
const VALID_MODES: VoiceMode[] = ["on", "off", "auto"];
export const VOICE_REPLY_MAX_CHARS = 600;

type VoiceStore = Record<string, VoiceMode>;

function storePath(): string {
  return join(getBaseDir(), "voice.json");
}

function loadStore(): VoiceStore {
  try {
    if (!existsSync(storePath())) return {};
    const parsed = JSON.parse(readFileSync(storePath(), "utf-8")) as VoiceStore;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: VoiceStore): void {
  const dir = getBaseDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(), JSON.stringify(store, null, 2));
}

function storeKey(ctx: string, chatId: string): string {
  return `${ctx}:${chatId}`;
}

export function getVoiceMode(ctx: string, chatId: string): VoiceMode {
  const value = loadStore()[storeKey(ctx, chatId)];
  return VALID_MODES.includes(value as VoiceMode) ? (value as VoiceMode) : DEFAULT_MODE;
}

export function setVoiceMode(ctx: string, chatId: string, mode: VoiceMode): void {
  const store = loadStore();
  store[storeKey(ctx, chatId)] = mode;
  saveStore(store);
}

export function resolveVoiceReply(ctx: string, chatId: string, inputWasVoice: boolean): boolean {
  const mode = getVoiceMode(ctx, chatId);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return inputWasVoice;
}

export function voiceReplyText(response: string): string {
  const plain = String(response || "")
    .replace(/[*_`#>|~]/g, "")
    .trim();
  if (plain.length <= VOICE_REPLY_MAX_CHARS) return plain;
  return plain.slice(0, VOICE_REPLY_MAX_CHARS - 3).trimEnd() + "...";
}

const VOICE_HELP = [
  "Voice replies — speak answers back as a voice note.",
  "",
  "/voice — show current mode",
  "/voice on — always reply with voice",
  "/voice off — never reply with voice",
  "/voice auto — reply with voice when you send voice (default)",
].join("\n");

export function handleVoiceCommand(text: string, ctx: string, chatId: string): string | null {
  const match = String(text || "")
    .trim()
    .match(/^\/voice(?:@\w+)?(?:\s+(\S+))?$/i);
  if (!match) return null;
  const arg = (match[1] || "").toLowerCase();
  if (!arg) {
    return `Voice mode: ${getVoiceMode(ctx, chatId)}.\n\n${VOICE_HELP}`;
  }
  if (!VALID_MODES.includes(arg as VoiceMode)) {
    return `Unknown voice mode "${arg}".\n\n${VOICE_HELP}`;
  }
  setVoiceMode(ctx, chatId, arg as VoiceMode);
  return `Voice replies: ${arg}.`;
}
