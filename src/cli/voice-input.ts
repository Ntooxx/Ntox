import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export { findSpeechBounds, isSilent } from "../audio/vad.js";

export interface RecorderOptions {
  command?: string;
  outputPath?: string;
  spawnProcess?: (command: string, args: string[]) => ChildProcess;
}

export interface RecorderSession {
  stop(): Promise<Uint8Array>;
  cancel(): void;
  readonly outputPath: string;
}

function parseCommand(template: string, outputPath: string): { command: string; args: string[] } {
  const parts = template.replace(/\{out\}/g, outputPath).split(/\s+/).filter(Boolean);
  return { command: parts[0]!, args: parts.slice(1) };
}

export function startRecorder(options: RecorderOptions = {}): RecorderSession {
  const template = options.command || process.env.NTOX_RECORD_COMMAND;
  if (!template) {
    throw new Error("Microphone not configured. Set NTOX_RECORD_COMMAND (use {out} for the output file).");
  }
  const dir = options.outputPath ? "" : mkdtempSync(join(tmpdir(), "ntox-mic-"));
  const outputPath = options.outputPath || join(dir, "capture.wav");
  const { command, args } = parseCommand(template, outputPath);
  const spawnFn = options.spawnProcess ?? spawn;
  const child = spawnFn(command, args);

  return {
    outputPath,
    async stop() {
      if (!child.killed) child.kill("SIGINT");
      await new Promise((done) => child.once("close", done));
      return new Uint8Array(readFileSync(outputPath));
    },
    cancel() {
      if (!child.killed) child.kill("SIGINT");
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

