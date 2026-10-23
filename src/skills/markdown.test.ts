import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractMdSection, parseSkillMarkdown } from "./markdown.js";
import { SkillLibrary } from "./library.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ntox-markdown-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const EXPORT_FORMAT = `# migrate-tests

## Triggers

- "migrate tests"
- "port the test suite"

## Purpose

Move a test suite between frameworks without losing coverage.

## Category

coding

## Tools

shell, read

## Examples

migrate the jest tests to vitest

## Prompt

1. Inventory the existing tests.
2. Map assertion APIs.
3. Port in batches and run after each batch.
`;

const BUNDLED_FORMAT = `# Programming — Algorithmic Thinking

## Purpose

The art of solving problems with clear, step-by-step procedures.

## Core Principle

> An algorithm is a finite sequence of well-defined instructions.

## Complexity Analysis

Guidance on big-O reasoning.
`;

describe("extractMdSection", () => {
  it("captures a section even without a blank line after the heading", () => {
    expect(extractMdSection(EXPORT_FORMAT, "Triggers")).toContain('- "migrate tests"');
  });

  it("stops at the next h2 and ignores h3 headings", () => {
    const content = ["## Purpose", "", "line one", "", "### Not this", "line two", "## Tools", "shell"].join("\n");
    expect(extractMdSection(content, "Purpose")).toBe("line one\n\n### Not this\nline two");
    expect(extractMdSection(content, "Tools")).toBe("shell");
  });

  it("matches headings case-insensitively and returns empty when absent", () => {
    expect(extractMdSection("## purpose\n\nhello", "Purpose")).toBe("hello");
    expect(extractMdSection("# just a title\n\ntext", "Purpose")).toBe("");
  });
});

describe("parseSkillMarkdown", () => {
  it("parses the export format into exact fields", () => {
    const parsed = parseSkillMarkdown(EXPORT_FORMAT, "migrate-tests.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill.name).toBe("migrate-tests");
      expect(parsed.skill.description).toBe("Move a test suite between frameworks without losing coverage.");
      expect(parsed.skill.category).toBe("coding");
      expect(parsed.skill.triggers).toEqual(["migrate tests", "port the test suite"]);
      expect(parsed.skill.tools).toEqual(["shell", "read"]);
      expect(parsed.skill.examples).toEqual(["migrate the jest tests to vitest"]);
      expect(parsed.skill.prompt).toContain("3. Port in batches");
    }
  });

  it("parses bundled-library files: name from filename, prompt from full content", () => {
    const parsed = parseSkillMarkdown(BUNDLED_FORMAT, "skills/Programming/Core/02_Algorithmic_Thinking.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill.name).toBe("algorithmic-thinking");
      expect(parsed.skill.description).toBe("The art of solving problems with clear, step-by-step procedures.");
      expect(parsed.skill.triggers.length).toBeGreaterThan(0);
      expect(parsed.skill.prompt).toContain("## Complexity Analysis");
      expect(parsed.skill.category).toBe("custom");
    }
  });

  it("falls back to the title when the filename is generic", () => {
    const parsed = parseSkillMarkdown("# My Great Skill\n\n## Purpose\n\nDoes great things reliably.\n", "index.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.skill.name).toBe("my-great-skill");
  });

  it("derives the name from a URL label", () => {
    const parsed = parseSkillMarkdown(
      "# Weather\n\n## Purpose\n\nForecast helper.\n",
      "https://example.com/skills/weather-alerts.md?raw=1",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.skill.name).toBe("weather-alerts");
  });

  it("rejects empty and nameless content", () => {
    expect(parseSkillMarkdown("   ")).toEqual({ ok: false, error: "empty markdown file" });
    expect(parseSkillMarkdown("no title at all")).toEqual({ ok: false, error: "could not derive a skill name" });
  });

  it("parses Voices and Recommended Combinations when present", () => {
    const content = `# x-skill\n\n## Purpose\n\nA thing.\n\n## Voices\nformal, casual\n\n## Recommended Combinations\n- morning brief\n\n## Prompt\n\nDo the thing step by step carefully.\n`;
    const parsed = parseSkillMarkdown(content, "x-skill.md");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill.voices).toEqual(["formal", "casual"]);
      expect(parsed.skill.combos).toEqual(["morning brief"]);
    }
  });
});

describe("exportAsMarkdown roundtrip", () => {
  it("survives markdown -> library index -> export -> markdown with fields intact", () => {
    const root = makeTempDir();
    const domain = join(root, "Domain");
    mkdirSync(domain, { recursive: true });
    writeFileSync(join(domain, "my_skill.md"), EXPORT_FORMAT);

    const library = new SkillLibrary(root);
    library.scan();
    const exported = library.exportAsMarkdown("my skill");
    expect(exported).toBeTruthy();

    const reparsed = parseSkillMarkdown(exported!, "my-skill.md");
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.skill.triggers).toEqual(["migrate tests", "port the test suite"]);
      expect(reparsed.skill.description).toBe("Move a test suite between frameworks without losing coverage.");
      expect(reparsed.skill.category).toBe("coding");
      expect(reparsed.skill.tools).toEqual(["shell", "read"]);
      expect(reparsed.skill.prompt).toContain("3. Port in batches");
    }
  });
});
