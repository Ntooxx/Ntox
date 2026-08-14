import { describe, expect, it, vi, beforeEach } from "vitest";
import { createWhatsAppChannel } from "../whatsapp.js";

describe("createWhatsAppChannel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("validates token on start", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ display_phone_number: "+1234567890" }) });
    const channel = createWhatsAppChannel({
      token: "test-token",
      phoneNumberId: "12345",
      verifyToken: "verify123",
      port: 3002,
      onMessage: async () => "ok",
    });
    await channel.start();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("12345"), expect.any(Object));
    await channel.stop();
  });

  it("rejects invalid token on start", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" });
    const channel = createWhatsAppChannel({
      token: "bad-token",
      phoneNumberId: "12345",
      verifyToken: "verify123",
      port: 3002,
      onMessage: async () => "ok",
    });
    await expect(channel.start()).rejects.toThrow("invalid");
  });

  it("notifyTyping is a no-op for WhatsApp", async () => {
    const channel = createWhatsAppChannel({
      token: "test-token",
      phoneNumberId: "12345",
      verifyToken: "verify123",
      port: 3002,
      onMessage: async () => "ok",
    });
    await expect(channel.notifyTyping("12345")).resolves.toBeUndefined();
  });

  it("has the correct name", () => {
    const channel = createWhatsAppChannel({
      token: "test-token",
      phoneNumberId: "12345",
      verifyToken: "verify123",
      port: 3002,
      onMessage: async () => "ok",
    });
    expect(channel.name).toBe("whatsapp");
  });
});