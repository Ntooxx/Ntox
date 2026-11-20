import { describe, expect, it } from "vitest";
import { getVoiceSettings, handleVoiceCommand } from "./voice-mode.js";

describe("extended voice settings", () => {
  it("sets voice, style, engine and live mode", () => {
    expect(handleVoiceCommand("/voice voice onyx", "telegram", "settings-1")).toContain("TTS voice: onyx");
    expect(handleVoiceCommand("/voice style none", "telegram", "settings-1")).toContain("TTS style: none");
    expect(handleVoiceCommand("/voice engine local", "telegram", "settings-1")).toContain("Audio engine: local");
    expect(handleVoiceCommand("/voice live on", "telegram", "settings-1")).toContain("Live conversation: on");
    expect(getVoiceSettings("telegram", "settings-1")).toMatchObject({
      voice: "onyx",
      style: "none",
      engine: "local",
      live: true,
    });
  });

  it("reports the settings in status", () => {
    const status = handleVoiceCommand("/voice", "telegram", "settings-2")!;
    expect(status).toContain("Style: profile");
    expect(status).toContain("Engine: openai");
  });

  it("rejects invalid subcommand values", () => {
    expect(handleVoiceCommand("/voice engine azure", "telegram", "settings-3")).toContain("Invalid audio engine");
    expect(getVoiceSettings("telegram", "settings-3").engine).toBe("openai");
  });
});
