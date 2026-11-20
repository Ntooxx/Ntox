import { describe, expect, it, vi } from "vitest";
import { createStreamingVoicePipeline } from "./index.js";
import type { AudioProvider } from "./types.js";

function provider(text = "ciao"): AudioProvider {
  return {
    transcribe: vi.fn(async () => ({ text, model: "test" })),
    synthesize: vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
      model: "test",
      voice: "nova",
      format: "mp3" as const,
    })),
  };
}

function speech(): Int16Array {
  return new Int16Array([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
}

function silence(): Int16Array {
  return new Int16Array(400);
}

describe("streaming voice pipeline", () => {
  it("turns a completed utterance into audio", async () => {
    const stt = provider();
    const tts = provider();
    const onAudio = vi.fn();
    const pipeline = createStreamingVoicePipeline({ stt, tts, vadThreshold: 100, silenceWindow: 8, onAudio });
    pipeline.push(speech());
    pipeline.push(silence());
    await new Promise((done) => setImmediate(done));
    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(tts.synthesize).toHaveBeenCalledWith("ciao", expect.anything());
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it("drops a pending turn on barge-in", async () => {
    const onAudio = vi.fn();
    const pipeline = createStreamingVoicePipeline({
      stt: provider(),
      tts: provider(),
      vadThreshold: 100,
      silenceWindow: 8,
      onAudio,
    });
    pipeline.push(speech());
    pipeline.push(silence());
    pipeline.interrupt();
    await new Promise((done) => setImmediate(done));
    expect(onAudio).not.toHaveBeenCalled();
    expect(pipeline.pending()).toBe(0);
  });
});
