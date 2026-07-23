import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR } from "../core/config.js";
import type { SkillDefinition } from "../types/index.js";

const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    name: "summarize-file",
    description: "Read and summarize any file with key points",
    category: "utility",
    prompt: "When asked to summarize a file, first use the read tool to get its contents, then provide a concise summary with 3-5 bullet points covering the main purpose, key functions, and notable patterns.",
    triggers: ["summarize", "summary of", "tl;dr"],
    tools: ["read"],
    examples: ["summarize src/index.ts", "can you summarize the main file?"],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  },
  {
    name: "explain-code",
    description: "Explain what a piece of code does in plain language",
    category: "learning",
    prompt: "When asked to explain code, first read the file if a path is given, then explain what the code does section by section. Cover: purpose, input/output, key algorithms, edge cases.",
    triggers: ["explain code", "what does this code do", "explain this"],
    tools: ["read"],
    examples: ["explain the agent.ts file", "what does this function do?"],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  },
  {
    name: "find-bugs",
    description: "Analyze code for potential bugs and issues",
    category: "coding",
    prompt: "When asked to find bugs, read the file, then analyze for: null reference risks, type mismatches, race conditions, memory leaks, logic errors, security issues. Rate severity as low/medium/high/critical and suggest fixes.",
    triggers: ["find bugs", "bug hunt", "code review", "find issues"],
    tools: ["read", "grep"],
    examples: ["find bugs in src/core/agent.ts", "code review the tools directory"],
    created: Date.now(),
    updated: Date.now(),
    usageCount: 0,
  },
];

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private loaded = false;

  constructor() {
    if (!existsSync(SKILLS_DIR)) {
      mkdirSync(SKILLS_DIR, { recursive: true });
    }
  }

  private ensureDir(): void {
    if (!existsSync(SKILLS_DIR)) {
      mkdirSync(SKILLS_DIR, { recursive: true });
    }
  }

  private skillPath(name: string): string {
    return join(SKILLS_DIR, `${name.replace(/[^a-z0-9-]/gi, "_")}.json`);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    // Load built-in skills
    for (const skill of BUILT_IN_SKILLS) {
      this.skills.set(skill.name, { ...skill });
    }

    // Load user-created skills
    this.ensureDir();
    try {
      const files = readdirSync(SKILLS_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = readFileSync(join(SKILLS_DIR, file), "utf-8");
          const skill = JSON.parse(raw) as SkillDefinition;
          if (skill.name) {
            // User skills override built-in
            this.skills.set(skill.name, skill);
          }
        } catch {
          // skip corrupt files
        }
      }
    } catch {
      // no skills dir yet
    }
  }

  private persist(skill: SkillDefinition): void {
    this.ensureDir();
    writeFileSync(this.skillPath(skill.name), JSON.stringify(skill, null, 2));
  }

  private deleteFile(name: string): void {
    const path = this.skillPath(name);
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
    }
  }

  list(): SkillDefinition[] {
    this.load();
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): SkillDefinition | undefined {
    this.load();
    return this.skills.get(name);
  }

  add(skill: SkillDefinition): void {
    this.load();
    this.skills.set(skill.name, skill);
    this.persist(skill);
  }

  remove(name: string): boolean {
    this.load();
    const builtIn = BUILT_IN_SKILLS.some((s) => s.name === name);
    if (builtIn) return false;
    const existed = this.skills.delete(name);
    if (existed) {
      this.deleteFile(name);
    }
    return existed;
  }

  incrementUsage(name: string): void {
    this.load();
    const skill = this.skills.get(name);
    if (skill) {
      skill.usageCount++;
      this.persist(skill);
    }
  }

  count(): number {
    this.load();
    return this.skills.size;
  }

  findByTrigger(query: string): { skill: SkillDefinition; confidence: number }[] {
    this.load();
    const lower = query.toLowerCase();
    const matches: { skill: SkillDefinition; confidence: number }[] = [];

    for (const skill of this.skills.values()) {
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

  exportSkill(name: string): string | null {
    this.load();
    const skill = this.skills.get(name);
    if (!skill) return null;
    return JSON.stringify(skill, null, 2);
  }

  importSkill(json: string): { success: boolean; error?: string; name?: string } {
    try {
      const parsed = JSON.parse(json) as SkillDefinition;
      if (!parsed.name || !parsed.prompt || !parsed.triggers) {
        return { success: false, error: "Invalid skill: missing name, prompt, or triggers" };
      }
      parsed.created = parsed.created || Date.now();
      parsed.updated = Date.now();
      parsed.usageCount = parsed.usageCount || 0;
      parsed.triggers = parsed.triggers || [];
      parsed.tools = parsed.tools || [];
      parsed.examples = parsed.examples || [];
      this.add(parsed);
      return { success: true, name: parsed.name };
    } catch {
      return { success: false, error: "Invalid JSON" };
    }
  }
}
