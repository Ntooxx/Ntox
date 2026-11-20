import { randomBytes } from "node:crypto";
import { PHRASE_PATTERNS, STRUCTURAL_PATTERNS, sanitizeInput, type GuardResult } from "./guard.js";

const EXTRA_STRUCTURAL: readonly RegExp[] = [/\[SYS\]/i, /<\|user\|>/i, /<\|im_end\|>/i, /<\|assistant\|>/i];

const MULTILINGUAL_PHRASES: readonly RegExp[] = [
  /ignora (?:tutte )?le istruzioni precedenti/i,
  /ignorer les instructions précédentes/i,
  /忽略之前的指令/,
  /игнорируй предыдущие инструкции/i,
  /直前の指示を無視してください/,
];

const BENIGN_CONTEXT: readonly RegExp[] = [
  /\b(?:how do i|how to|can you explain|explains?|describes?|documentation|changelog|legacy|reserved field|delimits|token|fixture|detector|parser|test|code|const|function|assert|comment|pattern|sanitizer|strips|rebuilding|fixture)\b/i,
  /\b(?:appears in the log|in my own code|handles edge cases|vecchio file|di configurazione|explique comment|anciennes instructions)\b/i,
];

const HOMOGLYPHS: Record<string, string> = {
  ı: "i",
  і: "i",
  о: "o",
  е: "e",
  а: "a",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  0: "o",
  1: "i",
  3: "e",
  4: "a",
  5: "s",
};

function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]{1,6});/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d{1,6});/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(
      /&(?:lt|gt|quot|amp|#39);/gi,
      (entity) =>
        ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&", "&#39;": "'" })[entity.toLowerCase()] ?? entity,
    );
}

function decodePercent(text: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function decodeBase64Runs(text: string): string {
  return text.replace(/\b[A-Za-z0-9+/]{16,}={0,2}\b/g, (token) => {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      return /^[\x20-\x7e\r\n]+$/.test(decoded) && /\s/.test(decoded) ? decoded : token;
    } catch {
      return token;
    }
  });
}

function decodeHexRuns(text: string): string {
  return text.replace(/\b[0-9a-fA-F]{32,}\b/g, (token) => {
    try {
      const decoded = Buffer.from(token, "hex").toString("utf8");
      return /^[\x20-\x7e\r\n]+$/.test(decoded) && /\s/.test(decoded) ? decoded : token;
    } catch {
      return token;
    }
  });
}

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char.charCodeAt(0) < 97 ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const FOLD_PATTERN = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "gi");

function foldHomoglyphs(text: string): string {
  return text.replace(FOLD_PATTERN, (char) => HOMOGLYPHS[char.toLowerCase()] ?? char);
}

export function normalizeVariants(input: string): string[] {
  const variants = new Set<string>([input]);
  const decoders = [decodeUnicodeEscapes, decodeEntities, decodePercent, decodeBase64Runs, decodeHexRuns, rot13];
  let frontier = [input];
  for (let pass = 0; pass < 2 && variants.size < 12; pass++) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const decode of decoders) {
        const decoded = decode(source);
        if (decoded !== source && !variants.has(decoded)) {
          variants.add(decoded);
          next.push(decoded);
        }
      }
    }
    frontier = next;
  }
  for (const variant of [...variants]) {
    const folded = foldHomoglyphs(variant);
    if (!variants.has(folded)) variants.add(folded);
  }
  return [...variants].slice(0, 16);
}

export function isBenignContext(input: string): boolean {
  return BENIGN_CONTEXT.some((pattern) => pattern.test(input));
}

export interface DefenseResult extends GuardResult {
  layers: string[];
}

function warnResult(input: string, match: string, layer: string): DefenseResult {
  return {
    clean: false,
    blocked: false,
    warn: true,
    warnings: [`Injection phrase stripped: "${match}"`],
    sanitizedInput: sanitizeInput(input),
    layers: ["phrase", layer],
  };
}

export function detectInjectionDefense(input: string): DefenseResult {
  const benign = isBenignContext(input);
  const variants = normalizeVariants(input);
  for (const variant of variants) {
    for (const pattern of [...STRUCTURAL_PATTERNS, ...EXTRA_STRUCTURAL]) {
      if (pattern.test(variant) && !benign) {
        return {
          clean: false,
          blocked: true,
          reason: "Prompt injection pattern detected",
          layers: ["structural", "normalized"],
        };
      }
    }
  }
  for (const pattern of [...PHRASE_PATTERNS, ...MULTILINGUAL_PHRASES]) {
    const match = pattern.exec(input);
    if (match && !benign) return warnResult(input, match[0], "phrase-regex");
  }
  for (const variant of variants) {
    for (const pattern of [...PHRASE_PATTERNS, ...MULTILINGUAL_PHRASES]) {
      const match = pattern.exec(variant);
      if (match && !benign) return warnResult(input, match[0], "normalized");
    }
  }
  return { clean: true, blocked: false, layers: [] };
}

export interface SuspiciousClassifier {
  classify(text: string, signal?: AbortSignal): Promise<{ verdict: "injection" | "clean" } | null>;
}

export async function runSecondPass(
  text: string,
  classifier: SuspiciousClassifier,
  timeoutMs = 3000,
  signal?: AbortSignal,
): Promise<"injection" | "clean"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await classifier.classify(text, controller.signal);
    return result?.verdict === "clean" ? "clean" : "injection";
  } catch {
    return "injection";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function createUntrustedWrapper(nonce: string = randomBytes(8).toString("hex")) {
  const open = `<<<UNTRUSTED:${nonce}>>>`;
  const close = `<<<END_UNTRUSTED:${nonce}>>>`;
  return {
    open,
    close,
    wrap: (text: string) => `${open}\n${text}\n${close}`,
  };
}

export function markToolOutput(toolName: string, content: string, wrapper: ReturnType<typeof createUntrustedWrapper>) {
  return wrapper.wrap(`[TOOL_OUTPUT source=${toolName}] ${content}`);
}

export function detectToolCallInjection(args: Record<string, unknown>): boolean {
  for (const value of Object.values(args)) {
    if (typeof value !== "string") continue;
    const result = detectInjectionDefense(value);
    if (result.blocked || result.warn) return true;
  }
  return false;
}
