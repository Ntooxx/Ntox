import type { NtoxConfig } from "../types/index.js";

export type AudioFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export const AUDIO_FORMAT_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

export interface TranscribeOptions {
  filename?: string;
  signal?: AbortSignal;
}

export interface SynthesizeOptions {
  voice?: string;
  format?: AudioFormat;
  instructions?: string;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

export interface SynthesizeResult {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
  voice: string;
  format: AudioFormat;
}

export interface AudioProvider {
  transcribe(audio: Uint8Array, options?: TranscribeOptions): Promise<TranscribeResult>;
  synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult>;
}

export type AudioConfig = Pick<
  NtoxConfig,
  | "apiKey"
  | "sttProvider"
  | "sttModel"
  | "ttsProvider"
  | "ttsModel"
  | "ttsVoice"
  | "ttsStyle"
  | "audioBaseUrl"
  | "sttApiKey"
  | "ttsApiKey"
>;

export function resolveFormat(value: unknown): AudioFormat {
  return typeof value === "string" && value in AUDIO_FORMAT_MIME ? (value as AudioFormat) : "mp3";
}
