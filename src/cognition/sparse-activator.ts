import { SkillRegistry } from "../skills/registry.js";
import { CognitiveSpace } from "./cognitive-space.js";
import type { CognitivePattern, PrimitiveRepresentation } from "../types/index.js";

const STRONG_PATTERN_THRESHOLD = 0.5;
const MIN_COMPILE_COUNT = 3;

export class SparseActivator {
  private registry: SkillRegistry;
  private space: CognitiveSpace;

  constructor(registry: SkillRegistry, space: CognitiveSpace) {
    this.registry = registry;
    this.space = space;
  }

  activate(patterns: CognitivePattern[], _primitive: PrimitiveRepresentation): string {
    const strong = patterns.filter(
      (p) => p.strength >= STRONG_PATTERN_THRESHOLD && p.compileCount >= MIN_COMPILE_COUNT
    );

    if (strong.length === 0) return "";

    const top = strong[0];
    const parts: string[] = [];
    parts.push(`## Learned Pattern (from ${top.hitCount} prior uses)`);
    parts.push(top.reasoningTemplate);

    if (top.compiledTemplate) {
      parts.push(`\nKey considerations from compiled abstraction:`);
      parts.push(top.compiledTemplate);
    }

    return "\n\n" + parts.join("\n");
  }

  buildChecklist(patterns: CognitivePattern[]): string[] {
    const strong = patterns.filter(
      (p) => p.strength >= STRONG_PATTERN_THRESHOLD && p.compileCount >= MIN_COMPILE_COUNT
    );

    if (strong.length === 0) return [];

    const checklist: string[] = [];
    for (const p of strong.slice(0, 2)) {
      if (p.compiledTemplate) {
        checklist.push(`Check: Did the answer address the ${p.domains.join("-")} abstraction?`);
      }
      checklist.push(`Check: Did the answer cover key points from "${p.name}" pattern?`);
    }
    return checklist;
  }

  private inferSkillDomain(skillName: string, triggers: string[]): string | null {
    const combined = `${skillName} ${triggers.join(" ")}`.toLowerCase();
    const domainKeywords: Record<string, string[]> = {
      programming: ["code", "program", "function", "software"],
      data_science: ["data", "model", "analy"],
      devops: ["deploy", "infra", "docker"],
      database: ["sql", "database", "query"],
      design: ["design", "ui", "ux"],
      writing: ["explain", "write", "document"],
      python: ["python"],
      javascript: ["javascript", "typescript"],
      rust: ["rust"],
      system_admin: ["system", "admin", "config"],
    };
    for (const [domain, kws] of Object.entries(domainKeywords)) {
      if (kws.some((kw) => combined.includes(kw))) return domain;
    }
    return null;
  }
}
