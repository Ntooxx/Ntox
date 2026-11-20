import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../../dist/memory/episodic.js";
import { MistakeJournal } from "../../../dist/meta/mistakes.js";
import { ProcedureStore } from "../../../dist/memory/procedure-store.js";
import { NtoxHarnessAuthority } from "./authority.js";
import { NtoxHarnessBridge } from "./bridge.js";
import { mechanicalReuseCheck } from "./checks.js";

function tempPath(name: string): string {
  return join(process.env.NTOX_DIR!, `${name}.json`);
}

describe("NtoxHarnessBridge", () => {
  it("closes the loop: turn candidate -> harness verification -> next preStep", async () => {
    const store = new ProcedureStore({ path: tempPath("bridge-loop") });
    const memory = new MemoryStore();
    const mistakes = new MistakeJournal();
    memory.clearAll();
    mistakes.clearAll();

    const bridge = new NtoxHarnessBridge(
      { enableProceduralMemory: true, workspaceRoot: "/workspace" },
      { memory, mistakes, procedureStore: store },
    );

    const first = await bridge.preStep({ sessionId: "s1", userMessage: "verify the harbor ledger procedure" });
    expect(first.diagnostics.proceduresIncluded).toBe(false);

    const outcome = await bridge.onTurnEnd({
      sessionId: "s1",
      turnId: "t1",
      userMessage: "verify the harbor ledger procedure",
      assistantResponse: "done",
      toolCalls: [
        { name: "read", success: true, args: { path: "/tmp/ledger" } },
        { name: "grep", success: true, args: { pattern: "total" } },
      ],
    });
    expect(outcome.candidate?.proposed).toBe(true);
    const procedureId = outcome.candidate!.procedureId!;
    expect(store.get(procedureId)?.state).toBe("candidate");

    const authority = new NtoxHarnessAuthority({ store });
    const verification = authority.verifyAndPromote({
      procedureId,
      taskId: "t1",
      envFingerprint: "env-1",
      checks: [mechanicalReuseCheck("outcome=succeeded")],
    });
    expect(verification.ok).toBe(true);

    const next = await bridge.preStep({ sessionId: "s2", userMessage: "verify the harbor ledger procedure" });
    expect(next.diagnostics.proceduresIncluded).toBe(true);
    expect(next.prompt).toContain("UNTRUSTED TASK DATA");
  });

  it("does not propose candidates for corrected or false-success turns", async () => {
    const store = new ProcedureStore({ path: tempPath("bridge-gated") });
    const bridge = new NtoxHarnessBridge(
      { enableProceduralMemory: true },
      { procedureStore: store, memory: new MemoryStore(), mistakes: new MistakeJournal() },
    );
    const outcome = await bridge.onTurnEnd({
      sessionId: "s1",
      turnId: "t1",
      userMessage: "fix the harbor ledger procedure",
      assistantResponse: "done",
      wasCorrection: true,
      toolCalls: [{ name: "read", success: true }, { name: "write", success: true }],
    });
    expect(outcome.candidate?.proposed).toBeFalsy();
    expect(store.stats().total).toBe(0);
  });
});
