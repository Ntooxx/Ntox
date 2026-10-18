import { describe, expect, it } from "vitest";
import { buildCurriculum, COGNITIVE_FAMILIES, CURRICULUM_FAMILIES } from "./curriculum.js";

describe("buildCurriculum", () => {
  it("builds tasks from every cognitive family by default", () => {
    const curriculum = buildCurriculum();
    const families = new Set(curriculum.tasks.map((task) => task.family));
    expect(curriculum.tasks.length).toBeGreaterThan(0);
    for (const family of COGNITIVE_FAMILIES) expect(families.has(family)).toBe(true);
  });

  it("exposes all families including legacy ones", () => {
    expect(CURRICULUM_FAMILIES).toContain("arithmetic");
    expect(CURRICULUM_FAMILIES).toContain("tradeoff-analysis");
    expect(CURRICULUM_FAMILIES).toContain("causal-chain");
    expect(CURRICULUM_FAMILIES).toContain("correction-generalization");
    expect(CURRICULUM_FAMILIES).toContain("comparative-reasoning");
  });

  it("produces unique task ids", () => {
    const curriculum = buildCurriculum();
    const ids = curriculum.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("honours the variant count", () => {
    const curriculum = buildCurriculum({ families: ["arithmetic"], variantsPerFamily: 3 });
    expect(curriculum.tasks).toHaveLength(3);
  });

  it("scales to max variants with unique ids", () => {
    const curriculum = buildCurriculum({ variantsPerFamily: 4 });
    const ids = curriculum.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    const byFamily = new Map<string, number>();
    for (const task of curriculum.tasks) byFamily.set(task.family, (byFamily.get(task.family) ?? 0) + 1);
    for (const count of byFamily.values()) expect(count).toBe(4);
  });

  it("orders cumulative recall so later probes target the first fact", () => {
    const curriculum = buildCurriculum({ families: ["cumulative-recall"], variantsPerFamily: 4 });
    expect(curriculum.tasks).toHaveLength(4);
    for (const task of curriculum.tasks) {
      expect(task.probe).toContain("auth");
      expect(task.check).toEqual({ type: "containsAll", required: ["4100"] });
    }
  });

  it("uses cross-session probes for memory families only", () => {
    const curriculum = buildCurriculum({ variantsPerFamily: 2 });
    const family = (name: string) => curriculum.tasks.filter((task) => task.family === name);
    expect(family("recall").every((task) => task.resetBeforeProbe)).toBe(true);
    expect(family("correction-generalization").every((task) => task.resetBeforeProbe)).toBe(true);
    expect(family("tradeoff-analysis").every((task) => !task.resetBeforeProbe)).toBe(true);
    expect(family("causal-chain").every((task) => !task.resetBeforeProbe)).toBe(true);
    expect(family("comparative-reasoning").every((task) => !task.resetBeforeProbe)).toBe(true);
  });

  it("throws for unknown families", () => {
    expect(() => buildCurriculum({ families: ["nope"] })).toThrow();
  });
});
