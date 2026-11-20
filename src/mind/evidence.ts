import type { ObjectiveResult } from "../evaluation/objective-evaluators.js";
import type { EvidenceEvaluator, EvidenceProvenance } from "./types.js";

/** Minimum meaningful objective score magnitude (mirrors `isScoreMeaningful`). */
export const MIN_MEANINGFUL_SCORE = 0.2;
/** Objective hits required before a pattern may be promoted to a skill. */
export const MIN_OBJECTIVE_HITS = 3;

/** Map an `ObjectiveResult.score` (0..1) into the ledger's signed score range (-1..1). */
export function objectiveScoreFromResult(result: ObjectiveResult): number {
  return clamp(result.score * 2 - 1, -1, 1);
}

/** Whether a signed objective score carries enough signal to train or promote. */
export function meaningfulObjective(score: number): boolean {
  return Math.abs(score) >= MIN_MEANINGFUL_SCORE;
}

/** Has a pattern accumulated enough objective hits to be promoted. */
export function hasSufficientObjectiveEvidence(objectiveHits?: number): boolean {
  return (objectiveHits ?? 0) >= MIN_OBJECTIVE_HITS;
}

export function buildEvidenceProvenance(input: {
  evaluator: EvidenceEvaluator;
  artifactRef?: string;
  envFingerprint?: string;
  now?: () => number;
}): EvidenceProvenance {
  return {
    evaluator: input.evaluator,
    ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    ...(input.envFingerprint ? { envFingerprint: input.envFingerprint } : {}),
    timestamp: (input.now ?? Date.now)(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}