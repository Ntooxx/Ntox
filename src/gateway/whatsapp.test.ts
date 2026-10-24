import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { createWhatsAppChannel } from "./whatsapp.js";
import { MEDIA_DIR } from "../core/media.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installGraphMock(): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const realFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    calls.push({ url, init });
    if (url.endsWith("/PN1/messages")) return jsonResponse({ success: true });
    if (url.endsWith("/PN1/media")) return jsonResponse({ id: "UP_MEDIA" });
    if (url.endsWith("/PN1")) return jsonResponse({ display_phone_number: "+15550001111" });
    if (url === "https://graph.facebook.com/media/MEDIA1") {
      return new Response(new Uint8Array([7, 7, 7, 7]), { status: 200 });
    }
    if (url.endsWith("/MEDIA1")) {
      return jsonResponse({ url: "https://graph.facebook.com/media/MEDIA1", mime_type: "audio/ogg; codecs=opus" });
    }
    if (url === "https://graph.facebook.com/media/IMAGE1") {
      return new Response(new Uint8Array([9, 9, 9, 9]), { status: 200 });
    }
    if (url.endsWith("/IMG1")) {
      return jsonResponse({ url: "https://graph.facebook.com/media/IMAGE1", mime_type: "image/png" });
    }
    return jsonResponse({ success: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

function webhookPayload(messages: unknown[]): unknown {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PN1" },
              contacts: [{ wa_id: "15551234567", profile: { name: "Antonio" } }],
              messages,
            },
          },
        ],
      },
    ],
  };
}

function messageBodies(calls: RecordedCall[]): Record<string, unknown>[] {
  return calls
    .filter((c) => c.url.endsWith("/PN1/messages"))
    .map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);
}

async function postWebhook(port: number, payload: unknown): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whatsapp voice pipeline", () => {
  it("transcribes voice notes, runs the agent, and replies with a voice note", async () => {
    const { calls } = installGraphMock();
    const transcribe = vi.fn(async (_audio: string, _mimeType: string) => "send the daily report");
    const onMessage = vi.fn(async () => "Report sent. All systems green.");
    const synthesize = vi.fn(async (_text: string) => "data:audio/ogg;base64,QUJD");

    const port = 34601;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
      transcribe,
      synthesize,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([{ id: "wamid1", from: "15551234567", type: "audio", audio: { id: "MEDIA1" } }]),
      );

      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][1]).toBe("audio/ogg; codecs=opus");
      expect(onMessage).toHaveBeenCalledWith("15551234567", "send the daily report", "Antonio");

      const bodies = messageBodies(calls);
      const read = bodies.find((b) => b.status === "read");
      expect(read).toBeDefined();
      expect((read as { typing_indicator?: { type: string } }).typing_indicator?.type).toBe("text");

      const textMsg = bodies.find((b) => b.type === "text");
      expect(JSON.stringify(textMsg)).toContain("Report sent");

      const audioMsg = bodies.find((b) => b.type === "audio");
      expect(audioMsg).toBeDefined();
      expect((audioMsg as { audio?: { id?: string } }).audio?.id).toBe("UP_MEDIA");

      expect(calls.some((c) => c.url.endsWith("/PN1/media"))).toBe(true);
      const upload = calls.find((c) => c.url.endsWith("/PN1/media"));
      const form = upload!.init?.body as FormData;
      expect(form.get("file")).toBeTruthy();
      expect(form.get("type")).toContain("audio");
    } finally {
      await channel.stop();
    }
  });

  it("handles text messages and captions as before", async () => {
    const { calls } = installGraphMock();
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "Text reply.");
    const port = 34602;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([
          { id: "wamid2", from: "15551234567", type: "text", text: { body: "hello there" } },
          { id: "wamid3", from: "15551234567", type: "image", image: { id: "IMG1", caption: "look at this" } },
        ]),
      );
      expect(onMessage).toHaveBeenCalledTimes(2);
      expect(onMessage).toHaveBeenNthCalledWith(1, "15551234567", "hello there", "Antonio");
      const imageText = String(onMessage.mock.calls[1][1]);
      expect(imageText).toContain("look at this");
      expect(imageText).toContain("[Attached image:");
      rmSync(imageText.split("[Attached image: ")[1].split(" ")[0], { force: true });
      const bodies = messageBodies(calls);
      expect(bodies.filter((b) => b.type === "text")).toHaveLength(2);
      expect(bodies.some((b) => b.status === "read")).toBe(true);
    } finally {
      await channel.stop();
    }
  });

  it("reports transcription failures without calling the agent", async () => {
    const { calls } = installGraphMock();
    const onMessage = vi.fn(async () => "should not run");
    const port = 34603;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
      transcribe: async () => null,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([{ id: "wamid4", from: "15551234567", type: "audio", audio: { id: "MEDIA1" } }]),
      );
      expect(onMessage).not.toHaveBeenCalled();
      const bodies = messageBodies(calls);
      expect(JSON.stringify(bodies)).toContain("Couldn't transcribe");
    } finally {
      await channel.stop();
    }
  });

  it("keeps the legacy placeholder when no transcriber is configured", async () => {
    installGraphMock();
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "ok");
    const port = 34604;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([{ id: "wamid5", from: "15551234567", type: "audio", audio: { id: "MEDIA1" } }]),
      );
      expect(onMessage).toHaveBeenCalledWith("15551234567", "[audio message]", "Antonio");
    } finally {
      await channel.stop();
    }
  });
});

describe("whatsapp interactive approvals", () => {
  it("sends approval requests as interactive reply buttons", async () => {
    const { calls } = installGraphMock();
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port: 34605,
      onMessage: async () => "ok",
    });
    await channel.start();
    try {
      expect(channel.sendApprovalRequest).toBeDefined();
      await channel.sendApprovalRequest!("15551234567", "git push origin main");

      const interactive = calls
        .filter((c) => c.url.endsWith("/PN1/messages"))
        .map(
          (c) =>
            JSON.parse(String(c.init?.body)) as {
              type: string;
              interactive?: {
                type: string;
                body?: { text?: string };
                action?: { buttons?: Array<{ type: string; reply: { id: string; title: string } }> };
              };
            },
        )
        .find((b) => b.type === "interactive");
      expect(interactive).toBeDefined();
      expect(interactive!.interactive?.type).toBe("button");
      expect(interactive!.interactive?.body?.text).toContain("Approval required: git push origin main");
      const buttons = interactive!.interactive?.action?.buttons || [];
      expect(buttons.map((b) => b.reply.id)).toEqual(["approve:once", "approve:always", "approve:deny"]);
      expect(buttons.map((b) => b.reply.title)).toEqual(["Allow once", "Always allow", "Deny"]);
    } finally {
      await channel.stop();
    }
  });

  it("maps button replies to approve commands through the normal pipeline", async () => {
    const { calls } = installGraphMock();
    const onMessage = vi.fn(async () => "Denied: git push");
    const port = 34606;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([
          {
            id: "wamid6",
            from: "15551234567",
            type: "interactive",
            interactive: { button_reply: { id: "approve:deny", title: "Deny" } },
          },
        ]),
      );
      expect(onMessage).toHaveBeenCalledWith("15551234567", "/approve deny", "Antonio");
      const bodies = messageBodies(calls);
      expect(JSON.stringify(bodies)).toContain("Denied: git push");
    } finally {
      await channel.stop();
    }
  });
});

describe("whatsapp image pipeline", () => {
  it("saves an image attachment and hands the agent a captioned note", async () => {
    const { calls } = installGraphMock();
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "It's a bar chart.");
    const port = 34611;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([
          {
            id: "wamid-img",
            from: "15551234567",
            type: "image",
            image: { id: "IMG1", caption: "what does this show?" },
          },
        ]),
      );

      expect(onMessage).toHaveBeenCalledTimes(1);
      const text = String(onMessage.mock.calls[0][1]);
      expect(text).toContain("what does this show?");
      expect(text).toContain("[Attached image:");
      expect(text).toContain("image tool");
      const savedPath = text.split("[Attached image: ")[1].split(" ")[0];
      expect(savedPath.startsWith(MEDIA_DIR)).toBe(true);
      expect(savedPath.endsWith(".png")).toBe(true);
      expect(existsSync(savedPath)).toBe(true);
      rmSync(savedPath, { force: true });
      expect(calls.some((c) => c.url.endsWith("/IMG1"))).toBe(true);
    } finally {
      await channel.stop();
    }
  });

  it("downloads image documents and leaves other documents as placeholders", async () => {
    const { calls } = installGraphMock();
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "ok");
    const port = 34612;
    const channel = createWhatsAppChannel({
      token: "TEST",
      phoneNumberId: "PN1",
      verifyToken: "VT",
      port,
      onMessage,
    });
    await channel.start();
    try {
      await postWebhook(
        port,
        webhookPayload([
          {
            id: "wamid-doc",
            from: "15551234567",
            type: "document",
            document: { id: "DOC1", filename: "report.pdf", mime_type: "application/pdf" },
          },
          {
            id: "wamid-shot",
            from: "15551234567",
            type: "document",
            document: { id: "IMG1", filename: "shot.png", mime_type: "image/png" },
          },
        ]),
      );

      expect(onMessage).toHaveBeenCalledTimes(2);
      expect(onMessage.mock.calls[0][1]).toBe("[document: report.pdf]");
      const imageText = String(onMessage.mock.calls[1][1]);
      expect(imageText).toContain("[Attached image:");
      const savedPath = imageText.split("[Attached image: ")[1].split(" ")[0];
      expect(savedPath.endsWith(".png")).toBe(true);
      expect(existsSync(savedPath)).toBe(true);
      rmSync(savedPath, { force: true });
      expect(calls.some((c) => c.url.endsWith("/DOC1"))).toBe(false);
    } finally {
      await channel.stop();
    }
  });
});
