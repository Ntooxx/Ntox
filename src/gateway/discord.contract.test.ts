import { describe, expect, it, vi, beforeEach } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => void>();

vi.mock("ws", () => ({
  WebSocket: class {
    static OPEN = 1;
    readyState = 1;
    on(event: string, callback: (...args: unknown[]) => void): void {
      handlers.set(event, callback);
    }
    send(): void {}
    close(): void {}
  },
}));

import { createDiscordChannel } from "./discord.js";

function emit(payload: unknown): void {
  const handler = handlers.get("message");
  if (!handler) throw new Error("no message handler registered");
  handler(Buffer.from(JSON.stringify(payload)));
}

function message(overrides: Record<string, unknown> = {}): unknown {
  return {
    op: 0,
    t: "MESSAGE_CREATE",
    d: {
      id: "m1",
      content: "hello",
      channel_id: "c1",
      author: { id: "u1", username: "user" },
      ...overrides,
    },
  };
}

describe("Discord surface contract", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers.clear();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ id: "bot1", username: "ntox" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("connects, validates the token, and dispatches DM messages", async () => {
    const seen: string[] = [];
    const channel = createDiscordChannel({
      token: "t",
      onMessage: async (_chatId, text) => {
        seen.push(text);
        return "reply";
      },
    });
    await channel.start();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/users/@me"), expect.anything());
    expect(handlers.has("message")).toBe(true);

    emit(message());
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/channels/c1/messages"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "reply" }) }),
      ),
    );
    expect(seen).toEqual(["hello"]);
    await channel.stop();
  });

  it("replies with an error message when the handler throws", async () => {
    const channel = createDiscordChannel({
      token: "t",
      onMessage: async () => {
        throw new Error("boom");
      },
    });
    await channel.start();
    emit(message());
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/channels/c1/messages"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "Error: boom" }) }),
      ),
    );
    await channel.stop();
  });

  it("ignores guild messages without a bot mention and answers mentioned ones", async () => {
    const seen: string[] = [];
    const channel = createDiscordChannel({
      token: "t",
      onMessage: async (_chatId, text) => {
        seen.push(text);
        return "ok";
      },
    });
    await channel.start();
    emit({ op: 0, t: "READY", d: { session_id: "s", user: { id: "bot1", username: "ntox" } } });

    emit(message({ guild_id: "g1", mentions: [] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);

    emit(message({ guild_id: "g1", mentions: [{ id: "bot1" }], content: "<@bot1> please help" }));
    await vi.waitFor(() => expect(seen).toEqual(["please help"]));
    await channel.stop();
  });

  it("uses the normal message path for approvals (no in-channel approval UI)", async () => {
    const channel = createDiscordChannel({ token: "t", onMessage: async () => "approve with /approve in the CLI" });
    await channel.start();
    emit(message({ content: "approve the deploy" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/channels/c1/messages"),
        expect.objectContaining({ body: JSON.stringify({ content: "approve with /approve in the CLI" }) }),
      ),
    );
    expect(fetchMock.mock.calls.some((call: unknown[]) => String(call[0]).includes("interactions"))).toBe(false);
    await channel.stop();
  });
});
