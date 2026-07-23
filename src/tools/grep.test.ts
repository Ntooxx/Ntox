import { describe, it, expect } from "vitest";
import { grepTool } from "./grep.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const tmpBase = join(tmpdir(), `ntox-grep-test-${randomUUID().slice(0, 8)}`);

process.on("exit", () => {
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* cleanup on exit */ }
});

function setup() {
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* setup ok */ }
  mkdirSync(tmpBase, { recursive: true });
  writeFileSync(join(tmpBase, "a.ts"), "function hello() {\n  return 42;\n}");
  writeFileSync(join(tmpBase, "b.ts"), "const world = 99;\n");
  writeFileSync(join(tmpBase, "c.txt"), "some text here\nhello world\nmore text");
}

describe("grepTool", () => {
  it("finds matching lines", async () => {
    setup();
    const r = await grepTool.execute({ pattern: "hello", path: tmpBase });
    expect(r.success).toBe(true);
    const results = r.data as { file: string; line: number }[];
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by include pattern", async () => {
    setup();
    const r = await grepTool.execute({ pattern: "const", include: "*.ts", path: tmpBase });
    expect(r.success).toBe(true);
    const results = r.data as { file: string }[];
    expect(results.every((f) => f.file.endsWith(".ts"))).toBe(true);
  });

  it("rejects ReDoS patterns", async () => {
    setup();
    const r = await grepTool.execute({ pattern: "(a+)+b", path: tmpBase });
    expect(r.success).toBe(false);
    expect(r.error).toContain("ReDoS");
  });

  it("rejects excessively long patterns", async () => {
    const long = "x".repeat(201);
    const r = await grepTool.execute({ pattern: long, path: tmpBase });
    expect(r.success).toBe(false);
    expect(r.error).toContain("max length");
  });

  it("rejects whitespace-only patterns", async () => {
    const r = await grepTool.execute({ pattern: "   ", path: tmpBase });
    expect(r.success).toBe(false);
    expect(r.error).toContain("whitespace");
  });

  it("handles invalid regex gracefully", async () => {
    const r = await grepTool.execute({ pattern: "[unclosed", path: tmpBase });
    expect(r.success).toBe(false);
  });
});
