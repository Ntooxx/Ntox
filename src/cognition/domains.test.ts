import { describe, it, expect, beforeEach } from "vitest";
import { detectDomains, findClosestDomain, learnDomainKeyword, resetDomainCache } from "./domains.js";

describe("domain detection", () => {
  beforeEach(() => {
    resetDomainCache();
  });

  it("does not match keywords inside longer words", () => {
    expect(detectDomains("email the detailed notes to the team")).not.toContain("data_science");
    expect(detectDomains("I trust the process")).not.toContain("rust");
  });

  it("matches keywords at word boundaries", () => {
    const domains = detectDomains("write Python code with a PostgreSQL database");
    expect(domains).toContain("python");
    expect(domains).toContain("programming");
    expect(domains).toContain("database");
  });

  it("matches multi-word keywords", () => {
    expect(detectDomains("applied machine learning models")).toContain("data_science");
  });

  it("uses learned keywords as whole terms", () => {
    learnDomainKeyword("programming", "backend");
    expect(detectDomains("a backend service")).toContain("programming");
    expect(detectDomains("a backendish service")).not.toContain("programming");
  });

  it("finds the closest domain without substring false positives", () => {
    expect(findClosestDomain("kubernetes")).toBe("devops");
    expect(findClosestDomain("rust")).toBe("rust");
  });
});
