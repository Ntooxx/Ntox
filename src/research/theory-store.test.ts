import { describe, it, expect, beforeEach } from "vitest";
import { recordObservation, getTheoryStats, getTheoryHierarchy, confirmTheory, disconfirmTheory, addTheoryEvidence, getTheoryEvidence, resetTheoryStore, makeTheoryPrediction, resolvePrediction, penalizeTheoriesForFalseSuccess, getAllPredictions } from "./theory-store.js";

describe("theory-store", () => {
  beforeEach(() => {
    resetTheoryStore();
  });

  it("records observations", () => {
    recordObservation("test observation", "programming");
    const stats = getTheoryStats();
    expect(stats.totalObservations).toBe(1);
  });

  it("generalizes across domains with 2+ observations", () => {
    recordObservation("first observation about coding", "programming");
    recordObservation("second observation about math", "mathematics");
    const hierarchy = getTheoryHierarchy();
    expect(hierarchy.patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-confirms theories as supporting observations accumulate", () => {
    // Seed cross-domain observations to build a theory, then keep reinforcing its domain
    for (let i = 0; i < 4; i++) {
      recordObservation(`coding pattern ${i} structure`, "programming");
      recordObservation(`system design ${i} architecture`, "architecture");
    }
    for (let i = 0; i < 4; i++) {
      recordObservation(`more system architecture ${i}`, "architecture");
    }
    const hierarchy = getTheoryHierarchy();
    const confirmed = hierarchy.theories.filter((t) => t.confirmed);
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
  });

  it("produces meta-theories once two theories are confirmed", () => {
    for (let i = 0; i < 6; i++) {
      recordObservation(`code pattern structure ${i}`, "programming");
      recordObservation(`system design architecture ${i}`, "architecture");
      recordObservation(`math proof calculus ${i}`, "mathematics");
    }
    const hierarchy = getTheoryHierarchy();
    expect(hierarchy.metaTheories.length).toBeGreaterThanOrEqual(1);
  });

  it("does not duplicate observations across bulk calls", () => {
    recordObservation("dup test one about coding patterns", "programming");
    recordObservation("dup test two about math proofs", "mathematics");
    const after1 = getTheoryStats().totalObservations;
    recordObservation("dup test one about coding patterns", "programming");
    recordObservation("dup test two about math proofs", "mathematics");
    const after2 = getTheoryStats().totalObservations;
    expect(after2).toBe(after1);
  });

  it("tracks theory confirmation", () => {
    // Seed enough observations to create a theory
    for (let i = 0; i < 5; i++) {
      recordObservation(`observation ${i} about system and design`, "architecture");
      if (i % 2 === 0) recordObservation(`observation ${i} about code and pattern`, "programming");
    }
    const hierarchy = getTheoryHierarchy();
    if (hierarchy.theories.length > 0) {
      confirmTheory(hierarchy.theories[0].id);
      const updated = getTheoryHierarchy();
      expect(updated.theories[0].confirmed).toBe(true);
    }
  });

  it("updates confidence from evidence", () => {
    for (let i = 0; i < 5; i++) {
      recordObservation(`evidence code ${i}`, "programming");
      recordObservation(`evidence architecture ${i}`, "architecture");
    }
    const theory = getTheoryHierarchy().theories[0];
    expect(theory).toBeDefined();
    addTheoryEvidence(theory.id, "support", "manual", "looks right");
    const supported = getTheoryHierarchy().theories.find((t) => t.id === theory.id)!;
    expect(supported.confidence).toBeGreaterThanOrEqual(theory.confidence);
    disconfirmTheory(theory.id);
    const rejected = getTheoryHierarchy().theories.find((t) => t.id === theory.id)!;
    expect(rejected.confidence).toBeLessThan(supported.confidence);
  });

  it("returns theory evidence", () => {
    for (let i = 0; i < 5; i++) {
      recordObservation(`manual evidence code ${i}`, "programming");
      recordObservation(`manual evidence system ${i}`, "architecture");
    }
    const theory = getTheoryHierarchy().theories[0];
    confirmTheory(theory.id);
    const evidence = getTheoryEvidence(theory.id);
    expect(evidence.some((e) => e.signal === "support" && e.source === "manual")).toBe(true);
  });

  it("resets correctly", () => {
    recordObservation("test", "general");
    resetTheoryStore();
    const stats = getTheoryStats();
    expect(stats.totalObservations).toBe(0);
    expect(stats.totalPatterns).toBe(0);
  });
});

describe("theory predictions", () => {
  beforeEach(() => {
    resetTheoryStore();
  });

  function seedTheory(pair: { a: string; b: string }, domains: [string, string]): string {
    for (let i = 0; i < 5; i++) {
      recordObservation(`${pair.a} ${i}`, domains[0]);
      recordObservation(`${pair.b} ${i}`, domains[1]);
    }
    const theories = getTheoryHierarchy().theories;
    expect(theories.length).toBeGreaterThan(0);
    return theories[theories.length - 1].id;
  }

  const progPair = { a: "seed code pattern", b: "seed architecture design" };
  const mathPair = { a: "math proof calculus", b: "market price equilibrium" };

  it("registers pending predictions on a theory", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    const pred = makeTheoryPrediction(id, "Reuse of this pattern will pay off next time");
    expect(pred).not.toBeNull();
    expect(pred!.outcome).toBe("pending");
    expect(getAllPredictions().some((p) => p.id === pred!.id)).toBe(true);
  });

  it("does not duplicate an identical pending prediction", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "Same claim");
    const dup = makeTheoryPrediction(id, "Same claim");
    expect(dup).toBeNull();
    expect(getAllPredictions().length).toBe(1);
  });

  it("returns null for predictions on unknown theories", () => {
    const pred = makeTheoryPrediction("theory_missing", "claim");
    expect(pred).toBeNull();
  });

  it("confirms a prediction and raises confidence by the prediction error", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "Low confidence claim", 0.2);
    const before = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    resolvePrediction(getAllPredictions()[0].id, "confirmed", "outcome was good");
    const after = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    const pred = getAllPredictions()[0];
    expect(pred.outcome).toBe("confirmed");
    expect(pred.actual).toBe("outcome was good");
    expect(after).toBeGreaterThan(before);
    const evidence = getTheoryEvidence(id);
    expect(evidence.some((e) => e.signal === "support" && e.delta !== undefined)).toBe(true);
  });

  it("falsifies a prediction and drops confidence by the prediction error", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "High confidence claim", 0.9);
    const before = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    resolvePrediction(getAllPredictions()[0].id, "falsified", "came out wrong");
    const after = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    expect(getAllPredictions()[0].outcome).toBe("falsified");
    expect(after).toBeLessThan(before);
  });

  it("weighs low-confidence confirmations more than high-confidence ones", () => {
    const idA = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(idA, "Uncertain claim", 0.2);
    const idB = seedTheory(mathPair, ["mathematics", "economics"]);
    makeTheoryPrediction(idB, "Confident claim", 0.9);
    const baseA = getTheoryHierarchy().theories.find((t) => t.id === idA)!.confidence;
    const baseB = getTheoryHierarchy().theories.find((t) => t.id === idB)!.confidence;
    resolvePrediction(getAllPredictions()[0].id, "confirmed");
    resolvePrediction(getAllPredictions()[1].id, "confirmed");
    const riseA = getTheoryHierarchy().theories.find((t) => t.id === idA)!.confidence - baseA;
    const riseB = getTheoryHierarchy().theories.find((t) => t.id === idB)!.confidence - baseB;
    expect(riseA).toBeGreaterThan(riseB);
  });

  it("does not double-resolve an already resolved prediction", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "Once only", 0.5);
    const predId = getAllPredictions()[0].id;
    resolvePrediction(predId, "confirmed");
    const conf = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    const second = resolvePrediction(predId, "falsified");
    expect(second!.outcome).toBe("confirmed");
    expect(getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence).toBe(conf);
  });

  it("resolves pending predictions via manual confirmation and rejection", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "Manual path claim");
    confirmTheory(id);
    expect(getAllPredictions()[0].outcome).toBe("confirmed");
    makeTheoryPrediction(id, "Manual rejection claim");
    disconfirmTheory(id);
    expect(getAllPredictions()[1].outcome).toBe("falsified");
  });

  it("penalizes theories tied to shallow reasoning and falsifies their predictions", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    makeTheoryPrediction(id, "This approach should work");
    const penalized = penalizeTheoriesForFalseSuccess("seed code pattern design approach", "Surface reasoning detected");
    expect(penalized).toContain(id);
    const pred = getAllPredictions()[0];
    expect(pred.outcome).toBe("falsified");
    const t = getTheoryHierarchy().theories.find((t) => t.id === id)!;
    expect(t.evidence!.some((e) => e.source === "false-success" && e.signal === "contradict")).toBe(true);
    expect(t.confirmed).toBe(false);
  });

  it("leaves unrelated theories untouched by false-success penalties", () => {
    const id = seedTheory(progPair, ["programming", "architecture"]);
    const before = getTheoryHierarchy().theories.find((t) => t.id === id)!.confidence;
    const penalized = penalizeTheoriesForFalseSuccess("unrelated cosmetic styling palettes", "Surface reasoning");
    expect(penalized).not.toContain(id);
    const t = getTheoryHierarchy().theories.find((t) => t.id === id)!;
    expect(t.confidence).toBe(before);
    expect((t.evidence || []).some((e) => e.source === "false-success")).toBe(false);
  });
});
