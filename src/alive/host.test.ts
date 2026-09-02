import { describe, expect, it } from "vitest";
import { AliveEngine } from "./engine.js";
import { NtoxAliveHostAdapters } from "./host.js";
import { NtoxAliveBridge } from "./ntox.js";

describe("NtoxAliveHostAdapters", () => {
  it("emits a git commit event only after a baseline state exists", async () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const states = [
      { head: "first", changedFiles: 0 },
      { head: "second", changedFiles: 2 },
    ];
    const host = new NtoxAliveHostAdapters({
      bridge,
      workspaceRoot: process.cwd(),
      gitProbe: async () => states.shift() ?? null,
    });

    await host.pollGit();
    await host.pollGit();

    expect(bridge.engine.getState().events).toEqual([
      expect.objectContaining({ type: "git_commit", payload: { head: "second", changedFiles: 2 } }),
    ]);
  });

  it("keeps file events inside the workspace and ignores noisy directories", () => {
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const host = new NtoxAliveHostAdapters({ bridge, workspaceRoot: process.cwd() });

    host.recordFileChange("src/core/agent.ts");
    host.recordFileChange("node_modules/example/index.js");
    host.recordFileChange("../outside.txt");

    expect(bridge.engine.getState().events).toEqual([
      expect.objectContaining({ type: "file_changed", payload: { path: "src/core/agent.ts", change: "change" } }),
    ]);
  });
});
