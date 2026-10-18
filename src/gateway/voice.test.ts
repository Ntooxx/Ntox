import { describe, expect, it } from "vitest";
import { TTS_MAX_CHARS, audioFilenameFor, clampTtsText, voiceAudioError } from "./voice.js";

describe("audioFilenameFor", () => {
  it("maps common recorder mime types to whisper-friendly extensions", () => {
    expect(audioFilenameFor("audio/webm")).toBe("audio.webm");
    expect(audioFilenameFor("audio/ogg; codecs=opus")).toBe("audio.ogg");
    expect(audioFilenameFor("audio/mpeg")).toBe("audio.mp3");
    expect(audioFilenameFor("audio/mp4")).toBe("audio.m4a");
  });

  it("falls back to webm for unknown or empty mime types", () => {
    expect(audioFilenameFor("")).toBe("audio.webm");
    expect(audioFilenameFor("application/octet-stream")).toBe("audio.webm");
  });
});

describe("clampTtsText", () => {
  it("trims and passes short text through", () => {
    expect(clampTtsText("  hello  ")).toBe("hello");
  });

  it("caps very long replies at the TTS limit", () => {
    const long = "x".repeat(TTS_MAX_CHARS + 500);
    expect(clampTtsText(long)).toHaveLength(TTS_MAX_CHARS);
  });
});

describe("voiceAudioError", () => {
  it("accepts a normal audio payload", () => {
    expect(voiceAudioError("data:audio/webm;base64,AAAA", "audio/webm")).toBeNull();
  });

  it("rejects empty, oversized, or non-audio payloads", () => {
    expect(voiceAudioError("", "audio/webm")).toBe("No audio received.");
    expect(voiceAudioError("a".repeat(800_001), "audio/webm")).toContain("too long");
    expect(voiceAudioError("AAAA", "text/plain")).toBe("Unsupported audio format.");
  });
});
