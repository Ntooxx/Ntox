import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { localEmbed } from "../core/local-embed.js";
import { cosineSimilarity } from "../utils/math.js";
import { detectDomain } from "./theory-store.js";
import { clamp } from "../mind/util.js";

export interface TransferTheoryView {
  id: string;
  name: string;
  explanation: string;
  confidence: number;
  confirmed: boolean;
  embedding?: number[];
  domain?: string;
}

export interface TransferCandidate {
  source: TransferTheoryView;
  target: TransferTheoryView;
  sourceDomain: string;
  targetDomain: string;
  structuralSimilarity: number;
}

export type TransferStatus = "pending" | "supported" | "rejected";

export interface TransferHypothesis {
  id: string;
  sourceTheoryId: string;
  targetTheoryId: string;
  sourceDomain: string;
  targetDomain: string;
  hypothesis: string;
  structuralSimilarity: number;
  status: TransferStatus;
  baselineScore: number | null;
  transferScore: number | null;
  lift: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface TransferStats {
  total: number;
  pending: number;
  supported: number;
  rejected: number;
  avgLift: number;
  supportedRate: number;
}

export interface TransferStoreOptions {
  path?: string;
  now?: () => number;
  minSimilarity?: number;
  minLift?: number;
}

interface TransferStoreData {
  hypotheses: TransferHypothesis[];
  nextId: number;
}

const DEFAULT_MIN_SIMILARITY = 0.25;
const DEFAULT_MIN_LIFT = 0.1;
const MAX_HYPOTHESES = 100;

function theoryEmbedding(t: TransferTheoryView): number[] {
  return t.embedding ?? localEmbed(`${t.name} ${t.explanation}`);
}

function theoryDomain(t: TransferTheoryView): string {
  return t.domain ?? detectDomain(`${t.name} ${t.explanation}`);
}

export function findTransferCandidates(
  theories: TransferTheoryView[],
  options: { minSimilarity?: number; minDomains?: number } = {},
): TransferCandidate[] {
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const withDomain = theories.map((t) => ({ t, domain: theoryDomain(t) }));
  const candidates: TransferCandidate[] = [];
  for (let i = 0; i < withDomain.length; i++) {
    for (let j = i + 1; j < withDomain.length; j++) {
      const a = withDomain[i];
      const b = withDomain[j];
      if (a.domain === b.domain) continue;
      if (a.domain === "general" || b.domain === "general") continue;
      const similarity = cosineSimilarity(theoryEmbedding(a.t), theoryEmbedding(b.t));
      if (similarity < minSimilarity) continue;
      const [source, target] = a.t.confidence >= b.t.confidence ? [a, b] : [b, a];
      candidates.push({
        source: source.t,
        target: target.t,
        sourceDomain: source.domain,
        targetDomain: target.domain,
        structuralSimilarity: clamp(similarity, 0, 1),
      });
    }
  }
  candidates.sort((a, b) => b.structuralSimilarity - a.structuralSimilarity);
  return candidates;
}

export function stateTransferHypothesis(candidate: TransferCandidate): string {
  return (
    `The structure that explains ${candidate.sourceDomain} (${candidate.source.name}) ` +
    `should also improve outcomes on held-out ${candidate.targetDomain} tasks (${candidate.target.name}).`
  );
}

export class TransferStore {
  private hypotheses: TransferHypothesis[] = [];
  private nextId = 1;
  private loaded = false;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;
  private readonly minSimilarity: number;
  readonly minLift: number;

  constructor(options: TransferStoreOptions = {}) {
    this.path = options.path ?? join(NTOX_DIR, "mind", "transfers.json");
    this.now = options.now ?? Date.now;
    this.minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
    this.minLift = options.minLift ?? DEFAULT_MIN_LIFT;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, "utf-8")) as TransferStoreData;
      this.hypotheses = data.hypotheses ?? [];
      this.nextId = data.nextId ?? 1;
    } catch {
      this.hypotheses = [];
      this.nextId = 1;
    }
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ hypotheses: this.hypotheses, nextId: this.nextId }, null, 2));
      renameSync(tmp, this.path);
    } catch {
      this.dirty = true;
    }
  }

  candidates(theories: TransferTheoryView[]): TransferCandidate[] {
    const existingPairs = new Set(this.hypotheses.map((h) => `${h.sourceTheoryId}->${h.targetTheoryId}`));
    return findTransferCandidates(theories, { minSimilarity: this.minSimilarity }).filter(
      (c) => !existingPairs.has(`${c.source.id}->${c.target.id}`),
    );
  }

  createHypothesis(candidate: TransferCandidate): TransferHypothesis {
    this.load();
    const hypothesis: TransferHypothesis = {
      id: `xfer_${this.nextId++}`,
      sourceTheoryId: candidate.source.id,
      targetTheoryId: candidate.target.id,
      sourceDomain: candidate.sourceDomain,
      targetDomain: candidate.targetDomain,
      hypothesis: stateTransferHypothesis(candidate),
      structuralSimilarity: candidate.structuralSimilarity,
      status: "pending",
      baselineScore: null,
      transferScore: null,
      lift: null,
      createdAt: this.now(),
      resolvedAt: null,
    };
    this.hypotheses.unshift(hypothesis);
    if (this.hypotheses.length > MAX_HYPOTHESES) this.hypotheses = this.hypotheses.slice(0, MAX_HYPOTHESES);
    this.dirty = true;
    this.flush();
    return { ...hypothesis };
  }

  resolve(hypothesisId: string, baselineScore: number, transferScore: number): TransferHypothesis | null {
    this.load();
    const hypothesis = this.hypotheses.find((h) => h.id === hypothesisId);
    if (!hypothesis || hypothesis.status !== "pending") return hypothesis ? { ...hypothesis } : null;
    const baseline = Math.max(1e-9, baselineScore);
    const lift = (transferScore - baselineScore) / baseline;
    hypothesis.baselineScore = baselineScore;
    hypothesis.transferScore = transferScore;
    hypothesis.lift = lift;
    hypothesis.status = lift >= this.minLift ? "supported" : "rejected";
    hypothesis.resolvedAt = this.now();
    this.dirty = true;
    this.flush();
    return { ...hypothesis };
  }

  pending(): TransferHypothesis[] {
    this.load();
    return this.hypotheses.filter((h) => h.status === "pending").map((h) => ({ ...h }));
  }

  list(): TransferHypothesis[] {
    this.load();
    return this.hypotheses.map((h) => ({ ...h }));
  }

  stats(): TransferStats {
    this.load();
    const total = this.hypotheses.length;
    const pending = this.hypotheses.filter((h) => h.status === "pending").length;
    const supported = this.hypotheses.filter((h) => h.status === "supported").length;
    const rejected = this.hypotheses.filter((h) => h.status === "rejected").length;
    const resolvedLifts = this.hypotheses.filter((h) => h.lift !== null).map((h) => h.lift as number);
    const avgLift = resolvedLifts.length > 0 ? resolvedLifts.reduce((a, b) => a + b, 0) / resolvedLifts.length : 0;
    const resolvedCount = supported + rejected;
    return {
      total,
      pending,
      supported,
      rejected,
      avgLift,
      supportedRate: resolvedCount > 0 ? supported / resolvedCount : 0,
    };
  }

  clear(): void {
    this.load();
    this.hypotheses = [];
    this.nextId = 1;
    this.dirty = true;
    this.flush();
  }
}

export interface TransferCycleDeps {
  store: TransferStore;
  theories: TransferTheoryView[];
  scoreHypothesis: (hypothesis: TransferHypothesis, mode: "baseline" | "transfer") => number | Promise<number>;
}

export async function runTransferCycle(deps: TransferCycleDeps): Promise<TransferHypothesis | null> {
  const pendingHypotheses = deps.store.pending();
  if (pendingHypotheses.length > 0) {
    const hypothesis = pendingHypotheses[0];
    const baseline = await deps.scoreHypothesis(hypothesis, "baseline");
    const transfer = await deps.scoreHypothesis(hypothesis, "transfer");
    return deps.store.resolve(hypothesis.id, baseline, transfer);
  }
  const candidates = deps.store.candidates(deps.theories);
  if (candidates.length === 0) return null;
  return deps.store.createHypothesis(candidates[0]);
}
