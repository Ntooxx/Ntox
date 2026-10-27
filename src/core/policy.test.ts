import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, WorkspaceProfile } from "../types/index.js";
import { applyPolicyGrant, createPolicyRuntime, enforceToolPolicy, scopeDefaultProfile } from "./policy.js";
import { setInteractiveApproval } from "../tools/approval.js";
import { CONFIG_PATH, MEMORY_DIR } from "./config.js";
import { MEDIA_DIR } from "./media.js";

function profile(root: string): WorkspaceProfile {
  return {
    id: "test",
    name: "Test Workspace",
    workspaceRoot: root,
    readRoots: [root],
    writeRoots: [root],
    allowedTools: ["read", "write", "shell", "process", "web_fetch", "web_read", "browse"],
    shellPolicy: "approval-required",
    networkPolicy: "fetch-only",
    autoCheckpoint: true,
  };
}

function tempRoot(): string {
  const root = join(tmpdir(), `ntox-policy-${randomUUID().slice(0, 8)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function outsideFile(suffix: string): string {
  return join(tmpdir(), `ntox-outside-${randomUUID().slice(0, 8)}${suffix}`);
}

afterEach(() => setInteractiveApproval(null));

describe("policy", () => {
  it("allows read inside workspace", async () => {
    const root = tempRoot();
    const file = join(root, "a.txt");
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "read",
      description: "",
      parameters: {},
      execute: async () => ({ success: true, data: "ok" }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: file });
    expect(result.success).toBe(true);
    expect(runtime.decisions.at(-1)?.allowed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("denies write outside workspace", async () => {
    const root = tempRoot();
    const outside = join(tmpdir(), `ntox-outside-${randomUUID().slice(0, 8)}.txt`);
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "write",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: outside, content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("POLICY_DENIED");
    rmSync(root, { recursive: true, force: true });
  });

  it("denies write when path is missing", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "write",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required path argument: path");
    rmSync(root, { recursive: true, force: true });
  });

  it("denies shell workdir outside workspace", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "shell",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ command: "npm test", workdir: tmpdir() });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside workspace");
    rmSync(root, { recursive: true, force: true });
  });

  it("denies process workdir outside workspace", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "process",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({
      action: "start",
      command: "npm run dev",
      workdir: tmpdir(),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside workspace");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows write tool calls inside the memory directory even when roots exclude it", async () => {
    const root = tempRoot();
    const memoryFile = join(MEMORY_DIR, `agent-write-${randomUUID().slice(0, 8)}.json`);
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "write",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: memoryFile, content: "{}" });
    expect(result.success).toBe(true);
    expect(runtime.decisions.at(-1)?.allowed).toBe(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(memoryFile, { force: true });
  });

  it("allows read tool calls inside the memory directory even when roots exclude it", async () => {
    const root = tempRoot();
    const memoryFile = join(MEMORY_DIR, `agent-read-${randomUUID().slice(0, 8)}.json`);
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "read",
      description: "",
      parameters: {},
      execute: async () => ({ success: true, data: "ok" }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: memoryFile });
    expect(result.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(memoryFile, { force: true });
  });

  it("allows reading memory.md through the checkpoint path gate", async () => {
    const root = tempRoot();
    const memoryFile = join(MEMORY_DIR, "memory.md");
    const runtime = createPolicyRuntime({ ...profile(root), autoCheckpoint: true });
    const tool: Tool = {
      name: "read",
      description: "",
      parameters: {},
      execute: async () => ({ success: true, data: "ok" }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: memoryFile });
    expect(result.success).toBe(true);
    expect(result.error ?? "").not.toContain("Checkpoint");
    rmSync(root, { recursive: true, force: true });
  });

  it("still denies write outside workspace and outside the memory directory", async () => {
    const root = tempRoot();
    const outside = join(tmpdir(), `ntox-outside-${randomUUID().slice(0, 8)}.txt`);
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "write",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: outside, content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("POLICY_DENIED");
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks browser when network policy is fetch-only", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "browse",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ url: "https://example.com", action: "snapshot" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Browser disabled");
    rmSync(root, { recursive: true, force: true });
  });

  it("disables web_read browser fallback when network policy is fetch-only", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "web_read",
      description: "",
      parameters: {},
      execute: async (args) => ({ success: true, data: { allowBrowserFallback: args.allowBrowserFallback } }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ url: "https://example.com" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ allowBrowserFallback: false });
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks preferred browser web_read when network policy is fetch-only", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "web_read",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ url: "https://example.com", preferBrowser: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Browser disabled");
    rmSync(root, { recursive: true, force: true });
  });

  it("auto-checkpoints existing files before write", async () => {
    const root = tempRoot();
    const file = join(root, "a.txt");
    writeFileSync(file, "before");
    const runtime = createPolicyRuntime(profile(root));
    const tool: Tool = {
      name: "write",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };
    const result = await enforceToolPolicy(tool, runtime).execute({ path: file, content: "after" });
    expect(result.success).toBe(true);
    expect(runtime.checkpointIds.length).toBeGreaterThanOrEqual(1);
    expect((result.data as { autoCheckpointId?: string }).autoCheckpointId).toBe(runtime.checkpointIds[0]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("image policy", () => {
  function imageProfile(root: string): WorkspaceProfile {
    const base = profile(root);
    return { ...base, allowedTools: [...base.allowedTools, "image"] };
  }

  function imageTool(): Tool {
    return {
      name: "image",
      description: "",
      parameters: {},
      execute: async (args) => ({ success: true, data: { received: String(args.image ?? "") } }),
    };
  }

  it("allows a local image path inside the workspace and resolves it", async () => {
    const root = tempRoot();
    const file = join(root, "shot.png");
    writeFileSync(file, "png-bytes");
    const runtime = createPolicyRuntime(imageProfile(root));
    const args = { image: file };

    const result = await enforceToolPolicy(imageTool(), runtime).execute(args);

    expect(result.success).toBe(true);
    expect(args.image).toBe(file);
    expect(runtime.decisions.at(-1)?.allowed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("denies a local image path outside the workspace", async () => {
    const root = tempRoot();
    const outside = join(tmpdir(), `ntox-image-${randomUUID().slice(0, 8)}.png`);
    writeFileSync(outside, "png-bytes");
    const runtime = createPolicyRuntime(imageProfile(root));

    const result = await enforceToolPolicy(imageTool(), runtime).execute({ image: outside });

    expect(result.success).toBe(false);
    expect(result.error).toContain("POLICY_DENIED");
    expect(result.error).toContain("outside allowed roots");
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("always allows the bundled media directory used for channel attachments", async () => {
    const root = tempRoot();
    mkdirSync(MEDIA_DIR, { recursive: true });
    const mediaFile = join(MEDIA_DIR, `policy-test-${randomUUID().slice(0, 8)}.png`);
    writeFileSync(mediaFile, "png-bytes");
    const runtime = createPolicyRuntime(imageProfile(root));

    const result = await enforceToolPolicy(imageTool(), runtime).execute({ image: mediaFile });

    expect(result.success).toBe(true);
    rmSync(mediaFile, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("allows data URLs and base64 payloads without touching the filesystem", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(imageProfile(root));

    const dataUrl = await enforceToolPolicy(imageTool(), runtime).execute({ image: "data:image/png;base64,AAAA" });
    expect(dataUrl.success).toBe(true);

    const base64 = await enforceToolPolicy(imageTool(), runtime).execute({ image: "iVBORw0KGgoAAAANSUhEUg==" });
    expect(base64.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("gates http image URLs behind the network policy", async () => {
    const root = tempRoot();
    const allowed = createPolicyRuntime(imageProfile(root));
    const ok = await enforceToolPolicy(imageTool(), allowed).execute({ image: "https://example.com/pic.png" });
    expect(ok.success).toBe(true);

    const disabled = createPolicyRuntime({ ...imageProfile(root), networkPolicy: "disabled" });
    const denied = await enforceToolPolicy(imageTool(), disabled).execute({ image: "https://example.com/pic.png" });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("Network disabled");
    rmSync(root, { recursive: true, force: true });
  });

  it("does not block generation mode when no image argument is present", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime(imageProfile(root));

    const result = await enforceToolPolicy(imageTool(), runtime).execute({ mode: "generate", prompt: "a cat" });

    expect(result.success).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("policy approval flow", () => {
  function writeTool(): Tool {
    return {
      name: "write",
      description: "",
      parameters: {},
      execute: async (args) => ({ success: true, data: { path: String(args.path ?? "") } }),
    };
  }

  function shellTool(): Tool {
    return {
      name: "shell",
      description: "",
      parameters: {},
      execute: async (args) => ({ success: true, data: { workdir: String(args.workdir ?? "") } }),
    };
  }

  it("offers the approval prompt when a tool is missing from the allowlist", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), allowedTools: ["read"] });
    const prompts: string[] = [];
    setInteractiveApproval(async (toolName, command) => {
      prompts.push(`${toolName}: ${command}`);
      return "allow-once";
    });

    const result = await enforceToolPolicy(writeTool(), runtime).execute({
      path: join(root, "a.txt"),
      content: "x",
    });

    expect(result.success).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("write: policy write: Tool not allowed for profile test");
    expect(runtime.profile.allowedTools).not.toContain("write");
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps an allow-session grant for the rest of the run", async () => {
    const root = tempRoot();
    const outside = outsideFile(".txt");
    const runtime = createPolicyRuntime(profile(root));
    let prompts = 0;
    setInteractiveApproval(async () => {
      prompts += 1;
      return "allow-session";
    });

    const first = await enforceToolPolicy(writeTool(), runtime).execute({ path: outside, content: "x" });
    expect(first.success).toBe(true);
    expect(prompts).toBe(1);
    expect(runtime.profile.writeRoots).toContain(outside);

    const second = await enforceToolPolicy(writeTool(), runtime).execute({ path: outside, content: "y" });
    expect(second.success).toBe(true);
    expect(prompts).toBe(1);
    expect(runtime.decisions.at(-1)?.allowed).toBe(true);
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("persists an allow-always grant through the configured persister", async () => {
    const root = tempRoot();
    const outside = outsideFile(".txt");
    const runtime = createPolicyRuntime(profile(root));
    const persisted: string[] = [];
    setInteractiveApproval(async () => "allow-always");

    const wrapped = enforceToolPolicy(writeTool(), runtime, {
      persistGrant: (profileId, grant) => persisted.push(`${profileId}:${grant.kind}`),
    });
    const result = await wrapped.execute({ path: outside, content: "x" });

    expect(result.success).toBe(true);
    expect(persisted).toEqual(["test:roots"]);
    expect(runtime.profile.writeRoots).toContain(outside);
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("expands the shell workspace only after an approval grants it", async () => {
    const root = tempRoot();
    const workdir = tempRoot();
    const runtime = createPolicyRuntime(profile(root));
    setInteractiveApproval(async () => "allow-session");

    const result = await enforceToolPolicy(shellTool(), runtime).execute({ command: "npm test", workdir });

    expect(result.success).toBe(true);
    expect(runtime.profile.writeRoots).toContain(workdir);
    rmSync(workdir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("explains how to grant the permission when no approval channel is attached", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), allowedTools: ["read"] });
    setInteractiveApproval(null);

    const result = await enforceToolPolicy(writeTool(), runtime).execute({
      path: join(root, "a.txt"),
      content: "x",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("POLICY_DENIED: Tool not allowed for profile test");
    expect(result.error).toContain(CONFIG_PATH);
    rmSync(root, { recursive: true, force: true });
  });

  it("tells the agent not to retry after the user declines", async () => {
    const root = tempRoot();
    const outside = outsideFile(".txt");
    const runtime = createPolicyRuntime(profile(root));
    setInteractiveApproval(async () => "deny");

    const result = await enforceToolPolicy(writeTool(), runtime).execute({ path: outside, content: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("POLICY_DENIED");
    expect(result.error).toContain("do not retry");
    rmSync(root, { recursive: true, force: true });
  });

  it("surfaces a reason when the prompt is never answered", async () => {
    const root = tempRoot();
    const runtime = createPolicyRuntime({ ...profile(root), allowedTools: ["read"] });
    setInteractiveApproval(async () => null);

    const result = await enforceToolPolicy(writeTool(), runtime).execute({
      path: join(root, "a.txt"),
      content: "x",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No approval arrived");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("scopeDefaultProfile", () => {
  const base: WorkspaceProfile = {
    id: "default",
    name: "Default Workspace",
    workspaceRoot: join(tmpdir(), "ntox-default-root"),
    readRoots: [join(tmpdir(), "ntox-default-root")],
    writeRoots: [join(tmpdir(), "ntox-default-root")],
    allowedTools: [],
    shellPolicy: "approval-required",
    networkPolicy: "browser-allowed",
    autoCheckpoint: true,
  };

  it("follows the launch directory while the profile is untouched", () => {
    const cwd = tempRoot();
    const scoped = scopeDefaultProfile(base, cwd);

    expect(scoped.workspaceRoot).toBe(cwd);
    expect(scoped.readRoots).toEqual([cwd]);
    expect(scoped.writeRoots).toEqual([cwd]);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("keeps roots the user granted on top of the launch directory", () => {
    const cwd = tempRoot();
    const granted = join(tmpdir(), `ntox-granted-${randomUUID().slice(0, 8)}`);
    const scoped = scopeDefaultProfile({ ...base, writeRoots: [base.workspaceRoot, granted] }, cwd);

    expect(scoped.workspaceRoot).toBe(cwd);
    expect(scoped.writeRoots[0]).toBe(cwd);
    expect(scoped.writeRoots).toContain(granted);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("applyPolicyGrant", () => {
  it("adds a tool only when the profile is allowlisting", () => {
    const restricted: WorkspaceProfile = {
      id: "default",
      name: "Restricted",
      workspaceRoot: "/tmp",
      readRoots: ["/tmp"],
      writeRoots: ["/tmp"],
      allowedTools: ["read"],
      shellPolicy: "approval-required",
      networkPolicy: "browser-allowed",
      autoCheckpoint: true,
    };
    applyPolicyGrant(restricted, { kind: "tool", tool: "email_send" });
    expect(restricted.allowedTools).toEqual(["read", "email_send"]);

    const unrestricted = { ...restricted, allowedTools: [] as string[] };
    applyPolicyGrant(unrestricted, { kind: "tool", tool: "email_send" });
    expect(unrestricted.allowedTools).toEqual([]);
  });

  it("switches shell and network policy grants", () => {
    const granted: WorkspaceProfile = {
      id: "default",
      name: "Granted",
      workspaceRoot: "/tmp",
      readRoots: ["/tmp"],
      writeRoots: ["/tmp"],
      allowedTools: ["read"],
      shellPolicy: "disabled",
      networkPolicy: "disabled",
      autoCheckpoint: true,
    };
    applyPolicyGrant(granted, { kind: "shell" });
    applyPolicyGrant(granted, { kind: "network", policy: "browser-allowed" });
    expect(granted.shellPolicy).toBe("approval-required");
    expect(granted.networkPolicy).toBe("browser-allowed");
  });
});
