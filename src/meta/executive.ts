import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const EXECUTIVE_PATH = join(NTOX_DIR, "executive.json");

export type GoalPriority = "high" | "medium" | "low";
export type GoalStatus = "active" | "completed" | "abandoned";
export type ConstraintType = "budget" | "time" | "skill" | "resource";
export type RiskSeverity = "high" | "medium" | "low";

export interface ExecGoal {
  id: string;
  description: string;
  category: string;
  priority: GoalPriority;
  statedAt: number;
  status: GoalStatus;
  progress: number;
  lastMentioned: number;
}

export interface Constraint {
  type: ConstraintType;
  description: string;
  addedAt: number;
}

export interface Risk {
  description: string;
  severity: RiskSeverity;
  firstIdentified: number;
  lastMentioned: number;
  mentionCount: number;
}

interface ExecutiveData {
  goals: ExecGoal[];
  constraints: Constraint[];
  risks: Risk[];
  statedFocus: string | null;
  focusHistory: { focus: string; statedAt: number }[];
}

const FOCUS_PATTERNS = [
  /(?:my|today'?s|current)\s+(?:priority|focus|goal|main focus)\s+(?:is|should be|will be)\s+(?:to\s*)?(.+?)(?:\.|,|$)/i,
  /(?:i(?:'?m| should| need to| want to|'ll| will)\s+(?:focus on|work on|prioritize|concentrate on))\s+(.+?)(?:\.|,|$)/i,
  /(?:let'?s|we should|we need to)\s+(?:focus on|work on|prioritize)\s+(.+?)(?:\.|,|$)/i,
  /(?:the main thing|the most important thing)\s+(?:is|right now)\s+(.+?)(?:\.|,|$)/i,
];

const GOAL_PATTERNS = [
  /(?:my|our|the)\s+goal\s+(?:is|should be|will be)\s+(?:to\s*)?(.+?)(?:\.|,|$)/i,
  /(?:i(?:'?m| want to| need to| plan to| aim to))\s+(.+?)(?:\.|,|$)/i,
  /(?:trying to|working toward|working on)\s+(.+?)(?:\.|,|$)/i,
  /(?:we need to|we should|we must)\s+(.+?)(?:\.|,|$)/i,
];

const CONSTRAINT_PATTERNS = [
  /(?:i(?:'?m| am)\s+)?(?:limited on|limited by|short on|low on)\s+(.+?)(?:\.|,|$)/i,
  /(?:i can'?t|we can'?t|cannot)\s+(?:afford|spend|invest)\s+(.+?)(?:\.|,|$)/i,
  /(?:don'?t have|no)\s+(?:time|budget|money|resources?|skills?|experience)\s+(?:for|to)\s+(.+?)(?:\.|,|$)/i,
  /(?:the constraint is|the limitation is)\s+(.+?)(?:\.|,|$)/i,
];

const RISK_PATTERNS = [
  /(?:i(?:'?m| am)\s+)?(?:worried about|concerned about|afraid that)\s+(.+?)(?:\.|,|$)/i,
  /(?:the risk is|the danger is|the problem is)\s+(.+?)(?:\.|,|$)/i,
  /(?:what if|what happens if)\s+(.+?)(?:\.|,|$)/i,
  /(?:no|missing|lacking)\s+(distribution|marketing|users?|traction|revenue)\b/i,
];

export class Executive {
  private data: ExecutiveData;
  private dirty = false;
  private path: string;

  constructor(path?: string) {
    this.path = path ?? EXECUTIVE_PATH;
    this.data = this.load();
  }

  private load(): ExecutiveData {
    if (!existsSync(this.path)) return this.defaultData();
    try {
      return { ...this.defaultData(), ...JSON.parse(readFileSync(this.path, "utf-8")) };
    } catch {
      return this.defaultData();
    }
  }

  private defaultData(): ExecutiveData {
    return { goals: [], constraints: [], risks: [], statedFocus: null, focusHistory: [] };
  }

  private save(): void {
    const tmp = this.path + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
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
    for (const pattern of FOCUS_PATTERNS) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        const focus = match[1].trim();
        if (focus.length >= 3 && focus.length <= 150) {
          this.setFocus(focus);
          break;
        }
      }
    }

    for (const pattern of GOAL_PATTERNS) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        const desc = match[1].trim();
        if (desc.length >= 5 && desc.length <= 150) {
          this.addGoal(desc);
          break;
        }
      }
    }

    for (const pattern of CONSTRAINT_PATTERNS) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        const desc = match[1].trim();
        if (desc.length >= 3 && desc.length <= 100) {
          this.addConstraint("resource", desc);
          break;
        }
      }
    }

    for (const pattern of RISK_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const desc = (match[1] || match[0]).trim();
        if (desc.length >= 3 && desc.length <= 100) {
          this.addRisk(desc);
          break;
        }
      }
    }

    if (this.dirty) this.persist();
  }

  setFocus(focus: string): void {
    this.data.statedFocus = focus;
    this.data.focusHistory.push({ focus, statedAt: Date.now() });
    if (this.data.focusHistory.length > 50) {
      this.data.focusHistory = this.data.focusHistory.slice(-50);
    }
    this.dirty = true;
    this.persist();
  }

  addGoal(description: string, category: string = "general", priority: GoalPriority = "medium"): ExecGoal {
    const existing = this.data.goals.find(
      (g) => g.status === "active" && g.description.toLowerCase() === description.toLowerCase()
    );
    if (existing) {
      existing.lastMentioned = Date.now();
      this.dirty = true;
      this.persist();
      return existing;
    }

    const goal: ExecGoal = {
      id: `goal_${randomUUID().slice(0, 8)}`,
      description,
      category,
      priority,
      statedAt: Date.now(),
      status: "active",
      progress: 0,
      lastMentioned: Date.now(),
    };
    this.data.goals.push(goal);
    this.dirty = true;
    this.persist();
    return goal;
  }

  addConstraint(type: ConstraintType, description: string): void {
    const existing = this.data.constraints.find(
      (c) => c.description.toLowerCase() === description.toLowerCase()
    );
    if (existing) return;

    this.data.constraints.push({ type, description, addedAt: Date.now() });
    if (this.data.constraints.length > 20) {
      this.data.constraints = this.data.constraints.slice(-20);
    }
    this.dirty = true;
    this.persist();
  }

  addRisk(description: string, severity: RiskSeverity = "medium"): void {
    const existing = this.data.risks.find(
      (r) => r.description.toLowerCase() === description.toLowerCase()
    );
    if (existing) {
      existing.lastMentioned = Date.now();
      existing.mentionCount++;
      this.dirty = true;
      this.persist();
      return;
    }

    this.data.risks.push({
      description,
      severity,
      firstIdentified: Date.now(),
      lastMentioned: Date.now(),
      mentionCount: 1,
    });
    if (this.data.risks.length > 20) {
      this.data.risks = this.data.risks.slice(-20);
    }
    this.dirty = true;
    this.persist();
  }

  getActiveGoals(): ExecGoal[] {
    return this.data.goals.filter((g) => g.status === "active");
  }

  getConstraints(): Constraint[] {
    return [...this.data.constraints];
  }

  getRisks(): Risk[] {
    return [...this.data.risks];
  }

  getStatedFocus(): string | null {
    return this.data.statedFocus;
  }

  getFocusHistory(): { focus: string; statedAt: number }[] {
    return [...this.data.focusHistory];
  }

  updateGoalProgress(goalId: string, progress: number): void {
    const goal = this.data.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.progress = Math.max(0, Math.min(100, progress));
      if (progress >= 100) goal.status = "completed";
      this.dirty = true;
      this.persist();
    }
  }

  completeGoal(goalId: string): void {
    const goal = this.data.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = "completed";
      goal.progress = 100;
      this.dirty = true;
      this.persist();
    }
  }

  removeGoal(goalId: string): void {
    this.data.goals = this.data.goals.filter((g) => g.id !== goalId);
    this.dirty = true;
    this.persist();
  }

  removeConstraint(index: number): void {
    if (index >= 0 && index < this.data.constraints.length) {
      this.data.constraints.splice(index, 1);
      this.dirty = true;
      this.persist();
    }
  }

  removeRisk(index: number): void {
    if (index >= 0 && index < this.data.risks.length) {
      this.data.risks.splice(index, 1);
      this.dirty = true;
      this.persist();
    }
  }

  buildContext(): string {
    const parts: string[] = [];

    if (this.data.statedFocus) {
      parts.push(`Current focus: ${this.data.statedFocus}`);
    }

    const activeGoals = this.getActiveGoals();
    if (activeGoals.length > 0) {
      const goalLines = activeGoals.map((g) => `  - ${g.description} (${g.progress}%)`).join("\n");
      parts.push(`Goals:\n${goalLines}`);
    }

    if (this.data.constraints.length > 0) {
      const constraintLines = this.data.constraints.map((c) => `  - ${c.type}: ${c.description}`).join("\n");
      parts.push(`Constraints:\n${constraintLines}`);
    }

    if (this.data.risks.length > 0) {
      const riskLines = this.data.risks.map((r) => `  - [${r.severity}] ${r.description}`).join("\n");
      parts.push(`Risks:\n${riskLines}`);
    }

    return parts.length > 0 ? `\n\n## Executive Context\n${parts.join("\n")}` : "";
  }

  clearAll(): void {
    this.data = this.defaultData();
    this.dirty = true;
    this.persist();
  }
}