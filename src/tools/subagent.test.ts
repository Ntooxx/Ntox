import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentRun } from "./subagent.js";
import { getSubagentRuns, subagentTool } from "./subagent.js";

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
