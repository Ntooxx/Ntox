import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NTOX_DIR } from "../core/config.js";

const EXTENSIONS_PATH = join(NTOX_DIR, "domain-extensions.json");

export const DOMAIN_KEYWORDS: Record<string, string[]> = {
  programming: ["code", "programming", "software", "developer", "app", "web", "api", "function", "class", "algorithm"],
  python: ["python", "django", "flask", "pandas", "numpy", "pip"],
  javascript: ["javascript", "typescript", "react", "node", "vue", "angular", "js", "ts", "npm"],
  rust: ["rust", "cargo", "rustc", "ownership", "borrow"],
  data_science: ["data", "machine learning", "ai", "neural", "statistics", "dataset", "model", "training"],
  devops: ["docker", "kubernetes", "deploy", "ci/cd", "pipeline", "cloud", "aws"],
  database: ["sql", "database", "postgres", "mysql", "mongodb", "redis", "query"],
  system_admin: ["linux", "server", "bash", "shell", "terminal", "config", "ssh"],
  design: ["design", "ui", "ux", "figma", "css", "style", "layout", "component"],
  writing: ["write", "essay", "article", "documentation", "doc", "explain", "describe"],
};

export const ALL_DOMAINS = Object.keys(DOMAIN_KEYWORDS);

interface DomainExtensions {
  keywords: Record<string, string[]>;
  learnedDomains: string[];
}

let cachedExtensions: DomainExtensions | null = null;

function loadExtensions(): DomainExtensions {
  if (cachedExtensions) return cachedExtensions;
  if (!existsSync(EXTENSIONS_PATH)) {
    cachedExtensions = { keywords: {}, learnedDomains: [] };
    return cachedExtensions;
  }
  try {
    cachedExtensions = JSON.parse(readFileSync(EXTENSIONS_PATH, "utf-8"));
    return cachedExtensions!;
  } catch {
    cachedExtensions = { keywords: {}, learnedDomains: [] };
    return cachedExtensions;
  }
}

function saveExtensions(ext: DomainExtensions): void {
  cachedExtensions = ext;
  if (!existsSync(NTOX_DIR)) mkdirSync(NTOX_DIR, { recursive: true });
  writeFileSync(EXTENSIONS_PATH, JSON.stringify(ext, null, 2));
}

function getExtendedKeywords(): Record<string, string[]> {
  const ext = loadExtensions();
  const merged: Record<string, string[]> = {};
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    merged[domain] = [...kws, ...(ext.keywords[domain] || [])];
  }
  for (const domain of ext.learnedDomains) {
    if (!merged[domain]) merged[domain] = [];
  }
  return merged;
}

let extendedKeywordsCache: Record<string, string[]> | null = null;

function getCachedKeywords(): Record<string, string[]> {
  if (!extendedKeywordsCache) extendedKeywordsCache = getExtendedKeywords();
  return extendedKeywordsCache;
}

function invalidateKeywordsCache(): void {
  extendedKeywordsCache = null;
}

export function detectDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const allKeywords = getCachedKeywords();
  const domains: string[] = [];
  for (const [domain, keywords] of Object.entries(allKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      domains.push(domain);
    }
  }
  return domains;
}

export function learnDomainKeyword(domain: string, keyword: string): void {
  const ext = loadExtensions();
  if (!ext.keywords[domain]) ext.keywords[domain] = [];
  const lower = keyword.toLowerCase();
  if (!ext.keywords[domain].includes(lower) && !DOMAIN_KEYWORDS[domain]?.includes(lower)) {
    ext.keywords[domain].push(lower);
    saveExtensions(ext);
    invalidateKeywordsCache();
  }
}

export function learnNewDomain(domain: string, keywords: string[]): void {
  const ext = loadExtensions();
  if (!ext.learnedDomains.includes(domain)) ext.learnedDomains.push(domain);
  if (!ext.keywords[domain]) ext.keywords[domain] = [];
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (!ext.keywords[domain].includes(lower)) ext.keywords[domain].push(lower);
  }
  saveExtensions(ext);
  invalidateKeywordsCache();
}

export function findClosestDomain(term: string): string | null {
  const lower = term.toLowerCase();
  let bestScore = 0;
  let bestDomain: string | null = null;
  for (const [domain, keywords] of Object.entries(getCachedKeywords())) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 2;
      if (kw.includes(lower)) score += 1;
    }
    const domainWords = domain.split("_");
    for (const dw of domainWords) {
      if (lower.includes(dw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }
  return bestDomain;
}

export function resetDomainCache(): void {
  cachedExtensions = null;
  extendedKeywordsCache = null;
}
