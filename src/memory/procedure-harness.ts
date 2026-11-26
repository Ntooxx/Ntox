/**
 * Phase 3 — HARNESS-SIDE evidence signer. This module is NOT part of the agent surface.
 *
 * Reviewer requirement 1 (signer isolation): the signing capability — the private key and
 * everything that can read it — lives here, on the harness side of the boundary. The
 * verifier (procedure-store.ts) holds only the PUBLIC key and cannot sign. Combined with
 * the policy verdict denying the agent tool surface access to PROCEDURES_DIR at any depth,
 * source-code knowledge alone can never produce evidence that promotes a procedure.
 *
 * Import discipline (test-enforced): only harness/eval code and tests may import this
 * module. No agent-runtime module may reference it or the signing identifiers below.
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  canonicalEvidenceContent,
  currentVersionOf,
  hashProcedureVersion,
  harnessKeypairPaths,
  SIGNATURE_PREFIX,
  type EvidenceContent,
  type ProcedureState,
  type ProcedureStore,
  type VerificationEvidence,
} from "./procedure-store.js";

/**
 * Idempotent keypair creation (private key mode 0600). Fails loud on partial or corrupt
 * key material — evidence verification fails closed in that case as well.
 */
export function ensureHarnessKeypair(keyDir?: string): { privateKeyPath: string; publicKeyPath: string } {
  const paths = harnessKeypairPaths(keyDir);
  if (existsSync(paths.privateKeyPath) && existsSync(paths.publicKeyPath)) return paths;
  mkdirSync(paths.keyDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    writeFileSync(paths.privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
      flag: "wx",
    });
    writeFileSync(paths.publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Concurrent creation: both must exist now, else fail loud.
    if (!existsSync(paths.privateKeyPath) || !existsSync(paths.publicKeyPath)) throw error;
  }
  return paths;
}

/**
 * Sign canonical evidence content with the harness Ed25519 private key. Callers must pass
 * evidence already bound to procedure id, version, and content hash (EvidenceContent);
 * the signature covers that binding, so a promoted procedure is pinned to the exact
 * version content that was verified.
 */
export function signEvidence(evidence: EvidenceContent, keyDir?: string): string {
  const paths = ensureHarnessKeypair(keyDir);
  const privateKey = createPrivateKey(readFileSync(paths.privateKeyPath, "utf-8"));
  const signature = sign(null, Buffer.from(canonicalEvidenceContent(evidence), "utf-8"), privateKey);
  return `${SIGNATURE_PREFIX}${signature.toString("base64")}`;
}

export interface VerifyAndPromoteInput {
  store: ProcedureStore;
  procedureId: string;
  taskId: string;
  envFingerprint: string;
  checkOutputs: VerificationEvidence["checkOutputs"];
  timestamps?: number[];
}

export interface VerifyAndPromoteResult {
  ok: boolean;
  state?: ProcedureState;
  reason?: string;
  signature?: string;
}

/**
 * Harness-side promotion of a candidate into a verified procedure.
 *
 * The caller MUST be harness/eval code that ran frozen checks and mechanical
 * reuse outside the agent's authority. This function is the productised form of
 * the Phase 3 promotion step: it binds evidence to the current version hash,
 * signs it with the harness key, and hands it to the verification-only store.
 * The agent runtime cannot reach it (import discipline is test-enforced).
 */
export function verifyAndPromoteProcedure(input: VerifyAndPromoteInput): VerifyAndPromoteResult {
  const procedure = input.store.get(input.procedureId);
  if (!procedure) return { ok: false, reason: "procedure not found" };
  if (input.checkOutputs.length === 0 || input.checkOutputs.some((check) => !check.passed)) {
    return { ok: false, reason: "harness checks did not all pass" };
  }
  const content: EvidenceContent = {
    procedureId: procedure.id,
    procedureVersion: procedure.currentVersion,
    procedureHash: hashProcedureVersion(currentVersionOf(procedure)),
    taskId: input.taskId,
    envFingerprint: input.envFingerprint,
    checkOutputs: input.checkOutputs,
    timestamps: input.timestamps ?? [Date.now()],
  };
  const signature = signEvidence(content, input.store.keyDir);
  const promotion = input.store.promoteWithEvidence(procedure.id, { ...content, harnessSignature: signature });
  return promotion.ok ? { ok: true, state: promotion.state, signature } : { ok: false, reason: promotion.reason };
}
