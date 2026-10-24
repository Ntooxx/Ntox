import type { CronManager } from "./manager.js";

export interface CronCommandTarget {
  channel?: string;
  chatId?: string;
}

export function handleCronCommand(text: string, cron: CronManager, target?: CronCommandTarget): string | null {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith("/cron")) return null;

  const rest = text.slice(5).trim();

  if (!rest || rest === "list") {
    const jobs = cron.listJobs();
    if (jobs.length === 0) return "No scheduled jobs. Use /cron add <name> | <schedule> | <prompt>";
    return jobs
      .map(
        (j) =>
          `${j.id} [${j.enabled ? "ON" : "OFF"}] ${j.name}\n  Schedule: ${j.schedule}\n  Prompt: ${j.prompt.slice(0, 80)}\n  Runs: ${j.runCount} | Next: ${new Date(j.nextRun).toLocaleString()}`,
      )
      .join("\n\n");
  }

  if (rest === "help") {
    return [
      "Cron scheduler — run prompts on a schedule.",
      "",
      "/cron list — show all jobs",
      "/cron add <name> | <schedule> | <prompt> — create a job",
      "/cron remove <id> — delete a job",
      "/cron toggle <id> — enable/disable a job",
      "",
      "Schedules: 'every 30m', 'every 2h', 'daily', 'every morning', 'at 9pm', 'every monday', or cron expression '0 9 * * *'",
      "",
      "Example: /cron add weather | every morning | What's the weather in NYC?",
      "Routine: /cron add brief | every morning | /skill run morning-brief",
    ].join("\n");
  }

  const addMatch = rest.match(/^add\s+(.+?)\s*\|\s*(.+?)\s*\|\s*([\s\S]+)$/i);
  if (addMatch) {
    const [, name, schedule, prompt] = addMatch;
    const job = cron.addJob(name.trim(), schedule.trim(), prompt.trim(), target?.channel, target?.chatId);
    if (!job) return `Invalid schedule: "${schedule}". Try 'every 30m', 'daily', 'at 9pm', or a cron expression.`;
    return `Scheduled "${job.name}" (${job.schedule}). Next run: ${new Date(job.nextRun).toLocaleString()}`;
  }

  const removeMatch = rest.match(/^remove\s+(.+)$/i);
  if (removeMatch) {
    const id = removeMatch[1].trim();
    return cron.removeJob(id) ? `Removed job ${id}.` : `Job ${id} not found.`;
  }

  const toggleMatch = rest.match(/^toggle\s+(.+)$/i);
  if (toggleMatch) {
    const id = toggleMatch[1].trim();
    const job = cron.toggleJob(id);
    return job ? `${job.name} ${job.enabled ? "enabled" : "disabled"}.` : `Job ${id} not found.`;
  }

  return "Unknown cron command. Use /cron help for usage.";
}
