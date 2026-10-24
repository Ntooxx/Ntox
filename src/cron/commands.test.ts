import { describe, it, expect, vi, beforeEach } from "vitest";
import { CronManager } from "./manager.js";
import { handleCronCommand } from "./commands.js";

function freshCron(): CronManager {
  const cron = new CronManager();
  for (const job of cron.listJobs()) cron.removeJob(job.id);
  return cron;
}

beforeEach(() => {
  freshCron();
});

describe("handleCronCommand", () => {
  it("ignores input that is not a cron command", () => {
    const cron = freshCron();
    expect(handleCronCommand("hello", cron)).toBeNull();
    expect(handleCronCommand("/status", cron)).toBeNull();
  });

  it("lists the empty state and the bare /cron form", () => {
    const cron = freshCron();
    expect(handleCronCommand("/cron", cron)).toContain("No scheduled jobs");
    expect(handleCronCommand("/cron list", cron)).toContain("/cron add");
  });

  it("adds, lists, toggles, and removes a job with the caller's target", () => {
    const cron = freshCron();
    const added = handleCronCommand("/cron add weather | every morning | What's the weather in NYC?", cron, {
      channel: "repl",
      chatId: "sess_1",
    });
    expect(added).toContain('Scheduled "weather"');
    expect(added).toContain("Next run:");

    const job = cron.listJobs()[0];
    expect(job.channel).toBe("repl");
    expect(job.chatId).toBe("sess_1");
    expect(job.enabled).toBe(true);

    const listed = handleCronCommand("/cron list", cron)!;
    expect(listed).toContain(job.id);
    expect(listed).toContain("[ON] weather");
    expect(listed).toContain("What's the weather in NYC?");
    expect(listed).toContain("Runs: 0");

    const toggled = handleCronCommand(`/cron toggle ${job.id}`, cron);
    expect(toggled).toContain("disabled");
    expect(cron.listJobs()[0].enabled).toBe(false);

    const removed = handleCronCommand(`/cron remove ${job.id}`, cron);
    expect(removed).toContain(`Removed job ${job.id}`);
    expect(cron.listJobs()).toHaveLength(0);
  });

  it("stores no target when the caller passes none", () => {
    const cron = freshCron();
    const added = handleCronCommand("/cron add report | daily | summarize the inbox", cron);
    expect(added).toContain('Scheduled "report"');
    const job = cron.listJobs()[0];
    expect(job.channel).toBeUndefined();
    expect(job.chatId).toBeUndefined();
  });

  it("rejects invalid schedules with a usage hint", () => {
    const cron = freshCron();
    const added = handleCronCommand("/cron add broken | whenever you feel like | hi", cron);
    expect(added).toContain("Invalid schedule");
    expect(cron.listJobs()).toHaveLength(0);
  });

  it("answers help and unknown subcommands", () => {
    const cron = freshCron();
    const help = handleCronCommand("/cron help", cron)!;
    expect(help).toContain("/cron add <name> | <schedule> | <prompt>");
    expect(help).toContain("/skill run morning-brief");
    expect(handleCronCommand("/cron fly me to the moon", cron)).toContain("Unknown cron command");
    expect(handleCronCommand(`/cron remove ${"cron_99"}`, cron)).toContain("not found");
  });

  it("supports plain schedules like every 30m and raw cron expressions", () => {
    const cron = freshCron();
    expect(handleCronCommand("/cron add poll | every 30m | check the queue", cron)).toContain("Scheduled");
    expect(handleCronCommand("/cron add nine | 0 9 * * * | standup", cron)).toContain("Scheduled");
    expect(cron.listJobs().map((job) => job.schedule)).toEqual(["*/30 * * * *", "0 9 * * *"]);
  });
});

describe("CronManager channel filter", () => {
  it("runs only the jobs a manager owns", async () => {
    vi.useFakeTimers();
    try {
      const cron = freshCron();
      cron.addJob("repl job", "every 30m", "prompt for repl", "repl", "sess_1");
      cron.addJob("telegram job", "every 30m", "prompt for telegram", "telegram", "chat_1");
      const runs: string[] = [];
      cron.setExecutor(async (prompt) => {
        runs.push(prompt);
        return "ok";
      });

      const makeDue = () => {
        for (const job of cron.listJobs()) job.nextRun = Date.now() - 1000;
      };

      cron.setChannelFilter((channel) => channel === "repl");
      makeDue();
      cron.start();
      await vi.advanceTimersByTimeAsync(50);
      cron.stop();
      expect(runs).toEqual(["prompt for repl"]);

      cron.setChannelFilter((channel) => channel === "telegram");
      runs.length = 0;
      makeDue();
      cron.start();
      await vi.advanceTimersByTimeAsync(50);
      cron.stop();
      expect(runs).toEqual(["prompt for telegram"]);
    } finally {
      vi.useRealTimers();
      freshCron();
    }
  });

  it("advances nextRun only for jobs it owns", async () => {
    vi.useFakeTimers();
    try {
      const cron = freshCron();
      const mine = cron.addJob("mine", "every 30m", "p1", "repl", "s")!;
      const theirs = cron.addJob("theirs", "every 30m", "p2", "telegram", "c")!;
      mine.nextRun = Date.now() - 1000;
      theirs.nextRun = Date.now() - 1000;
      const theirsDue = theirs.nextRun;
      cron.setChannelFilter((channel) => channel === "repl");
      cron.setExecutor(async () => "ok");

      cron.start();
      await vi.advanceTimersByTimeAsync(50);
      cron.stop();

      const jobs = cron.listJobs();
      const mineAfter = jobs.find((job) => job.id === mine.id)!;
      const theirsAfter = jobs.find((job) => job.id === theirs.id)!;
      expect(mineAfter.nextRun).toBeGreaterThan(Date.now());
      expect(theirsAfter.nextRun).toBe(theirsDue);
      expect(mineAfter.runCount).toBe(1);
      expect(theirsAfter.runCount).toBe(0);
    } finally {
      vi.useRealTimers();
      freshCron();
    }
  });
});
