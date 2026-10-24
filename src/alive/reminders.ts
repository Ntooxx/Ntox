import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AliveOpenLoop } from "./engine.js";
import { relativeAge } from "../utils/time.js";
import { getNtoxDir } from "../core/config.js";

export const OPEN_LOOP_IDLE_MS = 24 * 60 * 60 * 1000;
export const OPEN_LOOP_REMINDER_INTERVAL_MS = 15 * 60_000;
const MAX_REMINDER_LOOPS = 3;
const MAX_LEDGER_ENTRIES = 500;
const LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function findReminderLoops(
  loops: AliveOpenLoop[],
  now: number,
  idleMs: number = OPEN_LOOP_IDLE_MS,
): AliveOpenLoop[] {
  const cutoff = now - idleMs;
  return loops
    .filter((loop) => loop.status !== "completed" && loop.updatedAt <= cutoff)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, MAX_REMINDER_LOOPS);
}

export function renderOpenLoopReminder(loop: AliveOpenLoop, now: number): string {
  const age = relativeAge(loop.updatedAt, now);
  const idle = age === "just now" ? "moments ago" : age;
  const goal = loop.goal.replace(/\s+/g, " ").trim().slice(0, 160);
  const next = loop.nextEvidence ? ` Next step: ${loop.nextEvidence.replace(/\s+/g, " ").slice(0, 140)}` : "";
  return `You asked me to finish "${goal}" ${idle} — shall I continue?${next}`;
}

export interface LoopReminderLedgerOptions {
  file?: string | null;
  now?: () => number;
}

export class LoopReminderLedger {
  private file: string | null;
  private now: () => number;
  private entries = new Map<string, number>();

  constructor(options: LoopReminderLedgerOptions = {}) {
    this.file = options.file === undefined ? join(getNtoxDir(), "loop-reminders.json") : options.file;
    this.now = options.now ?? Date.now;
    this.entries = this.load();
  }

  shouldRemind(scope: string, loop: AliveOpenLoop): boolean {
    const last = this.entries.get(this.key(scope, loop));
    return last === undefined || loop.updatedAt > last;
  }

  remember(scope: string, loop: AliveOpenLoop): void {
    this.entries.set(this.key(scope, loop), this.now());
    this.persist();
  }

  private key(scope: string, loop: AliveOpenLoop): string {
    return `${scope}|${loop.id}`;
  }

  private load(): Map<string, number> {
    if (!this.file || !existsSync(this.file)) return new Map();
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      const cutoff = this.now() - LEDGER_RETENTION_MS;
      const entries = Object.entries(raw).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > cutoff,
      );
      return new Map(entries);
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      const cutoff = this.now() - LEDGER_RETENTION_MS;
      const entries = [...this.entries.entries()]
        .filter(([, remindedAt]) => remindedAt > cutoff)
        .sort((a, b) => a[1] - b[1])
        .slice(-MAX_LEDGER_ENTRIES);
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
    } catch {
      /* ledger state is best-effort */
    }
  }
}

export interface OpenLoopReminder {
  loop: AliveOpenLoop;
  text: string;
}

export interface CollectRemindersOptions {
  now: number;
  scope: string;
  ledger: LoopReminderLedger;
  idleMs?: number;
}

export function collectOpenLoopReminders(loops: AliveOpenLoop[], options: CollectRemindersOptions): OpenLoopReminder[] {
  const { now, scope, ledger } = options;
  return findReminderLoops(loops, now, options.idleMs ?? OPEN_LOOP_IDLE_MS)
    .filter((loop) => ledger.shouldRemind(scope, loop))
    .map((loop) => ({ loop, text: renderOpenLoopReminder(loop, now) }));
}
