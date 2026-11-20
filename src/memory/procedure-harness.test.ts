import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAndPromoteProcedure } from "./procedure-harness.js";
import { ProcedureStore } from "./procedure-store.js";

const dirs: string[] = [];

function freshStore(): ProcedureStore {
  const dir = mkdtempSync(join(tmpdir(), "ntox-verify-harness-"));
  dirs.push(dir);
  return new ProcedureStore({ path: join(dir, "procedures.json") });
}

function candidate(store: ProcedureStore) {
  return store.addProcedure({
    name: "verify-harbor-ledger",
    description: "verify the harbor ledger after a release",
    steps: [{ id: "step_1", description: "read the ledger", tool: "read", args: { path: "/tmp/ledger" } }],
    prerequisites: [],
    scope: { applies: [], doesNotApply: [] },
    parameters: [],
    learnedScope: "/workspace",
  });
}

const passingChecks = [{ target: "ledger", type: "command", passed: true, detail: "check exited 0" }];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("verifyAndPromoteProcedure", () => {
  it("promotes a candidate only with passing harness checks and a valid signature", () => {
    const store = freshStore();
    const procedure = candidate(store);
    const result = verifyAndPromoteProcedure({
      store,
      procedureId: procedure.id,
      taskId: "task-1",
      envFingerprint: "env-1",
      checkOutputs: passingChecks,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("verified");
    expect(result.signature).toContain("ntox-harness-v1:ed25519:");
    expect(store.get(procedure.id)?.evidence).toHaveLength(1);
  });

  it("leaves the candidate untouched when a harness check fails", () => {
    const store = freshStore();
    const procedure = candidate(store);
    const result = verifyAndPromoteProcedure({
      store,
      procedureId: procedure.id,
      taskId: "task-1",
      envFingerprint: "env-1",
      checkOutputs: [{ ...passingChecks[0]!, passed: false }],
    });
    expect(result.ok).toBe(false);
    expect(store.get(procedure.id)?.state).toBe("candidate");
  });

  it("fails closed for an unknown procedure", () => {
    const result = verifyAndPromoteProcedure({
      store: freshStore(),
      procedureId: "missing",
      taskId: "task-1",
      envFingerprint: "env-1",
      checkOutputs: passingChecks,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not found");
  });
});
