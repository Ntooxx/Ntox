import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PlaybackOptions {
  command?: string;
  spawnProcess?: (command: string, args: string[]) => ChildProcess;
}

export interface PlaybackResult {
  ok: boolean;
  error?: string;
}

export function dataUrlToBuffer(dataUrl: string): { bytes: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { bytes: Buffer.from(match[2]!, "base64"), mimeType: match[1]! };
}

function platformCommand(file: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${file}').PlaySync()`],
    };
  }
  if (process.platform === "darwin") return { command: "afplay", args: [file] };
  return { command: "aplay", args: [file] };
}

export async function playDataUrlAudio(dataUrl: string, options: PlaybackOptions = {}): Promise<PlaybackResult> {
  const decoded = dataUrlToBuffer(dataUrl);
  if (!decoded) return { ok: false, error: "Not a base64 audio data URL" };

  const dir = mkdtempSync(join(tmpdir(), "ntox-speak-"));
  const extension = decoded.mimeType.includes("ogg") ? "ogg" : decoded.mimeType.includes("wav") ? "wav" : "mp3";
  const file = join(dir, `reply.${extension}`);
  writeFileSync(file, decoded.bytes);

  try {
    const template = options.command || process.env.NTOX_PLAY_COMMAND;
    const base = template
      ? template
          .replace(/\{file\}/g, file)
          .split(/\s+/)
          .filter(Boolean)
      : (() => {
          const command = platformCommand(file);
          return [command.command, ...command.args];
        })();
    const spawnFn = options.spawnProcess ?? spawn;
    await new Promise<void>((done, reject) => {
      const child = spawnFn(base[0]!, base.slice(1));
      child.once("error", reject);
      child.once("close", (code) => (code === 0 ? done() : reject(new Error(`player exited ${code}`))));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
