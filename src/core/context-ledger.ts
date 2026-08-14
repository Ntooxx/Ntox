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
