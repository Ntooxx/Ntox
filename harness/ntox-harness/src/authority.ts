import { verifyAndPromoteProcedure } from "../../../dist/memory/procedure-harness.js";
import { ProcedureStore } from "../../../dist/memory/procedure-store.js";
import { allChecksPassed } from "./checks.js";
import type { VerificationRequest, VerificationResult } from "./types.js";

/**
 * Harness-owned authority. The private key and the promotion gate live in the
 * harness process, never in the agent process.
 */
export class NtoxHarnessAuthority {
  readonly store: ProcedureStore;

  constructor(options: { path?: string; keyDir?: string; store?: ProcedureStore } = {}) {
    this.store = options.store ?? new ProcedureStore({ path: options.path, keyDir: options.keyDir });
  }

  verifyAndPromote(request: VerificationRequest): VerificationResult {
    if (!allChecksPassed(request.checks)) {
      return { ok: false, reason: "harness checks did not all pass" };
    }
    return verifyAndPromoteProcedure({
      store: this.store,
      procedureId: request.procedureId,
      taskId: request.taskId,
      envFingerprint: request.envFingerprint,
      checkOutputs: request.checks,
    });
  }

  stats() {
    return this.store.stats();
  }
}
