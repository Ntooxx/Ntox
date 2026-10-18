import { describe, expect, it } from "vitest";
import { easeInOutCubic, easeOutCubic, easeOutExpo, lerp, progressTrack, shimmerFrame } from "./motion.js";
import { stripAnsi } from "./theme.js";

describe("motion easing", () => {
  it("keeps ease functions within 0..1", () => {
    for (const fn of [easeOutCubic, easeOutExpo, easeInOutCubic]) {
      expect(fn(0)).toBeCloseTo(0, 5);
      expect(fn(1)).toBeCloseTo(1, 5);
      const mid = fn(0.5);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);
    }
  });

  it("eases out faster than linear", () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.25);
  });

  it("lerps and clamps", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(10);
    expect(lerp(0, 10, -1)).toBe(0);
  });
});

describe("motion visuals", () => {
  it("keeps shimmer frames at fixed width", () => {
    expect(stripAnsi(shimmerFrame(24, 0))).toHaveLength(24);
    expect(stripAnsi(shimmerFrame(24, 500))).toHaveLength(24);
  });

  it("keeps progress tracks at fixed width", () => {
    expect(stripAnsi(progressTrack(0, 20))).toHaveLength(20);
    expect(stripAnsi(progressTrack(100, 20))).toHaveLength(20);
  });
});
