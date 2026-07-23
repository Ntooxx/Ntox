import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayChannel } from "./types.js";

const WHATSAPP_API = "https://graph.facebook.com/v18.0";

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  port: number;
  onMessage: (chatId: string, text: string, username: string) => Promise<string>;
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
  image?: { caption?: string; id?: string };
  audio?: { id?: string };
  document?: { caption?: string; filename?: string; id?: string };
  video?: { caption?: string; id?: string };
}

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

async function sendTypingIndicator(token: string, phoneNumberId: string, messageId: string): Promise<void> {
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
      }),
    });
  } catch { /* best-effort */ }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function createWhatsAppChannel(config: WhatsAppConfig): GatewayChannel {
  const { token, phoneNumberId, verifyToken, port, onMessage } = config;
  let server: ReturnType<typeof createServer> | null = null;
  let _running = false;

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
            const text = extractText(msg);
            if (!text) continue;

            const chatId = msg.from;
            const username = getContactName(contacts, chatId);

            try {
              sendTypingIndicator(token, phoneNumberId, msg.id);
              onMessage(chatId, text, username).then(async (response) => {
                await sendWhatsAppMessage(token, phoneNumberId, chatId, response);
              }).catch(async (e) => {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error(`[whatsapp] processing error: ${errMsg}`);
                await sendWhatsAppMessage(token, phoneNumberId, chatId, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
              });
            } catch { /* ignore */ }
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
      await sendTypingIndicator(token, phoneNumberId, chatId);
    },

    async start() {
      _running = true;

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
      _running = false;
      if (server) {
        await new Promise<void>((r) => server!.close(() => r()));
        server = null;
      }
      console.log("[whatsapp] stopped");
    },
  };
}
