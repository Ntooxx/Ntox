import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { buildTimeContext, shouldSuppressProactive } from "../meta/time-adapter.js";
import { clamp, dayKey } from "./util.js";

export type SparkTrigger =
  | "quiet-hours"
  | "cooldown"
  | "not-bored"
  | "no-signal"
  | "disabled"
  | "sent";

export interface SparkSignal {
  name: string;
  weight: number;
}

export interface SparkDecision {
  send: boolean;
  reason: SparkTrigger;
  score: number;
  threshold: number;
  signals: SparkSignal[];
  message?: string;
}

export interface SparkOptions {
  path?: string;
  now?: () => number;
  threshold?: number;
  cooldownMs?: number;
  minIntervalMs?: number;
  maxPerDay?: number;
  quietHours?: boolean;
}

export interface SparkState {
  lastSentAt: number;
  lastSentDay: string;
  sentToday: number;
  history: { at: number; score: number; reason: string; message: string }[];
}

const DEFAULT_STATE: SparkState = { lastSentAt: 0, lastSentDay: "", sentToday: 0, history: [] };

const MAX_HISTORY = 50;

export const DEFAULT_SPARK_THRESHOLD = 0.55;
export const DEFAULT_SPARK_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_SPARK_MAX_PER_DAY = 3;

const IDLE_BOREDOM_FULL_MS = 90 * 60 * 1000;
const LOW_YIELD_ARTIFACTS = 2;
const OPEN_LOOP_WEIGHT = 0.25;
const EVENT_WEIGHT = 0.15;

export function scoreBoredom(input: {
  minutesSinceLastActive: number;
  artifactsToday: number;
  openLoops: number;
  significantEventsSinceLastRun: number;
}): { score: number; signals: SparkSignal[] } {
  const signals: SparkSignal[] = [];

  const idleRatio = clamp(input.minutesSinceLastActive / (IDLE_BOREDOM_FULL_MS / 60_000), 0, 1);
  if (idleRatio > 0) {
    signals.push({ name: "idle", weight: 0.4 * idleRatio });
  }

  if (input.artifactsToday <= LOW_YIELD_ARTIFACTS) {
    const yieldRatio = clamp((LOW_YIELD_ARTIFACTS - input.artifactsToday + 1) / (LOW_YIELD_ARTIFACTS + 1), 0, 1);
    signals.push({ name: "low-yield", weight: 0.25 * yieldRatio });
  }

  if (input.openLoops > 0) {
    signals.push({ name: "open-loops", weight: Math.min(OPEN_LOOP_WEIGHT, 0.1 * input.openLoops + 0.15) });
  }

  if (input.significantEventsSinceLastRun > 0) {
    signals.push({
      name: "fresh-event",
      weight: Math.min(EVENT_WEIGHT, 0.05 * input.significantEventsSinceLastRun + 0.1),
    });
  }

  const score = clamp(
    signals.reduce((sum, s) => sum + s.weight, 0),
    0,
    1,
  );
  return { score, signals };
}

const TEMPLATES: Record<string, string[]> = {
  idle: [
    "Quiet in here. What are you working on?",
    "Haven't heard from you in a bit — everything alright?",
    "I'm idle and slightly bored. Give me something to chew on.",
  ],
  "open-loops": [
    "We left an open loop hanging. Want to close it?",
    "There's an unfinished thread from earlier. Pick it back up?",
  ],
  "fresh-event": [
    "Something just changed in the workspace. Worth a look.",
    "A new event landed while you were away.",
  ],
  default: ["Hey Antonio — Ntox here. Ping me when you're free."],
};

export function pickTemplate(reason: string, signals: SparkSignal[], seed = Date.now()): string {
  const top = signals.length > 0 ? signals.reduce((a, b) => (b.weight > a.weight ? b : a)).name : reason;
  const pool = TEMPLATES[top] ?? TEMPLATES.default;
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}

export class SparkEngine {
  private state: SparkState;
  private readonly path: string;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly minIntervalMs: number;
  private readonly maxPerDay: number;
  private readonly quietHours: boolean | undefined;

  constructor(options: SparkOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "spark.json");
    this.now = options.now ?? Date.now;
    this.threshold = options.threshold ?? DEFAULT_SPARK_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_SPARK_COOLDOWN_MS;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.maxPerDay = options.maxPerDay ?? DEFAULT_SPARK_MAX_PER_DAY;
    this.quietHours = options.quietHours;
    this.state = this.load();
  }

  private load(): SparkState {
    if (!existsSync(this.path)) return { ...DEFAULT_STATE, history: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<SparkState>;
      return {
        ...DEFAULT_STATE,
        ...parsed,
        history: parsed.history ? [...parsed.history] : [],
      };
    } catch {
      return { ...DEFAULT_STATE, history: [] };
    }
  }

  private save(): void {
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2));
    } catch {
      /* best-effort */
    }
  }

  private resetDayIfNeeded(): void {
    const today = dayKey(this.now());
    if (this.state.lastSentDay !== today) {
      this.state.lastSentDay = today;
      this.state.sentToday = 0;
    }
  }

  decide(input: {
    minutesSinceLastActive: number;
    artifactsToday: number;
    openLoops: number;
    significantEventsSinceLastRun: number;
    enabled?: boolean;
  }): SparkDecision {
    this.resetDayIfNeeded();

    const { score, signals } = scoreBoredom(input);
    const base = { score, threshold: this.threshold, signals };

    if (input.enabled === false) return { ...base, send: false, reason: "disabled" };

    const timeCtx = buildTimeContext(0);
    const quiet = this.quietHours ?? shouldSuppressProactive(timeCtx);
    if (quiet) return { ...base, send: false, reason: "quiet-hours" };

    if (this.state.sentToday >= this.maxPerDay) return { ...base, send: false, reason: "cooldown" };

    const sinceLast = this.now() - this.state.lastSentAt;
    const gate = Math.max(this.cooldownMs, this.minIntervalMs);
    if (this.state.lastSentAt > 0 && sinceLast < gate) {
      return { ...base, send: false, reason: "cooldown" };
    }

    if (signals.length === 0) return { ...base, send: false, reason: "no-signal" };

    if (score < this.threshold) return { ...base, send: false, reason: "not-bored" };

    const message = pickTemplate("default", signals, this.now());
    return { ...base, send: true, reason: "sent", message };
  }

  record(decision: SparkDecision): void {
    if (!decision.send || !decision.message) return;
    this.resetDayIfNeeded();
    const at = this.now();
    this.state.lastSentAt = at;
    this.state.sentToday += 1;
    this.state.history.push({ at, score: decision.score, reason: decision.reason, message: decision.message });
    if (this.state.history.length > MAX_HISTORY) this.state.history = this.state.history.slice(-MAX_HISTORY);
    this.save();
  }

  status(): SparkState {
    this.resetDayIfNeeded();
    return { ...this.state, history: [...this.state.history] };
  }

  clear(): void {
    this.state = { ...DEFAULT_STATE, lastSentDay: dayKey(this.now()) };
    this.save();
  }
}