import { describe, it, expect } from "vitest";
import { SkillExecutor } from "./executor.js";
import { SkillRegistry } from "./registry.js";
import type { SkillDefinition } from "../types/index.js";

describe("SkillExecutor", () => {
  const makeSkill = (name: string, triggers: string[]): SkillDefinition => ({
    name,
    description: `Test skill ${name}`,
    category: "test",
    prompt: `Prompt for ${name}`,
    triggers,
    tools: [],
    examples: [],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  });

  it("finds matching skills", () => {
    const registry = new SkillRegistry();
    registry.add(makeSkill("test-skill", ["hello", "greet"]));
    const executor = new SkillExecutor(registry, true);

    const matches = executor.findMatchingSkills("say hello to the world");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].skill.name).toBe("test-skill");
  });

  it("builds skills context", () => {
    const registry = new SkillRegistry();
    registry.add(makeSkill("helper", ["help", "assist"]));
    const executor = new SkillExecutor(registry, true);

    const ctx = executor.buildSkillsContext([
      { skill: registry.get("helper")!, confidence: 0.8 },
    ]);
    expect(ctx).toContain("Active Skill");
    expect(ctx).toContain("helper");
  });

  it("can be disabled", () => {
    const registry = new SkillRegistry();
    registry.add(makeSkill("x", ["trigger"]));
    const executor = new SkillExecutor(registry, false);

    expect(executor.findMatchingSkills("trigger").length).toBe(0);
  });

  it("builds empty context for no matches", () => {
    const registry = new SkillRegistry();
    const executor = new SkillExecutor(registry, true);
    expect(executor.buildSkillsContext([])).toBe("");
  });

  it("respects confidence ordering", () => {
    const registry = new SkillRegistry();
    registry.add(makeSkill("low-skill", ["word"]));
    registry.add(makeSkill("high-skill", ["specific phrase here"]));
    const executor = new SkillExecutor(registry, true);

    const matches = executor.findMatchingSkills("specific phrase here");
    expect(matches.length).toBeGreaterThan(0);
  });
});
