import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlackChannel, resolveSlackConfig, type SlackSocket } from "./slack.js";

class FakeSocket extends EventEmitter implements SlackSocket {
  sent: string[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

interface SlackTestSetup {
  socket: FakeSocket;
  urls: string[];
  posts: Array<{ channel: string; text: string }>;
  calls: string[];
}

function stubSlackApi(options: { authOk?: boolean } = {}): SlackTestSetup {
  const setup: SlackTestSetup = { socket: new FakeSocket(), urls: [], posts: [], calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      setup.calls.push(url.split("/").slice(-1)[0]);
      if (url.endsWith("/auth.test")) {
        return Response.json(
          options.authOk === false
            ? { ok: false, error: "invalid_auth" }
            : { ok: true, user_id: "UBOT", user: "ntoxbot" },
        );
      }
      if (url.endsWith("/apps.connection.open")) {
        setup.urls.push("wss://slack.test/socket");
        return Response.json({ ok: true, url: "wss://slack.test/socket" });
      }
      if (url.endsWith("/chat.postMessage")) {
        const body = JSON.parse(String(init?.body)) as { channel: string; text: string };
        setup.posts.push(body);
        return Response.json({ ok: true, ts: "123.456" });
      }
      return Response.json({ ok: false, error: "unknown_method" });
    }),
  );
  return setup;
}

function envelope(event: Record<string, unknown>): Record<string, unknown> {
  return { type: "events_api", envelope_id: "env_1", payload: { type: "event", event } };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeChannel(setup: SlackTestSetup, onMessage: (c: string, t: string, u: string) => Promise<string>) {
  return createSlackChannel({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    onMessage,
    connectSocket: () => setup.socket,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("resolveSlackConfig", () => {
  it("returns null until both tokens exist", () => {
    expect(resolveSlackConfig({})).toBeNull();
    expect(resolveSlackConfig({ slack: { botToken: "xoxb-only" } })).toBeNull();
    expect(resolveSlackConfig({ slack: { appToken: "xapp-only" } })).toBeNull();
  });

  it("reads the slack block, the flat legacy keys, and env overrides", () => {
    expect(
      resolveSlackConfig({ slack: { botToken: "xoxb-1", appToken: "xapp-1", allowedUsers: ["U1", "U2"] } }),
    ).toEqual({ botToken: "xoxb-1", appToken: "xapp-1", allowedUsers: ["U1", "U2"] });

    expect(resolveSlackConfig({ slackToken: "xoxb-2", slackAppToken: "xapp-2" })).toMatchObject({
      botToken: "xoxb-2",
      appToken: "xapp-2",
    });

    vi.stubEnv("NTOX_SLACK_BOT_TOKEN", "xoxb-env");
    vi.stubEnv("NTOX_SLACK_APP_TOKEN", "xapp-env");
    vi.stubEnv("NTOX_SLACK_ALLOWED_USERS", "U9,U10");
    expect(resolveSlackConfig({ slack: { botToken: "ignored", appToken: "ignored" } })).toEqual({
      botToken: "xoxb-env",
      appToken: "xapp-env",
      allowedUsers: ["U9", "U10"],
    });
  });

  it("accepts a comma-separated allowlist in config", () => {
    expect(
      resolveSlackConfig({ slack: { botToken: "xoxb", appToken: "xapp", allowedUsers: "U1, U2" } })?.allowedUsers,
    ).toEqual(["U1", "U2"]);
  });
});

describe("createSlackChannel", () => {
  it("validates the bot token and opens a socket-mode connection", async () => {
    const setup = stubSlackApi();
    const channel = makeChannel(setup, async () => "ok");

    await channel.start();

    expect(setup.calls.slice(0, 2)).toEqual(["auth.test", "apps.connection.open"]);
    expect(setup.urls).toEqual(["wss://slack.test/socket"]);
    await channel.stop();
    expect(setup.socket.closed).toBe(true);
  });

  it("fails fast on a bad bot token", async () => {
    stubSlackApi({ authOk: false });
    const channel = createSlackChannel({
      botToken: "xoxb-bad",
      appToken: "xapp-test",
      onMessage: async () => "ok",
      connectSocket: () => new FakeSocket(),
    });

    await expect(channel.start()).rejects.toThrow(/Slack auth.test: invalid_auth/);
  });

  it("answers direct messages and acks the envelope", async () => {
    const setup = stubSlackApi();
    const onMessage = vi.fn().mockResolvedValue("Hello back");
    const channel = makeChannel(setup, onMessage);
    await channel.start();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "D1", text: "hi there", user: "UALICE" })),
    );

    await waitFor(() => setup.posts.length > 0);
    expect(onMessage).toHaveBeenCalledWith("D1", "hi there", "UALICE");
    expect(setup.posts[0]).toEqual({ channel: "D1", text: "Hello back" });
    expect(JSON.parse(setup.socket.sent[0])).toEqual({
      envelope_id: "env_1",
      payload: { accepts_response_payload: false },
    });
    await channel.stop();
  });

  it("only answers channel messages that mention the bot", async () => {
    const setup = stubSlackApi();
    const onMessage = vi.fn().mockResolvedValue("on it");
    const channel = makeChannel(setup, onMessage);
    await channel.start();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "C1", text: "quiet chatter", user: "UALICE" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onMessage).not.toHaveBeenCalled();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "C1", text: "<@UBOT> fix the build", user: "UALICE" })),
    );
    await waitFor(() => setup.posts.length > 0);
    expect(onMessage).toHaveBeenCalledWith("C1", "fix the build", "UALICE");
    expect(setup.posts[0]).toEqual({ channel: "C1", text: "on it" });
    await channel.stop();
  });

  it("ignores bot echoes, subtypes, and unrelated events", async () => {
    const setup = stubSlackApi();
    const onMessage = vi.fn().mockResolvedValue("x");
    const channel = makeChannel(setup, onMessage);
    await channel.start();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "D1", text: "echo", bot_id: "BBOT" })),
    );
    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "D1", text: "changed", subtype: "message_changed" })),
    );
    setup.socket.emit("message", JSON.stringify(envelope({ type: "reaction_added", channel: "D1" })));
    setup.socket.emit("message", JSON.stringify({ type: "hello" }));
    setup.socket.emit("message", "not json");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onMessage).not.toHaveBeenCalled();
    expect(setup.posts).toEqual([]);
    await channel.stop();
  });

  it("enforces the allowlist with an explicit refusal", async () => {
    const setup = stubSlackApi();
    const onMessage = vi.fn().mockResolvedValue("should not run");
    const channel = createSlackChannel({
      botToken: "xoxb-test",
      appToken: "xapp-test",
      allowedUsers: ["UKNOWN"],
      onMessage,
      connectSocket: () => setup.socket,
    });
    await channel.start();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "D1", text: "hello", user: "UOTHER" })),
    );

    await waitFor(() => setup.posts.length > 0);
    expect(onMessage).not.toHaveBeenCalled();
    expect(setup.posts[0]).toEqual({ channel: "D1", text: "Access denied." });
    await channel.stop();
  });

  it("posts an error reply when the handler throws", async () => {
    const setup = stubSlackApi();
    const channel = makeChannel(setup, async () => {
      throw new Error("boom happened");
    });
    await channel.start();

    setup.socket.emit(
      "message",
      JSON.stringify(envelope({ type: "message", channel: "D1", text: "hi", user: "UALICE" })),
    );

    await waitFor(() => setup.posts.length > 0);
    expect(setup.posts[0].text).toContain("Error: boom happened");
    await channel.stop();
  });

  it("reconnects when Slack asks for a disconnect", async () => {
    vi.useFakeTimers();
    const setup = stubSlackApi();
    const channel = makeChannel(setup, async () => "ok");
    await channel.start();
    expect(setup.calls.filter((call) => call === "apps.connection.open")).toHaveLength(1);

    setup.socket.emit("message", JSON.stringify({ type: "disconnect", reason: "out_of_connected_retries" }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(setup.calls.filter((call) => call === "apps.connection.open")).toHaveLength(2);
    await channel.stop();
  });
});
