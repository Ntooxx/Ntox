import { describe, it, expect } from "vitest";
import {
  objectiveScoreFromResult,
  objectiveEvidenceFromResult,
  meaningfulObjective,
  hasSufficientObjectiveEvidence,
  buildEvidenceProvenance,
  MIN_OBJECTIVE_HITS,
} from "./evidence.js";

describe("evidence adapter", () => {
  it("maps an ObjectiveResult score into the signed ledger range", () => {
    expect(objectiveScoreFromResult({ passed: true, score: 1, detail: "" })).toBe(1);
    expect(objectiveScoreFromResult({ passed: true, score: 0.6, detail: "" })).toBeCloseTo(0.2);
    expect(objectiveScoreFromResult({ passed: false, score: 0, detail: "" })).toBe(-1);
  });

  it("pairs the signed score with its provenance", () => {
    const provenance = buildEvidenceProvenance({ evaluator: "factRecall", artifactRef: "task-1", now: () => 99 });
    const evidence = objectiveEvidenceFromResult({ passed: true, score: 0.8, detail: "" }, provenance);
    expect(evidence.score).toBeCloseTo(0.6);
    expect(evidence.provenance).toBe(provenance);
    expect(evidence.provenance.evaluator).toBe("factRecall");
  });

  it("considers only meaningful magnitudes as evidence", () => {
    expect(meaningfulObjective(0.9)).toBe(true);
    expect(meaningfulObjective(-0.9)).toBe(true);
    expect(meaningfulObjective(0.1)).toBe(false);
    expect(meaningfulObjective(0)).toBe(false);
  });

  it("requires a minimum number of objective hits for promotion", () => {
    expect(hasSufficientObjectiveEvidence(undefined)).toBe(false);
    expect(hasSufficientObjectiveEvidence(MIN_OBJECTIVE_HITS - 1)).toBe(false);
    expect(hasSufficientObjectiveEvidence(MIN_OBJECTIVE_HITS)).toBe(true);
  });

  it("builds provenance with evaluator and optional artifact", () => {
    const now = () => 1234;
    const provenance = buildEvidenceProvenance({ evaluator: "command", artifactRef: "npm test", now });
    expect(provenance.evaluator).toBe("command");
    expect(provenance.artifactRef).toBe("npm test");
    expect(provenance.timestamp).toBe(1234);
    expect(buildEvidenceProvenance({ evaluator: "exact", now }).artifactRef).toBeUndefined();
  });
});
