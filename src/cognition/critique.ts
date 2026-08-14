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
    primitive: PrimitiveRepresentation
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

    const complexityScale = Math.max(0.5, primitive.complexity * 2);
    const expectedSentences = Math.max(2, querySentences * 2 * complexityScale);
    const completeness = Math.min(1, responseSentences / expectedSentences);

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

    if (primitive.domains.length > 0) {
      const responseLower = response.toLowerCase();
      const domainHits = primitive.domains.filter((d) => {
        const variants = [d, d.replace(/_/g, " "), d.replace(/_/g, "-")];
        return variants.some((v) => responseLower.includes(v));
      });
      if (domainHits.length === 0 && primitive.domains.length > 0) {
        gaps.push(`Response does not address any of the relevant domains: ${primitive.domains.join(", ")}`);
      } else if (domainHits.length < primitive.domains.length) {
        const missing = primitive.domains.filter((d) => !domainHits.includes(d));
        gaps.push(`Response missing coverage for: ${missing.join(", ")}`);
      }
    }

    if (primitive.action === "code" && !/\b(code|function|class|impl|def|const|let|var|return|import)\b/i.test(response)) {
      gaps.push("Action type is 'code' but response contains no code");
    }
    if (primitive.action === "explain" && responseSentences < 3) {
      gaps.push("Action type is 'explain' but response is too brief for an explanation");
    }
    if (primitive.action === "create" && responseSentences < 2) {
      gaps.push("Action type is 'create' but response is too brief");
    }

    if (completeness < 0.3) {
      gaps.push("Response is too brief for the query complexity");
    }
    if (accuracy < 0.3) {
      gaps.push("Strong uncertainty language detected — answer may be incomplete");
    }

    const strengthened = completeness > 0.4 && accuracy > 0.3 && gaps.length === 0;

    return { completeness, accuracy, clarity, gaps, strengthened };
  }
}
