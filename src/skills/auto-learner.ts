import { LLMClient } from "../core/llm.js";
import type { AgentToolTrace, SkillDefinition } from "../types/index.js";

const PROPOSAL_TURN_COOLDOWN = 20;
export const MAX_SKILL_PROPOSALS_PER_SESSION = 3;
const COMPACT_ARGS_MAX = 80;
const RESPONSE_EXCERPT_MAX = 6000;

export interface SkillTurnContext {
  userInput: string;
  response: string;
  toolCalls: AgentToolTrace[];
  corrected: boolean;
  falseSuccess: boolean;
  turnNumber: number;
  turnsSinceLastProposal: number | null;
}

export type SkillGateCheck = { ok: true } | { ok: false; reason: string };

export function shouldProposeSkill(ctx: SkillTurnContext): SkillGateCheck {
  if (ctx.corrected) return { ok: false, reason: "the turn received a correction" };
  if (ctx.falseSuccess) return { ok: false, reason: "a false-success retry ran" };
  const completed = ctx.toolCalls.filter((call) => call.success === true);
  if (completed.length < 2) return { ok: false, reason: "fewer than two successful tool calls" };
  if (new Set(completed.map((call) => call.name)).size < 2) {
    return { ok: false, reason: "only one kind of tool was used" };
  }
  if (ctx.userInput.trim().length < 15) return { ok: false, reason: "the request is trivial" };
  if (ctx.response.trim().length < 200) return { ok: false, reason: "the response is too shallow to teach from" };
  if (ctx.turnsSinceLastProposal !== null && ctx.turnsSinceLastProposal < PROPOSAL_TURN_COOLDOWN) {
    return {
      ok: false,
      reason: `${ctx.turnsSinceLastProposal} turns since the last proposal (cooldown ${PROPOSAL_TURN_COOLDOWN})`,
    };
  }
  return { ok: true };
}

const AUTHOR_TURN_COOLDOWN = 12;

export interface SkillStruggleContext extends SkillTurnContext {
  toolFailures: number;
  retries: number;
  critiqueGaps: number;
}

export function shouldAuthorSkillOnStruggle(ctx: SkillStruggleContext): SkillGateCheck {
  const struggled =
    ctx.falseSuccess || ctx.corrected || ctx.toolFailures > 0 || ctx.retries > 0 || ctx.critiqueGaps > 0;
  if (!struggled) return { ok: false, reason: "no struggle signal in this turn" };
  if (ctx.userInput.trim().length < 15) return { ok: false, reason: "the request is trivial" };
  if (ctx.turnsSinceLastProposal !== null && ctx.turnsSinceLastProposal < AUTHOR_TURN_COOLDOWN) {
    return {
      ok: false,
      reason: `${ctx.turnsSinceLastProposal} turns since the last authored skill (cooldown ${AUTHOR_TURN_COOLDOWN})`,
    };
  }
  return { ok: true };
}

const STRUGGLE_PROMPT = `You are a skill curator for Ntox, a CLI agent. The agent STRUGGLED on this exchange.
Write a reusable skill that captures the correct procedure so the same struggle is avoided next time.

Failure signals: false-success retry={FALSE_SUCCESS}, user correction={CORRECTED}, failed tool calls={TOOL_FAILURES}, retries={RETRIES}, critique gaps={CRITIQUE_GAPS}

User request: {REQUEST}

Tools used (in order):
{TOOL_TRACE}

Final response (excerpt):
{RESPONSE}

Rules:
- Extract the repeatable procedure that SHOULD have been followed: which tools, which order, and what to verify.
- Focus on the failure: if a tool failed, record how to detect and recover from it.
- The prompt field must be written as instructions TO Ntox.
- One-off answers and generic chat are not skills.
- Return ONLY JSON, no extra text.
{"skip": true} if there is no reusable lesson.
Otherwise:
{
  "name": "<short kebab-case name>",
  "description": "<one-line description>",
  "category": "custom",
  "prompt": "<detailed step-by-step instructions for the AI>",
  "triggers": ["<2-5 phrases that should activate this skill>"],
  "tools": ["<tool names needed>"],
  "examples": ["<1-3 example queries>"]
}`;

const PROPOSAL_PROMPT = `You are a skill curator for Ntox, a CLI agent. Review one completed exchange and decide whether it shows a repeatable procedure worth saving as a reusable skill.

User request: {REQUEST}

Tools used (in order):
{TOOL_TRACE}

Final response (excerpt):
{RESPONSE}

Rules:
- Save a skill only for multi-step, repeatable procedures: steps that solve a whole class of tasks again later, including which tools to call and in what order.
- One-off answers, generic chat, and anything the built-in skills already cover (summarizing a file, explaining code, finding bugs) are not skills.
- The prompt field must be written as instructions TO Ntox.
- Return ONLY JSON, no extra text.

If it is not worth saving:
{"skip": true}

If it is worth saving:
{
  "name": "<short kebab-case name>",
  "description": "<one-line description>",
  "category": "<one of: utility, coding, learning, analysis, planning, creative, custom>",
  "prompt": "<detailed step-by-step instructions for the AI>",
  "triggers": ["<2-5 phrases that should activate this skill>"],
  "tools": ["<tool names needed>"],
  "examples": ["<1-3 example queries>"]
}`;

function compactToolArgs(args: Record<string, unknown>): string {
  const preferred = args.command ?? args.path ?? args.query ?? args.url ?? args.pattern;
  const value = preferred !== undefined ? preferred : Object.values(args)[0];
  if (typeof value !== "string") return "[args]";
  return value.length > COMPACT_ARGS_MAX ? value.slice(0, COMPACT_ARGS_MAX - 3) + "..." : value;
}

interface ProposalParse {
  skip?: boolean;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  prompt?: unknown;
  triggers?: unknown;
  tools?: unknown;
  examples?: unknown;
}

async function generateSkillFromPrompt(llm: LLMClient, prompt: string): Promise<SkillDefinition | null> {
  let fullText = "";
  try {
    const stream = llm.stream([{ role: "user" as const, content: prompt }], "");
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }
  } catch {
    return null;
  }

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: ProposalParse;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (parsed.skip || typeof parsed.name !== "string" || typeof parsed.prompt !== "string") return null;

  const name = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  if (!name) return null;

  const triggers = (Array.isArray(parsed.triggers) ? parsed.triggers : [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 6);
  if (triggers.length === 0) return null;

  return {
    name,
    description: typeof parsed.description === "string" ? parsed.description : name,
    category: typeof parsed.category === "string" ? parsed.category : "custom",
    prompt: parsed.prompt,
    triggers,
    tools: Array.isArray(parsed.tools) ? parsed.tools.map(String).slice(0, 8) : [],
    examples: Array.isArray(parsed.examples) ? parsed.examples.map(String).slice(0, 3) : [],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  };
}

export async function proposeSkillFromTurn(
  llm: LLMClient,
  ctx: Pick<SkillTurnContext, "userInput" | "response" | "toolCalls">,
): Promise<SkillDefinition | null> {
  const toolTrace = ctx.toolCalls.map((call) => `- ${call.name}: ${compactToolArgs(call.args)}`).join("\n");
  const prompt = PROPOSAL_PROMPT.replace("{REQUEST}", ctx.userInput.slice(0, 500))
    .replace("{TOOL_TRACE}", toolTrace.slice(0, 3000))
    .replace("{RESPONSE}", ctx.response.slice(0, RESPONSE_EXCERPT_MAX));
  return generateSkillFromPrompt(llm, prompt);
}

export async function authorSkillFromStruggle(
  llm: LLMClient,
  ctx: Pick<
    SkillStruggleContext,
    "userInput" | "response" | "toolCalls" | "corrected" | "falseSuccess" | "toolFailures" | "retries" | "critiqueGaps"
  >,
): Promise<SkillDefinition | null> {
  const toolTrace = ctx.toolCalls
    .map((call) => `- ${call.name} (${call.success === false ? "FAILED" : "ok"}): ${compactToolArgs(call.args)}`)
    .join("\n");
  const prompt = STRUGGLE_PROMPT.replace("{FALSE_SUCCESS}", String(ctx.falseSuccess))
    .replace("{CORRECTED}", String(ctx.corrected))
    .replace("{TOOL_FAILURES}", String(ctx.toolFailures))
    .replace("{RETRIES}", String(ctx.retries))
    .replace("{CRITIQUE_GAPS}", String(ctx.critiqueGaps))
    .replace("{REQUEST}", ctx.userInput.slice(0, 500))
    .replace("{TOOL_TRACE}", toolTrace.slice(0, 3000))
    .replace("{RESPONSE}", ctx.response.slice(0, RESPONSE_EXCERPT_MAX));
  const skill = await generateSkillFromPrompt(llm, prompt);
  return skill ? { ...skill, category: "self-authored" } : null;
}

export function findTriggerConflict(candidate: SkillDefinition, existing: SkillDefinition[]): string | null {
  const name = candidate.name.toLowerCase();
  for (const skill of existing) {
    if (skill.name.toLowerCase() === name) return skill.name;
    for (const trigger of candidate.triggers) {
      for (const existingTrigger of skill.triggers) {
        if (existingTrigger.toLowerCase().trim() === trigger.toLowerCase().trim()) return skill.name;
      }
    }
  }
  return null;
}

export function renderSkillProposal(skill: SkillDefinition): string {
  return [
    "This was solved in a repeatable way. Save it as a skill?",
    "",
    `  name:     ${skill.name}`,
    `  does:     ${skill.description}`,
    `  triggers: ${skill.triggers.join(", ")}`,
    `  tools:    ${skill.tools.join(", ") || "none"}`,
    "",
    `Reply /skill save ${skill.name} to add it, or ignore this message.`,
  ].join("\n");
}
