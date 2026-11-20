import type { ProcedureStep, ProcedureStore } from "./procedure-store.js";

export interface ProposeCandidateInput {
  store: ProcedureStore;
  taskId: string;
  userMessage: string;
  steps: ProcedureStep[];
  learnedScope: string;
  minSteps?: number;
}

export interface ProposeCandidateResult {
  proposed: boolean;
  procedureId?: string;
  reason: string;
}

function candidateName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "learned-procedure";
}

/**
 * Agent-side candidate proposal. This is deliberately a one-way, append-only path:
 * the agent may record that a sequence of steps worked, but the store's promotion
 * gate and the harness private key remain the only way to reach `verified`.
 * No signing capability and no verification API are referenced here.
 */
export function proposeProcedureCandidate(input: ProposeCandidateInput): ProposeCandidateResult {
  const minSteps = Math.max(2, input.minSteps ?? 2);
  if (input.steps.length < minSteps) {
    return { proposed: false, reason: `needs at least ${minSteps} successful tool steps` };
  }
  const name = candidateName(input.userMessage);
  if (input.store.list().some((procedure) => procedure.name === name)) {
    return { proposed: false, reason: "candidate with this name already exists" };
  }
  const procedure = input.store.addProcedure({
    name,
    description: `${input.taskId}: ${input.userMessage}`.slice(0, 200),
    steps: input.steps.slice(0, 20),
    prerequisites: [],
    scope: { applies: [], doesNotApply: [] },
    parameters: [],
    learnedScope: input.learnedScope,
  });
  return { proposed: true, procedureId: procedure.id, reason: `candidate ${procedure.id} awaits harness verification` };
}
