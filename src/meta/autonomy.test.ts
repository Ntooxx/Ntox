import { describe, it, expect } from "vitest";
import { enforceBudget, calibrationGuardrail } from "./autonomy.js";

describe("autonomy budget", () => {
  it("allows a cycle within budget and rejects overspend", () => {
    const budget = { maxTokensPerCycle: 1000 };
    expect(enforceBudget(500, budget)).toBe(true);
    expect(enforceBudget(1001, budget)).toBe(false);
    expect(enforceBudget(-1, budget)).toBe(false);
  });
});

describe("calibration guardrail", () => {
  it("allows expansion while calibration is healthy", () => {
    const verdict = calibrationGuardrail({ identityDivergence: 0.45, calibrationEce: 0.1 });
    expect(verdict.allowed).toBe(true);
  });

  it("blocks expansion when calibration worsens while identity diverges", () => {
    const verdict = calibrationGuardrail({ identityDivergence: 0.5, calibrationEce: 0.2 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("Drift guardrail");
  });

  it("allows expansion when only calibration is below ceiling", () => {
    const verdict = calibrationGuardrail({ identityDivergence: 0.2, calibrationEce: 0.3 });
    expect(verdict.allowed).toBe(true);
  });
});