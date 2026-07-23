import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { InteractionScore } from "../meta/interaction-score.js";

const RELATIONSHIP_PATH = join(NTOX_DIR, "relationship.json");

const DAY_MS = 86400000;

interface RelationshipData {
  bondLevel: number;
  totalInteractions: number;
  solvedCount: number;
  frustrationCount: number;
  streakDays: number;
  lastActiveDate: string;
  bestStreak: number;
  weeklyScores: number[];
  milestones: string[];
  currentWeek: number;
  satisfactionHistory: number[];
}

const DEFAULT_DATA: RelationshipData = {
  bondLevel: 0,
  totalInteractions: 0,
  solvedCount: 0,
  frustrationCount: 0,
  streakDays: 0,
  lastActiveDate: new Date().toISOString().slice(0, 10),
  bestStreak: 0,
  weeklyScores: [],
  milestones: [],
  currentWeek: getWeekNumber(),
  satisfactionHistory: [],
};

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.floor((now.getTime() - start.getTime()) / (DAY_MS * 7)) + 1;
}

export class RelationshipTracker {
  private data: RelationshipData;
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): RelationshipData {
    if (!existsSync(RELATIONSHIP_PATH)) {
      this.save(DEFAULT_DATA);
      return { ...DEFAULT_DATA };
    }
    try {
      return { ...DEFAULT_DATA, ...JSON.parse(readFileSync(RELATIONSHIP_PATH, "utf-8")) };
    } catch {
      return { ...DEFAULT_DATA };
    }
  }

  private save(data: RelationshipData): void {
    writeFileSync(RELATIONSHIP_PATH, JSON.stringify(data, null, 2));
  }

  private persist(): void {
    if (this.dirty) {
      this.save(this.data);
      this.dirty = false;
    }
  }

  record(score: InteractionScore): void {
    const today = new Date().toISOString().slice(0, 10);
    const prevDate = this.data.lastActiveDate;

    this.data.totalInteractions++;
    this.data.satisfactionHistory.push(score.satisfaction);
    if (this.data.satisfactionHistory.length > 100) {
      this.data.satisfactionHistory = this.data.satisfactionHistory.slice(-100);
    }

    if (score.solved) this.data.solvedCount++;
    if (score.satisfaction < -0.4) this.data.frustrationCount++;

    // Bond level
    const bondDelta = score.solved ? 0.5 : score.satisfaction * 2;
    this.data.bondLevel = Math.max(0, Math.min(100, this.data.bondLevel + bondDelta));

    // Streak tracking
    if (prevDate !== today) {
      const prev = new Date(prevDate);
      const current = new Date(today);
      const diffDays = Math.floor((current.getTime() - prev.getTime()) / DAY_MS);

      if (diffDays === 1) {
        this.data.streakDays++;
        if (this.data.streakDays > this.data.bestStreak) {
          this.data.bestStreak = this.data.streakDays;
        }
      } else if (diffDays > 1) {
        this.data.streakDays = 1;
      }
      this.data.lastActiveDate = today;
    }

    // Weekly tracking
    const week = getWeekNumber();
    if (week !== this.data.currentWeek) {
      this.data.currentWeek = week;
      this.data.weeklyScores.push(this.getAverageSatisfaction());
      if (this.data.weeklyScores.length > 12) {
        this.data.weeklyScores = this.data.weeklyScores.slice(-12);
      }
    }

    // Milestones
    this.checkMilestones();

    this.dirty = true;
    this.persist();
  }

  private checkMilestones(): void {
    const checks: [string, boolean][] = [
      ["First interaction", this.data.totalInteractions === 1],
      ["10 conversations", this.data.totalInteractions === 10],
      ["50 conversations", this.data.totalInteractions === 50],
      ["100 conversations", this.data.totalInteractions === 100],
      ["First problem solved", this.data.solvedCount === 1],
      ["10 problems solved", this.data.solvedCount === 10],
      ["3-day streak", this.data.streakDays >= 3],
      ["7-day streak", this.data.streakDays >= 7],
      ["14-day streak", this.data.streakDays >= 14],
      ["Bond level 10", this.data.bondLevel >= 10],
      ["Bond level 25", this.data.bondLevel >= 25],
      ["Bond level 50", this.data.bondLevel >= 50],
      ["Trust established", this.data.frustrationCount === 0 && this.data.totalInteractions >= 20],
      ["Resilient bond", this.data.frustrationCount > 0 && this.data.bondLevel > 30],
    ];

    for (const [milestone, triggered] of checks) {
      if (triggered && !this.data.milestones.includes(milestone)) {
        this.data.milestones.push(milestone);
      }
    }
  }

  getBondLabel(): string {
    const b = this.data.bondLevel;
    if (b < 5) return "new acquaintance";
    if (b < 15) return "getting familiar";
    if (b < 30) return "regular companion";
    if (b < 50) return "trusted partner";
    if (b < 75) return "close collaborator";
    return "deep connection";
  }

  getTrend(): "improving" | "stable" | "declining" {
    const recent = this.data.satisfactionHistory.slice(-10);
    if (recent.length < 5) return "stable";
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const diff = avgSecond - avgFirst;
    if (diff > 0.1) return "improving";
    if (diff < -0.1) return "declining";
    return "stable";
  }

  getNewMilestones(): string[] {
    return [...this.data.milestones];
  }

  getAverageSatisfaction(): number {
    const recent = this.data.satisfactionHistory.slice(-20);
    if (recent.length === 0) return 0;
    return recent.reduce((s, v) => s + v, 0) / recent.length;
  }

  getSummary(): string {
    const lines: string[] = [];
    lines.push(`Bond: ${this.getBondLabel()} (${this.data.bondLevel.toFixed(0)}/100)`);
    lines.push(`Trend: ${this.getTrend()}`);
    lines.push(`Interactions: ${this.data.totalInteractions}`);
    lines.push(`Solved: ${this.data.solvedCount}`);
    lines.push(`Frustration events: ${this.data.frustrationCount}`);
    lines.push(`Streak: ${this.data.streakDays} days (best: ${this.data.bestStreak})`);
    lines.push(`Avg satisfaction: ${(this.getAverageSatisfaction() * 100).toFixed(0)}%`);
    if (this.data.milestones.length > 0) {
      lines.push(`Milestones: ${this.data.milestones.slice(-3).join(", ")}`);
    }
    return lines.join("\n");
  }

  getBondLevel(): number { return this.data.bondLevel; }
  getStreak(): number { return this.data.streakDays; }

  reset(): void {
    this.data = { ...DEFAULT_DATA, currentWeek: getWeekNumber(), lastActiveDate: new Date().toISOString().slice(0, 10) };
    this.dirty = true;
    this.persist();
  }
}
