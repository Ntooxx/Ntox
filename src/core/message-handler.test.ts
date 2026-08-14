import { describe, expect, it } from "vitest";
import { TokenFilter } from "./message-handler.js";

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