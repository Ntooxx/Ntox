import { describe, it, expect, beforeEach } from "vitest";
import { UserModel } from "./user-model.js";
import { writeFileSync } from "node:fs";
import { NTOX_DIR } from "../core/config.js";
import { join } from "node:path";

const PROFILE_PATH = join(NTOX_DIR, "user-model.json");

describe("UserModel", () => {
  let model: UserModel;

  beforeEach(() => {
    writeFileSync(PROFILE_PATH, JSON.stringify({ name: "", goals: [], expertise: {}, preferences: { verbosity: "balanced", technicalLevel: "intermediate", tone: "adaptive", codeExamples: "when-helpful" }, patterns: { averageMessageLength: 0, totalMessages: 0, correctionsReceived: 0, prefersCodeBlocks: false, prefersBulletPoints: false }, domains: [], closenessScore: 0, personalVocabulary: [], projectAssociations: [], moodHistory: [] }));
    model = new UserModel();
  });

  it("has default profile", () => {
    const profile = model.getProfile();
    expect(profile.preferences.verbosity).toBe("balanced");
    expect(profile.preferences.technicalLevel).toBe("intermediate");
    expect(profile.closenessScore).toBe(0);
  });

  it("sets name", () => {
    model.setName("Alice");
    expect(model.getProfile().name).toBe("Alice");
  });

  it("sets expertise", () => {
    model.setExpertise("programming", "advanced");
    expect(model.getProfile().expertise.programming).toBe("advanced");
  });

  it("adds goals", () => {
    const goal = model.addGoal("Learn Rust", "learning");
    expect(goal.description).toBe("Learn Rust");
    expect(goal.category).toBe("learning");
    expect(model.getActiveGoals().length).toBe(1);
  });

  it("updates goal progress", () => {
    const goal = model.addGoal("Complete project", "work");
    expect(model.getProfile().goals.length).toBe(1);
    expect(model.getProfile().goals[0].id).toBe(goal.id);
    model.updateGoalProgress(goal.id, 50);
    expect(model.getProfile().goals[0].progress).toBe(50);
  });

  it("extracts verbosity preference from conversation", () => {
    model.extractFromConversation("Give me a brief answer", false);
    expect(model.getProfile().preferences.verbosity).toBe("concise");
  });

  it("extracts technical level from conversation", () => {
    model.extractFromConversation("I'm an advanced Python developer", false);
    expect(model.getProfile().preferences.technicalLevel).toBe("expert");
  });

  it("builds user context string", () => {
    model.setName("Charlie");
    model.setExpertise("javascript", "expert");
    const ctx = model.buildUserContext();
    expect(ctx).toContain("Charlie");
    expect(ctx).toContain("javascript");
  });

  it("builds summary", () => {
    model.setName("Dana");
    const summary = model.getSummary();
    expect(summary).toContain("Dana");
  });

  it("handles corrections", () => {
    model.extractFromConversation("Actually, I prefer concise answers", true);
    const profile = model.getProfile();
    expect(profile.patterns.correctionsReceived).toBe(1);
  });
});
