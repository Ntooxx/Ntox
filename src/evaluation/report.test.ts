import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLongitudinal } from "./runner.js";
import { generateEvaluationReport, generateNecessityMarkdown, saveEvaluationReport } from "./report.js";
import type { Curriculum } from "./curriculum.js";
import type { NecessityReport } from "./necessity.js";

const curriculum: Curriculum = {
  id: "report-curriculum",
  description: "report",
  tasks: [
    { id: "t0", family: "f", plantTurns: [], probe: "q", check: { type: "exact", expected: "ok" } },
    { id: "t1", family: "f", plantTurns: [], probe: "q", check: { type: "exact", expected: "ok" } },
  ],
};

describe("evaluation reporting", () => {
  it("renders and saves a longitudinal report", async () => {
    const report = await runLongitudinal({
      curriculum,
      arms: ["off", "full"],
      factory: (arm) => ({ send: async () => ({ response: arm === "full" ? "ok" : "no", tokens: 1 }) }),
    });

    const markdown = generateEvaluationReport(report);
    expect(markdown).toContain("# NTOX Meta-Cognition Evaluation");
    expect(markdown).toContain("| off |");
    expect(markdown).toContain("| full |");
    expect(markdown).toContain("Primary contrast");

    const dir = mkdtempSync(join(tmpdir(), "ntox-eval-report-"));
    const { jsonPath, mdPath } = saveEvaluationReport(report, dir);
    expect(JSON.parse(readFileSync(jsonPath, "utf-8")).arms).toHaveLength(2);
    expect(readFileSync(mdPath, "utf-8")).toContain("Paired comparisons");
  });

  it("renders a necessity report", () => {
    const report: NecessityReport = {
      passed: true,
      checks: [
        { id: "memory-gating", subsystem: "episodic-memory", claim: "c", passed: true, detail: "ok" },
        { id: "kernel-learning", subsystem: "cognitive-kernel", claim: "c", passed: false, detail: "bad" },
      ],
      summary: { total: 2, passed: 1, failed: 1, generatedAt: Date.now() },
    };
    const markdown = generateNecessityMarkdown(report);
    expect(markdown).toContain("1/2 passed");
    expect(markdown).toContain("episodic-memory");
    expect(markdown).toContain("| no |");
  });
});
