import { LLMClient } from "../core/llm.js";
import type { SkillDefinition } from "../types/index.js";

const LEARN_PROMPT = `You are a skill parser. The user wants to teach Ntox a new skill.

User's description: {DESCRIPTION}

Extract the skill definition as valid JSON. Return ONLY the JSON object, no extra text.

{
  "name": "<short kebab-case name like 'summarize-file'>",
  "description": "<one-line description>",
  "category": "<one of: utility, coding, learning, analysis, planning, creative, custom>",
  "prompt": "<detailed instructions for the AI on how to execute this skill. Be specific about steps, tools to use, and output format.>",
  "triggers": ["<list of 2-5 phrases that should trigger this skill>"],
  "tools": ["<list of tool names this skill needs, e.g. read, write, grep, bash, glob, ls, web_fetch, edit>"],
  "examples": ["<1-3 example user queries that would trigger this skill>"]
}

Make the triggers specific enough to avoid false matches but general enough to catch variations.
The prompt should be detailed step-by-step instructions for the AI.`;

export async function learnSkillFromDescription(
  llm: LLMClient,
  description: string
): Promise<SkillDefinition> {
  const prompt = LEARN_PROMPT.replace("{DESCRIPTION}", description);

  const messages = [{ role: "user" as const, content: prompt }];
  let fullText = "";

  try {
    const stream = llm.stream(messages, "");
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to call LLM for skill learning: ${msg}`, { cause: e });
  }

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse skill definition from LLM response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const skill: SkillDefinition = {
    name: String(parsed.name || description.slice(0, 30).replace(/\s+/g, "-").toLowerCase()),
    description: String(parsed.description || description.slice(0, 80)),
    category: String(parsed.category || "custom"),
    prompt: String(parsed.prompt || description),
    triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [description.slice(0, 20)],
    tools: Array.isArray(parsed.tools) ? parsed.tools : [],
    examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  };

  return skill;
}
