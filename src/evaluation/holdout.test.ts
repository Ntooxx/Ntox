import { describe, it, expect } from "vitest";
import { splitHoldout, isHoldout, transferSummary } from "./holdout.js";

describe("holdout partitioning", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `task-${i}`);

  it("partitions deterministically and preserves every id", () => {
    const a = splitHoldout(ids, "fp-1", 0.2);
    const b = splitHoldout(ids, "fp-1", 0.2);
    expect(a.holdout).toEqual(b.holdout);
    expect(a.holdout.length).toBeGreaterThan(0);
    expect(a.train.length + a.holdout.length).toBe(ids.length);
  });

  it("changes the split when the fingerprint changes", () => {
    const a = splitHoldout(ids, "fp-1", 0.2);
    const b = splitHoldout(ids, "fp-2", 0.2);
    expect(a.holdout).not.toEqual(b.holdout);
  });

  it("marks membership consistently with isHoldout", () => {
    const { holdout } = splitHoldout(ids, "fp-1", 0.2);
    const set = new Set(holdout);
    for (const id of ids) {
      expect(isHoldout(id, set)).toBe(holdout.includes(id));
    }
  });

  it("renders a transfer summary", () => {
    const lines = transferSummary(new Set(["task-1"]), { supported: 3, rejected: 1, avgLift: 0.12 });
    expect(lines.join("\n")).toContain("Holdout tasks: 1");
    expect(lines.join("\n")).toContain("avgLift: 0.1200");
  });
});
