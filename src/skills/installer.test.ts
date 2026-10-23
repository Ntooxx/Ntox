import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifySkillSource,
  installSkillFromSource,
  isMarketplaceName,
  parseSkillJson,
  renderSkillInstallResult,
  resolveSkillSource,
  sanitizeSkillName,
  validateGitUrl,
  type SkillRegistryLike,
} from "./installer.js";
import type { SkillMarketplace } from "./marketplace.js";
import type { SkillDefinition } from "../types/index.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ntox-skill-install-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeRegistry(existing: SkillDefinition[] = []): SkillRegistryLike & { added: SkillDefinition[] } {
  const map = new Map(existing.map((skill) => [skill.name, skill]));
  const added: SkillDefinition[] = [];
  return {
    added,
    get: (name) => map.get(name),
    add: (skill) => {
      map.set(skill.name, skill);
      added.push(skill);
    },
  };
}

function skillJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "deploy-checklist",
    description: "Run the deploy checklist",
    category: "coding",
    prompt: "1. check CI\n2. tag release",
    triggers: ["run deploy checklist"],
    tools: ["shell"],
    examples: ["run the deploy checklist"],
    ...overrides,
  });
}

function makeSkill(name: string): SkillDefinition {
  return {
    name,
    description: name,
    category: "custom",
    prompt: "do the thing",
    triggers: [name],
    tools: [],
    examples: [],
    created: 1,
    updated: 1,
    usageCount: 0,
  };
}

function fakeMarketplace(
  entries: Record<string, string>,
  options: { disabled?: boolean; error?: string } = {},
): SkillMarketplace & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    async lookup(name) {
      lookups.push(name);
      if (options.disabled) return { status: "disabled" };
      if (options.error) return { status: "unavailable", error: options.error };
      const source = entries[name];
      if (!source) return { status: "not-found" };
      return { status: "found", entry: { name, source, description: "" } };
    },
    async list() {
      return { ok: true, entries: [] };
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("classifySkillSource", () => {
  it("routes .json URLs to the url fetcher", () => {
    expect(classifySkillSource("https://example.com/skills/deploy.json")).toEqual({
      kind: "url",
      target: "https://example.com/skills/deploy.json",
    });
    expect(classifySkillSource("https://raw.githubusercontent.com/u/r/main/s.json?token=abc")).toEqual({
      kind: "url",
      target: "https://raw.githubusercontent.com/u/r/main/s.json?token=abc",
    });
  });

  it("routes repository URLs and ssh forms to git", () => {
    expect(classifySkillSource("https://github.com/user/repo").kind).toBe("git");
    expect(classifySkillSource("https://github.com/user/repo.git").kind).toBe("git");
    expect(classifySkillSource("git@github.com:user/repo.git").kind).toBe("git");
    expect(classifySkillSource("ssh://git@host/repo.git").kind).toBe("git");
    expect(classifySkillSource("git+https://github.com/user/repo")).toEqual({
      kind: "git",
      target: "https://github.com/user/repo",
    });
  });

  it("treats plain paths as files and expands ~", () => {
    expect(classifySkillSource("./skills/deploy.json")).toEqual({ kind: "file", target: "./skills/deploy.json" });
    const home = classifySkillSource("~/skills/deploy.json");
    expect(home.kind).toBe("file");
    if (home.kind === "file") expect(home.target.startsWith("~")).toBe(false);
  });

  it("rejects empty input and file:// URLs", () => {
    expect(classifySkillSource("   ").kind).toBe("invalid");
    expect(classifySkillSource("file:///etc/skill.json").kind).toBe("invalid");
  });
});

describe("validateGitUrl", () => {
  it("allows https, ssh, and scp-style URLs", () => {
    expect(validateGitUrl("https://github.com/user/repo")).toBeNull();
    expect(validateGitUrl("git@github.com:user/repo.git")).toBeNull();
    expect(validateGitUrl("ssh://git@host/repo.git")).toBeNull();
  });

  it("rejects everything else", () => {
    expect(validateGitUrl("file:///tmp/repo")).toContain("Unsupported git URL");
    expect(validateGitUrl("--upload-pack=touch /tmp/x")).toContain("Unsupported git URL");
  });

  it("blocks private-network git URLs", () => {
    expect(validateGitUrl("https://127.0.0.1/repo.git")).toContain("Blocked host");
    expect(validateGitUrl("http://192.168.1.10/repo.git")).toContain("Blocked host");
  });
});

describe("sanitizeSkillName", () => {
  it("kebab-cases and bounds the name", () => {
    expect(sanitizeSkillName("Deploy Checklist!")).toBe("deploy-checklist");
    expect(sanitizeSkillName("--weird__name--")).toBe("weird-name");
    expect(sanitizeSkillName("a".repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe("parseSkillJson", () => {
  it("parses and normalizes a valid skill", () => {
    const parsed = parseSkillJson(skillJson({ name: "Deploy Checklist", triggers: ["Run Deploy Checklist "] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill.name).toBe("deploy-checklist");
      expect(parsed.skill.triggers).toEqual(["run deploy checklist"]);
      expect(parsed.skill.tools).toEqual(["shell"]);
      expect(parsed.skill.usageCount).toBe(0);
      expect(parsed.skill.updated).toBeGreaterThan(0);
    }
  });

  it("fills optional fields with defaults", () => {
    const parsed = parseSkillJson(JSON.stringify({ name: "minimal", prompt: "p", triggers: ["min"] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill.description).toBe("minimal");
      expect(parsed.skill.category).toBe("custom");
      expect(parsed.skill.examples).toEqual([]);
      expect(parsed.skill.steps).toBeUndefined();
    }
  });

  it("accepts valid routine steps and rejects malformed ones", () => {
    const withSteps = parseSkillJson(
      JSON.stringify({
        name: "morning-brief",
        prompt: "brief the morning",
        triggers: ["morning brief"],
        steps: [
          { kind: "tool", tool: "web_read", args: { url: "https://x" } },
          { kind: "llm", prompt: "summarize {{step1}}" },
        ],
      }),
    );
    expect(withSteps.ok).toBe(true);
    if (withSteps.ok) expect(withSteps.skill.steps).toHaveLength(2);

    const badSteps = parseSkillJson(
      JSON.stringify({ name: "bad", prompt: "p", triggers: ["t"], steps: [{ kind: "magic" }] }),
    );
    expect(badSteps.ok).toBe(false);
    if (!badSteps.ok) expect(badSteps.error).toContain("invalid steps");
  });

  it("rejects invalid JSON, non-objects, and missing required fields", () => {
    expect(parseSkillJson("{nope")).toEqual({ ok: false, error: "not valid JSON" });
    expect(parseSkillJson("[1,2]")).toEqual({ ok: false, error: "expected a JSON object" });
    expect(parseSkillJson(JSON.stringify({ prompt: "p", triggers: ["t"] }))).toEqual({
      ok: false,
      error: "missing name",
    });
    expect(parseSkillJson(JSON.stringify({ name: "x", triggers: ["t"] }))).toEqual({
      ok: false,
      error: "missing prompt",
    });
    expect(parseSkillJson(JSON.stringify({ name: "x", prompt: "p", triggers: [] }))).toEqual({
      ok: false,
      error: "missing triggers",
    });
  });
});

describe("installSkillFromSource", () => {
  it("installs from a local JSON file", async () => {
    const dir = makeTempDir();
    const file = join(dir, "deploy.json");
    writeFileSync(file, skillJson());
    const registry = makeRegistry();

    const result = await installSkillFromSource(file, registry);

    expect(result.errors).toEqual([]);
    expect(result.installed).toEqual(["deploy-checklist"]);
    expect(registry.get("deploy-checklist")?.prompt).toContain("tag release");
  });

  it("fails with a clear error for a missing file", async () => {
    const result = await installSkillFromSource(join(tmpdir(), "no-such-skill.json"), makeRegistry());
    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("File not found");
  });

  it("fails when a single file is not a skill definition", async () => {
    const dir = makeTempDir();
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ name: "pkg", version: "1.0.0" }));

    const result = await installSkillFromSource(file, makeRegistry());

    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("missing prompt");
  });

  it("scans a directory, installs skills, and ignores unrelated JSON", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "one.json"), skillJson());
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "two.json"), skillJson({ name: "second-skill", triggers: ["second"] }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pkg" }));

    const result = await installSkillFromSource(dir, makeRegistry());

    expect(result.installed.sort()).toEqual(["deploy-checklist", "second-skill"]);
    expect(result.errors).toEqual([]);
  });

  it("reports no JSON files for an empty directory", async () => {
    const dir = makeTempDir();
    const result = await installSkillFromSource(dir, makeRegistry());
    expect(result.errors[0]).toContain("No JSON files found");
  });

  it("skips colliding names without --force and overwrites with it", async () => {
    const dir = makeTempDir();
    const file = join(dir, "deploy.json");
    writeFileSync(file, skillJson({ description: "updated" }));

    const first = await installSkillFromSource(file, makeRegistry());
    expect(first.installed).toEqual(["deploy-checklist"]);

    const existing = makeSkill("deploy-checklist");
    const collide = await installSkillFromSource(file, makeRegistry([existing]));
    expect(collide.installed).toEqual([]);
    expect(collide.skipped).toEqual([
      { name: "deploy-checklist", reason: "already exists (use --force to overwrite)" },
    ]);

    const registry = makeRegistry([existing]);
    const forced = await installSkillFromSource(file, registry, { force: true });
    expect(forced.installed).toEqual(["deploy-checklist"]);
    expect(registry.get("deploy-checklist")?.description).toBe("updated");
  });

  it("installs from a URL through the injected fetch", async () => {
    const fetchOk = (async () =>
      new Response(skillJson(), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const ok = await installSkillFromSource("https://example.com/skill.json", makeRegistry(), {
      fetchImpl: fetchOk,
    });
    expect(ok.installed).toEqual(["deploy-checklist"]);

    const httpError = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const failed = await installSkillFromSource("https://example.com/skill.json", makeRegistry(), {
      fetchImpl: httpError,
    });
    expect(failed.installed).toEqual([]);
    expect(failed.errors[0]).toContain("HTTP 404");
  });

  it("blocks private-network URLs before fetching", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response(skillJson(), { status: 200 });
    }) as typeof fetch;

    const result = await installSkillFromSource("http://127.0.0.1/skill.json", makeRegistry(), {
      fetchImpl: spy,
    });

    expect(called).toBe(false);
    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("Blocked host");
  });

  it("clones a git source through the injected clone, scans it, and cleans up", async () => {
    const seenDirs: string[] = [];
    const clone = async (_url: string, target: string) => {
      seenDirs.push(target);
      mkdirSync(join(target, "skills"), { recursive: true });
      writeFileSync(join(target, "skills", "deploy.json"), skillJson());
      writeFileSync(join(target, "README.md"), "# not a skill");
    };

    const result = await installSkillFromSource("https://github.com/user/repo", makeRegistry(), {
      gitCloneImpl: clone,
    });

    expect(result.installed).toEqual(["deploy-checklist"]);
    expect(seenDirs[0]).toBeTruthy();
    expect(existsSync(seenDirs[0])).toBe(false);
  });

  it("surfaces git clone failures", async () => {
    const clone = async () => {
      throw new Error("git clone failed: repository not found");
    };
    const result = await installSkillFromSource("https://github.com/user/missing", makeRegistry(), {
      gitCloneImpl: clone,
    });
    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("repository not found");
  });

  it("rejects a git source pointing at a private network before cloning", async () => {
    let called = false;
    const result = await installSkillFromSource("https://127.0.0.1/repo.git", makeRegistry(), {
      gitCloneImpl: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
    expect(result.errors[0]).toContain("Blocked host");
  });

  it("rejects an empty source", async () => {
    const result = await installSkillFromSource("  ", makeRegistry());
    expect(result.errors[0]).toContain("Usage:");
  });
});

describe("installSkillFromSource marketplace fallback", () => {
  it("installs a bare name through the marketplace", async () => {
    const dir = makeTempDir();
    const skillFile = join(dir, "weather.json");
    writeFileSync(skillFile, skillJson({ name: "weather-alerts", triggers: ["weather alert"] }));
    const marketplace = fakeMarketplace({ "weather-alerts": skillFile });

    const result = await installSkillFromSource("weather-alerts", makeRegistry(), { marketplace });

    expect(result.errors).toEqual([]);
    expect(result.installed).toEqual(["weather-alerts"]);
    expect(marketplace.lookups).toEqual(["weather-alerts"]);
  });

  it("honors --force for marketplace-sourced names", async () => {
    const dir = makeTempDir();
    const skillFile = join(dir, "weather.json");
    writeFileSync(skillFile, skillJson({ name: "weather-alerts", description: "updated" }));
    const marketplace = fakeMarketplace({ "weather-alerts": skillFile });

    const existing = makeSkill("weather-alerts");
    const collide = await installSkillFromSource("weather-alerts", makeRegistry([existing]), { marketplace });
    expect(collide.installed).toEqual([]);
    expect(collide.skipped).toHaveLength(1);

    const registry = makeRegistry([existing]);
    const forced = await installSkillFromSource("weather-alerts", registry, { marketplace, force: true });
    expect(forced.installed).toEqual(["weather-alerts"]);
    expect(registry.get("weather-alerts")?.description).toBe("updated");
  });

  it("hints at /skill marketplace when the name is not in the index", async () => {
    const marketplace = fakeMarketplace({});
    const result = await installSkillFromSource("nope-skill", makeRegistry(), { marketplace });
    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("/skill marketplace");
  });

  it("surfaces disabled and unavailable marketplace states", async () => {
    const disabled = await installSkillFromSource("weather-alerts", makeRegistry(), {
      marketplace: fakeMarketplace({}, { disabled: true }),
    });
    expect(disabled.errors[0]).toContain("marketplace is disabled");
    expect(disabled.errors[0]).toContain("skillMarketplaceIndex");

    const unavailable = await installSkillFromSource("weather-alerts", makeRegistry(), {
      marketplace: fakeMarketplace({}, { error: "index fetch failed: HTTP 500" }),
    });
    expect(unavailable.errors[0]).toContain("Marketplace unavailable: index fetch failed: HTTP 500");
  });

  it("falls back to the plain file error when no marketplace is configured", async () => {
    const result = await installSkillFromSource("nope-skill", makeRegistry());
    expect(result.errors).toEqual(["File not found: nope-skill"]);
  });

  it("prefers an existing local file over the marketplace", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "local-skill"), skillJson({ name: "local-skill", triggers: ["local"] }));
    const marketplace = fakeMarketplace({ "local-skill": join(dir, "remote.json") });
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await installSkillFromSource("local-skill", makeRegistry(), { marketplace });
      expect(result.installed).toEqual(["local-skill"]);
      expect(marketplace.lookups).toEqual([]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("only treats simple bare words as marketplace names", () => {
    expect(isMarketplaceName("weather-alerts")).toBe(true);
    expect(isMarketplaceName("a_b")).toBe(true);
    expect(isMarketplaceName("./weather.json")).toBe(false);
    expect(isMarketplaceName("skills/weather.json")).toBe(false);
    expect(isMarketplaceName("C:\\skills\\x.json")).toBe(false);
    expect(isMarketplaceName("-leading")).toBe(false);
    expect(isMarketplaceName("")).toBe(false);
  });
});

describe("markdown skill files", () => {
  it("classifies .md and .markdown URLs as url sources", () => {
    expect(classifySkillSource("https://example.com/skills/deploy.md").kind).toBe("url");
    expect(classifySkillSource("https://example.com/deploy.markdown?raw=1").kind).toBe("url");
    expect(classifySkillSource("https://github.com/user/repo").kind).toBe("git");
  });

  it("installs a single markdown file strictly", async () => {
    const dir = makeTempDir();
    const file = join(dir, "deploy-notes.md");
    writeFileSync(
      file,
      "# Deploy Notes\n\n## Purpose\n\nKeep releases boring.\n\n## Triggers\n\n- deploy notes\n- release notes helper\n\n## Prompt\n\n1. run the checklist\n2. write the notes\n3. announce the release\n",
    );

    const registry = makeRegistry();
    const result = await installSkillFromSource(file, registry);

    expect(result.errors).toEqual([]);
    expect(result.installed).toEqual(["deploy-notes"]);
    expect(registry.get("deploy-notes")?.triggers).toEqual(["deploy notes", "release notes helper"]);
    expect(registry.get("deploy-notes")?.prompt).toContain("3. announce the release");
  });

  it("surfaces strict markdown parse errors", async () => {
    const dir = makeTempDir();
    const file = join(dir, "empty-skill.md");
    writeFileSync(file, "   ");

    const result = await installSkillFromSource(file, makeRegistry());

    expect(result.installed).toEqual([]);
    expect(result.errors[0]).toContain("empty markdown file");
  });

  it("scans directories for markdown and skips README/INDEX files", async () => {
    const dir = makeTempDir();
    const good =
      "# Good Skill\n\n## Purpose\n\nDoes good things.\n\n## Triggers\n\n- good skill\n\n## Prompt\n\nAlways do the good thing carefully.\n";
    writeFileSync(join(dir, "good-skill.md"), good);
    writeFileSync(join(dir, "README.md"), good);
    writeFileSync(join(dir, "INDEX.md"), good);
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "nested-skill.md"), good.replace("Good Skill", "Nested Skill"));

    const result = await installSkillFromSource(dir, makeRegistry());

    expect(result.installed.sort()).toEqual(["good-skill", "nested-skill"]);
    expect(result.errors).toEqual([]);
  });
});

describe("skill packs (index.json + markdown files)", () => {
  it("expands a local pack index into its sibling markdown files", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "skills"));
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({ version: 1, skills: [{ name: "pack-skill", source: "skills/pack-skill.md" }] }),
    );
    writeFileSync(
      join(dir, "skills", "pack-skill.md"),
      "# Pack Skill\n\n## Purpose\n\nInstalled from a pack.\n\n## Triggers\n\n- pack skill\n\n## Prompt\n\nDo the packed thing step by step.\n",
    );

    const result = await installSkillFromSource(join(dir, "index.json"), makeRegistry());

    expect(result.errors).toEqual([]);
    expect(result.installed).toEqual(["pack-skill"]);
  });

  it("expands a URL pack through the injected fetch in order", async () => {
    const indexUrl = "https://example.com/pack/index.json";
    const entryUrl = "https://example.com/pack/skills/pack-skill.md";
    const fetched: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      fetched.push(target);
      if (target === indexUrl) {
        return new Response(
          JSON.stringify({ version: 1, skills: [{ name: "pack-skill", source: "skills/pack-skill.md" }] }),
          {
            status: 200,
          },
        );
      }
      if (target === entryUrl) {
        return new Response(
          "# Pack Skill\n\n## Purpose\n\nInstalled from a pack.\n\n## Triggers\n\n- pack skill\n\n## Prompt\n\nDo the packed thing step by step.\n",
          {
            status: 200,
          },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await installSkillFromSource(indexUrl, makeRegistry(), { fetchImpl });

    expect(result.installed).toEqual(["pack-skill"]);
    expect(fetched).toEqual([indexUrl, entryUrl]);
  });

  it("keeps installing pack entries when one source is missing", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({
        version: 1,
        skills: [
          { name: "present-skill", source: "present.md" },
          { name: "absent-skill", source: "absent.md" },
        ],
      }),
    );
    writeFileSync(
      join(dir, "present.md"),
      "# Present Skill\n\n## Purpose\n\nPresent in the pack.\n\n## Triggers\n\n- present skill\n\n## Prompt\n\nDo the present thing step by step.\n",
    );

    const result = await installSkillFromSource(join(dir, "index.json"), makeRegistry());

    expect(result.installed).toEqual(["present-skill"]);
    expect(result.errors.join(" ")).toContain("absent-skill");
    expect(result.errors.join(" ")).toContain("file not found");
  });
});

describe("resolveSkillSource", () => {
  it("returns parsed skills without touching a registry", async () => {
    const dir = makeTempDir();
    const file = join(dir, "deploy.json");
    writeFileSync(file, skillJson());

    const resolved = await resolveSkillSource(file);

    expect(resolved.errors).toEqual([]);
    expect(resolved.skills.map((skill) => skill.name)).toEqual(["deploy-checklist"]);
  });

  it("resolves bare names through the marketplace", async () => {
    const dir = makeTempDir();
    const file = join(dir, "weather.json");
    writeFileSync(file, skillJson({ name: "weather-alerts" }));
    const marketplace = fakeMarketplace({ "weather-alerts": file });

    const resolved = await resolveSkillSource("weather-alerts", { marketplace });

    expect(resolved.errors).toEqual([]);
    expect(resolved.skills.map((skill) => skill.name)).toEqual(["weather-alerts"]);
  });

  it("falls back to a plain file error without a marketplace", async () => {
    const resolved = await resolveSkillSource("nope-skill");
    expect(resolved.skills).toEqual([]);
    expect(resolved.errors).toEqual(["File not found: nope-skill"]);
  });
});

describe("renderSkillInstallResult", () => {
  it("renders a successful install with activation hint", () => {
    const text = renderSkillInstallResult({
      installed: ["deploy-checklist"],
      skipped: [],
      errors: [],
    });
    expect(text).toContain("Installed skill: deploy-checklist");
    expect(text).toContain("/skill show");
  });

  it("renders skips and warnings without claiming failure", () => {
    const text = renderSkillInstallResult({
      installed: [],
      skipped: [{ name: "dup", reason: "already exists (use --force to overwrite)" }],
      errors: ["other.json: not valid JSON"],
    });
    expect(text).toContain("Skipped dup: already exists");
    expect(text).toContain("Warning: other.json");
    expect(text).not.toContain("Install failed");
  });

  it("renders a hard failure when nothing installed or skipped", () => {
    const text = renderSkillInstallResult({ installed: [], skipped: [], errors: ["File not found: x"] });
    expect(text).toContain("Install failed: File not found: x");
  });
});
