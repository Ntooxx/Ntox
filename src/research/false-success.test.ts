import { describe, it, expect } from "vitest";
import { checkForSurfaceReasoning } from "./false-success.js";
import type { CognitiveTrace } from "../types/index.js";

function makeTrace(finalAnswer: string, selfCritique: string = "", assumptions: string[] = ["some assumption"]): CognitiveTrace {
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

describe("checkForSurfaceReasoning", () => {
  it("flags shallow answers with high surface-to-depth ratio", () => {
    const shallow = makeTrace("Therefore, thus, clearly, obviously, it follows that this is the answer.");
    const result = checkForSurfaceReasoning(shallow);
    expect(result.isSurface).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("passes answers with deep reasoning", () => {
    const deep = makeTrace(
      "The reason is because the underlying mechanism involves feedback loops. However, we must consider the counterargument. Fundamentally, this implies a first-principles approach."
    );
    const result = checkForSurfaceReasoning(deep);
    expect(result.isSurface).toBe(false);
  });

  it("flags answers with absent self-critique", () => {
    const trace = makeTrace("Therefore, thus, clearly this is correct.", "", []);
    const result = checkForSurfaceReasoning(trace);
    expect(result.isSurface).toBe(true);
    expect(result.details.some((d) => d.includes("Self-critique"))).toBe(true);
  });

  it("flags answers with no assumptions stated", () => {
    const trace = makeTrace("Therefore, thus, clearly this is correct.", "some critique", []);
    const result = checkForSurfaceReasoning(trace);
    expect(result.isSurface).toBe(true);
    expect(result.details.some((d) => d.includes("assumptions"))).toBe(true);
  });

  it("returns correct scores", () => {
    const result = checkForSurfaceReasoning(makeTrace("because, however, this implies a mechanism"));
    expect(result.surfaceScore).toBe(0);
    expect(result.depthScore).toBeGreaterThan(0);
  });

  it("does not flag short natural responses (greetings, thanks)", () => {
    const hello = makeTrace("Hey! What can I help with?");
    const thanks = makeTrace("You're welcome! Happy to help.");
    expect(checkForSurfaceReasoning(hello).isSurface).toBe(false);
    expect(checkForSurfaceReasoning(thanks).isSurface).toBe(false);
  });
});
