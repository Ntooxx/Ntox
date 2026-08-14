import { describe, it, expect } from "vitest";
import { formatPatternDetail, formatPatternOverview, formatTheoryDetail, formatTheoryOverview } from "./inspect.js";
import type { CognitivePattern } from "../types/index.js";

describe("inspect formatters", () => {
  it("formats theory overview and detail", () => {
    const snapshot = {
      observations: [{ id: "obs_1", description: "observation", domain: "programming", confidence: 0.4, timestamp: 0 }],
      patterns: [{ id: "pat_1", name: "pattern", generalization: "general", confidence: 0.3, timestamp: 0 }],
      theories: [{
        id: "theory_1",
        name: "Theory one",
        explanation: "This explains a repeated behavior.",
        predictions: ["future behavior repeats"],
        falsificationCriteria: "counterexample",
        confirmed: false,
        confidence: 0.25,
        timestamp: 0,
      }],
      metaTheories: [],
    };

    expect(formatTheoryOverview(snapshot)).toContain("theory_1");
    expect(formatTheoryDetail(snapshot, "theory_1")).toContain("predictions");
  });

  it("formats pattern overview and detail", () => {
    const patterns: CognitivePattern[] = [{
      id: "pat_1",
      name: "software-dev",
      domains: ["programming"],
      vector: [],
      activatedRules: [],
      reasoningTemplate: "test and verify",
      strength: 0.5,
      hitCount: 2,
      compileCount: 1,
      compiledTemplate: "",
      lastActivated: 0,
      created: 0,
    }];

    expect(formatPatternOverview(patterns)).toContain("software-dev");
    expect(formatPatternDetail(patterns, "pat_1")).toContain("test and verify");
  });
});
