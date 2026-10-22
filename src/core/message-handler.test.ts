import { describe, expect, it } from "vitest";
import { TokenFilter, computeTurnTimeoutMs } from "./message-handler.js";

describe("computeTurnTimeoutMs", () => {
  it("keeps the 10 minute floor for small budgets", () => {
    expect(computeTurnTimeoutMs(4096)).toBe(10 * 60 * 1000);
    expect(computeTurnTimeoutMs(1000)).toBe(10 * 60 * 1000);
  });

  it("scales the budget for 32000 tokens instead of truncating mid-generation", () => {
    const timeout = computeTurnTimeoutMs(32000);
    expect(timeout).toBeGreaterThan(10 * 60 * 1000);
    expect(timeout).toBe(Math.round((32000 / 40) * 2) * 1000);
  });

  it("never exceeds the 45 minute hard cap", () => {
    expect(computeTurnTimeoutMs(500_000)).toBe(45 * 60 * 1000);
    expect(computeTurnTimeoutMs(1_000_000)).toBe(45 * 60 * 1000);
  });

  it("is monotonically non-decreasing as the budget grows", () => {
    let previous = 0;
    for (const tokens of [512, 1024, 4096, 8192, 16384, 32000, 64000]) {
      const timeout = computeTurnTimeoutMs(tokens);
      expect(timeout).toBeGreaterThanOrEqual(previous);
      previous = timeout;
    }
  });

  it("gives 32000 tokens enough room at the observed ~40 tok/s", () => {
    const secondsFor32k = 32000 / 40;
    expect(computeTurnTimeoutMs(32000) / 1000).toBeGreaterThan(secondsFor32k * 1.5);
  });
});

describe("TokenFilter", () => {
  it("passes through normal text", () => {
    const filter = new TokenFilter();
    expect(filter.filter("hello world")).toBe("hello world");
  });

  it("removes system-reminder tags", () => {
    const filter = new TokenFilter();
    const result = filter.filter("hello <system-reminder>internal</system-reminder> world");
    expect(result).toBe("hello  world");
  });

  it("handles system-reminder split across multiple calls", () => {
    const filter = new TokenFilter();
    let result = filter.filter("hello <system-reminder>");
    result += filter.filter("internal content");
    result += filter.filter("</system-reminder> world");
    expect(result).toBe("hello  world");
  });

  it("handles tag-like text that is not system-reminder", () => {
    const filter = new TokenFilter();
    const result = filter.filter("this is <not-a-reminder> text");
    expect(result).toBe("this is <not-a-reminder> text");
  });

  it("resets state between uses", () => {
    const filter = new TokenFilter();
    expect(filter.filter("hello <system-reminder>internal</system-reminder> world")).toBe("hello  world");
    expect(filter.filter("clean text")).toBe("clean text");
  });
});
