import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { validateHttpUrl } from "../tools/web.js";
import { sanitizeSkillName } from "./installer.js";

const INDEX_TIMEOUT_MS = 15_000;
const MAX_INDEX_BYTES = 1_000_000;
const MAX_ENTRIES = 200;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;

export interface MarketplaceEntry {
  name: string;
  source: string;
  description: string;
}

export type MarketplaceIndexParse = { ok: true; entries: MarketplaceEntry[] } | { ok: false; error: string };

function resolveSource(source: string, base: string): string {
  if (/^(https?|ssh|git):\/\//i.test(source) || /^git@/.test(source)) return source;
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith("\\\\")) return source;
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(source, base).toString();
    } catch {
      return source;
    }
  }
  return isAbsolute(source) ? source : resolve(dirname(base), source);
}

function collectRawEntries(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed))
    return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const skills = record.skills ?? record.entries ?? record.index;
  if (Array.isArray(skills)) {
    return skills.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (skills && typeof skills === "object") {
    const entries: Record<string, unknown>[] = [];
    for (const [name, value] of Object.entries(skills as Record<string, unknown>)) {
      if (value && typeof value === "object") entries.push({ ...(value as Record<string, unknown>), name });
      else if (typeof value === "string") entries.push({ name, source: value });
    }
    return entries;
  }
  return null;
}

export function parseMarketplaceIndex(text: string, base: string): MarketplaceIndexParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "index is not valid JSON" };
  }
  const rawEntries = collectRawEntries(parsed);
  if (!rawEntries) return { ok: false, error: "index must contain a skills array or map" };

  const entries: MarketplaceEntry[] = [];
  const seen = new Set<string>();
  for (const raw of rawEntries) {
    if (typeof raw.name !== "string" || typeof raw.source !== "string") continue;
    const name = sanitizeSkillName(raw.name);
    const source = raw.source.trim();
    if (!name || !source || seen.has(name)) continue;
    seen.add(name);
    entries.push({
      name,
      source: resolveSource(source, base),
      description: typeof raw.description === "string" ? raw.description.trim() : "",
    });
    if (entries.length >= MAX_ENTRIES) break;
  }
  if (entries.length === 0) return { ok: false, error: "index contains no valid skill entries" };
  return { ok: true, entries };
}

async function readIndexText(source: string, fetchImpl: typeof fetch): Promise<string> {
  let text: string;
  if (/^https?:\/\//i.test(source)) {
    const blocked = validateHttpUrl(source);
    if (blocked) throw new Error(blocked);
    const response = await fetchImpl(source, {
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      redirect: "follow",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`index fetch failed: HTTP ${response.status}`);
    text = await response.text();
  } else {
    if (!existsSync(source)) throw new Error(`index not found: ${source}`);
    text = readFileSync(source, "utf-8");
  }
  if (text.length > MAX_INDEX_BYTES) throw new Error("marketplace index too large");
  return text;
}

export type MarketplaceLookup =
  | { status: "found"; entry: MarketplaceEntry }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "unavailable"; error: string };

export type MarketplaceListing =
  { ok: true; entries: MarketplaceEntry[] } | { ok: false; error: string; disabled?: boolean };

export interface SkillMarketplace {
  lookup(name: string): Promise<MarketplaceLookup>;
  list(query?: string): Promise<MarketplaceListing>;
}

export interface MarketplaceOptions {
  indexSource: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
}

export function createMarketplace(options: MarketplaceOptions): SkillMarketplace {
  const source = options.indexSource.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let cached: { entries: MarketplaceEntry[]; fetchedAt: number } | null = null;
  let inFlight: Promise<MarketplaceListing> | null = null;

  const load = (): Promise<MarketplaceListing> => {
    if (cached && now() - cached.fetchedAt < ttl) return Promise.resolve({ ok: true, entries: cached.entries });
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<MarketplaceListing> => {
      try {
        const parsed = parseMarketplaceIndex(await readIndexText(source, fetchImpl), source);
        if (parsed.ok) {
          cached = { entries: parsed.entries, fetchedAt: now() };
          return { ok: true, entries: parsed.entries };
        }
        if (cached) return { ok: true, entries: cached.entries };
        return parsed;
      } catch (error) {
        if (cached) return { ok: true, entries: cached.entries };
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const disabledListing = (): MarketplaceListing => ({
    ok: false,
    error: "skillMarketplaceIndex is empty",
    disabled: true,
  });

  return {
    async lookup(name: string): Promise<MarketplaceLookup> {
      if (!source) return { status: "disabled" };
      const normalized = sanitizeSkillName(name);
      if (!normalized) return { status: "not-found" };
      const listing = await load();
      if (!listing.ok) return { status: "unavailable", error: listing.error };
      const entry = listing.entries.find((candidate) => candidate.name === normalized);
      return entry ? { status: "found", entry } : { status: "not-found" };
    },
    async list(query?: string): Promise<MarketplaceListing> {
      if (!source) return disabledListing();
      const listing = await load();
      if (!listing.ok) return listing;
      const needle = query?.trim().toLowerCase();
      const entries = needle
        ? listing.entries.filter(
            (entry) => entry.name.includes(needle) || entry.description.toLowerCase().includes(needle),
          )
        : listing.entries;
      return { ok: true, entries };
    },
  };
}

export function renderMarketplaceList(listing: MarketplaceListing, query?: string): string {
  if (!listing.ok) {
    if (listing.disabled) {
      return "Skill marketplace is disabled. Set skillMarketplaceIndex in ~/.ntox/config.json to an index URL.";
    }
    return `Skill marketplace unavailable: ${listing.error}\nPass a URL, git repo, or file path to /skill install instead.`;
  }
  if (listing.entries.length === 0) {
    return query?.trim() ? `No marketplace skills matched "${query.trim()}".` : "The marketplace index is empty.";
  }
  const width = Math.max(...listing.entries.map((entry) => entry.name.length));
  const lines = [`Skill marketplace (${listing.entries.length}):`];
  for (const entry of listing.entries) {
    const description = entry.description ? ` — ${entry.description}` : "";
    lines.push(`  ${entry.name.padEnd(width)}${description}`);
  }
  lines.push("", "Install: /skill install <name>");
  return lines.join("\n");
}
