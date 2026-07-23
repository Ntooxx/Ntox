import { describe, it, expect } from "vitest";
import { classifyQuery, getStrategyPrompt, getStrategyLabel } from "./strategist.js";

describe("classifyQuery", () => {
  it("detects coding queries", () => {
    expect(classifyQuery("write a function to sort an array")).toBe("coding");
    expect(classifyQuery("debug this python script")).toBe("coding");
    expect(classifyQuery("npm install fails with error")).toBe("coding");
    expect(classifyQuery("optimize this SQL query")).toBe("coding");
  });

  it("detects factual queries", () => {
    expect(classifyQuery("what is the capital of France")).toBe("factual");
    expect(classifyQuery("who invented the light bulb")).toBe("factual");
    expect(classifyQuery("explain the theory of relativity")).toBe("factual");
    expect(classifyQuery("define photosynthesis")).toBe("factual");
  });

  it("detects creative queries", () => {
    expect(classifyQuery("write a story about a dragon")).toBe("creative");
    expect(classifyQuery("suggest a name for my project")).toBe("creative");
    expect(classifyQuery("design a logo concept")).toBe("creative");
  });

  it("detects analysis queries", () => {
    expect(classifyQuery("compare the advantages of different approaches")).toBe("analysis");
    expect(classifyQuery("pros and cons of this design pattern")).toBe("analysis");
    expect(classifyQuery("evaluate the trade-offs of this architecture")).toBe("analysis");
  });

  it("detects planning queries", () => {
    expect(classifyQuery("give me the steps and roadmap for the deployment")).toBe("planning");
    expect(classifyQuery("outline the phases and timeline for the migration")).toBe("planning");
    expect(classifyQuery("I need a tutorial guide for setting up this workflow")).toBe("planning");
  });

  it("returns general for undetected queries", () => {
    expect(classifyQuery("hello")).toBe("general");
    expect(classifyQuery("thanks")).toBe("general");
    expect(classifyQuery("ok")).toBe("general");
  });

  it("scores overlapping categories correctly", () => {
    const r = classifyQuery("write and analyze code for the database query");
    expect(r).toBe("coding");
  });
});

describe("getStrategyPrompt", () => {
  it("returns coding strategy", () => {
    expect(getStrategyPrompt("coding")).toContain("Think step-by-step");
  });

  it("returns factual strategy", () => {
    expect(getStrategyPrompt("factual")).toContain("Prioritize accuracy");
  });

  it("returns creative strategy", () => {
    expect(getStrategyPrompt("creative")).toContain("Explore multiple options");
  });

  it("returns analysis strategy", () => {
    expect(getStrategyPrompt("analysis")).toContain("Structure the analysis");
  });

  it("returns planning strategy", () => {
    expect(getStrategyPrompt("planning")).toContain("Break down into concrete");
  });

  it("returns general strategy", () => {
    expect(getStrategyPrompt("general")).toContain("Be concise and direct");
  });
});

describe("getStrategyLabel", () => {
  it("returns label for each type", () => {
    expect(getStrategyLabel("coding")).toBe("coding");
    expect(getStrategyLabel("general")).toBe("general");
  });
});
