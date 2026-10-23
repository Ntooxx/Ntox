import { SkillRegistry } from "./registry.js";
import { SkillLibrary } from "./library.js";
import type { SkillTriggerMatch } from "../types/index.js";

export class SkillExecutor {
  private registry: SkillRegistry;
  private library: SkillLibrary;
  private enabled: boolean;

  constructor(registry: SkillRegistry, library: SkillLibrary, enabled: boolean = true) {
    this.registry = registry;
    this.library = library;
    this.enabled = enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  findMatchingSkills(query: string): SkillTriggerMatch[] {
    if (!this.enabled) return [];
    if (/\b(use|apply|activate|invoke|run|follow)\b/i.test(query)) {
      const normalizedQuery = this.normalizeSkillName(query);
      const registrySkills = this.registry.list().map((skill) => ({ skill }));
      const librarySkills = this.library.list().map((skill) => ({ skill: this.library.toSkillDefinition(skill) }));
      const requested = [...registrySkills, ...librarySkills]
        .filter(({ skill }) => {
          const name = this.normalizeSkillName(skill.name);
          return name.length >= 5 && normalizedQuery.includes(name);
        })
        .sort((a, b) => b.skill.name.length - a.skill.name.length)[0];

      if (requested) return [{ skill: requested.skill, confidence: 1 }];
    }

    const registryMatches = this.registry.findByTrigger(query);
    return registryMatches;
  }

  private normalizeSkillName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  buildSkillsContext(matches: SkillTriggerMatch[]): string {
    if (!this.enabled || matches.length === 0) return "";

    const topMatch = matches[0];
    return `\n\n## Active Skill: ${topMatch.skill.name}\n${topMatch.skill.prompt}`;
  }

  incrementUsage(name: string): void {
    this.registry.incrementUsage(name);
  }
}
