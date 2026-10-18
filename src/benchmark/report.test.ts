import { describe, expect, it } from "vitest";
import { generateReport } from "./report.js";
import type { BenchmarkReport, QueryResult } from "./runner.js";

function makeResult(overrides: Partial<QueryResult>): QueryResult {
  const score = (overall: number) => ({
    accuracy: overall,
    depth: overall,
    completeness: overall,
    overall,
    reasoning: "ok",
  });
  return {
    queryId: "prog-1",
    domain: "programming",
    query: "Write an LRU cache",
    difficulty: 3,
    kernelOn: { response: "on response", score: score(8), tokens: 100, toolCalls: 0 },
    kernelOff: { response: "off response", score: score(7), tokens: 100, toolCalls: 0 },
    delta: 14.3,
    ...overrides,
  };
}

const report: BenchmarkReport = {
  rounds: [
    {
      name: "Round 1: Cold Start",
      description: "First encounter.",
      results: [makeResult({}), makeResult({ queryId: "ai-1", domain: "ai", delta: -50 })],
      kernelOnAvg: 6.5,
      kernelOffAvg: 8.5,
      deltaPercent: -23.5,
    },
  ],
  overallKernelOn: 6.5,
  overallKernelOff: 8.5,
  overallDelta: -23.5,
  domainDeltas: { programming: 14.3, ai: -50 },
  timestamp: 1700000000000,
  model: "test/model",
};

describe("generateReport", () => {
  const markdown = generateReport(report);

  it("renders the summary and per-domain delta tables", () => {
    expect(markdown).toContain("# NTOX Cognitive Kernel Benchmark Report");
    expect(markdown).toContain("| Overall Score | 6.5/10 | 8.5/10 | -23.5% |");
    expect(markdown).toContain("| programming | +14.3% | Moderate improvement |");
    expect(markdown).toContain("| ai | -50% | Regression |");
  });

  it("renders round and per-query score rows", () => {
    expect(markdown).toContain("## Round 1: Cold Start");
    expect(markdown).toContain("| prog-1 | programming | 8 | 8 | 8 | 7 | 7 | 7 | +14.3% |");
    expect(markdown).toContain("Kernel ON (8/10)");
    expect(markdown).toContain("Kernel OFF (7/10)");
  });

  it("states a regression in the conclusion when the overall delta is negative", () => {
    expect(markdown).toContain("## Conclusion");
    expect(markdown).toContain("did not show improvement (-23.5%)");
  });
});
