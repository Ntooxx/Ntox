import { describe, expect, it } from "vitest";
import {
  clamp01,
  dimensionResult,
  grade,
  metricScore,
  renderScorecardMarkdown,
  suiteFingerprint,
  totalScore,
  verifySuite,
  type DimensionResult,
  type ScorecardDimension,
  type ScorecardResult,
  type ScorecardSuite,
  type TaskResult,
} from "./scorecard.js";

function makeSuite(): ScorecardSuite {
  const dimensions: ScorecardDimension[] = [
    {
      id: "d1",
      label: "Memory",
      weight: 20,
      tasks: [
        { id: "t1", label: "Recall", kind: "memory-recall", weight: 0.6 },
        { id: "t2", label: "Artifact", kind: "artifact-metric", weight: 0.4, optional: true },
      ],
    },
    {
      id: "d2",
      label: "Offline",
      weight: 10,
      tasks: [{ id: "t3", label: "Embed", kind: "embed-offline", weight: 1 }],
    },
  ];
  return {
    suiteId: "test-suite",
    version: 1,
    sha256: "",
    notes: "test",
    dimensions,
    referenceBaselines: [{ id: "peer", label: "Peer", measured: false, total: 60, scores: { d1: 6, d2: 6 } }],
  };
}

function result(id: string, score: number, measured = true): TaskResult {
  return { id, label: id, score, passed: score >= 1, detail: `detail ${id}`, measured };
}

describe("suite fingerprint", () => {
  it("is stable for identical suites", () => {
    const suite = makeSuite();
    expect(suiteFingerprint(suite)).toBe(suiteFingerprint(makeSuite()));
  });

  it("changes when a task weight changes", () => {
    const suite = makeSuite();
    const changed = makeSuite();
    changed.dimensions[0]!.tasks[0]!.weight = 0.7;
    expect(suiteFingerprint(suite)).not.toBe(suiteFingerprint(changed));
  });

  it("verifies a pinned suite and rejects a tampered one", () => {
    const suite = makeSuite();
    suite.sha256 = suiteFingerprint(suite);
    expect(verifySuite(suite)).toBe(true);
    suite.dimensions[1]!.weight = 11;
    expect(verifySuite(suite)).toBe(false);
  });
});

describe("metricScore", () => {
  it("handles atLeast targets as a capped ratio", () => {
    expect(metricScore(0.7, "atLeast", 0.8)).toBeCloseTo(0.875, 5);
    expect(metricScore(1, "atLeast", 0.8)).toBe(1);
  });

  it("handles atMost targets as an inverse ratio", () => {
    expect(metricScore(0, "atMost", 0.05)).toBe(1);
    expect(metricScore(0.1, "atMost", 0.05)).toBeCloseTo(0.5, 5);
  });

  it("fails closed on non-finite input", () => {
    expect(metricScore(Number.NaN, "atLeast", 0.8)).toBe(0);
  });
});

describe("dimensionResult", () => {
  it("renormalises over measured tasks only", () => {
    const dimension = makeSuite().dimensions[0]!;
    const scored = dimensionResult(dimension, [result("t1", 0.5), result("t2", 1, false)]);
    expect(scored.coverage).toBeCloseTo(0.6, 5);
    expect(scored.score).toBeCloseTo(5, 5);
    expect(scored.tasks).toHaveLength(2);
  });

  it("returns zero score and zero coverage when nothing was measured", () => {
    const dimension = makeSuite().dimensions[0]!;
    const scored = dimensionResult(dimension, [result("t1", 1, false), result("t2", 1, false)]);
    expect(scored.score).toBe(0);
    expect(scored.coverage).toBe(0);
  });
});

describe("totalScore", () => {
  it("weights dimensions by effective (measured) weight", () => {
    const dimensions: DimensionResult[] = [
      { id: "d1", label: "D1", weight: 20, coverage: 0.6, score: 10, tasks: [] },
      { id: "d2", label: "D2", weight: 10, coverage: 1, score: 8, tasks: [] },
    ];
    const totals = totalScore(dimensions);
    expect(totals.total).toBeCloseTo(90.909, 2);
    expect(totals.coverage).toBeCloseTo(0.7333, 3);
  });
});

describe("grade", () => {
  it("maps boundaries", () => {
    expect(grade(85)).toBe("A");
    expect(grade(75)).toBe("B");
    expect(grade(65)).toBe("C");
    expect(grade(50)).toBe("D");
    expect(grade(49.9)).toBe("F");
  });
});

describe("renderScorecardMarkdown", () => {
  it("marks reference baselines as not measured", () => {
    const suite = makeSuite();
    suite.sha256 = suiteFingerprint(suite);
    const dimensions = suite.dimensions.map((dimension) =>
      dimensionResult(dimension, [result(dimension.tasks[0]!.id, 1)]),
    );
    const totals = totalScore(dimensions);
    const report: ScorecardResult = {
      suiteId: suite.suiteId,
      suiteSha256: suite.sha256,
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "deterministic",
      total: totals.total,
      coverage: totals.coverage,
      dimensions,
      referenceBaselines: suite.referenceBaselines,
    };
    const markdown = renderScorecardMarkdown(report);
    expect(markdown).toContain("NOT measured by this eval");
    expect(markdown).toContain("Total:");
    expect(markdown).toContain("## Caveats");
  });
});

describe("clamp01", () => {
  it("clamps out-of-range values", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
