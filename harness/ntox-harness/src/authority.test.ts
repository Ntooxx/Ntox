import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProcedureStore } from "../../../dist/memory/procedure-store.js";
import { NtoxHarnessAuthority } from "./authority.js";
import { mechanicalReuseCheck } from "./checks.js";

function tempPath(name: string): string {
  return join(process.env.NTOX_DIR!, `${name}.json`);
}

function candidate(store: ProcedureStore) {
  return store.addProcedure({
    name: "verify-harbor-ledger",
    description: "verify the harbor ledger after release",
    steps: [{ id: "step_1", description: "read the ledger", tool: "read", args: { path: "/tmp/ledger" } }],
    prerequisites: [],
    scope: { applies: [], doesNotApply: [] },
    parameters: [],
    learnedScope: "/workspace",
  });
}

describe("NtoxHarnessAuthority", () => {
  it("promotes a candidate with harness checks and records a signature", () => {
    const authority = new NtoxHarnessAuthority({ path: tempPath("authority-pass") });
    const procedure = candidate(authority.store);
    const result = authority.verifyAndPromote({
      procedureId: procedure.id,
      taskId: "task-1",
      envFingerprint: "env-1",
      checks: [mechanicalReuseCheck("outcome=succeeded")],
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("verified");
    expect(result.signature).toContain("ntox-harness-v1:ed25519:");
    expect(authority.store.get(procedure.id)?.evidence).toHaveLength(1);
  });

  it("refuses promotion when a harness check fails", () => {
    const authority = new NtoxHarnessAuthority({ path: tempPath("authority-fail") });
    const procedure = candidate(authority.store);
    const result = authority.verifyAndPromote({
      procedureId: procedure.id,
      taskId: "task-1",
      envFingerprint: "env-1",
      checks: [{ target: "a", type: "command", passed: false, detail: "failed" }],
    });
    expect(result.ok).toBe(false);
    expect(authority.store.get(procedure.id)?.state).toBe("candidate");
  });
});
