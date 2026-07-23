import type { EffectivenessResult } from "./effectiveness.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const OPTIMIZER_PATH = join(NTOX_DIR, "style-optimizer.json");

export interface ResponseStyle {
  verbosity: "concise" | "balanced" | "detailed";
  hasCode: boolean;
  hasBullets: boolean;
  hasExamples: boolean;
  length: number;
}

export interface StyleWeights {
  verbosity: Record<string, number> & { concise: number; balanced: number; detailed: number };
  directness: Record<string, number> & { direct: number; narrative: number; balanced: number };
  structure: Record<string, number> & { paragraphs: number; bullets: number; code: number };
  examples: Record<string, number> & { few: number; some: number; many: number };
}

const DEFAULT_WEIGHTS: StyleWeights = {
  verbosity: { concise: 0.2, balanced: 0.6, detailed: 0.2 },
  directness: { direct: 0.3, narrative: 0.3, balanced: 0.4 },
  structure: { paragraphs: 0.4, bullets: 0.3, code: 0.3 },
  examples: { few: 0.3, some: 0.4, many: 0.3 },
};

const ADJUSTMENT_RATE = 0.08;

function softmax(values: Record<string, number>): Record<string, number> {
  const entries = Object.entries(values);
  const expVals = entries.map(([k, v]) => [k, Math.exp(v)] as [string, number]);
  const sum = expVals.reduce((s, [, v]) => s + v, 0);
  if (sum === 0) return values;
  return Object.fromEntries(expVals.map(([k, v]) => [k, v / sum]));
}

export class StyleOptimizer {
  private weights: StyleWeights;
  private totalSamples: number = 0;
  private lastResponseStyle: ResponseStyle | null = null;
  private dirty = false;

  constructor() {
    this.weights = this.load();
  }

  private load(): StyleWeights {
    if (!existsSync(OPTIMIZER_PATH)) return JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
    try {
      const raw = JSON.parse(readFileSync(OPTIMIZER_PATH, "utf-8"));
      const merged: StyleWeights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
      if (raw.weights) {
        for (const dim of Object.keys(merged) as (keyof StyleWeights)[]) {
          if (raw.weights[dim]) {
            for (const k of Object.keys(raw.weights[dim])) {
              if (k in merged[dim]) merged[dim][k] = raw.weights[dim][k];
            }
          }
        }
      }
      return merged;
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
    }
  }

  private save(): void {
    writeFileSync(OPTIMIZER_PATH, JSON.stringify({ weights: this.weights, totalSamples: this.totalSamples }, null, 2));
  }

  private persist(): void {
    if (this.dirty) {
      this.save();
      this.dirty = false;
    }
  }

  setLastResponse(style: ResponseStyle): void {
    this.lastResponseStyle = style;
  }

  update(effectiveness: EffectivenessResult): void {
    if (!this.lastResponseStyle) return;
    this.totalSamples++;

    const rate = effectiveness.isPositive ? ADJUSTMENT_RATE : effectiveness.isNegative ? -ADJUSTMENT_RATE * 1.5 : ADJUSTMENT_RATE * 0.2;

    // Helper to softmax in-place
    const softmaxInPlace = (obj: Record<string, number>): void => {
      const normalized = softmax(obj);
      for (const k of Object.keys(normalized)) obj[k] = normalized[k];
    };

    // Update verbosity weights
    const verbKey = this.lastResponseStyle.verbosity;
    this.weights.verbosity[verbKey] = Math.max(0.05, Math.min(0.9, this.weights.verbosity[verbKey] + rate));
    softmaxInPlace(this.weights.verbosity);
    this.dirty = true;

    // Update directness based on verbosity + structure
    let directnessKey: keyof StyleWeights["directness"] = "balanced";
    if (this.lastResponseStyle.length < 200 && !this.lastResponseStyle.hasCode) directnessKey = "direct";
    else if (this.lastResponseStyle.hasExamples) directnessKey = "narrative";
    this.weights.directness[directnessKey] = Math.max(0.05, Math.min(0.9, this.weights.directness[directnessKey] + rate * 0.5));
    softmaxInPlace(this.weights.directness);
    this.dirty = true;

    // Update structure weights
    if (this.lastResponseStyle.hasBullets) {
      this.weights.structure.bullets = Math.max(0.05, Math.min(0.9, this.weights.structure.bullets + rate * 0.5));
    } else if (this.lastResponseStyle.hasCode) {
      this.weights.structure.code = Math.max(0.05, Math.min(0.9, this.weights.structure.code + rate * 0.5));
    } else {
      this.weights.structure.paragraphs = Math.max(0.05, Math.min(0.9, this.weights.structure.paragraphs + rate * 0.5));
    }
    softmaxInPlace(this.weights.structure);
    this.dirty = true;

    // Update examples weights
    if (this.lastResponseStyle.hasExamples) {
      this.weights.examples.some = Math.max(0.05, Math.min(0.9, this.weights.examples.some + rate * 0.5));
    } else if (this.weights.examples.few > this.weights.examples.many) {
      this.weights.examples.few = Math.max(0.05, Math.min(0.9, this.weights.examples.few + rate * 0.3));
    } else {
      this.weights.examples.many = Math.max(0.05, Math.min(0.9, this.weights.examples.many + rate * 0.3));
    }
    softmaxInPlace(this.weights.examples);
    this.dirty = true;

    this.persist();
  }

  getGuidance(): string {
    const lines: string[] = [];

    // Verbosity
    const verb = Object.entries(this.weights.verbosity).sort((a, b) => b[1] - a[1])[0];
    if (verb[0] === "concise" && verb[1] > 0.5) {
      lines.push("- User prefers concise responses. Be direct and avoid unnecessary detail.");
    } else if (verb[0] === "detailed" && verb[1] > 0.5) {
      lines.push("- User prefers detailed, thorough responses. Include depth.");
    } else {
      lines.push("- Adapt verbosity to the question. Default to balanced.");
    }

    // Directness
    const dir = Object.entries(this.weights.directness).sort((a, b) => b[1] - a[1])[0];
    if (dir[0] === "direct" && dir[1] > 0.5) {
      lines.push("- User prefers direct answers. Get to the point quickly.");
    } else if (dir[0] === "narrative" && dir[1] > 0.5) {
      lines.push("- User responds well to context and explanation. Set up the background.");
    }

    // Structure
    const struct = Object.entries(this.weights.structure).sort((a, b) => b[1] - a[1])[0];
    if (struct[0] === "bullets" && struct[1] > 0.4) {
      lines.push("- User responds well to bullet points and lists.");
    } else if (struct[0] === "code" && struct[1] > 0.4) {
      lines.push("- User engages with code examples. Include code when relevant.");
    }

    // Examples
    const ex = Object.entries(this.weights.examples).sort((a, b) => b[1] - a[1])[0];
    if (ex[0] === "many" && ex[1] > 0.4) {
      lines.push("- User likes concrete examples. Include 1-2 examples when explaining.");
    } else if (ex[0] === "few" && ex[1] > 0.5) {
      lines.push("User prefers minimal examples. Focus on the explanation itself.");
    }

    if (this.totalSamples < 3) {
      lines.push("- Still learning communication style. Stay adaptive.");
    }

    return lines.join("\n");
  }

  reset(): void {
    this.weights = { ...DEFAULT_WEIGHTS };
    this.totalSamples = 0;
    this.dirty = true;
    this.persist();
  }
}

export function classifyResponseStyle(response: string): ResponseStyle {
  const lower = response.toLowerCase();
  const len = response.length;

  let verbosity: ResponseStyle["verbosity"] = "balanced";
  if (len < 150) verbosity = "concise";
  else if (len > 600) verbosity = "detailed";

  return {
    verbosity,
    hasCode: lower.includes("```") || lower.includes("<tool_call>") || lower.includes("function") && lower.includes("{"),
    hasBullets: /^[-*]\s/m.test(lower),
    hasExamples: /\b(for example|for instance|e\.g\.|like|such as)\b/i.test(lower),
    length: len,
  };
}

// A/B test state — persisted to disk
const AB_PATH = join(NTOX_DIR, "ab-tests.json");

function loadABTests(): Record<string, { variantA: number; variantB: number; wins: number; total: number }> {
  try {
    if (existsSync(AB_PATH)) return JSON.parse(readFileSync(AB_PATH, "utf-8"));
  } catch { /* start fresh */ }
  return {};
}

function saveABTests(tests: Record<string, { variantA: number; variantB: number; wins: number; total: number }>): void {
  writeFileSync(AB_PATH, JSON.stringify(tests, null, 2));
}

function getABTests(): Record<string, { variantA: number; variantB: number; wins: number; total: number }> {
  return loadABTests();
}

export function getABTestVariant(testKey: string): "A" | "B" {
  const tests = getABTests();
  if (!tests[testKey]) {
    tests[testKey] = { variantA: 0, variantB: 0, wins: 0, total: 0 };
  }
  const test = tests[testKey];
  if (test.total >= 6) {
    const winRate = test.wins / test.total;
    if (winRate > 0.7) {
      return test.wins > test.total / 2 ? "A" : "B";
    }
    if (winRate < 0.3) {
      return test.wins > test.total / 2 ? "B" : "A";
    }
  }
  const next = test.variantA <= test.variantB ? "A" : "B";
  test[next === "A" ? "variantA" : "variantB"]++;
  saveABTests(tests);
  return next as "A" | "B";
}

export function recordABResult(testKey: string, variant: "A" | "B", positive: boolean): void {
  const tests = getABTests();
  if (!tests[testKey]) {
    tests[testKey] = { variantA: 0, variantB: 0, wins: 0, total: 0 };
  }
  tests[testKey].total++;
  if (positive) tests[testKey].wins++;
  saveABTests(tests);
}

