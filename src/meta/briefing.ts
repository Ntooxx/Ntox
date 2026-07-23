import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { ExecGoal, Constraint, Risk } from "./executive.js";
import { computeDriftConfidence, computePatternConfidence } from "./confidence.js";

const BRIEFING_STATE_PATH = join(NTOX_DIR, "briefing-state.json");

export type BriefType = "morning" | "return" | "event" | "none";

export interface BriefSection {
  label: string;
  content: string;
}

export interface Briefing {
  type: BriefType;
  sections: BriefSection[];
  generatedAt: number;
  question: string | null;
}

export interface BriefingContext {
  statedFocus: string | null;
  goals: ExecGoal[];
  risks: Risk[];
  constraints: Constraint[];
  observations: ObservedSession[];
  beliefs: MentalModelEntry[];
  sessionCount: number;
  lastSessionEndAt: number;
  lastBriefAt: number;
  bondLevel: number;
}

interface BriefingState {
  lastBriefAt: number;
  lastSessionEndAt: number;
  briefsToday: number;
  lastBriefDate: string;
}

const RETURN_GAP_MS = 4 * 60 * 60 * 1000;
const MAX_BRIEFS_PER_DAY = 3;

export class BriefingEngine {
  private state: BriefingState;
  private dirty = false;
  private path: string;

  constructor(path?: string) {
    this.path = path ?? BRIEFING_STATE_PATH;
    this.state = this.load();
  }

  private load(): BriefingState {
    if (!existsSync(this.path)) return this.defaultState();
    try {
      return { ...this.defaultState(), ...JSON.parse(readFileSync(this.path, "utf-8")) };
    } catch {
      return this.defaultState();
    }
  }

  private defaultState(): BriefingState {
    return { lastBriefAt: 0, lastSessionEndAt: 0, briefsToday: 0, lastBriefDate: "" };
  }

  private save(): void {
    const tmp = this.path + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      writeFileSync(this.path, readFileSync(tmp, "utf-8"));
    } catch { }
    try { require("node:fs").unlinkSync(tmp); } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  clearAll(): void {
    this.state = this.defaultState();
    this.dirty = true;
    this.persist();
  }

  recordSessionEnd(): void {
    this.state.lastSessionEndAt = Date.now();
    this.dirty = true;
    this.persist();
  }

  shouldBrief(ctx: BriefingContext): BriefType {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    if (this.state.lastBriefDate !== today) {
      this.state.briefsToday = 0;
      this.state.lastBriefDate = today;
    }

    if (this.state.briefsToday >= MAX_BRIEFS_PER_DAY) return "none";

    const timeSinceLastBrief = now - this.state.lastBriefAt;
    const timeSinceLastSession = now - ctx.lastSessionEndAt;

    if (this.state.lastBriefAt === 0 || timeSinceLastBrief > 12 * 60 * 60 * 1000) {
      if (ctx.goals.length > 0 || ctx.risks.length > 0) {
        return "morning";
      }
    }

    if (timeSinceLastSession > RETURN_GAP_MS && ctx.observations.length > 0) {
      const hasChanges = this.detectSignificantChanges(ctx);
      if (hasChanges) return "return";
    }

    if (ctx.observations.length > 0 && ctx.statedFocus) {
      const drift = computeDriftConfidence(ctx.observations, ctx.statedFocus);
      if (drift.score > 0.5) return "event";
    }

    const contradictions = ctx.beliefs.filter((b) => b.status === "challenged");
    if (contradictions.length > 0) return "event";

    return "none";
  }

  generate(ctx: BriefingContext): Briefing {
    const now = Date.now();
    const type = this.shouldBrief(ctx);
    if (type === "none") {
      return { type: "none", sections: [], generatedAt: now, question: null };
    }

    const sections: BriefSection[] = [];

    if (ctx.statedFocus) {
      sections.push({ label: "Focus", content: ctx.statedFocus });
    }

    const activeGoals = ctx.goals.filter((g) => g.status === "active");
    if (activeGoals.length > 0) {
      const goalLines = activeGoals.map((g) => {
        const bar = g.progress > 0 ? ` (${g.progress}%)` : "";
        return `- ${g.description}${bar}`;
      }).join("\n");
      sections.push({ label: "Goals", content: goalLines });
    }

    if (ctx.risks.length > 0) {
      const riskLines = ctx.risks.slice(0, 3).map((r) => `- [${r.severity}] ${r.description}`).join("\n");
      sections.push({ label: "Risks", content: riskLines });
    }

    const recentObs = ctx.observations.slice(-3);
    if (recentObs.length > 0 && type !== "morning") {
      const topicSummary = recentObs.flatMap((o) => o.topics.slice(0, 2)).join(", ");
      sections.push({ label: "Recent", content: topicSummary });
    }

    if (type === "return") {
      const awayHours = Math.round((now - ctx.lastSessionEndAt) / (60 * 60 * 1000));
      sections.push({ label: "Away", content: `${awayHours}h since last session` });
    }

    const question = this.generateQuestion(ctx);

    this.state.lastBriefAt = now;
    this.state.briefsToday++;
    this.dirty = true;
    this.persist();

    return { type, sections, generatedAt: now, question };
  }

  formatBrief(brief: Briefing): string {
    if (brief.type === "none") return "";

    const lines: string[] = [];
    lines.push("");
    lines.push("=".repeat(44));
    lines.push(`NTOX Executive Brief (${brief.type})`);
    lines.push("=".repeat(44));

    for (const section of brief.sections) {
      lines.push("");
      lines.push(`${section.label}:`);
      for (const line of section.content.split("\n")) {
        lines.push(`  ${line}`);
      }
    }

    if (brief.question) {
      lines.push("");
      lines.push("Question:");
      lines.push(`  ${brief.question}`);
    }

    lines.push("");
    lines.push("=".repeat(44));
    return lines.join("\n");
  }

  private detectSignificantChanges(ctx: BriefingContext): boolean {
    if (ctx.risks.length > 0) return true;
    if (ctx.constraints.length > 0) return true;

    const contradictions = ctx.beliefs.filter((b) => b.status === "challenged");
    if (contradictions.length > 0) return true;

    if (ctx.observations.length >= 5 && ctx.statedFocus) {
      const drift = computeDriftConfidence(ctx.observations, ctx.statedFocus);
      if (drift.score > 0.4) return true;
    }

    return false;
  }

  private generateQuestion(ctx: BriefingContext): string | null {
    if (ctx.risks.length > 0) {
      const topRisk = ctx.risks[0];
      if (topRisk.mentionCount >= 3) {
        return `You've mentioned "${topRisk.description}" ${topRisk.mentionCount} times. What's blocking progress on this?`;
      }
      return `What's the biggest thing you could do today to address: ${topRisk.description}?`;
    }

    if (ctx.statedFocus && ctx.observations.length >= 3) {
      const drift = computeDriftConfidence(ctx.observations, ctx.statedFocus);
      if (drift.score > 0.3) {
        return `You said "${ctx.statedFocus}" was the priority. Recent sessions show drift. Still the plan?`;
      }
    }

    const activeGoals = ctx.goals.filter((g) => g.status === "active");
    if (activeGoals.length > 0) {
      const goal = activeGoals[0];
      if (goal.progress > 0 && goal.progress < 100) {
        return `Goal "${goal.description}" is at ${goal.progress}%. What's the next concrete step?`;
      }
      return `What's the single most important thing you could do today toward: ${goal.description}?`;
    }

    if (ctx.beliefs.length > 0) {
      const recent = ctx.beliefs.filter((b) => b.mentionCount >= 2);
      if (recent.length > 0) {
        return `You've mentioned "${recent[0].statement}" ${recent[0].mentionCount} times. Is this still true?`;
      }
    }

    return null;
  }
}