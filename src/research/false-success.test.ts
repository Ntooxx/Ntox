import { describe, it, expect } from "vitest";
import { checkForSurfaceReasoning } from "./false-success.js";
import type { CognitiveTrace, CritiqueResult } from "../types/index.js";

function makeTrace(
  finalAnswer: string,
  selfCritique: string = "The answer addresses the main mechanism but ignores the failure case.",
  assumptions: string[] = ["some assumption"],
): CognitiveTrace {
  return {
    problemRepresentation: "test question",
    assumptions,
    unknowns: [],
    reasoningStrategy: "",
    strategyJustification: "",
    evidenceUsed: [],
    predictions: [],
    selfCritique,
    critiqueResolution: "",
    finalAnswer,
    abstractionExtracted: "",
    tokenCount: finalAnswer.length,
  };
}

function makeCritique(overrides: Partial<CritiqueResult> = {}): CritiqueResult {
  return {
    completeness: 0.8,
    accuracy: 0.9,
    clarity: 0.8,
    gaps: [],
    strengthened: true,
    ...overrides,
  };
}

describe("checkForSurfaceReasoning", () => {
  it("flags shallow answers when the critic scores completeness low", () => {
    const shallow = makeTrace("A brief answer with no mechanism.");
    const result = checkForSurfaceReasoning(shallow, makeCritique({ completeness: 0.2 }));
    expect(result.isSurface).toBe(true);
    expect(result.details.some((d) => d.includes("completeness"))).toBe(true);
  });

  it("flags shallow answers when the critic scores accuracy low", () => {
    const result = checkForSurfaceReasoning(makeTrace("Some answer."), makeCritique({ accuracy: 0.3 }));
    expect(result.isSurface).toBe(true);
    expect(result.details.some((d) => d.includes("accuracy"))).toBe(true);
  });

  it("surfaces critic gaps in details", () => {
    const result = checkForSurfaceReasoning(
      makeTrace("Some answer."),
      makeCritique({ gaps: ["Response is too brief for the query complexity"] }),
    );
    expect(result.isSurface).toBe(false);
    expect(result.details).toContain("Response is too brief for the query complexity");
  });

  it("passes answers with high critic scores", () => {
    const deep = makeTrace(
      "The answer is 42 because the recurrence halves the search space each step. However, this assumes sorted input; the limitation is unsorted data.",
    );
    const result = checkForSurfaceReasoning(deep, makeCritique());
    expect(result.isSurface).toBe(false);
    expect(result.depthScore).toBeGreaterThan(result.surfaceScore);
  });

  it("reports structural diagnostics without critic scores but does not flag", () => {
    const trace = makeTrace("Some answer.", "", []);
    const result = checkForSurfaceReasoning(trace);
    expect(result.isSurface).toBe(false);
    expect(result.details.some((d) => d.includes("Self-critique"))).toBe(true);
    expect(result.details.some((d) => d.includes("assumptions"))).toBe(true);
  });

  it("does not flag short natural responses (greetings, thanks)", () => {
    const hello = makeTrace("Hey! What can I help with?");
    const thanks = makeTrace("You're welcome! Happy to help.");
    expect(checkForSurfaceReasoning(hello, makeCritique()).isSurface).toBe(false);
    expect(checkForSurfaceReasoning(thanks, makeCritique()).isSurface).toBe(false);
  });
});
