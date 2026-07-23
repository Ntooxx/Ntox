export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  channel?: string;
  chatId?: string;
  enabled: boolean;
  lastRun: number;
  nextRun: number;
  runCount: number;
  created: number;
}

export interface CronStore {
  jobs: CronJob[];
  nextId: number;
}

export type CronDelivery = (channel: string, chatId: string, message: string) => Promise<void>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function parseSchedule(input: string): { cron: string; interval: number } | null {
  const lower = input.trim().toLowerCase();

  const everyMatch = lower.match(/^every\s+(\d+)\s*(m|min|minutes?|h|hr|hours?|d|days?)\b/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]);
    const unit = everyMatch[2];
    if (unit.startsWith("m")) return { cron: `*/${n} * * * *`, interval: n * MINUTE };
    if (unit.startsWith("h")) return { cron: `0 */${n} * * *`, interval: n * HOUR };
    if (unit.startsWith("d")) return { cron: `0 0 */${n} * *`, interval: n * DAY };
  }

  if (lower === "every minute") return { cron: "* * * * *", interval: MINUTE };
  if (lower === "every hour" || lower === "hourly") return { cron: "0 * * * *", interval: HOUR };
  if (lower === "every day" || lower === "daily") return { cron: "0 9 * * *", interval: DAY };
  if (lower === "every morning") return { cron: "0 9 * * *", interval: DAY };
  if (lower === "every night" || lower === "every evening") return { cron: "0 21 * * *", interval: DAY };
  if (lower === "every monday") return { cron: "0 9 * * 1", interval: 7 * DAY };
  if (lower === "every friday") return { cron: "0 9 * * 5", interval: 7 * DAY };

  const timeMatch = lower.match(/(?:at|every)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { cron: `${min} ${hour} * * *`, interval: DAY };
  }

  const cronParts = input.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (cronParts) {
    return { cron: input.trim(), interval: estimateInterval(cronParts.slice(1)) };
  }

  return null;
}

function estimateInterval(parts: string[]): number {
  const [min, hour, dom] = parts;
  if (min.startsWith("*/")) return parseInt(min.slice(2)) * MINUTE;
  if (hour.startsWith("*/")) return parseInt(hour.slice(2)) * HOUR;
  if (dom.startsWith("*/")) return parseInt(dom.slice(2)) * DAY;
  return HOUR;
}

export function getNextRun(cron: string): number {
  const now = new Date();
  const parts = cron.split(" ");
  if (parts.length !== 5) return now.getTime() + HOUR;

  const [minExpr, hourExpr] = parts;

  let nextMinute = now.getMinutes();
  let nextHour = now.getHours();

  if (minExpr === "*") {
    nextMinute += 1;
  } else if (minExpr.startsWith("*/")) {
    const step = parseInt(minExpr.slice(2));
    nextMinute = Math.ceil((nextMinute + 1) / step) * step;
  } else {
    nextMinute = parseInt(minExpr);
    if (nextMinute <= now.getMinutes()) {
      nextHour += 1;
    }
  }

  if (hourExpr === "*") {
    if (nextMinute >= 60) {
      nextMinute -= 60;
      nextHour += 1;
    }
  } else if (hourExpr.startsWith("*/")) {
    const step = parseInt(hourExpr.slice(2));
    nextHour = Math.ceil((nextHour + 1) / step) * step;
  } else {
    const targetHour = parseInt(hourExpr);
    if (nextHour > targetHour || (nextHour === targetHour && nextMinute > now.getMinutes())) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, targetHour, parseInt(minExpr)).getTime();
    }
    nextHour = targetHour;
  }

  nextHour = nextHour % 24;
  const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextHour, nextMinute);
  if (result.getTime() <= now.getTime()) {
    result.setDate(result.getDate() + 1);
  }
  return result.getTime();
}
