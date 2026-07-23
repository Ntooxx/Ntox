import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NTOX_DIR } from "../core/config.js";
import type { Message, UserProfile } from "../types/index.js";

const OBSERVATION_PATH = join(NTOX_DIR, "observations.json");

const DAY_MS = 86400000;

export interface ObservedSession {
  id: string;
  sessionId: string;
  timestamp: number;
  topics: string[];
  toolUsage: Record<string, number>;
  durationMinutes: number;
  messageCount: number;
  correctionsCount: number;
  sentiment: string;
  sentimentScore: number;
  energy: string;
  sessionIntent: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "want", "like", "just", "get",
  "got", "make", "made", "use", "used", "using", "know", "think", "going", "way",
  "thing", "things", "really", "actually", "basically", "well", "also", "even",
  "still", "already", "though", "although", "however", "therefore", "thus",
]);

export class ObservationEngine {
  private observations: ObservedSession[] = [];
  private dirty = false;
  private path: string;

  constructor(path?: string) {
    this.path = path ?? OBSERVATION_PATH;
    this.observations = this.load();
  }

  private load(): ObservedSession[] {
    if (!existsSync(this.path)) return [];
    try {
      return JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return [];
    }
  }

  private save(): void {
    const tmp = this.path + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.observations, null, 2));
      writeFileSync(this.path, readFileSync(tmp, "utf-8"));
      try { unlinkSync(tmp); } catch { }
    } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  recordSession(data: {
    sessionId: string;
    messages: Message[];
    toolUsage: Record<string, number>;
    sessionIntent: string;
    correctionsCount: number;
    sessionStartTime: number;
    userProfile: UserProfile;
  }): ObservedSession {
    const userMessages = data.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);

    const observation: ObservedSession = {
      id: `obs_${randomUUID().slice(0, 8)}`,
      sessionId: data.sessionId,
      timestamp: Date.now(),
      topics: this.extractTopics(userMessages),
      toolUsage: { ...data.toolUsage },
      durationMinutes: Math.round((Date.now() - data.sessionStartTime) / 60000),
      messageCount: userMessages.length,
      correctionsCount: data.correctionsCount,
      sentiment: this.extractSentiment(data.userProfile),
      sentimentScore: this.extractSentimentScore(data.userProfile),
      energy: this.extractEnergy(data.userProfile),
      sessionIntent: data.sessionIntent,
    };

    this.observations.push(observation);
    if (this.observations.length > 1000) {
      this.observations = this.observations.slice(-1000);
    }
    this.dirty = true;
    this.persist();

    return observation;
  }

  getRecent(count: number = 10): ObservedSession[] {
    return this.observations.slice(-count);
  }

  getByTopic(topic: string, count: number = 10): ObservedSession[] {
    const lower = topic.toLowerCase();
    return this.observations
      .filter((o) => o.topics.some((t) => t.includes(lower)))
      .slice(-count);
  }

  getPattern(topic: string, window: number = 10): { topic: string; frequency: number; total: number } {
    const lower = topic.toLowerCase();
    const recent = this.observations.slice(-window);
    const matching = recent.filter((o) => o.topics.some((t) => t.includes(lower)));
    return {
      topic,
      frequency: matching.length,
      total: recent.length,
    };
  }

  getStreak(topic: string): number {
    const lower = topic.toLowerCase();
    let streak = 0;
    for (let i = this.observations.length - 1; i >= 0; i--) {
      if (this.observations[i].topics.some((t) => t.includes(lower))) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  getStats(): { total: number; thisWeek: number; topics: string[] } {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const thisWeek = this.observations.filter((o) => o.timestamp > weekAgo).length;
    const topicCounts = new Map<string, number>();
    for (const o of this.observations) {
      for (const t of o.topics.slice(0, 3)) {
        topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
      }
    }
    const topics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);
    return { total: this.observations.length, thisWeek, topics };
  }

  getAll(): ObservedSession[] {
    return [...this.observations];
  }

  clearAll(): void {
    this.observations = [];
    this.dirty = true;
    this.persist();
  }

  private extractTopics(messages: string[]): string[] {
    const wordCounts = new Map<string, number>();
    const bigramCounts = new Map<string, number>();

    for (const msg of messages) {
      const words = msg.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
      for (let i = 0; i < words.length; i++) {
        wordCounts.set(words[i], (wordCounts.get(words[i]) || 0) + 1);
        if (i < words.length - 1) {
          const bigram = `${words[i]} ${words[i + 1]}`;
          bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
        }
      }
    }

    const scored: { phrase: string; score: number }[] = [];

    for (const [phrase, count] of bigramCounts) {
      scored.push({ phrase, score: count * 2 });
    }

    const bigramWords = new Set(bigramCounts.keys());
    for (const [word, count] of wordCounts) {
      if (!bigramWords.has(word)) {
        scored.push({ phrase: word, score: count });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map((s) => s.phrase);
  }

  private extractSentiment(profile: UserProfile): string {
    const recent = profile.moodHistory.slice(-3);
    if (recent.length === 0) return "neutral";
    const counts: Record<string, number> = {};
    for (const m of recent) {
      counts[m.sentiment] = (counts[m.sentiment] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private extractSentimentScore(profile: UserProfile): number {
    const recent = profile.moodHistory.slice(-3);
    if (recent.length === 0) return 0;
    return recent.reduce((s, m) => s + m.score, 0) / recent.length;
  }

  private extractEnergy(profile: UserProfile): string {
    const recent = profile.moodHistory.slice(-3);
    if (recent.length === 0) return "medium";
    const counts: Record<string, number> = {};
    for (const m of recent) {
      counts[m.energy] = (counts[m.energy] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
}