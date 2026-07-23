import type { ObservedSession } from "./observation.js";
import type { MentalModelEntry } from "./mental-model.js";

export interface ConfidenceResult {
  score: number;
  label: "high" | "moderate" | "low" | "none";
  reasoning: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToLabel(score: number): ConfidenceResult["label"] {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "moderate";
  if (score > 0) return "low";
  return "none";
}

function formatConfidence(result: ConfidenceResult): string {
  const pct = Math.round(result.score * 100);
  return `Confidence: ${pct}% (${result.label}) — ${result.reasoning}`;
}

export function computeDriftConfidence(
  observations: ObservedSession[],
  statedFocus: string | null,
): ConfidenceResult {
  if (!statedFocus || observations.length === 0) {
    return { score: 0, label: "none", reasoning: "No stated focus or no observations" };
  }

  const focusLower = statedFocus.toLowerCase();
  const focusWords = focusLower.split(/\s+/).filter((w) => w.length > 3);

  if (focusWords.length === 0) {
    return { score: 0, label: "none", reasoning: "Focus statement too short to analyze" };
  }

  let matchCount = 0;
  let totalWeight = 0;
  const recentWindow = Math.min(observations.length, 10);
  const recent = observations.slice(-recentWindow);

  for (let i = 0; i < recent.length; i++) {
    const recencyWeight = 1 + (i / recent.length) * 0.5;
    totalWeight += recencyWeight;

    const topicText = recent[i].topics.join(" ");
    const intentMatch = recent[i].sessionIntent !== "casual";

    const wordOverlap = focusWords.filter((w) => topicText.includes(w)).length;
    const aligned = wordOverlap > 0 || intentMatch;

    if (aligned) matchCount += recencyWeight;
  }

  const alignmentRate = totalWeight > 0 ? matchCount / totalWeight : 0;
  const driftRate = 1 - alignmentRate;

  const sessionCountPenalty = clamp(observations.length / 10, 0, 1);
  const score = clamp(driftRate * sessionCountPenalty, 0, 1);

  const pct = Math.round(driftRate * 100);
  const reasoning = `${pct}% of recent sessions show topics away from "${statedFocus}" (${observations.length} observations)`;

  return { score, label: scoreToLabel(score), reasoning };
}

export function computeBeliefContradictionConfidence(
  existingBelief: MentalModelEntry,
  newStatement: string,
): ConfidenceResult {
  const existingLower = existingBelief.statement.toLowerCase();
  const newLower = newStatement.toLowerCase();

  const CONTRADICTION_PAIRS: [string, string][] = [
    ["hate", "like"], ["hate", "love"], ["bad", "good"], ["worst", "best"],
    ["hard", "easy"], ["slow", "fast"], ["complex", "simple"],
    ["expensive", "cheap"], ["useless", "useful"], ["never", "always"],
    ["broken", "works"], ["wrong", "right"], ["ugly", "beautiful"],
  ];

  for (const [a, b] of CONTRADICTION_PAIRS) {
    if ((existingLower.includes(a) && newLower.includes(b)) ||
        (existingLower.includes(b) && newLower.includes(a))) {
      return {
        score: 0.85,
        label: "high",
        reasoning: `Opposite terms detected: "${a}" vs "${b}"`,
      };
    }
  }

  const NEGATION = /\b(never|not|no|don't|doesn't|didn't|won't|can't|isn't|aren't|nobody|nothing)\b/i;
  const existingNegated = NEGATION.test(existingLower);
  const newNegated = NEGATION.test(newLower);

  if (existingNegated !== newNegated) {
    const existingWords = new Set(existingLower.split(/\s+/).filter((w) => w.length > 3));
    const newWords = new Set(newLower.split(/\s+/).filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of existingWords) {
      if (newWords.has(w)) overlap++;
    }

    if (overlap >= 2) {
      return {
        score: 0.75,
        label: "high",
        reasoning: `Negation mismatch with ${overlap} shared meaningful words`,
      };
    }
    if (overlap === 1) {
      return {
        score: 0.55,
        label: "moderate",
        reasoning: `Negation mismatch with 1 shared word — may indicate shift`,
      };
    }
  }

  const existingWords = existingLower.split(/\s+/).filter((w) => w.length > 3);
  const newWords = newLower.split(/\s+/).filter((w) => w.length > 3);
  let sharedMeaningful = 0;
  for (const w of newWords) {
    if (existingWords.includes(w)) sharedMeaningful++;
  }

  if (sharedMeaningful >= 3 && existingBelief.mentionCount >= 3) {
    return {
      score: 0.45,
      label: "moderate",
      reasoning: `Strongly held belief (${existingBelief.mentionCount} mentions) being contradicted`,
    };
  }

  return {
    score: 0,
    label: "none",
    reasoning: "No clear contradiction signals detected",
  };
}

export function computePatternConfidence(
  patternFrequency: number,
  totalObservations: number,
): ConfidenceResult {
  if (totalObservations === 0) {
    return { score: 0, label: "none", reasoning: "No observations to analyze" };
  }

  const rate = patternFrequency / totalObservations;

  const sampleSizeFactor = clamp(totalObservations / 10, 0, 1);
  const score = clamp(rate * sampleSizeFactor, 0, 1);

  const pct = Math.round(rate * 100);
  const reasoning = `Pattern appears in ${patternFrequency}/${totalObservations} sessions (${pct}%)`;

  return { score, label: scoreToLabel(score), reasoning };
}

export function formatConfidenceResult(result: ConfidenceResult): string {
  return formatConfidence(result);
}