import { executeToolCall, type ToolRegistry } from "../tools/registry.js";
import type { Message, RoutineStep, SkillDefinition, StreamChunk, ToolResult } from "../types/index.js";

export const MAX_ROUTINE_STEPS = 12;
const MAX_ROUTINE_DEPTH = 5;
const MAX_STEP_OUTPUT_CHARS = 8_000;
const MAX_TOTAL_OUTPUT_CHARS = 40_000;

export const ROUTINE_ALLOWED_TOOLS = new Set([
  "web_read",
  "web_fetch",
  "search",
  "read",
  "grep",
  "glob",
  "ls",
  "tts",
  "image",
]);

export type RoutineStepsParse = { ok: true; steps: RoutineStep[] } | { ok: false; error: string };

const STEP_KINDS = new Set(["tool", "llm", "skill"]);

function sanitizeArgs(raw: unknown): Record<string, string | number | boolean> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const args: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      args[key.slice(0, 60)] = typeof value === "string" ? value.slice(0, 4000) : value;
    } else {
      return null;
    }
  }
  return args;
}

export function parseRoutineSteps(raw: unknown): RoutineStepsParse {
  if (!Array.isArray(raw)) return { ok: false, error: "steps must be an array" };
  if (raw.length === 0) return { ok: false, error: "steps must not be empty" };
  if (raw.length > MAX_ROUTINE_STEPS) return { ok: false, error: `too many steps (max ${MAX_ROUTINE_STEPS})` };

  const steps: RoutineStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const record = raw[i];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, error: `step ${i + 1} must be an object` };
    }
    const entry = record as Record<string, unknown>;
    const kind = typeof entry.kind === "string" ? entry.kind.toLowerCase() : "";
    if (!STEP_KINDS.has(kind)) {
      return { ok: false, error: `step ${i + 1} has unknown kind "${String(entry.kind)}"` };
    }

    const step: RoutineStep = { kind: kind as RoutineStep["kind"] };
    if (typeof entry.name === "string" && entry.name.trim()) step.name = entry.name.trim().slice(0, 60);
    if (typeof entry.saveAs === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(entry.saveAs)) {
      step.saveAs = entry.saveAs;
    }

    if (step.kind === "tool") {
      if (typeof entry.tool !== "string" || !entry.tool.trim()) {
        return { ok: false, error: `step ${i + 1} (tool) needs a tool name` };
      }
      const args = sanitizeArgs(entry.args);
      if (!args) return { ok: false, error: `step ${i + 1} args must be primitive values` };
      step.tool = entry.tool.trim();
      step.args = args;
    } else if (step.kind === "llm") {
      if (typeof entry.prompt !== "string" || !entry.prompt.trim()) {
        return { ok: false, error: `step ${i + 1} (llm) needs a prompt` };
      }
      step.prompt = entry.prompt;
    } else {
      if (typeof entry.skill !== "string" || !entry.skill.trim()) {
        return { ok: false, error: `step ${i + 1} (skill) needs a skill name` };
      }
      step.skill = entry.skill.trim();
      if (typeof entry.prompt === "string" && entry.prompt.trim()) step.prompt = entry.prompt;
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

export interface RoutineLlmLike {
  stream(messages: Message[], system?: string): AsyncIterable<StreamChunk>;
}

export interface RoutineRuntime {
  runTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  complete(prompt: string): Promise<string>;
  getSkill(name: string): SkillDefinition | undefined;
}

export function createRoutineRuntime(deps: {
  llm: RoutineLlmLike;
  tools: ToolRegistry;
  skillRegistry: { get(name: string): SkillDefinition | undefined };
}): RoutineRuntime {
  return {
    runTool: (name, args) => executeToolCall(deps.tools, name, args),
    complete: async (prompt) => {
      let text = "";
      for await (const chunk of deps.llm.stream([{ role: "user", content: prompt }], "")) {
        if (chunk.delta) text += chunk.delta;
      }
      return text.trim();
    },
    getSkill: (name) => deps.skillRegistry.get(name),
  };
}

export function renderRoutineTemplate(value: string, outputs: Record<string, string>, namespace?: string): string {
  return value.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g, (_match, key: string) => {
    const scoped = namespace ? outputs[`${namespace}_${key}`] : undefined;
    return scoped ?? outputs[key] ?? "";
  });
}

function outputNamespace(skillName: string): string {
  const clean = skillName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return /^[a-z]/.test(clean) ? clean : `s_${clean}`;
}

function clampOutput(text: string): string {
  const clean = text.trim();
  if (clean.length <= MAX_STEP_OUTPUT_CHARS) return clean;
  return `${clean.slice(0, MAX_STEP_OUTPUT_CHARS - 3)}...`;
}

function extractToolOutput(result: ToolResult): string {
  const data = result.data as { content?: unknown } | undefined;
  if (typeof data?.content === "string") return clampOutput(data.content);
  try {
    return clampOutput(JSON.stringify(result.data ?? null));
  } catch {
    return clampOutput(String(result.data));
  }
}

export interface RoutineStepResult {
  skill: string;
  step: number;
  kind: RoutineStep["kind"];
  label: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface RoutineRunResult {
  ok: boolean;
  steps: RoutineStepResult[];
  outputs: Record<string, string>;
  finalOutput: string;
}

interface RunState {
  outputs: Record<string, string>;
  results: RoutineStepResult[];
  totalChars: number;
}

function stepLabel(step: RoutineStep, index: number): string {
  return step.name || step.tool || step.skill || `${step.kind} ${index + 1}`;
}

async function runSteps(
  skill: SkillDefinition,
  steps: RoutineStep[],
  runtime: RoutineRuntime,
  state: RunState,
  depth: number,
  chain: string[],
): Promise<boolean> {
  const ns = chain.length > 1 ? outputNamespace(skill.name) : undefined;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = stepLabel(step, i);
    let output: string;

    if (step.kind === "tool") {
      const toolName = step.tool!;
      if (!ROUTINE_ALLOWED_TOOLS.has(toolName)) {
        state.results.push({
          skill: skill.name,
          step: i + 1,
          kind: step.kind,
          label,
          ok: false,
          error: `tool "${toolName}" is not allowed in routines`,
        });
        return false;
      }
      const args: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(step.args ?? {})) {
        args[key] = typeof value === "string" ? renderRoutineTemplate(value, state.outputs, ns) : value;
      }
      const result = await runtime.runTool(toolName, args);
      if (!result.success) {
        state.results.push({
          skill: skill.name,
          step: i + 1,
          kind: step.kind,
          label,
          ok: false,
          error: result.error || `tool "${toolName}" failed`,
        });
        return false;
      }
      output = extractToolOutput(result);
    } else if (step.kind === "llm") {
      const prompt = renderRoutineTemplate(step.prompt ?? skill.prompt, state.outputs, ns);
      output = clampOutput(await runtime.complete(prompt));
    } else {
      const target = runtime.getSkill(step.skill!);
      if (!target) {
        state.results.push({
          skill: skill.name,
          step: i + 1,
          kind: step.kind,
          label,
          ok: false,
          error: `skill "${step.skill}" not found`,
        });
        return false;
      }
      if (chain.includes(target.name)) {
        state.results.push({
          skill: skill.name,
          step: i + 1,
          kind: step.kind,
          label,
          ok: false,
          error: `routine cycle: ${[...chain, target.name].join(" -> ")}`,
        });
        return false;
      }
      if (target.steps && target.steps.length > 0) {
        if (depth + 1 > MAX_ROUTINE_DEPTH) {
          state.results.push({
            skill: skill.name,
            step: i + 1,
            kind: step.kind,
            label,
            ok: false,
            error: `routine nesting deeper than ${MAX_ROUTINE_DEPTH}`,
          });
          return false;
        }
        const before = state.results.length;
        const nestedOk = await runSteps(target, target.steps, runtime, state, depth + 1, [...chain, target.name]);
        if (!nestedOk) return false;
        output = clampOutput(
          state.results
            .slice(before)
            .filter((result) => result.ok)
            .map((result) => result.output ?? "")
            .join("\n"),
        );
      } else {
        const instruction = step.prompt
          ? renderRoutineTemplate(step.prompt, state.outputs, ns)
          : `Follow this skill exactly and answer with the result:\n\n${target.prompt}`;
        output = clampOutput(await runtime.complete(instruction));
      }
    }

    if (state.totalChars + output.length > MAX_TOTAL_OUTPUT_CHARS) {
      output = clampOutput(output.slice(0, Math.max(0, MAX_TOTAL_OUTPUT_CHARS - state.totalChars)));
    }
    state.totalChars += output.length;

    const localKey = step.name || `step${i + 1}`;
    const key = step.saveAs || (ns ? `${ns}_${localKey}` : localKey);
    state.outputs[key] = output;
    state.results.push({ skill: skill.name, step: i + 1, kind: step.kind, label, ok: true, output });
  }
  return true;
}

export async function runRoutine(
  skill: SkillDefinition,
  runtime: RoutineRuntime,
  initialOutputs?: Record<string, string>,
): Promise<RoutineRunResult> {
  const steps = skill.steps ?? [];
  const state: RunState = { outputs: { ...initialOutputs }, results: [], totalChars: 0 };
  if (steps.length === 0) {
    return { ok: false, steps: [], outputs: {}, finalOutput: "" };
  }
  const ok = await runSteps(skill, steps, runtime, state, 1, [skill.name]);
  const lastOutput = [...state.results].reverse().find((result) => result.ok)?.output ?? "";
  return { ok, steps: state.results, outputs: state.outputs, finalOutput: lastOutput };
}

export function renderRoutineRun(skill: SkillDefinition, result: RoutineRunResult): string {
  if (result.steps.length === 0) return `Skill "${skill.name}" has no routine steps.`;
  const lines = [`Routine ${skill.name} (${result.ok ? "completed" : "stopped"}):`];
  for (const entry of result.steps) {
    const owner = entry.skill !== skill.name ? ` [${entry.skill}]` : "";
    lines.push(`  ${entry.ok ? "ok" : "FAIL"}  ${entry.step}. ${entry.label}${owner}`);
    if (!entry.ok) lines.push(`        ${entry.error}`);
  }
  if (result.ok && result.finalOutput) {
    lines.push("", result.finalOutput);
  }
  if (!result.ok) {
    lines.push("", `Stopped at the first failure. Partial outputs kept: ${Object.keys(result.outputs).length}.`);
  }
  return lines.join("\n");
}
