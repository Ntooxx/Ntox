import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";
import { localEmbed } from "../core/local-embed.js";
import { cosineSimilarity } from "../utils/math.js";

interface Observation { id: string; description: string; domain: string; confidence: number; timestamp: number; embedding?: number[]; }
interface StoredPattern { id: string; name: string; observations: string[]; generalization: string; confidence: number; timestamp: number; embedding?: number[]; }
interface StoredPrimitive { id: string; name: string; patterns: string[]; abstraction: string; confidence: number; timestamp: number; }
export type TheoryEvidenceSignal = "support" | "contradict" | "neutral";
export type TheoryEvidenceSource = "user" | "tool" | "false-success" | "manual";
export interface TheoryEvidence { theoryId: string; signal: TheoryEvidenceSignal; source: TheoryEvidenceSource; summary: string; timestamp: number; delta?: number; }
export type PredictionOutcome = "pending" | "confirmed" | "falsified";
export interface TheoryPrediction { id: string; theoryId: string; prediction: string; confidence: number; outcome: PredictionOutcome; actual?: string; resolvedAt?: number; timestamp: number; }
interface Theory { id: string; name: string; primitives: string[]; explanation: string; predictions: string[]; falsificationCriteria: string; confirmed: boolean; confidence: number; timestamp: number; embedding?: number[]; evidence?: TheoryEvidence[]; outcomeLog?: TheoryPrediction[]; }
interface MetaTheory { id: string; name: string; theories: string[]; synthesis: string; confidence: number; timestamp: number; }

interface TheoryStoreData {
  observations: Observation[];
  patterns: StoredPattern[];
  theories: Theory[];
  metaTheories: MetaTheory[];
  nextObsId: number;
  nextPatId: number;
  nextTheoryId: number;
  nextMetaId: number;
  nextPredictionId: number;
}

const THEORY_PATH = join(NTOX_DIR, "theories.json");

const PREDICTION_LEARNING_RATE = 0.2;

let observations: Observation[] = [];
let patterns: StoredPattern[] = [];
let theories: Theory[] = [];
let metaTheories: MetaTheory[] = [];
let nextObsId = 1, nextPatId = 1, nextTheoryId = 1, nextMetaId = 1, nextPredictionId = 1;

function persist(): void {
  const data: TheoryStoreData = { observations, patterns, theories, metaTheories, nextObsId, nextPatId, nextTheoryId, nextMetaId, nextPredictionId };
  writeFileSync(THEORY_PATH, JSON.stringify(data, null, 2));
}

function deriveConfidence(t: Theory): number {
  const evidence = t.evidence || [];
  if (evidence.length === 0) return t.confidence;
  let score = 0.2;
  for (const item of evidence) {
    if (item.delta !== undefined) { score += item.delta; continue; }
    if (item.signal === "support") score += item.source === "manual" ? 0.2 : 0.12;
    if (item.signal === "contradict") score -= item.source === "manual" ? 0.25 : item.source === "false-success" ? 0.2 : 0.15;
    if (item.signal === "neutral") score += 0.02;
  }
  return Math.max(0, Math.min(1, score));
}

function refreshTheoryConfidence(t: Theory): void {
  t.confidence = deriveConfidence(t);
  t.confirmed = t.confidence >= 0.6;
}

function isDuplicatePrediction(t: Theory, prediction: string): boolean {
  return (t.outcomeLog || []).some((p) => p.outcome === "pending" && p.prediction === prediction);
}

function resolvePendingPredictions(t: Theory, outcome: Exclude<PredictionOutcome, "pending">, actual: string): TheoryPrediction[] {
  const log = t.outcomeLog || [];
  t.outcomeLog = log;
  const resolved: TheoryPrediction[] = [];
  for (const p of log) {
    if (p.outcome !== "pending") continue;
    p.outcome = outcome;
    p.actual = actual;
    p.resolvedAt = Date.now();
    resolved.push(p);
  }
  if (resolved.length > 0) { refreshTheoryConfidence(t); persist(); }
  return resolved;
}

export function loadTheoryStore(): void {
  if (!existsSync(THEORY_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(THEORY_PATH, "utf-8")) as TheoryStoreData;
    observations = data.observations || [];
    patterns = data.patterns || [];
    theories = data.theories || [];
    for (const t of theories) { t.evidence ||= []; t.outcomeLog ||= []; }
    metaTheories = data.metaTheories || [];
    nextObsId = data.nextObsId || 1;
    nextPatId = data.nextPatId || 1;
    nextTheoryId = data.nextTheoryId || 1;
    nextMetaId = data.nextMetaId || 1;
    nextPredictionId = data.nextPredictionId || 1;
  } catch { /* corrupt file, start fresh */ }
}

export function recordObservation(description: string, domain: string, confidence: number = 0.3): Observation {
  const existing = observations.find((o) => o.description === description);
  if (existing) return existing;
  const embedding = localEmbed(description);
  const obs: Observation = { id: `obs_${nextObsId++}`, description, domain, confidence, timestamp: Date.now(), embedding };
  observations.push(obs);
  if (observations.length > 500) observations.splice(0, observations.length - 500);
  persist();
  tryGeneralize();
  reevaluateTheories(domain);
  return obs;
}

function reevaluateTheories(domain: string): void {
  let changed = false;
  const recentObs = observations.filter((o) => o.domain === domain).slice(-5);
  if (recentObs.length === 0) return;

  const avgEmbedding = averageEmbedding(recentObs.map((o) => o.embedding).filter(Boolean) as number[][]);
  if (!avgEmbedding) return;

  for (const t of theories) {
    if (t.confirmed) continue;
    const theoryEmbed = t.embedding || localEmbed(t.name + " " + t.explanation);
    if (!t.embedding) t.embedding = theoryEmbed;
    const sim = cosineSimilarity(avgEmbedding, theoryEmbed);
    if (sim >= 0.3) {
      t.confidence = Math.min(1, t.confidence + sim * 0.2);
      t.evidence ||= [];
      t.evidence.push({ theoryId: t.id, signal: "support", source: "tool", summary: `Similar recent observations in ${domain}`, timestamp: Date.now() });
      resolvePendingPredictions(t, "confirmed", `Supporting observations accumulated in ${domain}`);
      refreshTheoryConfidence(t);
      if (t.confidence >= 0.6) { t.confirmed = true; }
      changed = true;
    }
  }
  if (changed) { persist(); synthesize(); }
}

function tryGeneralize(): StoredPattern | null {
  if (observations.length < 2) return null;
  const recent = observations.slice(-3);
  const domains = [...new Set(recent.map((o) => o.domain))];
  if (domains.length >= 2) {
    const name = `Cross-domain pattern from ${domains.slice(0, 2).join(", ")}`;
    const existing = patterns.find((p) => p.name === name);
    if (existing) { existing.confidence = Math.min(1, existing.confidence + 0.1); persist(); return existing; }
    const generalization = recent.map((o) => o.description).join("; ");
    const embedding = localEmbed(generalization);
    const p: StoredPattern = { id: `pat_${nextPatId++}`, name, observations: recent.map((o) => o.id), generalization, confidence: 0.3, timestamp: Date.now(), embedding };
    patterns.push(p);
    if (patterns.length > 100) patterns.splice(0, patterns.length - 100);
    persist();
    tryAbstract();
    return p;
  }
  return null;
}

function tryAbstract(): void {
  if (patterns.length < 2) return;
  const top = [...patterns].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  if (top.length >= 2) {
    const sorted = findSharedByEmbedding(top);
    const sim = cosineSimilarity(
      sorted[0].embedding || localEmbed(sorted[0].generalization),
      sorted[1].embedding || localEmbed(sorted[1].generalization)
    );
    if (sim >= 0.2) {
      const words = findShared(top.map((p) => p.generalization));
      const prim: StoredPrimitive = { id: `prim_${nextPatId++}`, name: `Primitive: ${words.length > 0 ? words.slice(0, 2).join(" ") : sorted.map((p) => p.name).join(" ")}`, patterns: top.map((p) => p.id), abstraction: `Common in: ${top.map((p) => p.name).join(", ")}`, confidence: 0.3, timestamp: Date.now() };
      for (const cp of ["invariant", "symmetry", "trade_off", "feedback", "emergence", "conservation", "transformation"]) if (prim.name.toLowerCase().includes(cp)) prim.confidence = 0.5;
      buildTheory(prim);
    }
  }
}

function buildTheory(prim: StoredPrimitive): void {
  const explanation = `Observation of ${prim.abstraction} suggests a recurring reasoning structure`;
  const theory: Theory = { id: `theory_${nextTheoryId++}`, name: `Theory: ${prim.name.replace("Primitive:", "explains")}`, primitives: [prim.id], explanation, predictions: ["This primitive should apply to unseen problems in related domains", "Violating this primitive should lead to characteristic failure modes"], falsificationCriteria: "Find a problem where applying this primitive produces worse outcomes", confirmed: false, confidence: 0.2, timestamp: Date.now(), embedding: localEmbed(prim.name + " " + explanation), evidence: [] };
  theories.push(theory);
  if (theories.length > 50) theories.splice(0, theories.length - 50);
  persist();
  synthesize();
}

function synthesize(): void {
  const confirmed = theories.filter((t) => t.confirmed);
  if (confirmed.length < 2) return;
  metaTheories.push({ id: `meta_${nextMetaId++}`, name: `Meta-theory (${confirmed.length} theories)`, theories: confirmed.map((t) => t.id), synthesis: confirmed.map((t) => t.explanation).join("; "), confidence: 0.3, timestamp: Date.now() });
  if (metaTheories.length > 20) metaTheories.splice(0, metaTheories.length - 20);
  persist();
}

function averageEmbedding(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += e[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  let norm = 0;
  for (const v of avg) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) avg[i] /= norm;
  return avg;
}

function findShared(texts: string[]): string[] {
  const freq: Record<string, number> = {};
  for (const text of texts) for (const w of [...new Set(text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 4))]) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).filter(([, c]) => c >= texts.length * 0.5).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

function findSharedByEmbedding(patterns: StoredPattern[]): StoredPattern[] {
  if (patterns.length < 2) return patterns;
  const embeddings = patterns.map((p) => {
    if (!p.embedding) p.embedding = localEmbed(p.generalization);
    return p.embedding;
  });
  const center = averageEmbedding(embeddings);
  if (!center) return patterns;
  return patterns
    .map((p, i) => ({ p, sim: cosineSimilarity(center, embeddings[i]) }))
    .sort((a, b) => b.sim - a.sim)
    .map(({ p }) => p);
}

export function addTheoryEvidence(theoryId: string, signal: TheoryEvidenceSignal, source: TheoryEvidenceSource, summary: string, delta?: number): TheoryEvidence | null {
  const t = theories.find((t) => t.id === theoryId);
  if (!t) return null;
  t.evidence ||= [];
  const evidence: TheoryEvidence = { theoryId, signal, source, summary, timestamp: Date.now() };
  if (delta !== undefined) evidence.delta = delta;
  t.evidence.push(evidence);
  if (t.evidence.length > 100) t.evidence.splice(0, t.evidence.length - 100);
  refreshTheoryConfidence(t);
  persist();
  if (t.confirmed) synthesize();
  return evidence;
}

export function makeTheoryPrediction(theoryId: string, prediction: string, confidence?: number): TheoryPrediction | null {
  const t = theories.find((t) => t.id === theoryId);
  if (!t) return null;
  if (isDuplicatePrediction(t, prediction)) return null;
  t.outcomeLog ||= [];
  const p: TheoryPrediction = {
    id: `pred_${nextPredictionId++}`,
    theoryId,
    prediction,
    confidence: confidence ?? (t.confidence > 0 ? t.confidence : 0.5),
    outcome: "pending",
    timestamp: Date.now(),
  };
  t.outcomeLog.push(p);
  if (t.outcomeLog.length > 100) t.outcomeLog.splice(0, t.outcomeLog.length - 100);
  persist();
  return p;
}

export function resolvePrediction(predictionId: string, outcome: Exclude<PredictionOutcome, "pending">, actual?: string): TheoryPrediction | null {
  for (const t of theories) {
    const p = (t.outcomeLog || []).find((p) => p.id === predictionId);
    if (!p) continue;
    if (p.outcome !== "pending") return p;
    p.outcome = outcome;
    p.actual = actual;
    p.resolvedAt = Date.now();
    const predictionError = outcome === "confirmed" ? 1 - p.confidence : p.confidence;
    const delta = outcome === "confirmed" ? predictionError * PREDICTION_LEARNING_RATE : -predictionError * PREDICTION_LEARNING_RATE;
    const summary = `Prediction ${outcome}: ${p.prediction}${actual ? ` — observed: ${actual}` : ""}`;
    t.evidence ||= [];
    t.evidence.push({ theoryId: t.id, signal: outcome === "confirmed" ? "support" : "contradict", source: "tool", summary, timestamp: Date.now(), delta });
    if (t.evidence.length > 100) t.evidence.splice(0, t.evidence.length - 100);
    refreshTheoryConfidence(t);
    persist();
    if (t.confirmed) synthesize();
    return p;
  }
  return null;
}

export function penalizeTheoriesForFalseSuccess(text: string, summary: string, limit: number = 2): string[] {
  const payload = text.trim();
  if (!payload) return [];
  const embedding = localEmbed(payload.slice(0, 400));
  const candidates = theories
    .map((t) => {
      const pending = (t.outcomeLog || []).filter((p) => p.outcome === "pending").length;
      const sim = cosineSimilarity(embedding, t.embedding || localEmbed(t.name + " " + t.explanation));
      return { t, sim, pending };
    })
    .filter(({ sim, pending }) => pending > 0 || sim >= 0.5)
    .sort((a, b) => (b.sim + b.pending) - (a.sim + a.pending))
    .slice(0, limit);

  for (const { t } of candidates) {
    addTheoryEvidence(t.id, "contradict", "false-success", summary);
    resolvePendingPredictions(t, "falsified", "Shallow reasoning detected in related work");
  }
  return candidates.map(({ t }) => t.id);
}

export function getAllPredictions(): TheoryPrediction[] {
  return theories.flatMap((t) => (t.outcomeLog || []).map((p) => ({ ...p })));
}

export function confirmTheory(theoryId: string): void {
  addTheoryEvidence(theoryId, "support", "manual", "Manual confirmation");
  const t = theories.find((t) => t.id === theoryId);
  if (t) resolvePendingPredictions(t, "confirmed", "Manually confirmed");
}
export function disconfirmTheory(theoryId: string): void {
  addTheoryEvidence(theoryId, "contradict", "manual", "Manual rejection");
  const t = theories.find((t) => t.id === theoryId);
  if (t) resolvePendingPredictions(t, "falsified", "Manually rejected");
}
export function getTheoryEvidence(theoryId: string): TheoryEvidence[] { return [...(theories.find((t) => t.id === theoryId)?.evidence || [])]; }

export function getTheoryHierarchy() {
  return {
    observations: observations.map((o) => ({ ...o, embedding: o.embedding ? [...o.embedding] : undefined })),
    patterns: patterns.map((p) => ({ ...p, observations: [...p.observations], embedding: p.embedding ? [...p.embedding] : undefined })),
    theories: theories.map((t) => ({
      ...t,
      primitives: [...t.primitives],
      predictions: [...t.predictions],
      embedding: t.embedding ? [...t.embedding] : undefined,
      evidence: (t.evidence || []).map((e) => ({ ...e })),
    })),
    metaTheories: metaTheories.map((m) => ({ ...m, theories: [...m.theories] })),
  };
}
export function getTheoryStats() { return { totalObservations: observations.length, totalPatterns: patterns.length, totalTheories: theories.length, confirmedTheories: theories.filter((t) => t.confirmed).length, totalMetaTheories: metaTheories.length }; }

export function resetTheoryStore(): void {
  observations.length = 0; patterns.length = 0; theories.length = 0; metaTheories.length = 0;
  nextObsId = 1; nextPatId = 1; nextTheoryId = 1; nextMetaId = 1; nextPredictionId = 1;
  if (existsSync(THEORY_PATH)) { try { writeFileSync(THEORY_PATH, JSON.stringify({ observations: [], patterns: [], theories: [], metaTheories: [], nextObsId: 1, nextPatId: 1, nextTheoryId: 1, nextMetaId: 1, nextPredictionId: 1 })); } catch { /* ignore */ } }
}

export function extractObservationFromEpisode(userMessage: string, assistantResponse: string): { description: string; domain: string } | null {
  const topic = userMessage.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5).join(" ");
  if (!topic) return null;
  const responsePreview = assistantResponse.slice(0, 200).replace(/\s+/g, " ");
  const domain = detectDomain(userMessage);
  return { description: `User asked about "${topic}": ${responsePreview}`, domain };
}

function detectDomain(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(code|program|function|api|app|software|script|bug|deploy|build|compile|test)\b/i.test(lower)) return "programming";
  if (/\b(math|equation|formula|proof|calculate|statistic|probability|algebra|calculus)\b/i.test(lower)) return "mathematics";
  if (/\b(physics|force|energy|quantum|mechanics|thermo|wave|field|particle)\b/i.test(lower)) return "physics";
  if (/\b(ai|model|neural|train|dataset|learning|llm|embedding|token|attention|transformer)\b/i.test(lower)) return "ai";
  if (/\b(design|architecture|system|distributed|database|network|protocol|cache|load|scale)\b/i.test(lower)) return "architecture";
  if (/\b(econ|market|price|trade|game|strategy|incentive|auction|equilibrium)\b/i.test(lower)) return "economics";
  return "general";
}
