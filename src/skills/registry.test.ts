import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "./registry.js";
import { SKILL_AUTO_DISABLE_MS } from "./lifecycle.js";
import { getBaseDir } from "../core/config.js";
import type { SkillDefinition } from "../types/index.js";

const skillsDir = join(getBaseDir(), "skills");

describe("SkillRegistry", () => {
  afterEach(() => {
    try {
      rmSync(skillsDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
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

  it("versions skills: bumps on content change, stays on identical re-add", () => {
    const r = new SkillRegistry();
    r.add(testSkill);
    expect(r.get("custom-skill")!.version).toBe(1);

    r.add({ ...testSkill });
    expect(r.get("custom-skill")!.version).toBe(1);

    r.add({ ...testSkill, description: "A better description" });
    expect(r.get("custom-skill")!.version).toBe(2);
    expect(r.get("custom-skill")!.description).toBe("A better description");

    r.add({
      ...testSkill,
      description: "A better description",
      steps: [{ kind: "tool", tool: "web_read", args: { url: "https://x" } }],
    });
    expect(r.get("custom-skill")!.version).toBe(3);
    expect(r.get("custom-skill")!.steps).toHaveLength(1);
  });

  it("preserves created and usage across overwrites", () => {
    const r = new SkillRegistry();
    r.add({ ...testSkill, created: 123 });
    r.incrementUsage("custom-skill");
    const used = r.get("custom-skill")!;
    expect(used.lastUsedAt).toBeGreaterThan(0);

    r.add({ ...testSkill, description: "changed" });
    const after = r.get("custom-skill")!;
    expect(after.created).toBe(123);
    expect(after.usageCount).toBe(used.usageCount);
    expect(after.lastUsedAt).toBe(used.lastUsedAt);
    expect(after.version).toBe(2);
  });

  it("excludes never-used skills from trigger matching after the auto-disable window", () => {
    const r = new SkillRegistry();
    r.add({ ...testSkill, name: "stale-skill" });
    const stale = r.get("stale-skill")!;
    const longAgo = Date.now() - SKILL_AUTO_DISABLE_MS - 60_000;
    stale.created = longAgo;
    stale.updated = longAgo;

    expect(r.findByTrigger("please run test for me").some((match) => match.skill.name === "stale-skill")).toBe(false);

    stale.usageCount = 1;
    expect(r.findByTrigger("please run test for me").some((match) => match.skill.name === "stale-skill")).toBe(true);
  });
});
