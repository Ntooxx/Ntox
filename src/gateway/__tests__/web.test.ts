import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebChannel } from "../web.js";
import { ConversationStore } from "../conversations.js";

const tmp = mkdtempSync(join(tmpdir(), "ntox-web-test-"));
const convPath = join(tmp, "conversations.json");

afterEach(() => {
  if (existsSync(convPath)) unlinkSync(convPath);
});

describe("createWebChannel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "setTimeout",
      vi.fn((fn) => fn()),
    );
  });

  it("has the correct name", () => {
    const channel = createWebChannel({ onMessage: async () => "ok", conversations: new ConversationStore(convPath) });
    expect(channel.name).toBe("web");
  });

  it("notifyTyping is a no-op", async () => {
    const channel = createWebChannel({ onMessage: async () => "ok", conversations: new ConversationStore(convPath) });
    await expect(channel.notifyTyping("test")).resolves.toBeUndefined();
  });
});

describe("createWebChannel auth", () => {
  it("rejects requests without a token when authToken is set", async () => {
    vi.unstubAllGlobals();
    const channel = createWebChannel({
      authToken: "secret123",
      port: 3987,
      host: "127.0.0.1",
      onMessage: async () => "ok",
      conversations: new ConversationStore(convPath),
      getStatus: () => ({ model: "test" }),
    });
    await channel.start();
    try {
      const denied = await fetch("http://127.0.0.1:3987/status.json");
      expect(denied.status).toBe(401);

      const allowed = await fetch("http://127.0.0.1:3987/status.json", {
        headers: { Authorization: "Bearer secret123" },
      });
      expect(allowed.status).toBe(200);

      const wrongToken = await fetch("http://127.0.0.1:3987/status.json", {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(wrongToken.status).toBe(401);
    } finally {
      await channel.stop();
    }
  });

  it("allows requests without a token when no authToken is set", async () => {
    vi.unstubAllGlobals();
    const channel = createWebChannel({
      port: 3988,
      host: "127.0.0.1",
      onMessage: async () => "ok",
      conversations: new ConversationStore(convPath),
      getStatus: () => ({ model: "test" }),
    });
    await channel.start();
    try {
      const res = await fetch("http://127.0.0.1:3988/status.json");
      expect(res.status).toBe(200);
    } finally {
      await channel.stop();
    }
  });
});

describe("createWebChannel static assets", () => {
  it("serves app.css and app.js alongside index.html", async () => {
    vi.unstubAllGlobals();
    const channel = createWebChannel({
      port: 3989,
      host: "127.0.0.1",
      onMessage: async () => "ok",
      conversations: new ConversationStore(convPath),
    });
    await channel.start();
    try {
      const html = await fetch("http://127.0.0.1:3989/");
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toContain("text/html");

      const css = await fetch("http://127.0.0.1:3989/app.css");
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toContain("text/css");

      const js = await fetch("http://127.0.0.1:3989/app.js");
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toContain("javascript");
    } finally {
      await channel.stop();
    }
  });

  it("serves PWA assets with the right content types", async () => {
    vi.unstubAllGlobals();
    const channel = createWebChannel({
      port: 3991,
      host: "127.0.0.1",
      onMessage: async () => "ok",
      conversations: new ConversationStore(convPath),
    });
    await channel.start();
    try {
      const manifest = await fetch("http://127.0.0.1:3991/manifest.webmanifest");
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get("content-type")).toContain("manifest+json");
      const parsed = (await manifest.json()) as { name: string; icons: { src: string }[] };
      expect(parsed.name).toContain("NTOX");
      expect(parsed.icons.length).toBeGreaterThan(0);

      const sw = await fetch("http://127.0.0.1:3991/sw.js");
      expect(sw.status).toBe(200);
      expect(sw.headers.get("content-type")).toContain("javascript");
      expect(await sw.text()).toContain("CACHE_NAME");

      const icon = await fetch("http://127.0.0.1:3991/icons/icon-192.png");
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toContain("image/png");
      const bytes = new Uint8Array(await icon.arrayBuffer());
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

      const svg = await fetch("http://127.0.0.1:3991/icons/icon.svg");
      expect(svg.status).toBe(200);
      expect(svg.headers.get("content-type")).toContain("image/svg+xml");
    } finally {
      await channel.stop();
    }
  });

  it("rejects path traversal in static serving", async () => {
    vi.unstubAllGlobals();
    const channel = createWebChannel({
      port: 3990,
      host: "127.0.0.1",
      onMessage: async () => "ok",
      conversations: new ConversationStore(convPath),
    });
    await channel.start();
    try {
      const res = await fetch("http://127.0.0.1:3990/..%2f..%2fpackage.json");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
      expect(body).not.toContain('"name": "ntox"');
    } finally {
      await channel.stop();
    }
  });
});
