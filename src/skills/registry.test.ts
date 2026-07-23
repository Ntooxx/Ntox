import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "./registry.js";
import { getBaseDir } from "../core/config.js";
import type { SkillDefinition } from "../types/index.js";

const skillsDir = join(getBaseDir(), "skills");

describe("SkillRegistry", () => {
  afterEach(() => {
    try { rmSync(skillsDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  const testSkill: SkillDefinition = {
    name: "custom-skill",
    description: "A custom test skill",
    category: "test",
    prompt: "Be helpful",
    triggers: ["test this", "run test"],
    tools: [],
    examples: [],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  };

  it("starts with built-in skills", () => {
    const r = new SkillRegistry();
    const skills = r.list();
    expect(skills.length).toBeGreaterThanOrEqual(3);
    expect(skills.some((s) => s.name === "summarize-file")).toBe(true);
    expect(skills.some((s) => s.name === "explain-code")).toBe(true);
    expect(skills.some((s) => s.name === "find-bugs")).toBe(true);
  });

  it("adds and retrieves custom skills", () => {
    const r = new SkillRegistry();
    r.add(testSkill);
    expect(r.get("custom-skill")).toBeDefined();
    expect(r.get("custom-skill")!.description).toBe("A custom test skill");
  });

  it("finds skills by trigger", () => {
    const r = new SkillRegistry();
    r.add(testSkill);
    const matches = r.findByTrigger("please run test for me");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].skill.name).toBe("custom-skill");
  });

  it("returns empty for no trigger match", () => {
    const r = new SkillRegistry();
    const matches = r.findByTrigger("hello world");
    expect(matches.length).toBe(0);
  });

  it("increments usage count", () => {
    const r = new SkillRegistry();
    r.add(testSkill);
    r.incrementUsage("custom-skill");
    expect(r.get("custom-skill")!.usageCount).toBe(1);
  });

  it("returns count", () => {
    const r = new SkillRegistry();
    const initial = r.count();
    r.add(testSkill);
    expect(r.count()).toBe(initial + 1);
  });

  it("persists user skills to disk", () => {
    const r1 = new SkillRegistry();
    r1.add(testSkill);
    const r2 = new SkillRegistry();
    expect(r2.get("custom-skill")).toBeDefined();
  });
});
