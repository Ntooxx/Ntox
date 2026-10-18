import { describe, expect, it } from "vitest";
import {
  commandCheck,
  constraintCheck,
  containsAll,
  evaluateObjective,
  exactMatch,
  factRecall,
  normalize,
  numericMatch,
} from "./objective-evaluators.js";

describe("normalize", () => {
  it("collapses whitespace and lowercases by default", () => {
    expect(normalize("  Hello   World  ")).toBe("hello world");
  });

  it("preserves case when requested", () => {
    expect(normalize("Hello World", true)).toBe("Hello World");
  });
});

describe("exactMatch", () => {
  it("matches normalized strings", () => {
    expect(exactMatch("  391 ", "391").passed).toBe(true);
    expect(exactMatch("Three ninety one", "391").passed).toBe(false);
  });

  it("honours case sensitivity", () => {
    expect(exactMatch("OK", "ok").passed).toBe(true);
    expect(exactMatch("OK", "ok", true).passed).toBe(false);
  });
});

describe("containsAll", () => {
  it("passes when every required item is present", () => {
    const result = containsAll("the port is 4100 for auth", ["4100", "auth"]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("reports partial credit and the missing items", () => {
    const result = containsAll("the port is 4100", ["4100", "auth"]);
    expect(result.passed).toBe(false);
    expect(result.score).toBeCloseTo(0.5);
    expect(result.detail).toContain("auth");
  });

  it("passes vacuously with no requirements", () => {
    expect(containsAll("anything", []).passed).toBe(true);
  });
});

describe("factRecall", () => {
  it("scores token overlap", () => {
    const result = factRecall(
      "The quarterly planning codename is navy-ember",
      "the quarterly planning codename is navy-ember",
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when the fact is absent", () => {
    const result = factRecall("I do not know", "the quarterly planning codename is navy-ember");
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(0.6);
  });
});

describe("constraintCheck", () => {
  it("enforces include and exclude constraints", () => {
    const good = constraintCheck("a transaction is atomic [OK]", ["[OK]"], ["utilize"]);
    expect(good.passed).toBe(true);
    const bad = constraintCheck("you should utilize transactions", ["[OK]"], ["utilize"]);
    expect(bad.passed).toBe(false);
    expect(bad.detail).toContain("utilize");
  });

  it("passes when there are no constraints", () => {
    expect(constraintCheck("anything").passed).toBe(true);
  });
});

describe("numericMatch", () => {
  it("extracts the first number from noisy output", () => {
    expect(numericMatch("391 [OK]", 391).passed).toBe(true);
    expect(numericMatch("The answer is 391.", 391).passed).toBe(true);
    expect(numericMatch("390", 391).passed).toBe(false);
  });

  it("supports tolerance and reports missing numbers", () => {
    expect(numericMatch("3.14", 3.1, 0.1).passed).toBe(true);
    expect(numericMatch("no idea", 5).passed).toBe(false);
  });
});

describe("commandCheck", () => {
  it("passes for a zero exit code", async () => {
    const result = await commandCheck(process.execPath, ["-e", "process.exit(0)"]);
    expect(result.passed).toBe(true);
  });

  it("fails for a non-zero exit code", async () => {
    const result = await commandCheck(process.execPath, ["-e", "process.exit(2)"]);
    expect(result.passed).toBe(false);
  });
});

describe("evaluateObjective", () => {
  it("dispatches to each evaluator", async () => {
    expect((await evaluateObjective({ type: "exact", expected: "yes" }, "yes")).passed).toBe(true);
    expect((await evaluateObjective({ type: "containsAll", required: ["a"] }, "abc")).passed).toBe(true);
    expect(
      (await evaluateObjective({ type: "factRecall", fact: "navy ember token" }, "the navy ember token")).passed,
    ).toBe(true);
    expect((await evaluateObjective({ type: "constraints", include: ["x"] }, "x y")).passed).toBe(true);
    expect((await evaluateObjective({ type: "numeric", expected: 42 }, "the answer is 42")).passed).toBe(true);
    expect(
      (await evaluateObjective({ type: "command", command: process.execPath, args: ["-e", "0"] }, "")).passed,
    ).toBe(true);
  });
});
