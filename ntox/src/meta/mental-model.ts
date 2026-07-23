import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const MENTAL_MODEL_PATH = join(NTOX_DIR, "mental-model.json");

const MAX_ENTRIES = 200;

const OPINION_PATTERNS = [
  /i (?:think|believe|feel|find|consider)\s+(.+?)(?:\.|,|$)/i,
  /in my (?:experience|opinion|view),?\s*(.+?)(?:\.|,|$)/i,
  /(?:the truth is|the thing is|honestly|frankly),?\s*(.+?)(?:\.|,|$)/i,
];

const GENERALIZATION_PATTERNS = [
  /(.+?)\s+(?:always|never|usually|rarely|often|tend to|typically)\s+(.+?)(?:\.|,|$)/i,
  /users?\s+(?:want|need|like|prefer|hate|don'?t like)\s+(.+?)(?:\.|,|$)/i,
  /people\s+(?:who|when|don'?t|always|never)\s+(.+?)(?:\.|,|$)/i,
];

const COMPARISON_PATTERNS = [
  /(.+?)\s+(?:is better|is worse|is more|is less|matters more|matters less)\s+(?:than\s+)?(.+?)(?:\.|,|$)/i,
  /(.+?)\s+(?:beats|outperforms|outshines)\s+(.+?)(?:\.|,|$)/i,
];

const ASSUMPTION_PATTERNS = [
  /(?:assuming|given that|given)\s+(.+?)(?:\.|,|$)/i,
];

const CONTRADICTION_PAIRS: [string, string][] = [
  ["hate", "like"], ["hate", "love"], ["hate", "prefer"],
  ["bad", "good"], ["worst", "best"], ["hard", "easy"],
  ["slow", "fast"], ["complex", "simple"],
  ["expensive", "cheap"], ["useless", "useful"],
  ["never", "always"], ["nobody", "everyone"],
  ["broken", "works"], ["wrong", "right"],
  ["ugly", "beautiful"], ["waste", "worth"],
  ["don't", "do"], ["doesn't", "does"], ["won't", "will"],
  ["isn't", "is"], ["can't", "can"],
];

const NEGATION_WORDS = new Set([
  "never", "not", "nobody", "nothing", "no", "cannot",
  "don't", "doesn't", "didn't", "won't", "can't", "couldn't",
  "shouldn't", "isn't", "aren't",
]);

export type MentalModelStatus = "active" | "challenged" | "evolved" | "abandoned";
export type MentalModelCategory = "opinion" | "generalization" | "comparison" | "assumption";

export interface MentalModelEntry {
  id: string;
  statement: string;
  category: MentalModelCategory;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  sourceContext: string;
  contradictions: string[];
  status: MentalModelStatus;
}

export class MentalModel {
  private entries: MentalModelEntry[] = [];
  private dirty = false;
  private path: string;

  constructor(path?: string) {
    this.path = path ?? MENTAL_MODEL_PATH;
    this.entries = this.load();
  }

  private load(): MentalModelEntry[] {
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
      writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
      writeFileSync(this.path, readFileSync(tmp, "utf-8"));
    } catch { }
    try { unlinkSync(tmp); } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  extractFromConversation(text: string): void {
    const extracted: string[] = [];

    const tryExtract = (s: string, category: MentalModelCategory): void => {
      if (s.length < 5 || s.length > 150) return;
      const key = s.toLowerCase().slice(0, 30);
      if (extracted.some((e) => e.includes(key) || key.includes(e))) return;
      extracted.push(key);
      this.recordEntry(s, category);
    };

    for (const pattern of OPINION_PATTERNS) {
      const m = pattern.exec(text);
      if (m && m[1]) tryExtract(m[1].trim(), "opinion");
    }

    for (const pattern of GENERALIZATION_PATTERNS) {
      const m = pattern.exec(text);
      if (m) tryExtract(m[0].trim(), "generalization");
    }

    for (const pattern of COMPARISON_PATTERNS) {
      const m = pattern.exec(text);
      if (m) {
        const a = m[1].trim();
        const b = m[2].trim();
        tryExtract(a.length > b.length ? `${a} prioritized over ${b}` : `${a} over ${b}`, "comparison");
      }
    }

    for (const pattern of ASSUMPTION_PATTERNS) {
      const m = pattern.exec(text);
      if (m && m[1]) tryExtract(m[1].trim(), "assumption");
    }

    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => b.lastSeen - a.lastSeen);
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }

    if (this.dirty) this.persist();
  }

  private recordEntry(statement: string, category: MentalModelCategory): void {
    const normalized = this.normalize(statement);
    const existing = this.findSimilar(normalized);

    if (existing) {
      if (this.isContradictingStrings(normalized, existing.statement)) {
        const newEntry = this.buildEntry(statement, category, [existing.id]);
        newEntry.status = "challenged";
        existing.contradictions.push(newEntry.id);
        existing.status = "challenged";
        this.entries.push(newEntry);
        this.dirty = true;
        return;
      }
      existing.lastSeen = Date.now();
      existing.mentionCount++;
      this.dirty = true;
      return;
    }

    const entry = this.buildEntry(statement, category, []);

    for (const other of this.entries) {
      if (other.status === "abandoned" || other.status === "evolved") continue;
      if (this.isContradictingStrings(entry.statement, other.statement)) {
        entry.contradictions.push(other.id);
        other.contradictions.push(entry.id);
        entry.status = "challenged";
        other.status = "challenged";
        this.dirty = true;
      }
    }

    this.entries.push(entry);
    this.dirty = true;
  }

  private buildEntry(statement: string, category: MentalModelCategory, contradictions: string[]): MentalModelEntry {
    return {
      id: `mm_${randomUUID().slice(0, 8)}`,
      statement,
      category,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      mentionCount: 1,
      sourceContext: statement.slice(0, 200),
      contradictions: [...contradictions],
      status: "active",
    };
  }

  private isContradictingStrings(a: string, b: string): boolean {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    for (const [wordA, wordB] of CONTRADICTION_PAIRS) {
      if ((aLower.includes(wordA) && bLower.includes(wordB)) ||
          (aLower.includes(wordB) && bLower.includes(wordA))) {
        return true;
      }
    }

    const aNeg = this.hasNegation(aLower);
    const bNeg = this.hasNegation(bLower);

    if (aNeg !== bNeg) {
      const aWords = new Set(aLower.split(/\s+/).filter((w) => w.length > 3));
      const bWords = new Set(bLower.split(/\s+/).filter((w) => w.length > 3));
      let overlap = 0;
      for (const w of aWords) {
        if (bWords.has(w)) overlap++;
      }
      if (overlap >= 2) return true;
    }

    return false;
  }

  private hasNegation(text: string): boolean {
    for (const word of NEGATION_WORDS) {
      if (text.includes(word)) return true;
    }
    if (/\bnot\s+\w+|n't\s+\w+|never\s+\w+/i.test(text)) return true;
    return false;
  }

  private findSimilar(normalized: string): MentalModelEntry | null {
    const words = normalized.split(/\s+/).filter((w) => w.length > 2);

    for (const entry of this.entries) {
      const entryLower = entry.statement.toLowerCase();
      const matchCount = words.filter((w) => entryLower.includes(w)).length;
      if (matchCount >= Math.max(1, Math.floor(words.length * 0.4))) {
        return entry;
      }
    }

    return null;
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  }

  getActiveEntries(): MentalModelEntry[] {
    return this.entries.filter((e) => e.status === "active");
  }

  getChallengedEntries(): MentalModelEntry[] {
    return this.entries.filter((e) => e.status === "challenged");
  }

  getEvolvedEntries(): MentalModelEntry[] {
    return this.entries.filter((e) => e.status === "evolved");
  }

  getAbandonedEntries(): MentalModelEntry[] {
    return this.entries.filter((e) => e.status === "abandoned");
  }

  getAllEntries(): MentalModelEntry[] {
    return [...this.entries];
  }

  getContradictions(): { entry: MentalModelEntry; contradictedBy: MentalModelEntry }[] {
    const result: { entry: MentalModelEntry; contradictedBy: MentalModelEntry }[] = [];
    for (const entry of this.entries) {
      if (entry.contradictions.length === 0) continue;
      for (const cId of entry.contradictions) {
        const other = this.entries.find((e) => e.id === cId);
        if (other) result.push({ entry, contradictedBy: other });
      }
    }
    return result;
  }

  buildContext(): string {
    const active = this.getActiveEntries();
    const challenged = this.getChallengedEntries();
    if (active.length === 0 && challenged.length === 0) return "";
    const parts: string[] = [];
    if (active.length > 0) {
      const recent = active.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 5);
      parts.push("User's mental models:", ...recent.map((e) => `  - ${e.statement}`));
    }
    if (challenged.length > 0) {
      const recent = challenged.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 3);
      if (recent.length > 0) {
        parts.push("Conflicting views:");
        for (const entry of recent) {
          const others = this.entries.filter((e) => entry.contradictions.includes(e.id));
          for (const other of others) {
            parts.push(`  - "${entry.statement}" contradicts "${other.statement}"`);
          }
        }
      }
    }
    return parts.length > 0 ? `\n\n## Mental Model\n${parts.join("\n")}` : "";
  }

  clearAll(): void {
    this.entries = [];
    this.dirty = true;
    this.persist();
  }

  markEvolved(entryId: string): void {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) { entry.status = "evolved"; this.dirty = true; this.persist(); }
  }

  markAbandoned(entryId: string): void {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) { entry.status = "abandoned"; this.dirty = true; this.persist(); }
  }
}