import type { CritiqueResult, PrimitiveRepresentation } from "../types/index.js";

export class Critic {
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  critique(
    query: string,
    response: string,
    _primitive: PrimitiveRepresentation
  ): CritiqueResult {
    if (!this.enabled) {
      return {
        completeness: 0.5,
        accuracy: 0.5,
        clarity: 0.5,
        gaps: [],
        strengthened: true,
      };
    }

    const responseSentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
    const querySentences = query.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
    const completeness = Math.min(1, responseSentences / Math.max(1, querySentences * 2));

    const lower = response.toLowerCase();
    const totalWords = response.split(/\s+/).length;

    const strongHedging = (lower.match(/\b(i'm not sure|not certain|don't know|can't determine|unable to answer)\b/g) || []).length;
    const accuracy = Math.max(0.3, 1 - (strongHedging / Math.max(1, totalWords)) * 10);

    const avgWordsPerSentence = responseSentences > 0
      ? totalWords / responseSentences
      : 0;
    const clarity = avgWordsPerSentence > 5 && avgWordsPerSentence < 40
      ? 0.8
      : avgWordsPerSentence > 40 ? 0.5 : 0.7;

    const gaps: string[] = [];
    if (completeness < 0.3) {
      gaps.push("Response is too brief for the query complexity");
    }
    if (accuracy < 0.3) {
      gaps.push("Strong uncertainty language detected — answer may be incomplete");
    }

    const strengthened = completeness > 0.4 && accuracy > 0.3;

    return { completeness, accuracy, clarity, gaps, strengthened };
  }
}
