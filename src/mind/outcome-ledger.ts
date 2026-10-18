import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import type { ContextItem, ContextKind, OutcomeRow, TurnSignals } from "./types.js";
import { hashText } from "./util.js";

const COUNTERFACTUAL_KINDS: ContextKind[] = ["memory", "theory", "skill", "pattern"];

export interface KindEffect {
  kind: ContextKind;
  present: number;
  absent: number;
  presentAvg: number;
  absentAvg: number;
  lift: number;
}

export interface StrategyEffect {
  strategy: string;
  variant: string;
  count: number;
  avgScore: number;
}

export interface LedgerStats {
  total: number;
  avgScore: number;
  correctedRate: number;
  thankedRate: number;
  abandonedRate: number;
  toolFailureRate: number;
  avgPredictionError: number;
  avgLatencyMs: number;
  avgTokens: number;
  predictionSources: Record<string, number>;
  avgPredictionTokens: number;
  byKind: KindEffect[];
  byStrategy: StrategyEffect[];
}

export function scoreSignals(signals: TurnSignals): number {
  if (signals.objectiveScore !== undefined) return signals.objectiveScore;
  let score = 0;
  if (signals.corrected) score -= 0.8;
  if (signals.abandoned) score -= 0.7;
  if (signals.falseSuccess) score -= 0.6;
  if (signals.rephrased) score -= 0.4;
  if (signals.toolFailure) score -= 0.2;
  if (signals.thanked) score += 0.6;
  if (score > 0.6) score = 0.6;
  if (score < -1) score = -1;
  return score;
}

export function isScoreMeaningful(score: number): boolean {
  return Math.abs(score) >= 0.2;
}

export interface OutcomeLedgerOptions {
  path?: string;
  now?: () => number;
  maxRows?: number;
}

export class OutcomeLedger {
  private rows: OutcomeRow[] = [];
  private loaded = false;
  private maxSeq = 0;
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxRows: number;

  constructor(options: OutcomeLedgerOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "outcomes.jsonl");
    this.now = options.now ?? Date.now;
    this.maxRows = options.maxRows ?? 10_000;
  }

  private ensureDir(): void {
    const dir = this.path.slice(0, this.path.lastIndexOf("\\") + this.path.lastIndexOf("/") + 1) || ".";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, "utf-8");
      this.rows = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed) as OutcomeRow;
          if (row.seq === undefined) row.seq = 0;
          this.rows.push(row);
        } catch {
          continue;
        }
      }
      for (const row of this.rows) {
        if (row.seq > this.maxSeq) this.maxSeq = row.seq;
      }
      if (this.rows.length > this.maxRows) this.rewrite(this.rows.slice(-this.maxRows));
    } catch {
      this.rows = [];
    }
  }

  private rewrite(rows: OutcomeRow[]): void {
    this.ensureDir();
    try {
      writeFileSync(this.path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : ""));
      this.rows = rows;
    } catch {
      /* keep in memory */
    }
  }

  start(input: {
    turnId: string;
    sessionId: string;
    queryType: string;
    responseMode: string;
    strategy: string;
    strategyVariant?: string;
    queryPreview?: string;
  }): OutcomeRow {
    this.load();
    const seq = ++this.maxSeq;
    return {
      turnId: input.turnId,
      sessionId: input.sessionId,
      timestamp: this.now(),
      seq,
      queryType: input.queryType,
      ...(input.queryPreview ? { queryPreview: input.queryPreview.slice(0, 200) } : {}),
      responseMode: input.responseMode,
      strategy: input.strategy,
      ...(input.strategyVariant ? { strategyVariant: input.strategyVariant } : {}),
      context: [],
      tools: [],
      signals: {
        corrected: false,
        rephrased: false,
        thanked: false,
        abandoned: false,
        falseSuccess: false,
        toolFailure: false,
      },
      score: 0,
      tokens: 0,
      costUsd: 0,
      latencyMs: 0,
      retries: 0,
    };
  }

  addContext(row: OutcomeRow, item: ContextItem): void {
    row.context.push(item);
  }

  addTool(row: OutcomeRow, tool: OutcomeRow["tools"][number]): void {
    row.tools.push(tool);
  }

  finalize(
    row: OutcomeRow,
    input: {
      signals: TurnSignals;
      costUsd?: number;
      tokens?: number;
      latencyMs?: number;
      retries?: number;
      prediction?: OutcomeRow["prediction"];
      predictionError?: number;
      banditReward?: number;
      droppedSections?: string[];
      predictionSource?: string;
      predictionTokens?: number;
    },
  ): OutcomeRow {
    this.load();
    row.signals = { ...input.signals };
    row.score = scoreSignals(row.signals);
    if (input.costUsd !== undefined) row.costUsd = input.costUsd;
    if (input.tokens !== undefined) row.tokens = input.tokens;
    if (input.latencyMs !== undefined) row.latencyMs = input.latencyMs;
    if (input.retries !== undefined) row.retries = input.retries;
    if (input.prediction) row.prediction = input.prediction;
    if (input.predictionError !== undefined) row.predictionError = input.predictionError;
    if (input.banditReward !== undefined) row.banditReward = input.banditReward;
    if (input.droppedSections !== undefined) row.droppedSections = input.droppedSections;
    if (input.predictionSource !== undefined) row.predictionSource = input.predictionSource;
    if (input.predictionTokens !== undefined) row.predictionTokens = input.predictionTokens;

    this.rows.push(row);
    if (this.rows.length > this.maxRows) {
      this.rewrite(this.rows.slice(-this.maxRows));
    } else {
      this.ensureDir();
      try {
        appendFileSync(this.path, JSON.stringify(row) + "\n");
      } catch {
        /* keep in memory */
      }
    }
    return row;
  }

  shouldDisable(turnId: string, candidates: ContextKind[] = COUNTERFACTUAL_KINDS): ContextKind | null {
    const hash = hashText(turnId);
    const bucket = parseInt(hash, 36) % 10;
    if (bucket !== 0) return null;
    const pick = parseInt(hash, 36) % candidates.length;
    return candidates[pick] ?? null;
  }

  recent(limit = 20): OutcomeRow[] {
    this.load();
    return this.rows.slice(-limit).reverse();
  }

  all(): OutcomeRow[] {
    this.load();
    return this.rows;
  }

  stats(): LedgerStats {
    const rows = this.all();
    const total = rows.length;
    const avg = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    const rate = (fn: (r: OutcomeRow) => boolean) => (total > 0 ? rows.filter(fn).length / total : 0);

    const kinds = new Set<ContextKind>();
    for (const row of rows) for (const item of row.context) kinds.add(item.kind);

    const byKind: KindEffect[] = [];
    for (const kind of kinds) {
      const present = rows.filter((r) => r.context.some((c) => c.kind === kind));
      const absent = rows.filter((r) => !r.context.some((c) => c.kind === kind));
      const presentAvg = avg(present.map((r) => r.score));
      const absentAvg = avg(absent.map((r) => r.score));
      byKind.push({
        kind,
        present: present.length,
        absent: absent.length,
        presentAvg,
        absentAvg,
        lift: presentAvg - absentAvg,
      });
    }
    byKind.sort((a, b) => b.present - a.present);

    const strategies = new Map<string, OutcomeRow[]>();
    for (const row of rows) {
      const key = `${row.queryType}:${row.strategyVariant ?? "standard"}`;
      const list = strategies.get(key) ?? [];
      list.push(row);
      strategies.set(key, list);
    }
    const byStrategy: StrategyEffect[] = [...strategies.entries()]
      .map(([key, list]) => {
        const [strategy, variant] = key.split(":");
        return { strategy, variant, count: list.length, avgScore: avg(list.map((r) => r.score)) };
      })
      .sort((a, b) => b.count - a.count);

    const predErrors = rows.filter((r) => r.predictionError !== undefined).map((r) => r.predictionError as number);
    const latencies = rows.map((r) => r.latencyMs).filter((v) => v > 0);
    const tokens = rows.map((r) => r.tokens).filter((v) => v > 0);
    const predictionSources: Record<string, number> = {};
    for (const row of rows) {
      const source = row.predictionSource ?? "heuristic";
      predictionSources[source] = (predictionSources[source] ?? 0) + 1;
    }
    const predictionTokens = rows.filter((r) => (r.predictionTokens ?? 0) > 0).map((r) => r.predictionTokens as number);

    return {
      total,
      avgScore: avg(rows.map((r) => r.score)),
      correctedRate: rate((r) => r.signals.corrected),
      thankedRate: rate((r) => r.signals.thanked),
      abandonedRate: rate((r) => r.signals.abandoned),
      toolFailureRate: rate((r) => r.signals.toolFailure),
      avgPredictionError: avg(predErrors),
      avgLatencyMs: avg(latencies),
      avgTokens: avg(tokens),
      predictionSources,
      avgPredictionTokens: avg(predictionTokens),
      byKind,
      byStrategy,
    };
  }

  clear(): void {
    this.load();
    this.rows = [];
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        /* already gone */
      }
    }
  }
}
