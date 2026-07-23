import { describe, it, expect } from "vitest";
import { searchTool } from "./search.js";

describe("searchTool", () => {
  it("returns results for a web query", async () => {
    const r = await searchTool.execute({ query: "Node.js fetch API" });
    expect(r.success).toBe(true);
    expect(typeof r.data).toBe("string");
    expect((r.data as string).length).toBeGreaterThan(50);
  }, 20000);

  it("returns real URLs and snippets", async () => {
    const r = await searchTool.execute({ query: "OpenClaw AI agent" });
    expect(r.success).toBe(true);
    const data = r.data as string;
    expect(data).toContain("https://");
    expect(data).toContain("OpenClaw");
  }, 20000);
});