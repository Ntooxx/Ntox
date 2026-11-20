import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findSpeechBounds, startRecorder } from "./voice-input.js";
import { dataUrlToBuffer, playDataUrlAudio } from "./voice-output.js";

class FakeProcess extends EventEmitter {
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", 0));
    return true;
  }
}

afterEach(() => {
  delete process.env.NTOX_RECORD_COMMAND;
  delete process.env.NTOX_PLAY_COMMAND;
});

describe("voice input", () => {
  it("finds speech bounds by RMS", () => {
    const samples = new Int16Array([0, 0, 0, 0, 1000, 1000, 1000, 1000, 0, 0, 0, 0]);
    expect(findSpeechBounds(samples, 100, 2)).toEqual({ start: 4, end: 8 });
    expect(findSpeechBounds(new Int16Array(8), 100, 2)).toBeNull();
  });

  it("records into the configured output file", async () => {
    const out = join(process.env.NTOX_DIR!, "capture.wav");
    writeFileSync(out, new Uint8Array([1, 2, 3]));
    const child = new FakeProcess();
    const session = startRecorder({
      command: `fake-recorder --out {out}`,
      outputPath: out,
      spawnProcess: () => child as never,
    });
    const data = await session.stop();
    expect([...data]).toEqual([1, 2, 3]);
    expect(child.killed).toBe(true);
  });
});

describe("voice output", () => {
  it("decodes a data URL", () => {
    const decoded = dataUrlToBuffer("data:audio/mpeg;base64,AQID");
    expect(decoded?.mimeType).toBe("audio/mpeg");
    expect([...(decoded?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("spawns the configured player", async () => {
    const commands: string[] = [];
    const played = await playDataUrlAudio("data:audio/mpeg;base64,AQID", {
      command: "fake-player {file}",
      spawnProcess: (command, args) => {
        commands.push(command, ...args);
        const child = new FakeProcess();
        queueMicrotask(() => child.emit("close", 0));
        return child as never;
      },
    });
    expect(played.ok).toBe(true);
    expect(commands[0]).toBe("fake-player");
  });
});
