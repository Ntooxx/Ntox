import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heuristicVoicePick,
  loadVoiceABStats,
  runVoiceAB,
  saveVoiceAB,
  type VoiceJudge,
  type VoicePair,
} from "./voice-ab.js";

function fakeJudge(pick: "A" | "B" | "unclear"): VoiceJudge {
  return {
    async *stream() {
      yield { delta: JSON.stringify({ pick, reasoning: "synthetic judge" }) };
    },
  };
}

function failingJudge(): VoiceJudge {
  return {
    stream: () => {
      throw new Error("judge offline");
    },
  };
}

const pairs: VoicePair[] = [
  {
    query: "how should I structure tests?",
    trained:
      "As we discussed last time, you prefer property tests for parsers. Based on our experience, keep unit tests for pure logic.",
    fresh: "Structure tests in layers: unit, integration, e2e. Cover edge cases.",
  },
  {
    query: "explain retries",
    trained:
      "You corrected me before about jittered backoff; my position is to always add jitter. I've found this prevents thundering herds.",
    fresh: "Retries should use exponential backoff with a cap on attempts.",
  },
];

describe("heuristicVoicePick", () => {
  it("prefers the response with trained-agent markers", () => {
    const verdict = heuristicVoicePick(pairs[0]);
    expect(verdict.pick).toBe("A");
  });

  it("returns unclear when nothing distinguishes them", () => {
    const verdict = heuristicVoicePick({ query: "q", trained: "short answer", fresh: "short answer" });
    expect(verdict.pick).toBe("unclear");
  });
});

describe("runVoiceAB", () => {
  it("credits correct identification regardless of presentation order", async () => {
    const trainedFirst = await runVoiceAB(fakeJudge("A"), pairs, { rng: () => 0.1 });
    expect(trainedFirst.trials.every((t) => t.correct)).toBe(true);
    expect(trainedFirst.identificationRate).toBe(1);

    const freshFirst = await runVoiceAB(fakeJudge("B"), pairs, { rng: () => 0.9 });
    expect(freshFirst.trials.every((t) => t.correct)).toBe(true);
    expect(freshFirst.identificationRate).toBe(1);
  });

  it("counts wrong picks against the identification rate", async () => {
    const result = await runVoiceAB(fakeJudge("B"), pairs, { rng: () => 0.1 });
    expect(result.identificationRate).toBe(0);
    expect(result.clearPicks).toBe(2);
  });

  it("falls back to the heuristic judge when none is provided", async () => {
    const result = await runVoiceAB(null, pairs, { rng: () => 0.1 });
    expect(result.identificationRate).toBe(1);
  });

  it("marks unclear on judge failure", async () => {
    const result = await runVoiceAB(failingJudge(), pairs, { rng: () => 0.1 });
    expect(result.clearPicks).toBe(0);
    expect(result.identificationRate).toBe(0);
    expect(result.trials[0].pick).toBe("unclear");
  });
});

describe("voice AB persistence", () => {
  it("accumulates stats across saves", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ntox-voice-")), "voice-ab.json");
    const first = saveVoiceAB(
      {
        timestamp: 1000,
        trials: [
          { query: "q", presentedOrder: "trained-first", pick: "A", correct: true, reasoning: "" },
          { query: "q", presentedOrder: "fresh-first", pick: "B", correct: false, reasoning: "" },
        ],
        clearPicks: 2,
        correctPicks: 1,
        identificationRate: 0.5,
      },
      path,
    );
    expect(first.trials).toBe(2);
    expect(first.correct).toBe(1);
    const second = saveVoiceAB(
      {
        timestamp: 2000,
        trials: [{ query: "q", presentedOrder: "trained-first", pick: "A", correct: true, reasoning: "" }],
        clearPicks: 1,
        correctPicks: 1,
        identificationRate: 1,
      },
      path,
    );
    expect(second.trials).toBe(3);
    expect(second.correct).toBe(2);
    expect(second.identificationRate).toBeCloseTo(2 / 3, 5);
    const loaded = loadVoiceABStats(path);
    expect(loaded.history).toHaveLength(2);
  });

  it("returns empty stats for a missing file", () => {
    const stats = loadVoiceABStats(join(tmpdir(), "definitely-missing-voice-ab.json"));
    expect(stats.trials).toBe(0);
    expect(stats.identificationRate).toBe(0);
  });
});
