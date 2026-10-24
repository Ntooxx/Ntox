import { decodeDataUrl } from "../core/media.js";

const TELEGRAM_API = "https://api.telegram.org/bot";
const WHATSAPP_API = "https://graph.facebook.com/v18.0";

export type ImageSender = (chatId: string, dataUrl: string, caption: string) => Promise<void>;

export type VoiceSender = (chatId: string, dataUrl: string) => Promise<void>;

function toUpload(dataUrl: string): { bytes: Buffer; mimeType: string; filename: string } {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || !decoded.mimeType.startsWith("image/")) {
    throw new Error("unsupported image payload");
  }
  const subtype = decoded.mimeType.split("/")[1]?.split(";")[0] || "png";
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  return { bytes: decoded.bytes, mimeType: decoded.mimeType, filename: `image.${extension}` };
}

function toAudioUpload(dataUrl: string): { bytes: Buffer; mimeType: string; filename: string } {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || !decoded.mimeType.startsWith("audio/")) {
    throw new Error("unsupported audio payload");
  }
  const subtype = decoded.mimeType.split("/")[1]?.split(";")[0] || "ogg";
  return { bytes: decoded.bytes, mimeType: decoded.mimeType, filename: `voice.${subtype}` };
}

export function createTelegramImageSender(token: string): ImageSender {
  return async (chatId, dataUrl, caption) => {
    const image = toUpload(dataUrl);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), image.filename);
    if (caption) form.append("caption", caption.slice(0, 1000));
    const res = await fetch(`${TELEGRAM_API}${token}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Telegram sendPhoto failed (${res.status})`);
  };
}

export function createTelegramVoiceSender(token: string): VoiceSender {
  return async (chatId, dataUrl) => {
    const voice = toAudioUpload(dataUrl);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("voice", new Blob([new Uint8Array(voice.bytes)], { type: voice.mimeType }), voice.filename);
    const res = await fetch(`${TELEGRAM_API}${token}/sendVoice`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Telegram sendVoice failed (${res.status})`);
  };
}

export function createWhatsAppVoiceSender(token: string, phoneNumberId: string): VoiceSender {
  return async (chatId, dataUrl) => {
    const voice = toAudioUpload(dataUrl);

    const upload = new FormData();
    upload.append("messaging_product", "whatsapp");
    upload.append("type", voice.mimeType);
    upload.append("file", new Blob([new Uint8Array(voice.bytes)], { type: voice.mimeType }), voice.filename);
    const uploadRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upload,
    });
    if (!uploadRes.ok) throw new Error(`WhatsApp media upload failed (${uploadRes.status})`);
    const uploaded = (await uploadRes.json().catch(() => null)) as { id?: string } | null;
    if (!uploaded?.id) throw new Error("WhatsApp media upload returned no id");

    const sendRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: chatId,
        type: "audio",
        audio: { id: uploaded.id },
      }),
    });
    if (!sendRes.ok) throw new Error(`WhatsApp audio send failed (${sendRes.status})`);
  };
}

export function createWhatsAppImageSender(token: string, phoneNumberId: string): ImageSender {
  return async (chatId, dataUrl, caption) => {
    const image = toUpload(dataUrl);

    const upload = new FormData();
    upload.append("messaging_product", "whatsapp");
    upload.append("type", image.mimeType);
    upload.append("file", new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), image.filename);
    const uploadRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upload,
    });
    if (!uploadRes.ok) throw new Error(`WhatsApp media upload failed (${uploadRes.status})`);
    const uploaded = (await uploadRes.json().catch(() => null)) as { id?: string } | null;
    if (!uploaded?.id) throw new Error("WhatsApp media upload returned no id");

    const sendRes = await fetch(`${WHATSAPP_API}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: chatId,
        type: "image",
        image: { id: uploaded.id, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
      }),
    });
    if (!sendRes.ok) throw new Error(`WhatsApp image send failed (${sendRes.status})`);
  };
}
