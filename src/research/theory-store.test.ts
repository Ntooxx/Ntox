import { describe, it, expect, beforeEach } from "vitest";
import { recordObservation, getTheoryStats, getTheoryHierarchy, confirmTheory, resetTheoryStore } from "./theory-store.js";

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

  it("resets correctly", () => {
    recordObservation("test", "general");
    resetTheoryStore();
    const stats = getTheoryStats();
    expect(stats.totalObservations).toBe(0);
    expect(stats.totalPatterns).toBe(0);
  });
});
