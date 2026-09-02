import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDiscordChannel } from "../discord.js";

describe("createDiscordChannel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  const mockHeaders = (remaining = "99", reset = "0") => ({ get: (k: string) => k === "x-ratelimit-remaining" ? remaining : k === "x-ratelimit-reset" ? reset : null });

  it("validates token on start", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, headers: mockHeaders(), json: async () => ({ id: "123", username: "ntox" }) });
    const channel = createDiscordChannel({ token: "test.token", onMessage: async () => "ok" });
    await channel.start();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/users/@me"), expect.anything());
    await channel.stop();
  });

  it("rejects invalid token on start", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: mockHeaders() });
    const channel = createDiscordChannel({ token: "bad.token", onMessage: async () => "ok" });
    await expect(channel.start()).rejects.toThrow("invalid");
  });

  it("notifyTyping sends typing indicator", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const channel = createDiscordChannel({ token: "test.token", onMessage: async () => "ok" });
    await channel.notifyTyping("12345");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/channels/12345/typing"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("has the correct name", () => {
    const channel = createDiscordChannel({ token: "test.token", onMessage: async () => "ok" });
    expect(channel.name).toBe("discord");
  });
});