import { detectDomains, ALL_DOMAINS } from "./domains.js";
import type { PrimitiveRepresentation } from "../types/index.js";

const ACTION_TYPES: Record<string, RegExp[]> = {
  create: [/create\b/i, /build\b/i, /make\b/i, /design\b/i, /generate\b/i, /write\b.*(code|function)/i],
  analyze: [/analyz/, /evaluat/, /compare\b/, /contrast\b/, /investigat/, /assess\b/i],
  explain: [/explain\b/, /what is\b/, /how does\b/, /why does\b/, /define\b/, /describe\b/],
  code: [/write.*code/i, /implement\b/, /code\b/, /program\b/, /debug\b/, /fix\b.*bug/i],
  plan: [/plan\b/, /roadmap\b/, /steps?\b/, /strategy\b/, /timeline\b/, /how to\b/i],
  fact: [/what\b/, /who\b/, /when\b/, /where\b/, /how many\b/, /statistics?\b/],
};

export class MeaningCompressor {
  compress(query: string): PrimitiveRepresentation {
    const lower = query.toLowerCase();

    const domains = detectDomains(query);

    let action = "general";
    let maxMatches = 0;
    for (const [actionType, patterns] of Object.entries(ACTION_TYPES)) {
      const matches = patterns.filter((p) => p.test(lower)).length;
      if (matches > maxMatches) { maxMatches = matches; action = actionType; }
    }

    const sentences = query.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgWordsPerSentence = sentences.length > 0 ? query.split(/\s+/).length / sentences.length : 0;
    const complexity = Math.min(1, (avgWordsPerSentence / 30) * 0.5 + (domains.length * 0.1) * 0.5);

    const conceptualSummary = domains.length > 0
      ? `${action} problem involving ${domains.slice(0, 3).join(", ")}${domains.length > 3 ? " and others" : ""}`
      : `${action} query`;

    return { domains, action, complexity, conceptualSummary };
  }

  getDomainKeywords(): string[] {
    return ALL_DOMAINS;
  }
}
