import { describe, it, expect } from "vitest";
import {
  getVoiceMode,
  setVoiceMode,
  resolveVoiceReply,
  handleVoiceCommand,
  voiceReplyText,
  VOICE_REPLY_MAX_CHARS,
} from "./voice-mode.js";

describe("voice mode store", () => {
  it("defaults to auto", () => {
    expect(getVoiceMode("telegram", "chat-default")).toBe("auto");
  });

  it("round-trips a mode per chat and context", () => {
    setVoiceMode("telegram", "chat-a", "on");
    setVoiceMode("whatsapp", "chat-a", "off");
    expect(getVoiceMode("telegram", "chat-a")).toBe("on");
    expect(getVoiceMode("whatsapp", "chat-a")).toBe("off");
    expect(getVoiceMode("telegram", "chat-b")).toBe("auto");
  });

  it("resolves replies from mode and input type", () => {
    setVoiceMode("telegram", "r-on", "on");
    setVoiceMode("telegram", "r-off", "off");
    setVoiceMode("telegram", "r-auto", "auto");
    expect(resolveVoiceReply("telegram", "r-on", false)).toBe(true);
    expect(resolveVoiceReply("telegram", "r-off", true)).toBe(false);
    expect(resolveVoiceReply("telegram", "r-auto", true)).toBe(true);
    expect(resolveVoiceReply("telegram", "r-auto", false)).toBe(false);
    expect(resolveVoiceReply("telegram", "r-unknown", true)).toBe(true);
  });
});

describe("handleVoiceCommand", () => {
  it("ignores non-voice commands", () => {
    expect(handleVoiceCommand("/help", "telegram", "c1")).toBeNull();
    expect(handleVoiceCommand("/voicemail hi", "telegram", "c1")).toBeNull();
    expect(handleVoiceCommand("what is your voice mode?", "telegram", "c1")).toBeNull();
    expect(handleVoiceCommand("/voicechat", "telegram", "c1")).toBeNull();
  });

  it("shows current mode and usage for bare /voice", () => {
    const reply = handleVoiceCommand("/voice", "telegram", "c2");
    expect(reply).toContain("Voice mode: auto");
    expect(reply).toContain("/voice on");
  });

  it("sets a valid mode", () => {
    const reply = handleVoiceCommand("/voice on", "telegram", "c3");
    expect(reply).toContain("on");
    expect(getVoiceMode("telegram", "c3")).toBe("on");
    handleVoiceCommand("/voice off", "telegram", "c3");
    expect(getVoiceMode("telegram", "c3")).toBe("off");
    handleVoiceCommand("/voice auto", "telegram", "c3");
    expect(getVoiceMode("telegram", "c3")).toBe("auto");
  });

  it("strips the bot username suffix", () => {
    const reply = handleVoiceCommand("/voice@NtoxBot on", "telegram", "c4");
    expect(reply).toContain("on");
    expect(getVoiceMode("telegram", "c4")).toBe("on");
  });

  it("rejects unknown modes without changing state", () => {
    const reply = handleVoiceCommand("/voice loud", "telegram", "c5");
    expect(reply).toContain('Unknown voice mode "loud"');
    expect(getVoiceMode("telegram", "c5")).toBe("auto");
  });
});

describe("voiceReplyText", () => {
  it("strips markdown markers", () => {
    expect(voiceReplyText("**Bold** and `code` with _italics_")).toBe("Bold and code with italics");
  });

  it("keeps short replies intact", () => {
    expect(voiceReplyText("All systems nominal.")).toBe("All systems nominal.");
  });

  it("truncates long replies", () => {
    const long = "x".repeat(VOICE_REPLY_MAX_CHARS + 100);
    const out = voiceReplyText(long);
    expect(out.length).toBeLessThanOrEqual(VOICE_REPLY_MAX_CHARS);
    expect(out.endsWith("...")).toBe(true);
  });
});
