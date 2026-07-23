import type { Tool } from "../types/index.js";

const MAX_URL_LENGTH = 4096;
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
const BLOCKED_CIDR = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^fc00:/, /^fe80:/,
];

function validateUrl(raw: string): string | null {
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

function htmlToBasicMarkdown(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n")
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n")
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
    .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    const blockReason = validateUrl(url);
    if (blockReason) return { success: false, error: `URL rejected: ${blockReason}` };

    const format = (args.format ? String(args.format) : "markdown") as "markdown" | "text" | "html";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Ntox-Agent/1.0" },
      });

      if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
      const cl = res.headers.get("content-length");
      if (cl && parseInt(cl) > 10_000_000) {
        return { success: false, error: "Response too large (exceeded 10MB)" };
      }
      const raw = await res.text();
      if (raw.length > 10_000_000) {
        return { success: false, error: "Response too large (exceeded 10MB)" };
      }
      const contentType = res.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html") || raw.trim().startsWith("<");

      let content = raw;
      if (format === "markdown" && isHtml) {
        content = htmlToBasicMarkdown(raw);
      }

      return { success: true, data: { url, status: res.status, content, format } };
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
