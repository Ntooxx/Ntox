import { describe, expect, it, vi, beforeEach } from "vitest";
import { createWebChannel } from "../web.js";

describe("createWebChannel", () => {
  beforeEach(() => {
    vi.stubGlobal("setTimeout", vi.fn((fn) => fn()));
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