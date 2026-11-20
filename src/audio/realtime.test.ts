import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createRealtimeSession } from "./index.js";
import type { AudioConfig } from "./types.js";

class FakeSocket extends EventEmitter {
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit("close");
  }
}

const config: AudioConfig = {
  apiKey: "key",
  sttProvider: "openai",
  sttModel: "whisper-1",
  ttsProvider: "openai",
  ttsModel: "tts-1",
  ttsVoice: "nova",
  ttsStyle: "profile",
  audioBaseUrl: "",
  sttApiKey: "",
  ttsApiKey: "",
};

describe("realtime session", () => {
  it("configures the session, forwards audio and supports barge-in", async () => {
    const socket = new FakeSocket();
    const session = createRealtimeSession(config, {
      instructions: "be brief",
      socketFactory: () => socket,
    });
    const audio: Uint8Array[] = [];
    session.onAudio((bytes) => audio.push(bytes));
    const ready = session.ready;
    socket.emit("open");
    await ready;

    expect(JSON.parse(socket.sent[0]!).session.voice).toBe("nova");
    expect(JSON.parse(socket.sent[0]!).session.instructions).toBe("be brief");

    session.sendAudio(new Uint8Array([1, 2, 3]));
    session.commitAudio();
    session.interrupt();
    socket.emit("message", JSON.stringify({ type: "response.audio.delta", delta: "AQID" }));

    expect([...audio[0]!]).toEqual([1, 2, 3]);
    expect(socket.sent.map((line) => JSON.parse(line).type)).toContain("response.cancel");
  });
});
