import { WebSocket } from "ws";
import type { GatewayChannel } from "./types.js";

const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15); // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT

interface DiscordConfig {
  token: string;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
}

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

async function apiCall(token: string, path: string, method: string = "GET", body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": body ? "application/json" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function createDiscordChannel(config: DiscordConfig): GatewayChannel {
  const { token, onMessage } = config;
  let ws: WebSocket | null = null;
  let running = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let sessionId = "";
  let lastSeq = 0;
  let botId = "";
  let botUsername = "";
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function sendWs(data: GatewayPayload): Promise<void> {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function startHeartbeat(intervalMs: number): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      sendWs({ op: 1, d: lastSeq || null });
    }, intervalMs);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function identify(): void {
    sendWs({
      op: 2,
      d: {
        token,
        intents: INTENTS,
        properties: { os: process.platform, browser: "ntox", device: "ntox" },
      },
    });
  }

  function resume(): void {
    sendWs({
      op: 6,
      d: { token, session_id: sessionId, seq: lastSeq },
    });
  }

  function scheduleReconnect(): void {
    if (!running) return;
    stopHeartbeat();
    if (ws) { try { ws.close(); } catch { /* cleanup ok */ }; ws = null; }
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.error(`[discord] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(connect, delay);
  }

  async function connect(): Promise<void> {
    if (!running) return;
    reconnectTimer = null;
    try { ws?.close(); } catch { /* cleanup ok */ }
    ws = null;

    ws = new WebSocket(GATEWAY_URL);

    ws.on("open", () => {
      if (sessionId) {
        resume();
      }
    });

    ws.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString()) as GatewayPayload;
        if (payload.s) lastSeq = payload.s;

        switch (payload.op) {
          case 10: {
            const hello = payload.d as { heartbeat_interval: number };
            startHeartbeat(hello.heartbeat_interval);
            if (!sessionId) identify();
            break;
          }
          case 0: {
            if (payload.t === "READY") {
              const ready = payload.d as { session_id: string; user: { id: string; username: string } };
              sessionId = ready.session_id;
              botId = ready.user.id;
              botUsername = ready.user.username;
              reconnectAttempts = 0;
              console.log(`[discord] bot @${botUsername} connected`);
            }
            if (payload.t === "MESSAGE_CREATE") {
              handleMessage(payload.d as DiscordMessagePayload);
            }
            break;
          }
          case 9: {
            console.error("[discord] invalid session, re-identifying");
            sessionId = "";
            identify();
            break;
          }
        }
      } catch (e) {
        console.error(`[discord] parse error: ${e instanceof Error ? e.message : e}`);
      }
    });

    ws.on("close", (code) => {
      console.error(`[discord] disconnected (code ${code})`);
      stopHeartbeat();
      if (running) scheduleReconnect();
    });

    ws.on("error", (e) => {
      console.error(`[discord] ws error: ${e.message}`);
      stopHeartbeat();
    });
  }

  interface DiscordMessagePayload {
    id: string;
    content: string;
    channel_id: string;
    guild_id?: string;
    author: { id: string; username: string; bot?: boolean };
    mentions?: { id: string }[];
  }

  async function handleMessage(msg: DiscordMessagePayload): Promise<void> {
    if (!msg.content) return;
    if (msg.author.bot) return;
    if (msg.author.id === botId) return;

    const isDM = !msg.guild_id;
    const chatId = msg.channel_id;
    const username = msg.author.username;
    const text = msg.content;

    if (isDM) {
      try {
        onMessage(chatId, text, username).then(async (response) => {
          await apiCall(token, `/channels/${chatId}/messages`, "POST", { content: response });
        }).catch(async (e) => {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[discord] dm error: ${errMsg}`);
          await apiCall(token, `/channels/${chatId}/messages`, "POST", {
            content: `Error: ${errMsg.slice(0, 1900)}`,
          }).catch(() => {});
        });
      } catch { /* ignore */ }
      return;
    }

    const botMentioned = msg.mentions?.some((m: { id: string }) => m.id === botId) ?? false;
    if (!botMentioned) return;

    const cleanText = text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
    if (!cleanText) return;

    try {
      onMessage(chatId, cleanText, username).then(async (response) => {
        await apiCall(token, `/channels/${chatId}/messages`, "POST", { content: response });
      }).catch(async (e) => {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[discord] guild error: ${errMsg}`);
        await apiCall(token, `/channels/${chatId}/messages`, "POST", {
          content: `Error: ${errMsg.slice(0, 1900)}`,
        }).catch(() => {});
      });
    } catch { /* ignore */ }
  }

  return {
    name: "discord",

    notifyTyping: async (chatId: string) => {
      try {
        await apiCall(token, `/channels/${chatId}/typing`, "POST");
      } catch { /* best-effort */ }
    },

    async start() {
      running = true;
      const me = await apiCall(token, "/users/@me");
      if (!me.ok) {
        throw new Error(`Discord bot token invalid: ${me.status}`);
      }
      const info = (await me.json()) as { id: string; username: string };
      botId = info.id;
      botUsername = info.username;
      await connect();
    },

    async stop() {
      running = false;
      stopHeartbeat();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { try { ws.close(); } catch { /* cleanup ok */ }; ws = null; }
      console.log("[discord] stopped");
    },
  };
}
