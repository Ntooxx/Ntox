import { describe, expect, it } from "vitest";
import { ABLATION_ARMS, armEnablesCognition, armOverrides, getArm, isMetaArmId, type MetaArmId } from "./ablation.js";

describe("ablation arms", () => {
  it("exposes the expected arms", () => {
    const ids = ABLATION_ARMS.map((arm) => arm.id);
    expect(ids).toEqual(["off", "kernel", "memory", "theory", "strategy", "mistakes", "raw-context", "all", "full"]);
  });

  it("disables every subsystem in the off arm", () => {
    const off = armOverrides("off");
    expect(off.kernelEnabled).toBe(false);
    expect(off.memoryEnabled).toBe(false);
    expect(off.theoryEnabled).toBe(false);
    expect(off.strategyEnabled).toBe(false);
    expect(off.mistakesEnabled).toBe(false);
  });

  it("enables exactly one subsystem in isolated arms", () => {
    const isolated: MetaArmId[] = ["kernel", "memory", "theory", "strategy", "mistakes"];
    const flags = ["kernelEnabled", "memoryEnabled", "theoryEnabled", "strategyEnabled", "mistakesEnabled"] as const;
    for (const arm of isolated) {
      const overrides = armOverrides(arm) as Record<string, unknown>;
      const enabled = flags.filter((flag) => overrides[flag] === true);
      expect(enabled).toHaveLength(1);
      expect(overrides[enabled[0]]).toBe(true);
    }
  });

  it("enables every subsystem in the full arm", () => {
    const full = armOverrides("full");
    expect(full.kernelEnabled).toBe(true);
    expect(full.memoryEnabled).toBe(true);
    expect(full.theoryEnabled).toBe(true);
    expect(full.strategyEnabled).toBe(true);
    expect(full.mistakesEnabled).toBe(true);
  });

  it("returns copies that do not mutate the source definitions", () => {
    const first = armOverrides("memory");
    first.memoryEnabled = false;
    expect(armOverrides("memory").memoryEnabled).toBe(true);
  });

  it("throws for unknown arms", () => {
    expect(() => getArm("nope" as MetaArmId)).toThrow();
    expect(isMetaArmId("full")).toBe(true);
    expect(isMetaArmId("nope")).toBe(false);
  });

  it("marks which arms actually enable the cognitive kernel", () => {
    const cognition = ABLATION_ARMS.filter((arm) => armEnablesCognition(arm.id)).map((arm) => arm.id);
    expect(cognition).toEqual(["kernel", "all", "full"]);
  });
});
