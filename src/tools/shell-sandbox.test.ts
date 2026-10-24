import { describe, it, expect, afterEach, vi } from "vitest";

const configState = vi.hoisted(() => ({ dockerEnabled: false }));

vi.mock("../core/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({ ...actual.loadConfig(), dockerEnabled: configState.dockerEnabled }),
  };
});

import { decideSandbox, setDockerProbe, shellTool } from "./shell.js";
import { setInteractiveApproval } from "./approval.js";

afterEach(() => {
  setDockerProbe(null);
  configState.dockerEnabled = false;
});

describe("decideSandbox", () => {
  it("runs in Docker when isolation is required and Docker is available", () => {
    expect(decideSandbox({ dockerEnabled: true, isWindows: true, dockerAvailable: true })).toBe("docker");
    expect(decideSandbox({ dockerEnabled: true, isWindows: false, dockerAvailable: true })).toBe("docker");
  });

  it("denies execution when isolation is required but Docker is unavailable", () => {
    expect(decideSandbox({ dockerEnabled: true, isWindows: true, dockerAvailable: false })).toBe("denied");
    expect(decideSandbox({ dockerEnabled: true, isWindows: false, dockerAvailable: false })).toBe("denied");
  });

  it("uses Docker opportunistically on POSIX when isolation is not required", () => {
    expect(decideSandbox({ dockerEnabled: false, isWindows: false, dockerAvailable: true })).toBe("docker");
    expect(decideSandbox({ dockerEnabled: false, isWindows: false, dockerAvailable: false })).toBe("host");
  });

  it("runs on the host when isolation is not required", () => {
    expect(decideSandbox({ dockerEnabled: false, isWindows: true, dockerAvailable: false })).toBe("host");
    expect(decideSandbox({ dockerEnabled: false, isWindows: true, dockerAvailable: true })).toBe("host");
  });
});

describe("shellTool sandbox boundary", () => {
  it("fails closed instead of falling back to the host when isolation is required", async () => {
    configState.dockerEnabled = true;
    setDockerProbe(async () => false);

    const result = await shellTool.execute({ command: "echo sandbox-must-not-run" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SANDBOX_REQUIRED");
    expect(result.error).toContain("dockerEnabled");
    expect(String(result.data ?? "")).not.toContain("sandbox-must-not-run");
  });

  it("keeps running on the host when isolation is not required", async () => {
    configState.dockerEnabled = false;
    setDockerProbe(async () => false);

    const result = await shellTool.execute({ command: "echo sandbox-host-path-ok" });

    expect(result.success).toBe(true);
    expect(String(result.data)).toContain("sandbox-host-path-ok");
  });

  it("does not let a granted approval bypass the isolation requirement", async () => {
    configState.dockerEnabled = true;
    setDockerProbe(async () => false);
    setInteractiveApproval(async () => "allow-once");

    try {
      const result = await shellTool.execute({ command: "Remove-Item -Force C:\\nonexistent-ntox-sandbox-file.txt" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("SANDBOX_REQUIRED");
      expect(result.error ?? "").not.toContain("APPROVAL_REQUIRED");
    } finally {
      setInteractiveApproval(null);
    }
  });
});