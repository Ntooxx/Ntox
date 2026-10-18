import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { detectDomains } from "../cognition/domains.js";
import {
  StrategyBandit,
  banditContextKey,
  computeBanditReward,
  type BanditRewardWeights,
  type BanditStats,
  type StrategyVariant,
} from "./bandit.js";
import { CalibrationTracker, HeuristicPredictor, type CalibrationByLabel, type CalibrationStats } from "./predictor.js";
import { CapabilityModel, type CapabilityStats } from "./capability.js";
import { compileContext, type CompilableItem } from "./context-compiler.js";
import { IdentityStore, type Fingerprint } from "./identity.js";
import { IdleScheduler, type IdleStatus } from "./idle.js";
import { OutcomeLedger, scoreSignals, type LedgerStats } from "./outcome-ledger.js";
import { ReliabilityStore, type ReliabilityStats } from "./reliability.js";
import { buildProfile, deriveNarrative, voiceFromLedger, type CognitiveProfile } from "./profile.js";
import type {
  ContextItem,
  ContextKind,
  MindFinishMeta,
  MindTurnHandle,
  Prediction,
  PredictionResult,
  TurnSignals,
} from "./types.js";

export interface MindStats {
  ledger: LedgerStats;
  reliability: ReliabilityStats;
  calibration: CalibrationStats;
  calibrationByStrategy: CalibrationByLabel;
  bandit: BanditStats;
  capability: CapabilityStats;
  identity: Fingerprint;
  idle: IdleStatus;
}

export interface MindBeginInput {
  turnId: string;
  sessionId: string;
  query: string;
  queryType: string;
  responseMode: string;
  strategy?: string;
}

export interface MindTurnResult {
  score: number;
  prediction: PredictionResult;
}

export interface MindOptions {
  rootDir?: string;
  enabled?: boolean;
  now?: () => number;
  banditReward?: BanditRewardWeights;
}

export class Mind {
  readonly ledger: OutcomeLedger;
  readonly reliability: ReliabilityStore;
  readonly predictor: HeuristicPredictor;
  readonly calibration: CalibrationTracker;
  readonly bandit: StrategyBandit;
  readonly capability: CapabilityModel;
  readonly identity: IdentityStore;
  readonly idle: IdleScheduler;
  readonly enabled: boolean;
  private readonly banditRewardWeights: BanditRewardWeights;

  constructor(options: MindOptions = {}) {
    const rootDir = options.rootDir ?? join(NTOX_DIR, "mind");
    this.enabled = options.enabled ?? true;
    this.banditRewardWeights = options.banditReward ?? {};
    const now = options.now;
    this.ledger = new OutcomeLedger({ path: join(rootDir, "outcomes.jsonl"), ...(now ? { now } : {}) });
    this.reliability = new ReliabilityStore({ path: join(rootDir, "reliability.json"), ...(now ? { now } : {}) });
    this.predictor = new HeuristicPredictor();
    this.calibration = new CalibrationTracker({ path: join(rootDir, "calibration.json"), ...(now ? { now } : {}) });
    this.bandit = new StrategyBandit({ path: join(rootDir, "bandit.json") });
    this.capability = new CapabilityModel({ path: join(rootDir, "capability.json"), ...(now ? { now } : {}) });
    this.identity = new IdentityStore({ path: join(rootDir, "identity.json"), ...(now ? { now } : {}) });
    this.idle = new IdleScheduler({ path: join(rootDir, "idle.json"), ...(now ? { now } : {}) });
  }

  beginTurn(input: MindBeginInput): MindTurnHandle | null {
    if (!this.enabled) return null;
    const contextKey = banditContextKey(input.queryType, input.responseMode);
    const variant: StrategyVariant = this.bandit.select(contextKey);
    const prediction = this.predictor.predict(input.query, input.queryType);
    const disabledKind = this.ledger.shouldDisable(input.turnId);
    const row = this.ledger.start({
      turnId: input.turnId,
      sessionId: input.sessionId,
      queryType: input.queryType,
      responseMode: input.responseMode,
      strategy: input.strategy ?? input.queryType,
      strategyVariant: variant,
      queryPreview: input.query.slice(0, 200),
    });
    return {
      row,
      prediction,
      strategyVariant: variant,
      disabledKind,
      domains: detectDomains(input.query),
    };
  }

  strategyGuidance(variant: StrategyVariant): string {
    return this.bandit.guidance(variant);
  }

  recordContext(handle: MindTurnHandle, item: ContextItem): void {
    if (!this.enabled || !handle) return;
    if (handle.disabledKind === item.kind) return;
    this.ledger.addContext(handle.row, item);
  }

  recordContextText(handle: MindTurnHandle, kind: ContextKind, id: string, text: string, relevance = 0.5): void {
    this.recordContext(handle, {
      kind,
      id,
      tokens: Math.ceil(text.length / 4),
      relevance,
      reliability: this.reliability.score(kind, id),
    });
  }

  recordTool(
    handle: MindTurnHandle,
    tool: { name: string; success: boolean; durationMs?: number; argsHash?: string },
  ): void {
    if (!this.enabled || !handle) return;
    this.ledger.addTool(handle.row, tool);
  }

  rankMemory<T extends { kind: string; id: string; relevance: number }>(items: T[]): T[] {
    return this.reliability.rank(items);
  }

  compile(items: CompilableItem[], budgetTokens: number) {
    return compileContext(items, budgetTokens);
  }

  predict(query: string, queryType = "general"): Prediction {
    return this.predictor.predict(query, queryType);
  }

  finishTurn(handle: MindTurnHandle, signals: TurnSignals, meta: MindFinishMeta = {}): MindTurnResult | null {
    if (!this.enabled || !handle) return null;
    try {
      const usedTools = handle.row.tools.map((t) => t.name);
      const prediction = this.predictor.resolve(handle.prediction, signals, usedTools);
      const costUsd = meta.costUsd ?? 0;
      const latencyMs = meta.latencyMs ?? 0;
      const score = scoreSignals(signals);
      const banditReward = computeBanditReward(score, costUsd, latencyMs, this.banditRewardWeights);

      this.ledger.finalize(handle.row, {
        signals,
        costUsd,
        tokens: meta.tokens ?? 0,
        latencyMs,
        retries: meta.retries ?? 0,
        prediction: handle.prediction,
        predictionError: prediction.error,
        banditReward,
        ...(meta.droppedSections ? { droppedSections: meta.droppedSections } : {}),
        ...(meta.predictionSource ? { predictionSource: meta.predictionSource } : {}),
        ...(meta.predictionTokens !== undefined ? { predictionTokens: meta.predictionTokens } : {}),
      });

      if (Math.abs(score) >= 0.2) {
        for (const item of handle.row.context) {
          this.reliability.record(item.kind, item.id, score > 0, score);
        }
      } else if (prediction.error < 0.2) {
        for (const item of handle.row.context) {
          this.reliability.record(item.kind, item.id, true, 0.1);
        }
      }
      this.reliability.flush();

      this.calibration.record(handle.prediction.confidence, prediction.outcome, handle.strategyVariant);
      this.calibration.flush();

      const contextKey = banditContextKey(handle.row.queryType, handle.row.responseMode);
      if (handle.strategyVariant) {
        this.bandit.update(contextKey, handle.strategyVariant, banditReward);
        this.bandit.flush();
      }
      if (prediction.error > 0.6) {
        this.bandit.bumpExploration(contextKey, 2);
      }

      this.capability.record(handle.domains, score);
      this.capability.flush();

      if (signals.corrected && meta.correction) {
        this.identity.addPosition(meta.correction.topicKey, meta.correction.correction, 0.6, [
          `correction:${handle.row.turnId}`,
        ]);
        this.identity.flush();
      }

      return { score, prediction };
    } catch {
      return null;
    }
  }

  stats(): MindStats {
    return {
      ledger: this.ledger.stats(),
      reliability: this.reliability.stats(),
      calibration: this.calibration.stats(),
      calibrationByStrategy: this.calibration.byStrategy(),
      bandit: this.bandit.stats(),
      capability: this.capability.stats(),
      identity: this.identity.fingerprint({
        variants: Object.fromEntries(
          Object.entries(this.bandit.stats().preferred).sort(([a], [b]) => a.localeCompare(b)),
        ),
      }),
      idle: this.idle.status(),
    };
  }

  identitySummary(): string {
    try {
      this.refreshNarrative();
      return this.identity.summary();
    } catch {
      return "";
    }
  }

  refreshNarrative(): boolean {
    try {
      const ledger = this.ledger.stats();
      const capability = this.capability.stats();
      const data = this.identity.get();
      const strongDomains = capability.domains.filter((d) => d.count >= 3 && d.confidence >= 0.7).map((d) => d.domain);
      const weakDomains = capability.domains.filter((d) => d.count >= 3 && d.confidence < 0.45).map((d) => d.domain);
      const narrative = deriveNarrative({
        identity: data,
        strongDomains,
        weakDomains,
        totalTurns: ledger.total,
      });
      if (narrative && narrative !== data.narrative) {
        this.identity.setNarrative(narrative);
        return true;
      }
    } catch {
      /* narrative derivation is best-effort */
    }
    return false;
  }

  cognitiveProfile(
    extras: {
      patterns?: { name: string; strength: number; domains: string[] }[];
      theories?: { name: string; confidence: number }[];
      skills?: string[];
      strategyWeights?: Record<string, Record<string, number>>;
    } = {},
  ): CognitiveProfile {
    const banditStats = this.bandit.stats();
    const strategyWeights =
      extras.strategyWeights ??
      Object.fromEntries(
        Object.entries(banditStats.preferred).map(([context, variant]) => [context, { [variant]: 1 }]),
      );
    return buildProfile({
      identity: this.identity.get(),
      patterns: extras.patterns ?? [],
      theories: extras.theories ?? [],
      skills: extras.skills ?? [],
      strategyWeights,
      voice: voiceFromLedger(this.ledger.stats()),
    });
  }

  capabilityGuidance(domains: string[]): string {
    try {
      return this.capability.guidance(domains);
    } catch {
      return "";
    }
  }
}
