import type { LLMClient } from "../core/llm.js";
import type { AgentTurnTrace, SkillDefinition } from "../types/index.js";
import { authorSkillFromStruggle, findTriggerConflict, shouldAuthorSkillOnStruggle } from "./auto-learner.js";
import type { SkillRegistry } from "./registry.js";

export const MAX_SKILL_AUTHORS_PER_SESSION = 3;

export interface SkillAuthorRuntime {
  skillAuthorTurn: number;
  lastSkillAuthorTurn: number | null;
  skillAuthorsThisSession: number;
}

export interface SelfAuthorInput {
  llm: LLMClient;
  registry: Pick<SkillRegistry, "list" | "add">;
  trace: AgentTurnTrace;
  fullResponse: string;
  corrected: boolean;
  falseSuccess: boolean;
  toolFailure: boolean;
  runtime: SkillAuthorRuntime;
}

/** Persists a reusable skill after a struggling turn. No human confirmation step:
 *  the struggle gate, cooldown and trigger-conflict check are the safeguards. */
export async function maybeAuthorSkillOnStruggle(input: SelfAuthorInput): Promise<SkillDefinition | null> {
  const { trace, runtime } = input;
  runtime.skillAuthorTurn += 1;

  const toolFailures = trace.toolCalls.filter((call) => call.success === false).length + (input.toolFailure ? 1 : 0);
  const gate = shouldAuthorSkillOnStruggle({
    userInput: trace.userInput,
    response: input.fullResponse,
    toolCalls: trace.toolCalls,
    corrected: input.corrected,
    falseSuccess: input.falseSuccess,
    turnNumber: runtime.skillAuthorTurn,
    turnsSinceLastProposal:
      runtime.lastSkillAuthorTurn === null ? null : runtime.skillAuthorTurn - runtime.lastSkillAuthorTurn,
    toolFailures,
    retries: trace.retries,
    critiqueGaps: trace.modelCritique?.gaps ?? 0,
  });
  if (!gate.ok || runtime.skillAuthorsThisSession >= MAX_SKILL_AUTHORS_PER_SESSION) return null;

  const candidate = await authorSkillFromStruggle(input.llm, {
    userInput: trace.userInput,
    response: input.fullResponse,
    toolCalls: trace.toolCalls,
    corrected: input.corrected,
    falseSuccess: input.falseSuccess,
    toolFailures,
    retries: trace.retries,
    critiqueGaps: trace.modelCritique?.gaps ?? 0,
  });
  if (!candidate) return null;
  if (findTriggerConflict(candidate, input.registry.list())) return null;

  input.registry.add(candidate);
  runtime.lastSkillAuthorTurn = runtime.skillAuthorTurn;
  runtime.skillAuthorsThisSession += 1;
  trace.authoredSkill = candidate.name;
  return candidate;
}
