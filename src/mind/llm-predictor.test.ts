import { describe, expect, it } from "vitest";
import { LLMPredictor, extractJsonCandidate, parsePrediction } from "./llm-predictor.js";
import { HeuristicPredictor } from "./predictor.js";
import type { Prediction } from "./types.js";

const basePrediction: Prediction = {
  intent: "explain",
  answerShape: "explanation",
  expectedTools: [],
  expectedOutcome: "addresses the request directly",
  confidence: 0.55,
};

function fakeLLM(options: {
  chunks?: string[];
  hang?: boolean;
  throw?: boolean;
  usageTokens?: number;
  seen?: string[];
}) {
  return {
    async *stream(
      messages: { role: string; content: string }[],
      _system?: string,
      _tools?: unknown[],
      signal?: AbortSignal,
    ): AsyncGenerator<{ delta: string; usage?: { inputTokens: number; outputTokens: number; cost: number } }> {
      options.seen?.push(messages[0]?.content ?? "");
      if (options.throw) throw new Error("provider down");
      if (options.hang) {
        await new Promise<void>((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
        return;
      }
      for (const chunk of options.chunks ?? []) {
        if (signal?.aborted) throw new Error("cancelled");
        yield {
          delta: chunk,
          usage: { inputTokens: 40, outputTokens: options.usageTokens ?? 80, cost: 0 },
        };
      }
    },
  };
}

function predictor(llm: ReturnType<typeof fakeLLM>, now?: () => number): LLMPredictor {
  return new LLMPredictor(llm, new HeuristicPredictor(), {
    timeoutMs: 200,
    ...(now ? { now } : {}),
  });
}

describe("extractJsonCandidate", () => {
  it("extracts balanced json surrounded by prose", () => {
    const text = 'Sure! {"intent":"debug","confidence":0.6,"expectedOutcome":"finds the bug"} hope that helps';
    const json = extractJsonCandidate(text);
    expect(json).not.toBeNull();
    expect(JSON.parse(json as string)).toMatchObject({ intent: "debug" });
  });

  it("returns null when no json present", () => {
    expect(extractJsonCandidate("no json here")).toBeNull();
  });

  it("handles braces inside strings", () => {
    const text = '{"expectedOutcome":"uses {curly} braces","confidence":0.5}';
    expect(JSON.parse(extractJsonCandidate(text) as string).confidence).toBe(0.5);
  });
});

describe("parsePrediction", () => {
  it("parses a valid prediction and merges with base", () => {
    const parsed = parsePrediction(
      '{"intent":"plan","answerShape":"plan","expectedTools":["grep"],"expectedOutcome":"produces ordered steps","confidence":0.72}',
      basePrediction,
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.confidence).toBeCloseTo(0.72, 5);
    expect(parsed?.expectedOutcome).toBe("produces ordered steps");
    expect(parsed?.expectedTools).toEqual(["grep"]);
  });

  it("clamps out-of-range confidence", () => {
    const parsed = parsePrediction('{"expectedOutcome":"ok","confidence":3.5}', basePrediction);
    expect(parsed?.confidence).toBeLessThanOrEqual(0.95);
  });

  it("rejects missing confidence or outcome", () => {
    expect(parsePrediction('{"expectedOutcome":"ok"}', basePrediction)).toBeNull();
    expect(parsePrediction('{"confidence":0.5}', basePrediction)).toBeNull();
    expect(parsePrediction("not json", basePrediction)).toBeNull();
  });
});

describe("LLMPredictor", () => {
  const query = "read src/core/agent.ts and explain the retry loop carefully";

  it("uses the llm when the response is valid json", async () => {
    const llm = fakeLLM({
      chunks: [
        '{"intent":"explain","answerShape":"explanation","expectedTools":["read"],"expectedOutcome":"explains the retry loop","confidence":0.8}',
      ],
      usageTokens: 80,
    });
    const attempt = await predictor(llm).predict(query, "coding");
    expect(attempt.source).toBe("llm");
    expect(attempt.prediction.expectedOutcome).toBe("explains the retry loop");
    expect(attempt.tokens).toBe(120);
  });

  it("serves repeat queries from cache without calling the llm", async () => {
    const seen: string[] = [];
    const llm = fakeLLM({ chunks: ['{"expectedOutcome":"cached answer","confidence":0.6}'], seen });
    const p = predictor(llm);
    const first = await p.predict(query, "coding");
    const second = await p.predict(query, "coding");
    expect(first.source).toBe("llm");
    expect(second.source).toBe("cache");
    expect(second.tokens).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it("expires the cache after the ttl", async () => {
    const seen: string[] = [];
    let clock = 1_000_000;
    const llm = fakeLLM({ chunks: ['{"expectedOutcome":"fresh","confidence":0.6}'], seen });
    const p = predictor(llm, () => clock);
    await p.predict(query, "coding");
    clock += 600_001;
    const attempt = await p.predict(query, "coding");
    expect(attempt.source).toBe("llm");
    expect(seen).toHaveLength(2);
  });

  it("falls back to heuristic when the provider throws", async () => {
    const llm = fakeLLM({ throw: true });
    const attempt = await predictor(llm).predict(query, "coding");
    expect(attempt.source).toBe("heuristic");
    expect(attempt.prediction.confidence).toBeGreaterThan(0);
  });

  it("falls back to heuristic when the provider hangs past the timeout", async () => {
    const llm = fakeLLM({ hang: true });
    const attempt = await predictor(llm).predict(query, "coding");
    expect(attempt.source).toBe("heuristic");
  });

  it("falls back to heuristic on unparseable output", async () => {
    const llm = fakeLLM({ chunks: ["I am not going to give you JSON."] });
    const attempt = await predictor(llm).predict(query, "coding");
    expect(attempt.source).toBe("heuristic");
  });

  it("aborts runaway output at the token cap", async () => {
    async function* endless(): AsyncGenerator<{ delta: string }> {
      for (let i = 0; i < 10_000; i++) yield { delta: "x".repeat(64) };
    }
    const llm = { stream: endless };
    const p = new LLMPredictor(llm, new HeuristicPredictor(), { timeoutMs: 5_000, maxOutputTokens: 64 });
    const attempt = await p.predict(query, "coding");
    expect(attempt.prediction.confidence).toBeGreaterThan(0);
    expect(["heuristic", "llm"]).toContain(attempt.source);
  });
});
