import { describe, it, expect, beforeEach } from "vitest";
import { CognitiveKernel } from "./kernel.js";
import { SkillRegistry } from "../skills/registry.js";

describe("CognitiveKernel", () => {
  let kernel: CognitiveKernel;
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    kernel = new CognitiveKernel(registry);
  });

  it("returns empty context when disabled", () => {
    kernel.setEnabled(false);
    const result = kernel.process("explain quantum computing");
    expect(result.cognitiveContext).toBe("");
    expect(result.patterns.length).toBe(0);
  });

  it("compresses query to primitive", () => {
    const result = kernel.process("write a Python function to sort a list");
    expect(result.primitive.domains).toContain("python");
    expect(["code", "create"]).toContain(result.primitive.action);
  });

  it("detects multiple domains", () => {
    const result = kernel.process("build a JavaScript API with a PostgreSQL database");
    expect(result.primitive.domains.length).toBeGreaterThanOrEqual(2);
  });

  it("measures complexity", () => {
    const simple = kernel.process("what is 2+2");
    const complex = kernel.process("explain the trade-offs between microservices and monolith architecture for a high-traffic e-commerce platform with real-time inventory management");
    expect(complex.primitive.complexity).toBeGreaterThan(simple.primitive.complexity);
  });

  it("returns critique with default scores when no response", () => {
    const result = kernel.process("test query");
    expect(result.critique.completeness).toBeGreaterThanOrEqual(0);
    expect(result.critique.accuracy).toBeGreaterThanOrEqual(0);
  });

  it("retrieves matching patterns when enabled", () => {
    kernel.setEnabled(true);
    const result = kernel.process("write Python code for data analysis");
    expect(result.primitive.domains).toContain("python");
  });

  it("review returns gaps and correction prompt", () => {
    kernel.setEnabled(true);
    const review = kernel.review(
      "explain quantum mechanics and thermodynamics in detail with mathematical proofs and examples",
      "I don't know how. I can't determine the answer. Not certain about this at all."
    );
    expect(review.gaps.length).toBeGreaterThan(0);
  });

  it("returns no retry when response is good", () => {
    kernel.setEnabled(true);
    const review = kernel.review(
      "what is Python",
      "Python is a high-level programming language created by Guido van Rossum. It emphasizes code readability and supports multiple programming paradigms."
    );
    expect(review.shouldRetry).toBe(false);
  });

  it("exposes sub-components", () => {
    expect(kernel.getSpace()).toBeDefined();
    expect(kernel.getPatterns()).toBeDefined();
    expect(kernel.getCompressor()).toBeDefined();
    expect(kernel.getCritic()).toBeDefined();
  });
});
