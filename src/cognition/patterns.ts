import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { COGNITION_DIR } from "../core/config.js";
import { CognitiveSpace } from "./cognitive-space.js";
import type { CognitivePattern } from "../types/index.js";

const PATTERNS_PATH = join(COGNITION_DIR, "patterns.json");
const COMPILE_THRESHOLD = 5;

function generateName(domains: string[]): string {
  if (domains.length === 0) return "general";
  const prefix = domains.slice(0, 2).join("-");
  const hash = domains.join("").length.toString(16);
  return `${prefix}-${hash}`;
}

function generalizeTemplate(template: string, domains: string[]): string {
  let generalized = template;
  for (const domain of domains) {
    const regex = new RegExp(domain.replace(/_/g, "[-_\\s]?"), "gi");
    generalized = generalized.replace(regex, "{{domain}}");
  }
  return generalized;
}

export class PatternStore {
  private patterns: Map<string, CognitivePattern> = new Map();
  private space: CognitiveSpace;
  private loaded = false;
  private coOccurrenceCounts: Map<string, number> = new Map();
  private compileCount = 0;

  constructor(space: CognitiveSpace) {
    this.space = space;
    if (!existsSync(COGNITION_DIR)) mkdirSync(COGNITION_DIR, { recursive: true });
  }

  private ensureDir(): void {
    if (!existsSync(COGNITION_DIR)) mkdirSync(COGNITION_DIR, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.ensureDir();
    if (existsSync(PATTERNS_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(PATTERNS_PATH, "utf-8"));
        for (const p of raw.patterns || []) {
          // Normalize legacy patterns to new schema
          p.compileCount = p.compileCount || 0;
          p.compiledTemplate = p.compiledTemplate || "";
          this.patterns.set(p.id, p);
        }
        if (raw.coOccurrenceCounts) this.coOccurrenceCounts = new Map(Object.entries(raw.coOccurrenceCounts));
        if (raw.compileCount !== undefined) this.compileCount = raw.compileCount;
      } catch { /* start fresh */ }
    }
    if (this.patterns.size === 0) this.createSeedPatterns();
  }

  private persist(): void {
    this.ensureDir();
    writeFileSync(PATTERNS_PATH, JSON.stringify({
      patterns: Array.from(this.patterns.values()),
      coOccurrenceCounts: Object.fromEntries(this.coOccurrenceCounts),
      compileCount: this.compileCount,
    }, null, 2));
  }

  private createSeedPatterns(): void {
    const seedSets = [
      { domains: ["programming", "python", "javascript"], name: "software-dev", template: "Follow standard software engineering practices. Consider architecture, clean code, testing, and documentation." },
      { domains: ["data_science", "python", "database"], name: "data-analysis", template: "Approach systematically: data understanding, preparation, modeling, evaluation, interpretation." },
      { domains: ["devops", "system_admin", "programming"], name: "infrastructure", template: "Think about reliability, scalability, security, and automation. Prefer battle-tested solutions." },
      { domains: ["design", "javascript", "writing"], name: "user-experience", template: "Focus on usability, aesthetics, and clarity. Consider the end-user perspective." },
    ];
    for (const seed of seedSets) {
      this.patterns.set(`pat_seed_${seed.name}`, {
        id: `pat_seed_${seed.name}`,
        name: seed.name,
        domains: seed.domains,
        vector: this.space.computeQueryVector(seed.domains),
        activatedRules: [],
        reasoningTemplate: seed.template,
        compiledTemplate: "",
        strength: 0.5,
        hitCount: 0,
        compileCount: 0,
        lastActivated: Date.now(),
        created: Date.now(),
      });
    }
    this.persist();
  }

  retrieve(queryVector: number[], queryDomains: string[], limit: number = 3, threshold: number = 0.3): CognitivePattern[] {
    this.load();
    const scored: { pattern: CognitivePattern; score: number }[] = [];
    for (const pattern of this.patterns.values()) {
      const vecSim = this.space.cosineSimilarity(queryVector, pattern.vector);
      const overlap = pattern.domains.filter((d) => queryDomains.includes(d)).length;
      const domainBonus = queryDomains.length > 0 ? overlap / queryDomains.length * 0.3 : 0;
      const totalScore = vecSim + domainBonus;
      if (totalScore >= threshold) scored.push({ pattern, score: totalScore });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.pattern);
  }

  findSimilar(pattern: CognitivePattern, threshold: number = 0.7): CognitivePattern[] {
    this.load();
    return Array.from(this.patterns.values())
      .filter((p) => p.id !== pattern.id)
      .map((p) => ({ p, sim: this.space.cosineSimilarity(pattern.vector, p.vector) }))
      .filter(({ sim }) => sim >= threshold)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map(({ p }) => p);
  }

  compile(patternId: string): CognitivePattern | null {
    this.load();
    const pattern = this.patterns.get(patternId);
    if (!pattern || pattern.compileCount < COMPILE_THRESHOLD) return null;

    const similar = this.findSimilar(pattern, 0.75);

    if (similar.length > 0) {
      // Merge with the most similar pattern — creates an abstraction
      const other = similar[0];
      const mergedDomains = [...new Set([...pattern.domains, ...other.domains])];
      const mergedVector = this.space.computeQueryVector(mergedDomains);
      const abstractTemplate = `When solving a ${mergedDomains.join("-")} problem, consider: ${generalizeTemplate(pattern.reasoningTemplate, pattern.domains)} and ${generalizeTemplate(other.reasoningTemplate, other.domains)}. Focus on the underlying principles rather than domain-specific details.`;

      const compiled: CognitivePattern = {
        id: `pat_compiled_${randomUUID().slice(0, 8)}`,
        name: `abstract-${mergedDomains.slice(0, 2).join("-")}`,
        domains: mergedDomains,
        vector: mergedVector,
        activatedRules: [],
        reasoningTemplate: abstractTemplate,
        compiledTemplate: abstractTemplate,
        strength: Math.max(pattern.strength, other.strength) + 0.1,
        hitCount: 0,
        compileCount: 0,
        lastActivated: Date.now(),
        created: Date.now(),
      };

      this.patterns.set(compiled.id, compiled);
      this.compileCount++;

      // Reduce originals' compile count to prevent recompile loop
      pattern.compileCount = Math.floor(pattern.compileCount / 2);
      other.compileCount = Math.floor(other.compileCount / 2);
      this.persist();
      return compiled;
    }

    // No merge partner — generalize in place
    const generalized = generalizeTemplate(pattern.reasoningTemplate, pattern.domains);
    pattern.compiledTemplate = generalized;
    pattern.reasoningTemplate = `Abstract principle: ${generalized}`;
    pattern.compileCount = 0;
    this.compileCount++;
    this.persist();
    return pattern;
  }

  learnFromQuery(queryDomains: string[]): CognitivePattern | null {
    this.load();
    if (queryDomains.length < 2) return null;

    const sorted = [...queryDomains].sort();
    const key = sorted.join("::");
    const count = (this.coOccurrenceCounts.get(key) || 0) + 1;
    this.coOccurrenceCounts.set(key, count);
    if (this.coOccurrenceCounts.size > 500) {
      const entries = [...this.coOccurrenceCounts.entries()].sort(([, a], [, b]) => b - a).slice(0, 500);
      this.coOccurrenceCounts = new Map(entries);
    }

    if (count >= 3 && !Array.from(this.patterns.values()).some(
      (p) => p.domains.length === queryDomains.length && p.domains.every((d) => queryDomains.includes(d))
    )) {
      const pattern: CognitivePattern = {
        id: `pat_${randomUUID().slice(0, 8)}`,
        name: generateName(queryDomains),
        domains: queryDomains,
        vector: this.space.computeQueryVector(queryDomains),
        activatedRules: [],
        reasoningTemplate: `This is a ${queryDomains.join("-")} problem. Consider the interplay between these domains.`,
        compiledTemplate: "",
        strength: 0.3,
        hitCount: 0,
        compileCount: 0,
        lastActivated: Date.now(),
        created: Date.now(),
      };
      this.patterns.set(pattern.id, pattern);
      this.persist();
      return pattern;
    }
    this.persist();
    this.decay();
    return null;
  }

  strengthen(patternId: string, delta: number = 0.05): CognitivePattern | null {
    this.load();
    const pattern = this.patterns.get(patternId);
    if (!pattern) return null;
    pattern.strength = Math.min(1, pattern.strength + delta);
    pattern.hitCount++;
    pattern.compileCount = (pattern.compileCount || 0) + 1;
    pattern.compiledTemplate = pattern.compiledTemplate || "";
    pattern.lastActivated = Date.now();
    if (pattern.hitCount % 10 === 0) this.prune();
    this.persist();
    return pattern;
  }

  weaken(patternId: string, delta: number = 0.03): void {
    this.load();
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.strength = Math.max(0, pattern.strength - delta);
      this.persist();
    }
  }

  getCompilationStats(): { total: number; compiled: number; abstract: number; seed: number } {
    this.load();
    const all = Array.from(this.patterns.values());
    return {
      total: all.length,
      compiled: all.filter((p) => p.compiledTemplate && p.compiledTemplate.length > 0).length,
      abstract: all.filter((p) => p.id.startsWith("pat_compiled")).length,
      seed: all.filter((p) => p.id.startsWith("pat_seed")).length,
    };
  }

  list(): CognitivePattern[] {
    this.load();
    return Array.from(this.patterns.values()).sort((a, b) => b.strength - a.strength);
  }

  count(): number { this.load(); return this.patterns.size; }

  get(id: string): CognitivePattern | undefined { this.load(); return this.patterns.get(id); }

  prune(maxPatterns: number = 100): number {
    this.load();
    if (this.patterns.size <= maxPatterns) return 0;
    const sorted = Array.from(this.patterns.entries()).map(([id, p]) => ({ id, p }))
      .sort((a, b) => a.p.strength - b.p.strength || a.p.lastActivated - b.p.lastActivated);
    const toRemove = sorted.slice(0, this.patterns.size - maxPatterns);
    for (const { id } of toRemove) this.patterns.delete(id);
    this.persist();
    return toRemove.length;
  }

  decay(threshold: number = 0.05): number {
    this.load();
    let count = 0;
    for (const [id, pattern] of this.patterns) {
      if (pattern.strength < threshold && !id.startsWith("pat_seed")) {
        this.patterns.delete(id);
        count++;
      }
    }
    if (count > 0) this.persist();
    return count;
  }

  clearAll(): void {
    this.patterns.clear();
    this.coOccurrenceCounts.clear();
    this.compileCount = 0;
    this.persist();
  }

  importPrimitive(name: string, description: string, domains: string[], rules: string[], confidence: number): CognitivePattern {
    this.load();
    const id = `pat_research_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const existing = this.patterns.get(id);
    if (existing) {
      existing.strength = Math.min(1, existing.strength + 0.1);
      existing.hitCount++;
      existing.lastActivated = Date.now();
      this.persist();
      return existing;
    }

    const pattern: CognitivePattern = {
      id,
      name,
      domains,
      vector: this.space.computeQueryVector(domains),
      activatedRules: rules,
      reasoningTemplate: description,
      compiledTemplate: `[Research primitive] ${description}`,
      strength: Math.min(1, confidence),
      hitCount: 1,
      compileCount: 0,
      lastActivated: Date.now(),
      created: Date.now(),
    };

    this.patterns.set(id, pattern);
    this.persist();
    return pattern;
  }

  importPrimitivesBulk(
    primitives: Array<{ name: string; description: string; domains: string[]; rules: string[]; confidence: number }>
  ): number {
    let count = 0;
    for (const p of primitives) {
      this.importPrimitive(p.name, p.description, p.domains, p.rules, p.confidence);
      count++;
    }
    return count;
  }
}
