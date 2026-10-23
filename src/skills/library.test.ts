import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_SKILLS_PATH, SkillLibrary } from "./library.js";

function collectSkillMarkdown(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSkillMarkdown(full));
    } else if (entry.name.toLowerCase().endsWith(".md") && !/^(index|readme)/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe("bundled skill library integrity", () => {
  const library = new SkillLibrary();

  beforeAll(() => {
    library.scan();
  });

  it("indexes every bundled markdown file with no silent failures", () => {
    const files = collectSkillMarkdown(BUNDLED_SKILLS_PATH);
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(library.list()).toHaveLength(files.length);
  });

  it("gives every indexed skill a name, description, and at least one trigger", () => {
    for (const skill of library.list()) {
      expect(skill.name.trim().length, `name of ${skill.fileName}`).toBeGreaterThan(0);
      expect(skill.description.trim().length, `description of ${skill.fileName}`).toBeGreaterThan(0);
      expect(skill.triggers.length, `triggers of ${skill.fileName}`).toBeGreaterThan(0);
      expect(skill.contentPath, `contentPath of ${skill.fileName}`).toBeTruthy();
    }
  });

  it("ships the six applied domain packs with at least four skills each", () => {
    const domains = library.getDomains();
    for (const domain of ["DevOps", "Legal", "Finance", "Health", "Gaming", "Hardware"]) {
      expect(domains, `domain ${domain} missing`).toContain(domain);
      expect(library.get(domain).length, `domain ${domain} too small`).toBeGreaterThanOrEqual(4);
    }
  });

  it("exposes curated triggers from the new packs for activation", () => {
    const matches = library.findByTrigger("review this contract");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("contract review");
  });
});
