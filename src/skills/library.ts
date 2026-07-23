import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NTOX_DIR } from "../core/config.js";
import { cosineSimilarity } from "../memory/episodic.js";
import type { SkillDefinition } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXTERNAL_SKILLS_PATH = join(NTOX_DIR, "external-skills-index.json");
export const BUNDLED_SKILLS_PATH = join(__dirname, "..", "..", "skills");

export interface SkillIndex {
  name: string;
  description: string;
  category: string;
  domain: string;
  importance: number;
  triggers: string[];
  contentPath: string;
  voices: string[];
  combos: string[];
  fileName: string;
  sizeKB: number;
  sections: string[];
}

export class SkillLibrary {
  private index: Map<string, SkillIndex> = new Map();
  private loaded = false;
  private contentCache = new Map<string, string>();
  private externalPath: string;

  constructor(externalPath?: string) {
    this.externalPath = externalPath || BUNDLED_SKILLS_PATH;
  }

  private ensureDir(): void {
    if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
  }

  scan(): { total: number; domains: number } {
    if (!existsSync(this.externalPath)) {
      console.error(`[skill-library] External skills path not found: ${this.externalPath}`);
      return { total: 0, domains: 0 };
    }

    const dirs = readdirSync(this.externalPath, { withFileTypes: true });
    let total = 0;
    const seenDomains = new Set<string>();

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const domainPath = join(this.externalPath, dir.name);
      seenDomains.add(dir.name);
      total += this.scanDirectory(domainPath, dir.name);
    }

    this.loaded = true;
    this.persistIndex();
    return { total, domains: seenDomains.size };
  }

  private scanDirectory(dirPath: string, domain: string, subdomain?: string): number {
    let count = 0;
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          count += this.scanDirectory(fullPath, domain, entry.name);
        } else if (entry.name.endsWith(".md") && !/^(INDEX|README)/i.test(entry.name)) {
          const skill = this.indexFile(fullPath, domain, subdomain);
          if (skill) { this.index.set(skill.name, skill); count++; }
        }
      }
    } catch { /* skip unreadable */ }
    return count;
  }

  private indexFile(filePath: string, domain: string, subdomain?: string): SkillIndex | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const title = lines[0]?.replace(/^#\s+/, "").trim() || basename(filePath).replace(/\.md$/, "");
      const fileName = basename(filePath).replace(/\.md$/, "");
      const numberMatch = fileName.match(/^(\d+)_/);
      const number = numberMatch ? parseInt(numberMatch[1]) : 0;
      const cleanName = fileName.replace(/^\d+_/, "").replace(/_/g, " ");

      const purpose = this.extractSection(content, "Purpose") || this.extractSection(content, "Core Principle") || "";
      const description = purpose.length > 120 ? purpose.slice(0, 117) + "..." : purpose;

      const triggers = this.extractTriggers(cleanName, title, purpose, lines.slice(0, 10).join(" "), content);
      const sections = this.extractSectionNames(lines);
      const voices = this.extractVoices(content);
      const combos = this.extractCombos(content, cleanName);
      const importance = this.extractImportance(content, number, domain);

      const stat = statSync(filePath);

      return {
        name: cleanName,
        description,
        category: subdomain || domain,
        domain,
        importance: Math.min(10, Math.max(1, importance)),
        triggers,
        contentPath: filePath,
        voices,
        combos,
        fileName,
        sizeKB: Math.round(stat.size / 1024),
        sections,
      };
    } catch {
      return null;
    }
  }

  private extractSection(content: string, heading: string): string {
    const regex = new RegExp(`## ${heading}\\s*\\n\\n([\\s\\S]*?)(?:\\n## |\\n---|$)`);
    const match = regex.exec(content);
    if (!match) return "";
    return match[1].trim();
  }

  private extractSectionNames(lines: string[]): string[] {
    return lines
      .filter((l) => l.startsWith("## ") && !l.startsWith("### "))
      .map((l) => l.replace(/^##\s+/, "").trim())
      .filter(Boolean);
  }

  private extractTriggers(name: string, title: string, purpose: string, firstLines: string, content: string): string[] {
    const triggerSection = this.extractSection(content, "Triggers");
    if (triggerSection) {
      const curated = triggerSection.split("\n")
        .map((l) => l.replace(/^[-*\s"]+|"$/g, "").trim())
        .filter((l) => l.length > 0);
      if (curated.length > 0) return curated;
    }

    const triggers = new Set<string>();
    const combined = `${name} ${title} ${purpose} ${firstLines}`.toLowerCase();

    const words = combined.split(/\s+/).filter((w) => w.length > 3 && !/^\d+$/.test(w));
    for (const w of words) triggers.add(w);

    const titleWords = title.toLowerCase().split(/\s+/);
    for (let i = 0; i < titleWords.length - 1; i++) {
      if (titleWords[i].length > 2 && titleWords[i + 1].length > 2) {
        triggers.add(`${titleWords[i]} ${titleWords[i + 1]}`);
      }
    }

    return Array.from(triggers).slice(0, 20);
  }

  private extractVoices(content: string): string[] {
    const voices: string[] = [];
    const voiceMatch = content.match(/\| \*\*(\w+)\*\* \|/g);
    if (voiceMatch) {
      for (const m of voiceMatch) {
        const v = m.replace(/\| \*\*/, "").replace(/\*\* \|/, "").trim();
        voices.push(v);
      }
    }
    return voices;
  }

  private extractCombos(content: string, _name: string): string[] {
    const combos: string[] = [];
    const comboSection = content.match(/Recommended Combinations[^]*?(?=\n## |$)/);
    if (comboSection) {
      const lines = comboSection[0].split("\n");
      for (const line of lines) {
        const match = line.match(/\d+_\w+/g);
        if (match) combos.push(...match.map((m) => m.replace(/^\d+_/, "").replace(/_/g, " ")));
      }
    }
    return combos;
  }

  private extractImportance(content: string, number: number, _domain: string): number {
    const impMatch = content.match(/importance["':\s]*(\d+(?:\.\d+)?)/i);
    if (impMatch) return parseFloat(impMatch[1]);
    // Fallback: higher numbers tend to be more important in the ordering
    return Math.min(10, Math.max(5, Math.round(5 + (45 - number) / 45 * 5)));
  }

  private persistIndex(): void {
    this.ensureDir();
    const data = Array.from(this.index.values());
    writeFileSync(EXTERNAL_SKILLS_PATH, JSON.stringify(data, null, 2));
  }

  private loadPersistedIndex(): boolean {
    if (!existsSync(EXTERNAL_SKILLS_PATH)) return false;
    try {
      const data = JSON.parse(readFileSync(EXTERNAL_SKILLS_PATH, "utf-8")) as SkillIndex[];
      for (const s of data) this.index.set(s.name, s);
      this.loaded = true;
      return true;
    } catch { return false; }
  }

  ensureLoaded(): void {
    if (this.loaded) return;
    if (!this.loadPersistedIndex()) {
      this.scan();
    }
  }

  search(query: string, maxResults: number = 5): SkillIndex[] {
    this.ensureLoaded();
    const lower = query.toLowerCase();
    const queryWords = lower.split(/\s+/).filter((w) => w.length > 2);

    const scored: { skill: SkillIndex; score: number }[] = [];

    for (const skill of this.index.values()) {
      let score = 0;
      for (const word of queryWords) {
        if (skill.name.toLowerCase().includes(word)) score += 5;
        if (skill.triggers.some((t) => t.includes(word))) score += 3;
        if (skill.description.toLowerCase().includes(word)) score += 2;
        if (skill.category.toLowerCase().includes(word)) score += 4;
        if (skill.domain.toLowerCase().includes(word)) score += 3;
        if (skill.voices.some((v) => v.toLowerCase().includes(word))) score += 2;
      }
      // Boost by importance
      score *= 1 + skill.importance / 20;
      if (score > 0) scored.push({ skill, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.skill);
  }

  embedSearch(queryEmbedding: number[], maxResults: number = 5): { skill: SkillIndex; similarity: number }[] {
    this.ensureLoaded();
    const results: { skill: SkillIndex; similarity: number }[] = [];

    for (const skill of this.index.values()) {
      const desc = `${skill.name} ${skill.description} ${skill.triggers.join(" ")}`.trim();
      const skillEmbedding = this.hashEmbed(desc, queryEmbedding.length);
      if (!skillEmbedding) continue;
      const sim = cosineSimilarity(queryEmbedding, skillEmbedding);
      if (sim > 0.15) {
        results.push({ skill, similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }

  private hashEmbed(text: string, dimensions: number): number[] {
    const vec = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      let hash = 0;
      for (let j = 0; j < words[i].length; j++) {
        hash = ((hash << 5) - hash) + words[i].charCodeAt(j);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dimensions;
      vec[idx] += 1;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= mag;
    }
    return vec;
  }

  get(domain: string): SkillIndex[] {
    this.ensureLoaded();
    const lower = domain.toLowerCase();
    return Array.from(this.index.values())
      .filter((s) => s.domain.toLowerCase() === lower || s.category.toLowerCase().includes(lower))
      .sort((a, b) => b.importance - a.importance);
  }

  byName(name: string): SkillIndex | undefined {
    this.ensureLoaded();
    const lower = name.toLowerCase();
    return Array.from(this.index.values()).find(
      (s) => s.name.toLowerCase() === lower || s.fileName.toLowerCase() === lower
    );
  }

  getDomains(): string[] {
    this.ensureLoaded();
    const domains = new Set<string>();
    for (const s of this.index.values()) domains.add(s.domain);
    return Array.from(domains).sort();
  }

  loadContent(name: string): string | null {
    const skill = this.byName(name);
    if (!skill) return null;

    if (this.contentCache.has(skill.name)) return this.contentCache.get(skill.name)!;

    try {
      const content = readFileSync(skill.contentPath, "utf-8");
      this.contentCache.set(skill.name, content);
      if (this.contentCache.size > 20) {
        const firstKey = this.contentCache.keys().next().value;
        if (firstKey) this.contentCache.delete(firstKey);
      }
      return content;
    } catch {
      return null;
    }
  }

  getContextForQuery(name: string, query: string): string | null {
    const content = this.loadContent(name);
    if (!content) return null;

    const skill = this.byName(name);
    if (!skill) return null;

    const lower = query.toLowerCase();
    const matchedSections: string[] = [];

    // Find matching sections
    for (const section of skill.sections) {
      const sectionContent = this.extractSection(content, section);
      if (sectionContent && (section.toLowerCase().includes(lower) || sectionContent.toLowerCase().includes(lower))) {
        matchedSections.push(`## ${section}\n\n${sectionContent}`);
      }
    }

    if (matchedSections.length === 0) {
      // No section match — return purpose + principles + first matching content
      const purpose = this.extractSection(content, "Purpose");
      const principle = this.extractSection(content, "Core Principle");
      const parts = [`# ${skill.name}`, purpose ? `\n\n${purpose}` : "", principle ? `\n\n${principle}` : ""].filter(Boolean);
      return parts.join("\n");
    }

    return `# ${skill.name} (relevant sections)\n\n${matchedSections.join("\n\n---\n\n")}`;
  }

  getSummary(name: string): string | null {
    const skill = this.byName(name);
    if (!skill) return null;
    const voices = skill.voices.length > 0 ? ` [${skill.voices.join(", ")}]` : "";
    const combos = skill.combos.length > 0 ? `\n  Combos: ${skill.combos.slice(0, 3).join(", ")}` : "";
    return `${chalkLabel(skill.name)} (${skill.importance}/10) — ${skill.domain}${voices}\n  ${skill.description}${combos}`;
  }

  findByTrigger(query: string): { skill: SkillIndex; confidence: number }[] {
    this.ensureLoaded();
    const lower = query.toLowerCase();
    const matches: { skill: SkillIndex; confidence: number }[] = [];

    for (const skill of this.index.values()) {
      let bestConfidence = 0;
      for (const trigger of skill.triggers) {
        const tLower = trigger.toLowerCase();
        if (lower.includes(tLower)) {
          const confidence = 0.3 + (tLower.length / lower.length) * 0.7;
          bestConfidence = Math.max(bestConfidence, Math.min(confidence, 0.95));
        }
      }
      if (bestConfidence > 0) {
        matches.push({ skill, confidence: bestConfidence });
      }
    }
    matches.sort((a, b) => b.confidence - a.confidence);
    return matches;
  }

  toSkillDefinition(skill: SkillIndex): SkillDefinition {
    return {
      name: skill.name,
      description: skill.description,
      category: skill.category,
      prompt: this.loadContent(skill.name) ?? skill.description,
      triggers: skill.triggers,
      tools: [],
      examples: [],
      created: Date.now(),
      updated: Date.now(),
      usageCount: 0,
      domain: skill.domain,
      importance: skill.importance,
      contentPath: skill.contentPath,
      voices: skill.voices,
      combos: skill.combos,
      isExternal: true,
    };
  }

  getStats(): { total: number; domains: number; totalSizeKB: number } {
    this.ensureLoaded();
    let totalSizeKB = 0;
    for (const s of this.index.values()) totalSizeKB += s.sizeKB;
    return {
      total: this.index.size,
      domains: this.getDomains().length,
      totalSizeKB,
    };
  }

  exportSkill(name: string): { definition: SkillDefinition; content: string } | null {
    this.ensureLoaded();
    const skill = this.byName(name);
    if (!skill) return null;
    const content = this.loadContent(skill.name);
    const definition = this.toSkillDefinition(skill);
    return { definition, content: content ?? "" };
  }

  exportAsMarkdown(name: string): string | null {
    const exportData = this.exportSkill(name);
    if (!exportData) return null;
    const def = exportData.definition;
    let md = `# ${def.name}\n\n`;
    md += `## Triggers\n`;
    for (const t of def.triggers) md += `- "${t}"\n`;
    md += `\n## Purpose\n${def.description}\n\n`;
    if ((def.voices ?? []).length > 0) md += `## Voices\n${(def.voices ?? []).join(", ")}\n\n`;
    if ((def.combos ?? []).length > 0) md += `## Recommended Combinations\n${(def.combos ?? []).join(", ")}\n\n`;
    md += `## Prompt\n${def.prompt}\n`;
    return md;
  }
}

function chalkLabel(s: string): string {
  return s;
}
