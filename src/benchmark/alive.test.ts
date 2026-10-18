import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityStore } from "../mind/identity.js";
import type { LedgerStats } from "../mind/outcome-ledger.js";
import type { OutcomeRow } from "../mind/types.js";
import {
  M5_TARGETS,
  assessM5,
  aliveCurve,
  collectAliveRun,
  generateAliveReport,
  loadAliveRuns,
  saveAliveRun,
  type AliveRun,
} from "./alive.js";

function tempIdentity(): IdentityStore {
  return new IdentityStore({ path: join(mkdtempSync(join(tmpdir(), "ntox-alive-")), "identity.json") });
}

function row(seq: number, score: number, costUsd = 0): OutcomeRow {
  return {
    turnId: `t${seq}`,
    sessionId: "s",
    timestamp: seq,
    seq,
    queryType: "coding",
    responseMode: "chat",
    strategy: "coding",
    context: [],
    tools: [],
    signals: {
      corrected: score < 0,
      rephrased: false,
      thanked: score > 0,
      abandoned: false,
      falseSuccess: false,
      toolFailure: false,
    },
    score,
    tokens: 100,
    costUsd,
    latencyMs: 10,
    retries: 0,
  };
}

function trainedIdentity(): IdentityStore {
  const identity = tempIdentity();
  identity.setNarrative("Evidence-first agent with many corrections");
  identity.setValues(["evidence over fluency", "learn from correction", "prefer tests"]);
  identity.addPosition("testing", "prefer property tests", 0.85, ["c:1"]);
  identity.addPosition("style", "be terse with summaries", 0.75, ["c:2"]);
  identity.setActiveProjects(["ALIVE-1 benchmark"]);
  return identity;
}

function trainedLedgerStats(): LedgerStats {
  return {
    total: 5,
    avgScore: 0.26,
    correctedRate: 0.2,
    thankedRate: 0.6,
    abandonedRate: 0,
    toolFailureRate: 0,
    avgPredictionError: 0.2,
    avgLatencyMs: 400,
    avgTokens: 400,
    predictionSources: {},
    avgPredictionTokens: 0,
    byKind: [],
    byStrategy: [],
  };
}

describe("collectAliveRun", () => {
  it("collects all metric families from live stores", () => {
    const identity = trainedIdentity();
    const rows = [row(1, -0.5, 0.01), row(2, 0.3, 0.02), row(3, 0.4, 0.03), row(4, 0.5, 0.04), row(5, 0.6, 0.05)];
    const run = collectAliveRun({
      identity,
      ledger: trainedLedgerStats(),
      rows,
      calibration: { ece: 0.1, brier: 0.12, count: 50 },
      mistakes: { recurrenceRate: 0.2, followUps: 10, total: 15 },
      transfer: { total: 4, pending: 1, supported: 2, rejected: 1, avgLift: 0.15, supportedRate: 0.67 },
      idle: { yieldPerKToken: 0.4, totalCycles: 12 },
      strategyWeights: { coding: { verify: 1 } },
      now: () => 1_700_000_000_000,
    });
    expect(run.turns).toBe(5);
    expect(run.metrics.learningSlope).not.toBeNull();
    expect(run.metrics.learningSlope).toBeGreaterThan(0);
    expect(run.metrics.correctionRecurrence).toBe(0.2);
    expect(run.metrics.transferLift).toBe(0.15);
    expect(run.metrics.calibrationEce).toBe(0.1);
    expect(run.metrics.autonomyYield).toBe(0.4);
    expect(run.metrics.identityDivergence).toBeGreaterThan(M5_TARGETS.identityDivergence);
    expect(run.metrics.costPerSolvedTask).toBeGreaterThan(0);
    expect(run.fingerprintHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("nulls metrics when the underlying data is missing", () => {
    const run = collectAliveRun({ identity: tempIdentity(), now: () => 1 });
    expect(run.metrics.learningSlope).toBeNull();
    expect(run.metrics.correctionRecurrence).toBeNull();
    expect(run.metrics.transferLift).toBeNull();
    expect(run.metrics.calibrationEce).toBeNull();
    expect(run.metrics.autonomyYield).toBeNull();
    expect(run.metrics.costPerSolvedTask).toBeNull();
    expect(run.metrics.identityDivergence).toBe(0);
  });
});

function passingRun(): AliveRun {
  return {
    id: "alive-pass",
    timestamp: 1_700_000_000_000,
    turns: 500,
    fingerprintHash: "abc123def4567890",
    profileHash: "prof1234",
    metrics: {
      learningSlope: 0.05,
      correctionRecurrence: 0.1,
      transferLift: 0.12,
      calibrationEce: 0.1,
      autonomyYield: 0.2,
      identityDivergence: 0.55,
      costPerSolvedTask: 0.01,
      ncbOverall: 50,
    },
  };
}

describe("assessM5", () => {
  it("passes when all three acceptance targets are met", () => {
    const assessment = assessM5(passingRun(), { trials: 20, correct: 14, identificationRate: 0.7, history: [] });
    expect(assessment.met).toBe(true);
    expect(assessment.criteria.every((c) => c.met)).toBe(true);
  });

  it("fails when any target is missing", () => {
    const run = passingRun();
    run.metrics.identityDivergence = 0.2;
    const assessment = assessM5(run, { trials: 20, correct: 14, identificationRate: 0.7, history: [] });
    expect(assessment.met).toBe(false);
    expect(assessment.criteria.find((c) => c.key === "identityDivergence")?.met).toBe(false);
  });

  it("fails when voice trials have not been run", () => {
    const assessment = assessM5(passingRun(), { trials: 0, correct: 0, identificationRate: 0, history: [] });
    expect(assessment.met).toBe(false);
    expect(assessment.criteria.find((c) => c.key === "blindIdentification")?.met).toBe(false);
  });
});

describe("alive run persistence", () => {
  it("saves, loads, and orders the curve", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-alive-dir-"));
    const first: AliveRun = { ...passingRun(), id: "alive-1", timestamp: 1_000_000_000_000 };
    const second: AliveRun = { ...passingRun(), id: "alive-2", timestamp: 2_000_000_000_000, turns: 600 };
    saveAliveRun(first, dir);
    saveAliveRun(second, dir);
    const runs = loadAliveRuns(dir);
    expect(runs.map((r) => r.id)).toEqual(["alive-1", "alive-2"]);
    const curve = aliveCurve(runs);
    expect(curve).toHaveLength(2);
    expect(curve[0].metrics.identityDivergence).toBeGreaterThan(0);
  });

  it("returns an empty list for a missing directory", () => {
    expect(loadAliveRuns(join(tmpdir(), "definitely-missing-alive-dir"))).toHaveLength(0);
  });

  it("writes the M5 assessment into the saved markdown", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-alive-dir-"));
    const run = passingRun();
    const saved = saveAliveRun(run, dir, null, assessM5(run, null));
    const markdown = readFileSync(saved.mdPath, "utf-8");
    expect(markdown).toContain("## M5 Acceptance");
    expect(markdown).toContain("Milestone M5");
  });
});

describe("generateAliveReport", () => {
  it("renders metrics, delta, and M5 verdict", () => {
    const previous: AliveRun = {
      ...passingRun(),
      id: "alive-0",
      timestamp: 999_000_000_000,
      metrics: { ...passingRun().metrics, identityDivergence: 0.2, transferLift: 0.02 },
    };
    const report = generateAliveReport(passingRun(), previous, assessM5(passingRun(), null));
    expect(report).toContain("# ALIVE-1 Benchmark Run");
    expect(report).toContain("## Change vs previous run");
    expect(report).toContain("## M5 Acceptance");
    expect(report).toContain("Identity divergence");
    expect(report).toContain("Milestone M5");
  });
});
