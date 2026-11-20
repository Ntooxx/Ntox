import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentRun } from "./subagent.js";
import {
  assessDecomposition,
  buildSubagentTask,
  getQueueSnapshot,
  parseStructuredOutput,
  parseVerdict,
  subagentTool,
  getSubagentRuns,
} from "./subagent.js";

let dir = "";
const baseDir = process.env.NTOX_DIR!;

function seed(runs: SubagentRun[]): void {
  writeFileSync(join(dir, "subagent-runs.json"), JSON.stringify(runs, null, 2));
}

function run(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "run_1",
    task: "inspect the repo",
    tools: [],
    status: "succeeded",
    sessionId: "subagent-test",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    resultSummary: "done",
    result: "full result",
    fitness: 0.7,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ntox-subagent-"));
  process.env.NTOX_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.NTOX_DIR = baseDir;
});

describe("subagent tool", () => {
  it("lists persisted runs newest first", async () => {
    seed([run({ id: "run_old", startedAt: 1 }), run({ id: "run_new", startedAt: 2 })]);
    const result = await subagentTool.execute({ action: "list" });

    expect(result.success).toBe(true);
    const data = result.data as { runs: SubagentRun[] };
    expect(data.runs.map((item) => item.id)).toEqual(["run_new", "run_old"]);
  });

  it("returns a run by id including its result", async () => {
    seed([run()]);
    const result = await subagentTool.execute({ action: "status", runId: "run_1" });

    expect(result.success).toBe(true);
    const data = result.data as { run: SubagentRun; active: boolean };
    expect(data.run.result).toBe("full result");
    expect(data.active).toBe(false);
  });

  it("lists runs when status has no id", async () => {
    seed([run()]);
    const result = await subagentTool.execute({ action: "status" });
    expect(result.success).toBe(true);
    expect((result.data as { runs: SubagentRun[] }).runs).toHaveLength(1);
  });

  it("reports unknown runs", async () => {
    const result = await subagentTool.execute({ action: "status", runId: "missing" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("refuses to cancel a finished run", async () => {
    seed([run()]);
    const result = await subagentTool.execute({ action: "cancel", runId: "run_1" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not active");
  });

  it("requires a task for run and spawn", async () => {
    expect((await subagentTool.execute({ action: "run" })).success).toBe(false);
    expect((await subagentTool.execute({ action: "spawn" })).success).toBe(false);
  });

  it("rejects unknown actions", async () => {
    const result = await subagentTool.execute({ action: "nope" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action");
  });

  it("returns persisted runs through getSubagentRuns", () => {
    seed([run()]);
    expect(getSubagentRuns(5)).toHaveLength(1);
  });
});

describe("subagent handoff", () => {
  it("rejects a monolithic task in the decomposition gate", () => {
    const assessment = assessDecomposition("Write the single HTML file prova.html", []);
    expect(assessment.recommendation).toBe("direct");
    expect(assessment.reasons.join(" ")).toContain("single context");
    expect(assessment.suggestedRoles).toEqual([]);
  });

  it("accepts explicit independent workstreams and suggests a verifier", () => {
    const assessment = assessDecomposition("1. Review the dispatcher\n2. Review the registry\n3. Report separately", [
      "read",
      "grep",
    ]);
    expect(assessment.recommendation).toBe("parallel");
    expect(assessment.suggestedRoles).toContain("verifier");
    expect(assessment.checklist.join(" ")).toContain("ownership");
  });

  it("prepends authoritative parent context to the task", () => {
    expect(buildSubagentTask("Check the result", "Only modules A and B changed")).toBe(
      "Context from parent (authoritative, do not re-derive):\nOnly modules A and B changed\n\nTask:\nCheck the result",
    );
    expect(buildSubagentTask("Check the result", "  ")).toBe("Check the result");
  });

  it("parses a verifier verdict and its findings", () => {
    const verdict = parseVerdict(
      "Looks mostly fine.\nVERDICT: FAIL\nFINDINGS:\n- missing null check\n- no test for empty input",
    );
    expect(verdict).toEqual({ outcome: "fail", findings: ["missing null check", "no test for empty input"] });
    expect(parseVerdict("no verdict here")).toBeUndefined();
  });

  it("parses structured JSON with or without code fences", () => {
    expect(parseStructuredOutput('```json\n{"ok": true}\n```')).toEqual({ ok: true });
    expect(parseStructuredOutput('{"ok": false}')).toEqual({ ok: false });
    expect(parseStructuredOutput("not json")).toBeUndefined();
  });

  it("exposes a plan action that does not spawn", async () => {
    const result = await subagentTool.execute({
      action: "plan",
      task: "1. Inspect the repo\n2. Inspect the tests\n3. Report separately",
      tools: "read,grep",
    });
    expect(result.success).toBe(true);
    const data = result.data as { recommendation: string; suggestedRoles: string[] };
    expect(data.recommendation).toBe("parallel");
    expect(data.suggestedRoles).toContain("verifier");
    expect(getQueueSnapshot()).toEqual({ active: 0, capacity: 3, queued: 0 });
  });
});
