import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSkillStats,
  diffSkillByName,
  diffSkills,
  isSkillAutoDisabled,
  renderSkillDiff,
  renderSkillStats,
  SKILL_AUTO_DISABLE_MS,
} from "./lifecycle.js";
import type { SkillMarketplace, MarketplaceLookup } from "./marketplace.js";
import type { SkillDefinition } from "../types/index.js";

const NOW = 1_700_000_000_000;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ntox-lifecycle-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "deploy-checklist",
    description: "Run the deploy checklist",
    category: "coding",
    prompt: "1. check CI\n2. tag release",
    triggers: ["run deploy checklist", "deploy steps"],
    tools: ["shell"],
    examples: [],
    created: NOW - 1000,
    updated: NOW - 1000,
    usageCount: 0,
    version: 1,
    ...overrides,
  };
}

function fakeMarketplace(lookup: MarketplaceLookup): SkillMarketplace {
  return {
    lookup: async () => lookup,
    list: async () => ({ ok: true, entries: [] }),
  };
}

describe("isSkillAutoDisabled", () => {
  it("keeps fresh and recently updated skills enabled", () => {
    expect(isSkillAutoDisabled(makeSkill(), NOW)).toBe(false);
    expect(isSkillAutoDisabled(makeSkill({ created: NOW - SKILL_AUTO_DISABLE_MS * 2 }), NOW)).toBe(false);
    expect(isSkillAutoDisabled(makeSkill({ created: NOW - SKILL_AUTO_DISABLE_MS * 2, updated: NOW - 1000 }), NOW)).toBe(
      false,
    );
  });

  it("disables skills that were never used and untouched for 30+ days", () => {
    const old = makeSkill({ created: NOW - SKILL_AUTO_DISABLE_MS - 1, updated: NOW - SKILL_AUTO_DISABLE_MS - 1 });
    expect(isSkillAutoDisabled(old, NOW)).toBe(true);
  });

  it("never disables a skill that has been used", () => {
    const used = makeSkill({
      created: NOW - SKILL_AUTO_DISABLE_MS * 3,
      updated: NOW - SKILL_AUTO_DISABLE_MS * 3,
      usageCount: 1,
    });
    expect(isSkillAutoDisabled(used, NOW)).toBe(false);
  });
});

describe("collectSkillStats / renderSkillStats", () => {
  it("reports status and sorts by usage", () => {
    const skills = [
      makeSkill({ name: "fresh-skill" }),
      makeSkill({
        name: "used-skill",
        usageCount: 7,
        lastUsedAt: NOW - 86_400_000,
        created: NOW - SKILL_AUTO_DISABLE_MS * 2,
        updated: NOW - SKILL_AUTO_DISABLE_MS * 2,
      }),
      makeSkill({
        name: "dead-skill",
        created: NOW - SKILL_AUTO_DISABLE_MS * 2,
        updated: NOW - SKILL_AUTO_DISABLE_MS * 2,
      }),
    ];
    const stats = collectSkillStats(skills, NOW);
    expect(stats.map((stat) => stat.name)).toEqual(["used-skill", "dead-skill", "fresh-skill"]);
    expect(stats.map((stat) => stat.status)).toEqual(["active", "auto-disabled", "never-used"]);
    expect(stats[0].lastUsedAt).toBe(NOW - 86_400_000);
  });

  it("renders usage rows and the auto-disable explanation", () => {
    const text = renderSkillStats(
      [
        makeSkill({ name: "used-skill", usageCount: 7, lastUsedAt: NOW - 2 * 86_400_000 }),
        makeSkill({
          name: "dead-skill",
          created: NOW - SKILL_AUTO_DISABLE_MS * 2,
          updated: NOW - SKILL_AUTO_DISABLE_MS * 2,
        }),
      ],
      NOW,
    );
    expect(text).toContain("Skills (2):");
    expect(text).toContain("used-skill");
    expect(text).toContain("used   7x");
    expect(text).toContain("last used 2d ago");
    expect(text).toContain("dead-skill");
    expect(text).toContain("auto-disabled");
    expect(text).toContain("--force");
  });

  it("handles an empty registry", () => {
    expect(renderSkillStats([], NOW)).toBe("No skills installed.");
  });
});

describe("diffSkills / renderSkillDiff", () => {
  it("reports no changes for identical content", () => {
    expect(diffSkills(makeSkill(), makeSkill())).toEqual([]);
    expect(renderSkillDiff(makeSkill(), makeSkill())).toContain("matches the source");
  });

  it("reports scalar and array changes", () => {
    const incoming = makeSkill({
      description: "Run the full deploy checklist",
      prompt: "1. check CI\n2. tag release\n3. announce",
      triggers: ["run deploy checklist", "release steps"],
      tools: ["shell", "web_read"],
      version: 3,
    });
    const changes = diffSkills(makeSkill(), incoming);
    const byField = new Map(changes.map((change) => [`${change.field}:${change.detail}`, true]));
    expect(byField.get("description:Run the deploy checklist -> Run the full deploy checklist")).toBe(true);
    expect(changes.some((change) => change.field === "prompt" && change.detail.includes("chars"))).toBe(true);
    expect(changes.some((change) => change.field === "triggers" && change.detail === "+ release steps")).toBe(true);
    expect(changes.some((change) => change.field === "triggers" && change.detail === "- deploy steps")).toBe(true);
    expect(changes.some((change) => change.field === "tools" && change.detail === "+ web_read")).toBe(true);

    const rendered = renderSkillDiff(makeSkill(), incoming);
    expect(rendered).toContain("Diff for deploy-checklist (local v1 vs source):");
    expect(rendered).toContain("/skill install <source> --force");
  });

  it("reports a rename as a name change", () => {
    const changes = diffSkills(makeSkill(), makeSkill({ name: "other-name" }));
    expect(changes[0]).toEqual({ field: "name", detail: "deploy-checklist -> other-name" });
  });

  it("reports routine step changes", () => {
    const withSteps = makeSkill({
      steps: [
        { kind: "tool", tool: "web_read", args: { url: "https://x" } },
        { kind: "llm", prompt: "summarize" },
      ],
    });
    const changes = diffSkills(makeSkill(), withSteps);
    expect(changes.some((change) => change.field === "steps" && change.detail === "changed (0 -> 2 steps)")).toBe(true);
    expect(diffSkills(withSteps, withSteps)).toEqual([]);
  });
});

describe("diffSkillByName", () => {
  const registry = { get: (name: string) => (name === "deploy-checklist" ? makeSkill() : undefined) };

  it("reports when the skill is not installed", async () => {
    const message = await diffSkillByName(registry, fakeMarketplace({ status: "not-found" }), "missing-skill");
    expect(message).toContain('Skill "missing-skill" is not installed.');
  });

  it("uses the marketplace entry when no source is given", async () => {
    const dir = makeTempDir();
    const file = join(dir, "deploy-checklist.json");
    writeFileSync(file, JSON.stringify(makeSkill()));
    const marketplace = fakeMarketplace({
      status: "found",
      entry: { name: "deploy-checklist", source: file, description: "" },
    });
    const message = await diffSkillByName(registry, marketplace, "deploy-checklist");
    expect(message).toContain("matches the source");
  });

  it("asks for a source when the marketplace has no entry", async () => {
    const message = await diffSkillByName(registry, fakeMarketplace({ status: "not-found" }), "deploy-checklist");
    expect(message).toContain("No marketplace entry");
    expect(message).toContain("/skill diff deploy-checklist <url|git|file>");
  });

  it("diffs against an explicit local file source", async () => {
    const message = await diffSkillByName(
      registry,
      fakeMarketplace({ status: "disabled" }),
      "deploy-checklist",
      "./missing-pack.json",
    );
    expect(message).toContain("No skills found in ./missing-pack.json");
    expect(message).toContain("File not found");
  });

  it("surfaces marketplace unavailability", async () => {
    const message = await diffSkillByName(
      registry,
      fakeMarketplace({ status: "unavailable", error: "HTTP 500" }),
      "deploy-checklist",
    );
    expect(message).toContain("No marketplace entry");
  });
});
