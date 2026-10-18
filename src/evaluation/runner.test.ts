import { describe, expect, it } from "vitest";
import { dominantComparison, runLongitudinal } from "./runner.js";
import type { EvalSession } from "./runner.js";
import type { Curriculum } from "./curriculum.js";
import type { MetaArmId } from "./ablation.js";

function makeCurriculum(): Curriculum {
  return {
    id: "unit-curriculum",
    description: "unit",
    tasks: [
      { id: "t0", family: "f", plantTurns: [], probe: "q0", check: { type: "exact", expected: "ok" } },
      { id: "t1", family: "f", plantTurns: [], probe: "q1", check: { type: "exact", expected: "ok" } },
      { id: "t2", family: "f", plantTurns: [], probe: "q2", check: { type: "exact", expected: "ok" } },
    ],
  };
}

function constantSession(response: string, tokens = 1): EvalSession {
  return { send: async () => ({ response, tokens }) };
}

function learningSession(tokens = 1): EvalSession {
  let calls = 0;
  return {
    send: async () => {
      calls++;
      return { response: calls >= 2 ? "ok" : "no", tokens };
    },
  };
}

describe("runLongitudinal", () => {
  it("measures a positive, significant treatment effect", async () => {
    const sessions = new Map<MetaArmId, number>();
    const report = await runLongitudinal({
      curriculum: makeCurriculum(),
      arms: ["off", "full"],
      factory: (arm) => {
        sessions.set(arm, (sessions.get(arm) ?? 0) + 1);
        return arm === "full" ? constantSession("ok") : constantSession("no");
      },
    });

    expect(report.arms).toHaveLength(2);
    const off = report.arms.find((arm) => arm.arm === "off")!;
    const full = report.arms.find((arm) => arm.arm === "full")!;
    expect(off.mean).toBe(0);
    expect(full.mean).toBe(1);

    const comparison = report.comparisons[0];
    expect(comparison.treatment).toBe("full");
    expect(comparison.meanDelta).toBeCloseTo(1);
    expect(comparison.ci.lower).toBeGreaterThan(0);
    expect(comparison.significant).toBe(true);
  });

  it("detects a rising learning slope for the treatment arm", async () => {
    const report = await runLongitudinal({
      curriculum: makeCurriculum(),
      arms: ["off", "kernel"],
      factory: (arm) => (arm === "kernel" ? learningSession() : constantSession("no")),
    });
    const off = report.arms.find((arm) => arm.arm === "off")!;
    const kernel = report.arms.find((arm) => arm.arm === "kernel")!;
    expect(off.slope).toBe(0);
    expect(kernel.slope).toBeGreaterThan(0);
    expect(kernel.mean).toBeGreaterThan(off.mean);
  });

  it("aggregates multiple repetitions into per-task averages", async () => {
    let created = 0;
    const report = await runLongitudinal({
      curriculum: makeCurriculum(),
      arms: ["full"],
      repetitions: 2,
      factory: () => {
        created++;
        return constantSession("ok", 1);
      },
    });
    expect(created).toBe(2);
    expect(report.arms[0].tasks).toHaveLength(3);
    expect(report.arms[0].totalTokens).toBe(6);
    expect(report.arms[0].mean).toBe(1);
  });

  it("resets the session between plant and a cross-session probe", async () => {
    const events: string[] = [];
    const curriculum: Curriculum = {
      id: "reset",
      description: "reset",
      tasks: [
        {
          id: "x0",
          family: "f",
          plantTurns: ["plant this"],
          resetBeforeProbe: true,
          probe: "recall it",
          check: { type: "exact", expected: "ok" },
        },
      ],
    };
    const report = await runLongitudinal({
      curriculum,
      arms: ["off"],
      factory: () => ({
        async send(prompt: string) {
          events.push(prompt.startsWith("plant") ? "plant" : "probe");
          return { response: "ok", tokens: 1 };
        },
        async reset() {
          events.push("reset");
        },
      }),
    });
    expect(events).toEqual(["plant", "reset", "probe"]);
    expect(report.arms[0].tasks[0].passed).toBe(true);
  });

  it("returns no comparisons for a single arm", async () => {
    const report = await runLongitudinal({
      curriculum: makeCurriculum(),
      arms: ["off"],
      factory: () => constantSession("no"),
    });
    expect(report.comparisons).toEqual([]);
    expect(report.primary).toBeNull();
    expect(dominantComparison(report)).toBeNull();
  });

  it("selects the primary comparison for reporting", async () => {
    const report = await runLongitudinal({
      curriculum: makeCurriculum(),
      arms: ["off", "memory", "full"],
      primary: { baseline: "off", treatment: "full" },
      factory: (arm) => (arm === "off" ? constantSession("no") : constantSession("ok")),
    });
    const dominant = dominantComparison(report);
    expect(dominant?.baseline).toBe("off");
    expect(dominant?.treatment).toBe("full");
  });
});
