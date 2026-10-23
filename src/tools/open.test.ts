import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";
import { openTool, buildOpenCommand, validateOpenTarget } from "./open.js";
import { createPolicyRuntime, enforceToolPolicy } from "../core/policy.js";

describe("openTool validation", () => {
  it("fails on missing path", async () => {
    const r = await openTool.execute({});
    expect(r.success).toBe(false);
    expect(r.error).toContain("Missing required argument");
  });

  it("fails on blank path", async () => {
    const r = await openTool.execute({ path: "   " });
    expect(r.success).toBe(false);
  });

  it("fails on nonexistent path", async () => {
    const r = await openTool.execute({ path: join(tmpdir(), "ntox-open-definitely-missing.txt") });
    expect(r.success).toBe(false);
    expect(r.error).toContain("does not exist");
  });

  it("fails on non-http scheme such as javascript urls", async () => {
    const r = await openTool.execute({ path: "javascript:alert(1)" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("non-http");
  });

  it("fails on executable extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-open-"));
    const exe = join(dir, "evil.exe");
    writeFileSync(exe, "stub");
    const r = await openTool.execute({ path: exe });
    expect(r.success).toBe(false);
    expect(r.error).toContain("executable");
  });
});

describe("validateOpenTarget", () => {
  it("accepts http and https urls", () => {
    expect(validateOpenTarget("https://example.com/a.html")).toBeNull();
    expect(validateOpenTarget("http://localhost:3000")).toBeNull();
  });

  it("accepts existing files and directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-open-ok-"));
    const file = join(dir, "page.html");
    writeFileSync(file, "<html></html>");
    expect(validateOpenTarget(file)).toBeNull();
    expect(validateOpenTarget(dir)).toBeNull();
  });

  it("accepts workspace file regardless of nested dot dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "ntox-open-env-"));
    const file = join(dir, "index.html");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(file, "<html></html>");
    expect(validateOpenTarget(file)).toBeNull();
  });

  it("rejects data urls", () => {
    expect(validateOpenTarget("data:text/html,<b>x</b>")).toContain("non-http");
  });

  it("does not treat a drive letter as a url scheme", () => {
    const err = validateOpenTarget("C:\\no-such-dir-ntox\\file.txt");
    expect(err).not.toContain("non-http");
    expect(err).toContain("does not exist");
  });
});

describe("buildOpenCommand", () => {
  it("produces a platform launch command", () => {
    const c = buildOpenCommand("https://example.com");
    expect(c.cmd).toBeTruthy();
    expect(c.args.join(" ")).toContain("example.com");
    if (platform() === "win32") expect(c.cmd).toBe("powershell.exe");
    if (platform() === "linux") expect(c.cmd).toBe("xdg-open");
    if (platform() === "darwin") expect(c.cmd).toBe("open");
  });

  it("escapes single quotes for powershell targets", () => {
    const c = buildOpenCommand("C:\\o'file.html");
    const joined = c.args.join(" ");
    if (platform() === "win32") expect(joined).toContain("''");
    expect(joined).toContain("file.html");
  });
});

describe("open policy integration", () => {
  it("denies paths outside read roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntox-open-root-"));
    const runtime = createPolicyRuntime({
      id: "t",
      name: "t",
      workspaceRoot: root,
      readRoots: [root],
      writeRoots: [root],
      allowedTools: [],
      shellPolicy: "approval-required",
      networkPolicy: "browser-allowed",
      autoCheckpoint: false,
    });
    const wrapped = enforceToolPolicy(openTool, runtime);
    const outside = platform() === "win32" ? "C:\\Windows\\explorer.exe" : "/etc/hosts";
    const r = await wrapped.execute({ path: outside });
    expect(r.success).toBe(false);
    expect(r.error).toContain("POLICY_DENIED");
  });

  it("allows urls inside a network-disabled profile only when network is not disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntox-open-root2-"));
    const base = {
      id: "t",
      name: "t",
      workspaceRoot: root,
      readRoots: [root],
      writeRoots: [root],
      allowedTools: [] as string[],
      shellPolicy: "approval-required" as const,
      autoCheckpoint: false,
    };
    const allowed = enforceToolPolicy(
      { ...openTool, execute: async () => ({ success: true }) },
      createPolicyRuntime({ ...base, networkPolicy: "browser-allowed" }),
    );
    const ok = await allowed.execute({ path: "https://example.com/x.html" });
    expect(ok.success).toBe(true);

    const denied = enforceToolPolicy(
      { ...openTool, execute: async () => ({ success: true }) },
      createPolicyRuntime({ ...base, networkPolicy: "disabled" }),
    );
    const no = await denied.execute({ path: "https://example.com/x.html" });
    expect(no.success).toBe(false);
    expect(no.error).toContain("POLICY_DENIED");
  });

  it("allows workspace files", async () => {
    const root = mkdtempSync(join(tmpdir(), "ntox-open-root3-"));
    const file = join(root, "index.html");
    writeFileSync(file, "<html></html>");
    const runtime = createPolicyRuntime({
      id: "t",
      name: "t",
      workspaceRoot: resolve(root),
      readRoots: [resolve(root)],
      writeRoots: [resolve(root)],
      allowedTools: [],
      shellPolicy: "approval-required",
      networkPolicy: "browser-allowed",
      autoCheckpoint: false,
    });
    const wrapped = enforceToolPolicy({ ...openTool, execute: async () => ({ success: true, data: "ok" }) }, runtime);
    const r = await wrapped.execute({ path: file });
    expect(r.success).toBe(true);
  });
});
