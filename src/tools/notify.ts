import type { Tool, ToolResult } from "../types/index.js";
import type { NtoxAliveBridge } from "../alive/ntox.js";

const MAX_MESSAGE = 2000;
const LEVELS = ["info", "warning", "urgent"];

export function createNotifyTool(alive: NtoxAliveBridge): Tool {
  return {
    name: "notify",
    description:
      "Send the human a notification outside this conversation. Use it when a scheduled job, monitor, or long-running task reaches a point they should see now. One short message with the fact and the suggested action.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "What they need to know, including any action to take" },
        level: { type: "string", enum: LEVELS, description: "How urgent it is, defaults to info" },
      },
      required: ["message"],
    },
    async execute(args): Promise<ToolResult> {
      const message = String(args.message || "").trim().slice(0, MAX_MESSAGE);
      if (!message) return { success: false, error: "message is required" };
      const rawLevel = String(args.level || "info").toLowerCase();
      const level = LEVELS.includes(rawLevel) ? rawLevel : "info";
      alive.notify(message, { level });
      return { success: true, data: { sent: true, level, summary: `Notification sent: ${message.slice(0, 300)}` } };
    },
  };
}