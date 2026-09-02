import { describe, it, expect } from "vitest";
import { Critic } from "./critique.js";
import type { PrimitiveRepresentation } from "../types/index.js";

function makePrimitive(overrides: Partial<PrimitiveRepresentation> = {}): PrimitiveRepresentation {
  return {
    domains: ["programming"],
    action: "explain",
    complexity: 0.5,
    conceptualSummary: "explain problem involving programming",
    ...overrides,
  };
}

describe("Critic", () => {
  it("returns default scores when disabled", () => {
    const critic = new Critic(false);
    const result = critic.critique("query", "response", makePrimitive());
    expect(result.completeness).toBe(0.5);
    expect(result.strengthened).toBe(true);
  });

  it("flags response too brief for complexity", () => {
    const critic = new Critic();
    const primitive = makePrimitive({ complexity: 0.9 });
    const result = critic.critique(
      "Explain the entire architecture of a distributed system with consensus protocols",
      "Yes.",
      primitive
    );
    expect(result.completeness).toBeLessThan(0.5);
    expect(result.gaps.some((g) => g.includes("too brief"))).toBe(true);
  });

  it("flags missing domain coverage", () => {
    const critic = new Critic();
    const primitive = makePrimitive({ domains: ["python", "database"] });
    const result = critic.critique(
      "How do I use Python with PostgreSQL?",
      "You should use a computer.",
      primitive
    );
    expect(result.gaps.some((g) => g.includes("domains"))).toBe(true);
  });

  it("flags code action without code", () => {
    const critic = new Critic();
    const primitive = makePrimitive({ action: "code" });
    const result = critic.critique(
      "Write code to sort a list",
      "The quick brown fox jumps over the lazy dog. This is a simple sentence about nothing relevant.",
      primitive
    );
    expect(result.gaps.some((g) => g.includes("code"))).toBe(true);
  });

  it("flags explain action with too few sentences", () => {
    const critic = new Critic();
    const primitive = makePrimitive({ action: "explain" });
    const result = critic.critique(
      "Explain how TCP works",
      "TCP is a protocol.",
      primitive
    );
    expect(result.gaps.some((g) => g.includes("explain"))).toBe(true);
  });

  it("gives good scores for solid response", () => {
    const critic = new Critic();
    const primitive = makePrimitive({ domains: ["python"], action: "explain" });
    const result = critic.critique(
      "What is Python?",
      "Python is a high-level programming language known for its simplicity and readability. It supports multiple paradigms including object-oriented, functional, and procedural programming. Python is widely used in web development, data science, and automation.",
      primitive
    );
    expect(result.completeness).toBeGreaterThan(0.3);
    expect(result.accuracy).toBeGreaterThan(0.5);
    expect(result.gaps.length).toBe(0);
    expect(result.strengthened).toBe(true);
  });

  it("penalizes hedging language", () => {
    const critic = new Critic();
    const result = critic.critique(
      "What is X?",
      "I'm not sure, but I don't know, I can't determine the answer.",
      makePrimitive()
    );
    expect(result.accuracy).toBeLessThan(0.5);
  });

  it("clarity is high for moderate sentence length", () => {
    const critic = new Critic();
    const result = critic.critique(
      "query",
      "This is a clear and concise sentence. Another sentence that is well structured. A third sentence to round things out.",
      makePrimitive()
    );
    expect(result.clarity).toBeGreaterThanOrEqual(0.7);
  });
});
