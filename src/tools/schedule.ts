import type { Tool, ToolResult } from "../types/index.js";
import { getCron } from "../cron/index.js";
import type { CronJob } from "../cron/scheduler.js";

const MAX_PROMPT = 4000;
const MAX_NAME = 80;

function when(timestamp: number): string {
  if (!timestamp) return "never";
  const delta = timestamp - Date.now();
  const minutes = Math.round(Math.abs(delta) / 60000);
  const label = minutes < 90 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  return delta >= 0 ? `in ${label}` : `${label} ago`;
}

function summarize(job: CronJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    enabled: job.enabled,
    runCount: job.runCount,
    nextRun: when(job.nextRun),
    prompt: job.prompt.slice(0, 200),
  };
}

function render(jobs: CronJob[], prefix = ""): string {
  if (jobs.length === 0) return `${prefix}No scheduled jobs. Use action "add" to create one.`;
  const lines = jobs.map((job) => `- ${job.id} ${job.name} · ${job.schedule} · ${job.enabled ? "on" : "off"} · next ${when(job.nextRun)} · runs ${job.runCount}`);
  return `${prefix}${lines.join("\n")}`;
}

export const scheduleTool: Tool = {
  name: "schedule",
  description:
    "Run a prompt on a recurring schedule so work continues after this turn ends. Use it for standing work: monitoring, digests, reminders, periodic checks. A schedule only fires while the NTOX runtime is up (desktop app or gateway). Report back with the notify tool when a run needs attention.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "remove", "toggle"], description: "Action to perform" },
      name: { type: "string", description: "Short job name, required for add" },
      schedule: {
        type: "string",
        description: "When to run: 'every 5m', 'every hour', 'every morning', 'daily', or a cron expression like '0 9 * * *'",
      },
      prompt: { type: "string", description: "The prompt to run each time, required for add" },
      jobId: { type: "string", description: "Job id from list, required for remove and toggle" },
    },
    required: ["action"],
  },
  async execute(args): Promise<ToolResult> {
    const cron = getCron();
    const action = String(args.action || "");

    if (action === "list") {
      const jobs = cron.listJobs();
      return { success: true, data: { jobs: jobs.map(summarize), summary: render(jobs) } };
    }

    if (action === "add") {
      const name = String(args.name || "").trim().slice(0, MAX_NAME);
      const schedule = String(args.schedule || "").trim();
      const prompt = String(args.prompt || "").trim().slice(0, MAX_PROMPT);
      if (!name) return { success: false, error: "name is required for add" };
      if (!schedule) return { success: false, error: "schedule is required for add" };
      if (!prompt) return { success: false, error: "prompt is required for add" };
      const job = cron.addJob(name, schedule, prompt);
      if (!job) {
        return {
          success: false,
          error: `Unrecognized schedule "${schedule}". Try "every 5m", "every hour", "every morning", "daily", or a cron expression such as "0 9 * * *".`,
        };
      }
      return {
        success: true,
        data: { job: summarize(job), summary: `Scheduled "${job.name}" (${job.schedule}), next run ${when(job.nextRun)}.\n${render([job])}` },
      };
    }

    const jobId = String(args.jobId || "");
    if (!jobId) return { success: false, error: "jobId is required" };

    if (action === "toggle") {
      const job = cron.toggleJob(jobId);
      if (!job) return { success: false, error: `No scheduled job ${jobId}` };
      return { success: true, data: { job: summarize(job), summary: `${job.name} is now ${job.enabled ? "on" : "off"}.` } };
    }

    if (action === "remove") {
      const removed = cron.removeJob(jobId);
      return { success: true, data: { removed, summary: removed ? `Removed ${jobId}.` : `No scheduled job ${jobId}.` } };
    }

    return { success: false, error: `Unknown action: ${action}` };
  },
};