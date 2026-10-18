import type { LLMClient } from "../core/llm.js";
import type { Prediction } from "./types.js";
import type { HeuristicPredictor } from "./predictor.js";
import { clamp, estimateTokens, hashText } from "./util.js";

export type PredictionSource = "llm" | "cache" | "heuristic";

export interface PredictionAttempt {
  prediction: Prediction;
  source: PredictionSource;
  tokens: number;
}

export interface LLMPredictorOptions {
  ttlMs?: number;
  maxCacheEntries?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  now?: () => number;
}

interface CacheEntry {
  prediction: Prediction;
  at: number;
}

const PREDICTION_SYSTEM_PROMPT = [
  "You predict the outcome of the next turn for an AI agent.",
  "Reply with ONLY one compact JSON object and nothing else:",
  '{"intent":"debug|implement|explain|plan|fact|general","answerShape":"explanation|code|plan|short","expectedTools":["read"],"expectedOutcome":"what should happen","confidence":0.0}',
  "Keep expectedOutcome under 12 words. Confidence must be a number between 0 and 1. Never exceed 120 tokens.",
].join("\n");

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

export function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parsePrediction(text: string, base: Prediction): Prediction | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.expectedOutcome !== "string" || obj.expectedOutcome.trim().length === 0) return null;
  if (typeof obj.confidence !== "number" || Number.isNaN(obj.confidence)) return null;

  const confidence = clamp(obj.confidence, 0.1, 0.95);
  const answerShape =
    typeof obj.answerShape === "string" && obj.answerShape.trim().length > 0
      ? obj.answerShape.trim().slice(0, 30)
      : base.answerShape;
  const intent =
    typeof obj.intent === "string" && obj.intent.trim().length > 0 ? obj.intent.trim().slice(0, 30) : base.intent;
  const expectedTools = Array.isArray(obj.expectedTools)
    ? obj.expectedTools.filter((t): t is string => typeof t === "string").slice(0, 4)
    : base.expectedTools;

  return {
    intent,
    answerShape,
    expectedTools,
    expectedOutcome: obj.expectedOutcome.trim().slice(0, 160),
    confidence,
  };
}

export class LLMPredictor {
  private readonly llm: Pick<LLMClient, "stream">;
  private readonly heuristic: HeuristicPredictor;
  private readonly ttlMs: number;
  private readonly maxCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(llm: Pick<LLMClient, "stream">, heuristic: HeuristicPredictor, options: LLMPredictorOptions = {}) {
    this.llm = llm;
    this.heuristic = heuristic;
    this.ttlMs = options.ttlMs ?? 600_000;
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? 50);
    this.timeoutMs = Math.max(200, options.timeoutMs ?? 3_000);
    this.maxOutputTokens = Math.max(32, options.maxOutputTokens ?? 120);
    this.now = options.now ?? Date.now;
  }

  async predict(query: string, queryType: string): Promise<PredictionAttempt> {
    const base = this.heuristic.predict(query, queryType);
    const key = hashText(normalizeQuery(query));

    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at <= this.ttlMs) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { prediction: cached.prediction, source: "cache", tokens: 0 };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let text = "";
    let usageTokens = 0;
    try {
      const stream = this.llm.stream(
        [{ role: "user", content: query.slice(0, 4000) }],
        PREDICTION_SYSTEM_PROMPT,
        undefined,
        controller.signal,
      );
      for await (const chunk of stream) {
        if (chunk.delta) text += chunk.delta;
        if (chunk.usage) usageTokens = chunk.usage.inputTokens + chunk.usage.outputTokens;
        if (estimateTokens(text) >= this.maxOutputTokens) {
          controller.abort();
          break;
        }
      }
    } catch {
      return { prediction: base, source: "heuristic", tokens: usageTokens };
    } finally {
      clearTimeout(timer);
    }

    const parsed = parsePrediction(text, base);
    if (!parsed) {
      return { prediction: base, source: "heuristic", tokens: usageTokens || estimateTokens(text) };
    }

    const entry: CacheEntry = { prediction: parsed, at: this.now() };
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }

    return { prediction: parsed, source: "llm", tokens: usageTokens || estimateTokens(text) };
  }

  clearCache(): void {
    this.cache.clear();
  }

  cacheSize(): number {
    return this.cache.size;
  }
}
