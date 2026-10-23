import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createMarketplace, parseMarketplaceIndex, renderMarketplaceList } from "./marketplace.js";
import { parseSkillJson } from "./installer.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ntox-marketplace-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const INDEX_URL = "https://example.com/marketplace/index.json";

function indexJson(entries: unknown): string {
  return JSON.stringify({ version: 1, skills: entries });
}

describe("parseMarketplaceIndex", () => {
  it("parses the array form and resolves relative sources against an http index", () => {
    const parsed = parseMarketplaceIndex(
      indexJson([{ name: "weather-alerts", source: "skills/weather.json", description: "Forecast alerts" }]),
      INDEX_URL,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries).toEqual([
        {
          name: "weather-alerts",
          source: "https://example.com/marketplace/skills/weather.json",
          description: "Forecast alerts",
        },
      ]);
    }
  });

  it("parses the object map form and the string shorthand", () => {
    const mapForm = parseMarketplaceIndex(
      JSON.stringify({ skills: { "pr-review": { source: "skills/pr.json", description: "Review PRs" } } }),
      INDEX_URL,
    );
    expect(mapForm.ok).toBe(true);
    if (mapForm.ok) expect(mapForm.entries[0]).toMatchObject({ name: "pr-review", description: "Review PRs" });

    const shorthand = parseMarketplaceIndex(
      JSON.stringify({ skills: { "changelog-recap": "skills/log.json" } }),
      INDEX_URL,
    );
    expect(shorthand.ok).toBe(true);
    if (shorthand.ok) expect(shorthand.entries[0].source).toBe("https://example.com/marketplace/skills/log.json");
  });

  it("parses a bare top-level array", () => {
    const parsed = parseMarketplaceIndex(
      JSON.stringify([{ name: "a-skill", source: "https://cdn.example.com/a.json" }]),
      INDEX_URL,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries[0].source).toBe("https://cdn.example.com/a.json");
  });

  it("resolves relative sources against a local index path", () => {
    const base = join(makeTempDir(), "index.json");
    const parsed = parseMarketplaceIndex(indexJson([{ name: "local-skill", source: "skills/local.json" }]), base);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries[0].source).toBe(resolve(dirname(base), "skills/local.json"));
  });

  it("keeps absolute sources and scp-style git sources untouched", () => {
    const parsed = parseMarketplaceIndex(
      indexJson([
        { name: "abs", source: "C:\\skills\\abs.json" },
        { name: "scp", source: "git@github.com:user/repo.git" },
      ]),
      INDEX_URL,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries[0].source).toBe("C:\\skills\\abs.json");
      expect(parsed.entries[1].source).toBe("git@github.com:user/repo.git");
    }
  });

  it("skips malformed entries and dedupes by name", () => {
    const parsed = parseMarketplaceIndex(
      indexJson([
        { name: "good-skill", source: "skills/good.json" },
        { name: "no-source" },
        { source: "skills/unnamed.json" },
        "not-an-object",
        { name: "good-skill", source: "skills/duplicate.json" },
      ]),
      INDEX_URL,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries).toHaveLength(1);
  });

  it("rejects non-JSON, missing skills keys, and empty entry lists", () => {
    expect(parseMarketplaceIndex("{nope", INDEX_URL)).toEqual({ ok: false, error: "index is not valid JSON" });
    expect(parseMarketplaceIndex(JSON.stringify({ version: 1 }), INDEX_URL)).toEqual({
      ok: false,
      error: "index must contain a skills array or map",
    });
    expect(parseMarketplaceIndex(indexJson([{ name: "broken" }]), INDEX_URL)).toEqual({
      ok: false,
      error: "index contains no valid skill entries",
    });
    expect(parseMarketplaceIndex(JSON.stringify("nope"), INDEX_URL)).toEqual({
      ok: false,
      error: "index must contain a skills array or map",
    });
  });
});

describe("createMarketplace", () => {
  function writeLocalIndex(entries: unknown): string {
    const dir = makeTempDir();
    const path = join(dir, "index.json");
    writeFileSync(path, indexJson(entries));
    return path;
  }

  it("resolves names against a local index file", async () => {
    const indexPath = writeLocalIndex([{ name: "weather-alerts", source: "skills/weather.json" }]);
    const marketplace = createMarketplace({ indexSource: indexPath });

    const found = await marketplace.lookup("weather-alerts");
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.entry.source).toBe(resolve(dirname(indexPath), "skills/weather.json"));
    }

    const missing = await marketplace.lookup("no-such-skill");
    expect(missing.status).toBe("not-found");
  });

  it("normalizes lookup names before matching", async () => {
    const indexPath = writeLocalIndex([{ name: "weather-alerts", source: "skills/weather.json" }]);
    const marketplace = createMarketplace({ indexSource: indexPath });
    expect((await marketplace.lookup("Weather Alerts")).status).toBe("found");
    expect((await marketplace.lookup("weather_alerts")).status).toBe("found");
  });

  it("reports disabled when no index is configured", async () => {
    const marketplace = createMarketplace({ indexSource: "  " });
    expect((await marketplace.lookup("anything")).status).toBe("disabled");
    const listing = await marketplace.list();
    expect(listing.ok).toBe(false);
    if (!listing.ok) expect(listing.disabled).toBe(true);
  });

  it("fetches an http index once and serves lookups from cache within the TTL", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response(indexJson([{ name: "weather-alerts", source: "https://example.com/s.json" }]), {
        status: 200,
      });
    }) as typeof fetch;
    let clock = 1_000;
    const marketplace = createMarketplace({
      indexSource: INDEX_URL,
      fetchImpl,
      now: () => clock,
      cacheTtlMs: 60_000,
    });

    expect((await marketplace.lookup("weather-alerts")).status).toBe("found");
    clock += 30_000;
    expect((await marketplace.lookup("weather-alerts")).status).toBe("found");
    expect(fetches).toBe(1);

    clock += 60_000;
    expect((await marketplace.lookup("weather-alerts")).status).toBe("found");
    expect(fetches).toBe(2);
  });

  it("serves the stale cached index when a refresh fails", async () => {
    let mode: "ok" | "fail" = "ok";
    const fetchImpl = (async () => {
      if (mode === "fail") return new Response("down", { status: 503 });
      return new Response(indexJson([{ name: "weather-alerts", source: "https://example.com/s.json" }]), {
        status: 200,
      });
    }) as typeof fetch;
    let clock = 0;
    const marketplace = createMarketplace({
      indexSource: INDEX_URL,
      fetchImpl,
      now: () => clock,
      cacheTtlMs: 1_000,
    });

    expect((await marketplace.lookup("weather-alerts")).status).toBe("found");
    mode = "fail";
    clock += 5_000;
    const stale = await marketplace.lookup("weather-alerts");
    expect(stale.status).toBe("found");
  });

  it("reports unavailable when the first fetch fails", async () => {
    const fetchImpl = (async () => new Response("down", { status: 500 })) as typeof fetch;
    const marketplace = createMarketplace({ indexSource: INDEX_URL, fetchImpl });
    const lookup = await marketplace.lookup("anything");
    expect(lookup.status).toBe("unavailable");
    if (lookup.status === "unavailable") expect(lookup.error).toContain("HTTP 500");
  });

  it("reports unavailable when the index is invalid and nothing is cached", async () => {
    const fetchImpl = (async () => new Response("{nope", { status: 200 })) as typeof fetch;
    const marketplace = createMarketplace({ indexSource: INDEX_URL, fetchImpl });
    const lookup = await marketplace.lookup("anything");
    expect(lookup.status).toBe("unavailable");
    if (lookup.status === "unavailable") expect(lookup.error).toContain("not valid JSON");
  });

  it("blocks private-network index URLs before fetching", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(indexJson([]), { status: 200 });
    }) as typeof fetch;
    const marketplace = createMarketplace({ indexSource: "http://127.0.0.1/index.json", fetchImpl });
    const lookup = await marketplace.lookup("anything");
    expect(called).toBe(false);
    expect(lookup.status).toBe("unavailable");
  });

  it("filters the listing by name and description query", async () => {
    const indexPath = writeLocalIndex([
      { name: "weather-alerts", source: "s1.json", description: "Forecast alerts" },
      { name: "changelog-recap", source: "s2.json", description: "Grouped release notes" },
    ]);
    const marketplace = createMarketplace({ indexSource: indexPath });

    const all = await marketplace.list();
    expect(all.ok && all.entries).toHaveLength(2);

    const byName = await marketplace.list("changelog");
    expect(byName.ok && byName.entries.map((entry) => entry.name)).toEqual(["changelog-recap"]);

    const byDescription = await marketplace.list("forecast");
    expect(byDescription.ok && byDescription.entries.map((entry) => entry.name)).toEqual(["weather-alerts"]);

    const none = await marketplace.list("nothing-matches");
    expect(none.ok && none.entries).toHaveLength(0);
  });
});

describe("renderMarketplaceList", () => {
  it("ships a valid local index whose entries resolve to parseable skill files", async () => {
    const indexPath = join(process.cwd(), "marketplace", "index.json");
    expect(existsSync(indexPath)).toBe(true);
    const marketplace = createMarketplace({ indexSource: indexPath });
    const listing = await marketplace.list();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of listing.entries) {
      expect(existsSync(entry.source), `${entry.name} source missing: ${entry.source}`).toBe(true);
      const parsed = parseSkillJson(readFileSync(entry.source, "utf-8"));
      expect(parsed.ok, `${entry.name}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (parsed.ok) expect(parsed.skill.name).toBe(entry.name);
    }
  });

  it("renders a browsable list with the install hint", () => {
    const text = renderMarketplaceList({
      ok: true,
      entries: [
        { name: "weather-alerts", source: "a", description: "Forecast alerts" },
        { name: "changelog-recap", source: "b", description: "" },
      ],
    });
    expect(text).toContain("Skill marketplace (2):");
    expect(text).toContain("weather-alerts");
    expect(text).toContain("changelog-recap");
    expect(text).toContain("/skill install <name>");
  });

  it("reports an empty query result", () => {
    const text = renderMarketplaceList({ ok: true, entries: [] }, "zzz");
    expect(text).toContain('No marketplace skills matched "zzz"');
  });

  it("explains the disabled state with the config key", () => {
    const text = renderMarketplaceList({ ok: false, error: "skillMarketplaceIndex is empty", disabled: true });
    expect(text).toContain("disabled");
    expect(text).toContain("skillMarketplaceIndex");
  });

  it("explains the unavailable state with a fallback hint", () => {
    const text = renderMarketplaceList({ ok: false, error: "index fetch failed: HTTP 404" });
    expect(text).toContain("unavailable");
    expect(text).toContain("HTTP 404");
    expect(text).toContain("/skill install");
  });
});
