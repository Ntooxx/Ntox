import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createWhatsAppChannel, verifyWhatsAppSignature } from "../whatsapp.js";

describe("verifyWhatsAppSignature", () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ entry: [] });

  it("accepts a valid sha256 signature", () => {
    const mac = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWhatsAppSignature(body, `sha256=${mac}`, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyWhatsAppSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });

  it("rejects a missing signature when secret is configured", () => {
    expect(verifyWhatsAppSignature(body, undefined, secret)).toBe(false);
  });

  it("skips verification when no app secret is configured", () => {
    expect(verifyWhatsAppSignature(body, undefined, "")).toBe(true);
  });
});

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
