import { describe, expect, it } from "vitest";
import { assertAudioToolAllowed, containsAudioData, stripAudioData } from "./index.js";
import type { NtoxConfig } from "../types/index.js";

function configWithTools(...tools: string[]): NtoxConfig {
  return { profiles: [{ allowedTools: tools }] } as unknown as NtoxConfig;
}

describe("audio policy", () => {
  it("strips audio payloads from text before persistence", () => {
    const text = "reply data:audio/mpeg;base64,AQID done";
    expect(containsAudioData(text)).toBe(true);
    expect(stripAudioData(text)).toBe("reply [audio omitted] done");
  });

  it("requires explicit tool allowlist", () => {
    expect(() => assertAudioToolAllowed(configWithTools("read"), "stt")).toThrow(/not in allowedTools/);
    expect(() => assertAudioToolAllowed(configWithTools("stt", "tts"), "tts")).not.toThrow();
  });
});
