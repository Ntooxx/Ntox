import { describe, it, expect } from "vitest";
import { CognitiveSpace } from "./cognitive-space.js";

describe("CognitiveSpace adaptive learning", () => {
  it("increases similarity for co-occurring domains and persists it", () => {
    const space = new CognitiveSpace();
    const before = space.getDomainRelationships("rust")["writing"];

    for (let i = 0; i < 5; i++) space.learnFromCoOccurrence(["rust", "writing"]);

    const after = new CognitiveSpace().getDomainRelationships("rust")["writing"];
    expect(after).toBeGreaterThan(before);
  });

  it("ignores unknown domains and single-domain queries", () => {
    const space = new CognitiveSpace();
    const before = JSON.stringify(space.getDomainRelationships("python"));

    space.learnFromCoOccurrence(["python"]);
    space.learnFromCoOccurrence(["unknown_a", "unknown_b"]);

    expect(JSON.stringify(new CognitiveSpace().getDomainRelationships("python"))).toBe(before);
  });
});
