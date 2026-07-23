import { describe, it, expect } from "vitest";
import { classifyMode, getModePrompt, shouldSkipLLM } from "./response-mode.js";

describe("classifyMode", () => {
  it("detects profile-update", () => {
    expect(classifyMode("my name is John")).toBe("profile-update");
    expect(classifyMode("call me Alex")).toBe("profile-update");
    expect(classifyMode("I work as a developer")).toBe("profile-update");
  });

  it("detects tool-execute", () => {
    expect(classifyMode("open https://example.com")).toBe("tool-execute");
    expect(classifyMode("search for cats")).toBe("tool-execute");
    expect(classifyMode("run the build script")).toBe("tool-execute");
  });

  it("detects emotional-moment", () => {
    expect(classifyMode("thank you so much")).toBe("emotional-moment");
    expect(classifyMode("I am proud of you")).toBe("emotional-moment");
    expect(classifyMode("I love this")).toBe("emotional-moment");
  });

  it("detects tool-build", () => {
    expect(classifyMode("create a tool that reads files")).toBe("tool-build");
    expect(classifyMode("build a script for deployment")).toBe("tool-build");
    expect(classifyMode("write a function to sort arrays")).toBe("tool-build");
  });

  it("detects simple-query for short questions", () => {
    expect(classifyMode("what is 2+2?")).toBe("simple-query");
    expect(classifyMode("how old is the earth?")).toBe("simple-query");
    expect(classifyMode("hi")).toBe("simple-query");
  });

  it("returns complex-reasoning for longer messages", () => {
    const longMsg = "I need you to thoroughly analyze the architecture of a distributed system that handles millions of requests per second, considering fault tolerance, consistency models, and operational complexity";
    expect(classifyMode(longMsg)).toBe("complex-reasoning");
  });
});

describe("shouldSkipLLM", () => {
  it("skips LLM for tool-execute", () => {
    expect(shouldSkipLLM("tool-execute")).toBe(true);
  });

  it("skips LLM for profile-update", () => {
    expect(shouldSkipLLM("profile-update")).toBe(true);
  });

  it("does not skip for other modes", () => {
    expect(shouldSkipLLM("simple-query")).toBe(false);
    expect(shouldSkipLLM("complex-reasoning")).toBe(false);
  });
});

describe("getModePrompt", () => {
  it("returns prompt for each mode", () => {
    expect(getModePrompt("simple-query", "hi")).toContain("Answer concisely");
    expect(getModePrompt("tool-execute", "run x")).toContain("Execute immediately");
    expect(getModePrompt("emotional-moment", "thanks")).toContain("genuine warmth");
    expect(getModePrompt("tool-build", "create x")).toContain("BUILD mode");
  });

  it("returns empty for complex-reasoning", () => {
    expect(getModePrompt("complex-reasoning", "any")).toBe("");
  });
});
