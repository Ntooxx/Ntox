import { createHash } from "node:crypto";
import { clamp } from "./util.js";
import type { IdentityData } from "./identity.js";
import type { LedgerStats } from "./outcome-ledger.js";

export interface ProfilePattern {
  name: string;
  strength: number;
  domains: string[];
}

export interface ProfileTheory {
  name: string;
  confidence: number;
}

export interface ProfileVoice {
  directness: number;
  verbosity: number;
}

export interface CognitiveProfile {
  patterns: ProfilePattern[];
  topTheories: ProfileTheory[];
  strategyWeights: Record<string, Record<string, number>>;
  skills: string[];
  positions: { topic: string; stance: string; confidence: number }[];
  values: string[];
  voice: ProfileVoice;
}

export interface ProfileVoiceInput {
  directness?: number;
  verbosity?: number;
}

export interface BuildProfileInput {
  identity: IdentityData;
  patterns?: ProfilePattern[];
  theories?: ProfileTheory[];
  strategyWeights?: Record<string, Record<string, number>>;
  skills?: string[];
  voice?: ProfileVoiceInput;
}

export const DIVERGENCE_WEIGHTS = {
  positions: 0.3,
  values: 0.15,
  strategies: 0.2,
  voice: 0.15,
  patterns: 0.1,
  theories: 0.05,
  skills: 0.05,
} as const;

const DEFAULT_PROFILE_STRATEGIES: Record<string, Record<string, number>> = {};

function jaccardDistance(a: string[], b: string[]): number {
  const setA = new Set(a.map((v) => v.trim().toLowerCase()).filter(Boolean));
  const setB = new Set(b.map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const v of setA) if (setB.has(v)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : 1 - intersection / union;
}

function totalVariation(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return 0;
  let sum = 0;
  for (const key of keys) sum += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
  return clamp(sum / 2, 0, 1);
}

function strategyDistance(
  a: Record<string, Record<string, number>>,
  b: Record<string, Record<string, number>>,
): number {
  const contexts = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (contexts.size === 0) return 0;
  let total = 0;
  for (const context of contexts) total += totalVariation(a[context] ?? {}, b[context] ?? {});
  return clamp(total / contexts.size, 0, 1);
}

function positionDistance(a: CognitiveProfile["positions"], b: CognitiveProfile["positions"]): number {
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : 1;
  const topicsA = a.map((p) => p.topic);
  const topicsB = b.map((p) => p.topic);
  const topicDist = jaccardDistance(topicsA, topicsB);
  const shared: number[] = [];
  for (const pa of a) {
    const pb = b.find((p) => p.topic === pa.topic);
    if (pb) {
      const stanceSame = pa.stance.trim().toLowerCase() === pb.stance.trim().toLowerCase();
      const confDiff = Math.abs(pa.confidence - pb.confidence);
      shared.push((stanceSame ? 0 : 0.5) + confDiff / 2);
    }
  }
  const sharedDist = shared.length > 0 ? shared.reduce((s, v) => s + v, 0) / shared.length : 0;
  return clamp(topicDist * 0.7 + sharedDist * 0.3, 0, 1);
}

function voiceDistance(a: ProfileVoice, b: ProfileVoice): number {
  return clamp((Math.abs(a.directness - b.directness) + Math.abs(a.verbosity - b.verbosity)) / 2, 0, 1);
}

export function voiceFromLedger(stats?: LedgerStats): ProfileVoice {
  if (!stats || stats.total === 0) return { directness: 0.5, verbosity: 0.5 };
  const directness = clamp(0.5 + (stats.thankedRate - stats.correctedRate) / 2, 0, 1);
  const verbosity = clamp(stats.avgTokens / 1000, 0, 1);
  return { directness, verbosity };
}

export function buildProfile(input: BuildProfileInput): CognitiveProfile {
  const banditWeights = input.strategyWeights ?? DEFAULT_PROFILE_STRATEGIES;
  const ledgerVoice = { directness: 0.5, verbosity: 0.5 };
  return {
    patterns: (input.patterns ?? [])
      .map((p) => ({ name: p.name, strength: clamp(p.strength, 0, 1), domains: [...p.domains] }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 20),
    topTheories: (input.theories ?? [])
      .map((t) => ({ name: t.name, confidence: clamp(t.confidence, 0, 1) }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10),
    strategyWeights: Object.fromEntries(
      Object.entries(banditWeights)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([context, weights]) => [context, { ...weights }]),
    ),
    skills: [...new Set(input.skills ?? [])].sort().slice(0, 40),
    positions: input.identity.positions
      .map((p) => ({ topic: p.topic, stance: p.stance, confidence: clamp(p.confidence, 0, 1) }))
      .sort((a, b) => a.topic.localeCompare(b.topic)),
    values: [...input.identity.values].sort(),
    voice: {
      directness: clamp(input.voice?.directness ?? ledgerVoice.directness, 0, 1),
      verbosity: clamp(input.voice?.verbosity ?? ledgerVoice.verbosity, 0, 1),
    },
  };
}

export function freshProfile(): CognitiveProfile {
  return buildProfile({
    identity: {
      narrative: "",
      values: ["evidence over fluency", "learn from correction"],
      activeProjects: [],
      positions: [],
      revisionLog: [],
    },
  });
}

export function profileDivergence(a: CognitiveProfile, b: CognitiveProfile): number {
  const parts = {
    positions: positionDistance(a.positions, b.positions),
    values: jaccardDistance(a.values, b.values),
    strategies: strategyDistance(a.strategyWeights, b.strategyWeights),
    voice: voiceDistance(a.voice, b.voice),
    patterns: jaccardDistance(
      a.patterns.map((p) => p.name),
      b.patterns.map((p) => p.name),
    ),
    theories: jaccardDistance(
      a.topTheories.map((t) => t.name),
      b.topTheories.map((t) => t.name),
    ),
    skills: jaccardDistance(a.skills, b.skills),
  };
  let total = 0;
  for (const [key, weight] of Object.entries(DIVERGENCE_WEIGHTS)) {
    total += weight * (parts[key as keyof typeof parts] ?? 0);
  }
  return clamp(total, 0, 1);
}

export function profileComponents(a: CognitiveProfile, b: CognitiveProfile): Record<string, number> {
  return {
    positions: positionDistance(a.positions, b.positions),
    values: jaccardDistance(a.values, b.values),
    strategies: strategyDistance(a.strategyWeights, b.strategyWeights),
    voice: voiceDistance(a.voice, b.voice),
    patterns: jaccardDistance(
      a.patterns.map((p) => p.name),
      b.patterns.map((p) => p.name),
    ),
    theories: jaccardDistance(
      a.topTheories.map((t) => t.name),
      b.topTheories.map((t) => t.name),
    ),
    skills: jaccardDistance(a.skills, b.skills),
  };
}

export function profileHash(profile: CognitiveProfile): string {
  const payload = JSON.stringify({
    patterns: profile.patterns.map((p) => ({ name: p.name, strength: Math.round(p.strength * 10) / 10 })),
    topTheories: profile.topTheories.map((t) => ({ name: t.name, confidence: Math.round(t.confidence * 10) / 10 })),
    strategyWeights: profile.strategyWeights,
    skills: profile.skills,
    positions: profile.positions.map((p) => ({
      topic: p.topic,
      stance: p.stance,
      confidence: Math.round(p.confidence * 10) / 10,
    })),
    values: profile.values,
    voice: {
      directness: Math.round(profile.voice.directness * 10) / 10,
      verbosity: Math.round(profile.voice.verbosity * 10) / 10,
    },
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export interface NarrativeInput {
  identity: IdentityData;
  strongDomains?: string[];
  weakDomains?: string[];
  totalTurns?: number;
}

export function deriveNarrative(input: NarrativeInput): string {
  const parts: string[] = [];
  const values = input.identity.values.slice(0, 3);
  const positions = input.identity.positions.filter((p) => p.confidence >= 0.5);
  const turns = input.totalTurns ?? 0;
  const head =
    turns > 0
      ? `I am an agent shaped by ${turns} observed turns, holding evidence over fluency and learning from correction.`
      : "I am an evidence-first agent still accumulating experience.";
  parts.push(values.length > 0 ? `${head} I weight ${values.join(", ")}.` : head);
  if (positions.length > 0) {
    const top = positions.slice(0, 2).map((p) => `on ${p.topic} I hold: ${p.stance}`);
    parts.push(`Stable positions: ${top.join("; ")}.`);
  }
  if (input.strongDomains && input.strongDomains.length > 0) {
    parts.push(`Reliable in ${input.strongDomains.slice(0, 2).join(", ")}.`);
  }
  if (input.weakDomains && input.weakDomains.length > 0) {
    parts.push(`Cautious in ${input.weakDomains.slice(0, 2).join(", ")} — I verify before asserting.`);
  }
  if (input.identity.activeProjects.length > 0) {
    parts.push(`Active projects: ${input.identity.activeProjects.slice(0, 3).join(", ")}.`);
  }
  return parts.join(" ").slice(0, 600);
}
