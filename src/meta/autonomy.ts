/**
 * Autonomy governance: budget enforcement and the identity-vs-calibration
 * guardrail that distinguishes emerging personality from harmful drift.
 */
export interface AutonomyBudget {
  maxTokensPerCycle: number;
}

/** Whether a cycle stays within its token budget. */
export function enforceBudget(spentTokens: number, budget: AutonomyBudget): boolean {
  return spentTokens >= 0 && spentTokens <= budget.maxTokensPerCycle;
}

export interface GuardrailInput {
  identityDivergence: number;
  calibrationEce: number;
  divergenceTarget?: number;
  eceCeiling?: number;
}

export interface GuardrailVerdict {
  allowed: boolean;
  reason: string;
}

const DEFAULT_DIVERGENCE_TARGET = 0.4;
const DEFAULT_ECE_CEILING = 0.15;

/**
 * Allow autonomous expansion while calibration is healthy. If confidence is
 * worsening (ECE above ceiling) while identity divergence is already above
 * target, it is drift, not personality, and autonomous expansion is blocked.
 */
export function calibrationGuardrail(input: GuardrailInput): GuardrailVerdict {
  const divergenceTarget = input.divergenceTarget ?? DEFAULT_DIVERGENCE_TARGET;
  const eceCeiling = input.eceCeiling ?? DEFAULT_ECE_CEILING;

  const eceOk = input.calibrationEce < eceCeiling;
  const divergent = input.identityDivergence > divergenceTarget;

  if (!eceOk && divergent) {
    return {
      allowed: false,
      reason: `Drift guardrail: calibration ECE ${input.calibrationEce.toFixed(3)} >= ${eceCeiling} while identity divergence ${input.identityDivergence.toFixed(3)} > ${divergenceTarget}`,
    };
  }
  if (!eceOk) {
    return {
      allowed: true,
      reason: `Calibration below ceiling (ECE ${input.calibrationEce.toFixed(3)}); identity not yet divergent, expansion monitored`,
    };
  }
  return {
    allowed: true,
    reason: `Calibration healthy (ECE ${input.calibrationEce.toFixed(3)}); identity divergence ${input.identityDivergence.toFixed(3)}`,
  };
}
