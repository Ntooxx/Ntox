import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getMemoryDir, EPISODES_PATH, DURABLE_MEMORY_PATH } from "../core/config.js";
import { cosineSimilarity } from "../utils/math.js";
import type { DurableMemory, Episode, MemoryLane, MemoryQueryResult, MemoryStats } from "../types/index.js";

export { cosineSimilarity };

function generateSummary(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) return cleaned;
  return cleaned.slice(0, 117) + "...";
}

function normalizeDurableMemory(memory: DurableMemory): DurableMemory {
  const now = Date.now();
  return {
    ...memory,
    contradictionCount: memory.contradictionCount ?? 0,
    history: Array.isArray(memory.history) ? memory.history : [],
    updatedAt: memory.updatedAt || memory.createdAt || now,
    createdAt: memory.createdAt || now,
    confidence: typeof memory.confidence === "number" ? memory.confidence : 0.7,
    source: memory.source || "user",
    provenance: memory.provenance || "unknown",
  };
}

export class MemoryStore {
  private episodes: Episode[] = [];
  private durable: DurableMemory[] = [];
  private loaded = false;
  private durableLoaded = false;

  constructor() {
    getMemoryDir();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(EPISODES_PATH)) {
      this.episodes = [];
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

  private loadDurable(): void {
    if (this.durableLoaded) return;
    this.durableLoaded = true;
    if (!existsSync(DURABLE_MEMORY_PATH)) {
      this.durable = [];
      return;
    }
    try {
      this.durable = JSON.parse(readFileSync(DURABLE_MEMORY_PATH, "utf-8")).map(normalizeDurableMemory);
    } catch {
      this.durable = [];
    }
  }

  private saveDurable(): void {
    writeFileSync(DURABLE_MEMORY_PATH, JSON.stringify(this.durable, null, 2));
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
      memorySizeBytes: Buffer.byteLength(JSON.stringify(this.episodes)),
    };
  }

  addDurableMemory(
    lane: MemoryLane,
    text: string,
    provenance = "manual",
    confidence = 0.95,
    source: "user" | "agent" = "user"
  ): DurableMemory {
    this.loadDurable();
    const now = Date.now();
    const memory: DurableMemory = {
      id: `mem_${randomUUID().slice(0, 8)}`,
      lane,
      text: text.replace(/\s+/g, " ").trim(),
      confidence,
      createdAt: now,
      updatedAt: now,
      source,
      provenance,
      contradictionCount: 0,
      history: [],
    };
    this.durable.push(memory);
    this.saveDurable();
    return memory;
  }

  listDurableMemories(lane?: MemoryLane): DurableMemory[] {
    this.loadDurable();
    const memories = lane ? this.durable.filter((memory) => memory.lane === lane) : this.durable;
    return [...memories].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  searchDurableMemories(query: string, limit = 10): DurableMemory[] {
    this.loadDurable();
    const q = query.toLowerCase();
    return this.durable
      .map((memory) => ({
        memory,
        score: memory.text.toLowerCase().includes(q) ? 3 : memory.provenance.toLowerCase().includes(q) ? 1 : 0,
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  getDurableMemory(id: string): DurableMemory | null {
    this.loadDurable();
    return this.durable.find((memory) => memory.id === id) || null;
  }

  deleteDurableMemory(id: string): boolean {
    this.loadDurable();
    const idx = this.durable.findIndex((memory) => memory.id === id);
    if (idx === -1) return false;
    this.durable.splice(idx, 1);
    this.saveDurable();
    return true;
  }

  updateDurableMemory(id: string, text: string, reason = "manual update"): DurableMemory | null {
    this.loadDurable();
    const memory = this.durable.find((item) => item.id === id);
    if (!memory) return null;
    memory.history.push({ text: memory.text, timestamp: Date.now(), reason });
    memory.text = text.replace(/\s+/g, " ").trim();
    memory.updatedAt = Date.now();
    memory.confidence = Math.min(0.99, Math.max(memory.confidence, 0.9));
    this.saveDurable();
    return memory;
  }

  markDurableMemoryContradicted(id: string, reason = "manual contradiction"): DurableMemory | null {
    this.loadDurable();
    const memory = this.durable.find((item) => item.id === id);
    if (!memory) return null;
    memory.contradictionCount += 1;
    memory.confidence = Math.max(0.05, memory.confidence - 0.2);
    memory.updatedAt = Date.now();
    memory.history.push({ text: memory.text, timestamp: Date.now(), reason });
    this.saveDurable();
    return memory;
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

    let relevant: Episode[];

    if (queryEmbedding && queryEmbedding.length > 0) {
      relevant = this.retrieve(queryEmbedding, maxMemories, 0.4).map((r) => r.episode);
    } else {
      relevant = this.getRecent(maxMemories);
    }

    const durableLines = this.listDurableMemories()
      .filter((memory) => memory.confidence >= 0.4)
      .sort((a, b) => (b.confidence - a.confidence) || (a.contradictionCount - b.contradictionCount) || (b.updatedAt - a.updatedAt))
      .slice(0, Math.max(2, maxMemories))
      .map((memory) => `- ${memory.lane}: ${memory.text}`);

    const lines = relevant.map((ep) => {
      const date = new Date(ep.timestamp).toISOString().slice(0, 10);
      return `[${date}] ${ep.summary}`;
    });

    const sections: string[] = [];
    if (durableLines.length > 0) sections.push(`## Durable User Memories\n${durableLines.join("\n")}`);
    if (lines.length > 0) sections.push(`## Relevant Past Memories\n${lines.join("\n")}`);
    if (sections.length === 0) return "";
    return `\n\n${sections.join("\n\n")}`;
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
    this.durable = [];
    this.save();
    this.saveDurable();
  }
}
