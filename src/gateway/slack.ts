import { WebSocket } from "ws";
import type { GatewayChannel } from "./types.js";

const SLACK_API = "https://slack.com/api";

export interface SlackConfig {
  botToken: string;
  appToken: string;
  allowedUsers: string[];
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && !!item.trim());
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

export function resolveSlackConfig(source?: Record<string, unknown>): SlackConfig | null {
  const root = source ?? {};
  const slack = (root.slack ?? {}) as Record<string, unknown>;
  const botToken =
    pickString(process.env.NTOX_SLACK_BOT_TOKEN) ?? pickString(slack.botToken) ?? pickString(root.slackToken);
  const appToken =
    pickString(process.env.NTOX_SLACK_APP_TOKEN) ?? pickString(slack.appToken) ?? pickString(root.slackAppToken);
  if (!botToken || !appToken) return null;
  const allowedUsers = pickList(process.env.NTOX_SLACK_ALLOWED_USERS).length
    ? pickList(process.env.NTOX_SLACK_ALLOWED_USERS)
    : pickList(slack.allowedUsers);
  return { botToken, appToken, allowedUsers };
}

export interface SlackSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  send(data: string): void;
  close(): void;
}

export type SlackSocketFactory = (url: string) => SlackSocket;

export interface SlackChannelConfig {
  botToken: string;
  appToken: string;
  allowedUsers?: string[];
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
  connectSocket?: SlackSocketFactory;
}

interface SlackEvent {
  type?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  user_profile?: { name?: string };
}

interface SlackEnvelope {
  type?: string;
  envelope_id?: string;
  payload?: { type?: string; event?: SlackEvent };
}

async function slackApi(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Slack ${method} failed (${response.status})`);
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new Error(`Slack ${method} returned no body`);
  if (data.ok === false) throw new Error(`Slack ${method}: ${String(data.error ?? "failed")}`);
  return data;
}

const defaultConnect: SlackSocketFactory = (url) => new WebSocket(url);

export function createSlackChannel(config: SlackChannelConfig): GatewayChannel {
  const { botToken, appToken, onMessage } = config;
  const connectSocket = config.connectSocket ?? defaultConnect;
  const allowedUsers = config.allowedUsers ?? [];
  let socket: SlackSocket | null = null;
  let running = false;
  let botUserId = "";
  let botUsername = "";
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function openConnection(): Promise<void> {
    const opened = await slackApi("apps.connection.open", appToken);
    const url = pickString(opened.url);
    if (!url) throw new Error("Slack apps.connection.open returned no url");
    socket = connectSocket(url);
    wireSocket(socket);
  }

  function scheduleReconnect(): void {
    if (!running) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.error(`[slack] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openConnection().catch((error: unknown) => {
        console.error(`[slack] reconnect failed: ${error instanceof Error ? error.message : error}`);
        scheduleReconnect();
      });
    }, delay);
  }

  function wireSocket(target: SlackSocket): void {
    target.on("open", () => {
      reconnectAttempts = 0;
    });
    target.on("close", () => {
      console.error("[slack] socket closed");
      if (running) scheduleReconnect();
    });
    target.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[slack] socket error: ${message}`);
    });
    target.on("message", (raw: unknown) => {
      let envelope: SlackEnvelope;
      try {
        envelope = JSON.parse(String(raw)) as SlackEnvelope;
      } catch {
        return;
      }
      if (envelope.type === "hello") {
        console.log(`[slack] bot @${botUsername || botUserId} connected`);
        return;
      }
      if (envelope.type === "disconnect") {
        console.error(`[slack] disconnect requested: ${String((envelope as { reason?: string }).reason ?? "unknown")}`);
        if (running) scheduleReconnect();
        return;
      }
      if (envelope.type !== "events_api" || !envelope.envelope_id) return;
      target.send(JSON.stringify({ envelope_id: envelope.envelope_id, payload: { accepts_response_payload: false } }));
      const event = envelope.payload?.event;
      if (event) void handleEvent(event);
    });
  }

  async function postMessage(channel: string, text: string): Promise<void> {
    await slackApi("chat.postMessage", botToken, { channel, text });
  }

  function stripMention(text: string): string {
    return text.replace(/<@[^>]+>/g, "").trim();
  }

  async function handleEvent(event: SlackEvent): Promise<void> {
    if (event.type !== "message" && event.type !== "app_mention") return;
    if (event.subtype) return;
    if (event.bot_id) return;
    const channel = event.channel;
    const rawText = (event.text ?? "").trim();
    if (!channel || !rawText) return;

    const isDM = channel.startsWith("D") || event.channel_type === "im";
    let text = rawText;
    if (!isDM) {
      if (botUserId && !rawText.includes(`<@${botUserId}>`)) return;
      text = stripMention(rawText);
      if (!text) return;
    }

    const username = event.user_profile?.name ?? event.user ?? "unknown";
    if (allowedUsers.length > 0 && !allowedUsers.includes(username) && !allowedUsers.includes(channel)) {
      await postMessage(channel, "Access denied.").catch(() => {});
      return;
    }

    try {
      const response = await onMessage(channel, text, username);
      await postMessage(channel, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[slack] message error: ${message}`);
      await postMessage(channel, `Error: ${message.slice(0, 1900)}`).catch(() => {});
    }
  }

  return {
    name: "slack",

    notifyTyping: async () => {
      /* Slack has no bot typing indicator */
    },

    async start(): Promise<void> {
      running = true;
      const auth = await slackApi("auth.test", botToken);
      botUserId = pickString(auth.user_id) ?? "";
      botUsername = pickString(auth.user) ?? "";
      if (!botUserId) throw new Error("Slack auth.test returned no user_id");
      await openConnection();
      console.log(`[slack] bot @${botUsername} connected (socket mode)`);
    },

    async stop(): Promise<void> {
      running = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch {
          /* cleanup ok */
        }
        socket = null;
      }
      console.log("[slack] stopped");
    },
  };
}
