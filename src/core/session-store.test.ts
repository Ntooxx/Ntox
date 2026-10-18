import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionSnapshot } from "./session-store.js";
import {
  deleteSessionSnapshot,
  getLastSessionId,
  listSessionSnapshots,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from "./session-store.js";

const baseDir = process.env.NTOX_DIR!;
let dir = "";

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: 1,
    sessionId: "sess_1",
    source: "repl",
    savedAt: 1000,
    createdAt: 500,
    messages: [
      { role: "user", content: "hello there" },
      { role: "assistant", content: "hi" },
    ],
    lastAssistantResponse: "hi",
    lastUserMessage: "hello there",
    sessionStartTime: 500,
    correctionsThisSession: 0,
    toolUsageThisSession: {},
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(baseDir, "sessions-test-"));
  process.env.NTOX_DIR = dir;
});

afterEach(() => {
  process.env.NTOX_DIR = baseDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("session store", () => {
  it("saves and loads a session snapshot", () => {
    saveSessionSnapshot(snapshot());
    const loaded = loadSessionSnapshot("sess_1");

    expect(loaded?.sessionId).toBe("sess_1");
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.lastAssistantResponse).toBe("hi");
  });

  it("lists sessions newest first with summaries", () => {
    saveSessionSnapshot(snapshot({ sessionId: "sess_old", savedAt: 1000 }));
    saveSessionSnapshot(snapshot({ sessionId: "sess_new", savedAt: 2000, source: "api" }));

    const list = listSessionSnapshots(10);
    expect(list.map((item) => item.id)).toEqual(["sess_new", "sess_old"]);
    expect(list[0].messageCount).toBe(2);
    expect(list[0].title).toBe("hello there");
  });

  it("finds the last session by source", () => {
    saveSessionSnapshot(snapshot({ sessionId: "sess_repl", source: "repl", savedAt: 1000 }));
    saveSessionSnapshot(snapshot({ sessionId: "sess_api", source: "api", savedAt: 2000 }));

    expect(getLastSessionId("repl")).toBe("sess_repl");
    expect(getLastSessionId("api")).toBe("sess_api");
    expect(getLastSessionId("missing")).toBeNull();
  });

  it("updates an existing entry instead of duplicating it", () => {
    saveSessionSnapshot(snapshot({ savedAt: 1000 }));
    saveSessionSnapshot(snapshot({ savedAt: 3000, lastAssistantResponse: "updated" }));

    const list = listSessionSnapshots(10);
    expect(list).toHaveLength(1);
    expect(loadSessionSnapshot("sess_1")?.lastAssistantResponse).toBe("updated");
  });

  it("deletes snapshots and index entries", () => {
    saveSessionSnapshot(snapshot());
    expect(deleteSessionSnapshot("sess_1")).toBe(true);
    expect(loadSessionSnapshot("sess_1")).toBeNull();
    expect(listSessionSnapshots()).toHaveLength(0);
    expect(deleteSessionSnapshot("sess_1")).toBe(false);
  });

  it("rebuilds the index from snapshot files", () => {
    saveSessionSnapshot(snapshot({ sessionId: "sess_a", savedAt: 1000 }));
    saveSessionSnapshot(snapshot({ sessionId: "sess_b", savedAt: 2000 }));
    rmSync(join(dir, "sessions", "index.json"));

    const list = listSessionSnapshots(10);
    expect(list.map((item) => item.id)).toEqual(["sess_b", "sess_a"]);
  });

  it("ignores corrupt snapshots", () => {
    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "broken.json"), "{not json");
    expect(loadSessionSnapshot("broken")).toBeNull();
    expect(listSessionSnapshots()).toHaveLength(0);
  });

  it("rejects snapshots saved under a different id", () => {
    saveSessionSnapshot(snapshot({ sessionId: "sess_original" }));
    expect(loadSessionSnapshot("sess_other")).toBeNull();
  });
});
