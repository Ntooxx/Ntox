import { describe, expect, it, vi, beforeEach } from "vitest";
import { createWebChannel } from "../web.js";

describe("createWebChannel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "setTimeout",
      vi.fn((fn) => fn()),
    );
  });

  it("has the correct name", () => {
    const channel = createWebChannel({ onMessage: async () => "ok" });
    expect(channel.name).toBe("web");
  });

  it("notifyTyping is a no-op", async () => {
    const channel = createWebChannel({ onMessage: async () => "ok" });
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
