import { findSpeechBounds } from "./vad.js";
import type { AudioProvider, SynthesizeResult } from "./types.js";

export interface StreamingVoiceOptions {
  stt: AudioProvider;
  tts: AudioProvider;
  vadThreshold?: number;
  silenceWindow?: number;
  onAudio: (audio: SynthesizeResult) => void;
  onTranscript?: (text: string) => void;
}

export interface StreamingVoicePipeline {
  push(samples: Int16Array): void;
  interrupt(): void;
  pending(): number;
}

export function createStreamingVoicePipeline(options: StreamingVoiceOptions): StreamingVoicePipeline {
  const silenceWindow = Math.max(1, options.silenceWindow ?? 160);
  const threshold = options.vadThreshold ?? 400;
  let buffer: number[] = [];
  let active: AbortController | null = null;

  function pending(): number {
    return buffer.length;
  }

  function interrupt(): void {
    active?.abort();
    active = null;
    buffer = [];
  }

  function push(samples: Int16Array): void {
    buffer.push(...samples);
    const framed = new Int16Array(buffer);
    const bounds = findSpeechBounds(framed, threshold, silenceWindow);
    if (!bounds || bounds.end >= framed.length - silenceWindow) return;

    const utterance = framed.slice(bounds.start, bounds.end);
    buffer = [];
    const controller = new AbortController();
    active = controller;
    void (async () => {
      const transcript = await options.stt.transcribe(new Uint8Array(utterance.buffer), { signal: controller.signal });
      if (controller.signal.aborted) return;
      options.onTranscript?.(transcript.text);
      const audio = await options.tts.synthesize(transcript.text, { signal: controller.signal });
      if (controller.signal.aborted) return;
      options.onAudio(audio);
      active = null;
    })().catch((error: unknown) => {
      active = null;
      if (!controller.signal.aborted) throw error;
    });
  }

  return { push, interrupt, pending };
}
