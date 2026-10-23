import { describe, it, expect } from "vitest";
import {
  MAX_ROUTINE_STEPS,
  ROUTINE_ALLOWED_TOOLS,
  createRoutineRuntime,
  parseRoutineSteps,
  renderRoutineRun,
  renderRoutineTemplate,
  runRoutine,
  type RoutineLlmLike,
  type RoutineRuntime,
} from "./routine.js";
import { ToolRegistry } from "../tools/registry.js";
import type { SkillDefinition, ToolResult } from "../types/index.js";

function makeRoutine(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "deploy-checklist",
    description: "Run the deploy checklist",
    category: "coding",
    prompt: "1. check CI\n2. tag release",
    triggers: ["run deploy checklist"],
    tools: [],
    examples: [],
    created: 1,
    updated: 1,
    usageCount: 0,
    ...overrides,
  };
}

function fakeRuntime(
  options: {
    tools?: Record<string, (args: Record<string, unknown>) => ToolResult>;
    skills?: SkillDefinition[];
    answers?: string[];
  } = {},
) {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const completions: string[] = [];
  let answerIndex = 0;
  const answers = options.answers ?? [];
  const runtime: RoutineRuntime = {
    runTool: async (name, args) => {
      toolCalls.push({ name, args });
      const impl = options.tools?.[name];
      if (!impl) return { success: false, error: `no such tool ${name}` };
      return impl(args);
    },
    complete: async (prompt) => {
      completions.push(prompt);
      if (answers.length > 0) {
        const answer = answers[Math.min(answerIndex, answers.length - 1)];
        answerIndex += 1;
        return answer;
      }
      return `llm:${completions.length}`;
    },
    getSkill: (name) => (options.skills ?? []).find((skill) => skill.name === name),
  };
  return { runtime, toolCalls, completions };
}

describe("parseRoutineSteps", () => {
  it("parses and normalizes a valid step list", () => {
    const parsed = parseRoutineSteps([
      { kind: "TOOL", name: " Fetch ", tool: "web_read", args: { url: "https://x", depth: 2, follow: true } },
      { kind: "llm", name: "summarize", prompt: "Summarize {{page}}", saveAs: "summary" },
      { kind: "skill", skill: "child-skill" },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.steps[0]).toEqual({
        kind: "tool",
        name: "Fetch",
        tool: "web_read",
        args: { url: "https://x", depth: 2, follow: true },
      });
      expect(parsed.steps[1]).toEqual({
        kind: "llm",
        name: "summarize",
        prompt: "Summarize {{page}}",
        saveAs: "summary",
      });
      expect(parsed.steps[2]).toEqual({ kind: "skill", skill: "child-skill" });
    }
  });

  it("drops invalid saveAs values instead of failing", () => {
    const parsed = parseRoutineSteps([{ kind: "llm", prompt: "do the thing carefully", saveAs: "not a key" }]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.steps[0].saveAs).toBeUndefined();
  });

  it("rejects malformed step lists", () => {
    expect(parseRoutineSteps("nope")).toEqual({ ok: false, error: "steps must be an array" });
    expect(parseRoutineSteps([])).toEqual({ ok: false, error: "steps must not be empty" });
    expect(parseRoutineSteps(new Array(MAX_ROUTINE_STEPS + 1).fill({ kind: "llm", prompt: "x" }))).toEqual({
      ok: false,
      error: `too many steps (max ${MAX_ROUTINE_STEPS})`,
    });
    expect(parseRoutineSteps([{ kind: "magic" }])).toEqual({
      ok: false,
      error: 'step 1 has unknown kind "magic"',
    });
    expect(parseRoutineSteps([{ kind: "tool" }])).toEqual({ ok: false, error: "step 1 (tool) needs a tool name" });
    expect(parseRoutineSteps([{ kind: "llm" }])).toEqual({ ok: false, error: "step 1 (llm) needs a prompt" });
    expect(parseRoutineSteps([{ kind: "skill" }])).toEqual({ ok: false, error: "step 1 (skill) needs a skill name" });
    expect(parseRoutineSteps([{ kind: "tool", tool: "web_read", args: { url: { nested: true } } }])).toEqual({
      ok: false,
      error: "step 1 args must be primitive values",
    });
    expect(parseRoutineSteps(["step"])).toEqual({ ok: false, error: "step 1 must be an object" });
  });
});

describe("renderRoutineTemplate", () => {
  it("substitutes saved outputs and leaves unknown refs empty", () => {
    const outputs = { page: "PAGE", summary: "SUM" };
    expect(renderRoutineTemplate("About {{page}} now: {{summary}}", outputs)).toBe("About PAGE now: SUM");
    expect(renderRoutineTemplate("missing {{ghost}} end", outputs)).toBe("missing  end");
    expect(renderRoutineTemplate("no refs here", outputs)).toBe("no refs here");
  });
});

describe("runRoutine", () => {
  it("chains a tool output into an llm prompt and keys outputs", async () => {
    const { runtime, toolCalls, completions } = fakeRuntime({
      tools: { web_read: () => ({ success: true, data: { content: "PAGE-CONTENT" } }) },
    });
    const skill = makeRoutine({
      steps: [
        { kind: "tool", name: "fetch", tool: "web_read", args: { url: "https://x" }, saveAs: "page" },
        { kind: "llm", name: "summarize", prompt: "Summarize: {{page}}" },
      ],
    });

    const result = await runRoutine(skill, runtime);

    expect(result.ok).toBe(true);
    expect(toolCalls).toEqual([{ name: "web_read", args: { url: "https://x" } }]);
    expect(completions).toEqual(["Summarize: PAGE-CONTENT"]);
    expect(result.outputs.page).toBe("PAGE-CONTENT");
    expect(result.outputs.summarize).toBe("llm:1");
    expect(result.finalOutput).toBe("llm:1");
    expect(result.steps.map((step) => step.ok)).toEqual([true, true]);
  });

  it("substitutes into tool args as well as prompts", async () => {
    const { runtime, toolCalls } = fakeRuntime({
      tools: {
        web_read: () => ({ success: true, data: { content: "A" } }),
        search: () => ({ success: true, data: { content: "B" } }),
      },
    });
    const skill = makeRoutine({
      steps: [
        { kind: "tool", name: "first", tool: "web_read", args: { url: "https://a" }, saveAs: "seed" },
        { kind: "tool", name: "second", tool: "search", args: { query: "more about {{seed}}" } },
      ],
    });

    const result = await runRoutine(skill, runtime);

    expect(result.ok).toBe(true);
    expect(toolCalls[1].args).toEqual({ query: "more about A" });
  });

  it("stops at the first failed tool step", async () => {
    const { runtime, completions } = fakeRuntime({
      tools: { web_read: () => ({ success: false, error: "boom" }) },
    });
    const skill = makeRoutine({
      steps: [
        { kind: "tool", name: "fetch", tool: "web_read", args: { url: "https://x" } },
        { kind: "llm", name: "never", prompt: "should not run" },
      ],
    });

    const result = await runRoutine(skill, runtime);

    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toBe("boom");
    expect(completions).toEqual([]);
  });

  it("refuses tools outside the routine allowlist without calling the runtime", async () => {
    const { runtime, toolCalls } = fakeRuntime();
    const skill = makeRoutine({
      steps: [{ kind: "tool", name: "danger", tool: "shell", args: { command: "rm -rf /" } }],
    });

    const result = await runRoutine(skill, runtime);

    expect(result.ok).toBe(false);
    expect(toolCalls).toEqual([]);
    expect(result.steps[0].error).toContain("not allowed in routines");
    expect(ROUTINE_ALLOWED_TOOLS.has("shell")).toBe(false);
    expect(ROUTINE_ALLOWED_TOOLS.has("web_read")).toBe(true);
  });

  it("runs a nested routine skill and records owner names", async () => {
    const child = makeRoutine({
      name: "child-routine",
      steps: [{ kind: "llm", name: "child-work", prompt: "child work" }],
    });
    const { runtime, completions } = fakeRuntime({ skills: [child] });
    const parent = makeRoutine({
      steps: [
        { kind: "skill", name: "invoke-child", skill: "child-routine" },
        { kind: "llm", name: "wrap", prompt: "wrap {{child-work}}" },
      ],
    });

    const result = await runRoutine(parent, runtime);

    expect(result.ok).toBe(true);
    expect(completions).toEqual(["child work", "wrap llm:1"]);
    expect(result.steps.map((step) => step.skill)).toEqual(["child-routine", "deploy-checklist", "deploy-checklist"]);
    expect(result.outputs["child-work"]).toBe("llm:1");
    expect(result.outputs["invoke-child"]).toBe("llm:1");
  });

  it("treats a plain skill step as an instruction to the model", async () => {
    const plain = makeRoutine({ name: "plain-skill", prompt: "Always do X first, then Y." });
    const { runtime, completions } = fakeRuntime({ skills: [plain] });
    const parent = makeRoutine({ steps: [{ kind: "skill", skill: "plain-skill" }] });

    const result = await runRoutine(parent, runtime);

    expect(result.ok).toBe(true);
    expect(completions[0]).toContain("Always do X first, then Y.");
  });

  it("uses a step-level override prompt for plain skill steps", async () => {
    const plain = makeRoutine({ name: "plain-skill", prompt: "original prompt" });
    const { runtime, completions } = fakeRuntime({ skills: [plain] });
    const parent = makeRoutine({ steps: [{ kind: "skill", skill: "plain-skill", prompt: "override {{seed}}" }] });

    await runRoutine(parent, runtime);
    expect(completions[0]).toBe("override ");
  });

  it("fails on missing nested skills and on cycles", async () => {
    const { runtime: missingRuntime } = fakeRuntime();
    const missing = await runRoutine(makeRoutine({ steps: [{ kind: "skill", skill: "ghost" }] }), missingRuntime);
    expect(missing.ok).toBe(false);
    expect(missing.steps[0].error).toContain('skill "ghost" not found');

    const a = makeRoutine({ name: "skill-a", steps: [{ kind: "skill", skill: "skill-b" }] });
    const b = makeRoutine({ name: "skill-b", steps: [{ kind: "skill", skill: "skill-a" }] });
    const { runtime: cycleRuntime } = fakeRuntime({ skills: [a, b] });
    const cycle = await runRoutine(a, cycleRuntime);
    expect(cycle.ok).toBe(false);
    expect(cycle.steps.some((step) => step.error?.includes("routine cycle"))).toBe(true);
  });

  it("caps nesting depth", async () => {
    const skills: SkillDefinition[] = [];
    for (let i = 1; i <= 7; i++) {
      skills.push(
        makeRoutine({
          name: `level-${i}`,
          steps: i < 7 ? [{ kind: "skill", skill: `level-${i + 1}` }] : [{ kind: "llm", prompt: "bottom" }],
        }),
      );
    }
    const { runtime } = fakeRuntime({ skills });
    const result = await runRoutine(skills[0], runtime);
    expect(result.ok).toBe(false);
    expect(result.steps.some((step) => step.error?.includes("nesting deeper"))).toBe(true);
  });

  it("returns a failed empty result for skills without steps", async () => {
    const { runtime } = fakeRuntime();
    const result = await runRoutine(makeRoutine(), runtime);
    expect(result).toEqual({ ok: false, steps: [], outputs: {}, finalOutput: "" });
  });
});

describe("createRoutineRuntime", () => {
  it("wires real tools, an llm stream, and the skill registry together", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "read",
      description: "read a file",
      parameters: { type: "object", properties: {} },
      execute: async (args) => ({ success: true, data: { content: `read:${String(args.path)}` } }),
    });
    const llm: RoutineLlmLike = {
      stream: async function* () {
        yield { delta: "answer" };
      },
    };
    const skill = makeRoutine({ name: "known-skill" });
    const runtime = createRoutineRuntime({
      llm,
      tools,
      skillRegistry: { get: (name) => (name === "known-skill" ? skill : undefined) },
    });

    const toolResult = await runtime.runTool("read", { path: "/tmp/x" });
    expect(toolResult.success).toBe(true);
    expect((toolResult.data as { content: string }).content).toBe("read:/tmp/x");

    const unknown = await runtime.runTool("nope", {});
    expect(unknown.success).toBe(false);

    expect(await runtime.complete("question")).toBe("answer");
    expect(runtime.getSkill("known-skill")?.name).toBe("known-skill");
    expect(runtime.getSkill("ghost")).toBeUndefined();
  });
});

describe("renderRoutineRun", () => {
  it("renders a completed routine with step status and final output", async () => {
    const { runtime } = fakeRuntime({
      tools: { web_read: () => ({ success: true, data: { content: "DATA" } }) },
    });
    const skill = makeRoutine({
      steps: [
        { kind: "tool", name: "fetch", tool: "web_read", args: { url: "https://x" } },
        { kind: "llm", name: "brief", prompt: "brief {{step1}}" },
      ],
    });
    const result = await runRoutine(skill, runtime);
    const text = renderRoutineRun(skill, result);

    expect(text).toContain("Routine deploy-checklist (completed):");
    expect(text).toContain("ok  1. fetch");
    expect(text).toContain("ok  2. brief");
    expect(text).toContain("llm:1");
  });

  it("renders a stopped routine with the failing step", async () => {
    const { runtime } = fakeRuntime();
    const skill = makeRoutine({ steps: [{ kind: "skill", name: "ghost-step", skill: "ghost" }] });
    const result = await runRoutine(skill, runtime);
    const text = renderRoutineRun(skill, result);

    expect(text).toContain("Routine deploy-checklist (stopped):");
    expect(text).toContain("FAIL  1. ghost-step");
    expect(text).toContain('skill "ghost" not found');
    expect(text).toContain("Stopped at the first failure");
  });

  it("handles skills without steps", () => {
    expect(renderRoutineRun(makeRoutine(), { ok: false, steps: [], outputs: {}, finalOutput: "" })).toBe(
      'Skill "deploy-checklist" has no routine steps.',
    );
  });
});
