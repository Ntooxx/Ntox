import { describe, expect, it } from "vitest";
import { allChecksPassed, environmentFingerprint, mechanicalReuseCheck } from "./checks.js";

describe("harness checks", () => {
  it("requires at least one passing check", () => {
    expect(allChecksPassed([])).toBe(false);
    expect(allChecksPassed([{ target: "a", type: "command", passed: false, detail: "x" }])).toBe(false);
    expect(allChecksPassed([{ target: "a", type: "command", passed: true, detail: "x" }])).toBe(true);
  });

  it("builds a deterministic mechanical-reuse check", () => {
    expect(mechanicalReuseCheck("outcome=succeeded")).toEqual({
      target: "procedure",
      type: "mechanical-reuse",
      passed: true,
      detail: "outcome=succeeded",
    });
  });

  it("fingerprints the environment independently of key order", () => {
    const a = environmentFingerprint({ task: "t1", model: "m1", workspace: "w1" });
    const b = environmentFingerprint({ workspace: "w1", task: "t1", model: "m1" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
