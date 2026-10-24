import type { GatewayChannel } from "./types.js";
import { parseApprovalCallbackData, renderApprovalRequestInteractive } from "./commands.js";
import { resolveVoiceReply, voiceReplyText } from "./voice-mode.js";
import { voiceAudioError, dataUrlToVoice } from "./voice.js";
import { imageAttachmentNote, saveMediaFile } from "../core/media.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const TELEGRAM_FILE_API = "https://api.telegram.org/file/bot";
const POLL_INTERVAL = 2000;

const EXT_MIME: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  webm: "audio/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

interface TelegramAudio {
  file_id: string;
  mime_type?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from?: { username?: string };
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string };
  };
  data?: string;
}

interface TelegramPhoto {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string };
    from?: { id: number; username?: string };
    text?: string;
    caption?: string;
    photo?: TelegramPhoto[];
    document?: { file_id: string; mime_type?: string; file_name?: string };
    voice?: TelegramAudio;
    audio?: TelegramAudio;
  };
  callback_query?: TelegramCallbackQuery;
}

const TELEGRAM_APPROVAL_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "Allow once", callback_data: "approve:once" },
      { text: "Session", callback_data: "approve:session" },
      { text: "Always", callback_data: "approve:always" },
      { text: "Deny", callback_data: "approve:deny" },
    ],
  ],
};

interface TelegramConfig {
  token: string;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
  transcribe?: (audio: string, mimeType: string) => Promise<string | null>;
  synthesize?: (text: string) => Promise<string | null>;
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
  } catch {
    /* best-effort: typing indicator failure is non-critical */
  }
}

async function answerCallbackQuery(token: string, callbackQueryId: string): Promise<void> {
  try {
    await apiCall(token, "answerCallbackQuery", { callback_query_id: callbackQueryId });
  } catch {
    /* best-effort */
  }
}

async function clearReplyKeyboard(token: string, chatId: number, messageId: number): Promise<void> {
  try {
    await apiCall(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId });
  } catch {
    /* best-effort */
  }
}

async function downloadTelegramFileRaw(
  token: string,
  fileId: string,
): Promise<{ bytes: Buffer; mimeType: string } | { error: string }> {
  const res = await apiCall(token, "getFile", { file_id: fileId });
  if (!res.ok) return { error: `Telegram getFile failed (${res.status}).` };
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string } } | null;
  const filePath = data?.result?.file_path;
  if (!filePath) return { error: "Telegram could not locate that file." };

  const fileRes = await fetch(`${TELEGRAM_FILE_API}${token}/${filePath}`);
  if (!fileRes.ok) return { error: `Telegram file download failed (${fileRes.status}).` };
  const bytes = Buffer.from(await fileRes.arrayBuffer());

  const ext = (filePath.split(".").pop() || "").toLowerCase();
  return { bytes, mimeType: EXT_MIME[ext] || "application/octet-stream" };
}

async function downloadTelegramFile(
  token: string,
  fileId: string,
): Promise<{ base64: string; mimeType: string } | { error: string }> {
  const raw = await downloadTelegramFileRaw(token, fileId);
  if ("error" in raw) return raw;
  const mimeType = raw.mimeType === "application/octet-stream" ? "audio/ogg" : raw.mimeType;
  const base64 = raw.bytes.toString("base64");
  const invalid = voiceAudioError(base64, mimeType);
  if (invalid) return { error: invalid };
  return { base64, mimeType };
}

const IMAGE_DOC_PATTERN = /\.(png|jpe?g|gif|webp|bmp)$/i;

function pickTelegramImage(message: NonNullable<TelegramUpdate["message"]>): { fileId: string } | null {
  if (message.photo && message.photo.length > 0) {
    return { fileId: message.photo[message.photo.length - 1].file_id };
  }
  const doc = message.document;
  if (!doc) return null;
  const mimeIsImage = (doc.mime_type || "").startsWith("image/");
  const nameIsImage = IMAGE_DOC_PATTERN.test(doc.file_name || "");
  return mimeIsImage || nameIsImage ? { fileId: doc.file_id } : null;
}

async function sendVoiceNote(token: string, chatId: number, dataUrl: string): Promise<boolean> {
  try {
    const voice = dataUrlToVoice(dataUrl);
    if (!voice || voice.bytes.length === 0) return false;
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([voice.bytes], { type: voice.mimeType }), "voice.ogg");
    const res = await fetch(`${TELEGRAM_API}${token}/sendVoice`, { method: "POST", body: form });
    if (!res.ok) {
      console.error(`[telegram] sendVoice failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[telegram] sendVoice error: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

const START_TEXT =
  "Hello! I'm NTOX - your cognitive CLI agent.\n\n" +
  "Send me any message (text or voice note) and I'll help you with coding, research, analysis, or anything else.\n\n" +
  "Commands:\n" +
  "/new - start fresh conversation\n" +
  "/voice on|off|auto - spoken replies\n" +
  "/approve once|session|always|deny <command> - allow or block a risky command\n" +
  "/help - show this message";

const HELP_TEXT =
  "NTOX Telegram Bot\n\n" +
  "Just send me a message — text or voice note.\n" +
  "/new - reset conversation\n" +
  "/voice on|off|auto - spoken replies\n" +
  "/approve once|session|always|deny <command> - allow or block a risky command\n" +
  "/help - this message";

export function createTelegramChannel(config: TelegramConfig): GatewayChannel {
  const { token, onMessage } = config;
  let running = false;
  let lastUpdateId = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollFailures = 0;

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
        pollFailures++;
        schedulePoll();
        return;
      }
      pollFailures = 0;
      const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
      if (!data.ok || !data.result) {
        schedulePoll();
        return;
      }

      for (const update of data.result) {
        if (update.update_id >= lastUpdateId) lastUpdateId = update.update_id;

        const callbackQuery = update.callback_query;
        if (callbackQuery?.message?.chat) {
          await answerCallbackQuery(token, callbackQuery.id);
          const scope = parseApprovalCallbackData(callbackQuery.data || "");
          const chatId = String(callbackQuery.message.chat.id);
          const username = callbackQuery.from?.username || callbackQuery.message.chat.username || "unknown";
          if (scope) {
            try {
              const response = await onMessage(chatId, `/approve ${scope}`, username);
              await sendMessage(token, callbackQuery.message.chat.id, response);
              if (config.synthesize && resolveVoiceReply("telegram", chatId, false)) {
                const spoken = await config.synthesize(voiceReplyText(response));
                if (spoken) await sendVoiceNote(token, callbackQuery.message.chat.id, spoken);
              }
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.error(`[telegram] approval callback error: ${errMsg}`);
              await sendMessage(token, callbackQuery.message.chat.id, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
            }
          }
          if (callbackQuery.message.message_id) {
            await clearReplyKeyboard(token, callbackQuery.message.chat.id, callbackQuery.message.message_id);
          }
          continue;
        }

        const msg = update.message;
        if (!msg?.chat) continue;
        const chatId = String(msg.chat.id);
        const username = msg.from?.username || msg.chat.username || "unknown";
        let text = msg.text;
        let inputIsVoice = false;
        const media = msg.voice || msg.audio;

        if (!text && config.transcribe && media) {
          const download = await downloadTelegramFile(token, media.file_id);
          if ("error" in download) {
            await sendMessage(token, msg.chat.id, download.error).catch(() => {});
            continue;
          }
          const mimeType = media.mime_type || download.mimeType;
          const transcript = await config.transcribe(download.base64, mimeType);
          if (!transcript) {
            await sendMessage(
              token,
              msg.chat.id,
              "Couldn't transcribe that voice note — try again or type your message.",
            ).catch(() => {});
            continue;
          }
          text = transcript;
          inputIsVoice = true;
        }

        const imageFile = pickTelegramImage(msg);
        if (imageFile) {
          const download = await downloadTelegramFileRaw(token, imageFile.fileId);
          if ("error" in download) {
            await sendMessage(token, msg.chat.id, download.error).catch(() => {});
            if (!text) continue;
          } else {
            const saved = saveMediaFile(download.bytes, download.mimeType);
            text = imageAttachmentNote(saved, msg.caption || text);
          }
        }

        if (!text) continue;

        if (text.startsWith("/start")) {
          await sendMessage(token, msg.chat.id, START_TEXT);
          continue;
        }

        if (text === "/help") {
          await sendMessage(token, msg.chat.id, HELP_TEXT);
          continue;
        }

        try {
          const response = await onMessage(chatId, text, username);
          await sendMessage(token, msg.chat.id, response);
          if (config.synthesize && resolveVoiceReply("telegram", chatId, inputIsVoice)) {
            const spoken = await config.synthesize(voiceReplyText(response));
            if (spoken) await sendVoiceNote(token, msg.chat.id, spoken);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[telegram] processing error: ${errMsg}`);
          await sendMessage(token, msg.chat.id, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[telegram] poll error: ${msg}`);
      pollFailures++;
    }
    schedulePoll();
  }

  function schedulePoll(): void {
    if (!running) return;
    const delay = pollFailures > 0 ? Math.min(1000 * Math.pow(2, pollFailures), 30000) : POLL_INTERVAL;
    pollTimer = setTimeout(poll, delay);
  }

  return {
    name: "telegram",
    notifyTyping: async (chatId: string) => {
      await sendChatAction(token, Number(chatId), "typing");
    },
    sendApprovalRequest: async (chatId: string, command: string) => {
      await apiCall(token, "sendMessage", {
        chat_id: Number(chatId),
        text: renderApprovalRequestInteractive(command),
        reply_markup: TELEGRAM_APPROVAL_KEYBOARD,
      });
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
