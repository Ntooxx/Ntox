import { SkillRegistry } from "./registry.js";
import type { SkillTriggerMatch } from "../types/index.js";

export class SkillExecutor {
  private registry: SkillRegistry;
  private enabled: boolean;

  constructor(registry: SkillRegistry, enabled: boolean = true) {
    this.registry = registry;
    this.enabled = enabled;
  }

  setEnabled(val: boolean): void { this.enabled = val; }

  findMatchingSkills(query: string): SkillTriggerMatch[] {
    if (!this.enabled) return [];
    return this.registry.findByTrigger(query);
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
