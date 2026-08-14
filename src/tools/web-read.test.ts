import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserFallbackReason, shouldUseBrowserFallback, webReadTool } from "./web-read.js";
import { browseTool } from "./browse.js";
import { webFetchTool } from "./web.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shouldUseBrowserFallback", () => {
  it("keeps good fetch results", () => {
    expect(shouldUseBrowserFallback({
      success: true,
      data: { content: "x".repeat(700), diagnostics: [] },
    })).toBe(false);
  });

  it("falls back on failed fetches", () => {
    expect(shouldUseBrowserFallback({ success: false, error: "HTTP 403" })).toBe(true);
    expect(getBrowserFallbackReason({ success: false, error: "HTTP 403" })).toBe("fetch-failed");
  });

  it("falls back on bot-wall diagnostics", () => {
    expect(shouldUseBrowserFallback({
      success: true,
      data: { content: "Checking your browser", diagnostics: ["possible-bot-wall"] },
    })).toBe(true);
  });

  it("falls back on very short content", () => {
    expect(shouldUseBrowserFallback({
      success: true,
      data: { content: "too short", diagnostics: [] },
    })).toBe(true);
    expect(getBrowserFallbackReason({
      success: true,
      data: { content: "too short", diagnostics: [] },
    })).toBe("low-content");
  });

  it("returns short fetched content when browser fallback is disabled by policy", async () => {
    vi.spyOn(webFetchTool, "execute").mockResolvedValue({
      success: true,
      data: { content: "short but useful", diagnostics: [], method: "fetch" },
    });
    const browse = vi.spyOn(browseTool, "execute");
    const result = await webReadTool.execute({ url: "https://example.com", allowBrowserFallback: false });
    expect(result.success).toBe(true);
    expect(browse).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      content: "short but useful",
      diagnostics: ["browser-fallback-disabled", "low-content"],
      steps: [{ method: "fetch", success: true }],
    });
  });

  it("returns partial fetched content when browser fallback fails", async () => {
    vi.spyOn(webFetchTool, "execute").mockResolvedValue({
      success: true,
      data: { content: "partial page", diagnostics: [], method: "fetch" },
    });
    vi.spyOn(browseTool, "execute").mockResolvedValue({
      success: false,
      error: "browser unavailable",
    });
    const result = await webReadTool.execute({ url: "https://example.com" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      content: "partial page",
      diagnostics: ["browser-fallback-failed", "low-content"],
      browserError: "browser unavailable",
      steps: [
        { method: "fetch", success: true },
        { method: "browser", success: false, error: "browser unavailable" },
      ],
    });
  });

  it("does not use browser fallback when disabled by policy", async () => {
    const result = await webReadTool.execute({ url: "http://127.0.0.1:3000", allowBrowserFallback: false });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Browser fallback disabled by policy");
    expect(result.data).toMatchObject({ steps: [{ method: "fetch", success: false, diagnostics: [] }] });
  });
});
