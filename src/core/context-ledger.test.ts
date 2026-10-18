import { describe, expect, it } from "vitest";
import { assembleSelectedSystemPrompt, assembleBudgetedSystemPrompt } from "./context-ledger.js";

describe("assembleSelectedSystemPrompt", () => {
  const sections = [
    { name: "mode", text: "\n\nMODE", priority: 100 },
    { name: "user", text: "\n\nUSER", priority: 90 },
    { name: "memory", text: "\n\nMEMORY", priority: 75 },
    { name: "theory", text: "\n\nTHEORY", priority: 65 },
    { name: "style", text: "\n\nSTYLE", priority: 10 },
  ];

  it("includes only selected sections in priority order", () => {
    const result = assembleSelectedSystemPrompt("BASE", sections, new Set(["style", "mode", "memory"]));
    expect(result.included).toEqual(["mode", "memory", "style"]);
    expect(result.prompt).toBe("BASE\n\nMODE\n\nMEMORY\n\nSTYLE");
    expect(result.dropped).toEqual(["user", "theory"]);
  });

  it("skips empty sections", () => {
    const withEmpty = [...sections, { name: "empty", text: "", priority: 50 }];
    const result = assembleSelectedSystemPrompt("BASE", withEmpty, new Set(["mode", "empty"]));
    expect(result.included).toEqual(["mode"]);
    expect(result.dropped).not.toContain("empty");
  });

  it("counts used tokens including base", () => {
    const result = assembleSelectedSystemPrompt("BASE", sections, new Set(["mode"]));
    expect(result.usedTokens).toBeGreaterThan(0);
  });
});

describe("assembleBudgetedSystemPrompt (fallback)", () => {
  it("drops lowest priority sections when over budget", () => {
    const sections = [
      { name: "a", text: "x".repeat(400), priority: 100 },
      { name: "b", text: "y".repeat(400), priority: 50 },
    ];
    const result = assembleBudgetedSystemPrompt("base", sections, 200);
    expect(result.included).toContain("a");
    expect(result.dropped).toContain("b");
  });
});
