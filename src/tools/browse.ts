import type { Tool } from "../types/index.js";
import { diagnoseFetchedContent, htmlToBasicMarkdown, validateHttpUrl } from "./web.js";

let browserPromise: Promise<any> | null = null;
let browserInstance: any = null;
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function launchBrowser(): Promise<any> {
  try {
    let chromium: any;
    try {
      chromium = (await import("playwright-core")).chromium;
    } catch {
      const runtimeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
      chromium = (await runtimeImport("playwright")).chromium;
    }
    return await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    browserPromise = null;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Executable doesn't exist") || msg.includes("browserType.launch")) return null;
    return null;
  }
}

async function getBrowser(): Promise<unknown> {
  if (browserInstance) {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(() => {
      if (browserInstance) {
        browserInstance.close().catch(() => {});
        browserInstance = null;
        browserPromise = null;
      }
    }, 60_000);
    return browserInstance;
  }
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  const browser = await browserPromise;
  if (browser) {
    browserInstance = browser;
    browserPromise = null;
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(() => {
      if (browserInstance) {
        browserInstance.close().catch(() => {});
        browserInstance = null;
        browserPromise = null;
      }
    }, 60_000);
  } else {
    browserPromise = null;
  }
  return browser;
}

async function scrollPage(page: any, requestedTimes: number): Promise<void> {
  const scrollTimes = Math.max(0, Math.min(Number.isFinite(requestedTimes) ? requestedTimes : 3, 10));
  for (let i = 0; i < scrollTimes; i++) {
    await page.evaluate("window.scrollBy(0, Math.max(window.innerHeight * 0.85, 600))");
    await new Promise((r) => setTimeout(r, 500));
  }
}

export const browseTool: Tool = {
  name: "browse",
  description:
    "Browse a JavaScript-rendered webpage using a real browser. Use for LinkedIn, Indeed, Glassdoor, Wellfound, or any SPA that requires JS. Supports snapshots, extraction, clicking, and scrolling.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to browse" },
      action: {
        type: "string",
        enum: ["snapshot", "extract", "click", "scroll", "markdown"],
        description: "snapshot (get page text), markdown (page HTML as markdown), extract (get text from selector), click (click element), scroll (scroll down and snapshot)",
      },
      selector: { type: "string", description: "CSS selector for extract/click actions" },
      waitMs: { type: "number", description: "Milliseconds to wait after page load (default: 3000)" },
      scrollTimes: { type: "number", description: "Number of scroll-down actions before snapshot (default: 3)" },
    },
    required: ["url", "action"],
  },
  async execute(args) {
    const url = String(args.url);
    const action = String(args.action);

    const blockReason = validateHttpUrl(url);
    if (blockReason) return { success: false, error: `URL rejected: ${blockReason}` };

    const browser = await getBrowser();
    if (!browser) {
      return {
        success: false,
        error: "Playwright not installed. Run: npm install playwright-core && npx playwright install chromium",
      };
    }

    const waitMs = Math.max(0, Math.min(args.waitMs != null ? Number(args.waitMs) : 3000, 15000));
    let page: any = null;

    try {
      page = await (browser as any).newPage();
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, waitMs));

      switch (action) {
        case "snapshot": {
          await scrollPage(page, args.scrollTimes != null ? Number(args.scrollTimes) : 3);
          const text: string = await page.innerText("body");
          const truncated = text.length > 15000 ? text.slice(0, 15000) + "\n\n... (truncated)" : text;
          return { success: true, data: { url: page.url(), action, title: await page.title(), content: truncated, length: text.length, diagnostics: diagnoseFetchedContent(text, false), method: "browser" } };
        }
        case "markdown": {
          await scrollPage(page, args.scrollTimes != null ? Number(args.scrollTimes) : 1);
          const html: string = await page.content();
          const content = htmlToBasicMarkdown(html).trim();
          const truncated = content.length > 15000 ? content.slice(0, 15000) + "\n\n... (truncated)" : content;
          return { success: true, data: { url: page.url(), action, title: await page.title(), content: truncated, length: content.length, diagnostics: diagnoseFetchedContent(html, true), method: "browser" } };
        }
        case "extract": {
          const selector = String(args.selector || "body");
          await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
          const text: string = await page.innerText(selector);
          return { success: true, data: { url: page.url(), action, selector, content: text } };
        }
        case "click": {
          const selector = String(args.selector || "");
          if (!selector) return { success: false, error: "click action requires a selector" };
          await page.waitForSelector(selector, { timeout: 15000 });
          await page.click(selector, { timeout: 10000 });
          await new Promise((r) => setTimeout(r, 1500));
          const text: string = await page.innerText("body");
          return { success: true, data: { url: page.url(), action, selector, content: text.slice(0, 8000) } };
        }
        case "scroll": {
          await scrollPage(page, args.scrollTimes != null ? Number(args.scrollTimes) : 3);
          const text: string = await page.innerText("body");
          return { success: true, data: { url: page.url(), action, content: text.slice(0, 15000), length: text.length, diagnostics: diagnoseFetchedContent(text, false), method: "browser" } };
        }
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Timeout") || msg.includes("timeout")) {
        return { success: false, error: "Browse timed out. The page may be too slow or blocked." };
      }
      return { success: false, error: `Browse failed: ${msg}` };
    } finally {
      if (page) page.close().catch(() => {});
    }
  },
};
