import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getMemoryDir, EPISODES_PATH, EPISODES_JSONL_PATH, DURABLE_MEMORY_PATH } from "../core/config.js";
import { cosineSimilarity } from "../utils/math.js";
import { localEmbed } from "../core/local-embed.js";
import type { DurableMemory, Episode, MemoryLane, MemoryQueryResult, MemoryStats } from "../types/index.js";

export { cosineSimilarity };

const EPISODES_COMPACT_THRESHOLD = 1200;
const EPISODES_KEEP_AFTER_COMPACT = 1000;

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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesText(haystack: string, needle: string | undefined): boolean {
  if (!needle || needle.trim().length < 3) return false;
  return normalizeText(haystack).includes(normalizeText(needle));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "have",
  "this",
  "that",
  "with",
  "from",
  "they",
  "want",
  "been",
  "much",
  "when",
  "what",
  "which",
  "how",
  "why",
  "who",
  "its",
  "into",
  "than",
  "then",
  "them",
  "they",
  "would",
  "could",
  "should",
  "about",
  "just",
  "like",
  "some",
  "there",
  "here",
  "were",
  "will",
  "your",
]);

function tokenizeForBm25(text: string, cap = 120): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return words.length > cap ? words.slice(0, cap) : words;
}

interface Bm25Corpus {
  docTokens: Map<string, string[]>;
  df: Map<string, number>;
  avgLen: number;
}

function buildBm25Corpus(docs: { id: string; text: string }[]): Bm25Corpus {
  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    const tokens = tokenizeForBm25(doc.text);
    docTokens.set(doc.id, tokens);
    totalLen += tokens.length;
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { docTokens, df, avgLen: docs.length > 0 ? totalLen / docs.length : 1 };
}

function bm25Score(query: string, docId: string, corpus: Bm25Corpus): number {
  const tokens = corpus.docTokens.get(docId);
  if (!tokens || tokens.length === 0) return 0;
  const k1 = 1.2;
  const b = 0.75;
  const N = corpus.docTokens.size;
  if (N === 0) return 0;
  const qTokens = tokenizeForBm25(query, 32);
  if (qTokens.length === 0) return 0;
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const term of qTokens) {
    const f = tf.get(term);
    if (!f) continue;
    const df = corpus.df.get(term) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * tokens.length) / Math.max(1, corpus.avgLen)));
  }
  return score;
}

export interface PromptMemoryItem {
  id: string;
  kind: "memory" | "durable";
  text: string;
  relevance: number;
}

export function renderPromptMemoryItems(items: PromptMemoryItem[]): string {
  const durable = items.filter((item) => item.kind === "durable").map((item) => `- ${item.text}`);
  const episodes = items.filter((item) => item.kind === "memory").map((item) => item.text);
  const sections: string[] = [];
  if (durable.length > 0) sections.push(`## Durable User Memories\n${durable.join("\n")}`);
  if (episodes.length > 0) sections.push(`## Relevant Past Memories\n${episodes.join("\n")}`);
  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
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
    if (existsSync(EPISODES_JSONL_PATH)) {
      this.episodes = this.loadJsonl();
      if (this.episodes.length > EPISODES_COMPACT_THRESHOLD) this.compact();
      return;
    }
    if (existsSync(EPISODES_PATH)) {
      try {
        this.episodes = JSON.parse(readFileSync(EPISODES_PATH, "utf-8"));
        this.save();
      } catch {
        this.episodes = [];
      }
      return;
    }
    this.episodes = [];
  }

  private loadJsonl(): Episode[] {
    try {
      const raw = readFileSync(EPISODES_JSONL_PATH, "utf-8");
      const episodes: Episode[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          episodes.push(JSON.parse(trimmed) as Episode);
        } catch {
          continue;
        }
      }
      return episodes;
    } catch {
      return [];
    }
  }

  private save(): void {
    const lines = this.episodes.map((episode) => JSON.stringify(episode));
    writeFileSync(EPISODES_JSONL_PATH, lines.length > 0 ? lines.join("\n") + "\n" : "");
  }

  private appendEpisode(episode: Episode): void {
    appendFileSync(EPISODES_JSONL_PATH, JSON.stringify(episode) + "\n");
  }

  private compact(): void {
    this.episodes = this.episodes.slice(-EPISODES_KEEP_AFTER_COMPACT);
    this.save();
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
    embedding: number[],
    embeddingModel?: string,
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
      ...(embeddingModel ? { embeddingModel } : {}),
    };
    this.episodes.push(episode);
    if (this.episodes.length > 1000) {
      this.episodes = this.episodes.slice(-800);
      this.save();
    } else {
      this.appendEpisode(episode);
    }
    return episode;
  }

  retrieve(
    queryEmbedding: number[] | null,
    limit: number = 5,
    threshold: number = 0.5,
    queryEmbeddingModel?: string,
  ): MemoryQueryResult[] {
    this.load();
    if (this.episodes.length === 0) return [];
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    const scored: MemoryQueryResult[] = [];

    for (const episode of this.episodes) {
      if (!episode.embedding || episode.embedding.length === 0) continue;
      if (queryEmbeddingModel && episode.embeddingModel && episode.embeddingModel !== queryEmbeddingModel) {
        continue;
      }
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
    source: "user" | "agent" = "user",
    sourceEpisodeIds?: string[],
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
      ...(sourceEpisodeIds && sourceEpisodeIds.length > 0 ? { sourceEpisodeIds: [...sourceEpisodeIds] } : {}),
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

  applyCorrectionToDurableMemories(input: {
    correction: string;
    topicKey?: string;
    wrongAnswer?: string;
  }): DurableMemory[] {
    this.loadDurable();
    const corrected: DurableMemory[] = [];
    const now = Date.now();
    const correction = input.correction.replace(/\s+/g, " ").trim();
    if (!correction) return [];

    for (const memory of this.durable) {
      const exactWrong = includesText(memory.text, input.wrongAnswer);
      const topicMatch = includesText(memory.text, input.topicKey);
      const alreadyCorrected = includesText(memory.text, correction);
      if (exactWrong) {
        memory.history.push({
          text: memory.text,
          timestamp: now,
          reason: `user correction${input.topicKey ? `: ${input.topicKey}` : ""}`,
        });
        memory.text = correction;
        memory.confidence = Math.max(memory.confidence, 0.95);
        memory.source = "user";
        memory.provenance = "user correction";
        memory.contradictionCount += 1;
        memory.updatedAt = now;
        corrected.push(memory);
      } else if (topicMatch && !alreadyCorrected) {
        memory.history.push({
          text: memory.text,
          timestamp: now,
          reason: `possibly superseded by user correction${input.topicKey ? `: ${input.topicKey}` : ""}`,
        });
        memory.confidence = Math.min(memory.confidence, 0.35);
        memory.contradictionCount += 1;
        memory.updatedAt = now;
        corrected.push(memory);
      }
    }

    if (corrected.length > 0) this.saveDurable();
    return corrected.map((memory) => ({ ...memory, history: [...memory.history] }));
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

  consolidateDurable(): number {
    this.loadDurable();
    const byText = new Map<string, DurableMemory>();
    let merged = 0;
    for (const memory of this.durable) {
      const key = normalizeText(memory.text);
      const existing = byText.get(key);
      if (!existing) {
        byText.set(key, memory);
        continue;
      }
      merged += 1;
      existing.confidence = Math.max(existing.confidence, memory.confidence);
      existing.contradictionCount = Math.max(existing.contradictionCount, memory.contradictionCount);
      existing.updatedAt = Math.max(existing.updatedAt, memory.updatedAt);
      for (const entry of memory.history) existing.history.push(entry);
      if (memory.history.length > 0) existing.history = existing.history.slice(-20);
    }
    if (merged > 0) {
      this.durable = [...byText.values()];
      this.saveDurable();
    }
    return merged;
  }

  consolidateEpisodes(options: { recent?: number; threshold?: number } = {}): {
    clusters: number;
    created: number;
    merged: number;
    challenged: number;
  } {
    this.load();
    this.loadDurable();
    const recentLimit = options.recent ?? 100;
    const threshold = options.threshold ?? 0.85;
    const report = { clusters: 0, created: 0, merged: 0, challenged: 0 };
    const recent = [...this.episodes].reverse().slice(0, recentLimit);
    if (recent.length < 2) return report;

    const vectors = recent.map((episode) => localEmbed(episode.summary));
    const parent = recent.map((_, index) => index);
    const find = (index: number): number => {
      let root = index;
      while (parent[root] !== root) root = parent[root];
      let cur = index;
      while (parent[cur] !== root) {
        const next = parent[cur];
        parent[cur] = root;
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < recent.length; i++) {
      for (let j = i + 1; j < recent.length; j++) {
        if (cosineSimilarity(vectors[i], vectors[j]) >= threshold) union(i, j);
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < recent.length; i++) {
      const root = find(i);
      const list = groups.get(root) ?? [];
      list.push(i);
      groups.set(root, list);
    }

    const negation = /\b(no|not|never|cannot|can't|don't|doesn't|instead of|dislike|hate|stop)\b/i;

    for (const indexes of groups.values()) {
      if (indexes.length < 2) continue;
      report.clusters += 1;
      const members = indexes.map((i) => recent[i]);
      const longestFirst = [...members].sort(
        (a, b) => b.summary.length - a.summary.length || b.timestamp - a.timestamp,
      );
      const candidateText = longestFirst[0].summary;
      const confidence = Math.min(0.9, 0.5 + 0.1 * (members.length - 1));
      const sourceEpisodeIds = members.map((m) => m.id);

      const candidateTokens = new Set(tokenizeForBm25(candidateText));
      let bestOverlap = 0;
      let bestExisting: DurableMemory | null = null;
      for (const existing of this.durable) {
        const existingTokens = new Set(tokenizeForBm25(existing.text));
        const unionSize = new Set([...candidateTokens, ...existingTokens]).size;
        const overlap =
          unionSize === 0 ? 0 : [...candidateTokens].filter((t) => existingTokens.has(t)).length / unionSize;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestExisting = existing;
        }
      }

      if (bestExisting && bestOverlap > 0.7) {
        bestExisting.confidence = Math.max(bestExisting.confidence, confidence);
        bestExisting.updatedAt = Date.now();
        const existingSources = new Set(bestExisting.sourceEpisodeIds ?? []);
        for (const id of sourceEpisodeIds) existingSources.add(id);
        bestExisting.sourceEpisodeIds = [...existingSources];
        report.merged += 1;
        continue;
      }

      if (bestExisting && bestOverlap > 0.5) {
        const candNeg = negation.test(candidateText);
        const existingNeg = negation.test(bestExisting.text);
        if (candNeg !== existingNeg) {
          this.markDurableMemoryContradicted(bestExisting.id, "consolidation candidate conflicts with this fact");
          const created = this.addDurableMemory(
            "fact",
            candidateText,
            "consolidation",
            confidence,
            "agent",
            sourceEpisodeIds,
          );
          this.markDurableMemoryContradicted(created.id, `conflicts with durable memory ${bestExisting.id}`);
          report.challenged += 2;
          continue;
        }
      }

      this.addDurableMemory("fact", candidateText, "consolidation", confidence, "agent", sourceEpisodeIds);
      report.created += 1;
    }

    return report;
  }

  getAll(): Episode[] {
    this.load();
    return [...this.episodes];
  }

  count(): number {
    this.load();
    return this.episodes.length;
  }

  buildMemoryItems(
    queryEmbedding: number[] | null,
    maxMemories: number = 5,
    queryEmbeddingModel?: string,
    queryText?: string,
  ): PromptMemoryItem[] {
    this.load();

    let relevant: { episode: Episode; relevance: number }[];

    if (queryEmbedding && queryEmbedding.length > 0) {
      const candidates = this.episodes.filter((episode) => {
        if (!episode.embedding || episode.embedding.length === 0) return false;
        if (queryEmbeddingModel && episode.embeddingModel && episode.embeddingModel !== queryEmbeddingModel) {
          return false;
        }
        return true;
      });

      if (queryText && queryText.trim().length > 0) {
        const corpus = buildBm25Corpus(
          candidates.map((episode) => ({ id: episode.id, text: `${episode.summary} ${episode.userMessage}` })),
        );
        let maxBm25 = 0;
        const scored = candidates.map((episode) => {
          const cos = cosineSimilarity(queryEmbedding, episode.embedding);
          const raw = bm25Score(queryText, episode.id, corpus);
          if (raw > maxBm25) maxBm25 = raw;
          return { episode, cos, raw };
        });
        relevant = scored
          .map(({ episode, cos, raw }) => ({
            episode,
            relevance: 0.6 * cos + 0.4 * (maxBm25 > 0 ? raw / maxBm25 : 0),
          }))
          .filter((r) => r.relevance >= 0.3)
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, maxMemories);
      } else {
        relevant = this.retrieve(queryEmbedding, maxMemories, 0.4, queryEmbeddingModel).map((r) => ({
          episode: r.episode,
          relevance: r.similarity,
        }));
      }

      if (relevant.length === 0 && queryText) {
        relevant = this.bm25Only(queryText, maxMemories);
      }
    } else if (queryText && queryText.trim().length > 0) {
      relevant = this.bm25Only(queryText, maxMemories);
      if (relevant.length === 0) {
        const recent = this.getRecent(maxMemories);
        relevant = recent.map((episode, index) => ({
          episode,
          relevance: Math.max(0.2, 1 - index / (recent.length + 1)),
        }));
      }
    } else {
      const recent = this.getRecent(maxMemories);
      relevant = recent.map((episode, index) => ({
        episode,
        relevance: Math.max(0.2, 1 - index / (recent.length + 1)),
      }));
    }

    const durable = this.listDurableMemories()
      .filter((memory) => memory.confidence >= 0.4)
      .sort(
        (a, b) =>
          b.confidence - a.confidence || a.contradictionCount - b.contradictionCount || b.updatedAt - a.updatedAt,
      )
      .slice(0, Math.max(2, maxMemories))
      .map<PromptMemoryItem>((memory) => ({
        id: memory.id,
        kind: "durable",
        text: `${memory.lane}: ${memory.text}`,
        relevance: memory.confidence,
      }));

    const episodes = relevant.map<PromptMemoryItem>(({ episode, relevance }) => {
      const date = new Date(episode.timestamp).toISOString().slice(0, 10);
      return { id: episode.id, kind: "memory", text: `[${date}] ${episode.summary}`, relevance };
    });

    return [...durable, ...episodes];
  }

  buildMemoryContext(
    queryEmbedding: number[] | null,
    maxMemories: number = 5,
    queryEmbeddingModel?: string,
    queryText?: string,
  ): string {
    return renderPromptMemoryItems(this.buildMemoryItems(queryEmbedding, maxMemories, queryEmbeddingModel, queryText));
  }

  private bm25Only(queryText: string, maxMemories: number): { episode: Episode; relevance: number }[] {
    if (this.episodes.length === 0) return [];
    const corpus = buildBm25Corpus(
      this.episodes.map((episode) => ({ id: episode.id, text: `${episode.summary} ${episode.userMessage}` })),
    );
    let maxScore = 0;
    const scored = this.episodes.map((episode) => {
      const raw = bm25Score(queryText, episode.id, corpus);
      if (raw > maxScore) maxScore = raw;
      return { episode, raw };
    });
    if (maxScore <= 0) return [];
    return scored
      .filter((s) => s.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, maxMemories)
      .map(({ episode, raw }) => ({ episode, relevance: 0.3 + 0.7 * (raw / maxScore) }));
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
