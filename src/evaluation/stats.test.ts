import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  cohensD,
  inverseNormal,
  linearSlope,
  mean,
  mulberry32,
  pairedDifferences,
  requiredPairedSampleSize,
  stddev,
  variance,
} from "./stats.js";

describe("descriptive statistics", () => {
  it("computes mean, variance and stddev", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(values)).toBeCloseTo(5);
    expect(variance(values)).toBeCloseTo(4.5714, 3);
    expect(stddev(values)).toBeCloseTo(2.1381, 3);
  });

  it("handles empty and singleton inputs", () => {
    expect(mean([])).toBe(0);
    expect(variance([5])).toBe(0);
    expect(stddev([])).toBe(0);
  });

  it("computes paired differences", () => {
    expect(pairedDifferences([1, 2, 3], [2, 4, 3])).toEqual([1, 2, 0]);
  });
});

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("stays in [0, 1)", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("bootstrapCI", () => {
  it("flags a consistent positive effect as significant", () => {
    const diffs = [0.4, 0.5, 0.6, 0.45, 0.55, 0.5, 0.6, 0.4];
    const ci = bootstrapCI(diffs, { seed: 1 });
    expect(ci.mean).toBeGreaterThan(0.4);
    expect(ci.lower).toBeGreaterThan(0);
    expect(ci.significant).toBe(true);
  });

  it("does not flag a zero-centred effect as significant", () => {
    const diffs = [0.5, -0.5, 0.4, -0.4, 0.3, -0.3, 0.5, -0.5];
    const ci = bootstrapCI(diffs, { seed: 1 });
    expect(ci.significant).toBe(false);
  });

  it("is deterministic for a fixed seed", () => {
    const diffs = [0.1, 0.2, -0.05, 0.3, 0.0];
    expect(bootstrapCI(diffs, { seed: 9 })).toEqual(bootstrapCI(diffs, { seed: 9 }));
  });

  it("returns a null interval for empty input", () => {
    const ci = bootstrapCI([]);
    expect(ci.significant).toBe(false);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(0);
  });
});

describe("cohensD", () => {
  it("returns 0 for a zero-mean sample", () => {
    expect(cohensD([1, -1, 1, -1])).toBeCloseTo(0);
  });

  it("grows with effect size", () => {
    const weak = cohensD([0.1, 0.15, 0.05, 0.1]);
    const strong = cohensD([1, 1.1, 0.9, 1]);
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("linearSlope", () => {
  it("recovers an exact linear trend", () => {
    const result = linearSlope([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(1);
    expect(result.r2).toBeCloseTo(1);
  });

  it("returns a flat slope for constant values", () => {
    const result = linearSlope([
      { x: 0, y: 4 },
      { x: 1, y: 4 },
      { x: 2, y: 4 },
    ]);
    expect(result.slope).toBe(0);
  });

  it("handles a single point", () => {
    const result = linearSlope([{ x: 0, y: 3 }]);
    expect(result.slope).toBe(0);
    expect(result.n).toBe(1);
  });
});

describe("inverseNormal and power", () => {
  it("approximates the 97.5th percentile", () => {
    expect(inverseNormal(0.975)).toBeCloseTo(1.96, 1);
  });

  it("is monotonic", () => {
    expect(inverseNormal(0.9)).toBeGreaterThan(inverseNormal(0.75));
  });

  it("requires more samples for smaller effects", () => {
    const small = requiredPairedSampleSize(0.2);
    const large = requiredPairedSampleSize(0.8);
    expect(small).toBeGreaterThan(large);
    expect(large).toBeGreaterThanOrEqual(2);
  });

  it("returns infinity for a null effect", () => {
    expect(requiredPairedSampleSize(0)).toBe(Infinity);
  });
});
