import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MentalModel } from "../meta/mental-model.js";
import { IdentityStore } from "./identity.js";
import { attributePositionOutcome, promoteOpinions } from "./opinion.js";

function tempPair(): { model: MentalModel; identity: IdentityStore } {
  const dir = mkdtempSync(join(tmpdir(), "ntox-opinion-"));
  return {
    model: new MentalModel(join(dir, "mental-model.json")),
    identity: new IdentityStore({ path: join(dir, "identity.json") }),
  };
}

describe("promoteOpinions", () => {
  it("promotes repeatedly observed opinions to positions", () => {
    const { model, identity } = tempPair();
    for (let i = 0; i < 4; i++) {
      model.extractFromConversation("I think always write integration tests for APIs.");
    }
    const promoted = promoteOpinions(model, identity, { minMentions: 3 });
    expect(promoted.length).toBeGreaterThan(0);
    const position = identity.get().positions.find((p) => p.topic.startsWith("opinion:"));
    expect(position).toBeDefined();
    expect(position?.evidence[0]).toMatch(/^mental-model:/);
  });

  it("does not promote entries below the mention threshold", () => {
    const { model, identity } = tempPair();
    model.extractFromConversation("I think always write integration tests for APIs.");
    const promoted = promoteOpinions(model, identity, { minMentions: 3 });
    expect(promoted).toHaveLength(0);
  });

  it("skips topics whose existing position is already stronger", () => {
    const { model, identity } = tempPair();
    for (let i = 0; i < 4; i++) {
      model.extractFromConversation("I think always write integration tests for APIs.");
    }
    const first = promoteOpinions(model, identity, { minMentions: 3 });
    expect(first.length).toBeGreaterThan(0);
    const second = promoteOpinions(model, identity, { minMentions: 3 });
    expect(second).toHaveLength(0);
  });
});

describe("attributePositionOutcome", () => {
  it("strengthens a position on a helpful outcome", () => {
    const { identity } = tempPair();
    identity.addPosition("testing", "prefer property tests", 0.6);
    const updated = attributePositionOutcome(identity, "testing", true);
    expect(updated?.confidence).toBeGreaterThan(0.6);
  });

  it("challenges a position on a corrected outcome", () => {
    const { identity } = tempPair();
    identity.addPosition("testing", "prefer property tests", 0.6);
    const updated = attributePositionOutcome(identity, "testing", false);
    expect(updated?.confidence).toBeLessThan(0.6);
    expect(identity.get().revisionLog.some((r) => r.change.includes("challenged"))).toBe(true);
  });

  it("returns null for unknown topics", () => {
    const { identity } = tempPair();
    expect(attributePositionOutcome(identity, "missing", true)).toBeNull();
  });
});
