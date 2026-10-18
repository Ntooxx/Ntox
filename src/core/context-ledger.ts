import type { ContextBudgetLedger } from "../types/index.js";

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildContextBudgetLedger(parts: {
  system: string;
  strategy: string;
  cognition: string;
  memory: string;
  theory: string;
  mistakes: string;
  user: string;
  plan: string;
  narrative: string;
  mentalModel: string;
  executive: string;
  skills: string;
  search: string;
  mode: string;
  session: string;
  time: string;
  full: string;
}): ContextBudgetLedger {
  return {
    system: approxTokens(parts.system),
    strategy: approxTokens(parts.strategy),
    cognition: approxTokens(parts.cognition),
    memory: approxTokens(parts.memory),
    theory: approxTokens(parts.theory),
    mistakes: approxTokens(parts.mistakes),
    user: approxTokens(parts.user),
    plan: approxTokens(parts.plan),
    narrative: approxTokens(parts.narrative),
    mentalModel: approxTokens(parts.mentalModel),
    executive: approxTokens(parts.executive),
    skills: approxTokens(parts.skills),
    search: approxTokens(parts.search),
    mode: approxTokens(parts.mode),
    session: approxTokens(parts.session),
    time: approxTokens(parts.time),
    toolResults: 0,
    total: approxTokens(parts.full),
  };
}

export interface BudgetedSection {
  name: string;
  text: string;
  priority: number;
}

export interface AssembledPrompt {
  prompt: string;
  included: string[];
  dropped: string[];
  usedTokens: number;
}

export function assembleBudgetedSystemPrompt(
  base: string,
  sections: BudgetedSection[],
  budgetTokens: number,
): AssembledPrompt {
  const candidates = sections.filter((s) => s.text).sort((a, b) => b.priority - a.priority);
  let used = approxTokens(base);
  const included = new Set<string>();
  const dropped: string[] = [];

  for (const section of candidates) {
    const cost = approxTokens(section.text);
    if (used + cost > budgetTokens && included.size > 0) {
      dropped.push(section.name);
      continue;
    }
    included.add(section.name);
    used += cost;
  }

  const prompt = [base, ...candidates.filter((s) => included.has(s.name)).map((s) => s.text)].join("");
  return { prompt, included: [...included], dropped, usedTokens: used };
}

export function assembleSelectedSystemPrompt(
  base: string,
  sections: BudgetedSection[],
  selected: Set<string>,
): AssembledPrompt {
  const includedSections = sections
    .filter((s) => s.text && selected.has(s.name))
    .sort((a, b) => b.priority - a.priority);
  const dropped = sections.filter((s) => s.text && !selected.has(s.name)).map((s) => s.name);
  const prompt = [base, ...includedSections.map((s) => s.text)].join("");
  let usedTokens = approxTokens(base);
  for (const section of includedSections) usedTokens += approxTokens(section.text);
  return { prompt, included: includedSections.map((s) => s.name), dropped, usedTokens };
}

export function sectionTokenCost(text: string): number {
  return approxTokens(text);
}
