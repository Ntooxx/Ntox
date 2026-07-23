import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { MISTAKES_PATH, getMemoryDir } from "../core/config.js";
import type { MistakeEntry } from "../types/index.js";

export const CORRECTION_PATTERNS = [
  /no[,.]?\s+(that([\u2019']s| is)\s+)?(not|wrong|incorrect|false)/i,
  /actually[,.]?\s+(it([\u2019']s| is)|that([\u2019']s| is)|the)/i,
  /that([\u2019']s| is)\s+not\s+(right|correct|what\s+I\s+meant)/i,
  /you([\u2019']re| are)\s+(wrong|incorrect|mistaken)/i,
  /i\s+think\s+you([\u2019']re| are)\s+(wrong|confused)/i,
  /not\s+(quite|exactly)\s+(right|correct)/i,
];

export function isUserCorrection(message: string): boolean {
  return CORRECTION_PATTERNS.some((p) => p.test(message));
}

export function extractCorrection(
  userMessage: string,
  _previousAssistantMessage: string
): { topicKey: string; correction: string } {
  const lower = userMessage.toLowerCase();
  const topicMatch = lower.match(/(?:about|regarding|re:|on)\s+["']?([^"'.!?]+)["']?/i);
  const topicKey = topicMatch ? topicMatch[1].trim() : userMessage.slice(0, 80);

  // Try to extract the corrected statement
  const correctionSentences = userMessage
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && !CORRECTION_PATTERNS.some((p) => p.test(s)));

  const correction = correctionSentences.length > 0
    ? correctionSentences.join(". ")
    : userMessage.slice(0, 200);

  return { topicKey, correction };
}

export class MistakeJournal {
  private mistakes: MistakeEntry[] = [];

  constructor() {
    getMemoryDir();
  }

  private load(): void {
    if (!existsSync(MISTAKES_PATH)) {
      if (this.mistakes.length > 0) this.mistakes = [];
      return;
    }
    try {
      this.mistakes = JSON.parse(readFileSync(MISTAKES_PATH, "utf-8"));
    } catch {
      this.mistakes = [];
    }
  }

  private save(): void {
    writeFileSync(MISTAKES_PATH, JSON.stringify(this.mistakes, null, 2));
  }

  add(
    topicKey: string,
    query: string,
    wrongAnswer: string,
    correction: string,
    source: "user-correction" | "self-reflection"
  ): MistakeEntry {
    this.load();
    const existing = this.mistakes.findIndex((m) => m.topicKey === topicKey);
    const entry: MistakeEntry = {
      id: `mist_${randomUUID().slice(0, 8)}`,
      topicKey,
      query: query.slice(0, 300),
      wrongAnswer: wrongAnswer.slice(0, 500),
      correction: correction.slice(0, 500),
      source,
      timestamp: Date.now(),
      fixed: true,
    };
    if (existing >= 0) {
      this.mistakes[existing] = entry;
    } else {
      this.mistakes.push(entry);
      if (this.mistakes.length > 500) {
        this.mistakes = this.mistakes.slice(-500);
      }
    }
    this.save();
    return entry;
  }

  getRelevantMistakes(query: string, limit: number = 5): MistakeEntry[] {
    this.load();
    const lower = query.toLowerCase();
    const queryWords = lower.split(/\s+/).filter((w) => w.length > 3);

    const scored: { mistake: MistakeEntry; score: number }[] = [];

    for (const m of this.mistakes) {
      let score = 0;
      const topic = m.topicKey.toLowerCase();
      const correction = m.correction.toLowerCase();

      for (const word of queryWords) {
        if (topic.includes(word)) score += 3;
        if (correction.includes(word)) score += 2;
        if (m.query.toLowerCase().includes(word)) score += 1;
      }

      if (score > 0) {
        scored.push({ mistake: m, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.mistake);
  }

  buildMistakesContext(query: string): string {
    this.load();
    if (this.mistakes.length === 0) return "";

    const relevant = this.getRelevantMistakes(query, 3);
    if (relevant.length === 0) return "";

    const lines = relevant.map(
      (m) => `- Correction [${new Date(m.timestamp).toISOString().slice(0, 10)}]: ${m.topicKey} — ${m.correction}`
    );

    return `\n\n## Previous Corrections to Remember\n${lines.join("\n")}`;
  }

  getAll(): MistakeEntry[] {
    this.load();
    return [...this.mistakes];
  }

  getStats(): { total: number; bySource: Record<string, number> } {
    this.load();
    const bySource: Record<string, number> = {};
    for (const m of this.mistakes) {
      bySource[m.source] = (bySource[m.source] || 0) + 1;
    }
    return { total: this.mistakes.length, bySource };
  }

  clearAll(): void {
    this.mistakes = [];
    this.save();
  }
}
