import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../memory/episodic.js";
import { MistakeJournal } from "../meta/mistakes.js";
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
    const layer = new NtoxCognitiveLayer(
      { cognitionEnabled: false, theoryEnabled: false },
      { memory, mistakes },
    );
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
});
