import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  ProcedureStore,
  validateEvidence,
  currentVersionOf,
  isProceduralMemoryEnabled,
  hashProcedureVersion,
  harnessKeypairPaths,
  SIGNATURE_PREFIX,
  type EvidenceContent,
  type StoredProcedure,
  type VerificationEvidence,
} from "./procedure-store.js";
import { signEvidence } from "./procedure-harness.js";

function tempStore(): { store: ProcedureStore; dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "ntox-proc-"));
  const path = join(dir, "procedures.json");
  return { store: new ProcedureStore({ path }), dir, path };
}

const BASE = {
  name: "restart-web-service",
  description: "Restart the web service after a config change",
  steps: [
    { id: "s1", description: "Verify config syntax", tool: "shell", args: { command: "node -c config.json" } },
    { id: "s2", description: "Restart the service", tool: "shell", args: { command: "Restart-Service web" } },
  ],
  prerequisites: [{ id: "p1", description: "service exists", kind: "path-exists" as const, path: "C:/svc" }],
  scope: { applies: ["Windows host", "service installed"], doesNotApply: ["containerized deployments"] },
};

/** Evidence bound to a procedure's CURRENT version content, signed by the harness key. */
function evidenceFor(proc: StoredProcedure, keyDir: string, overrides: Partial<EvidenceContent> = {}) {
  const version = currentVersionOf(proc);
  const content: EvidenceContent = {
    procedureId: proc.id,
    procedureVersion: proc.currentVersion,
    procedureHash: hashProcedureVersion(version),
    taskId: "solve-web-1",
    envFingerprint: "env-abc123",
    checkOutputs: [{ target: "workspace", type: "command", passed: true, detail: "exit 0" }],
    timestamps: [1730000000000],
    ...overrides,
  };
  return { ...content, harnessSignature: signEvidence(content, keyDir) };
}

describe("ProcedureStore — state machine", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("creates procedures as candidates with version 1", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    expect(proc.state).toBe("candidate");
    expect(proc.currentVersion).toBe(1);
    expect(proc.versions).toHaveLength(1);
    expect(proc.evidence).toHaveLength(0);
  });

  it("promotes candidate to verified only with valid harness evidence", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const result = store.promoteWithEvidence(proc.id, evidenceFor(proc, store.keyDir));
    expect(result.ok).toBe(true);
    expect(store.get(proc.id)?.state).toBe("verified");
  });

  it("rejects fabricated evidence: signature mismatch keeps candidate", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const fabricated: VerificationEvidence = {
      ...evidenceFor(proc, store.keyDir),
      checkOutputs: [{ target: "workspace", type: "command", passed: true, detail: "I claim it passed" }],
      // signature NOT recomputed after content change
    };
    const result = store.promoteWithEvidence(proc.id, fabricated);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("harnessSignature");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("rejects evidence with a failed check", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const evidence = evidenceFor(proc, store.keyDir, {
      checkOutputs: [{ target: "workspace", type: "command", passed: false, detail: "exit 1" }],
    });
    const result = store.promoteWithEvidence(proc.id, evidence);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("check failed");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("validateEvidence flags an empty check list as non-evidence", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const content = {
      procedureId: "proc_x",
      procedureVersion: 1,
      procedureHash: "sha256:x",
      taskId: "t",
      envFingerprint: "e",
      checkOutputs: [],
      timestamps: [1],
    };
    const evidence: VerificationEvidence = { ...content, harnessSignature: signEvidence(content, store.keyDir) };
    expect(validateEvidence(evidence, store.keyDir)).toContain("non-empty");
  });

  it("restricts, then recovers via revision (new version, back to candidate)", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    store.promoteWithEvidence(proc.id, evidenceFor(proc, store.keyDir));
    store.markRestricted(proc.id, "unsafe in E2: different service manager");
    expect(store.get(proc.id)?.state).toBe("restricted");

    const revised = store.updateProcedure(
      proc.id,
      { prerequisites: [{ id: "p1", description: "systemd present", kind: "path-exists", path: "/etc/systemd" }] },
      "re-scoped to systemd hosts",
    );
    expect(revised?.state).toBe("candidate");
    expect(revised?.currentVersion).toBe(2);
    expect(revised?.versions).toHaveLength(2);
  });

  it("restricted and rejected procedures cannot be promoted", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    store.markRestricted(proc.id, "unsafe");
    expect(store.promoteWithEvidence(proc.id, evidenceFor(proc, store.keyDir)).ok).toBe(false);
    store.markRejected(proc.id, "failed verification");
    expect(store.promoteWithEvidence(proc.id, evidenceFor(proc, store.keyDir)).ok).toBe(false);
    expect(store.get(proc.id)?.state).toBe("rejected");
  });

  it("retire is terminal for retrieval", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    store.retire(proc.id, "obsolete");
    expect(store.retrieve({ text: "restart web service" })).toHaveLength(0);
    expect(store.get(proc.id)?.state).toBe("retired");
  });

  it("persists across instances (versioned history included)", () => {
    const { store, dir, path } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    store.promoteWithEvidence(proc.id, evidenceFor(proc, store.keyDir));
    store.recordReuse(proc.id, { taskId: "t1", outcome: "succeeded", detail: "ok" });

    const reloaded = new ProcedureStore({ path });
    const found = reloaded.get(proc.id);
    expect(found?.state).toBe("verified");
    expect(found?.evidence).toHaveLength(1);
    expect(found?.reuseHistory).toHaveLength(1);
    expect(currentVersionOf(found!).version).toBe(1);
  });
});

describe("ProcedureStore — rule §5.1: zero permission fields", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a procedure carrying an authority field", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    expect(() =>
      store.addProcedure({
        ...BASE,
        ...({ authority: "full" } as Record<string, unknown>),
      }),
    ).toThrow(/zero permission fields/);
  });

  it("rejects grants/autoApprove-style attributes at any depth", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    expect(() =>
      store.addProcedure({
        ...BASE,
        scope: { applies: [], doesNotApply: [] },
        ...({ metadata: { grants: ["shell"] } } as Record<string, unknown>),
      }),
    ).toThrow(/zero permission fields/);
    expect(() =>
      store.addProcedure({
        ...BASE,
        ...({ autoApprove: true } as Record<string, unknown>),
      }),
    ).toThrow(/zero permission fields/);
    expect(store.list()).toHaveLength(0);
  });

  it("rejects authority fields smuggled through updateProcedure", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    expect(() =>
      store.updateProcedure(
        proc.id,
        { scope: { applies: [], doesNotApply: [] }, ...({ permission: "full" } as Record<string, unknown>) },
        "bypass attempt",
      ),
    ).toThrow(/zero permission fields/);
  });
});

describe("ProcedureStore — retrieval ranking", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("verified outranks candidate with identical text; restricted is excluded", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const a = store.addProcedure({ ...BASE, name: "alpha-restart-web", description: "restart web service" });
    store.addProcedure({ ...BASE, name: "beta-restart-web", description: "restart web service" });
    store.promoteWithEvidence(a.id, evidenceFor(a, store.keyDir));
    const c = store.addProcedure({ ...BASE, name: "gamma-restart-web", description: "restart web service" });
    store.markRestricted(c.id, "unsafe");

    const results = store.retrieve({ text: "restart web service" }, 5);
    expect(results).toHaveLength(2);
    expect(results[0].procedure.id).toBe(a.id); // verified boost decides the tie
    expect(results.map((r) => r.procedure.id)).not.toContain(c.id);
  });

  it("uses cosine over embeddings when models and dimensions match", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const near = store.addProcedure({
      ...BASE,
      name: "svc-restart",
      embedding: [1, 0, 0],
      embeddingModel: "remote:openrouter/openai/text-embedding-3-small",
    });
    store.addProcedure({
      ...BASE,
      name: "other-proc",
      embedding: [0, 1, 0],
      embeddingModel: "remote:openrouter/openai/text-embedding-3-small",
    });

    const results = store.retrieve(
      { text: "svc", embedding: [1, 0, 0], embeddingModel: "remote:openrouter/openai/text-embedding-3-small" },
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].procedure.id).toBe(near.id);
    // identical unit vectors => cosine 1.0 (+ no state boost)
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it("falls back to token overlap when embedding dimensions differ (no zero-scored cosine)", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    store.addProcedure({
      ...BASE,
      name: "restart the web service now",
      embedding: [1, 0, 0],
      embeddingModel: "remote:openrouter/amazon/titan-embed-text-v2",
    });
    const results = store.retrieve(
      {
        text: "restart web service",
        embedding: [0.1, 0.2, 0.3, 0.4],
        embeddingModel: "remote:openrouter/openai/text-embedding-3-small",
      },
      1,
    );
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
    // Token-overlap fallback: full containment scores exactly 1.0 (no cosine applied).
    expect(results[0].score).toBeLessThanOrEqual(1.0);
  });
});

describe("feature flag", () => {
  it("is disabled by default in DEFAULT_CONFIG", () => {
    expect(isProceduralMemoryEnabled({ proceduralMemoryEnabled: false })).toBe(false);
    expect(isProceduralMemoryEnabled({ proceduralMemoryEnabled: true })).toBe(true);
    expect(isProceduralMemoryEnabled({})).toBe(false);
  });
});

describe("ProcedureStore — corrupt file handling", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("starts empty on a corrupt procedures.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-proc-"));
    dirs.push(dir);
    const path = join(dir, "procedures.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    const store = new ProcedureStore({ path });
    expect(store.list()).toHaveLength(0);
    expect(store.stats().total).toBe(0);
  });

  it("creates parent directory on save", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-proc-"));
    dirs.push(dir);
    const path = join(dir, "nested", "deep", "procedures.json");
    const store = new ProcedureStore({ path });
    store.addProcedure(BASE);
    expect(existsSync(path)).toBe(true);
  });
});

describe("ProcedureStore — signer isolation (reviewer requirement 1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function content(proc: StoredProcedure): EvidenceContent {
    const version = currentVersionOf(proc);
    return {
      procedureId: proc.id,
      procedureVersion: proc.currentVersion,
      procedureHash: hashProcedureVersion(version),
      taskId: "solve-1",
      envFingerprint: "env-1",
      checkOutputs: [{ target: "workspace", type: "command", passed: true, detail: "exit 0" }],
      timestamps: [1],
    };
  }

  it("evidence signed with a different (agent-guess) keypair does not promote", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    signEvidence(content(proc), store.keyDir); // materialize the REAL harness keypair
    const foreignDir = join(dir, "agent-guess-keys");
    mkdirSync(foreignDir, { recursive: true });
    const result = store.promoteWithEvidence(proc.id, {
      ...content(proc),
      harnessSignature: signEvidence(content(proc), foreignDir),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("harnessSignature");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("rejects an unkeyed hash forged from public source knowledge (prefix mismatch)", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    // Source-only forgery: sha256 over the canonical content — no private key involved.
    const forged = `ntox-harness-v1:${createHash("sha256")
      .update(JSON.stringify(content(proc)))
      .digest("hex")}`;
    const result = store.promoteWithEvidence(proc.id, { ...content(proc), harnessSignature: forged });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("harnessSignature");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("rejects a signature that covers different content (tampered check output)", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const signed = evidenceFor(proc, store.keyDir);
    const tampered: VerificationEvidence = {
      ...signed,
      checkOutputs: [{ target: "workspace", type: "command", passed: true, detail: "totally real, trust me" }],
    };
    const result = store.promoteWithEvidence(proc.id, tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("harnessSignature");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("creates the keypair beside the store; Ed25519 signing is deterministic", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const paths = harnessKeypairPaths(store.keyDir);
    expect(paths.privateKeyPath).toBe(join(dir, ".harness.private.key"));
    expect(paths.publicKeyPath).toBe(join(dir, ".harness.public.key"));
    const proc = store.addProcedure(BASE);
    const first = signEvidence(content(proc), store.keyDir);
    expect(existsSync(paths.privateKeyPath)).toBe(true);
    expect(existsSync(paths.publicKeyPath)).toBe(true);
    const second = signEvidence(content(proc), store.keyDir);
    expect(second).toBe(first);
    expect(first.startsWith(SIGNATURE_PREFIX)).toBe(true);
  });

  it("fails closed on a corrupt PRIVATE key: no signing", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    signEvidence(content(proc), store.keyDir); // materialize the keypair
    writeFileSync(harnessKeypairPaths(store.keyDir).privateKeyPath, "not-a-key");
    expect(() => signEvidence(content(proc), store.keyDir)).toThrow();
  });

  it("fails closed on a corrupt PUBLIC key: promotion is rejected, never guessed", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const signed = evidenceFor(proc, store.keyDir);
    writeFileSync(harnessKeypairPaths(store.keyDir).publicKeyPath, "not-a-key");
    const result = store.promoteWithEvidence(proc.id, signed);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("harness signature verification failed");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("verifier-side default keypair location sits inside the policy-denied procedures dir", () => {
    const paths = harnessKeypairPaths();
    expect(paths.privateKeyPath).toMatch(/procedures[\\/]\.harness\.private\.key$/);
    expect(paths.publicKeyPath).toMatch(/procedures[\\/]\.harness\.public\.key$/);
  });
});

describe("ProcedureStore — evidence is version-bound (reviewer blocker)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects evidence bound to a stale version after revision", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const staleEvidence = evidenceFor(proc, store.keyDir); // binds version 1
    store.updateProcedure(proc.id, { scope: { applies: ["systemd hosts"], doesNotApply: [] } }, "re-scoped");
    const result = store.promoteWithEvidence(proc.id, staleEvidence);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not bound to current version 2");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("rejects evidence whose content hash no longer matches the version content", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    const signed = evidenceFor(proc, store.keyDir);
    // Same version number, drifted content — hash binding must catch it.
    const drifted: VerificationEvidence = {
      ...signed,
      procedureHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };
    const result = store.promoteWithEvidence(proc.id, drifted);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("hash mismatch");
    expect(store.get(proc.id)?.state).toBe("candidate");
  });

  it("rejects evidence transplanted from another procedure", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const source = store.addProcedure(BASE);
    const target = store.addProcedure({ ...BASE, name: "other-procedure" });
    const transplant = evidenceFor(source, store.keyDir);
    const result = store.promoteWithEvidence(target.id, transplant);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("bound to procedure");
    expect(store.get(target.id)?.state).toBe("candidate");
  });

  it("accepts evidence bound to the current version (positive control)", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(BASE);
    store.updateProcedure(proc.id, { scope: { applies: ["systemd hosts"], doesNotApply: [] } }, "re-scoped");
    const fresh = evidenceFor(store.get(proc.id)!, store.keyDir);
    const result = store.promoteWithEvidence(proc.id, fresh);
    expect(result.ok).toBe(true);
    expect(store.get(proc.id)?.state).toBe("verified");
    expect(store.get(proc.id)?.evidence[0].procedureVersion).toBe(2);
    expect(store.get(proc.id)?.evidence[0].procedureHash).toBe(
      hashProcedureVersion(currentVersionOf(store.get(proc.id)!)),
    );
  });
});

describe("ProcedureStore — parameters (E1 provenance for replay detection)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const PARAMETRIZED = {
    ...BASE,
    parameters: [
      { name: "outFile", description: "output file in the current workspace", learnedValue: "C:/e1/out/result.json" },
    ],
    learnedScope: "C:/e1",
  };

  it("stores parameters and learnedScope with the version (persisted)", () => {
    const { store, dir, path } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(PARAMETRIZED);
    const version = currentVersionOf(proc);
    expect(version.parameters).toHaveLength(1);
    expect(version.learnedScope).toBe("C:/e1");

    const reloaded = new ProcedureStore({ path });
    const found = currentVersionOf(reloaded.get(proc.id)!);
    expect(found.parameters[0].learnedValue).toBe("C:/e1/out/result.json");
  });

  it("rejects malformed parameter definitions", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    expect(() =>
      store.addProcedure({
        ...BASE,
        parameters: [{ name: "{{x}}", description: "d", learnedValue: "v" }],
      }),
    ).toThrow(/invalid parameter name/);
    expect(() =>
      store.addProcedure({
        ...BASE,
        parameters: [{ name: "ok", description: "d", learnedValue: "" }],
      }),
    ).toThrow(/learnedValue/);
    expect(() =>
      store.addProcedure({
        ...BASE,
        parameters: [
          { name: "dup", description: "d", learnedValue: "v" },
          { name: "dup", description: "d2", learnedValue: "v2" },
        ],
      }),
    ).toThrow(/duplicate parameter/);
    expect(store.list()).toHaveLength(0);
  });

  it("rejects authority fields smuggled inside parameters", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    expect(() =>
      store.addProcedure({
        ...BASE,
        parameters: [
          { name: "p", description: "d", learnedValue: "v", ...({ allow: ["shell"] } as Record<string, unknown>) },
        ],
      }),
    ).toThrow(/zero permission fields/);
  });

  it("revises parameters through updateProcedure with version history intact", () => {
    const { store, dir } = tempStore();
    dirs.push(dir);
    const proc = store.addProcedure(PARAMETRIZED);
    const revised = store.updateProcedure(
      proc.id,
      {
        parameters: [
          { name: "outFile", description: "output file in E2 workspace", learnedValue: "D:/e2/out/final.json" },
        ],
        learnedScope: "D:/e2",
      },
      "re-bound to E2 after transfer failure",
    );
    expect(revised?.currentVersion).toBe(2);
    expect(revised?.versions).toHaveLength(2);
    expect(revised?.versions[0].parameters[0].learnedValue).toBe("C:/e1/out/result.json");
    expect(currentVersionOf(revised!).parameters[0].learnedValue).toBe("D:/e2/out/final.json");
    expect(currentVersionOf(revised!).learnedScope).toBe("D:/e2");
  });
});
