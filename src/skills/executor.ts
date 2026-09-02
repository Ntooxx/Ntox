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

  setEnabled(val: boolean): void { this.enabled = val; }

  findMatchingSkills(query: string): SkillTriggerMatch[] {
    if (!this.enabled) return [];
    const registryMatches = this.registry.findByTrigger(query);
    if (registryMatches.length > 0) return registryMatches;

    const libraryHits = this.library.search(query, 1);
    if (libraryHits.length > 0) {
      const top = libraryHits[0];
      const context = this.library.getContextForQuery(top.name, query);
      if (context) {
        return [{
          skill: {
            name: top.name,
            description: top.description,
            category: top.category,
            prompt: context,
            triggers: top.triggers,
            tools: [],
            examples: [],
            created: Date.now(),
            updated: Date.now(),
            usageCount: 0,
            domain: top.domain,
            importance: top.importance,
            isExternal: false,
          },
          confidence: 0.6,
        }];
      }
    }
    return [];
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
