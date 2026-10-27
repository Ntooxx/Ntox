/**
 * Security proof matrix for memory-file access (default-deny model).
 *
 * Acceptance: a verified skill, a malicious prompt, or an experiment flag must all fail
 * to bypass a denied memory-file access — and path checks must survive symlinks,
 * traversal, and Windows normalization.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, WorkspaceProfile } from "../types/index.js";
import { createPolicyRuntime, enforceToolPolicy } from "./policy.js";
import { setInteractiveApproval } from "../tools/approval.js";
import { MEMORY_DIR, EPISODES_JSONL_PATH, NTOX_DIR } from "./config.js";
import { MemoryStore } from "../memory/episodic.js";

function profile(root: string): WorkspaceProfile {
  return {
    id: "test",
    name: "Test Workspace",
    workspaceRoot: root,
    readRoots: [root],
    writeRoots: [root],
    allowedTools: ["read", "write", "grep", "ls", "shell", "image"],
    shellPolicy: "workspace",
    networkPolicy: "fetch-only",
    autoCheckpoint: false,
  };
}

function tempRoot(): string {
  const root = join(tmpdir(), `ntox-policy-sec-${randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function tool(name: string): Tool {
  return {
    name,
    description: "",
    parameters: {},
    execute: async () => ({ success: true }),
  };
}

const ENV_KEYS = ["NTOX_ISOLATE_MEMORY", "NTOX_MEMORY_ACCESS", "NTOX_MEMORY_SCORING"];

afterEach(() => {
  setInteractiveApproval(null);
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("memory access — private by default", () => {
  it("denies raw episodic reads with no configuration present", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(result.success).toBe(false);
    expect(runtime.decisions.at(-1)?.allowed).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("denies writes to memory.md under the default summaries scope (read-only allowlist)", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("write"), runtime).execute({
      path: join(MEMORY_DIR, "memory.md"),
      content: "x",
    });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("allows reading memory.md under the default summaries scope (validated-config allowlist)", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: join(MEMORY_DIR, "memory.md") });
    expect(result.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("grants raw episodic access only under explicit memoryAccess: full", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), memoryAccess: "full" });
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(result.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("memoryAccess: deny blocks even memory.md", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), memoryAccess: "deny" });
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: join(MEMORY_DIR, "memory.md") });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — malicious prompt cannot bypass the boundary", () => {
  it("denies read / grep / ls against raw memory paths", async () => {
    const root = tempRoot();
    for (const attempt of [
      { name: "read", args: { path: EPISODES_JSONL_PATH } },
      { name: "read", args: { path: join(MEMORY_DIR, "durable.json") } },
      { name: "grep", args: { path: MEMORY_DIR, pattern: "password" } },
      { name: "ls", args: { path: MEMORY_DIR } },
    ]) {
      const runtime = createPolicyRuntime(profile(root));
      const result = await enforceToolPolicy(tool(attempt.name), runtime).execute(attempt.args);
      expect(result.success, `${attempt.name} ${JSON.stringify(attempt.args)}`).toBe(false);
      expect(runtime.decisions.at(-1)?.allowed).toBe(false);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("denies a shell working directory inside the memory directory", async () => {
    const root = tempRoot();
    mkdirSync(MEMORY_DIR, { recursive: true });
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("shell"), runtime).execute({
      command: "dir",
      workdir: MEMORY_DIR,
    });
    expect(result.success).toBe(false);
    expect(runtime.decisions.at(-1)?.allowed).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("denies an image path pointing at a memory file", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), allowedTools: [...profile(root).allowedTools] });
    const args = { image: join(MEMORY_DIR, "shot.png") };
    const result = await enforceToolPolicy(tool("image"), runtime).execute(args);
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — verified skill cannot grant authority", () => {
  it("ignores skill/verification metadata attached to the runtime profile", async () => {
    const root = tempRoot();
    const claimed = {
      ...profile(root),
      skill: { name: "super-skill", verified: true, grants: ["read"], authority: "full" },
      verification: { status: "verified", evidence: "agent-said-done" },
    } as WorkspaceProfile & Record<string, unknown>;
    const runtime = createPolicyRuntime(claimed);
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(result.success).toBe(false);
    expect(runtime.decisions.at(-1)?.allowed).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — experiment flags cannot grant authority", () => {
  it("no environment variable grants memory access (env is not consulted)", async () => {
    const root = tempRoot();
    process.env.NTOX_ISOLATE_MEMORY = "0";
    process.env.NTOX_MEMORY_ACCESS = "full";
    process.env.NTOX_MEMORY_SCORING = "off";
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("strictening flags cannot bypass config either (deny stays deny)", async () => {
    const root = tempRoot();
    process.env.NTOX_ISOLATE_MEMORY = "1";
    const runtime = createPolicyRuntime({ ...profile(root), memoryAccess: "deny" });
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: join(MEMORY_DIR, "memory.md") });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — retrieval is not filesystem authority", () => {
  it("supplies memory content to the model while file access stays denied", async () => {
    const root = tempRoot();
    const store = new MemoryStore();
    store.addEpisode("sec-test", "the vault code is delta-9", "Vault code: delta-9", [1, 0, 0], "local-hash");

    const context = store.buildMemoryContext([1, 0, 0], 5, "local-hash", "what is the vault code");
    expect(context).toContain("vault code");

    const runtime = createPolicyRuntime(profile(root));
    const fileResult = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(fileResult.success).toBe(false);
    store.clearAll();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — path robustness", () => {
  it("collapses traversal: relative paths reaching raw memory stay governed by the rule", async () => {
    const root = tempRoot();
    const traversing = `${root}\\${relative(root, EPISODES_JSONL_PATH)}`;
    expect(traversing).toContain("..");
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: traversing });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  const itWin = process.platform === "win32" ? it : it.skip;

  itWin("resolves junctions: a link inside the workspace cannot expose raw memory", async () => {
    const root = tempRoot();
    mkdirSync(MEMORY_DIR, { recursive: true });
    writeFileSync(EPISODES_JSONL_PATH, "");
    const link = join(root, "memlink");
    symlinkSync(MEMORY_DIR, link, "junction");
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({
      path: join(link, "episodes.jsonl"),
    });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(link, { force: true });
  });

  itWin("normalizes case, forward slashes, and long-path prefixes", async () => {
    const root = tempRoot();
    const weird = EPISODES_JSONL_PATH.replace(/\\/g, "/").toUpperCase().replace(/^/, "\\\\?\\");
    const runtime = createPolicyRuntime({ ...profile(root), memoryAccess: "full" });
    const allowed = await enforceToolPolicy(tool("read"), runtime).execute({ path: weird });
    expect(allowed.success).toBe(true);
    const defaultRuntime = createPolicyRuntime(profile(root));
    const denied = await enforceToolPolicy(tool("read"), defaultRuntime).execute({ path: weird });
    expect(denied.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  itWin("denies writes through a junction escaping the workspace", async () => {
    const root = tempRoot();
    const outside = join(tmpdir(), `ntox-sec-out-${randomUUID().slice(0, 8)}`);
    mkdirSync(outside, { recursive: true });
    const link = join(root, "escape");
    symlinkSync(outside, link, "junction");
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("write"), runtime).execute({
      path: join(link, "stolen.txt"),
      content: "x",
    });
    expect(result.success).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(link, { force: true });
  });
});

describe("memory access — fail-closed canonicalization", () => {
  it("denies paths whose ancestry cannot be resolved (file used as directory), even with full access", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "blocker.txt"), "i am a file");
    const bogus = join(root, "blocker.txt", "sub", "x.json");
    for (const memProfile of [profile(root), { ...profile(root), memoryAccess: "full" as const }]) {
      const runtime = createPolicyRuntime(memProfile);
      const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: bogus });
      expect(result.success).toBe(false);
      expect(runtime.decisions.at(-1)?.allowed).toBe(false);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("still allows brand-new nested files in the workspace (ENOENT ancestry is resolvable)", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const result = await enforceToolPolicy(tool("write"), runtime).execute({
      path: join(root, "new", "deep", "file.txt"),
      content: "x",
    });
    expect(result.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("memory access — denial overrides workspace roots (MEMORY_DIR inside roots)", () => {
  // The overlap case from review: workspace/read/write roots CONTAIN the memory directory.
  function overlapped(extra: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
    return { ...profile(NTOX_DIR), memoryAccess: "deny", ...extra };
  }

  it("memoryAccess: deny blocks raw reads and writes even when roots authorize the path", async () => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const readRuntime = createPolicyRuntime(overlapped());
    const readResult = await enforceToolPolicy(tool("read"), readRuntime).execute({ path: EPISODES_JSONL_PATH });
    expect(readResult.success).toBe(false);
    expect(readRuntime.decisions.at(-1)?.allowed).toBe(false);

    const writeRuntime = createPolicyRuntime(overlapped());
    const writeResult = await enforceToolPolicy(tool("write"), writeRuntime).execute({
      path: EPISODES_JSONL_PATH,
      content: "[]",
    });
    expect(writeResult.success).toBe(false);
    rmSync(NTOX_DIR, { recursive: true, force: true });
  });

  it("denies shell cwd, image, and checkpoint access to memory even inside the workspace", async () => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const shellRuntime = createPolicyRuntime(overlapped());
    const shellResult = await enforceToolPolicy(tool("shell"), shellRuntime).execute({
      command: "dir",
      workdir: MEMORY_DIR,
    });
    expect(shellResult.success).toBe(false);

    const imageRuntime = createPolicyRuntime(overlapped());
    const imageResult = await enforceToolPolicy(tool("image"), imageRuntime).execute({
      image: join(MEMORY_DIR, "shot.png"),
    });
    expect(imageResult.success).toBe(false);

    const cpRuntime = createPolicyRuntime({
      ...overlapped({ allowedTools: [...profile(NTOX_DIR).allowedTools, "checkpoint"] }),
    });
    const cpResult = await enforceToolPolicy(tool("checkpoint"), cpRuntime).execute({
      action: "create",
      path: EPISODES_JSONL_PATH,
    });
    expect(cpResult.success).toBe(false);
    rmSync(NTOX_DIR, { recursive: true, force: true });
  });

  it("summaries scope: memory.md stays readable but unwritable inside workspace roots", async () => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const readRuntime = createPolicyRuntime(overlapped({ memoryAccess: "summaries" }));
    const readResult = await enforceToolPolicy(tool("read"), readRuntime).execute({
      path: join(MEMORY_DIR, "memory.md"),
    });
    expect(readResult.success).toBe(true);

    const writeRuntime = createPolicyRuntime(overlapped({ memoryAccess: "summaries" }));
    const writeResult = await enforceToolPolicy(tool("write"), writeRuntime).execute({
      path: join(MEMORY_DIR, "memory.md"),
      content: "x",
    });
    expect(writeResult.success).toBe(false);

    const rawRuntime = createPolicyRuntime(overlapped({ memoryAccess: "summaries" }));
    const rawResult = await enforceToolPolicy(tool("read"), rawRuntime).execute({ path: EPISODES_JSONL_PATH });
    expect(rawResult.success).toBe(false);
    rmSync(NTOX_DIR, { recursive: true, force: true });
  });

  it("memoryAccess: full authorizes raw memory inside workspace roots (positive control)", async () => {
    mkdirSync(MEMORY_DIR, { recursive: true });
    const runtime = createPolicyRuntime(overlapped({ memoryAccess: "full" }));
    const result = await enforceToolPolicy(tool("read"), runtime).execute({ path: EPISODES_JSONL_PATH });
    expect(result.success).toBe(true);
    rmSync(NTOX_DIR, { recursive: true, force: true });
  });
});
