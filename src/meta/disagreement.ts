import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";
import type { Risk } from "./executive.js";

const DISAGREEMENT_PATH = join(NTOX_DIR, "disagreements.json");

export interface Disagreement {
  id: string;
  proposal: string;
  reason: string;
  evidence: string[];
  confidence: number;
  timestamp: number;
  outcome?: "accepted" | "rejected" | "deferred";
}

export interface DisagreementContext {
  proposal: string;
  observations: ObservedSession[];
  beliefs: MentalModelEntry[];
  risks: Risk[];
  mistakeHistory: string[];
  bondLevel: number;
  sessionCount: number;
}

const MIN_BOND_FOR_DISAGREEMENT = 60;
const MIN_EVIDENCE_ITEMS = 1;

export class DisagreementEngine {
  private history: Disagreement[] = [];
  private dirty = false;

  constructor() {
    this.history = this.load();
  }

  private load(): Disagreement[] {
    if (!existsSync(DISAGREEMENT_PATH)) return [];
    try {
      return JSON.parse(readFileSync(DISAGREEMENT_PATH, "utf-8"));
    } catch {
      return [];
    }
  }

  private save(): void {
    const tmp = DISAGREEMENT_PATH + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.history, null, 2));
      writeFileSync(DISAGREEMENT_PATH, readFileSync(tmp, "utf-8"));
    } catch { }
    try { unlinkSync(tmp); } catch { }
  }

  private persist(): void {
    if (this.dirty) { this.save(); this.dirty = false; }
  }

  flush(): void {
    if (this.dirty) this.save();
  }

  evaluate(ctx: DisagreementContext): Disagreement | null {
    if (ctx.bondLevel < MIN_BOND_FOR_DISAGREEMENT) return null;
    if (!ctx.proposal || ctx.proposal.length < 5) return null;

    const evidence: string[] = [];
    let confidence = 0;

    const pastFailure = this.checkPastFailure(ctx);
    if (pastFailure) {
      evidence.push(pastFailure);
      confidence += 0.4;
    }

    const riskNeglect = this.checkRiskNeglect(ctx);
    if (riskNeglect) {
      evidence.push(riskNeglect);
      confidence += 0.3;
    }

    const patternRepetition = this.checkPatternRepetition(ctx);
    if (patternRepetition) {
      evidence.push(patternRepetition);
      confidence += 0.3;
    }

    const beliefContradiction = this.checkBeliefContradiction(ctx);
    if (beliefContradiction) {
      evidence.push(beliefContradiction);
      confidence += 0.25;
    }

    if (evidence.length < MIN_EVIDENCE_ITEMS) return null;

    confidence = Math.min(1, confidence);

    const disagreement: Disagreement = {
      id: `dis_${randomUUID().slice(0, 8)}`,
      proposal: ctx.proposal,
      reason: this.generateReason(evidence),
      evidence,
      confidence,
      timestamp: Date.now(),
    };

    this.history.push(disagreement);
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    this.dirty = true;
    this.persist();

    return disagreement;
  }

  recordOutcome(id: string, outcome: "accepted" | "rejected" | "deferred"): void {
    const entry = this.history.find((d) => d.id === id);
    if (entry) {
      entry.outcome = outcome;
      this.dirty = true;
      this.persist();
    }
  }

  getHistory(count: number = 10): Disagreement[] {
    return this.history.slice(-count);
  }

  getLastDisagreement(): Disagreement | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  getSuccessRate(): number {
    const withOutcome = this.history.filter((d) => d.outcome);
    if (withOutcome.length === 0) return 0;
    const accepted = withOutcome.filter((d) => d.outcome === "accepted").length;
    return accepted / withOutcome.length;
  }

  clearAll(): void {
    this.history = [];
    this.dirty = true;
    this.persist();
  }

  private checkPastFailure(ctx: DisagreementContext): string | null {
    if (ctx.mistakeHistory.length === 0) return null;

    const proposalLower = ctx.proposal.toLowerCase();
    const matchingMistakes = ctx.mistakeHistory.filter((m) => {
      const mistakeLower = m.toLowerCase();
      const words = proposalLower.split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => mistakeLower.includes(w));
    });

    if (matchingMistakes.length > 0) {
      return `Previously attempted: "${matchingMistakes[0].slice(0, 80)}" — led to issues`;
    }

    return null;
  }

  private checkRiskNeglect(ctx: DisagreementContext): string | null {
    if (ctx.risks.length === 0) return null;

    const highRisks = ctx.risks.filter((r) => r.severity === "high" && r.mentionCount >= 3);
    if (highRisks.length === 0) return null;

    const proposalLower = ctx.proposal.toLowerCase();
    const unaddressed = highRisks.filter((r) => {
      const riskWords = r.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      return !riskWords.some((w) => proposalLower.includes(w));
    });

    if (unaddressed.length > 0) {
      return `You've flagged "${unaddressed[0].description}" as a risk ${unaddressed[0].mentionCount} times, but this proposal doesn't address it`;
    }

    return null;
  }

  private checkPatternRepetition(ctx: DisagreementContext): string | null {
    if (ctx.observations.length < 6) return null;

    const recent = ctx.observations.slice(-6);
    const topicCounts = new Map<string, number>();
    for (const obs of recent) {
      for (const topic of obs.topics.slice(0, 3)) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
    }

    const dominantTopics = [...topicCounts.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1]);

    if (dominantTopics.length === 0) return null;

    const proposalLower = ctx.proposal.toLowerCase();
    const dominated = dominantTopics.filter(([topic]) => {
      return proposalLower.includes(topic) || topic.split(/\s+/).some((w) => w.length > 3 && proposalLower.includes(w));
    });

    if (dominated.length > 0) {
      return `Last ${recent.length} sessions focused heavily on "${dominated[0][0]}" (${dominated[0][1]}x). This proposal continues that pattern`;
    }

    return null;
  }

  private checkBeliefContradiction(ctx: DisagreementContext): string | null {
    const activeBeliefs = ctx.beliefs.filter((b) => b.status === "active" && b.mentionCount >= 2);
    if (activeBeliefs.length === 0) return null;

    const proposalLower = ctx.proposal.toLowerCase();

    for (const belief of activeBeliefs) {
      const beliefLower = belief.statement.toLowerCase();
      const CONTRADICTION_PAIRS: [string, string][] = [
        ["hate", "like"], ["bad", "good"], ["hard", "easy"],
        ["slow", "fast"], ["expensive", "cheap"], ["useless", "useful"],
        ["never", "always"], ["broken", "works"],
      ];

      for (const [a, b] of CONTRADICTION_PAIRS) {
        if ((beliefLower.includes(a) && proposalLower.includes(b)) ||
            (beliefLower.includes(b) && proposalLower.includes(a))) {
          return `You've stated "${belief.statement}" ${belief.mentionCount} times. This proposal suggests the opposite`;
        }
      }

      const NEGATION = /\b(never|not|no|don't|doesn't|won't|can't)\b/i;
      const beliefNegated = NEGATION.test(beliefLower);
      const proposalNegated = NEGATION.test(proposalLower);

      if (beliefNegated !== proposalNegated) {
        const beliefWords = new Set(beliefLower.split(/\s+/).filter((w) => w.length > 3));
        const proposalWords = proposalLower.split(/\s+/).filter((w) => w.length > 3);
        const overlap = proposalWords.filter((w) => beliefWords.has(w)).length;
        if (overlap >= 2) {
          return `You've stated "${belief.statement}" ${belief.mentionCount} times. This proposal contradicts that`;
        }
      }
    }

    return null;
  }

  private generateReason(evidence: string[]): string {
    if (evidence.length === 1) return evidence[0];
    return `Multiple signals: ${evidence.join("; ")}`;
  }
}