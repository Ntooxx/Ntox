import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { clamp } from "./util.js";

export interface IdentityPosition {
  topic: string;
  stance: string;
  confidence: number;
  evidence: string[];
  updatedAt: number;
}

export interface IdentityRevision {
  at: number;
  topic: string;
  change: string;
}

export interface IdentityData {
  narrative: string;
  values: string[];
  activeProjects: string[];
  positions: IdentityPosition[];
  revisionLog: IdentityRevision[];
}

export interface Fingerprint {
  hash: string;
  positions: number;
  values: number;
}

export interface IdentityOptions {
  path?: string;
  now?: () => number;
}

const DEFAULT_VALUES = ["evidence over fluency", "learn from correction"];

export class IdentityStore {
  private data: IdentityData;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;

  constructor(options: IdentityOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "identity.json");
    this.now = options.now ?? Date.now;
    this.data = this.load();
  }

  private load(): IdentityData {
    const fallback: IdentityData = {
      narrative: "",
      values: [...DEFAULT_VALUES],
      activeProjects: [],
      positions: [],
      revisionLog: [],
    };
    if (!existsSync(this.path)) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(readFileSync(this.path, "utf-8")) as IdentityData) };
    } catch {
      return fallback;
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.path);
    } catch {
      this.dirty = true;
    }
  }

  get(): IdentityData {
    return {
      ...this.data,
      positions: this.data.positions.map((p) => ({ ...p, evidence: [...p.evidence] })),
      values: [...this.data.values],
      revisionLog: [...this.data.revisionLog],
    };
  }

  setNarrative(text: string): void {
    this.data.narrative = text.slice(0, 600);
    this.dirty = true;
    this.flush();
  }

  setValues(values: string[]): void {
    this.data.values = values.slice(0, 12).map((v) => v.slice(0, 120));
    this.dirty = true;
    this.flush();
  }

  addPosition(topic: string, stance: string, confidence: number, evidence: string[] = []): IdentityPosition {
    const now = this.now();
    const normalizedTopic = topic.trim().toLowerCase().slice(0, 80);
    const existing = this.data.positions.find((p) => p.topic.toLowerCase() === normalizedTopic);
    if (existing) {
      if (existing.stance !== stance) {
        this.data.revisionLog.push({
          at: now,
          topic: normalizedTopic,
          change: `revised from "${existing.stance}" to "${stance}"`,
        });
        existing.stance = stance.slice(0, 300);
      }
      existing.confidence = Math.max(existing.confidence, clamp(confidence, 0, 1));
      existing.evidence = [...new Set([...existing.evidence, ...evidence])].slice(-8);
      existing.updatedAt = now;
      this.data.positions.sort((a, b) => b.updatedAt - a.updatedAt);
      if (this.data.positions.length > 50) this.data.positions = this.data.positions.slice(0, 50);
      this.dirty = true;
      this.flush();
      return { ...existing };
    }

    const position: IdentityPosition = {
      topic: normalizedTopic,
      stance: stance.slice(0, 300),
      confidence: clamp(confidence, 0, 1),
      evidence: evidence.slice(0, 8),
      updatedAt: now,
    };
    this.data.positions.unshift(position);
    this.data.revisionLog.push({ at: now, topic: normalizedTopic, change: `added "${stance.slice(0, 80)}"` });
    if (this.data.positions.length > 50) this.data.positions = this.data.positions.slice(0, 50);
    if (this.data.revisionLog.length > 100) this.data.revisionLog = this.data.revisionLog.slice(-100);
    this.dirty = true;
    this.flush();
    return { ...position };
  }

  setActiveProjects(projects: string[]): void {
    this.data.activeProjects = [...new Set(projects.map((p) => p.trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
    this.dirty = true;
    this.flush();
  }

  strengthenPosition(topic: string, amount = 0.08): IdentityPosition | null {
    const normalizedTopic = topic.trim().toLowerCase().slice(0, 80);
    const existing = this.data.positions.find((p) => p.topic.toLowerCase() === normalizedTopic);
    if (!existing) return null;
    existing.confidence = clamp(existing.confidence + Math.max(0, amount), 0, 1);
    existing.updatedAt = this.now();
    this.data.positions.sort((a, b) => b.updatedAt - a.updatedAt);
    this.dirty = true;
    this.flush();
    return { ...existing };
  }

  challengePosition(topic: string, reason: string, factor = 0.75): IdentityPosition | null {
    const now = this.now();
    const normalizedTopic = topic.trim().toLowerCase().slice(0, 80);
    const existing = this.data.positions.find((p) => p.topic.toLowerCase() === normalizedTopic);
    if (!existing) return null;
    existing.confidence = clamp(existing.confidence * clamp(factor, 0, 1), 0, 1);
    existing.updatedAt = now;
    this.data.revisionLog.push({ at: now, topic: normalizedTopic, change: `challenged: ${reason.slice(0, 120)}` });
    if (this.data.revisionLog.length > 100) this.data.revisionLog = this.data.revisionLog.slice(-100);
    this.dirty = true;
    this.flush();
    return { ...existing };
  }

  decayStalePositions(maxAgeMs: number, minConfidence = 0.35, referenceNow?: number): number {
    const now = referenceNow ?? this.now();
    const before = this.data.positions.length;
    this.data.positions = this.data.positions.filter(
      (p) => now - p.updatedAt <= maxAgeMs || p.confidence >= minConfidence,
    );
    const removed = before - this.data.positions.length;
    if (removed > 0) {
      this.data.revisionLog.push({
        at: now,
        topic: "*",
        change: `decayed ${removed} stale low-confidence position(s)`,
      });
      if (this.data.revisionLog.length > 100) this.data.revisionLog = this.data.revisionLog.slice(-100);
      this.dirty = true;
      this.flush();
    }
    return removed;
  }

  positionsMatching(topics: string[]): IdentityPosition[] {
    const wanted = topics.map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (wanted.length === 0) return [];
    return this.data.positions.filter((p) => wanted.some((t) => p.topic.includes(t) || t.includes(p.topic)));
  }

  summary(): string {
    const parts: string[] = [];
    if (this.data.narrative) parts.push(`## Identity\n${this.data.narrative}`);
    const topPositions = this.data.positions.filter((p) => p.confidence >= 0.5).slice(0, 3);
    if (topPositions.length > 0) {
      const lines = topPositions.map((p) => `- On ${p.topic}: ${p.stance} (${Math.round(p.confidence * 100)}%)`);
      parts.push(`## Established Positions\n${lines.join("\n")}`);
    }
    return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
  }

  fingerprint(extra?: unknown): Fingerprint {
    const payload = JSON.stringify({
      narrative: this.data.narrative,
      values: [...this.data.values].sort(),
      positions: this.data.positions
        .map((p) => ({ topic: p.topic, stance: p.stance, confidence: Math.round(p.confidence * 10) / 10 }))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
      extra,
    });
    return {
      hash: createHash("sha256").update(payload).digest("hex").slice(0, 16),
      positions: this.data.positions.length,
      values: this.data.values.length,
    };
  }

  clear(): void {
    this.data = {
      narrative: "",
      values: [...DEFAULT_VALUES],
      activeProjects: [],
      positions: [],
      revisionLog: [],
    };
    this.dirty = true;
    this.flush();
  }
}
