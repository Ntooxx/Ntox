import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { createTelegramChannel } from "./telegram.js";
import { setVoiceMode } from "./voice-mode.js";
import { MEDIA_DIR } from "../core/media.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

interface MockSetup {
  firstUpdates: unknown[];
  transcript?: string | null;
  filePath?: string;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(setup: MockSetup): { calls: RecordedCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: RecordedCall[] = [];
  let updatesServed = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/getMe")) return jsonResponse({ ok: true, result: { username: "testbot" } });
    if (url.includes("/getUpdates")) {
      const payload = updatesServed === 0 ? setup.firstUpdates : [];
      updatesServed++;
      return jsonResponse({ ok: true, result: payload });
    }
    if (url.includes("/getFile"))
      return jsonResponse({ ok: true, result: { file_path: setup.filePath ?? "voice/file_1.oga" } });
    if (url.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    if (url.includes("/sendMessage")) return jsonResponse({ ok: true, result: {} });
    if (url.includes("/sendVoice")) return jsonResponse({ ok: true, result: {} });
    return jsonResponse({ ok: true, result: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function sentMessages(calls: RecordedCall[]): string[] {
  return calls.filter((c) => c.url.includes("/sendMessage")).map((c) => String(JSON.parse(String(c.init?.body)).text));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram voice pipeline", () => {
  it("transcribes voice notes, runs the agent, and replies with a voice note (auto)", async () => {
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 1,
          message: {
            message_id: 10,
            chat: { id: 555, type: "private" },
            from: { username: "anton" },
            voice: { file_id: "AAA", mime_type: "audio/ogg" },
          },
        },
      ],
    });
    const transcribe = vi.fn(async (_audio: string, _mimeType: string) => "what's the plan today");
    const onMessage = vi.fn(async () => "**Plan:** ship the voice feature.");
    const synthesize = vi.fn(async (_text: string) => "data:audio/ogg;base64,AQIDBA==");

    const channel = createTelegramChannel({
      token: "TESTTOKEN",
      onMessage,
      transcribe,
      synthesize,
    });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendMessage")));
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(transcribe.mock.calls[0][1]).toBe("audio/ogg");
      expect(onMessage).toHaveBeenCalledWith("555", "what's the plan today", "anton");
      expect(synthesize).toHaveBeenCalledTimes(1);
      expect(String(synthesize.mock.calls[0][0])).toContain("Plan");
      expect(String(synthesize.mock.calls[0][0])).not.toContain("*");
      const voiceCall = calls.find((c) => c.url.includes("/sendVoice"));
      expect(voiceCall).toBeDefined();
      const form = voiceCall!.init?.body as FormData;
      expect(form.get("chat_id")).toBe("555");
      expect(form.get("voice")).toBeTruthy();
      expect(sentMessages(calls).some((t) => t.includes("ship the voice feature"))).toBe(true);
    } finally {
      await channel.stop();
    }
  });

  it("does not speak text replies in auto mode", async () => {
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 2,
          message: { message_id: 11, chat: { id: 600, type: "private" }, from: { username: "anton" }, text: "hello" },
        },
      ],
    });
    const synthesize = vi.fn(async (_text: string) => "data:audio/ogg;base64,AAAA");
    const channel = createTelegramChannel({
      token: "TESTTOKEN",
      onMessage: async () => "Hi there.",
      synthesize,
    });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendMessage")));
      expect(synthesize).not.toHaveBeenCalled();
      expect(calls.some((c) => c.url.includes("/sendVoice"))).toBe(false);
    } finally {
      await channel.stop();
    }
  });

  it("speaks text replies when voice mode is on", async () => {
    setVoiceMode("telegram", "777", "on");
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 3,
          message: {
            message_id: 12,
            chat: { id: 777, type: "private" },
            from: { username: "anton" },
            text: "status report",
          },
        },
      ],
    });
    const synthesize = vi.fn(async (_text: string) => "data:audio/ogg;base64,BBBB");
    const channel = createTelegramChannel({
      token: "TESTTOKEN",
      onMessage: async () => "All systems nominal.",
      synthesize,
    });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendVoice")));
      expect(synthesize).toHaveBeenCalledTimes(1);
      expect(String(synthesize.mock.calls[0][0])).toContain("All systems nominal");
    } finally {
      await channel.stop();
    }
  });

  it("stays silent on voice when voice mode is off", async () => {
    setVoiceMode("telegram", "888", "off");
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 4,
          message: {
            message_id: 13,
            chat: { id: 888, type: "private" },
            from: { username: "anton" },
            voice: { file_id: "BBB", mime_type: "audio/ogg" },
          },
        },
      ],
    });
    const synthesize = vi.fn(async (_text: string) => "data:audio/ogg;base64,CCCC");
    const onMessage = vi.fn(async () => "Answer text.");
    const channel = createTelegramChannel({
      token: "TESTTOKEN",
      onMessage,
      synthesize,
      transcribe: async () => "hello?",
    });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendMessage")));
      expect(onMessage).toHaveBeenCalled();
      expect(synthesize).not.toHaveBeenCalled();
      expect(calls.some((c) => c.url.includes("/sendVoice"))).toBe(false);
    } finally {
      await channel.stop();
    }
  });

  it("reports transcription failures without calling the agent", async () => {
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 5,
          message: {
            message_id: 14,
            chat: { id: 900, type: "private" },
            from: { username: "anton" },
            voice: { file_id: "CCC", mime_type: "audio/ogg" },
          },
        },
      ],
      transcript: null,
    });
    const onMessage = vi.fn(async () => "should not run");
    const channel = createTelegramChannel({
      token: "TESTTOKEN",
      onMessage,
      transcribe: async () => null,
    });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendMessage")));
      expect(onMessage).not.toHaveBeenCalled();
      expect(sentMessages(calls).some((t) => t.includes("Couldn't transcribe"))).toBe(true);
    } finally {
      await channel.stop();
    }
  });
});

describe("telegram interactive approvals", () => {
  it("sends approval requests with an inline keyboard of four scopes", async () => {
    const { calls } = installFetch({ firstUpdates: [] });
    const channel = createTelegramChannel({ token: "TESTTOKEN", onMessage: async () => "ok" });
    await channel.start();
    try {
      expect(channel.sendApprovalRequest).toBeDefined();
      await channel.sendApprovalRequest!("555", "git push origin main");

      const approval = calls.find((c) => c.url.includes("/sendMessage"));
      expect(approval).toBeDefined();
      const body = JSON.parse(String(approval!.init?.body)) as {
        text: string;
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
      };
      expect(body.text).toContain("Approval required: git push origin main");
      const buttons = body.reply_markup?.inline_keyboard[0] || [];
      expect(buttons.map((b) => b.callback_data)).toEqual([
        "approve:once",
        "approve:session",
        "approve:always",
        "approve:deny",
      ]);
    } finally {
      await channel.stop();
    }
  });

  it("resolves approval button taps through the approve command and clears the keyboard", async () => {
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 10,
          callback_query: {
            id: "cb1",
            from: { username: "anton" },
            message: { message_id: 55, chat: { id: 555, type: "private" } },
            data: "approve:once",
          },
        },
      ],
    });
    const onMessage = vi.fn(async () => "Approved (once): git push");
    const channel = createTelegramChannel({ token: "TESTTOKEN", onMessage });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/editMessageReplyMarkup")));
      expect(onMessage).toHaveBeenCalledWith("555", "/approve once", "anton");
      expect(sentMessages(calls).some((t) => t.includes("Approved (once)"))).toBe(true);
      expect(calls.some((c) => c.url.includes("/answerCallbackQuery"))).toBe(true);
      const edit = calls.find((c) => c.url.includes("/editMessageReplyMarkup"));
      const editBody = JSON.parse(String(edit!.init?.body)) as { chat_id: number; message_id: number };
      expect(editBody.chat_id).toBe(555);
      expect(editBody.message_id).toBe(55);
    } finally {
      await channel.stop();
    }
  });

  it("ignores unknown callback payloads but still acknowledges them", async () => {
    const { calls } = installFetch({
      firstUpdates: [
        {
          update_id: 11,
          callback_query: {
            id: "cb2",
            message: { message_id: 56, chat: { id: 555, type: "private" } },
            data: "approve:bogus",
          },
        },
      ],
    });
    const onMessage = vi.fn(async () => "should not run");
    const channel = createTelegramChannel({ token: "TESTTOKEN", onMessage });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/answerCallbackQuery")));
      expect(onMessage).not.toHaveBeenCalled();
      expect(sentMessages(calls)).toHaveLength(0);
    } finally {
      await channel.stop();
    }
  });
});

describe("telegram image pipeline", () => {
  it("downloads the largest photo size and hands the agent an image note", async () => {
    const { calls } = installFetch({
      filePath: "photos/file_9.jpg",
      firstUpdates: [
        {
          update_id: 7,
          message: {
            message_id: 70,
            chat: { id: 777, type: "private" },
            from: { username: "anton" },
            caption: "what am I looking at?",
            photo: [{ file_id: "SMALL" }, { file_id: "BIG" }],
          },
        },
      ],
    });
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "It's a revenue chart.");
    const channel = createTelegramChannel({ token: "TESTTOKEN", onMessage });
    await channel.start();
    try {
      await waitFor(() => calls.some((c) => c.url.includes("/sendMessage")));

      expect(onMessage).toHaveBeenCalledTimes(1);
      const text = String(onMessage.mock.calls[0][1]);
      expect(text).toContain("what am I looking at?");
      expect(text).toContain("[Attached image:");
      expect(text).toContain("image tool");
      const savedPath = text.split("[Attached image: ")[1].split(" ")[0];
      expect(savedPath.startsWith(MEDIA_DIR)).toBe(true);
      expect(savedPath.endsWith(".jpg")).toBe(true);
      expect(existsSync(savedPath)).toBe(true);
      rmSync(savedPath, { force: true });

      const getFileCall = calls.find((c) => c.url.includes("/getFile"));
      expect(String(JSON.parse(String(getFileCall!.init?.body)).file_id)).toBe("BIG");
      expect(sentMessages(calls).some((t) => t.includes("revenue chart"))).toBe(true);
    } finally {
      await channel.stop();
    }
  });

  it("handles image documents and ignores non-image documents", async () => {
    const { calls } = installFetch({
      filePath: "documents/file_3.png",
      firstUpdates: [
        {
          update_id: 8,
          message: {
            message_id: 81,
            chat: { id: 778, type: "private" },
            from: { username: "anton" },
            caption: "screenshot attached",
            document: { file_id: "DOC_IMG", mime_type: "image/png", file_name: "screenshot.png" },
          },
        },
        {
          update_id: 9,
          message: {
            message_id: 82,
            chat: { id: 778, type: "private" },
            from: { username: "anton" },
            document: { file_id: "DOC_PDF", mime_type: "application/pdf", file_name: "report.pdf" },
          },
        },
      ],
    });
    const onMessage = vi.fn(async (_chatId: string, _text: string, _username: string) => "ok");
    const channel = createTelegramChannel({ token: "TESTTOKEN", onMessage });
    await channel.start();
    try {
      await waitFor(() => onMessage.mock.calls.length >= 1 && sentMessages(calls).length >= 1);

      expect(onMessage).toHaveBeenCalledTimes(1);
      const text = String(onMessage.mock.calls[0][1]);
      expect(text).toContain("screenshot attached");
      expect(text).toContain("[Attached image:");
      const savedPath = text.split("[Attached image: ")[1].split(" ")[0];
      expect(savedPath.endsWith(".png")).toBe(true);
      expect(existsSync(savedPath)).toBe(true);
      rmSync(savedPath, { force: true });

      const requestedIds = calls
        .filter((c) => c.url.includes("/getFile"))
        .map((c) => String(JSON.parse(String(c.init?.body)).file_id));
      expect(requestedIds).toContain("DOC_IMG");
      expect(requestedIds).not.toContain("DOC_PDF");
    } finally {
      await channel.stop();
    }
  });
});
