import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutcomeLedger, isScoreMeaningful, scoreSignals } from "./outcome-ledger.js";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "ntox-ledger-")), "outcomes.jsonl");
}

const baseSignals = {
  corrected: false,
  rephrased: false,
  thanked: false,
  abandoned: false,
  falseSuccess: false,
  toolFailure: false,
};

describe("scoreSignals", () => {
  it("scores corrections as negative", () => {
    expect(scoreSignals({ ...baseSignals, corrected: true })).toBeLessThan(0);
  });

  it("scores thanks as positive", () => {
    expect(scoreSignals({ ...baseSignals, thanked: true })).toBeGreaterThan(0);
  });

  it("prefers objective score when present", () => {
    expect(scoreSignals({ ...baseSignals, thanked: true, corrected: true, objectiveScore: 0.9 })).toBe(0.9);
  });

  it("flags meaningful scores", () => {
    expect(isScoreMeaningful(0.2)).toBe(true);
    expect(isScoreMeaningful(-0.05)).toBe(false);
  });
});

describe("OutcomeLedger", () => {
  it("finalizes rows with computed score", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    const row = ledger.start({
      turnId: "t1",
      sessionId: "s1",
      queryType: "coding",
      responseMode: "tool-execute",
      strategy: "coding",
      strategyVariant: "verify",
    });
    ledger.addContext(row, { kind: "memory", id: "ep_1", tokens: 100, relevance: 0.9 });
    ledger.addTool(row, { name: "read", success: true });
    ledger.finalize(row, { signals: { ...baseSignals, thanked: true }, tokens: 50, latencyMs: 120 });

    const rows = ledger.recent(5);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeGreaterThan(0);
    expect(rows[0].tokens).toBe(50);
    expect(rows[0].strategyVariant).toBe("verify");
  });

  it("computes per-kind lift", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    for (let i = 0; i < 4; i++) {
      const row = ledger.start({
        turnId: `t${i}`,
        sessionId: "s",
        queryType: "coding",
        responseMode: "chat",
        strategy: "coding",
      });
      if (i < 2) ledger.addContext(row, { kind: "memory", id: `ep_${i}`, tokens: 10 });
      ledger.finalize(row, {
        signals: { ...baseSignals, thanked: i < 2, objectiveScore: i < 2 ? 0.8 : -0.6 },
      });
    }
    const stats = ledger.stats();
    const memory = stats.byKind.find((k) => k.kind === "memory");
    expect(memory?.present).toBe(2);
    expect(memory?.absent).toBe(2);
    expect(memory?.lift).toBeGreaterThan(0);
  });

  it("produces deterministic counterfactual buckets", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    expect(ledger.shouldDisable("turn-abc")).toBe(ledger.shouldDisable("turn-abc"));
  });

  it("disables some kind roughly one turn in ten", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    let disabled = 0;
    for (let i = 0; i < 200; i++) {
      if (ledger.shouldDisable(`turn-${i}`)) disabled += 1;
    }
    expect(disabled).toBeGreaterThan(10);
    expect(disabled).toBeLessThan(35);
  });

  it("assigns monotonically increasing turn sequences", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    const first = ledger.start({
      turnId: "t1",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    const second = ledger.start({
      turnId: "t2",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    expect(second.seq).toBeGreaterThan(first.seq);
    ledger.finalize(first, { signals: baseSignals });
    ledger.finalize(second, { signals: baseSignals });
  });

  it("continues sequences after reload from disk", () => {
    const path = tempPath();
    const first = new OutcomeLedger({ path });
    const row1 = first.start({
      turnId: "t1",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    const row2 = first.start({
      turnId: "t2",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    first.finalize(row1, { signals: baseSignals });
    first.finalize(row2, { signals: baseSignals });

    const reloaded = new OutcomeLedger({ path });
    const row3 = reloaded.start({
      turnId: "t3",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    expect(row3.seq).toBeGreaterThan(row2.seq);
  });

  it("aggregates prediction sources defaulting old rows to heuristic", () => {
    const ledger = new OutcomeLedger({ path: tempPath() });
    const legacy = ledger.start({
      turnId: "legacy",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    ledger.finalize(legacy, { signals: baseSignals });
    const llmRow = ledger.start({
      turnId: "llm",
      sessionId: "s",
      queryType: "coding",
      responseMode: "chat",
      strategy: "coding",
    });
    ledger.finalize(llmRow, { signals: baseSignals, predictionSource: "llm", predictionTokens: 110 });

    const stats = ledger.stats();
    expect(stats.predictionSources["heuristic"]).toBe(1);
    expect(stats.predictionSources["llm"]).toBe(1);
    expect(stats.avgPredictionTokens).toBe(110);
  });
});
