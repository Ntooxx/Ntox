import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, WorkspaceProfile } from "../types/index.js";
import { createPolicyRuntime, enforceToolPolicy } from "./policy.js";
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
