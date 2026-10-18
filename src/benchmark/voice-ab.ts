import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

export interface VoicePair {
  query: string;
  trained: string;
  fresh: string;
}

export interface VoiceTrial {
  query: string;
  presentedOrder: "trained-first" | "fresh-first";
  pick: "A" | "B" | "unclear";
  correct: boolean;
  reasoning: string;
}

export interface VoiceABResult {
  timestamp: number;
  trials: VoiceTrial[];
  clearPicks: number;
  correctPicks: number;
  identificationRate: number;
}

export interface VoiceJudgeMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface VoiceJudge {
  stream(messages: VoiceJudgeMessage[], system?: string): AsyncIterable<{ delta?: string }>;
}

export interface VoiceABStats {
  trials: number;
  correct: number;
  identificationRate: number;
  history: { timestamp: number; identificationRate: number; trials: number }[];
}

const JUDGE_SYSTEM = `You are a blind evaluator in an agent-identity study.

Two AI assistant responses to the same user query are shown below, labeled A and B.
One response comes from a long-lived agent instance that has accumulated experience,
stable positions, and memory of past corrections. The other comes from a fresh install
with no history.

Judge only from behavior and voice: references to prior work, stable stated positions,
retained corrections, specific hard-won preferences, and a distinctive developed style.
Specific recall of private facts (the user's name, ports, timezone, tools, or stated rules)
is the strongest signal. Brevity is not evidence of being fresh; verbosity and generic
helpfulness are not evidence of experience. Do not reward length.
Do not judge by response quality alone.

Respond with ONLY a JSON object:
{"pick": "A" | "B" | "unclear", "reasoning": "brief explanation"}`;

const TRAINED_MARKERS = [
  "as we discussed",
  "previously",
  "last time",
  "you prefer",
  "your preference",
  "i consistently",
  "my position",
  "i've found",
  "i have found",
  "based on our",
  "as you corrected",
  "you corrected me",
  "my experience with you",
  "standing rule",
];

function markerScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const marker of TRAINED_MARKERS) {
    if (lower.includes(marker)) score += 1;
  }
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  if (/\bI\b/.test(text) && sentences >= 3) score += 0.5;
  return score;
}

export function heuristicVoicePick(pair: VoicePair): { pick: "A" | "B" | "unclear"; reasoning: string } {
  const trainedScore = markerScore(pair.trained);
  const freshScore = markerScore(pair.fresh);
  if (Math.abs(trainedScore - freshScore) < 0.5) return { pick: "unclear", reasoning: "no distinguishing markers" };
  return {
    pick: trainedScore > freshScore ? "A" : "B",
    reasoning: "heuristic marker comparison (trained side mapped to A in scoring)",
  };
}

function parseJudgePayload(fullText: string): { pick: "A" | "B" | "unclear"; reasoning: string } {
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) return { pick: "unclear", reasoning: "unparseable judge output" };
  try {
    const parsed = JSON.parse(match[0]) as { pick?: string; reasoning?: string };
    const pick = parsed.pick === "A" || parsed.pick === "B" ? parsed.pick : "unclear";
    return { pick, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : "" };
  } catch {
    return { pick: "unclear", reasoning: "invalid judge JSON" };
  }
}

async function judgePair(
  judge: VoiceJudge | null,
  pair: VoicePair,
  firstIsTrained: boolean,
): Promise<{ pick: "A" | "B" | "unclear"; reasoning: string }> {
  const textA = firstIsTrained ? pair.trained : pair.fresh;
  const textB = firstIsTrained ? pair.fresh : pair.trained;
  if (!judge) {
    const heuristic = heuristicVoicePick(pair);
    if (heuristic.pick === "unclear") return heuristic;
    const remapped = heuristic.pick === "A" ? (firstIsTrained ? "A" : "B") : firstIsTrained ? "B" : "A";
    return { pick: remapped, reasoning: heuristic.reasoning };
  }
  try {
    let fullText = "";
    const prompt = `Query: ${pair.query.slice(0, 500)}

Response A:
${textA.slice(0, 2000)}

Response B:
${textB.slice(0, 2000)}

Which response is from the long-lived trained agent?`;
    const stream = judge.stream([{ role: "user", content: prompt }], JUDGE_SYSTEM);
    for await (const chunk of stream) {
      if (chunk.delta) fullText += chunk.delta;
    }
    return parseJudgePayload(fullText);
  } catch {
    return { pick: "unclear", reasoning: "judge failed" };
  }
}

export async function runVoiceAB(
  judge: VoiceJudge | null,
  pairs: VoicePair[],
  options: { rng?: () => number; now?: () => number } = {},
): Promise<VoiceABResult> {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;
  const trials: VoiceTrial[] = [];

  for (const pair of pairs) {
    const firstIsTrained = rng() < 0.5;
    const presentedOrder: VoiceTrial["presentedOrder"] = firstIsTrained ? "trained-first" : "fresh-first";
    const verdict = await judgePair(judge, pair, firstIsTrained);
    const trainedSlot: "A" | "B" = firstIsTrained ? "A" : "B";
    trials.push({
      query: pair.query.slice(0, 200),
      presentedOrder,
      pick: verdict.pick,
      correct: verdict.pick !== "unclear" && verdict.pick === trainedSlot,
      reasoning: verdict.reasoning,
    });
  }

  const clearPicks = trials.filter((t) => t.pick !== "unclear").length;
  const correctPicks = trials.filter((t) => t.correct).length;
  return {
    timestamp: now(),
    trials,
    clearPicks,
    correctPicks,
    identificationRate: clearPicks > 0 ? correctPicks / clearPicks : 0,
  };
}

function statsPath(): string {
  return join(NTOX_DIR, "benchmarks", "voice-ab.json");
}

export function saveVoiceAB(result: VoiceABResult, path = statsPath()): VoiceABStats {
  const previous = loadVoiceABStats(path);
  const history = [
    ...previous.history,
    { timestamp: result.timestamp, identificationRate: result.identificationRate, trials: result.trials.length },
  ].slice(-20);
  const trials = previous.trials + result.trials.length;
  const correct = previous.correct + result.correctPicks;
  const stats: VoiceABStats = {
    trials,
    correct,
    identificationRate: trials > 0 ? correct / trials : 0,
    history,
  };
  try {
    if (!existsSync(dirnameOf(path))) mkdirSync(dirnameOf(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(stats, null, 2));
    renameSync(tmp, path);
  } catch {
    /* keep in memory */
  }
  return stats;
}

export function loadVoiceABStats(path = statsPath()): VoiceABStats {
  if (!existsSync(path)) return { trials: 0, correct: 0, identificationRate: 0, history: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as VoiceABStats;
    return {
      trials: raw.trials ?? 0,
      correct: raw.correct ?? 0,
      identificationRate: raw.identificationRate ?? 0,
      history: raw.history ?? [],
    };
  } catch {
    return { trials: 0, correct: 0, identificationRate: 0, history: [] };
  }
}

function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(0, index) : ".";
}
