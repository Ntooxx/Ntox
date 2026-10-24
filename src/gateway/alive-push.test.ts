import { afterEach, describe, expect, it, vi } from "vitest";
import type { AliveAction, AliveEvent } from "../alive/engine.js";
import { ALIVE_PUSH_MIN_INTERVAL_MS, AlivePusher, renderAlivePush, splitSessionId } from "./alive-push.js";

const action = (kind: AliveAction["kind"], reason = "Significant git_commit event"): AliveAction => ({
  kind,
  reason,
});

const gitEvent = (overrides: Partial<AliveEvent> = {}): AliveEvent => ({
  id: "event_1",
  type: "git_commit",
  source: "git-watcher",
  timestamp: 1,
  significance: 0.8,
  payload: { head: "abcdef1234", changedFiles: 3 },
  requiresHuman: false,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("splitSessionId", () => {
  it("splits channel and chat id on the first underscore only", () => {
    expect(splitSessionId("telegram_42")).toEqual({ channel: "telegram", chatId: "42" });
    expect(splitSessionId("whatsapp_120363021@c.us")).toEqual({ channel: "whatsapp", chatId: "120363021@c.us" });
    expect(splitSessionId("discord_811")).toEqual({ channel: "discord", chatId: "811" });
  });

  it("rejects ids that are not channel-scoped", () => {
    expect(splitSessionId("web")).toBeNull();
    expect(splitSessionId("_42")).toBeNull();
    expect(splitSessionId("telegram_")).toBeNull();
  });
});

describe("renderAlivePush", () => {
  it("drops learn and ignore actions", () => {
    expect(renderAlivePush(action("learn"), gitEvent())).toBeNull();
    expect(renderAlivePush(action("ignore"), gitEvent())).toBeNull();
  });

  it("drops in-turn tool events so an active chat never gets told what it just saw", () => {
    expect(
      renderAlivePush(action("wake", "Significant tool_failed event"), gitEvent({ source: "ntox-tool" })),
    ).toBeNull();
    expect(renderAlivePush(action("notify", "Human decision requested"), gitEvent({ source: "ntox-tool" }))).toBeNull();
  });

  it("renders host events with a human headline", () => {
    expect(renderAlivePush(action("wake"), gitEvent())).toBe("Alive · Git: new commit abcdef1 (3 files)");
    expect(
      renderAlivePush(
        action("wake", "Significant file_changed event"),
        gitEvent({ type: "file_changed", payload: { path: "src/core/agent.ts", change: "rename" } }),
      ),
    ).toBe("Alive · Workspace: src/core/agent.ts (rename)");
    expect(
      renderAlivePush(
        action("wake", "Significant tool_failed event"),
        gitEvent({
          type: "tool_failed",
          source: "worker",
          payload: { toolName: "shell", status: "failed", error: "exit 1" },
        }),
      ),
    ).toBe("Alive · shell: failed — exit 1");
    expect(
      renderAlivePush(action("wake", "Significant surprise event"), gitEvent({ type: "surprise", payload: {} })),
    ).toBe("Alive · surprise — Significant surprise event");
  });

  it("renders action-only notifications that carry no event", () => {
    expect(renderAlivePush(action("notify", "Human decision requested"))).toBe("Alive · Human decision requested");
    expect(renderAlivePush(action("notify", "Open loop deadline reached: Ship 4.2"))).toBe(
      "Alive · Open loop deadline reached: Ship 4.2",
    );
  });
});

describe("AlivePusher", () => {
  it("pushes one message to every current target", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const pusher = new AlivePusher({
      targets: () => [
        { channel: "telegram", chatId: "42" },
        { channel: "whatsapp", chatId: "43" },
      ],
      send,
    });

    pusher.handle(action("wake"), gitEvent());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenCalledWith("telegram", "42", "Alive · Git: new commit abcdef1 (3 files)");
    expect(send).toHaveBeenCalledWith("whatsapp", "43", "Alive · Git: new commit abcdef1 (3 files)");
  });

  it("throttles each chat independently for the cooldown window", async () => {
    let now = 1_000_000;
    const send = vi.fn().mockResolvedValue(undefined);
    const pusher = new AlivePusher({
      targets: () => [{ channel: "telegram", chatId: "42" }],
      send,
      now: () => now,
      minIntervalMs: ALIVE_PUSH_MIN_INTERVAL_MS,
    });

    pusher.handle(action("wake"), gitEvent());
    pusher.handle(action("notify", "Human decision requested"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    now += ALIVE_PUSH_MIN_INTERVAL_MS - 1;
    pusher.handle(action("notify", "Human decision requested"));
    expect(send).toHaveBeenCalledTimes(1);

    now += 1;
    pusher.handle(action("notify", "Human decision requested"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("sends nothing while no chat is active and keeps the cooldown unconsumed", async () => {
    let active = false;
    const send = vi.fn().mockResolvedValue(undefined);
    const pusher = new AlivePusher({
      targets: () => (active ? [{ channel: "telegram", chatId: "42" }] : []),
      send,
    });

    pusher.handle(action("wake"), gitEvent());
    expect(send).not.toHaveBeenCalled();

    active = true;
    pusher.handle(action("notify", "Human decision requested"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith("telegram", "42", "Alive · Human decision requested");
  });

  it("ignores actions that render to nothing", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const pusher = new AlivePusher({ targets: () => [{ channel: "telegram", chatId: "42" }], send });

    pusher.handle(action("ignore"), gitEvent());
    pusher.handle(action("learn"), gitEvent());

    expect(send).not.toHaveBeenCalled();
  });

  it("logs a rejected send instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("telegram down"));
    const pusher = new AlivePusher({ targets: () => [{ channel: "telegram", chatId: "42" }], send });

    expect(() => pusher.handle(action("wake"), gitEvent())).not.toThrow();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("telegram down")));
  });

  it("logs a synchronous sender failure instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(() => {
      throw new Error("no sender configured");
    }) as unknown as () => Promise<void>;
    const pusher = new AlivePusher({ targets: () => [{ channel: "telegram", chatId: "42" }], send });

    expect(() => pusher.handle(action("wake"), gitEvent())).not.toThrow();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("no sender configured")));
  });
});
