import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NTOX_DIR } from "../core/config.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import { computeDriftConfidence, computeBeliefContradictionConfidence, computePatternConfidence } from "./confidence.js";

const INTERVENTION_PATH = join(NTOX_DIR, "interventions.json");

export type InterventionType =
  | "alignment-alert"
  | "pattern-observation"
  | "belief-contradiction"
  | "strategic-question"
  | "self-correction";

export interface Intervention {
  id: string;
  type: InterventionType;
  message: string;
  confidence: number;
  reasoning: string;
  timestamp: number;
  outcome?: "helpful" | "wrong" | "ignored";
}

export interface InterventionContext {
  observations: ObservedSession[];
  beliefs: MentalModelEntry[];
  statedFocus: string | null;
  bondLevel: number;
  sessionCount: number;
  sessionIntent: string;
  lastInterventionAt: number;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const MIN_SESSIONS = 5;
const MIN_BOND_FOR_QUESTIONS = 20;
const MIN_BOND_FOR_CHALLENGES = 40;
const DRIFT_THRESHOLD = 0.4;
const PATTERN_THRESHOLD = 0.5;

export class InterventionEngine {
  private history: Intervention[] = [];
  private dirty = false;

  constructor() {
    this.history = this.load();
  }

  private load(): Intervention[] {
    if (!existsSync(INTERVENTION_PATH)) return [];
    try {
      return JSON.parse(readFileSync(INTERVENTION_PATH, "utf-8"));
    } catch {
      return [];
    }
  }

  private save(): void {
    const tmp = INTERVENTION_PATH + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.history, null, 2));
      writeFileSync(INTERVENTION_PATH, readFileSync(tmp, "utf-8"));
    } catch { }
    try { require("node:fs").unlinkSync(tmp); } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  evaluate(ctx: InterventionContext): Intervention | null {
    if (!this.passesGateConditions(ctx)) return null;

    const candidates: Intervention[] = [];

    const drift = this.checkGoalDrift(ctx);
    if (drift) candidates.push(drift);

    const pattern = this.checkRepetitionPattern(ctx);
    if (pattern) candidates.push(pattern);

    const contradiction = this.checkBeliefContradiction(ctx);
    if (contradiction) candidates.push(contradiction);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];

    this.history.push(best);
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    this.dirty = true;
    this.persist();

    return best;
  }

  recordOutcome(interventionId: string, outcome: "helpful" | "wrong" | "ignored"): void {
    const entry = this.history.find((i) => i.id === interventionId);
    if (entry) {
      entry.outcome = outcome;
      this.dirty = true;
      this.persist();
    }
  }

  getLastIntervention(): Intervention | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  getHistory(count: number = 10): Intervention[] {
    return this.history.slice(-count);
  }

  getSuccessRate(): number {
    const withOutcome = this.history.filter((i) => i.outcome);
    if (withOutcome.length === 0) return 0;
    const helpful = withOutcome.filter((i) => i.outcome === "helpful").length;
    return helpful / withOutcome.length;
  }

  clearAll(): void {
    this.history = [];
    this.dirty = true;
    this.persist();
  }

  private passesGateConditions(ctx: InterventionContext): boolean {
    const now = Date.now();
    if (now - ctx.lastInterventionAt < COOLDOWN_MS) return false;
    if (ctx.sessionCount < MIN_SESSIONS) return false;
    if (ctx.bondLevel < MIN_BOND_FOR_QUESTIONS) return false;
    if (ctx.sessionIntent === "deep-work" || ctx.sessionIntent === "debugging") return false;
    return true;
  }

  private checkGoalDrift(ctx: InterventionContext): Intervention | null {
    if (!ctx.statedFocus) return null;

    const driftResult = computeDriftConfidence(ctx.observations, ctx.statedFocus);
    if (driftResult.score < DRIFT_THRESHOLD) return null;

    const recentSessions = ctx.observations.slice(-5);
    const awayCount = recentSessions.filter((o) => {
      const topicText = o.topics.join(" ");
      return !ctx.statedFocus!.toLowerCase().split(/\s+/).some((w) => w.length > 3 && topicText.includes(w));
    }).length;

    if (awayCount < 3) return null;

    return {
      id: `int_${randomUUID().slice(0, 8)}`,
      type: "alignment-alert",
      message: `For the last ${awayCount} sessions, we've worked on topics away from "${ctx.statedFocus}". Should we revisit priorities?`,
      confidence: driftResult.score,
      reasoning: driftResult.reasoning,
      timestamp: Date.now(),
    };
  }

  private checkRepetitionPattern(ctx: InterventionContext): Intervention | null {
    if (ctx.observations.length < 6) return null;

    const recent = ctx.observations.slice(-6);
    const topicCounts = new Map<string, number>();
    for (const obs of recent) {
      for (const topic of obs.topics.slice(0, 3)) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
    }

    let dominantTopic = "";
    let dominantCount = 0;
    for (const [topic, count] of topicCounts) {
      if (count > dominantCount) {
        dominantTopic = topic;
        dominantCount = count;
      }
    }

    if (dominantCount < 4) return null;

    if (ctx.statedFocus) {
      const focusLower = ctx.statedFocus.toLowerCase();
      const focusWords = focusLower.split(/\s+/).filter((w) => w.length > 3);
      if (focusWords.some((w) => dominantTopic.includes(w))) return null;
    }

    const patternResult = computePatternConfidence(dominantCount, recent.length);
    if (patternResult.score < PATTERN_THRESHOLD) return null;

    return {
      id: `int_${randomUUID().slice(0, 8)}`,
      type: "pattern-observation",
      message: `I've noticed something. For the last ${recent.length} sessions, we've focused heavily on "${dominantTopic}". Is this intentional, or should we diversify?`,
      confidence: patternResult.score,
      reasoning: patternResult.reasoning,
      timestamp: Date.now(),
    };
  }

  private checkBeliefContradiction(ctx: InterventionContext): Intervention | null {
    if (ctx.beliefs.length === 0 || ctx.observations.length === 0) return null;

    const recentTopics = ctx.observations.slice(-3).flatMap((o) => o.topics);
    const recentText = recentTopics.join(" ");

    for (const belief of ctx.beliefs) {
      if (belief.status !== "active") continue;
      if (belief.mentionCount < 2) continue;

      const contradictionResult = computeBeliefContradictionConfidence(belief, recentText);
      if (contradictionResult.score < 0.4) continue;

      if (ctx.bondLevel < MIN_BOND_FOR_CHALLENGES) continue;

      return {
        id: `int_${randomUUID().slice(0, 8)}`,
        type: "belief-contradiction",
        message: `I've noticed something. You previously believed "${belief.statement}". But our recent work suggests otherwise. Did your thinking change?`,
        confidence: contradictionResult.score,
        reasoning: contradictionResult.reasoning,
        timestamp: Date.now(),
      };
    }

    return null;
  }
}