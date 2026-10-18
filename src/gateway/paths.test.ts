import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suggestWorkspacePaths } from "./paths.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ntox-paths-"));
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("suggestWorkspacePaths", () => {
  it("lists top-level entries when prefix is empty", () => {
    writeFileSync(join(root, "README.md"), "# hi");
    mkdirSync(join(root, "src"));
    const results = suggestWorkspacePaths("", [root]);
    expect(results).toContain("README.md");
    expect(results.some((r) => r.startsWith("src"))).toBe(true);
  });

  it("matches partial file names", () => {
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "notes.txt"), "x");
    const results = suggestWorkspacePaths("pack", [root]);
    expect(results).toContain("package.json");
    expect(results).not.toContain("notes.txt");
  });

  it("ignores node_modules and .git", () => {
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), "x");
    const results = suggestWorkspacePaths("", [root]);
    expect(results.join(" ")).not.toContain("node_modules");
    expect(results.join(" ")).not.toContain(".git");
  });

  it("returns empty for missing roots", () => {
    expect(suggestWorkspacePaths("x", [join(root, "nope-does-not-exist")])).toEqual([]);
  });

  it("caps results at 12", () => {
    for (let i = 0; i < 30; i++) writeFileSync(join(root, `file-${i}.txt`), "x");
    const results = suggestWorkspacePaths("file", [root]);
    expect(results.length).toBeLessThanOrEqual(12);
  });
});
