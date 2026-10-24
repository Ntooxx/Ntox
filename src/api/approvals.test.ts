import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types/index.js";
import { ApprovalBridge, APPROVAL_DECISIONS } from "./approvals.js";
import { createPolicyRuntime, enforceToolPolicy } from "../core/policy.js";
import { setInteractiveApproval } from "../tools/approval.js";

afterEach(() => setInteractiveApproval(null));

describe("ApprovalBridge", () => {
  it("refuses to ask when nobody is listening", async () => {
    const bridge = new ApprovalBridge(50);
    expect(await bridge.ask("shell", "taskkill /f /im opera.exe")).toBeNull();
    expect(bridge.list()).toHaveLength(0);
  });

  it("hands a pending request to a subscriber and resolves it", async () => {
    const bridge = new ApprovalBridge(5_000);
    const received: unknown[] = [];
    const unsubscribe = bridge.subscribe((payload) => received.push(payload));

    const asked = bridge.ask("shell", "Stop-Process -Name opera");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(received).toHaveLength(1);
    const request = received[0] as { id: string; toolName: string; command: string };
    expect(request.toolName).toBe("shell");
    expect(request.command).toBe("Stop-Process -Name opera");
    expect(bridge.list()).toHaveLength(1);

    expect(bridge.resolve(request.id, "allow-session")).toBe(true);
    expect(await asked).toBe("allow-session");
    expect(bridge.list()).toHaveLength(0);

    unsubscribe();
  });

  it("ignores decisions for unknown requests", () => {
    const bridge = new ApprovalBridge();
    expect(bridge.resolve("apr_missing", "allow-once")).toBe(false);
  });

  it("expires a request nobody answered", async () => {
    const bridge = new ApprovalBridge(5);
    const received: unknown[] = [];
    bridge.subscribe((payload) => received.push(payload));

    expect(await bridge.ask("shell", "git push")).toBeNull();
    expect(received).toEqual([expect.objectContaining({ command: "git push" }), { id: expect.any(String), expired: true }]);
    expect(bridge.list()).toHaveLength(0);
  });

  it("only accepts known decisions", () => {
    expect(APPROVAL_DECISIONS).toEqual(["allow-once", "allow-session", "allow-always", "deny"]);
  });
});

describe("policy approvals over the bridge", () => {
  it("carries a policy denial to the panel and unblocks the call", async () => {
    const root = join(tmpdir(), `ntox-bridge-${randomUUID().slice(0, 8)}`);
    mkdirSync(root, { recursive: true });
    const bridge = new ApprovalBridge(5_000);
    bridge.install();
    const received: { id: string; toolName: string; command: string }[] = [];
    const unsubscribe = bridge.subscribe((payload) => {
      if (!("expired" in payload)) received.push(payload);
    });

    try {
      const runtime = createPolicyRuntime({
        id: "bridge-test",
        name: "Bridge Test",
        workspaceRoot: root,
        readRoots: [root],
        writeRoots: [root],
        allowedTools: ["read"],
        shellPolicy: "approval-required",
        networkPolicy: "browser-allowed",
        autoCheckpoint: true,
      });
      const tool: Tool = {
        name: "write",
        description: "",
        parameters: {},
        execute: async () => ({ success: true }),
      };

      const pending = enforceToolPolicy(tool, runtime).execute({ path: join(root, "a.txt"), content: "x" });
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(received).toHaveLength(1);
      expect(received[0].toolName).toBe("write");
      expect(received[0].command).toContain("policy write: Tool not allowed for profile bridge-test");
      expect(bridge.list()).toHaveLength(1);

      expect(bridge.resolve(received[0].id, "allow-session")).toBe(true);
      const result = await pending;

      expect(result.success).toBe(true);
      expect(runtime.profile.allowedTools).toContain("write");
      expect(bridge.list()).toHaveLength(0);
    } finally {
      unsubscribe();
      rmSync(root, { recursive: true, force: true });
    }
  });
});