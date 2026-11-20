import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { proposeProcedureCandidate } from "./procedure-candidates.js";
import { ProcedureStore, type ProcedureStep } from "./procedure-store.js";

const dirs: string[] = [];

function freshStore(): ProcedureStore {
  const dir = mkdtempSync(join(tmpdir(), "ntox-candidates-"));
  dirs.push(dir);
  return new ProcedureStore({ path: join(dir, "procedures.json") });
}

function steps(count: number): ProcedureStep[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `step_${index + 1}`,
    description: `read file ${index + 1}`,
    tool: "read",
    args: { path: `/tmp/file-${index + 1}` },
  }));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("proposeProcedureCandidate", () => {
  it("refuses trivial single-step trajectories", () => {
    const result = proposeProcedureCandidate({
      store: freshStore(),
      taskId: "turn-1",
      userMessage: "fix the failing test",
      steps: steps(1),
      learnedScope: "/workspace",
    });
    expect(result.proposed).toBe(false);
    expect(result.reason).toContain("at least 2");
  });

  it("records a candidate that can never promote itself", () => {
    const store = freshStore();
    const result = proposeProcedureCandidate({
      store,
      taskId: "turn-1",
      userMessage: "verify the harbor ledger procedure",
      steps: steps(2),
      learnedScope: "/workspace",
    });
    expect(result.proposed).toBe(true);
    const procedure = store.get(result.procedureId!);
    expect(procedure?.state).toBe("candidate");
    expect(procedure?.versions[0]?.steps).toHaveLength(2);
    expect(procedure?.evidence).toEqual([]);
  });

  it("rejects duplicate names", () => {
    const store = freshStore();
    const input = {
      store,
      taskId: "turn-1",
      userMessage: "verify the harbor ledger procedure",
      steps: steps(2),
      learnedScope: "/workspace",
    };
    expect(proposeProcedureCandidate(input).proposed).toBe(true);
    const second = proposeProcedureCandidate({ ...input, taskId: "turn-2" });
    expect(second.proposed).toBe(false);
    expect(second.reason).toContain("already exists");
  });
});
