import { afterEach, describe, it, expect, vi } from "vitest";
import { searchTool } from "./search.js";

const SAMPLE_RESULTS_HTML = `
<html><body>
<tr class="result">
  <td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Ffetch.html">Node.js fetch API docs</a></td>
  <td class="result-snippet">The fetch API is available as a global in Node.js 18+.</td>
</tr>
<tr class="result">
  <td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Ffetch">Fetch API - MDN</a></td>
  <td class="result-snippet">The global fetch method starts the process of fetching a resource.</td>
</tr>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchTool", () => {
  it("returns results for a web query", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(SAMPLE_RESULTS_HTML, { status: 200 })));
    const r = await searchTool.execute({ query: "Node.js fetch API" });
    expect(r.success).toBe(true);
    expect(typeof r.data).toBe("string");
    expect((r.data as string).length).toBeGreaterThan(50);
  });

  it("returns real URLs and snippets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(SAMPLE_RESULTS_HTML, { status: 200 })));
    const r = await searchTool.execute({ query: "Node.js fetch API" });
    expect(r.success).toBe(true);
    const data = r.data as string;
    expect(data).toContain("https://");
    expect(data).toContain("Node.js fetch API docs");
  });

  it("reports failure when the search endpoint errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const r = await searchTool.execute({ query: "Node.js fetch API" });
    expect(r.success).toBe(false);
  });
});
