import { describe, it, expect, vi } from "vitest";
import type { LLMClient } from "../core/llm.js";
import type { AgentTurnTrace, SkillDefinition } from "../types/index.js";
import { maybeAuthorSkillOnStruggle } from "./self-author.js";

const SKILL_JSON = JSON.stringify({
  name: "recover-from-failed-tool",
  description: "Recover when a tool call fails",
  category: "custom",
  prompt: "Inspect the tool error, adjust the arguments, and retry once.",
  triggers: ["tool failed", "recover tool error"],
  tools: ["shell", "read"],
  examples: ["the build command failed"],
});

function mockLlm(): LLMClient {
  return {
    stream: async function* () {
      yield { delta: SKILL_JSON };
    },
  } as unknown as LLMClient;
}

function trace(overrides: Partial<AgentTurnTrace> = {}): AgentTurnTrace {
  return {
    startedAt: 1,
    completedAt: 2,
    userInput: "Please debug the failing build pipeline and fix the broken release step",
    responseMode: "tool-build",
    memoryRecallCount: 0,
    searchUsed: false,
    toolCalls: [{ name: "shell", args: { command: "npm run build" }, success: false, error: "exit 1" }],
    policyDecisions: [],
    checkpointIds: [],
    retries: 1,
    injectionWarnings: [],
    ...overrides,
  };
}

function registry(existing: SkillDefinition[] = []) {
  const skills = [...existing];
  return {
    list: () => skills,
    add: vi.fn((skill: SkillDefinition) => {
      skills.push(skill);
    }),
  };
}

function runtime(overrides: Partial<ReturnType<typeof makeRuntime>> = {}) {
  return { ...makeRuntime(), ...overrides };
}

function makeRuntime() {
  return { skillAuthorTurn: 0, lastSkillAuthorTurn: null as number | null, skillAuthorsThisSession: 0 };
}

describe("maybeAuthorSkillOnStruggle", () => {
  it("does nothing when the turn did not struggle", async () => {
    const reg = registry();
    const t = trace({ toolCalls: [], retries: 0 });
    const rt = runtime();

    const result = await maybeAuthorSkillOnStruggle({
      llm: mockLlm(),
      registry: reg,
      trace: t,
      fullResponse: "short answer",
      corrected: false,
      falseSuccess: false,
      toolFailure: false,
      runtime: rt,
    });

    expect(result).toBeNull();
    expect(reg.add).not.toHaveBeenCalled();
  });

  it("authors and persists a self-authored skill after a failed tool call", async () => {
    const reg = registry();
    const t = trace();
    const rt = runtime();

    const result = await maybeAuthorSkillOnStruggle({
      llm: mockLlm(),
      registry: reg,
      trace: t,
      fullResponse: "the build failed twice; after fixing the flag it passed".repeat(6),
      corrected: false,
      falseSuccess: false,
      toolFailure: true,
      runtime: rt,
    });

    expect(result?.name).toBe("recover-from-failed-tool");
    expect(result?.category).toBe("self-authored");
    expect(reg.add).toHaveBeenCalledTimes(1);
    expect(t.authoredSkill).toBe("recover-from-failed-tool");
    expect(rt.lastSkillAuthorTurn).toBe(1);
    expect(rt.skillAuthorsThisSession).toBe(1);
  });

  it("skips candidates that conflict with an existing skill", async () => {
    const existing: SkillDefinition = {
      name: "existing",
      description: "existing skill",
      category: "custom",
      prompt: "do it",
      triggers: ["tool failed"],
      tools: [],
      examples: [],
      created: 1,
      updated: 1,
      usageCount: 0,
    };
    const reg = registry([existing]);
    const result = await maybeAuthorSkillOnStruggle({
      llm: mockLlm(),
      registry: reg,
      trace: trace(),
      fullResponse: "long enough response to qualify for self authoring".repeat(8),
      corrected: false,
      falseSuccess: false,
      toolFailure: true,
      runtime: runtime(),
    });

    expect(result).toBeNull();
    expect(reg.add).not.toHaveBeenCalled();
  });

  it("respects cooldown and the per-session cap", async () => {
    const reg = registry();
    const input = {
      llm: mockLlm(),
      registry: reg,
      trace: trace(),
      fullResponse: "long enough response to qualify for self authoring".repeat(8),
      corrected: false,
      falseSuccess: false,
      toolFailure: true,
    };

    const first = await maybeAuthorSkillOnStruggle({ ...input, runtime: runtime() });
    expect(first).not.toBeNull();

    const cooldown = await maybeAuthorSkillOnStruggle({
      ...input,
      runtime: runtime({ skillAuthorTurn: 2, lastSkillAuthorTurn: 1, skillAuthorsThisSession: 1 }),
    });
    expect(cooldown).toBeNull();

    const capped = await maybeAuthorSkillOnStruggle({
      ...input,
      runtime: runtime({ skillAuthorTurn: 30, lastSkillAuthorTurn: 1, skillAuthorsThisSession: 3 }),
    });
    expect(capped).toBeNull();
    expect(reg.add).toHaveBeenCalledTimes(1);
  });
});
