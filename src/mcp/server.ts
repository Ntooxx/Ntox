import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { SkillDefinition } from "../types/index.js";
import { createSharedInfra } from "../core/dispatcher.js";
import { loadConfig } from "../core/config.js";
import { createRoutineRuntime, renderRoutineRun, runRoutine } from "../skills/routine.js";

export const SKILL_LIST_TOOL = "skill_list";
export const SKILL_RUN_TOOL = "skill_run";
const MAX_SKILL_TOOL_NAME = 96;

export interface SkillServerDeps {
  skills: () => SkillDefinition[];
  getSkill: (name: string) => SkillDefinition | undefined;
  runSkill: (skill: SkillDefinition, input: string) => Promise<string>;
}

export function skillToolName(rawName: string, taken: Set<string>): string {
  let base =
    rawName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SKILL_TOOL_NAME) || "skill";
  if (base === SKILL_LIST_TOOL || base === SKILL_RUN_TOOL) base = `${base}-run`;
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    candidate = `${base.slice(0, MAX_SKILL_TOOL_NAME - String(suffix).length - 1)}-${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: text || "(empty result)" }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeSkill(skill: SkillDefinition): string {
  const parts = [skill.description?.trim() || `Run the "${skill.name}" skill.`];
  if (skill.steps && skill.steps.length > 0) {
    parts.push(`Routine: ${skill.steps.length} steps.`);
  }
  if (skill.triggers.length > 0) {
    parts.push(`Triggers: ${skill.triggers.join(", ")}`);
  }
  return parts.join(" ");
}

export function createSkillMcpServer(deps: SkillServerDeps): McpServer {
  const server = new McpServer({ name: "ntox-skills", version: "0.1.0" });
  const taken = new Set<string>([SKILL_LIST_TOOL, SKILL_RUN_TOOL]);

  server.registerTool(
    SKILL_LIST_TOOL,
    {
      description: "List the skills NTOX can run: name, description, triggers, and routine step count.",
      inputSchema: { query: z.string().optional().describe("filter by name, description, or trigger") },
    },
    async ({ query }) => {
      const needle = query?.trim().toLowerCase();
      const all = deps.skills();
      const matches = needle
        ? all.filter(
            (skill) =>
              skill.name.toLowerCase().includes(needle) ||
              (skill.description ?? "").toLowerCase().includes(needle) ||
              skill.triggers.some((trigger) => trigger.toLowerCase().includes(needle)),
          )
        : all;
      if (matches.length === 0) return textResult(`No skills matched ${JSON.stringify(query ?? "")}.`);
      const lines = matches.map((skill) => {
        const routine = skill.steps?.length ? ` (routine, ${skill.steps.length} steps)` : "";
        const triggers = skill.triggers.length > 0 ? `\n    triggers: ${skill.triggers.join(", ")}` : "";
        return `  ${skill.name}${routine} — ${skill.description || "(no description)"}${triggers}`;
      });
      return textResult(`${matches.length} skill(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    SKILL_RUN_TOOL,
    {
      description: "Run a NTOX skill by name and return its output. Use skill_list to find names.",
      inputSchema: {
        name: z.string().describe("exact skill name from skill_list"),
        input: z.string().optional().describe("task text handed to the skill as {{input}}"),
      },
    },
    async ({ name, input }) => {
      const skill = deps.getSkill(name);
      if (!skill) return errorResult(`Skill "${name}" not found. Use skill_list to see available skills.`);
      try {
        return textResult(await deps.runSkill(skill, input ?? ""));
      } catch (error) {
        return errorResult(`Skill "${name}" failed: ${failureMessage(error)}`);
      }
    },
  );

  for (const skill of deps.skills()) {
    const toolName = skillToolName(skill.name, taken);
    server.registerTool(
      toolName,
      {
        description: describeSkill(skill),
        inputSchema: { input: z.string().optional().describe("task text handed to the skill as {{input}}") },
      },
      async ({ input }) => {
        try {
          return textResult(await deps.runSkill(skill, input ?? ""));
        } catch (error) {
          return errorResult(`Skill "${skill.name}" failed: ${failureMessage(error)}`);
        }
      },
    );
  }

  return server;
}

export async function runSkillMcpServer(): Promise<void> {
  const config = loadConfig();
  const infra = createSharedInfra(config);
  const runtime = createRoutineRuntime({
    llm: infra.llm,
    tools: infra.tools,
    skillRegistry: infra.skillRegistry,
  });
  const server = createSkillMcpServer({
    skills: () => infra.skillRegistry.list(),
    getSkill: (name) => infra.skillRegistry.get(name),
    runSkill: async (skill, input) => {
      if (skill.steps && skill.steps.length > 0) {
        const result = await runRoutine(skill, runtime, input ? { input } : undefined);
        infra.skillRegistry.incrementUsage(skill.name);
        if (!result.ok) throw new Error(renderRoutineRun(skill, result));
        return result.finalOutput;
      }
      const prompt = input ? `${skill.prompt}\n\nInput: ${input}` : skill.prompt;
      const text = await runtime.complete(prompt);
      infra.skillRegistry.incrementUsage(skill.name);
      return text;
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] ntox skill server ready on stdio (skill_list, skill_run, one tool per skill)");
}
