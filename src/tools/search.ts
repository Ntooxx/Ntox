import type { Tool } from "../types/index.js";

const SEARCH_URL = "https://lite.duckduckgo.com/lite/";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function extractRealUrl(href: string): string {
  if (href.includes("uddg=")) {
    const match = href.match(/uddg=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return href;
}

function extractSnippets(html: string): string[] {
  const results: string[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  let currentTitle = "";
  let currentUrl = "";
  let currentSnippet = "";
  let expectSnippet = false;

  for (const row of rows) {
    const text = decodeEntities(row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!text || text.length < 3) continue;
    if (text.includes("Sponsored link")) continue;

    const linkMatch = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (linkMatch) {
      const linkText = decodeEntities(linkMatch[2].replace(/<[^>]+>/g, "").trim());
      if (linkText && linkText.length > 3) {
        if (currentTitle) {
          results.push(`${currentTitle}\n${currentUrl}\n${currentSnippet}\n`);
        }
        currentTitle = linkText;
        currentUrl = extractRealUrl(linkMatch[1]);
        currentSnippet = "";
        expectSnippet = true;
        continue;
      }
    }

    // If we expect a snippet and this row has meaningful text, it's the snippet
    if (expectSnippet && text.length > 10 && !text.match(/^\d+\.\s/)) {
      currentSnippet = text;
      expectSnippet = false;
    }

    // If it's a URL-only row (domain name), skip
    if (text.includes(".") && !text.includes(" ") && text.length < 50) {
      expectSnippet = false;
    }
  }

  if (currentTitle) {
    results.push(`${currentTitle}\n${currentUrl}\n${currentSnippet}\n`);
  }

  return results.slice(0, 5);
}

export const searchTool: Tool = {
  name: "search",
  description: "Search the web for information. Use this when you need up-to-date information about a topic, product, person, or anything you're unsure about.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async execute(args) {
    const query = String(args.query);
    try {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let res: Response;
      try {
        res = await fetch(url, { headers: HEADERS, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        return { success: false, error: `Search failed: ${res.status}` };
      }
      const html = await res.text();
      const snippets = extractSnippets(html);
      if (snippets.length === 0) {
        return { success: false, error: "No results found", data: "" };
      }
      return { success: true, data: snippets.join("\n---\n") };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { success: false, error: "Search timed out after 30s" };
      }
      return { success: false, error: `Search error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};