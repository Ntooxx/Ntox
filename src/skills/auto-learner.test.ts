import { describe, it, expect } from "vitest";
import type { LLMClient } from "../core/llm.js";
import type { AgentToolTrace, SkillDefinition } from "../types/index.js";
import {
  shouldProposeSkill,
  proposeSkillFromTurn,
  findTriggerConflict,
  renderSkillProposal,
  MAX_SKILL_PROPOSALS_PER_SESSION,
} from "./auto-learner.js";

function toolCall(name: string, success: boolean): AgentToolTrace {
  return { name, args: { path: "src/index.ts" }, success };
}

function turnContext(overrides: Partial<Parameters<typeof shouldProposeSkill>[0]> = {}) {
  return {
    userInput: "migrate the test suite over to the new runner and fix every failing spec",
    response: "I migrated 12 files, updated the config, and all tests pass now.".repeat(4),
    toolCalls: [toolCall("read", true), toolCall("shell", true), toolCall("edit", true)],
    corrected: false,
    falseSuccess: false,
    turnNumber: 5,
    turnsSinceLastProposal: null,
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "migrate-test-runner",
    description: "Migrate a test suite to a new runner",
    category: "coding",
    prompt: "Read the current runner config, then migrate tests one by one.",
    triggers: ["migrate tests", "switch test runner"],
    tools: ["read", "edit", "shell"],
    examples: ["migrate our tests to vitest"],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
    ...overrides,
  };
}

describe("shouldProposeSkill", () => {
  it("accepts a healthy multi-tool successful turn", () => {
    expect(shouldProposeSkill(turnContext())).toEqual({ ok: true });
  });

  it("rejects turns that were corrected", () => {
    const result = shouldProposeSkill(turnContext({ corrected: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("correction");
  });

  it("rejects turns with a false-success retry", () => {
    expect(shouldProposeSkill(turnContext({ falseSuccess: true })).ok).toBe(false);
  });

  it("rejects turns with fewer than two successful tool calls", () => {
    const result = shouldProposeSkill(turnContext({ toolCalls: [toolCall("read", true)] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("two");
  });

  it("rejects turns that only repeated one tool", () => {
    const result = shouldProposeSkill(turnContext({ toolCalls: [toolCall("grep", true), toolCall("grep", true)] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("one kind of tool");
  });

  it("ignores failed tool calls when counting", () => {
    const result = shouldProposeSkill(turnContext({ toolCalls: [toolCall("shell", false), toolCall("grep", true)] }));
    expect(result.ok).toBe(false);
  });

  it("rejects trivial requests and shallow responses", () => {
    expect(shouldProposeSkill(turnContext({ userInput: "ok thanks" })).ok).toBe(false);
    expect(shouldProposeSkill(turnContext({ response: "Done!" })).ok).toBe(false);
  });

  it("enforces the cooldown between proposals", () => {
    const cooled = shouldProposeSkill(turnContext({ turnsSinceLastProposal: 19 }));
    expect(cooled.ok).toBe(false);
    const ready = shouldProposeSkill(turnContext({ turnsSinceLastProposal: MAX_SKILL_PROPOSALS_PER_SESSION * 10 }));
    expect(ready).toEqual({ ok: true });
  });
});

function llmWithStream(stream: (messages: unknown[], system: string) => AsyncGenerator<{ delta: string }>): LLMClient {
  return { stream } as unknown as LLMClient;
}

async function collectText(text: string): Promise<LLMClient> {
  return llmWithStream(async function* () {
    yield { delta: text };
  });
}

describe("proposeSkillFromTurn", () => {
  const SKILL_JSON = `{"name":"Migrate Test Runner","description":"Migrate a suite","category":"coding",
    "prompt":"Read config, migrate files.","triggers":["migrate tests"],"tools":["read","edit"],"examples":["migrate to vitest"]}`;

  it("extracts and normalizes a skill definition", async () => {
    const llm = await collectText(`Let me think.\n\`\`\`json\n${SKILL_JSON}\n\`\`\`\nDone.`);
    const skill = await proposeSkillFromTurn(llm, {
      userInput: "migrate our tests to vitest please",
      response: "x".repeat(300),
      toolCalls: [toolCall("read", true), toolCall("shell", true)],
    });
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("migrate-test-runner");
    expect(skill!.triggers).toEqual(["migrate tests"]);
    expect(skill!.usageCount).toBe(0);
  });

  it("includes tool names and compacted args in the curator prompt", async () => {
    let prompt = "";
    const llm = llmWithStream(async function* () {
      yield { delta: "" };
    });
    const originalStream = llm.stream.bind(llm);
    (llm as { stream: (messages: unknown[], system: string) => AsyncGenerator<{ delta: string }> }).stream =
      async function* (messages: unknown[]) {
        prompt = String((messages[0] as { content: string }).content);
        yield* (originalStream as (m: unknown[], s: string) => AsyncGenerator<{ delta: string }>)(messages, "");
      };
    await proposeSkillFromTurn(llm, {
      userInput: "migrate our tests to vitest please",
      response: "x".repeat(300),
      toolCalls: [{ name: "shell", args: { command: "npm test -- --run" }, success: true }],
    });
    expect(prompt).toContain("- shell: npm test -- --run");
    expect(prompt).toContain("migrate our tests to vitest please");
  });

  it("returns null when the model declines or produces junk", async () => {
    expect(
      await proposeSkillFromTurn(await collectText('{"skip": true}'), {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
    expect(
      await proposeSkillFromTurn(await collectText("no json at all here"), {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
    expect(
      await proposeSkillFromTurn(await collectText("{ broken json"), {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
  });

  it("returns null when triggers are missing or the name is unusable", async () => {
    expect(
      await proposeSkillFromTurn(await collectText('{"name":"no-triggers","prompt":"do it"}'), {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
    expect(
      await proposeSkillFromTurn(await collectText('{"name":"///","prompt":"do it","triggers":["x"]}'), {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
  });

  it("returns null when the stream throws", async () => {
    const llm = {
      stream: () => {
        throw new Error("network down");
      },
    } as unknown as LLMClient;
    expect(
      await proposeSkillFromTurn(llm, {
        userInput: "migrate our tests",
        response: "x".repeat(300),
        toolCalls: [toolCall("read", true), toolCall("shell", true)],
      }),
    ).toBeNull();
  });
});

describe("findTriggerConflict", () => {
  it("detects name and trigger collisions", () => {
    const existing = [makeSkill()];
    expect(findTriggerConflict(makeSkill(), existing)).toBe("migrate-test-runner");
    expect(findTriggerConflict(makeSkill({ name: "other-name" }), existing)).toBe("migrate-test-runner");
    expect(findTriggerConflict(makeSkill({ name: "other-name", triggers: ["migrate tests", "extra"] }), existing)).toBe(
      "migrate-test-runner",
    );
  });

  it("passes disjoint skills", () => {
    const candidate = makeSkill({ name: "brand-new-skill", triggers: ["totally different"] });
    expect(findTriggerConflict(candidate, [makeSkill()])).toBeNull();
  });
});

describe("renderSkillProposal", () => {
  it("shows the accept command", () => {
    const text = renderSkillProposal(makeSkill());
    expect(text).toContain("/skill save migrate-test-runner");
    expect(text).toContain("migrate tests");
    expect(text).toContain("read, edit, shell");
  });
});
