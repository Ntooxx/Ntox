import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { QueryType } from "../types/index.js";

const ANALYTICS_PATH = join(NTOX_DIR, "analytics.json");

interface AnalyticsData {
  toolUsage: Record<string, number>;
  skillUsage: Record<string, number>;
  queryTypes: Record<string, number>;
  totalToolCalls: number;
  lastReset: number;
}

const DEFAULT_DATA: AnalyticsData = {
  toolUsage: {},
  skillUsage: {},
  queryTypes: {},
  totalToolCalls: 0,
  lastReset: Date.now(),
};

export class Analytics {
  private data: AnalyticsData;
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): AnalyticsData {
    if (!existsSync(ANALYTICS_PATH)) {
      this.save(DEFAULT_DATA);
      return { ...DEFAULT_DATA };
    }
    try {
      return { ...DEFAULT_DATA, ...JSON.parse(readFileSync(ANALYTICS_PATH, "utf-8")) };
    } catch {
      return { ...DEFAULT_DATA };
    }
  }

  private save(data: AnalyticsData): void {
    writeFileSync(ANALYTICS_PATH, JSON.stringify(data, null, 2));
  }

  private persist(): void {
    if (this.dirty) {
      this.save(this.data);
      this.dirty = false;
    }
  }

  trackToolCall(toolName: string): void {
    this.data.toolUsage[toolName] = (this.data.toolUsage[toolName] || 0) + 1;
    this.data.totalToolCalls++;
    this.dirty = true;
    this.persist();
  }

  trackSkillTrigger(skillName: string): void {
    this.data.skillUsage[skillName] = (this.data.skillUsage[skillName] || 0) + 1;
    this.dirty = true;
    this.persist();
  }

  trackQueryType(type: QueryType): void {
    const key = type || "general";
    this.data.queryTypes[key] = (this.data.queryTypes[key] || 0) + 1;
    this.dirty = true;
    this.persist();
  }

  getMostUsedTools(limit: number = 5): { name: string; count: number }[] {
    return Object.entries(this.data.toolUsage)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getMostUsedSkills(limit: number = 5): { name: string; count: number }[] {
    return Object.entries(this.data.skillUsage)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getQueryTypeDistribution(): { type: string; count: number; pct: string }[] {
    const total = Object.values(this.data.queryTypes).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    return Object.entries(this.data.queryTypes)
      .map(([type, count]) => ({ type, count, pct: ((count / total) * 100).toFixed(0) + "%" }))
      .sort((a, b) => b.count - a.count);
  }

  getSummary(): string {
    const tools = this.getMostUsedTools(3);
    const skills = this.getMostUsedSkills(3);
    const types = this.getQueryTypeDistribution();
    const lines: string[] = [];

    lines.push(`Total Tool Calls: ${this.data.totalToolCalls}`);

    if (tools.length > 0) {
      lines.push("Top Tools: " + tools.map((t) => `${t.name} (${t.count}x)`).join(", "));
    }
    if (skills.length > 0) {
      lines.push("Top Skills: " + skills.map((s) => `${s.name} (${s.count}x)`).join(", "));
    }
    if (types.length > 0) {
      lines.push("Query Types: " + types.map((t) => `${t.type} ${t.pct}`).join(", "));
    }

    return lines.join("\n");
  }

  reset(): void {
    this.data = { ...DEFAULT_DATA };
    this.dirty = true;
    this.persist();
  }
}
