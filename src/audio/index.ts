import { loadConfig } from "../core/config.js";
import { createLocalAudio } from "./local.js";
import { createGroqStt, createOpenRouterTts } from "./remote.js";
import { createOpenAiAudio } from "./openai.js";
import type { AudioConfig, AudioProvider } from "./types.js";

export function resolveAudioProviders(config: AudioConfig): { stt: AudioProvider; tts: AudioProvider } {
  const stt =
    config.sttProvider === "groq"
      ? createGroqStt(config)
      : config.sttProvider === "local"
        ? createLocalAudio(config)
        : createOpenAiAudio(config);
  const tts =
    config.ttsProvider === "openrouter"
      ? createOpenRouterTts(config)
      : config.ttsProvider === "local"
        ? createLocalAudio(config)
        : createOpenAiAudio(config);
  return { stt, tts };
}

export function resolveAudioFromConfig() {
  return resolveAudioProviders(loadConfig());
}

export { resolveTtsInstructions, ttsInstructionsFromProfile } from "./identity.js";
export { createLocalAudio } from "./local.js";
export { createOpenAiAudio } from "./openai.js";
export { createGroqStt, createOpenRouterTts } from "./remote.js";
export { AUDIO_FORMAT_MIME, TTS_VOICES, resolveFormat } from "./types.js";
export { createRealtimeSession } from "./realtime.js";
export type { RealtimeSession, RealtimeSessionOptions, RealtimeSocket, RealtimeSocketFactory } from "./realtime.js";
export { createStreamingVoicePipeline } from "./stream.js";
export type { StreamingVoiceOptions, StreamingVoicePipeline } from "./stream.js";
export { findSpeechBounds, isSilent } from "./vad.js";
export { assertAudioToolAllowed, containsAudioData, stripAudioData } from "./policy.js";
export type {
  AudioConfig,
  AudioFormat,
  AudioProvider,
  SynthesizeOptions,
  SynthesizeResult,
  TranscribeOptions,
  TranscribeResult,
} from "./types.js";
