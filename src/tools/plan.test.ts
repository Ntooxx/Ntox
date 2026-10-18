import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolAccess, ToolContext, ToolResult } from "../types/index.js";
import { clearPlan, loadPlan, planTool, renderPlan, renderPlanContext } from "./plan.js";

let tempDir = "";
const baseDir = process.env.NTOX_DIR!;

function shellAccess(result: ToolResult, seen: Record<string, unknown>[] = []): ToolAccess {
  const shell: Tool = {
    name: "shell",
    description: "test shell",
    parameters: {},
    async execute(args) {
      seen.push(args);
      return result;
    },
  };
  return { get: (name: string) => (name === "shell" ? shell : undefined) };
}

function context(tools?: ToolAccess, sessionId = "test-session"): ToolContext {
  return { sessionId, workspaceRoot: tempDir, tools };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ntox-plan-"));
  process.env.NTOX_DIR = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  process.env.NTOX_DIR = baseDir;
});

describe("plan tool", () => {
  it("creates a plan and persists it", async () => {
    const result = await planTool.execute(
      { action: "create", goal: "Ship plan tool", tasks: ["Design", "Implement", "Test"] },
      context(),
    );

    expect(result.success).toBe(true);
    const plan = loadPlan("test-session");
    expect(plan?.goal).toBe("Ship plan tool");
    expect(plan?.tasks.map((task) => task.id)).toEqual(["t1", "t2", "t3"]);
    expect(plan?.tasks.every((task) => task.status === "pending")).toBe(true);
  });

  it("adds tasks and keeps one task in progress", async () => {
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["A", "B"] }, context());
    await planTool.execute({ action: "add", title: "C", verify: "npm test" }, context());
    await planTool.execute({ action: "update", taskId: "t1", status: "in_progress" }, context());
    await planTool.execute({ action: "update", taskId: "t2", status: "in_progress", notes: "started" }, context());

    const plan = loadPlan("test-session");
    expect(plan?.tasks.map((task) => task.status)).toEqual(["pending", "in_progress", "pending"]);
    expect(plan?.tasks[1].notes).toBe("started");
    expect(plan?.tasks[2].verify).toBe("npm test");
  });

  it("completes a task that has no verify command", async () => {
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["Research"] }, context());
    const result = await planTool.execute({ action: "complete", taskId: "t1" }, context());

    expect(result.success).toBe(true);
    expect(loadPlan("test-session")?.tasks[0].status).toBe("completed");
    expect(loadPlan("test-session")?.tasks[0].completedAt).toBeTypeOf("number");
  });

  it("runs verify and completes on success", async () => {
    const seen: Record<string, unknown>[] = [];
    const tools = shellAccess({ success: true, data: "all tests passed" }, seen);
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["Implement"] }, context(tools));
    await planTool.execute({ action: "update", taskId: "t1", verify: "npm test" }, context(tools));
    const result = await planTool.execute({ action: "complete", taskId: "t1" }, context(tools));

    expect(result.success).toBe(true);
    expect(seen).toEqual([{ command: "npm test", workdir: tempDir }]);
    const task = loadPlan("test-session")?.tasks[0];
    expect(task?.status).toBe("completed");
    expect(task?.lastVerification?.success).toBe(true);
    expect(task?.lastVerification?.output).toContain("all tests passed");
  });

  it("refuses completion when verify fails", async () => {
    const tools = shellAccess({ success: false, error: "2 tests failed", data: { stdout: "boom" } });
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["Implement"] }, context(tools));
    await planTool.execute(
      { action: "update", taskId: "t1", verify: "npm test", status: "in_progress" },
      context(tools),
    );
    const result = await planTool.execute({ action: "complete", taskId: "t1" }, context(tools));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Verification failed");
    const task = loadPlan("test-session")?.tasks[0];
    expect(task?.status).toBe("in_progress");
    expect(task?.lastVerification?.success).toBe(false);
  });

  it("returns a readable summary and context", async () => {
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["A", "B"] }, context());
    const plan = loadPlan("test-session");
    expect(plan).not.toBeNull();
    const rendered = renderPlan(plan!);
    expect(rendered).toContain("Active Plan: Goal");
    expect(rendered).toContain("[ ] t1 A");
    expect(renderPlanContext("test-session")).toContain("Active Plan: Goal");
    expect(renderPlanContext("other-session")).toBe("");
  });

  it("isolates plans by session", async () => {
    await planTool.execute({ action: "create", goal: "One", tasks: ["A"] }, context(undefined, "one"));
    await planTool.execute({ action: "create", goal: "Two", tasks: ["B"] }, context(undefined, "two"));

    expect(loadPlan("one")?.goal).toBe("One");
    expect(loadPlan("two")?.goal).toBe("Two");
  });

  it("verifies pending tasks and reports failures", async () => {
    const tools = shellAccess({ success: false, error: "failed" });
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["A"] }, context(tools));
    await planTool.execute({ action: "update", taskId: "t1", verify: "npm test" }, context(tools));

    const result = await planTool.execute({ action: "verify" }, context(tools));
    expect(result.success).toBe(false);
    expect(result.error).toContain("t1");
    expect(loadPlan("test-session")?.tasks[0].status).toBe("pending");
  });

  it("clears the plan", async () => {
    await planTool.execute({ action: "create", goal: "Goal", tasks: ["A"] }, context());
    const result = await planTool.execute({ action: "clear" }, context());

    expect(result.success).toBe(true);
    expect(loadPlan("test-session")).toBeNull();
    expect(clearPlan("test-session")).toBe(false);
  });

  it("rejects updates without an active plan", async () => {
    const result = await planTool.execute({ action: "add", title: "Orphan" }, context());
    expect(result.success).toBe(false);
    expect(result.error).toContain("No active plan");
  });
});
