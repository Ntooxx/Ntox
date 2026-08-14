import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTelegramChannel } from "../telegram.js";

describe("createTelegramChannel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("validates token on start", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { username: "ntox_bot" } }) });
    const channel = createTelegramChannel({ token: "test:token", onMessage: async () => "ok" });
    await channel.start();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("getMe"), expect.anything());
    await channel.stop();
  });

  it("rejects invalid token on start", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" });
    const channel = createTelegramChannel({ token: "bad:token", onMessage: async () => "ok" });
    await expect(channel.start()).rejects.toThrow("invalid");
  });

  it("notifyTyping calls sendChatAction", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const channel = createTelegramChannel({ token: "test:token", onMessage: async () => "ok" });
    await channel.notifyTyping("12345");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("sendChatAction"),
      expect.objectContaining({
        body: expect.stringContaining("typing"),
      })
    );
  });

  it("has the correct name", () => {
    const channel = createTelegramChannel({ token: "test:token", onMessage: async () => "ok" });
    expect(channel.name).toBe("telegram");
  });
});