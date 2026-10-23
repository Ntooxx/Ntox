import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { ttsTool } from "./voice.js";

function writeConfig(apiKey: string): void {
  const dir = process.env.NTOX_DIR!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ apiKey }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ttsTool formats", () => {
  it("defaults to mp3", async () => {
    writeConfig("test-key");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await ttsTool.execute({ text: "hello" });
    expect(r.success).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toBe("mp3");
    const data = r.data as { audio: string; format: string };
    expect(data.audio.startsWith("data:audio/mpeg;base64,")).toBe(true);
    expect(data.format).toBe("mp3");
  });

  it("emits ogg/opus when format is opus", async () => {
    writeConfig("test-key");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([9, 9]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await ttsTool.execute({ text: "hello", format: "opus" });
    expect(r.success).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toBe("opus");
    const data = r.data as { audio: string; format: string };
    expect(data.audio.startsWith("data:audio/ogg;base64,")).toBe(true);
    expect(data.format).toBe("opus");
  });

  it("falls back to mp3 for unknown formats", async () => {
    writeConfig("test-key");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await ttsTool.execute({ text: "hello", format: "hologram" });
    expect(r.success).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toBe("mp3");
  });

  it("fails without an api key", async () => {
    writeConfig("");
    const r = await ttsTool.execute({ text: "hello" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("No API key");
  });
});
