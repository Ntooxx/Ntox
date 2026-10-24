import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProactiveSuggestion } from "../meta/proactive.js";
import {
  PROACTIVE_COOLDOWN_MS,
  ProactiveThrottle,
  pushProactiveSuggestion,
  renderProactiveSuggestion,
} from "./proactive-delivery.js";

const suggestion = (overrides: Partial<ProactiveSuggestion> = {}): ProactiveSuggestion => ({
  message: "You have 2 active goals: ship the release.",
  type: "goal-reminder",
  priority: 3,
  ...overrides,
});

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "ntox-proactive-")), "proactive.json");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("renderProactiveSuggestion", () => {
  it("labels every suggestion type", () => {
    expect(renderProactiveSuggestion(suggestion())).toBe("Goal: You have 2 active goals: ship the release.");
    expect(renderProactiveSuggestion(suggestion({ type: "milestone", message: "100 memories." }))).toBe(
      "Milestone: 100 memories.",
    );
    expect(renderProactiveSuggestion(suggestion({ type: "tip", message: "Try /plan." }))).toBe("Tip: Try /plan.");
    expect(renderProactiveSuggestion(suggestion({ type: "pattern-insight", message: "You correct often." }))).toBe(
      "Insight: You correct often.",
    );
    expect(renderProactiveSuggestion(suggestion({ type: "skill-suggestion", message: "Save a skill." }))).toBe(
      "Suggestion: Save a skill.",
    );
    expect(renderProactiveSuggestion(suggestion({ type: "habit", message: "Weekend project time." }))).toBe(
      "Habit: Weekend project time.",
    );
    expect(renderProactiveSuggestion(suggestion({ type: "feedback-prompt", message: "Was that useful?" }))).toBe(
      "Question: Was that useful?",
    );
  });
});

describe("ProactiveThrottle", () => {
  it("allows one claim per key per day", () => {
    let now = 1_000_000;
    const throttle = new ProactiveThrottle({ file: null, now: () => now });

    expect(throttle.claim("telegram:42")).toBe(true);
    expect(throttle.claim("telegram:42")).toBe(false);

    now += PROACTIVE_COOLDOWN_MS - 1;
    expect(throttle.claim("telegram:42")).toBe(false);

    now += 1;
    expect(throttle.claim("telegram:42")).toBe(true);
  });

  it("tracks each chat independently", () => {
    const throttle = new ProactiveThrottle({ file: null });

    expect(throttle.claim("telegram:42")).toBe(true);
    expect(throttle.claim("telegram:43")).toBe(true);
    expect(throttle.claim("whatsapp:42")).toBe(true);
    expect(throttle.claim("telegram:42")).toBe(false);
  });

  it("persists claims so a restarted gateway keeps the daily cap", () => {
    const file = tempFile();
    const now = () => 5_000_000;

    expect(new ProactiveThrottle({ file, now }).claim("telegram:42")).toBe(true);
    expect(new ProactiveThrottle({ file, now }).claim("telegram:42")).toBe(false);
    expect(new ProactiveThrottle({ file, now: () => 5_000_000 + PROACTIVE_COOLDOWN_MS }).claim("telegram:42")).toBe(
      true,
    );
  });

  it("drops expired entries from disk on write", () => {
    const file = tempFile();
    const base = 9_000_000;
    const stale = base - PROACTIVE_COOLDOWN_MS - 1;
    writeFileSync(file, JSON.stringify({ "telegram:old": stale, "telegram:42": base }));

    const throttle = new ProactiveThrottle({ file, now: () => base });
    expect(throttle.claim("telegram:old")).toBe(true);
    expect(throttle.claim("telegram:42")).toBe(false);

    const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    expect(written["telegram:old"]).toBe(base);
    expect(written["telegram:42"]).toBe(base);
  });

  it("starts fresh when the throttle file is unreadable", () => {
    const file = tempFile();
    writeFileSync(file, "{not json");

    expect(new ProactiveThrottle({ file }).claim("telegram:42")).toBe(true);
  });
});

describe("pushProactiveSuggestion", () => {
  it("does not consume the daily cap when the chat has no sender", () => {
    const throttle = new ProactiveThrottle({ file: null });

    expect(
      pushProactiveSuggestion({ throttle, key: "web:1", chatId: "1", suggestion: suggestion(), sender: null }),
    ).toBe(false);
    expect(throttle.claim("web:1")).toBe(true);
  });

  it("sends a rendered message and blocks the second push for the same chat", async () => {
    const throttle = new ProactiveThrottle({ file: null });
    const sender = vi.fn().mockResolvedValue(undefined);

    expect(
      pushProactiveSuggestion({ throttle, key: "telegram:42", chatId: "42", suggestion: suggestion(), sender }),
    ).toBe(true);
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    expect(sender).toHaveBeenCalledWith("42", "Goal: You have 2 active goals: ship the release.");

    expect(
      pushProactiveSuggestion({ throttle, key: "telegram:42", chatId: "42", suggestion: suggestion(), sender }),
    ).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("waits for the configured delay so the reply lands first", async () => {
    vi.useFakeTimers();
    const throttle = new ProactiveThrottle({ file: null });
    const sender = vi.fn().mockResolvedValue(undefined);

    pushProactiveSuggestion({
      throttle,
      key: "telegram:42",
      chatId: "42",
      suggestion: suggestion({ type: "milestone", message: "First week of memories." }),
      sender,
      delayMs: 1500,
    });
    expect(sender).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1499);
    expect(sender).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sender).toHaveBeenCalledWith("42", "Milestone: First week of memories.");
  });

  it("logs a failed send instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const throttle = new ProactiveThrottle({ file: null });
    const sender = vi.fn().mockRejectedValue(new Error("telegram down"));

    expect(
      pushProactiveSuggestion({ throttle, key: "telegram:42", chatId: "42", suggestion: suggestion(), sender }),
    ).toBe(true);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("telegram down")));
  });
});
