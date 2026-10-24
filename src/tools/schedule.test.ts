import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCron } from "../cron/index.js";
import { scheduleTool } from "./schedule.js";

async function run(args: Record<string, unknown>) {
  return scheduleTool.execute(args, undefined);
}

beforeEach(() => {
  const cron = getCron();
  for (const job of cron.listJobs()) cron.removeJob(job.id);
});

describe("schedule tool", () => {
  it("reports an empty schedule list", async () => {
    const result = await run({ action: "list" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ jobs: [] });
    expect(String((result.data as { summary: string }).summary)).toContain("No scheduled jobs");
  });

  it("adds a recurring job from a friendly schedule", async () => {
    const result = await run({ action: "add", name: "gpu check", schedule: "every 5m", prompt: "Check the GPU" });

    expect(result.success).toBe(true);
    const job = (result.data as { job: { id: string; schedule: string; enabled: boolean } }).job;
    expect(job.schedule).toBe("*/5 * * * *");
    expect(job.enabled).toBe(true);
    expect(String((result.data as { summary: string }).summary)).toContain('Scheduled "gpu check"');
  });

  it("rejects an unparseable schedule with a usable hint", async () => {
    const result = await run({ action: "add", name: "bad", schedule: "whenever you feel like it", prompt: "hi" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("every 5m");
    expect(getCron().listJobs()).toHaveLength(0);
  });

  it("requires a prompt before scheduling anything", async () => {
    const result = await run({ action: "add", name: "no prompt", schedule: "hourly", prompt: "   " });
    expect(result.success).toBe(false);
    expect(result.error).toContain("prompt is required");
  });

  it("toggles and removes jobs by id", async () => {
    const created = await run({ action: "add", name: "digest", schedule: "daily", prompt: "Summarise the day" });
    const id = (created.data as { job: { id: string } }).job.id;

    const toggled = await run({ action: "toggle", jobId: id });
    expect(toggled.success).toBe(true);
    expect((toggled.data as { job: { enabled: boolean } }).job.enabled).toBe(false);

    const removed = await run({ action: "remove", jobId: id });
    expect(removed.success).toBe(true);
    expect(getCron().listJobs()).toHaveLength(0);

    const missing = await run({ action: "toggle", jobId: "cron_99" });
    expect(missing.success).toBe(false);
  });
});

describe("notify tool", () => {
  it("delivers a message through the alive bridge", async () => {
    const { createNotifyTool } = await import("./notify.js");
    const { NtoxAliveBridge } = await import("../alive/ntox.js");
    const { AliveEngine } = await import("../alive/engine.js");
    const bridge = new NtoxAliveBridge(new AliveEngine());
    const spy = vi.spyOn(bridge, "notify");

    const tool = createNotifyTool(bridge);
    const result = await tool.execute({ message: "GPU is hot", level: "urgent" }, undefined);

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith("GPU is hot", { level: "urgent" });
  });

  it("rejects an empty message", async () => {
    const { createNotifyTool } = await import("./notify.js");
    const { NtoxAliveBridge } = await import("../alive/ntox.js");
    const { AliveEngine } = await import("../alive/engine.js");
    const tool = createNotifyTool(new NtoxAliveBridge(new AliveEngine()));

    const result = await tool.execute({ message: "   " }, undefined);
    expect(result.success).toBe(false);
    expect(result.error).toContain("message is required");
  });
});