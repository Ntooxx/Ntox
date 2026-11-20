import { describe, expect, it, vi } from "vitest";
import { runAudioVoiceAB } from "./audio-voice-ab.js";
import type { AudioProvider } from "../audio/types.js";

const provider: AudioProvider = {
  async transcribe() {
    return { text: "", model: "test" };
  },
  async synthesize(_text, options) {
    return {
      bytes: new Uint8Array(Buffer.from(options?.instructions ?? "neutral")),
      mimeType: "audio/mpeg",
      model: "test",
      voice: options?.voice ?? "nova",
      format: "mp3",
    };
  },
};

describe("runAudioVoiceAB", () => {
  const pairs = [
    {
      voiceA: { directness: 0.9, verbosity: 0.1 },
      voiceB: { directness: 0.1, verbosity: 0.9 },
      prompt: "Explain the result.",
    },
  ];

  it("detects audible divergence from profile instructions", async () => {
    const result = await runAudioVoiceAB(provider, pairs);
    expect(result.instructionsDistinct).toBe(1);
    expect(result.distinguishable).toBe(1);
    expect(result.audioIdentificationRate).toBe(1);
    expect(result.proxy).toBe(true);
  });

  it("uses a judge when available", async () => {
    const judge = { identify: vi.fn(async () => 1 as const) };
    const result = await runAudioVoiceAB(provider, pairs, judge);
    expect(judge.identify).toHaveBeenCalledTimes(1);
    expect(result.proxy).toBe(false);
    expect(result.audioIdentificationRate).toBe(0);
  });
});
