import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/episodic.js";
import { MistakeJournal } from "../meta/mistakes.js";
import { ProcedureStore } from "../memory/procedure-store.js";
import { verifyAndPromoteProcedure } from "../memory/procedure-harness.js";
import { NtoxCognitiveLayer } from "./layer.js";

describe("NtoxCognitiveLayer", () => {
  const memory = new MemoryStore();
  const mistakes = new MistakeJournal();

  afterEach(() => {
    memory.clearAll();
    mistakes.clearAll();
  });

  it("assembles runtime-neutral step context", async () => {
    const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false }, { memory, mistakes });

    const context = await layer.beforeStep({
      sessionId: "session-1",
      turnId: "turn-1",
      userMessage: "plan a TypeScript API migration",
    });

    expect(context.queryType).toBe("coding");
    expect(context.prompt).toContain("NTOX Cognitive Context");
    expect(context.prompt).toContain("Strategy: Coding");
    expect(context.sections.map((section) => section.name)).toContain("strategy");
    expect(context.diagnostics.errors).toEqual([]);
  });

  it("setStoreFlags toggles subsystem gating at runtime", async () => {
    const layer = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false, memoryEnabled: false, strategyEnabled: false },
      { memory, mistakes },
    );
    layer.setStoreFlags({ memoryEnabled: true, strategyEnabled: true });
    memory.addDurableMemory("fact", "runtime flag fact alpha", "test", 0.95);
    const withMemory = await layer.beforeStep({
      sessionId: "flags",
      turnId: "t1",
      userMessage: "what is the runtime flag fact alpha?",
      embedding: null,
    });
    expect(withMemory.diagnostics.memoryIncluded).toBe(true);

    layer.setStoreFlags({ memoryEnabled: false });
    const withoutMemory = await layer.beforeStep({
      sessionId: "flags",
      turnId: "t2",
      userMessage: "what is the runtime flag fact alpha?",
      embedding: null,
    });
    expect(withoutMemory.diagnostics.memoryIncluded).toBe(false);
  });

  it("stores a turn and recalls it on a later step", async () => {
    const layer = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false, mistakesEnabled: false },
      { memory },
    );

    await layer.beforeStep({
      sessionId: "session-1",
      turnId: "turn-1",
      userMessage: "TypeScript migration architecture",
    });
    const learning = await layer.afterTurn({
      sessionId: "session-1",
      turnId: "turn-1",
      userMessage: "TypeScript migration architecture",
      assistantResponse: "Use an adapter-first migration.",
    });
    const next = await layer.beforeStep({
      sessionId: "session-1",
      turnId: "turn-2",
      userMessage: "TypeScript migration architecture",
    });

    expect(learning.memoryId).toMatch(/^ep_/);
    expect(next.diagnostics.memoryIncluded).toBe(true);
    expect(next.prompt).toContain("Relevant Past Memories");
  });

  it("carries bounded tool outcomes into post-turn learning", async () => {
    const layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        memoryEnabled: false,
        theoryEnabled: false,
        mistakesEnabled: false,
        maxToolOutcomesPerTurn: 2,
      },
      { memory, mistakes },
    );

    for (let index = 1; index <= 3; index++) {
      await layer.afterTool({
        sessionId: "session-1",
        turnId: "turn-1",
        toolName: `tool-${index}`,
        success: index > 1,
      });
    }

    const learning = await layer.afterTurn({
      sessionId: "session-1",
      turnId: "turn-1",
      userMessage: "run the tools",
      assistantResponse: "Done.",
    });

    expect(learning.toolOutcomes.map((result) => result.toolName)).toEqual(["tool-2", "tool-3"]);
  });

  it("records explicit correction feedback", async () => {
    const layer = new NtoxCognitiveLayer(
      { cognitionEnabled: false, memoryEnabled: false, theoryEnabled: false },
      { memory, mistakes },
    );

    const learning = await layer.afterTurn({
      sessionId: "session-1",
      userMessage: "What runtime owns tool execution?",
      assistantResponse: "NTOX owns it.",
      correction: {
        topicKey: "runtime ownership",
        correction: "DeepSeek Harness owns tool execution.",
      },
    });

    expect(learning.mistakeId).toMatch(/^mist_/);
    expect(mistakes.getRelevantMistakes("runtime ownership")[0].correction).toContain("Harness");
  });

  it("places authoritative corrections before conflicting memory", async () => {
    const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false }, { memory, mistakes });

    await layer.afterTurn({
      sessionId: "session-1",
      userMessage: "The deployment ledger says harbor=blue-ember.",
      assistantResponse: "harbor=blue-ember",
    });
    await layer.afterTurn({
      sessionId: "session-1",
      userMessage: "Correct the deployment ledger: harbor=navy-ember.",
      assistantResponse: "harbor=navy-ember",
      correction: {
        topicKey: "harbor",
        correction: "harbor=navy-ember",
        wrongAnswer: "harbor=blue-ember",
      },
    });

    const context = await layer.beforeStep({
      sessionId: "session-1",
      userMessage: "What is the deployment ledger value for harbor?",
    });

    expect(context.diagnostics.correctionIncluded).toBe(true);
    expect(context.prompt.indexOf("Previous Corrections: Authoritative")).toBeLessThan(
      context.prompt.indexOf("Relevant Past Memories"),
    );
    expect(context.prompt).toContain("harbor=navy-ember");
  });

  it("carries failed tool guidance into exactly one later step", async () => {
    const layer = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false, mistakesEnabled: false },
      { memory, mistakes },
    );

    await layer.afterTool({
      sessionId: "session-1",
      turnId: "turn-1",
      toolName: "read",
      success: false,
      error: "ENOENT: release manifest",
    });
    await layer.afterTurn({
      sessionId: "session-1",
      turnId: "turn-1",
      userMessage: "Read the release manifest.",
      assistantResponse: "The read failed.",
    });

    const recovery = await layer.beforeStep({
      sessionId: "session-1",
      turnId: "turn-2",
      userMessage: "Continue the release check.",
    });
    const later = await layer.beforeStep({
      sessionId: "session-1",
      turnId: "turn-3",
      userMessage: "Continue the release check.",
    });

    expect(recovery.diagnostics.recoveryIncluded).toBe(true);
    expect(recovery.prompt).toContain("Tool Recovery Guidance");
    expect(recovery.prompt).toContain("ENOENT: release manifest");
    expect(recovery.prompt).toContain("Next step: Verify the path or discover the file before retrying.");
    expect(later.diagnostics.recoveryIncluded).toBe(false);
  });

  it("falls back to local embeddings without failing the host step", async () => {
    const layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        theoryEnabled: false,
        mistakesEnabled: false,
        embed: async () => {
          throw new Error("provider unavailable");
        },
      },
      { memory },
    );

    const context = await layer.beforeStep({
      sessionId: "session-1",
      userMessage: "remember this architecture",
    });

    expect(context.embedding?.length).toBeGreaterThan(0);
    expect(context.diagnostics.errors).toContain("embedding: provider unavailable");
  });

  it("gates durable learning when storeEnabled is false (full cognition without learning)", async () => {
    memory.addDurableMemory("fact", "harbor=blue-ember", "test");
    mistakes.add("harbor", "old question", "harbor=blue-ember", "harbor=navy-ember", "user-correction");

    const noStore = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false, storeEnabled: false },
      { memory, mistakes },
    );

    const learning = await noStore.afterTurn({
      sessionId: "session-1",
      userMessage: "The ledger value for harbor is blue-ember.",
      assistantResponse: "harbor=blue-ember",
      correction: { topicKey: "harbor", correction: "harbor=navy-ember" },
    });

    expect(learning.memoryId).toBeUndefined();
    expect(learning.mistakeId).toBeUndefined();
    expect(learning.theoryUpdated).toBe(false);

    const next = await noStore.beforeStep({
      sessionId: "session-1",
      turnId: "turn-2",
      userMessage: "What is the ledger value for harbor?",
    });
    expect(next.diagnostics.memoryIncluded).toBe(false);
    expect(next.diagnostics.correctionIncluded).toBe(false);

    const withStore = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false, storeEnabled: true },
      { memory, mistakes },
    );
    const stored = await withStore.afterTurn({
      sessionId: "session-2",
      userMessage: "The ledger value for harbor is blue-ember.",
      assistantResponse: "harbor=blue-ember",
      correction: { topicKey: "harbor", correction: "harbor=navy-ember" },
    });
    expect(stored.memoryId).toMatch(/^ep_/);
    expect(stored.mistakeId).toMatch(/^mist_/);
  });

  it("updates conflicting durable memories from explicit corrections", async () => {
    const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false }, { memory, mistakes });
    const oldMemory = memory.addDurableMemory("fact", "harbor=blue-ember", "test", 0.8);

    await layer.afterTurn({
      sessionId: "session-1",
      userMessage: "Correct harbor.",
      assistantResponse: "harbor=blue-ember",
      correction: {
        topicKey: "harbor",
        wrongAnswer: "harbor=blue-ember",
        correction: "harbor=navy-ember",
      },
    });

    const stored = memory.getDurableMemory(oldMemory.id);
    expect(stored?.text).toBe("harbor=navy-ember");
    expect(stored?.provenance).toBe("user correction");
  });

  it("tags stored episodes with the producing embedding model", async () => {
    const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false }, { memory, mistakes });

    await layer.afterTurn({
      sessionId: "session-emb",
      turnId: "turn-emb",
      userMessage: "the deploy token is cedar-4",
      assistantResponse: "ok",
      embedding: [1, 0, 0],
      embeddingModel: "remote:test/model",
    });

    const episode = memory.getAll().find((e) => e.userMessage === "the deploy token is cedar-4");
    expect(episode?.embeddingModel).toBe("remote:test/model");
    expect(episode?.embedding).toEqual([1, 0, 0]);
  });

  it("tags provided vectors without a model tag as local-hash", async () => {
    const layer = new NtoxCognitiveLayer({ cognitionEnabled: false, theoryEnabled: false }, { memory, mistakes });

    await layer.afterTurn({
      sessionId: "session-emb2",
      turnId: "turn-emb2",
      userMessage: "the deploy token is cedar-5",
      assistantResponse: "ok",
      embedding: [1, 0, 0],
    });

    const episode = memory.getAll().find((e) => e.userMessage === "the deploy token is cedar-5");
    expect(episode?.embeddingModel).toBe("local-hash");
  });

  it("tags fallback-embedded episodes as local-hash", async () => {
    const layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        theoryEnabled: false,
        mistakesEnabled: false,
        embed: async () => {
          throw new Error("provider unavailable");
        },
      },
      { memory },
    );

    await layer.afterTurn({
      sessionId: "session-emb3",
      userMessage: "the deploy token is cedar-6",
      assistantResponse: "ok",
    });

    const episode = memory.getAll().find((e) => e.userMessage === "the deploy token is cedar-6");
    expect(episode?.embedding.length).toBeGreaterThan(0);
    expect(episode?.embeddingModel).toBe("local-hash");
  });

  it("still accepts legacy bare-vector embedders", async () => {
    const layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        theoryEnabled: false,
        mistakesEnabled: false,
        embed: async () => [1, 0, 0],
      },
      { memory },
    );

    await layer.afterTurn({
      sessionId: "session-legacy",
      userMessage: "legacy embedder still works",
      assistantResponse: "ok",
    });

    const episode = memory.getAll().find((e) => e.userMessage === "legacy embedder still works");
    expect(episode?.embedding).toEqual([1, 0, 0]);
    expect(episode?.embeddingModel).toBe("local-hash");
  });
});

describe("verified procedure injection", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function storeWith(procedureState: "candidate" | "verified"): ProcedureStore {
    const dir = mkdtempSync(join(tmpdir(), "ntox-proc-layer-"));
    dirs.push(dir);
    const store = new ProcedureStore({ path: join(dir, "procedures.json") });
    const procedure = store.addProcedure({
      name: "verify-harbor-ledger-procedure",
      description: "verify the harbor ledger procedure after release",
      steps: [{ id: "step_1", description: "read the ledger", tool: "read", args: { path: "/tmp/ledger" } }],
      prerequisites: [],
      scope: { applies: [], doesNotApply: [] },
      parameters: [],
      learnedScope: "/workspace",
    });
    if (procedureState === "verified") {
      const promotion = verifyAndPromoteProcedure({
        store,
        procedureId: procedure.id,
        taskId: "task-1",
        envFingerprint: "env-1",
        checkOutputs: [{ target: "ledger", type: "command", passed: true, detail: "check exited 0" }],
      });
      expect(promotion.ok).toBe(true);
    }
    return store;
  }

  async function contextFor(store: ProcedureStore) {
    const layer = new NtoxCognitiveLayer(
      {
        cognitionEnabled: false,
        theoryEnabled: false,
        memoryEnabled: false,
        mistakesEnabled: false,
        strategyEnabled: false,
        proceduresEnabled: true,
      },
      { procedureStore: store },
    );
    return layer.beforeStep({
      sessionId: "procedure-session",
      userMessage: "verify the harbor ledger procedure",
    });
  }

  it("injects only verified procedures as untrusted task data", async () => {
    const context = await contextFor(storeWith("verified"));
    expect(context.diagnostics.proceduresIncluded).toBe(true);
    expect(context.sections.map((section) => section.name)).toContain("procedures");
    expect(context.prompt).toContain("UNTRUSTED TASK DATA");
  });

  it("does not surface unverified candidates", async () => {
    const context = await contextFor(storeWith("candidate"));
    expect(context.diagnostics.proceduresIncluded).toBe(false);
    expect(context.sections.map((section) => section.name)).not.toContain("procedures");
  });
});
