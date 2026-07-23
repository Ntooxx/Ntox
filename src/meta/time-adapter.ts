import type { Energy } from "../types/index.js";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface TimeContext {
  hour: number;
  dayOfWeek: number;
  dayName: string;
  isWeekend: boolean;
  isQuietHours: boolean;
  timeOfDay: TimeOfDay;
  minutesSinceLastActive: number;
}

const QUIET_HOURS_START = 22;
const QUIET_HOURS_END = 7;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getTimeOfDay(hour: number): TimeOfDay {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export function buildTimeContext(lastActiveTimestamp: number): TimeContext {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  return {
    hour,
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    isQuietHours: hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END,
    timeOfDay: getTimeOfDay(hour),
    minutesSinceLastActive: lastActiveTimestamp > 0
      ? Math.floor((now.getTime() - lastActiveTimestamp) / 60000)
      : 9999,
  };
}

export function getTimeGuidance(ctx: TimeContext): string {
  const lines: string[] = [];

  if (ctx.isQuietHours) {
    lines.push("- It's late. Be extra concise. Skip non-essential details.");
  }

  if (ctx.isWeekend && ctx.timeOfDay === "morning") {
    lines.push("- Weekend morning. Relaxed tone. Don't rush.");
  }

  if (ctx.minutesSinceLastActive > 60 && ctx.minutesSinceLastActive < 1440) {
    lines.push(`- ${Math.round(ctx.minutesSinceLastActive / 60)}h since last session — recap context if needed.`);
  } else if (ctx.minutesSinceLastActive >= 1440) {
    const days = Math.round(ctx.minutesSinceLastActive / 1440);
    lines.push(`- ${days}d since last session — provide context refresh.`);
  }

  return lines.join("\n");
}

export function shouldSuppressProactive(ctx: TimeContext): boolean {
  return ctx.isQuietHours;
}

export function getEnergyHint(ctx: TimeContext): Energy {
  if (ctx.isQuietHours) return "low";
  if (ctx.timeOfDay === "morning") return "medium";
  return "high";
}
