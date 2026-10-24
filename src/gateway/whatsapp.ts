import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayChannel } from "./types.js";
import { parseApprovalCallbackData, renderApprovalRequestInteractive } from "./commands.js";
import { resolveVoiceReply, voiceReplyText } from "./voice-mode.js";
import { voiceAudioError, dataUrlToVoice } from "./voice.js";
import { imageAttachmentNote, saveMediaFile } from "../core/media.js";

const WHATSAPP_API = "https://graph.facebook.com/v18.0";
const TYPING_REFRESH_MS = 8000;

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret?: string;
  port: number;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
  transcribe?: (audio: string, mimeType: string) => Promise<string | null>;
  synthesize?: (text: string) => Promise<string | null>;
}

interface WebhookEntry {
  changes: WebhookChange[];
}

interface WebhookChange {
  value: {
    messages?: WebhookMessage[];
    contacts?: WebhookContact[];
    metadata?: { phone_number_id?: string };
  };
}

interface WebhookMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string; id?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { caption?: string; filename?: string; id?: string; mime_type?: string };
  video?: { caption?: string; id?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

const WHATSAPP_APPROVAL_BUTTONS = [
  { id: "approve:once", title: "Allow once" },
  { id: "approve:always", title: "Always allow" },
  { id: "approve:deny", title: "Deny" },
];

interface WebhookContact {
  wa_id: string;
  profile?: { name?: string };
}

function extractText(msg: WebhookMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.document?.caption) return msg.document.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.type === "audio") return "[audio message]";
  if (msg.type === "image") return "[image]";
  if (msg.type === "document") return `[document: ${msg.document?.filename || "unknown"}]`;
  if (msg.type === "video") return "[video]";
  return null;
}

const IMAGE_DOC_PATTERN = /\.(png|jpe?g|gif|webp|bmp)$/i;

function isImageDocument(msg: WebhookMessage): boolean {
  const doc = msg.document;
  if (!doc) return false;
  return (doc.mime_type || "").startsWith("image/") || IMAGE_DOC_PATTERN.test(doc.filename || "");
}

function getContactName(contacts: WebhookContact[] | undefined, waId: string): string {
  if (!contacts) return waId;
  const contact = contacts.find((c) => c.wa_id === waId);
  return contact?.profile?.name || waId;
}

async function sendWhatsAppMessage(token: string, phoneNumberId: string, to: string, text: string): Promise<void> {
  const maxLen = 4096;
  for (let i = 0; i < text.length; i += maxLen) {
    const chunk = text.slice(i, i + maxLen);
    const res = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown");
      console.error(`[whatsapp] send error: ${res.status} ${err.slice(0, 200)}`);
    }
  }
}

async function markAsRead(token: string, phoneNumberId: string, messageId: string): Promise<void> {
  try {
    await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch {
    /* best-effort */
  }
}

async function downloadWhatsAppMediaRaw(
  token: string,
  mediaId: string,
): Promise<{ bytes: Buffer; mimeType: string } | { error: string }> {
  const metaRes = await fetch(`${WHATSAPP_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) return { error: `Media lookup failed (${metaRes.status}).` };
  const meta = (await metaRes.json().catch(() => null)) as { url?: string; mime_type?: string } | null;
  if (!meta?.url) return { error: "That media has no downloadable URL." };

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) return { error: `Media download failed (${fileRes.status}).` };
  return { bytes: Buffer.from(await fileRes.arrayBuffer()), mimeType: meta.mime_type || "application/octet-stream" };
}

async function downloadWhatsAppMedia(
  token: string,
  mediaId: string,
): Promise<{ base64: string; mimeType: string } | { error: string }> {
  const raw = await downloadWhatsAppMediaRaw(token, mediaId);
  if ("error" in raw) return raw;
  const mimeType = raw.mimeType === "application/octet-stream" ? "audio/ogg" : raw.mimeType;
  const base64 = raw.bytes.toString("base64");
  const invalid = voiceAudioError(base64, mimeType.split(";")[0].trim());
  if (invalid) return { error: invalid };
  return { base64, mimeType };
}

async function sendWhatsAppVoiceNote(
  token: string,
  phoneNumberId: string,
  to: string,
  dataUrl: string,
): Promise<boolean> {
  try {
    const voice = dataUrlToVoice(dataUrl);
    if (!voice || voice.bytes.length === 0) return false;

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", voice.mimeType);
    form.append("file", new Blob([voice.bytes], { type: voice.mimeType }), "voice.ogg");
    const uploadRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!uploadRes.ok) {
      console.error(`[whatsapp] media upload failed: ${uploadRes.status}`);
      return false;
    }
    const uploaded = (await uploadRes.json()) as { id?: string };
    if (!uploaded.id) return false;

    const sendRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: uploaded.id },
      }),
    });
    if (!sendRes.ok) {
      const err = await sendRes.text().catch(() => "unknown");
      console.error(`[whatsapp] voice send failed: ${sendRes.status} ${err.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[whatsapp] voice reply error: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function verifyWhatsAppSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!appSecret) return true;
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function createWhatsAppChannel(config: WhatsAppConfig): GatewayChannel {
  const { token, phoneNumberId, verifyToken, appSecret, port, onMessage } = config;
  let server: ReturnType<typeof createServer> | null = null;
  const lastMessageIds = new Map<string, string>();
  const lastTypingAt = new Map<string, number>();

  async function refreshTyping(chatId: string): Promise<void> {
    const messageId = lastMessageIds.get(chatId);
    if (!messageId) return;
    const now = Date.now();
    if (now - (lastTypingAt.get(chatId) || 0) < TYPING_REFRESH_MS) return;
    lastTypingAt.set(chatId, now);
    await markAsRead(token, phoneNumberId, messageId);
  }

  function handleVerify(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const mode = url.searchParams.get("hub.mode");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyTokenParam = url.searchParams.get("hub.verify_token");

    if (mode === "subscribe" && verifyTokenParam === verifyToken) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end();
    }
  }

  async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const signatureHeader = req.headers["x-hub-signature-256"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!verifyWhatsAppSignature(body, signature, appSecret || "")) {
        console.error("[whatsapp] webhook signature verification failed");
        res.writeHead(401);
        res.end();
        return;
      }
      const payload = JSON.parse(body) as { entry?: WebhookEntry[] };

      if (!payload.entry) {
        res.writeHead(200);
        res.end();
        return;
      }

      for (const entry of payload.entry) {
        if (!entry.changes) continue;
        for (const change of entry.changes) {
          if (!change.value?.messages) continue;

          const contacts = change.value.contacts;
          const metadata = change.value.metadata;

          if (metadata?.phone_number_id && metadata.phone_number_id !== phoneNumberId) continue;

          for (const msg of change.value.messages) {
            const chatId = msg.from;
            const username = getContactName(contacts, chatId);
            lastMessageIds.set(chatId, msg.id);

            try {
              await markAsRead(token, phoneNumberId, msg.id);
              lastTypingAt.set(chatId, Date.now());

              let text: string | null = null;
              let inputIsVoice = false;
              const approvalScope =
                msg.type === "interactive" ? parseApprovalCallbackData(msg.interactive?.button_reply?.id || "") : null;

              if (approvalScope) {
                text = `/approve ${approvalScope}`;
              } else if (msg.type === "audio" && config.transcribe) {
                const mediaId = msg.audio?.id;
                if (!mediaId) {
                  await sendWhatsAppMessage(token, phoneNumberId, chatId, "That voice note has no media id.");
                  continue;
                }
                const download = await downloadWhatsAppMedia(token, mediaId);
                if ("error" in download) {
                  await sendWhatsAppMessage(token, phoneNumberId, chatId, download.error);
                  continue;
                }
                const transcript = await config.transcribe(download.base64, download.mimeType);
                if (!transcript) {
                  await sendWhatsAppMessage(
                    token,
                    phoneNumberId,
                    chatId,
                    "Couldn't transcribe that voice note — try again or type your message.",
                  );
                  continue;
                }
                text = transcript;
                inputIsVoice = true;
              } else if (msg.type === "image" || (msg.type === "document" && isImageDocument(msg))) {
                const mediaId = (msg.image ?? msg.document)?.id;
                const caption = msg.image?.caption ?? msg.document?.caption;
                if (mediaId) {
                  const download = await downloadWhatsAppMediaRaw(token, mediaId);
                  if ("error" in download) {
                    await sendWhatsAppMessage(token, phoneNumberId, chatId, download.error);
                    continue;
                  }
                  text = imageAttachmentNote(saveMediaFile(download.bytes, download.mimeType), caption);
                } else {
                  text = extractText(msg);
                }
              } else {
                text = extractText(msg);
              }
              if (!text) continue;

              const response = await onMessage(chatId, text, username);
              await sendWhatsAppMessage(token, phoneNumberId, chatId, response);
              if (config.synthesize && resolveVoiceReply("whatsapp", chatId, inputIsVoice)) {
                const spoken = await config.synthesize(voiceReplyText(response));
                if (spoken) await sendWhatsAppVoiceNote(token, phoneNumberId, chatId, spoken);
              }
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.error(`[whatsapp] processing error: ${errMsg}`);
              await sendWhatsAppMessage(token, phoneNumberId, chatId, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
            }
          }
        }
      }

      res.writeHead(200);
      res.end();
    } catch (e) {
      console.error(`[whatsapp] webhook error: ${e instanceof Error ? e.message : e}`);
      res.writeHead(200);
      res.end();
    }
  }

  return {
    name: "whatsapp",

    notifyTyping: async (chatId: string) => {
      try {
        await refreshTyping(chatId);
      } catch {
        /* best-effort: typing failure is non-critical */
      }
    },

    sendApprovalRequest: async (chatId: string, command: string) => {
      const body = renderApprovalRequestInteractive(command).slice(0, 1024);
      await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: chatId,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: body },
            action: {
              buttons: WHATSAPP_APPROVAL_BUTTONS.map((b) => ({
                type: "reply",
                reply: { id: b.id, title: b.title },
              })),
            },
          },
        }),
      });
    },

    async start() {
      const verifyRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.text().catch(() => "unknown");
        throw new Error(`WhatsApp token invalid: ${verifyRes.status} ${err.slice(0, 200)}`);
      }
      const info = (await verifyRes.json()) as { display_phone_number?: string };
      const displayNumber = info.display_phone_number || phoneNumberId;

      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "GET") {
          handleVerify(req, res);
        } else if (req.method === "POST") {
          handleWebhook(req, res);
        } else {
          res.writeHead(405);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, resolve);
      });
      console.log(`[whatsapp] +${displayNumber} webhook on port ${port}`);
    },

    async stop() {
      if (server) {
        await new Promise<void>((r) => {
          server!.close(() => r());
          server!.closeIdleConnections();
        });
        server = null;
      }
      console.log("[whatsapp] stopped");
    },
  };
}
