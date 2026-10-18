import type { CognitivePattern, PrimitiveRepresentation } from "../types/index.js";

const STRONG_PATTERN_THRESHOLD = 0.5;
const MIN_COMPILE_COUNT = 1;
const MIN_ACTIVATION_STRENGTH = 0.3;

export class SparseActivator {
  activate(patterns: CognitivePattern[], _primitive: PrimitiveRepresentation): string {
    const strong = patterns.filter(
      (p) => p.strength >= STRONG_PATTERN_THRESHOLD && p.compileCount >= MIN_COMPILE_COUNT,
    );
    const fallback = patterns
      .filter((p) => p.strength >= MIN_ACTIVATION_STRENGTH)
      .sort((a, b) => b.strength - a.strength);
    const top = strong[0] || fallback[0];

    if (!top) return "";
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
      (p) => p.strength >= STRONG_PATTERN_THRESHOLD && p.compileCount >= MIN_COMPILE_COUNT,
    );
    const candidates =
      strong.length > 0
        ? strong
        : patterns.filter((p) => p.strength >= MIN_ACTIVATION_STRENGTH).sort((a, b) => b.strength - a.strength);

    if (candidates.length === 0) return [];

    const checklist: string[] = [];
    for (const p of candidates.slice(0, 2)) {
      if (p.compiledTemplate) {
        checklist.push(`Check: Did the answer address the ${p.domains.join("-")} abstraction?`);
      }
      checklist.push(`Check: Did the answer cover key points from "${p.name}" pattern?`);
    }
    return checklist;
  }
}
