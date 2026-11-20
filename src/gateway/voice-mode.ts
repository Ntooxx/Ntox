import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBaseDir } from "../core/config.js";

export type VoiceMode = "on" | "off" | "auto";

const DEFAULT_MODE: VoiceMode = "auto";
const VALID_MODES: VoiceMode[] = ["on", "off", "auto"];
export const VOICE_REPLY_MAX_CHARS = 600;

type VoiceStore = Record<string, VoiceMode>;

export interface VoiceSettings {
  voice?: string;
  style: "none" | "profile";
  engine: "openai" | "groq" | "local" | "openrouter";
  live: boolean;
}

const DEFAULT_SETTINGS: VoiceSettings = { style: "profile", engine: "openai", live: false };

function settingsPath(): string {
  return join(getBaseDir(), "voice-settings.json");
}

function loadSettings(): Record<string, VoiceSettings> {
  try {
    if (!existsSync(settingsPath())) return {};
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<string, VoiceSettings>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getVoiceSettings(ctx: string, chatId: string): VoiceSettings {
  return { ...DEFAULT_SETTINGS, ...(loadSettings()[storeKey(ctx, chatId)] ?? {}) };
}

export function patchVoiceSettings(ctx: string, chatId: string, patch: Partial<VoiceSettings>): VoiceSettings {
  const store = loadSettings();
  const key = storeKey(ctx, chatId);
  const next = { ...DEFAULT_SETTINGS, ...(store[key] ?? {}), ...patch };
  store[key] = next;
  saveSettings(store);
  return next;
}

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

function saveSettings(store: Record<string, VoiceSettings>): void {
  const dir = getBaseDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(store, null, 2));
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
  "/voice voice <name> — choose the TTS voice",
  "/voice style <none|profile> — neutral or identity-driven timbre",
  "/voice engine <openai|groq|local|openrouter> — audio provider",
  "/voice live on|off — full-duplex conversation (REPL/Web)",
].join("\n");

export function handleVoiceCommand(text: string, ctx: string, chatId: string): string | null {
  const match = String(text || "")
    .trim()
    .match(/^\/voice(?:@\w+)?(?:\s+(\S+))?(?:\s+(\S+))?$/i);
  if (!match) return null;
  const arg = (match[1] || "").toLowerCase();
  const value = (match[2] || "").toLowerCase();
  if (!arg) {
    const settings = getVoiceSettings(ctx, chatId);
    return `Voice mode: ${getVoiceMode(ctx, chatId)}. Voice: ${settings.voice ?? "provider default"}. Style: ${settings.style}. Engine: ${settings.engine}. Live: ${settings.live ? "on" : "off"}.\n\n${VOICE_HELP}`;
  }
  if (arg === "voice" && value) {
    patchVoiceSettings(ctx, chatId, { voice: value });
    return `TTS voice: ${value}.`;
  }
  if (arg === "style" && (value === "none" || value === "profile")) {
    patchVoiceSettings(ctx, chatId, { style: value });
    return `TTS style: ${value}.`;
  }
  if (arg === "engine") {
    if (value === "openai" || value === "groq" || value === "local" || value === "openrouter") {
      patchVoiceSettings(ctx, chatId, { engine: value });
      return `Audio engine: ${value}.`;
    }
    return `Invalid audio engine "${value || "empty"}".\n\n${VOICE_HELP}`;
  }
  if (arg === "live") {
    if (value === "on" || value === "off") {
      patchVoiceSettings(ctx, chatId, { live: value === "on" });
      return `Live conversation: ${value}.`;
    }
    return `Invalid live value "${value || "empty"}".\n\n${VOICE_HELP}`;
  }
  if (arg === "voice" || arg === "style") {
    return `Missing or invalid ${arg} value.\n\n${VOICE_HELP}`;
  }
  if (!VALID_MODES.includes(arg as VoiceMode)) {
    return `Unknown voice mode "${arg}".\n\n${VOICE_HELP}`;
  }
  setVoiceMode(ctx, chatId, arg as VoiceMode);
  return `Voice replies: ${arg}.`;
}
