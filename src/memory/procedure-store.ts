import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { NTOX_DIR, PROCEDURES_DIR } from "../core/config.js";
import { cosineSimilarity } from "../utils/math.js";

/**
 * Phase 3 — Verified Procedural Memory: local, versioned procedure store.
 *
 * Experimental and strictly additive: this module never touches episodic memory and is
 * reachable only when config `proceduralMemoryEnabled` is true (default false).
 *
 * Architectural rules (scripts/experiments/phase3-design.md §5, non-negotiable):
 * 1. Procedures carry ZERO permission fields — the schema rejects authority-like attributes.
 * 2. Execution authority is never derived from procedure state; reuse flows through the
 *    caller-supplied executor, which must be NTOX's existing policy-enforced tool surface.
 * 3. Verification state influences retrieval ranking and display only — never decisions.
 * 4. Evidence is harness-structured and HMAC-signed with a key that lives outside the
 *    agent's authority boundary (policy-denied at any depth — reviewer requirement 1);
 *    an agent saying "done" is not evidence and cannot promote a candidate.
 */

export type ProcedureState = "candidate" | "verified" | "restricted" | "rejected" | "retired";

/** State that can be retrieved for reuse. Restricted/rejected/retired are never surfaced. */
const RETRIEVABLE_STATES: ReadonlySet<ProcedureState> = new Set<ProcedureState>(["candidate", "verified"]);

/**
 * Keys that would turn a procedure into an authority claim. Rejected at write time so a
 * procedure can never smuggle permissions into the system (rule §5.1).
 */
const AUTHORITY_KEYS = ["permission", "permissions", "grants", "authority", "autoapprove", "auto_approve", "allow"];

/**
 * A value that must be DISCOVERED in the environment where reuse runs (reviewer
 * requirement 2: valid reuse vs replay). Steps reference parameters as `{{name}}`;
 * `learnedValue` is the constant observed in the learning environment (E1) — kept as
 * provenance for replay detection and never rendered for reuse. Binding a parameter back
 * to its learned value in a different environment is refused before any step executes.
 */
export interface ProcedureParameter {
  /** Referenced from step args as `{{name}}`. */
  name: string;
  /** What to discover in the CURRENT environment (phrased for E2, not for E1). */
  description: string;
  /** Env-specific constant recorded where the procedure was learned (E1 provenance). */
  learnedValue: string;
}

const PARAM_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export type ProcedurePrerequisite =
  | {
      id: string;
      description: string;
      kind: "command";
      command: string;
      args?: string[];
      expectExit?: number;
    }
  | { id: string; description: string; kind: "path-exists"; path: string }
  | { id: string; description: string; kind: "file-contains"; path: string; text: string };

export interface ProcedureStep {
  id: string;
  /** What the step accomplishes, phrased for adaptation in a fresh environment (E2). */
  description: string;
  /** Optional mechanical binding: executed ONLY through the reuse executor (policy applies). */
  tool?: string;
  args?: Record<string, unknown>;
}

export interface ProcedureScope {
  /** Conditions under which this procedure applies. */
  applies: string[];
  /** Conditions under which reuse must NOT be attempted. */
  doesNotApply: string[];
}

export interface ProcedureVersion {
  version: number;
  steps: ProcedureStep[];
  prerequisites: ProcedurePrerequisite[];
  scope: ProcedureScope;
  /** Declared environment-specific parameters (learnedValue provenance per parameter). */
  parameters: ProcedureParameter[];
  /** Scope string of the environment where learnedValue constants were discovered (E1). */
  learnedScope: string;
  changedAt: number;
  reason: string;
}

/** Harness-generated evidence (design §4). Never produced from agent prose. */
export interface VerificationEvidence {
  taskId: string;
  envFingerprint: string;
  checkOutputs: { target: string; type: string; passed: boolean; detail: string }[];
  timestamps: number[];
  /** signEvidence() over the canonical content; verified on every promotion. */
  harnessSignature: string;
}

export type ReuseOutcome = "succeeded" | "failed" | "prerequisite-failed" | "denied" | "refused";

export interface ReuseRecord {
  at: number;
  taskId: string;
  outcome: ReuseOutcome;
  detail: string;
}

export interface StoredProcedure {
  id: string;
  name: string;
  description: string;
  state: ProcedureState;
  currentVersion: number;
  versions: ProcedureVersion[];
  evidence: VerificationEvidence[];
  rejections: { at: number; reason: string }[];
  reuseHistory: ReuseRecord[];
  embedding?: number[];
  embeddingModel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AddProcedureInput {
  name: string;
  description: string;
  steps: ProcedureStep[];
  prerequisites: ProcedurePrerequisite[];
  scope: ProcedureScope;
  parameters?: ProcedureParameter[];
  learnedScope?: string;
  embedding?: number[];
  embeddingModel?: string;
}

/** Default harness key location: beside the store, inside the policy-denied procedures dir. */
export function harnessKeyPath(): string {
  return join(PROCEDURES_DIR, ".harness.key");
}

/**
 * Load the HMAC key that backs evidence signatures, creating it on first use (mode 0600).
 * The key lives under PROCEDURES_DIR — the policy verdict denies the agent's entire tool
 * surface access to it (read/write/cwd/image, no grant opens it), so only harness-side code
 * can sign. A corrupt key fails closed: no signing, no verification, loud error.
 */
function loadHarnessKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf-8").trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    throw new Error(
      `harness key at ${keyPath} is corrupt — refusing to sign or verify evidence (fix or delete the key file manually)`,
    );
  }
  const key = randomBytes(32);
  mkdirSync(dirname(keyPath), { recursive: true });
  try {
    writeFileSync(keyPath, `${key.toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raw = readFileSync(keyPath, "utf-8").trim();
      if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
      throw new Error(`harness key at ${keyPath} is corrupt — refusing to sign or verify evidence`, { cause: error });
    }
    throw error;
  }
}

/**
 * Harness HMAC over the canonical evidence content. Signing requires the key file outside
 * the agent's authority boundary — the agent surface exposes no way to call this, and even
 * fully public source code is not enough to forge a signature without the key (reviewer
 * requirement 1: signature must be genuinely independent of the agent).
 */
export function signEvidence(
  evidence: Omit<VerificationEvidence, "harnessSignature">,
  keyPath: string = harnessKeyPath(),
): string {
  const canonical = JSON.stringify({
    taskId: evidence.taskId,
    envFingerprint: evidence.envFingerprint,
    checkOutputs: evidence.checkOutputs.map((c) => ({
      target: c.target,
      type: c.type,
      passed: c.passed,
      detail: c.detail,
    })),
    timestamps: evidence.timestamps,
  });
  const key = loadHarnessKey(keyPath);
  return `ntox-harness-v1:hmac-sha256:${createHmac("sha256", key).update(canonical).digest("hex")}`;
}

/** Returns null when evidence is structurally valid and fully HMAC-verifying, else the reason. */
export function validateEvidence(evidence: VerificationEvidence, keyPath: string = harnessKeyPath()): string | null {
  if (!evidence.taskId || typeof evidence.taskId !== "string") return "evidence.taskId missing";
  if (!evidence.envFingerprint || typeof evidence.envFingerprint !== "string") {
    return "evidence.envFingerprint missing";
  }
  if (!Array.isArray(evidence.checkOutputs) || evidence.checkOutputs.length === 0) {
    return "evidence.checkOutputs must be a non-empty array (harness checks)";
  }
  for (const check of evidence.checkOutputs) {
    if (typeof check?.passed !== "boolean") return "evidence.checkOutputs entries must carry a boolean passed";
    if (!check.passed) return `check failed: ${check.target} — ${check.detail}`;
  }
  if (!Array.isArray(evidence.timestamps) || evidence.timestamps.length === 0) {
    return "evidence.timestamps missing";
  }
  const { harnessSignature, ...content } = evidence;
  if (!harnessSignature) return "harnessSignature missing";
  if (!harnessSignature.startsWith("ntox-harness-v1:hmac-sha256:")) {
    // Covers unkeyed hash forgeries: source code alone must never be enough to sign.
    return "harnessSignature missing or not a harness HMAC (unsigned/forged evidence)";
  }
  let expected: string;
  try {
    expected = signEvidence(content, keyPath);
  } catch (error) {
    return `harness key unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const a = Buffer.from(harnessSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return "harnessSignature does not match evidence content (wrong key or tampered evidence)";
  }
  return null;
}

/**
 * Rule §5.1 — reject authority-like attributes anywhere in the procedure object except
 * inside step `args` (tool arguments are decided at execution time by policy, never stored).
 */
function assertNoAuthorityFields(value: unknown, path: string = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoAuthorityFields(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (path.endsWith(".args")) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_KEYS.includes(key.toLowerCase())) {
      throw new Error(`procedures carry zero permission fields: "${key}" at ${path} is rejected (phase3 rule §5.1)`);
    }
    assertNoAuthorityFields(child, `${path}.${key}`);
  }
}

/** Declared parameters must be well-formed: unique, template-safe names, real provenance. */
function assertValidParameters(parameters: ProcedureParameter[]): void {
  const seen = new Set<string>();
  for (const p of parameters) {
    if (!PARAM_NAME_RE.test(p.name) || p.name.includes("{{")) {
      throw new Error(`invalid parameter name "${p.name}" (expected ${PARAM_NAME_RE})`);
    }
    if (seen.has(p.name)) throw new Error(`duplicate parameter "${p.name}"`);
    seen.add(p.name);
    if (typeof p.description !== "string" || p.description.trim() === "") {
      throw new Error(`parameter "${p.name}" needs a description (what to discover in the current environment)`);
    }
    if (typeof p.learnedValue !== "string" || p.learnedValue === "") {
      throw new Error(`parameter "${p.name}" needs its learnedValue (E1 provenance for replay detection)`);
    }
  }
}

export function currentVersionOf(procedure: StoredProcedure): ProcedureVersion {
  const version = procedure.versions.find((v) => v.version === procedure.currentVersion);
  if (!version) throw new Error(`procedure ${procedure.id} has no version ${procedure.currentVersion}`);
  return version;
}

export function isProceduralMemoryEnabled(config: { proceduralMemoryEnabled?: boolean }): boolean {
  return config.proceduralMemoryEnabled === true;
}

export interface ProcedureStoreOptions {
  path?: string;
  /** HMAC key for evidence signing (defaults beside the store, inside PROCEDURES_DIR). */
  keyPath?: string;
}

export class ProcedureStore {
  private procedures: StoredProcedure[] = [];
  private loaded = false;
  private readonly path: string;
  private readonly keyPathField: string;

  constructor(options: ProcedureStoreOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "procedures", "procedures.json");
    this.keyPathField = options.keyPath ?? join(dirname(this.path), ".harness.key");
  }

  /** Where this store signs/verifies evidence — harness-side key, outside agent authority. */
  get keyPath(): string {
    return this.keyPathField;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) {
      this.procedures = [];
      return;
    }
    try {
      const raw = readFileSync(this.path, "utf-8");
      const parsed = JSON.parse(raw) as StoredProcedure[];
      this.procedures = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.procedures = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.procedures, null, 2));
    renameSync(tmp, this.path);
  }

  addProcedure(input: AddProcedureInput): StoredProcedure {
    this.load();
    // Fail loud on any authority-like attribute (rule §5.1).
    assertNoAuthorityFields(input);
    const parameters = input.parameters ?? [];
    assertValidParameters(parameters);
    const now = Date.now();
    const procedure: StoredProcedure = {
      id: `proc_${randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description,
      state: "candidate",
      currentVersion: 1,
      versions: [
        {
          version: 1,
          steps: input.steps,
          prerequisites: input.prerequisites,
          scope: input.scope,
          parameters,
          learnedScope: input.learnedScope ?? "",
          changedAt: now,
          reason: "extracted from experience (candidate)",
        },
      ],
      evidence: [],
      rejections: [],
      reuseHistory: [],
      ...(input.embedding ? { embedding: input.embedding } : {}),
      ...(input.embeddingModel ? { embeddingModel: input.embeddingModel } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.procedures.push(procedure);
    this.save();
    return procedure;
  }

  get(id: string): StoredProcedure | null {
    this.load();
    return this.procedures.find((p) => p.id === id) ?? null;
  }

  list(): StoredProcedure[] {
    this.load();
    return this.procedures.map((p) => ({ ...p }));
  }

  /** Revise a procedure: new version. Also the recovery path from `restricted` (rule §5). */
  updateProcedure(
    id: string,
    changes: {
      steps?: ProcedureStep[];
      prerequisites?: ProcedurePrerequisite[];
      scope?: ProcedureScope;
      parameters?: ProcedureParameter[];
      learnedScope?: string;
    },
    reason: string,
  ): StoredProcedure | null {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return null;
    assertNoAuthorityFields(changes);
    if (changes.parameters) assertValidParameters(changes.parameters);
    const current = currentVersionOf(procedure);
    const next: ProcedureVersion = {
      version: procedure.currentVersion + 1,
      steps: changes.steps ?? current.steps,
      prerequisites: changes.prerequisites ?? current.prerequisites,
      scope: changes.scope ?? current.scope,
      parameters: changes.parameters ?? current.parameters ?? [],
      learnedScope: changes.learnedScope ?? current.learnedScope ?? "",
      changedAt: Date.now(),
      reason,
    };
    procedure.versions.push(next);
    procedure.currentVersion = next.version;
    if (procedure.state === "restricted") procedure.state = "candidate";
    procedure.updatedAt = next.changedAt;
    this.save();
    return procedure;
  }

  /**
   * Promotion gate (rule §5.4): only structurally valid, fully passing, signature-matching
   * harness evidence can promote candidate → verified. Agent claims fail validateEvidence.
   */
  promoteWithEvidence(
    id: string,
    evidence: VerificationEvidence,
  ): { ok: boolean; state?: ProcedureState; reason: string } {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return { ok: false, reason: "procedure not found" };
    if (procedure.state !== "candidate" && procedure.state !== "verified") {
      return { ok: false, reason: `state "${procedure.state}" cannot be promoted; revise it first` };
    }
    const invalid = validateEvidence(evidence, this.keyPathField);
    if (invalid) return { ok: false, reason: `evidence rejected: ${invalid}` };
    procedure.evidence.push(evidence);
    procedure.state = "verified";
    procedure.updatedAt = Date.now();
    this.save();
    return { ok: true, state: "verified", reason: "harness evidence accepted" };
  }

  markRestricted(id: string, reason: string): StoredProcedure | null {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return null;
    procedure.state = "restricted";
    procedure.rejections.push({ at: Date.now(), reason });
    procedure.updatedAt = Date.now();
    this.save();
    return procedure;
  }

  markRejected(id: string, reason: string): StoredProcedure | null {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return null;
    procedure.state = "rejected";
    procedure.rejections.push({ at: Date.now(), reason });
    procedure.updatedAt = Date.now();
    this.save();
    return procedure;
  }

  retire(id: string, reason: string): StoredProcedure | null {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return null;
    procedure.state = "retired";
    procedure.rejections.push({ at: Date.now(), reason });
    procedure.updatedAt = Date.now();
    this.save();
    return procedure;
  }

  recordReuse(id: string, record: Omit<ReuseRecord, "at">): StoredProcedure | null {
    this.load();
    const procedure = this.procedures.find((p) => p.id === id);
    if (!procedure) return null;
    procedure.reuseHistory.push({ at: Date.now(), ...record });
    procedure.updatedAt = Date.now();
    this.save();
    return procedure;
  }

  /**
   * Retrieval over procedure text — pure cosine when embeddings match (3-small + cosine
   * frozen backend), token-overlap fallback otherwise. Verification state only boosts
   * RANKING (verified +0.15); it never affects whether execution is permitted (rule §5.3).
   */
  retrieve(
    query: { text: string; embedding?: number[]; embeddingModel?: string },
    limit: number = 5,
  ): { procedure: StoredProcedure; score: number }[] {
    this.load();
    const queryTokens = new Set(
      query.text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3),
    );
    const scored = this.procedures
      .filter((p) => RETRIEVABLE_STATES.has(p.state))
      .map((p) => {
        let score = 0;
        const version = currentVersionOf(p);
        const docText = `${p.name} ${p.description} ${version.steps.map((s) => s.description).join(" ")}`;
        if (query.embedding && query.embedding.length > 0 && p.embedding && p.embedding.length > 0) {
          const modelMatches = !query.embeddingModel || !p.embeddingModel || p.embeddingModel === query.embeddingModel;
          if (modelMatches && p.embedding.length === query.embedding.length) {
            score = cosineSimilarity(query.embedding, p.embedding);
          }
        }
        if (score === 0) {
          const docTokens = new Set(
            docText
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((t) => t.length >= 3),
          );
          const overlap = [...queryTokens].filter((t) => docTokens.has(t)).length;
          score = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
        }
        const successes = p.reuseHistory.filter((r) => r.outcome === "succeeded").length;
        const stateBoost = p.state === "verified" ? 0.15 : 0;
        const reuseBoost = Math.min(successes, 3) * 0.02;
        return { procedure: p, score: score + stateBoost + reuseBoost };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map((r) => ({ procedure: { ...r.procedure }, score: r.score }));
  }

  stats(): { total: number; byState: Record<ProcedureState, number> } {
    this.load();
    const byState: Record<ProcedureState, number> = {
      candidate: 0,
      verified: 0,
      restricted: 0,
      rejected: 0,
      retired: 0,
    };
    for (const p of this.procedures) byState[p.state] += 1;
    return { total: this.procedures.length, byState };
  }
}
