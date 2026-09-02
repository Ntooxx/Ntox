import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Tool } from "../types/index.js";

const MAX_URL_LENGTH = 4096;
const MAX_RESPONSE_BYTES = 10_000_000;
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
const BLOCKED_CIDR = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^fc00:/, /^fe80:/,
];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Ntox/1.0; +https://github.com/Ntooxx/Ntox)",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};

const BOT_WALL_PATTERNS = [
  /enable javascript/i,
  /checking your browser/i,
  /verify you are human/i,
  /access denied/i,
  /unusual traffic/i,
  /captcha/i,
  /cloudflare/i,
];

export function validateHttpUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH) return "URL exceeds maximum length";
  let url: URL;
  try { url = new URL(raw); } catch { return "Invalid URL format"; }
  if (!["http:", "https:"].includes(url.protocol)) return `Blocked protocol: ${url.protocol}`;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host) || BLOCKED_HOSTS.some((h) => host.endsWith(`.${h}`))) {
    return `Blocked host: ${host}`;
  }
  if (BLOCKED_CIDR.some((r) => r.test(host))) return `Blocked host: ${host}`;
  return null;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) return String.fromCharCode(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCharCode(parseInt(key.slice(1), 10));
    return named[key] ?? `&${entity};`;
  });
}

function normalizeWhitespace(text: string): string {
  return decodeEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToBasicMarkdown(html: string): string {
  return html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, text) => `${"#".repeat(Number(tag[1]))} ${text}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(article|section|main|div|p|ul|ol|table|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, "[$3]($2)")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gis, "\n```\n$1\n```\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function htmlToReadableMarkdown(html: string, url: string): { title: string; content: string; extractor: "readability" | "basic" } {
  try {
    const { document } = parseHTML(html);
    const parsed = new Readability(document, { charThreshold: 100 }).parse();
    if (parsed?.textContent && parsed.textContent.trim().length > 200) {
      const title = normalizeWhitespace(parsed.title || extractHtmlTitle(html));
      return {
        title,
        content: normalizeWhitespace(`# ${title || new URL(url).hostname}\n\n${parsed.textContent}`),
        extractor: "readability",
      };
    }
  } catch {
  }
  return {
    title: extractHtmlTitle(html),
    content: normalizeWhitespace(htmlToBasicMarkdown(html)),
    extractor: "basic",
  };
}

export function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeWhitespace(match[1]) : "";
}

export function diagnoseFetchedContent(content: string, isHtml: boolean): string[] {
  const diagnostics: string[] = [];
  const normalized = normalizeWhitespace(content);
  if (normalized.length < 200) diagnostics.push("low-content");
  if (BOT_WALL_PATTERNS.some((pattern) => pattern.test(normalized))) diagnostics.push("possible-bot-wall");
  if (isHtml && !/<(main|article|p|h1|h2|li|table)\b/i.test(content)) diagnostics.push("no-semantic-content");
  return diagnostics;
}

async function readLimitedResponse(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) throw new Error("Response too large (exceeded 10MB)");
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch content from a URL with 30s timeout. Returns the content as text, markdown (converted from HTML), or raw HTML.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      format: { type: "string", enum: ["markdown", "text", "html"], description: "Format: text (raw), markdown (HTML→MD), html (raw). Default: markdown" },
    },
    required: ["url"],
  },
  async execute(args) {
    const url = String(args.url);
    const blockReason = validateHttpUrl(url);
    if (blockReason) return { success: false, error: `URL rejected: ${blockReason}` };

    const format = (args.format ? String(args.format) : "markdown") as "markdown" | "text" | "html";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: FETCH_HEADERS,
        redirect: "follow",
      });

      if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      const cl = res.headers.get("content-length");
      if (cl && parseInt(cl) > MAX_RESPONSE_BYTES) {
        return { success: false, error: "Response too large (exceeded 10MB)" };
      }
      const raw = await readLimitedResponse(res);
      const contentType = res.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html") || raw.trim().startsWith("<");
      let title = isHtml ? extractHtmlTitle(raw) : "";

      const diagnostics = diagnoseFetchedContent(raw, isHtml);
      let content = raw;
      let extractor = isHtml ? "basic" : "raw";
      if (format === "markdown" && isHtml) {
        const readable = htmlToReadableMarkdown(raw, res.url || url);
        title = readable.title;
        content = readable.content;
        extractor = readable.extractor;
      } else if (format !== "html") {
        content = normalizeWhitespace(raw);
      }

      return {
        success: true,
        data: {
          url: res.url || url,
          status: res.status,
          title,
          content,
          format,
          contentType,
          fetchedAt: new Date().toISOString(),
          diagnostics,
          method: "fetch",
          extractor,
        },
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { success: false, error: "Fetch timed out after 30s" };
      }
      return { success: false, error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timeout);
    }
  },
};
