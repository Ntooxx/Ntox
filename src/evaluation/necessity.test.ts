import { describe, expect, it } from "vitest";
import { runNecessityChecks } from "./necessity.js";

describe("runNecessityChecks", () => {
  it("proves each subsystem causally affects prompt context", async () => {
    const report = await runNecessityChecks();
    const failed = report.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(report.passed).toBe(true);
    expect(report.summary.total).toBe(6);
    expect(report.summary.failed).toBe(0);
  });

  it("covers every expected subsystem", async () => {
    const report = await runNecessityChecks();
    const subsystems = report.checks.map((check) => check.subsystem).sort();
    expect(subsystems).toEqual(
      [
        "cognitive-kernel",
        "episodic-memory",
        "false-success",
        "mistake-journal",
        "pattern-store",
        "theory-memory",
      ].sort(),
    );
  });
});
