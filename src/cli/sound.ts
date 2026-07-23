import { execSync } from "node:child_process";
import type { SoundConfig } from "../types/index.js";

type Note = [frequency: number, durationMs: number];

const MELODIES: Record<string, Note[]> = {
  startup: [
    [523, 100], [659, 100], [784, 100], [1047, 200],
    [784, 80], [1047, 300],
  ],
  notification: [
    [880, 80], [1109, 80],
  ],
  error: [
    [370, 150], [311, 150], [262, 250],
  ],
  memory: [
    [1047, 40], [1319, 40],
  ],
  think: [
    [440, 30],
  ],
  done: [
    [784, 60], [988, 60], [1175, 120],
  ],
  connect: [
    [523, 60], [659, 60], [784, 60], [1047, 100],
  ],
};

let soundConfig: SoundConfig = { enabled: false, volume: 50 };

export function setSoundConfig(config: SoundConfig): void {
  soundConfig = config;
}

export function getSoundConfig(): SoundConfig {
  return { ...soundConfig };
}

function beepWin(frequency: number, duration: number): void {
  try {
    execSync(
      `powershell -c "[Console]::Beep(${Math.round(frequency)}, ${Math.round(duration)})"`,
      { timeout: duration + 500, windowsHide: true }
    );
  } catch {
    // fallback to terminal bell
    try { process.stdout.write("\x07"); } catch { /* silent */ }
  }
}

let isPlaying = false;
let playQueue: Note[] = [];

function playNext(): void {
  if (playQueue.length === 0) {
    isPlaying = false;
    return;
  }
  isPlaying = true;
  const [freq, dur] = playQueue.shift()!;
  beepWin(freq, dur);
  setTimeout(playNext, dur + 20);
}

export function playMelody(name: string): void {
  if (!soundConfig.enabled) return;

  const melody = MELODIES[name];
  if (!melody) return;

  const volFactor = soundConfig.volume / 100;
  if (volFactor <= 0) return;

  const adjusted: Note[] = melody.map(
    ([f, d]) => [f, Math.max(20, Math.round(d * volFactor))] as Note
  );

  if (isPlaying) {
    playQueue.push(...adjusted);
    return;
  }

  playQueue = [...adjusted];
  playNext();
}

export async function testSound(): Promise<void> {
  const prev = { ...soundConfig };
  soundConfig.enabled = true;
  soundConfig.volume = 100;

  const melody = MELODIES.notification;
  for (const [f, d] of melody) {
    beepWin(f, d);
    await new Promise((r) => setTimeout(r, d + 50));
  }

  Object.assign(soundConfig, prev);
}
