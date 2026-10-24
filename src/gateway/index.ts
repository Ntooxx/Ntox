import { loadCachedModels, loadConfig, loadCosts } from "../core/config.js";
import { handleChannelCommand } from "../core/channel-commands.js";
import { isDigestPrompt, renderDigest } from "../core/digest.js";
import { loadPlan } from "../tools/plan.js";
import { ProactiveThrottle, pushProactiveSuggestion } from "../core/proactive-delivery.js";
import { LoopReminderLedger, OPEN_LOOP_REMINDER_INTERVAL_MS, collectOpenLoopReminders } from "../alive/reminders.js";
import { AlivePusher, splitSessionId, type AlivePushTarget } from "./alive-push.js";
import { renderChannelHelp } from "../cli/commands.js";
import { stripAnsi } from "../cli/theme.js";
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
import { handleCronCommand } from "../cron/commands.js";
import { createTelegramChannel } from "./telegram.js";
import { createDiscordChannel } from "./discord.js";
import { createSlackChannel, resolveSlackConfig } from "./slack.js";
import { createWebChannel } from "./web.js";
import { createWhatsAppChannel } from "./whatsapp.js";
import {
  isAliveQuery,
  parseApproveCommand,
  parseSkillInstallCommand,
  parseSkillLifecycleCommand,
  parseSkillMarketplaceCommand,
  parseSkillSaveCommand,
  recordDirectGatewayResponse,
  renderAliveStatus,
  renderApprovalOutcome,
  renderApprovalRequest,
  renderSkillSaveOutcome,
  resolveApproval,
  resolveSkillSave,
  type PendingApproval,
} from "./commands.js";
import { renderSkillProposal } from "../skills/auto-learner.js";
import { installSkillFromSource, renderSkillInstallResult } from "../skills/installer.js";
import { createMarketplace, renderMarketplaceList } from "../skills/marketplace.js";
import { diffSkillByName, renderSkillStats } from "../skills/lifecycle.js";
import { createRoutineRuntime, renderRoutineRun, runRoutine } from "../skills/routine.js";
import { renderMcpStatus } from "../mcp/bridge.js";
import { ConversationStore } from "./conversations.js";
import {
  createTelegramImageSender,
  createTelegramVoiceSender,
  createWhatsAppImageSender,
  createWhatsAppVoiceSender,
  type ImageSender,
  type VoiceSender,
} from "./media-send.js";
import { createInspectServices, extractApprovalCommand, isApprovalRequired } from "./inspect.js";
import { storeApprovalDecision } from "../tools/approval.js";
import { createSettingsService } from "./settings.js";
import { suggestWorkspacePaths } from "./paths.js";
import { audioFilenameFor, clampTtsText } from "./voice.js";
import { handleVoiceCommand, resolveVoiceReply, voiceReplyText } from "./voice-mode.js";
import type { WebVoiceHandlers } from "./web.js";
import { processAtReferences } from "../cli/at-refs.js";
import type { GatewayChannel } from "./types.js";
import type { ProactiveSuggestion } from "../meta/proactive.js";
import type { SkillDefinition } from "../types/index.js";

const config = loadConfig();
const PROACTIVE_PUSH_DELAY_MS = 1500;
const slackConfig = resolveSlackConfig(config as unknown as Record<string, unknown>);
const shared = createSharedInfra(config);
const marketplace = createMarketplace({ indexSource: config.skillMarketplaceIndex });
const sessionInfras = new Map<string, ReturnType<typeof createSessionInfra>>();
const cron = new CronManager();
const channelSenders = new Map<string, (chatId: string, message: string) => Promise<void>>();
const channelImageSenders = new Map<string, ImageSender>();
const channelVoiceSenders = new Map<string, VoiceSender>();
const pendingApprovals = new Map<string, PendingApproval>();
const pendingSkillProposals = new Map<string, SkillDefinition>();
const proactiveThrottle = new ProactiveThrottle();
const loopReminderLedger = new LoopReminderLedger();
const conversations = new ConversationStore();

function getOrCreateSessionInfra(chatId: string, sharedInfra: SharedInfra) {
  if (!sessionInfras.has(chatId)) {
    sessionInfras.set(chatId, createSessionInfra(sharedInfra, config));
  }
  return sessionInfras.get(chatId)!;
}

async function executeRoutineByName(name: string): Promise<string> {
  const skill = shared.skillRegistry.get(name);
  if (!skill) return `Skill "${name}" not found.`;
  if (!skill.steps || skill.steps.length === 0) {
    return `Skill "${name}" has no routine steps. Add a "steps" array to make it a routine.`;
  }
  const runtime = createRoutineRuntime({ llm: shared.llm, tools: shared.tools, skillRegistry: shared.skillRegistry });
  const result = await runRoutine(skill, runtime);
  shared.skillRegistry.incrementUsage(name);
  return renderRoutineRun(skill, result);
}

export async function runGateway(channel?: string): Promise<void> {
  const mcpStatuses = await shared.mcp.connectAll().catch((error: unknown) => {
    console.error("[mcp] connect failed:", error);
    return [];
  });
  for (const status of mcpStatuses) {
    if (status.state === "connected") {
      console.log(`[mcp] ${status.name}: ${status.tools.length} tool(s)`);
    } else if (status.state === "failed") {
      console.error(`[mcp] ${status.name} failed: ${status.error}`);
    }
  }
  const sessions = new SessionManager();
  const alivePusher = new AlivePusher({
    targets: () =>
      sessions
        .getActiveChats()
        .map(splitSessionId)
        .filter((target): target is AlivePushTarget => target !== null && channelSenders.has(target.channel)),
    send: async (channel, chatId, message) => {
      const sender = channelSenders.get(channel);
      if (sender) await sender(chatId, message);
    },
  });
  const unsubscribeAlive = shared.alive.subscribe((action, event) => alivePusher.handle(action, event));
  const sweepOpenLoopReminders = (): void => {
    const now = Date.now();
    const loops = shared.alive.engine.getState().openLoops;
    for (const reminder of collectOpenLoopReminders(loops, { now, scope: "gateway", ledger: loopReminderLedger })) {
      if (alivePusher.handle({ kind: "notify", reason: reminder.text }) > 0) {
        loopReminderLedger.remember("gateway", reminder.loop);
      }
    }
  };
  const loopReminderTimer = setInterval(sweepOpenLoopReminders, OPEN_LOOP_REMINDER_INTERVAL_MS);
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
        ctx === "telegram"
          ? config.telegramAllowedUsers
          : ctx === "discord"
            ? config.discordAllowedUsers
            : ctx === "slack"
              ? (slackConfig?.allowedUsers ?? [])
              : [];
      if (allowed.length > 0 && !allowed.includes(username) && !allowed.includes(chatId)) {
        return "Access denied.";
      }
      if (sessions.isLocked(chatId)) {
        return "Processing your previous message. Please wait.";
      }
      sessions.lock(chatId);
      try {
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
          return response;
        };

        if (text === "/new" || text === "/reset") {
          agent.resetConversation();
          if (ctx === "web") conversations.clearMessages(chatId);
          return direct("Fresh start. Go ahead.", false);
        }
        if (text === "/help") {
          return renderChannelHelp([
            "/new — reset conversation",
            "/voice on|off|auto — spoken replies",
            "/approve <once|session|always|deny> <command> — allow or block a risky command",
          ]);
        }
        if (text === "/mcp" || text.startsWith("/mcp ")) {
          return renderMcpStatus(shared.mcp.statuses());
        }

        const unifiedCommand = await handleChannelCommand(text, {
          config,
          llm: shared.llm,
          tools: shared.tools,
          skills: shared.skillRegistry,
          memory: sessionInfra.memory,
          policy: shared.policy,
          agent,
          models: loadCachedModels() ?? [],
          sessionId: `${ctx}_${chatId}`,
          alive: shared.alive,
        });
        if (unifiedCommand) {
          const body = stripAnsi(unifiedCommand.text);
          return unifiedCommand.record ? direct(body) : body;
        }

        sessions.touch(chatId);
        const activeChannel = channelsByName.get(ctx);
        const notifyTyping = activeChannel ? () => activeChannel.notifyTyping(chatId) : undefined;
        const refresh = () => sessions.refreshLock(chatId);
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
          refresh();
          if (event.type === "tool_result" && !event.success && isApprovalRequired(event.error as string)) {
            const command = extractApprovalCommand(String(event.error || ""));
            if (command) {
              pendingApprovals.set(pendingKey, { command, prompt: promptText });
              if (ctx !== "web") {
                const channel = channelsByName.get(ctx);
                if (channel?.sendApprovalRequest) {
                  void channel.sendApprovalRequest(chatId, command).catch(() => {});
                } else {
                  const sender = channelSenders.get(ctx);
                  if (sender) void sender(chatId, renderApprovalRequest(command)).catch(() => {});
                }
              }
            }
          }
          if (event.type === "skill_proposal" && event.skill) {
            const skill = event.skill as SkillDefinition;
            pendingSkillProposals.set(pendingKey, skill);
            if (ctx !== "web") {
              const sender = channelSenders.get(ctx);
              if (sender) void sender(chatId, renderSkillProposal(skill)).catch(() => {});
            }
          }
          if (event.type === "proactive" && event.suggestion) {
            pushProactiveSuggestion({
              throttle: proactiveThrottle,
              key: `${ctx}:${chatId}`,
              chatId,
              suggestion: event.suggestion as ProactiveSuggestion,
              sender: channelSenders.get(ctx),
              delayMs: PROACTIVE_PUSH_DELAY_MS,
            });
          }
          onEvent?.(event);
        };

        const sendImage = async (name: string, dataUrl: string): Promise<void> => {
          const sender = channelImageSenders.get(ctx);
          if (!sender) return;
          if (dataUrl.length > 9_000_000) {
            console.error(`[gateway] image from ${name} too large to send`);
            return;
          }
          try {
            await sender(chatId, dataUrl, `Image generated by ${name}`);
          } catch (e) {
            console.error(`[gateway] image send failed: ${e instanceof Error ? e.message : e}`);
          }
        };

        const skillSaveParse = parseSkillSaveCommand(text);
        if (skillSaveParse.kind === "save") {
          const pending = pendingSkillProposals.get(pendingKey);
          const saved = resolveSkillSave(skillSaveParse.name, pending);
          if (!saved.ok) return direct(saved.message);
          shared.skillRegistry.add(saved.skill);
          pendingSkillProposals.delete(pendingKey);
          return direct(renderSkillSaveOutcome(saved.skill));
        }

        const skillInstallParse = parseSkillInstallCommand(text);
        if (skillInstallParse.kind !== "not-skill-install") {
          if (skillInstallParse.kind === "invalid") return direct(skillInstallParse.message);
          const installResult = await installSkillFromSource(skillInstallParse.source, shared.skillRegistry, {
            force: skillInstallParse.force,
            marketplace,
          });
          return direct(renderSkillInstallResult(installResult));
        }

        const skillMarketplaceParse = parseSkillMarketplaceCommand(text);
        if (skillMarketplaceParse.kind === "marketplace") {
          const listing = await marketplace.list(skillMarketplaceParse.query ?? undefined);
          return direct(renderMarketplaceList(listing, skillMarketplaceParse.query ?? undefined));
        }

        const skillLifecycleParse = parseSkillLifecycleCommand(text);
        if (skillLifecycleParse.kind === "stats") {
          return direct(renderSkillStats(shared.skillRegistry.list()));
        }
        if (skillLifecycleParse.kind === "run") {
          if (!skillLifecycleParse.name) return direct("Usage: /skill run <name>");
          return direct(await executeRoutineByName(skillLifecycleParse.name));
        }
        if (skillLifecycleParse.kind === "diff") {
          if (!skillLifecycleParse.name) return direct("Usage: /skill diff <name> [source]");
          return direct(
            await diffSkillByName(
              shared.skillRegistry,
              marketplace,
              skillLifecycleParse.name,
              skillLifecycleParse.source,
            ),
          );
        }
        if (skillLifecycleParse.kind === "export") {
          if (!skillLifecycleParse.name) return direct("Usage: /skill export <name>");
          const json = shared.skillRegistry.exportSkill(skillLifecycleParse.name);
          if (!json) return direct(`Skill "${skillLifecycleParse.name}" not found.`);
          return direct(json);
        }

        const approveParse = parseApproveCommand(text);
        if (approveParse.kind !== "not-approve") {
          if (approveParse.kind === "invalid") return direct(approveParse.message);
          const pending = pendingApprovals.get(pendingKey);
          const resolved = resolveApproval(approveParse.scope, approveParse.command, pending);
          if (!resolved.ok) return direct(resolved.message);
          storeApprovalDecision(resolved.command, resolved.decision);
          if (pending && pending.command === resolved.command) pendingApprovals.delete(pendingKey);
          if (!resolved.retryPrompt) return direct(renderApprovalOutcome(resolved));
          agent.removeLastTurn();
          const retryOutput = new GatewayOutput(
            notifyTyping,
            (t) => {
              refresh();
              onToken?.(t);
            },
            bridgeEvent,
            sendImage,
          );
          const retryResult = await runAgentMessage(agent, resolved.retryPrompt, retryOutput, signal);
          if (retryResult.error) {
            if (signal?.aborted || retryResult.error.includes("cancelled")) {
              return sanitizeOutput(retryOutput.flush());
            }
            return `Error: ${retryResult.error.slice(0, 400)}`;
          }
          const retrySafe = sanitizeOutput(retryResult.response);
          if (ctx !== "web") {
            return retrySafe.length > 4000 ? retrySafe.slice(0, 3997) + "..." : retrySafe;
          }
          return retrySafe;
        }

        if (isAliveQuery(text)) {
          return direct(renderAliveStatus(shared.alive.inspect(12)));
        }

        const cronResponse = handleCronCommand(text, cron, { channel: ctx, chatId });
        if (cronResponse) {
          return direct(cronResponse);
        }

        const voiceResponse = handleVoiceCommand(text, ctx, chatId);
        if (voiceResponse) {
          return direct(voiceResponse);
        }

        if (mode === "regenerate") {
          agent.removeLastTurn();
        }
        const output = new GatewayOutput(
          notifyTyping,
          (t) => {
            refresh();
            onToken?.(t);
          },
          bridgeEvent,
          sendImage,
        );
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
    if (ctx === "slack" && slackConfig) {
      return async (chatId, message) => {
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${slackConfig.botToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel: chatId, text: message }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) console.error(`[slack] send failed: ${data?.error ?? res.status}`);
      };
    }
    return null;
  };

  const transcribeAudio = async (audio: string, mimeType: string): Promise<string | null> => {
    const tool = shared.tools.get("stt");
    if (!tool) return null;
    const result = await tool.execute({ audio, filename: audioFilenameFor(mimeType) });
    const data = result.data as { text?: string } | undefined;
    return result.success && data?.text ? data.text : null;
  };

  const synthesizeSpeech = async (text: string): Promise<string | null> => {
    const tool = shared.tools.get("tts");
    if (!tool) return null;
    const result = await tool.execute({ text: clampTtsText(text), format: "opus" });
    const data = result.data as { audio?: string } | undefined;
    return result.success && data?.audio ? data.audio : null;
  };

  if ((!channel || channel === "telegram") && config.telegramToken) {
    channels.push(
      createTelegramChannel({
        token: config.telegramToken,
        onMessage: makeHandler("telegram"),
        transcribe: transcribeAudio,
        synthesize: synthesizeSpeech,
      }),
    );
    const sender = makeSender("telegram");
    if (sender) channelSenders.set("telegram", sender);
    channelImageSenders.set("telegram", createTelegramImageSender(config.telegramToken));
    channelVoiceSenders.set("telegram", createTelegramVoiceSender(config.telegramToken));
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
        transcribe: transcribeAudio,
        synthesize: synthesizeSpeech,
      }),
    );
    const sender = makeSender("whatsapp");
    if (sender) channelSenders.set("whatsapp", sender);
    channelImageSenders.set("whatsapp", createWhatsAppImageSender(config.whatsappToken, config.whatsappPhoneNumberId));
    channelVoiceSenders.set("whatsapp", createWhatsAppVoiceSender(config.whatsappToken, config.whatsappPhoneNumberId));
  }
  if ((!channel || channel === "slack") && slackConfig) {
    channels.push(
      createSlackChannel({
        botToken: slackConfig.botToken,
        appToken: slackConfig.appToken,
        allowedUsers: slackConfig.allowedUsers,
        onMessage: makeHandler("slack"),
      }),
    );
    const sender = makeSender("slack");
    if (sender) channelSenders.set("slack", sender);
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

  for (const ch of channels) channelsByName.set(ch.name, ch);

  setInterval(
    () => {
      const purged = sessions.purge();
      for (const id of purged) sessionInfras.delete(id);
    },
    5 * 60 * 1000,
  );

  for (const ch of channels) await ch.start();
  shared.aliveHosts?.start();

  cron.setExecutor(async (prompt, job) => {
    const routineParse = parseSkillLifecycleCommand(prompt);
    if (routineParse.kind === "run" && routineParse.name) {
      return executeRoutineByName(routineParse.name);
    }
    if (isDigestPrompt(prompt)) {
      return renderDigest({
        alive: shared.alive,
        plan: loadPlan(job.channel && job.chatId ? `${job.channel}_${job.chatId}` : undefined),
        costs: loadCosts(),
        title: job.name,
      });
    }
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
    if (!resolveVoiceReply(channel, chatId, false)) return;
    const voiceSender = channelVoiceSenders.get(channel);
    if (!voiceSender) return;
    try {
      const spoken = await synthesizeSpeech(voiceReplyText(message));
      if (spoken) await voiceSender(chatId, spoken);
    } catch (e) {
      console.error(`[cron] voice delivery to ${channel} failed: ${e instanceof Error ? e.message : e}`);
    }
  });

  cron.setChannelFilter((channel) => channel !== "repl");
  cron.start();
  console.log("[gateway] running. Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    unsubscribeAlive();
    clearInterval(loopReminderTimer);
    shared.aliveHosts?.stop();
    cron.stop();
    for (const ch of channels) await ch.stop();
    await shared.mcp.disconnect().catch(() => {});
    process.exit(0);
  });
}
