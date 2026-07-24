import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ExternalSignals } from "./external-signals.js";

const TEST_PATH = join(tmpdir(), `ntox-signals-test-${randomUUID().slice(0, 8)}.json`);

describe("ExternalSignals", () => {
  let signals: ExternalSignals;

  beforeEach(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
    signals = new ExternalSignals();
    signals.clearAll();
  });

  afterAll(() => {
    try { if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH); } catch { }
  });

  it("starts with empty data", () => {
    expect(signals.getRepos()).toHaveLength(0);
    expect(signals.getCompetitors()).toHaveLength(0);
  });

  it("should fetch when interval elapsed", () => {
    expect(signals.shouldFetch()).toBe(true);
  });

  it("should not fetch immediately after fetch", () => {
    signals.flush();
    expect(signals.shouldFetch()).toBe(true);
  });

  it("stores repo data", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        stargazers_count: 100,
        forks_count: 20,
        open_issues_count: 5,
        pushed_at: "2026-07-24T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await signals.fetchRepo("antonpupkov", "ntox");
    expect(result).not.toBeNull();
    expect(result!.repo).toBe("antonpupkov/ntox");
    expect(result!.stars).toBe(100);

    vi.unstubAllGlobals();
  });

  it("tracks star delta", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          stargazers_count: 100,
          forks_count: 20,
          open_issues_count: 5,
          pushed_at: "2026-07-24T00:00:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          stargazers_count: 110,
          forks_count: 22,
          open_issues_count: 4,
          pushed_at: "2026-07-24T01:00:00Z",
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    await signals.fetchRepo("antonpupkov", "ntox");
    const result = await signals.fetchRepo("antonpupkov", "ntox");
    expect(result!.starsDelta).toBe(10);

    vi.unstubAllGlobals();
  });

  it("handles fetch failure gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await signals.fetchRepo("antonpupkov", "ntox");
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it("handles non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await signals.fetchRepo("antonpupkov", "ntox");
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it("stores competitor data", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        stargazers_count: 500,
        forks_count: 50,
        open_issues_count: 10,
        pushed_at: "2026-07-24T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await signals.fetchCompetitor("openai", "codex", "OpenAI Codex");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("OpenAI Codex");
    expect(result!.stars).toBe(500);

    vi.unstubAllGlobals();
  });

  it("builds context string", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        stargazers_count: 100,
        forks_count: 20,
        open_issues_count: 5,
        pushed_at: "2026-07-24T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await signals.fetchRepo("antonpupkov", "ntox");
    const ctx = signals.buildContext();
    expect(ctx).toContain("External Signals");
    expect(ctx).toContain("antonpupkov/ntox");

    vi.unstubAllGlobals();
  });

  it("clears all data", () => {
    signals.clearAll();
    expect(signals.getRepos()).toHaveLength(0);
    expect(signals.getCompetitors()).toHaveLength(0);
  });
});