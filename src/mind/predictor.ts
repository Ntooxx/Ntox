import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { Prediction, PredictionResult, TurnSignals } from "./types.js";
import { clamp } from "./util.js";

const INTENT_PATTERNS: [string, RegExp][] = [
  ["debug", /\b(fix|bug|error|fail|broken|debug|crash|not working|stack ?trace)\b/i],
  ["implement", /\b(build|create|implement|add|generate|refactor|write)\b/i],
  ["explain", /\b(explain|what is|what are|how does|why|describe|define|compare|analyz|evaluat)\b/i],
  ["plan", /\b(plan|roadmap|steps|strategy|timeline|design|architecture|approach)\b/i],
  ["fact", /\b(who|when|where|how many|how much|latest|current|price|statistic)\b/i],
];

const CODE_HINT = /\b(code|function|class|script|implement|bug|error|test|type|import|const|let|async)\b/i;
const FILE_HINT = /(^|\s)[~./\\][\w./\\-]+|\b\w+\.(ts|js|py|json|md|rs|go|sql|yml|yaml|sh)\b/i;
const WEB_HINT = /\b(search|latest|current|news|web|online|price|today|recent)\b/i;
const PLAN_HINT = /\b(plan|roadmap|steps|strategy|how to|approach|phase|milestone)\b/i;
const THANKS_HINT = /\b(thanks|thank you|perfect|great|awesome|works|helpful|amazing|nice)\b/i;
const REPHRASE_HINT = /^(i meant|what i meant|no,? i|try again|that'?s not what|i wanted|rephrase|actually,? i want)/i;

export function isThanked(message: string): boolean {
  return THANKS_HINT.test(message);
}

export function isRephrase(message: string): boolean {
  return REPHRASE_HINT.test(message.trim());
}

export function detectIntent(query: string): string {
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(query)) return intent;
  }
  return query.trim().split(/\s+/).length <= 3 ? "casual" : "general";
}

export function detectAnswerShape(query: string, intent: string): string {
  if (intent === "plan") return "plan";
  if ((intent === "debug" || intent === "implement") && CODE_HINT.test(query)) return "code";
  if (intent === "explain" || intent === "fact") return "explanation";
  if (intent === "casual") return "short";
  return CODE_HINT.test(query) ? "code" : "explanation";
}

export function detectExpectedTools(query: string): string[] {
  const tools: string[] = [];
  if (FILE_HINT.test(query)) tools.push("read");
  if (/\b(edit|change|update|fix file|write file|replace)\b/i.test(query)) tools.push("edit");
  if (/\b(run|execute|test|build|check output|debug)\b/i.test(query)) tools.push("shell");
  if (WEB_HINT.test(query)) tools.push("search");
  if (PLAN_HINT.test(query) && FILE_HINT.test(query)) tools.push("grep");
  return [...new Set(tools)].slice(0, 4);
}

export class HeuristicPredictor {
  predict(query: string, queryType: string): Prediction {
    const intent = detectIntent(query);
    const answerShape = detectAnswerShape(query, intent);
    const expectedTools = detectExpectedTools(query);
    const words = query.trim().split(/\s+/).length;
    const specificity = (FILE_HINT.test(query) ? 0.15 : 0) + (expectedTools.length > 0 ? 0.1 : 0);
    const base = queryType === "factual" ? 0.5 : queryType === "creative" ? 0.45 : 0.55;
    const confidence = clamp(base + specificity + (words > 8 ? 0.1 : 0) - (words <= 3 ? 0.1 : 0), 0.3, 0.85);

    let expectedOutcome = "addresses the request directly";
    if (answerShape === "code") expectedOutcome = "produces working code or a code change";
    else if (answerShape === "plan") expectedOutcome = "produces an ordered set of steps";
    else if (answerShape === "short") expectedOutcome = "gives a brief conversational reply";
    else if (intent === "explain") expectedOutcome = "gives a clear explanation";

    return { intent, answerShape, expectedTools, expectedOutcome, confidence };
  }

  resolve(prediction: Prediction, signals: TurnSignals, usedTools: string[]): PredictionResult {
    let outcome: number;
    if (signals.corrected || signals.abandoned) outcome = 0.1;
    else if (signals.falseSuccess) outcome = 0.3;
    else if (signals.rephrased) outcome = 0.35;
    else if (signals.toolFailure) outcome = 0.55;
    else if (signals.thanked) outcome = 0.95;
    else outcome = 0.7;

    if (prediction.expectedTools.length > 0) {
      const overlap = prediction.expectedTools.filter((tool) => usedTools.includes(tool));
      if (overlap.length > 0) outcome = clamp(outcome + 0.1, 0, 1);
      else outcome = clamp(outcome - 0.2, 0, 1);
    }

    const error = Math.abs(prediction.confidence - outcome);
    const brier = Math.pow(prediction.confidence - outcome, 2);
    return { prediction, outcome, error, brier };
  }
}

export interface CalibrationStats {
  count: number;
  brier: number;
  ece: number;
  meanConfidence: number;
  meanOutcome: number;
}

interface CalibrationSample {
  confidence: number;
  outcome: number;
  timestamp: number;
  label?: string;
}

export type CalibrationByLabel = Record<string, CalibrationStats>;

function computeEce(samples: CalibrationSample[], count: number): number {
  const bins = 5;
  let ece = 0;
  for (let bin = 0; bin < bins; bin++) {
    const lo = bin / bins;
    const hi = (bin + 1) / bins;
    const members = samples.filter((x) =>
      bin === 0 ? x.confidence >= lo && x.confidence <= hi : x.confidence > lo && x.confidence <= hi,
    );
    if (members.length === 0) continue;
    const binConfidence = members.reduce((s, x) => s + x.confidence, 0) / members.length;
    const binOutcome = members.reduce((s, x) => s + x.outcome, 0) / members.length;
    ece += (members.length / count) * Math.abs(binConfidence - binOutcome);
  }
  return ece;
}

function summarizeSamples(samples: CalibrationSample[]): CalibrationStats {
  const count = samples.length;
  if (count === 0) return { count: 0, brier: 0, ece: 0, meanConfidence: 0, meanOutcome: 0 };
  const meanConfidence = samples.reduce((s, x) => s + x.confidence, 0) / count;
  const meanOutcome = samples.reduce((s, x) => s + x.outcome, 0) / count;
  const brier = samples.reduce((s, x) => s + Math.pow(x.confidence - x.outcome, 2), 0) / count;
  return { count, brier, ece: computeEce(samples, count), meanConfidence, meanOutcome };
}

export interface CalibrationOptions {
  path?: string;
  now?: () => number;
  maxSamples?: number;
}

export class CalibrationTracker {
  private samples: CalibrationSample[] = [];
  private loaded = false;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxSamples: number;

  constructor(options: CalibrationOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "calibration.json");
    this.now = options.now ?? Date.now;
    this.maxSamples = options.maxSamples ?? 2000;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      this.samples = JSON.parse(readFileSync(this.path, "utf-8")) as CalibrationSample[];
    } catch {
      this.samples = [];
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.samples, null, 2));
    } catch {
      this.dirty = true;
    }
  }

  record(confidence: number, outcome: number, label?: string): void {
    this.load();
    this.samples.push({
      confidence: clamp(confidence, 0, 1),
      outcome: clamp(outcome, 0, 1),
      timestamp: this.now(),
      ...(label ? { label } : {}),
    });
    if (this.samples.length > this.maxSamples) this.samples = this.samples.slice(-this.maxSamples);
    this.dirty = true;
  }

  stats(label?: string): CalibrationStats {
    this.load();
    const samples = label === undefined ? this.samples : this.samples.filter((s) => s.label === label);
    return summarizeSamples(samples);
  }

  byStrategy(): CalibrationByLabel {
    this.load();
    const groups = new Map<string, CalibrationSample[]>();
    for (const sample of this.samples) {
      const key = sample.label ?? "";
      const list = groups.get(key) ?? [];
      list.push(sample);
      groups.set(key, list);
    }
    const out: CalibrationByLabel = {};
    for (const [label, members] of groups) {
      out[label] = summarizeSamples(members);
    }
    return out;
  }

  clear(): void {
    this.load();
    this.samples = [];
    this.dirty = true;
    this.flush();
  }
}
