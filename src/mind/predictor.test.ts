import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CalibrationTracker,
  HeuristicPredictor,
  detectAnswerShape,
  detectIntent,
  isRephrase,
  isThanked,
} from "./predictor.js";

const neutralSignals = {
  corrected: false,
  rephrased: false,
  thanked: false,
  abandoned: false,
  falseSuccess: false,
  toolFailure: false,
};

describe("predictor helpers", () => {
  it("detects debug intent", () => {
    expect(detectIntent("fix this failing test in auth.ts")).toBe("debug");
  });

  it("detects plan intent and shape", () => {
    expect(detectIntent("plan a roadmap for the migration")).toBe("plan");
    expect(detectAnswerShape("plan a roadmap for the migration", "plan")).toBe("plan");
  });

  it("detects thanks and rephrase", () => {
    expect(isThanked("thanks, that works")).toBe(true);
    expect(isRephrase("what i meant was the other file")).toBe(true);
    expect(isRephrase("hello there")).toBe(false);
  });
});

describe("HeuristicPredictor", () => {
  const predictor = new HeuristicPredictor();

  it("predicts tools for file-oriented queries", () => {
    const prediction = predictor.predict("read src/core/agent.ts and explain the loop", "coding");
    expect(prediction.expectedTools).toContain("read");
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });

  it("resolves a thanked turn as success", () => {
    const prediction = predictor.predict("fix the failing test in auth.ts", "coding");
    const result = predictor.resolve(prediction, { ...neutralSignals, thanked: true }, prediction.expectedTools);
    expect(result.outcome).toBeGreaterThan(0.8);
    expect(result.error).toBeGreaterThanOrEqual(0);
    expect(result.brier).toBeGreaterThanOrEqual(0);
  });

  it("resolves a correction as failure", () => {
    const prediction = predictor.predict("write a parser", "coding");
    const result = predictor.resolve(prediction, { ...neutralSignals, corrected: true }, []);
    expect(result.outcome).toBeLessThan(0.3);
  });

  it("penalizes missed expected tools", () => {
    const prediction = predictor.predict("read config.json and summarize it", "coding");
    const withTools = predictor.resolve(prediction, { ...neutralSignals }, prediction.expectedTools);
    const withoutTools = predictor.resolve(prediction, { ...neutralSignals }, []);
    expect(withTools.outcome).toBeGreaterThan(withoutTools.outcome);
  });
});

describe("CalibrationTracker", () => {
  it("reports calibration stats", () => {
    const tracker = new CalibrationTracker({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cal-")), "calibration.json"),
    });
    tracker.record(0.9, 1);
    tracker.record(0.1, 0);
    tracker.record(0.5, 1);
    const stats = tracker.stats();
    expect(stats.count).toBe(3);
    expect(stats.brier).toBeGreaterThanOrEqual(0);
    expect(stats.ece).toBeGreaterThanOrEqual(0);
  });

  it("reports perfect calibration when confidence equals outcome", () => {
    const tracker = new CalibrationTracker({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cal-")), "calibration.json"),
    });
    for (let i = 0; i < 20; i++) tracker.record(0.5, i % 2 === 0 ? 1 : 0);
    expect(tracker.stats().brier).toBeCloseTo(0.25, 5);
  });

  it("filters stats by strategy label", () => {
    const tracker = new CalibrationTracker({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cal-")), "calibration.json"),
    });
    tracker.record(0.9, 1, "direct");
    tracker.record(0.2, 0, "verify");
    tracker.record(0.5, 1);
    expect(tracker.stats("direct").count).toBe(1);
    expect(tracker.stats("verify").count).toBe(1);
    expect(tracker.stats().count).toBe(3);
  });

  it("groups samples by strategy", () => {
    const tracker = new CalibrationTracker({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cal-")), "calibration.json"),
    });
    for (let i = 0; i < 5; i++) tracker.record(0.8, 1, "direct");
    for (let i = 0; i < 3; i++) tracker.record(0.3, 0, "verify");
    const by = tracker.byStrategy();
    expect(by.direct.count).toBe(5);
    expect(by.verify.count).toBe(3);
    expect(by.direct.brier).toBeGreaterThanOrEqual(0);
  });

  it("includes unlabeled samples under empty key in byStrategy", () => {
    const tracker = new CalibrationTracker({
      path: join(mkdtempSync(join(tmpdir(), "ntox-cal-")), "calibration.json"),
    });
    tracker.record(0.5, 1);
    const by = tracker.byStrategy();
    expect(by[""].count).toBe(1);
  });
});
