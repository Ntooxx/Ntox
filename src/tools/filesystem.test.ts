import { describe, it, expect } from "vitest";
import { readTool, writeTool, globTool, lsTool, editTool } from "./filesystem.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const tmpBase = join(tmpdir(), `ntox-fs-test-${randomUUID().slice(0, 8)}`);

process.on("exit", () => {
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* cleanup on exit */ }
});

function setup() {
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* setup ok */ }
  mkdirSync(tmpBase, { recursive: true });
}

describe("readTool", () => {
  it("reads a file", async () => {
    setup();
    const path = join(tmpBase, "test.txt");
    writeFileSync(path, "hello world");
    const r = await readTool.execute({ path });
    expect(r.success).toBe(true);
    expect(r.data).toBe("hello world");
  });

  it("blocks sensitive paths", async () => {
    const r = await readTool.execute({ path: "/root/.ssh/id_rsa" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Access denied");
  });

  it("blocks .env files", async () => {
    const r = await readTool.execute({ path: "/project/.env" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Access denied");
  });

  it("blocks .git/config", async () => {
    const r = await readTool.execute({ path: "/project/.git/config" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Access denied");
  });

  it("fails for missing file", async () => {
    const r = await readTool.execute({ path: join(tmpBase, "nonexistent.txt") });
    expect(r.success).toBe(false);
  });
});

describe("writeTool", () => {
  it("writes a file", async () => {
    setup();
    const path = join(tmpBase, "output.txt");
    const r = await writeTool.execute({ path, content: "data" });
    expect(r.success).toBe(true);
      expect(r.data).toContain("4 bytes");
  });

  it("blocks sensitive paths", async () => {
    const r = await writeTool.execute({ path: "/root/.ssh/authorized_keys", content: "evil" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Access denied");
  });
});

describe("editTool", () => {
  it("replaces text in a file", async () => {
    setup();
    const path = join(tmpBase, "edit.txt");
    writeFileSync(path, "hello world");
    const r = await editTool.execute({ filePath: path, oldString: "hello", newString: "hi" });
    expect(r.success).toBe(true);
  });

  it("blocks sensitive paths", async () => {
    const r = await editTool.execute({
      filePath: "/project/.git/config",
      oldString: "x",
      newString: "y",
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain("Access denied");
  });
});

describe("globTool", () => {
  it("finds files by pattern", async () => {
    setup();
    writeFileSync(join(tmpBase, "a.ts"), "");
    writeFileSync(join(tmpBase, "b.js"), "");
    const r = await globTool.execute({ pattern: "*.ts", path: tmpBase });
    expect(r.success).toBe(true);
    expect((r.data as string[]).length).toBe(1);
  });
});

describe("lsTool", () => {
  it("lists directory contents", async () => {
    setup();
    writeFileSync(join(tmpBase, "file.txt"), "");
    const r = await lsTool.execute({ path: tmpBase });
    expect(r.success).toBe(true);
    const items = r.data as { name: string; type: string }[];
    expect(items.some((i) => i.name === "file.txt")).toBe(true);
  });
});
