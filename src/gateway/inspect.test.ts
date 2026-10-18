import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { createInspectServices, extractApprovalCommand, isApprovalRequired } from "./inspect.js";
import { MemoryStore } from "../memory/episodic.js";
import { DURABLE_MEMORY_PATH } from "../core/config.js";
import type { CognitivePattern } from "../types/index.js";

afterEach(() => {
  if (existsSync(DURABLE_MEMORY_PATH)) unlinkSync(DURABLE_MEMORY_PATH);
});

function makePattern(overrides: Partial<CognitivePattern> = {}): CognitivePattern {
  return {
    id: "pat_1",
    name: "test-pattern",
    domains: ["programming"],
    vector: [],
    activatedRules: [],
    reasoningTemplate: "template",
    strength: 0.6,
    hitCount: 3,
    compileCount: 1,
    compiledTemplate: "",
    lastActivated: Date.now(),
    created: Date.now(),
    ...overrides,
  };
}

describe("approval helpers", () => {
  it("extracts command from APPROVAL_REQUIRED errors", () => {
    const err =
      'APPROVAL_REQUIRED: Command "git push origin main" requires approval. Use approval system to allow or deny.';
    expect(extractApprovalCommand(err)).toBe("git push origin main");
    expect(isApprovalRequired(err)).toBe(true);
    expect(isApprovalRequired("some other error")).toBe(false);
    expect(extractApprovalCommand("nope")).toBeNull();
  });
});

describe("createInspectServices", () => {
  it("returns null trace and why when agent missing", () => {
    const services = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [],
    });
    expect(services.getTrace("nope")).toBeNull();
    expect(services.getWhy("nope")).toBeNull();
    expect(services.getChanges("nope")).toEqual([]);
  });

  it("maps last trace into a why summary", () => {
    const trace = {
      startedAt: 1000,
      completedAt: 2500,
      userInput: "hi",
      responseMode: "simple-query",
      strategy: "factual",
      memoryRecallCount: 3,
      searchUsed: true,
      skill: { name: "debugging", confidence: 0.9 },
      toolCalls: [],
      policyDecisions: [],
      checkpointIds: [],
      retries: 1,
      droppedContextSections: ["style"],
    } as never;
    const services = createInspectServices({
      getAgent: () => ({ getLastTrace: () => trace }) as never,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [],
    });
    const why = services.getWhy("s");
    expect(why?.durationMs).toBe(1500);
    expect(why?.skill?.name).toBe("debugging");
    expect(why?.droppedContextSections).toEqual(["style"]);
    expect(why?.memoryRecallCount).toBe(3);
  });

  it("lists and mutates durable memories", () => {
    const store = new MemoryStore();
    store.clearAll();
    store.addDurableMemory("fact", "workspace is Ntox", "test", 0.9);
    const services = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => store,
      getPatterns: () => [],
    });
    const view = services.getMemory("s");
    expect(view.durable).toHaveLength(1);
    const id = view.durable[0].id;

    const updated = services.updateMemory("s", id, "workspace is NTOX repo");
    expect(updated?.text).toBe("workspace is NTOX repo");
    expect(services.deleteMemory("s", id)).toBe(true);
    expect(services.getMemory("s").durable).toHaveLength(0);
  });

  it("returns theories and patterns for beliefs view", () => {
    const services = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [
        makePattern({ id: "pat_a", name: "alpha", strength: 0.8 }),
        makePattern({ id: "pat_b", name: "beta", strength: 0.2, compiledTemplate: "compiled" }),
      ],
    });
    const beliefs = services.getBeliefs("conv_test");
    expect(beliefs.patterns).toHaveLength(2);
    expect(beliefs.patterns[0].name).toBe("alpha");
    expect(beliefs.patterns[1].compiled).toBe(true);
    expect(beliefs.stats).toHaveProperty("totalObservations");
  });

  it("approves commands with the right decision mapping", () => {
    const services = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [],
    });
    expect(services.approveCommand("git push", "session")).toBe(true);
    expect(services.approveCommand("", "session")).toBe(false);
    expect(services.approveCommand("git push", "deny")).toBe(true);
  });

  it("rolls back through the provided tool", async () => {
    const calls: Record<string, unknown>[] = [];
    const services = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [],
      rollbackTool: {
        execute: async (args) => {
          calls.push(args);
          return { success: true, data: { restoredTo: "/tmp/x" } };
        },
      },
    });
    const ok = await services.rollback("cp_1");
    expect(ok.success).toBe(true);
    expect(calls[0]).toEqual({ action: "rollback", checkpointId: "cp_1" });

    const noTool = createInspectServices({
      getAgent: () => undefined,
      getMemory: () => new MemoryStore(),
      getPatterns: () => [],
    });
    expect((await noTool.rollback("cp_1")).success).toBe(false);
    expect((await services.rollback("")).success).toBe(false);
  });
});
