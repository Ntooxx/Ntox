import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getMemoryDir, EPISODES_PATH } from "../core/config.js";
import { cosineSimilarity } from "../utils/math.js";
import type { Episode, MemoryQueryResult, MemoryStats } from "../types/index.js";

export { cosineSimilarity };

function generateSummary(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return cleaned;
  return cleaned.slice(0, 117) + "...";
}

export class MemoryStore {
  private episodes: Episode[] = [];

  constructor() {
    getMemoryDir();
  }

  private load(): void {
    if (!existsSync(EPISODES_PATH)) {
      if (this.episodes.length > 0) this.episodes = [];
      return;
    }
    try {
      const raw = readFileSync(EPISODES_PATH, "utf-8");
      this.episodes = JSON.parse(raw);
    } catch {
      this.episodes = [];
    }
  }

  private save(): void {
    writeFileSync(EPISODES_PATH, JSON.stringify(this.episodes, null, 2));
  }

  addEpisode(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    embedding: number[]
  ): Episode {
    this.load();
    const episode: Episode = {
      id: `ep_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      sessionId,
      userMessage,
      assistantResponse,
      summary: generateSummary(userMessage),
      embedding,
    };
    this.episodes.push(episode);
    if (this.episodes.length > 1000) {
      this.episodes = this.episodes.slice(-800);
    }
    this.save();
    return episode;
  }

  retrieve(queryEmbedding: number[] | null, limit: number = 5, threshold: number = 0.5): MemoryQueryResult[] {
    this.load();
    if (this.episodes.length === 0) return [];
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const scored: MemoryQueryResult[] = [];

    for (const episode of this.episodes) {
      if (!episode.embedding || episode.embedding.length === 0) continue;
      const sim = cosineSimilarity(queryEmbedding, episode.embedding);
      if (sim >= threshold) {
        scored.push({ episode, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  search(query: string, limit: number = 10): Episode[] {
    this.load();
    const q = query.toLowerCase();
    const results: { episode: Episode; score: number }[] = [];

    for (const ep of this.episodes) {
      let score = 0;
      if (ep.summary.toLowerCase().includes(q)) score += 3;
      if (ep.userMessage.toLowerCase().includes(q)) score += 2;
      if (ep.assistantResponse.toLowerCase().includes(q)) score += 1;
      if (score > 0) {
        results.push({ episode: ep, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map((r) => r.episode);
  }

  getRecent(count: number = 10): Episode[] {
    this.load();
    return [...this.episodes].reverse().slice(0, count);
  }

  getStats(): MemoryStats {
    this.load();
    const sessions = new Set(this.episodes.map((e) => e.sessionId));
    const timestamps = this.episodes.map((e) => e.timestamp);

    return {
      totalEpisodes: this.episodes.length,
      totalSessions: sessions.size,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null,
      memorySizeBytes: existsSync(EPISODES_PATH)
        ? readFileSync(EPISODES_PATH).length
        : 0,
    };
  }

  getAll(): Episode[] {
    this.load();
    return [...this.episodes];
  }

  count(): number {
    this.load();
    return this.episodes.length;
  }

  buildMemoryContext(
    queryEmbedding: number[] | null,
    maxMemories: number = 5
  ): string {
    this.load();
    if (this.episodes.length === 0) return "";

    let relevant: Episode[];

    if (queryEmbedding && queryEmbedding.length > 0) {
      relevant = this.retrieve(queryEmbedding, maxMemories, 0.4).map((r) => r.episode);
    } else {
      relevant = this.getRecent(maxMemories);
    }

    if (relevant.length === 0) return "";

    const lines = relevant.map((ep) => {
      const date = new Date(ep.timestamp).toISOString().slice(0, 10);
      return `[${date}] ${ep.summary}`;
    });

    return `\n\n## Relevant Past Memories\n${lines.join("\n")}`;
  }

  deleteEpisode(id: string): boolean {
    this.load();
    const idx = this.episodes.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.episodes.splice(idx, 1);
    this.save();
    return true;
  }

  clearAll(): void {
    this.episodes = [];
    this.save();
  }
}
