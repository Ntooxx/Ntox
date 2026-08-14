import type { Tool, ToolResult } from "../types/index.js";
import { browseTool } from "./browse.js";
import { webFetchTool } from "./web.js";

type WebReadMethod = "fetch" | "browser";
type BrowserFallbackReason = "fetch-failed" | "possible-bot-wall" | "no-semantic-content" | "low-content";

interface WebReadStep {
  method: WebReadMethod;
  success: boolean;
  diagnostics: string[];
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getDiagnostics(result: ToolResult): string[] {
  const data = asRecord(result.data);
  const diagnostics = data.diagnostics;
  return Array.isArray(diagnostics) ? diagnostics.map(String) : [];
}

function getContentLength(result: ToolResult): number {
  const data = asRecord(result.data);
  const content = data.content;
  return typeof content === "string" ? content.trim().length : 0;
}

export function shouldUseBrowserFallback(result: ToolResult): boolean {
  return getBrowserFallbackReason(result) !== null;
}

export function getBrowserFallbackReason(result: ToolResult): BrowserFallbackReason | null {
  if (!result.success) return "fetch-failed";
  const diagnostics = getDiagnostics(result);
  if (diagnostics.includes("possible-bot-wall")) return "possible-bot-wall";
  if (diagnostics.includes("no-semantic-content")) return "no-semantic-content";
  return getContentLength(result) < 500 ? "low-content" : null;
}

function makeStep(method: WebReadMethod, result: ToolResult): WebReadStep {
  return {
    method,
    success: result.success,
    diagnostics: getDiagnostics(result),
    error: result.error,
  };
}

export const webReadTool: Tool = {
  name: "web_read",
  description: "Reliably read a URL. Tries direct fetch first, then falls back to a browser-rendered markdown snapshot when content looks empty, blocked, or JavaScript-dependent.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to read" },
      preferBrowser: { type: "boolean", description: "Start with browser rendering instead of direct fetch" },
      waitMs: { type: "number", description: "Browser wait time in milliseconds when fallback is used" },
      allowBrowserFallback: { type: "boolean", description: "Internal policy flag controlling browser fallback" },
    },
    required: ["url"],
  },
  async execute(args) {
    const url = String(args.url);
    const waitMs = args.waitMs != null ? Number(args.waitMs) : 2500;
    const allowBrowserFallback = args.allowBrowserFallback !== false;
    const steps: WebReadStep[] = [];
    let fetched: ToolResult | null = null;
    let fallbackReason: BrowserFallbackReason | null = null;

    if (args.preferBrowser !== true) {
      fetched = await webFetchTool.execute({ url, format: "markdown" });
      steps.push(makeStep("fetch", fetched));
      fallbackReason = getBrowserFallbackReason(fetched);
      if (!fallbackReason) {
        return { success: true, data: { ...asRecord(fetched.data), steps } };
      }
    }

    if (!allowBrowserFallback) {
      if (fetched?.success) {
        const data = asRecord(fetched.data);
        const diagnostics = getDiagnostics(fetched);
        return {
          success: true,
          data: {
            ...data,
            diagnostics: [...diagnostics, "browser-fallback-disabled", fallbackReason].filter(Boolean),
            steps,
          },
        };
      }
      return {
        success: false,
        error: "Browser fallback disabled by policy",
        data: { steps },
      };
    }

    const browsed = await browseTool.execute({ url, action: "markdown", waitMs, scrollTimes: 1 });
    steps.push(makeStep("browser", browsed));
    if (browsed.success) {
      return { success: true, data: { ...asRecord(browsed.data), steps } };
    }

    if (fetched?.success) {
      const data = asRecord(fetched.data);
      const diagnostics = getDiagnostics(fetched);
      return {
        success: true,
        data: {
          ...data,
          diagnostics: [...diagnostics, "browser-fallback-failed", fallbackReason].filter(Boolean),
          browserError: browsed.error,
          steps,
        },
      };
    }

    const fetchStep = steps.find((step) => step.method === "fetch");
    return {
      success: false,
      error: browsed.error || fetchStep?.error || "Unable to read URL",
      data: { steps },
    };
  },
};
