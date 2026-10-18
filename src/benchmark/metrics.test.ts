import { describe, expect, it } from "vitest";
import { assessDelta, average, computeDomainDeltas, percentDelta, round } from "./metrics.js";

describe("benchmark metrics", () => {
  it("averages a list of scores and handles the empty case", () => {
    expect(average([8, 6, 10])).toBe(8);
    expect(average([])).toBe(0);
  });

  it("computes percentage deltas relative to the kernel-off baseline", () => {
    expect(percentDelta(8, 7)).toBe(14.3);
    expect(percentDelta(7, 8)).toBe(-12.5);
    expect(percentDelta(7, 7)).toBe(0);
  });

  it("does not divide by zero when the baseline is zero", () => {
    expect(percentDelta(5, 0)).toBe(100);
    expect(percentDelta(0, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(round(7.249)).toBe(7.2);
    expect(round(7.25)).toBe(7.3);
  });

  it("groups per-domain deltas by domain across mixed queries", () => {
    const deltas = computeDomainDeltas([
      { domain: "programming", on: 8, off: 7 },
      { domain: "programming", on: 6, off: 6 },
      { domain: "ai", on: 5, off: 10 },
    ]);

    expect(Object.keys(deltas).sort()).toEqual(["ai", "programming"]);
    expect(deltas.programming).toBe(7.7);
    expect(deltas.ai).toBe(-50);
  });

  it("assesses deltas with the documented thresholds", () => {
    expect(assessDelta(20)).toBe("Strong improvement");
    expect(assessDelta(10)).toBe("Moderate improvement");
    expect(assessDelta(0)).toBe("Neutral");
    expect(assessDelta(-20)).toBe("Regression");
  });
});
