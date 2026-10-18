import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TransferStore,
  findTransferCandidates,
  runTransferCycle,
  stateTransferHypothesis,
  type TransferTheoryView,
} from "./transfer.js";

function theory(overrides: Partial<TransferTheoryView> & { id: string; name: string }): TransferTheoryView {
  return {
    explanation: "feedback structure appears across scales",
    confidence: 0.7,
    confirmed: true,
    embedding: [1, 0, 0],
    ...overrides,
  };
}

function tempStore(now?: () => number): TransferStore {
  return new TransferStore({
    path: join(mkdtempSync(join(tmpdir(), "ntox-xfer-")), "transfers.json"),
    ...(now ? { now } : {}),
  });
}

describe("findTransferCandidates", () => {
  it("pairs distant domains with similar structure", () => {
    const candidates = findTransferCandidates([
      theory({ id: "t1", name: "Theory: feedback in physics", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t2", name: "Theory: feedback in markets", domain: "economics", embedding: [0.95, 0.05, 0] }),
      theory({ id: "t3", name: "Theory: other in physics", domain: "physics", embedding: [0, 0.9, 0.1] }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceDomain).not.toBe(candidates[0].targetDomain);
    expect(candidates[0].structuralSimilarity).toBeGreaterThan(0.25);
  });

  it("skips same-domain and dissimilar pairs", () => {
    const candidates = findTransferCandidates([
      theory({ id: "t1", name: "a", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t2", name: "b", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t3", name: "c", domain: "economics", embedding: [0, 1, 0] }),
    ]);
    expect(candidates).toHaveLength(0);
  });
});

describe("stateTransferHypothesis", () => {
  it("names both domains", () => {
    const hypothesis = stateTransferHypothesis({
      source: theory({ id: "t1", name: "src" }),
      target: theory({ id: "t2", name: "tgt" }),
      sourceDomain: "physics",
      targetDomain: "economics",
      structuralSimilarity: 0.5,
    });
    expect(hypothesis).toContain("physics");
    expect(hypothesis).toContain("economics");
  });
});

describe("TransferStore", () => {
  it("creates and resolves a hypothesis with a base-rate gate", () => {
    const store = tempStore();
    const candidate = {
      source: theory({ id: "t1", name: "src", domain: "physics" }),
      target: theory({ id: "t2", name: "tgt", domain: "economics" }),
      sourceDomain: "physics",
      targetDomain: "economics",
      structuralSimilarity: 0.6,
    };
    const hypothesis = store.createHypothesis(candidate);
    expect(hypothesis.status).toBe("pending");
    const resolved = store.resolve(hypothesis.id, 0.5, 0.6);
    expect(resolved?.status).toBe("supported");
    expect(resolved?.lift).toBeCloseTo(0.2, 5);
    const rejected = store.createHypothesis({
      ...candidate,
      source: { ...candidate.source, id: "t3" },
      target: { ...candidate.target, id: "t4" },
    });
    const rejectedResolved = store.resolve(rejected.id, 0.5, 0.52);
    expect(rejectedResolved?.status).toBe("rejected");
    const stats = store.stats();
    expect(stats.supported).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.avgLift).toBeGreaterThan(0);
  });

  it("persists hypotheses across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ntox-xfer-")), "transfers.json");
    const store = new TransferStore({ path });
    store.createHypothesis({
      source: theory({ id: "t1", name: "src" }),
      target: theory({ id: "t2", name: "tgt" }),
      sourceDomain: "physics",
      targetDomain: "economics",
      structuralSimilarity: 0.5,
    });
    const reloaded = new TransferStore({ path });
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.pending()).toHaveLength(1);
  });

  it("filters out already hypothesized pairs from candidates", () => {
    const store = tempStore();
    const theories = [
      theory({ id: "t1", name: "src", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t2", name: "tgt", domain: "economics", embedding: [0.95, 0.05, 0] }),
    ];
    expect(store.candidates(theories)).toHaveLength(1);
    store.createHypothesis(store.candidates(theories)[0]);
    expect(store.candidates(theories)).toHaveLength(0);
  });
});

describe("runTransferCycle", () => {
  it("creates a hypothesis first, then resolves it", async () => {
    const store = tempStore();
    const theories = [
      theory({ id: "t1", name: "src", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t2", name: "tgt", domain: "economics", embedding: [0.95, 0.05, 0] }),
    ];
    const created = await runTransferCycle({
      store,
      theories,
      scoreHypothesis: () => 0,
    });
    expect(created?.status).toBe("pending");
    const resolved = await runTransferCycle({
      store,
      theories,
      scoreHypothesis: (_h, mode) => (mode === "baseline" ? 0.5 : 0.6),
    });
    expect(resolved?.status).toBe("supported");
    const exhausted = await runTransferCycle({ store, theories, scoreHypothesis: () => 0 });
    expect(exhausted).toBeNull();
  });

  it("supports async scorers", async () => {
    const store = tempStore();
    const theories = [
      theory({ id: "t1", name: "src", domain: "physics", embedding: [1, 0, 0] }),
      theory({ id: "t2", name: "tgt", domain: "economics", embedding: [0.95, 0.05, 0] }),
    ];
    await runTransferCycle({ store, theories, scoreHypothesis: () => 0 });
    const resolved = await runTransferCycle({
      store,
      theories,
      scoreHypothesis: async (_h, mode) => (mode === "baseline" ? 0.4 : 0.5),
    });
    expect(resolved?.status).toBe("supported");
  });
});
