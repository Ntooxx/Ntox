import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { UserProfile } from "../types/index.js";

const REFLECTIONS_PATH = join(NTOX_DIR, "self-reflections.json");

interface SessionReflection {
  sessionId: string;
  timestamp: number;
  durationMinutes: number;
  interactionCount: number;
  dominantIntent: string;
  discoveredDomains: string[];
  commonTerms: string[];
  satisfactionTrend: number;
  correctionsReceived: number;
  toolUsage: Record<string, number>;
  topics: string[];
  summary: string;
}

interface ReflectionStore {
  sessions: SessionReflection[];
  cumulativeDomains: Record<string, number>;
  cumulativeTerms: Record<string, number>;
}

const DEFAULT_STORE: ReflectionStore = {
  sessions: [],
  cumulativeDomains: {},
  cumulativeTerms: {},
};

export class SelfReflector {
  private store: ReflectionStore;

  constructor() {
    this.store = this.load();
  }

  private load(): ReflectionStore {
    if (!existsSync(REFLECTIONS_PATH)) return { ...DEFAULT_STORE };
    try {
      return { ...DEFAULT_STORE, ...JSON.parse(readFileSync(REFLECTIONS_PATH, "utf-8")) };
    } catch {
      return { ...DEFAULT_STORE };
    }
  }

  private save(): void {
    writeFileSync(REFLECTIONS_PATH, JSON.stringify(this.store, null, 2));
  }

  recordSession(
    sessionId: string,
    messages: { role: string; content: string }[],
    profile: UserProfile,
    toolUsage: Record<string, number>,
    dominantIntent: string,
    correctionsCount: number,
    sessionStartTime: number
  ): SessionReflection {
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);

    const topics = this.extractTopics(userMessages);
    const commonTerms = this.extractCommonTerms(userMessages);
    const discoveredDomains = this.detectNewDomains(commonTerms);

    const now = Date.now();
    const reflection: SessionReflection = {
      sessionId,
      timestamp: now,
      durationMinutes: Math.round((now - sessionStartTime) / 60000),
      interactionCount: userMessages.length,
      dominantIntent,
      discoveredDomains,
      commonTerms: commonTerms.slice(0, 10),
      satisfactionTrend: profile.patterns.correctionsReceived > 0
        ? Math.max(-1, Math.min(1, 1 - profile.patterns.correctionsReceived / Math.max(1, profile.patterns.totalMessages)))
        : 0.5,
      correctionsReceived: correctionsCount,
      toolUsage: { ...toolUsage },
      topics: topics.slice(0, 8),
      summary: this.generateSummary(topics, commonTerms, dominantIntent),
    };

    this.store.sessions.push(reflection);
    if (this.store.sessions.length > 200) {
      this.store.sessions = this.store.sessions.slice(-200);
    }

    // Update cumulative knowledge
    for (const term of commonTerms) {
      this.store.cumulativeTerms[term] = (this.store.cumulativeTerms[term] || 0) + 1;
    }
    for (const domain of discoveredDomains) {
      this.store.cumulativeDomains[domain] = (this.store.cumulativeDomains[domain] || 0) + 1;
    }

    const MAX_TERMS = 1000;
    const MAX_DOMAINS = 200;
    const termEntries = Object.entries(this.store.cumulativeTerms);
    if (termEntries.length > MAX_TERMS) {
      this.store.cumulativeTerms = Object.fromEntries(
        termEntries.sort(([, a], [, b]) => b - a).slice(0, MAX_TERMS)
      );
    }
    const domainEntries = Object.entries(this.store.cumulativeDomains);
    if (domainEntries.length > MAX_DOMAINS) {
      this.store.cumulativeDomains = Object.fromEntries(
        domainEntries.sort(([, a], [, b]) => b - a).slice(0, MAX_DOMAINS)
      );
    }

    this.save();
    return reflection;
  }

  private extractTopics(messages: string[]): string[] {
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "need", "want", "like", "just", "get",
      "got", "make", "made", "use", "used", "using", "know", "think", "going", "way",
      "thing", "things", "really", "actually", "basically", "well", "also", "even",
      "still", "already", "though", "although", "however", "therefore", "thus"]);

    const wordCounts = new Map<string, number>();
    const bigramCounts = new Map<string, number>();

    for (const msg of messages) {
      const words = msg.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));
      for (let i = 0; i < words.length; i++) {
        wordCounts.set(words[i], (wordCounts.get(words[i]) || 0) + 1);
        if (i < words.length - 1) {
          const bigram = `${words[i]} ${words[i + 1]}`;
          bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
        }
      }
    }

    const scored = Array.from(bigramCounts.entries())
      .map(([phrase, count]) => ({ phrase, score: count * 2 }))
      .concat(
        Array.from(wordCounts.entries())
          .filter(([w]) => !bigramCounts.has(w))
          .map(([word, count]) => ({ phrase: word, score: count }))
      );

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 15).map((s) => s.phrase);
  }

  private extractCommonTerms(messages: string[]): string[] {
    const allWords = messages.join(" ").toLowerCase().split(/\s+/);
    const counts = new Map<string, number>();
    for (const word of allWords) {
      if (word.length > 4 && !/^\d+$/.test(word)) {
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w);
  }

  private detectNewDomains(terms: string[]): string[] {
    const knownDomains = new Set([
      "code", "function", "class", "api", "database", "server", "python",
      "javascript", "typescript", "docker", "kubernetes", "aws", "devops",
      "design", "writing", "data", "machine", "learning", "neural",
      "algorithm", "testing", "deploy", "config", "security", "network",
    ]);

    const newDomains: string[] = [];
    for (const term of terms) {
      if (!knownDomains.has(term) && !this.store.cumulativeDomains[term]) {
        const count = this.store.cumulativeTerms[term] || 0;
        if (count >= 3) {
          newDomains.push(term);
        }
      }
    }
    return newDomains;
  }

  private generateSummary(topics: string[], commonTerms: string[], intent: string): string {
    const parts: string[] = [];
    if (topics.length > 0) parts.push(`topics: ${topics.slice(0, 3).join(", ")}`);
    if (intent !== "casual") parts.push(`mode: ${intent}`);
    if (commonTerms.length > 0) parts.push(`recurring: ${commonTerms.slice(0, 3).join(", ")}`);
    return parts.join(" | ");
  }

  getFrequentTerms(threshold: number = 3): string[] {
    return Object.entries(this.store.cumulativeTerms)
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([term]) => term);
  }

  getCumulativeDomains(): string[] {
    return Object.entries(this.store.cumulativeDomains)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain]) => domain);
  }

  getLastSessionSummary(): string | null {
    const last = this.store.sessions[this.store.sessions.length - 1];
    if (!last) return null;
    return last.summary;
  }
}
