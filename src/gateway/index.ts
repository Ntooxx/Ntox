import { loadConfig } from "../core/config.js";
import { createSharedInfra, createSessionInfra, createAgentConfig, SessionManager, runAgentMessage, GatewayOutput } from "../core/dispatcher.js";
import type { SharedInfra } from "../core/dispatcher.js";
import { sanitizeOutput } from "../core/guard.js";
import { CronManager } from "../cron/index.js";
import { createTelegramChannel } from "./telegram.js";
import { createDiscordChannel } from "./discord.js";
import { createWebChannel } from "./web.js";
import { createWhatsAppChannel } from "./whatsapp.js";
import type { GatewayChannel } from "./types.js";

const config = loadConfig();
const shared = createSharedInfra(config);
const sessionInfras = new Map<string, ReturnType<typeof createSessionInfra>>();
const cron = new CronManager();
const channelSenders = new Map<string, (chatId: string, message: string) => Promise<void>>();

function getOrCreateSessionInfra(chatId: string, sharedInfra: SharedInfra) {
  if (!sessionInfras.has(chatId)) {
    sessionInfras.set(chatId, createSessionInfra(sharedInfra));
  }
  return sessionInfras.get(chatId)!;
}

function handleCronCommand(text: string, ctx: string, chatId: string): string | null {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith("/cron")) return null;

  const rest = text.slice(5).trim();

  if (!rest || rest === "list") {
    const jobs = cron.listJobs();
    if (jobs.length === 0) return "No scheduled jobs. Use /cron add <name> | <schedule> | <prompt>";
    return jobs.map((j) =>
      `${j.id} [${j.enabled ? "ON" : "OFF"}] ${j.name}\n  Schedule: ${j.schedule}\n  Prompt: ${j.prompt.slice(0, 80)}\n  Runs: ${j.runCount} | Next: ${new Date(j.nextRun).toLocaleString()}`
    ).join("\n\n");
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
    ].join("\n");
  }

  const addMatch = rest.match(/^add\s+(.+?)\s*\|\s*(.+?)\s*\|\s*([\s\S]+)$/i);
  if (addMatch) {
    const [, name, schedule, prompt] = addMatch;
    const job = cron.addJob(name.trim(), schedule.trim(), prompt.trim(), ctx, chatId);
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

export async function runGateway(channel?: string): Promise<void> {
  const sessions = new SessionManager();
  const makeHandler = (ctx: string) =>
    async (chatId: string, text: string, username: string): Promise<string> => {
      const allowed = ctx === "telegram" ? config.telegramAllowedUsers
        : ctx === "discord" ? config.discordAllowedUsers
        : [];
      if (allowed.length > 0 && !allowed.includes(username) && !allowed.includes(chatId)) {
        return "Access denied.";
      }
      if (sessions.isLocked(chatId)) {
        return "Processing your previous message. Please wait.";
      }
      sessions.lock(chatId);

      const sessionInfra = getOrCreateSessionInfra(chatId, shared);
      const agent = sessions.getOrCreate(
        chatId,
        createAgentConfig({ ...shared, ...sessionInfra }, config, `${ctx}_${chatId}`, { skipReflection: true })
      );

      if (text === "/new" || text === "/reset") {
        agent.resetConversation();
        sessions.unlock(chatId);
        return "Fresh start. Go ahead.";
      }
      if (text === "/help") {
        sessions.unlock(chatId);
        return `Ntox on ${ctx}.\n\nSend any message. I can read/write files, run commands, search the web, and code.\n\n/new — reset conversation\n/cron — scheduled automations\n/help — this message`;
      }

      const cronResponse = handleCronCommand(text, ctx, chatId);
      if (cronResponse) {
        sessions.unlock(chatId);
        return cronResponse;
      }

      sessions.touch(chatId);
      try {
        const output = new GatewayOutput();
        const result = await runAgentMessage(agent, text, output);
        if (result.error) return `Error: ${result.error.slice(0, 400)}`;
        const safe = sanitizeOutput(result.response);
        return safe.length > 4000 ? safe.slice(0, 3997) + "..." : safe;
      } finally {
        sessions.unlock(chatId);
      }
    };

  const channels: GatewayChannel[] = [];

  const makeSender = (ctx: string): ((chatId: string, message: string) => Promise<void>) | null => {
    if (ctx === "telegram" && config.telegramToken) {
      return async (chatId, message) => {
        const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        });
        if (!res.ok) console.error(`[cron] telegram send failed: ${res.status}`);
      };
    }
    if (ctx === "discord" && config.discordToken) {
      return async (chatId, message) => {
        await fetch(`https://discord.com/api/v10/channels/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bot ${config.discordToken}` },
          body: JSON.stringify({ content: message }),
        });
      };
    }
    if (ctx === "whatsapp" && config.whatsappToken) {
      return async (chatId, message) => {
        await fetch(`https://graph.facebook.com/v18.0/${config.whatsappPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: chatId,
            type: "text",
            text: { body: message },
          }),
        });
      };
    }
    return null;
  };

  if ((!channel || channel === "telegram") && config.telegramToken) {
    channels.push(createTelegramChannel({ token: config.telegramToken, onMessage: makeHandler("telegram") }));
    const sender = makeSender("telegram");
    if (sender) channelSenders.set("telegram", sender);
  }
  if ((!channel || channel === "discord") && config.discordToken) {
    channels.push(createDiscordChannel({ token: config.discordToken, onMessage: makeHandler("discord") }));
    const sender = makeSender("discord");
    if (sender) channelSenders.set("discord", sender);
  }
  if ((!channel || channel === "whatsapp") && config.whatsappToken) {
    channels.push(createWhatsAppChannel({
      token: config.whatsappToken,
      phoneNumberId: config.whatsappPhoneNumberId,
      verifyToken: config.whatsappVerifyToken,
      port: config.whatsappPort || 3001,
      onMessage: makeHandler("whatsapp"),
    }));
    const sender = makeSender("whatsapp");
    if (sender) channelSenders.set("whatsapp", sender);
  }
  if ((!channel || channel === "web")) {
    channels.push(createWebChannel({ port: config.webPort || 3000, onMessage: makeHandler("web") }));
  }

  if (channels.length === 0) {
    console.log("\n  Ntox Gateway\n  " + "=".repeat(40));
    console.log("\n  No channels configured. Run npx ntox setup to configure Telegram or Discord.");
    process.exit(1);
  }

  setInterval(() => {
    const purged = sessions.purge();
    for (const id of purged) sessionInfras.delete(id);
  }, 5 * 60 * 1000);

  for (const ch of channels) await ch.start();

  cron.setExecutor(async (prompt) => {
    const sid = `cron_${Date.now()}`;
    const sessionInfra = createSessionInfra(shared);
    const agent = new (await import("../core/agent.js")).Agent(
      createAgentConfig({ ...shared, ...sessionInfra }, config, sid, { skipReflection: true })
    );
    const output = new GatewayOutput();
    const result = await runAgentMessage(agent, prompt, output);
    return result.response || "(no response)";
  });

  cron.setDelivery(async (channel, chatId, message) => {
    const sender = channelSenders.get(channel);
    if (sender) await sender(chatId, message);
  });

  cron.start();
  console.log("[gateway] running. Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    cron.stop();
    for (const ch of channels) await ch.stop();
    process.exit(0);
  });
}
