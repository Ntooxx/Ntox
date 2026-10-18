import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { ContextKind } from "./types.js";

export interface ReliabilityEntry {
  success: number;
  failure: number;
  updatedAt: number;
  credit?: number;
}

export interface ReliabilityStats {
  tracked: number;
  avgScore: number;
  weakest: { key: string; score: number }[];
  strongest: { key: string; score: number }[];
}

export interface ReliabilityOptions {
  path?: string;
  now?: () => number;
  maxEntries?: number;
}

export class ReliabilityStore {
  private entries = new Map<string, ReliabilityEntry>();
  private loaded = false;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: ReliabilityOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "reliability.json");
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 5000;
  }

  static key(kind: string, id: string): string {
    return `${kind}:${id}`;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as Record<string, ReliabilityEntry>;
      this.entries = new Map(Object.entries(raw));
    } catch {
      this.entries = new Map();
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.entries), null, 2));
    } catch {
      this.dirty = true;
    }
  }

  record(kind: ContextKind | string, id: string, positive: boolean, score?: number): void {
    this.load();
    const key = ReliabilityStore.key(kind, id);
    const entry = this.entries.get(key) ?? { success: 0, failure: 0, updatedAt: this.now(), credit: 0 };
    if (positive) entry.success += 1;
    else entry.failure += 1;
    if (score !== undefined) {
      entry.credit = Math.max(-0.9, Math.min(0.9, (entry.credit ?? 0) + Math.max(-1, Math.min(1, score)) * 0.25));
    }
    entry.updatedAt = this.now();
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.evict();
    this.dirty = true;
  }

  private evict(): void {
    const sorted = [...this.entries.entries()].sort(
      (a, b) => this.scoreOf(a[1]) - this.scoreOf(b[1]) || a[1].updatedAt - b[1].updatedAt,
    );
    for (let i = 0; i < Math.floor(this.maxEntries * 0.1); i++) this.entries.delete(sorted[i][0]);
  }

  private scoreOf(entry: ReliabilityEntry): number {
    return (entry.success + 1) / (entry.success + entry.failure + 2);
  }

  score(kind: string, id: string): number {
    this.load();
    const entry = this.entries.get(ReliabilityStore.key(kind, id));
    if (!entry) return 0.5;
    const ageDays = (this.now() - entry.updatedAt) / 86_400_000;
    if (ageDays <= 30) return this.scoreOf(entry);
    const decay = Math.pow(0.5, ageDays / 90);
    const success = entry.success * decay;
    const failure = entry.failure * decay;
    return (success + 1) / (success + failure + 2);
  }

  rank<T extends { kind: string; id: string; relevance?: number }>(items: T[]): T[] {
    this.load();
    const factor = (item: T): number => {
      const relevance = item.relevance ?? 0.5;
      const entry = this.entries.get(ReliabilityStore.key(item.kind, item.id));
      if (!entry) return relevance * 0.5;
      const reliability = this.score(item.kind, item.id);
      const ageDays = Math.max(0, (this.now() - entry.updatedAt) / 86_400_000);
      const recency = 0.5 + 0.5 * Math.pow(0.5, ageDays / 60);
      const credit = Math.max(-0.9, Math.min(0.9, entry.credit ?? 0));
      return relevance * reliability * recency * (1 + credit);
    };
    return [...items].sort((a, b) => factor(b) - factor(a));
  }

  stats(): ReliabilityStats {
    this.load();
    const scored = [...this.entries.entries()].map(([key, entry]) => ({ key, score: this.scoreOf(entry) }));
    scored.sort((a, b) => a.score - b.score);
    return {
      tracked: this.entries.size,
      avgScore: scored.length > 0 ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length : 0.5,
      weakest: scored.slice(0, 5),
      strongest: scored.slice(-5).reverse(),
    };
  }

  clear(): void {
    this.load();
    this.entries.clear();
    this.dirty = true;
    this.flush();
  }
}
