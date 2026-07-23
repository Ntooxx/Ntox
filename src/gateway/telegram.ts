import type { GatewayChannel } from "./types.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const POLL_INTERVAL = 2000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string };
    from?: { id: number; username?: string };
    text?: string;
  };
}

interface TelegramConfig {
  token: string;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
}

async function apiCall(token: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  const url = `${TELEGRAM_API}${token}/${method}`;
  return fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const maxLen = 4000;
  for (let i = 0; i < text.length; i += maxLen) {
    const chunk = text.slice(i, i + maxLen);
    await apiCall(token, "sendMessage", {
      chat_id: chatId,
      text: chunk,
    });
  }
}

async function sendChatAction(token: string, chatId: number, action: string): Promise<void> {
  try {
    await apiCall(token, "sendChatAction", { chat_id: chatId, action });
  } catch { /* best-effort: typing indicator failure is non-critical */ }
}

export function createTelegramChannel(config: TelegramConfig): GatewayChannel {
  const { token, onMessage } = config;
  let running = false;
  let lastUpdateId = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  async function poll(): Promise<void> {
    if (!running) return;
    try {
      const res = await apiCall(token, "getUpdates", {
        offset: lastUpdateId + 1,
        timeout: 30,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "unknown");
        console.error(`[telegram] API error: ${res.status} ${err.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        if (update.update_id >= lastUpdateId) lastUpdateId = update.update_id;
        if (!update.message?.text || !update.message.chat) continue;
        const chatId = String(update.message.chat.id);
        const text = update.message.text;
        const username = update.message.from?.username || update.message.chat.username || "unknown";

        if (text.startsWith("/start")) {
          await sendMessage(token, update.message.chat.id,
            "Hello! I'm NTOX — your cognitive CLI agent.\n\n" +
            "Send me any message and I'll help you with coding, research, analysis, or anything else.\n" +
            "Commands:\n" +
            "/new — start fresh conversation\n" +
            "/help — show this message");
          continue;
        }

        if (text === "/help") {
          await sendMessage(token, update.message.chat.id,
            "NTOX Telegram Bot\n\n" +
            "Just send me a message and I'll respond.\n" +
            "/new — reset conversation\n" +
            "/help — this message");
          continue;
        }

        try {
          const msg = update.message!;
          onMessage(chatId, text, username).then(async (response) => {
            await sendMessage(token, msg.chat.id, response);
          }).catch(async (e) => {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error(`[telegram] processing error: ${errMsg}`);
            await sendMessage(token, msg.chat.id, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
          });
        } catch { /* ignore */ }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[telegram] poll error: ${msg}`);
    }
    if (running) {
      pollTimer = setTimeout(poll, POLL_INTERVAL);
    }
  }

  return {
    name: "telegram",
    notifyTyping: async (chatId: string) => {
      await sendChatAction(token, Number(chatId), "typing");
    },
    async start() {
      running = true;
      const me = await apiCall(token, "getMe");
      if (!me.ok) {
        const err = await me.text().catch(() => "unknown");
        throw new Error(`Telegram bot token invalid: ${me.status} ${err.slice(0, 200)}`);
      }
      const botInfo = (await me.json()) as { result: { username: string } };
      console.log(`[telegram] bot @${botInfo.result.username} connected`);
      pollTimer = setTimeout(poll, 0);
    },
    async stop() {
      running = false;
      if (pollTimer) clearTimeout(pollTimer);
      console.log("[telegram] stopped");
    },
  };
}