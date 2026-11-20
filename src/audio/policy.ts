import type { NtoxConfig } from "../types/index.js";

const AUDIO_DATA_URL = /data:audio\/[^;,]+;base64,[A-Za-z0-9+/=]+/g;

export function containsAudioData(text: string): boolean {
  return AUDIO_DATA_URL.test(text);
}

export function stripAudioData(text: string): string {
  return text.replace(AUDIO_DATA_URL, "[audio omitted]");
}

export function assertAudioToolAllowed(config: NtoxConfig, tool: "stt" | "tts"): void {
  const allowed = (config.profiles ?? []).some((profile) => profile.allowedTools.includes(tool));
  if (!allowed) {
    throw new Error(`Audio tool "${tool}" is not in allowedTools. Enable it explicitly in a workspace profile.`);
  }
}
