import { loadConfig } from "../core/config.js";
import {
  createSharedInfra,
  createSessionInfra,
  createAgentConfig,
  SessionManager,
  runAgentMessage,
  GatewayOutput,
} from "../core/dispatcher.js";
import type { SharedInfra } from "../core/dispatcher.js";
import { sanitizeOutput } from "../core/guard.js";
import { CronManager } from "../cron/index.js";
import { createTelegramChannel } from "./telegram.js";
import { createDiscordChannel } from "./discord.js";
import { createWebChannel } from "./web.js";
import { createWhatsAppChannel } from "./whatsapp.js";
import {
  isAliveQuery,
  parseApproveCommand,
  recordDirectGatewayResponse,
  renderAliveStatus,
  renderApprovalOutcome,
  renderApprovalRequest,
  resolveApproval,
  type PendingApproval,
} from "./commands.js";
import { ConversationStore } from "./conversations.js";
import { createInspectServices, extractApprovalCommand, isApprovalRequired } from "./inspect.js";
import { approvalStore } from "../tools/approval.js";
import { createSettingsService } from "./settings.js";
import { suggestWorkspacePaths } from "./paths.js";
import { audioFilenameFor, clampTtsText } from "./voice.js";
import type { WebVoiceHandlers } from "./web.js";
import { processAtReferences } from "../cli/at-refs.js";
import type { GatewayChannel } from "./types.js";

const config = loadConfig();
const shared = createSharedInfra(config);
const sessionInfras = new Map<string, ReturnType<typeof createSessionInfra>>();
const cron = new CronManager();
const channelSenders = new Map<string, (chatId: string, message: string) => Promise<void>>();
const pendingApprovals = new Map<string, PendingApproval>();
const conversations = new ConversationStore();

function getOrCreateSessionInfra(chatId: string, sharedInfra: SharedInfra) {
  if (!sessionInfras.has(chatId)) {
    sessionInfras.set(chatId, createSessionInfra(sharedInfra, config));
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
  const channelsByName = new Map<string, GatewayChannel>();
  const makeHandler =
    (ctx: string) =>
    async (
      chatId: string,
      text: string,
      username: string,
      onToken?: (token: string) => void,
      onEvent?: (event: Record<string, unknown>) => void,
      signal?: AbortSignal,
      mode?: "normal" | "regenerate",
    ): Promise<string> => {
      const allowed =
        ctx === "telegram" ? config.telegramAllowedUsers : ctx === "discord" ? config.discordAllowedUsers : [];
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
        createAgentConfig({ ...shared, ...sessionInfra }, config, `${ctx}_${chatId}`, { skipReflection: true }),
      );
      const direct = (response: string, record = true): string => {
        if (record) {
          recordDirectGatewayResponse(agent, text, response);
          sessions.touch(chatId);
        }
        sessions.unlock(chatId);
        return response;
      };

      if (text === "/new" || text === "/reset") {
        agent.resetConversation();
        if (ctx === "web") conversations.clearMessages(chatId);
        return direct("Fresh start. Go ahead.", false);
      }
      if (text === "/help") {
        sessions.unlock(chatId);
        return `Ntox on ${ctx}.\n\nSend any message. I can read/write files, run commands, search the web, and code.\n\n/new — reset conversation\n/cron — scheduled automations\n/approve <once|session|always|deny> <command> — allow or block a risky command\n/help — this message`;
      }

      sessions.touch(chatId);
      const activeChannel = channelsByName.get(ctx);
      const notifyTyping = activeChannel ? () => activeChannel.notifyTyping(chatId) : undefined;
      let promptText = text;
      if (ctx === "web" && /@(?:https?:\/\/|~\/|\.{0,2}\/|[A-Za-z]:\\|HEAD|main|master|dev)/.test(text)) {
        try {
          promptText = await processAtReferences(text);
        } catch {
          promptText = text;
        }
      }

      const pendingKey = `${ctx}:${chatId}`;
      const bridgeEvent = (event: Record<string, unknown>) => {
        if (event.type === "tool_result" && !event.success && isApprovalRequired(event.error as string)) {
          const command = extractApprovalCommand(String(event.error || ""));
          if (command) {
            pendingApprovals.set(pendingKey, { command, prompt: promptText });
            if (ctx !== "web") {
              const sender = channelSenders.get(ctx);
              if (sender) void sender(chatId, renderApprovalRequest(command)).catch(() => {});
            }
          }
        }
        onEvent?.(event);
      };

      const approveParse = parseApproveCommand(text);
      if (approveParse.kind !== "not-approve") {
        if (approveParse.kind === "invalid") return direct(approveParse.message);
        const pending = pendingApprovals.get(pendingKey);
        const resolved = resolveApproval(approveParse.scope, approveParse.command, pending);
        if (!resolved.ok) return direct(resolved.message);
        approvalStore.store("shell", `shell:${resolved.command}`, resolved.decision);
        if (pending && pending.command === resolved.command) pendingApprovals.delete(pendingKey);
        if (!resolved.retryPrompt) return direct(renderApprovalOutcome(resolved));
        try {
          agent.removeLastTurn();
          const output = new GatewayOutput(notifyTyping, onToken, bridgeEvent);
          const result = await runAgentMessage(agent, resolved.retryPrompt, output, signal);
          if (result.error) {
            if (signal?.aborted || result.error.includes("cancelled")) {
              return sanitizeOutput(output.flush());
            }
            return `Error: ${result.error.slice(0, 400)}`;
          }
          const safe = sanitizeOutput(result.response);
          if (ctx !== "web") {
            return safe.length > 4000 ? safe.slice(0, 3997) + "..." : safe;
          }
          return safe;
        } finally {
          sessions.unlock(chatId);
        }
      }

      if (isAliveQuery(text)) {
        return direct(renderAliveStatus(shared.alive.inspect(12)));
      }

      const cronResponse = handleCronCommand(text, ctx, chatId);
      if (cronResponse) {
        return direct(cronResponse);
      }

      try {
        if (mode === "regenerate") {
          agent.removeLastTurn();
        }
        const output = new GatewayOutput(notifyTyping, onToken, bridgeEvent);
        const result = await runAgentMessage(agent, promptText, output, signal);
        if (result.error) {
          if (signal?.aborted || result.error.includes("cancelled")) {
            return sanitizeOutput(output.flush());
          }
          return `Error: ${result.error.slice(0, 400)}`;
        }
        const safe = sanitizeOutput(result.response);
        if (ctx !== "web") {
          return safe.length > 4000 ? safe.slice(0, 3997) + "..." : safe;
        }
        return safe;
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
    channels.push(
      createWhatsAppChannel({
        token: config.whatsappToken,
        phoneNumberId: config.whatsappPhoneNumberId,
        verifyToken: config.whatsappVerifyToken,
        appSecret: config.whatsappAppSecret,
        port: config.whatsappPort || 3001,
        onMessage: makeHandler("whatsapp"),
      }),
    );
    const sender = makeSender("whatsapp");
    if (sender) channelSenders.set("whatsapp", sender);
  }
  if (!channel || channel === "web") {
    const inspect = createInspectServices({
      getAgent: (sessionId) => sessions.get(sessionId),
      getMemory: (sessionId) => getOrCreateSessionInfra(sessionId, shared).memory,
      getPatterns: (sessionId) => getOrCreateSessionInfra(sessionId, shared).cognitiveKernel.getPatterns().list(),
      rollbackTool: shared.tools.get("checkpoint"),
    });
    const settings = createSettingsService({ config, llm: shared.llm });
    const readRoots = shared.policy.profile.readRoots.length ? shared.policy.profile.readRoots : [process.cwd()];
    const voice: WebVoiceHandlers = {
      async transcribe(audio, mimeType) {
        const tool = shared.tools.get("stt");
        if (!tool) return { success: false, error: "Voice input is not available on this gateway." };
        const result = await tool.execute({ audio, filename: audioFilenameFor(mimeType) });
        const data = result.data as { text?: string } | undefined;
        return { success: result.success && Boolean(data?.text), text: data?.text, error: result.error };
      },
      async synthesize(text) {
        const tool = shared.tools.get("tts");
        if (!tool) return { success: false, error: "Voice output is not available on this gateway." };
        const result = await tool.execute({ text: clampTtsText(text) });
        const data = result.data as { audio?: string } | undefined;
        return { success: result.success && Boolean(data?.audio), audio: data?.audio, error: result.error };
      },
    };
    channels.push(
      createWebChannel({
        port: config.webPort || 3000,
        host: config.webHost || "127.0.0.1",
        authToken: config.webAuthToken || "",
        conversations,
        inspect,
        settings,
        voice,
        suggestPaths: (prefix) => suggestWorkspacePaths(prefix, readRoots),
        onMessage: makeHandler("web"),
        getStatus: () => ({
          model: config.model,
          provider: config.provider,
          memoryEnabled: config.memoryEnabled,
          theoryEnabled: config.theoryEnabled,
          metaEnabled: {
            strategy: config.metaStrategyEnabled,
            mistakes: config.metaMistakesEnabled,
            reflection: config.metaReflectionEnabled,
          },
          profile: shared.policy.profile,
          sessions: sessions.status(),
          policyDenials: shared.policy.decisions.filter((d) => !d.allowed).slice(-20),
          lastPolicyDecisions: shared.policy.decisions.slice(-20),
        }),
      }),
    );
  }

  if (channels.length === 0) {
    console.log("\n  Ntox Gateway\n  " + "=".repeat(40));
    console.log("\n  No channels configured. Run npx ntox setup to configure Telegram or Discord.");
    process.exit(1);
  }

  setInterval(
    () => {
      const purged = sessions.purge();
      for (const id of purged) sessionInfras.delete(id);
    },
    5 * 60 * 1000,
  );

  for (const ch of channels) await ch.start();

  cron.setExecutor(async (prompt) => {
    const sid = `cron_${Date.now()}`;
    const sessionInfra = createSessionInfra(shared, config);
    const agent = new (await import("../core/agent.js")).Agent(
      createAgentConfig({ ...shared, ...sessionInfra }, config, sid, { skipReflection: true }),
    );
    const output = new GatewayOutput();
    const result = await runAgentMessage(agent, prompt, output);
    return result.response || "(no response)";
  });

  cron.setDelivery(async (channel, chatId, message) => {
    const sender = channelSenders.get(channel);
    if (sender) {
      try {
        await sender(chatId, message);
      } catch (e) {
        console.error(`[cron] delivery to ${channel} failed: ${e instanceof Error ? e.message : e}, retrying once`);
        try {
          await new Promise((r) => setTimeout(r, 1000));
          await sender(chatId, message);
        } catch (e2) {
          console.error(`[cron] delivery to ${channel} failed again: ${e2 instanceof Error ? e2.message : e2}`);
        }
      }
    }
  });

  cron.start();
  console.log("[gateway] running. Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    cron.stop();
    for (const ch of channels) await ch.stop();
    process.exit(0);
  });
}
