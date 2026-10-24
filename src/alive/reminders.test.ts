import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AliveOpenLoop } from "./engine.js";
import {
  LoopReminderLedger,
  OPEN_LOOP_IDLE_MS,
  collectOpenLoopReminders,
  findReminderLoops,
  renderOpenLoopReminder,
} from "./reminders.js";

const NOW = Date.UTC(2026, 9, 24, 8, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const LEDGER_RETENTION_MS = 30 * DAY_MS;

const loop = (overrides: Partial<AliveOpenLoop> = {}): AliveOpenLoop => ({
  id: "loop_1",
  goal: "Ship 4.4",
  status: "waiting_evidence",
  createdAt: NOW - 3 * DAY_MS,
  updatedAt: NOW - 2 * DAY_MS,
  nextEvidence: "Run the reminder smoke",
  ...overrides,
});

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "ntox-reminders-")), "loop-reminders.json");
}

describe("findReminderLoops", () => {
  it("keeps only stale, unfinished loops, oldest first", () => {
    const loops = [
      loop({ id: "fresh", updatedAt: NOW - OPEN_LOOP_IDLE_MS + 1 }),
      loop({ id: "done", status: "completed" }),
      loop({ id: "recent", updatedAt: NOW - 26 * 60 * 60 * 1000 }),
      loop({ id: "oldest", updatedAt: NOW - 5 * DAY_MS }),
    ];

    expect(findReminderLoops(loops, NOW).map((item) => item.id)).toEqual(["oldest", "recent"]);
  });

  it("honours a custom idle window", () => {
    const loops = [loop({ id: "half", updatedAt: NOW - 12 * 60 * 60 * 1000 })];

    expect(findReminderLoops(loops, NOW, 6 * 60 * 60 * 1000).map((item) => item.id)).toEqual(["half"]);
    expect(findReminderLoops(loops, NOW, 48 * 60 * 60 * 1000)).toEqual([]);
  });

  it("caps the batch at three reminders", () => {
    const loops = Array.from({ length: 6 }, (_, index) =>
      loop({ id: `loop_${index}`, updatedAt: NOW - (index + 1) * DAY_MS }),
    );

    const found = findReminderLoops(loops, NOW);
    expect(found).toHaveLength(3);
    expect(found.map((item) => item.id)).toEqual(["loop_5", "loop_4", "loop_3"]);
  });
});

describe("renderOpenLoopReminder", () => {
  it("phrases the goal, idle age, and next step", () => {
    expect(renderOpenLoopReminder(loop(), NOW)).toBe(
      'You asked me to finish "Ship 4.4" 2d ago — shall I continue? Next step: Run the reminder smoke',
    );
  });

  it("drops the next step when there is none and collapses whitespace", () => {
    const text = renderOpenLoopReminder(
      loop({ goal: "Ship   the\nrelease", nextEvidence: undefined, updatedAt: NOW - 5 * 60 * 60 * 1000 }),
      NOW,
    );
    expect(text).toBe('You asked me to finish "Ship the release" 5h ago — shall I continue?');
  });

  it("says moments ago instead of just now", () => {
    expect(renderOpenLoopReminder(loop({ updatedAt: NOW - 1000 }), NOW)).toContain('"Ship 4.4" moments ago');
  });
});

describe("LoopReminderLedger", () => {
  it("allows one reminder per loop until the loop changes", () => {
    const ledger = new LoopReminderLedger({ file: null, now: () => NOW });
    const target = loop();

    expect(ledger.shouldRemind("repl", target)).toBe(true);
    ledger.remember("repl", target);
    expect(ledger.shouldRemind("repl", target)).toBe(false);

    expect(ledger.shouldRemind("gateway", target)).toBe(true);
    ledger.remember("gateway", target);
    expect(ledger.shouldRemind("gateway", target)).toBe(false);

    const changed = { ...target, updatedAt: NOW + 1000 };
    expect(ledger.shouldRemind("repl", changed)).toBe(true);
  });

  it("survives a restart so a gateway bounce does not nag again", () => {
    const file = tempFile();

    const first = new LoopReminderLedger({ file, now: () => NOW });
    first.remember("gateway", loop());

    expect(new LoopReminderLedger({ file, now: () => NOW }).shouldRemind("gateway", loop())).toBe(false);
    expect(new LoopReminderLedger({ file, now: () => NOW }).shouldRemind("repl", loop())).toBe(true);
  });

  it("forgets entries once they age out of retention", () => {
    const file = tempFile();
    writeFileSync(file, JSON.stringify({ "gateway|loop_1": NOW - LEDGER_RETENTION_MS - 1 }));

    expect(new LoopReminderLedger({ file, now: () => NOW }).shouldRemind("gateway", loop())).toBe(true);
  });

  it("starts fresh when the ledger file is unreadable", () => {
    const file = tempFile();
    writeFileSync(file, "{not json");

    const ledger = new LoopReminderLedger({ file, now: () => NOW });
    expect(ledger.shouldRemind("repl", loop())).toBe(true);
    ledger.remember("repl", loop());
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ "repl|loop_1": NOW });
  });
});

describe("collectOpenLoopReminders", () => {
  it("filters by staleness and by what the ledger already knows", () => {
    const ledger = new LoopReminderLedger({ file: null, now: () => NOW });
    const loops = [loop({ id: "stale", updatedAt: NOW - 2 * DAY_MS }), loop({ id: "fresh", updatedAt: NOW - 60_000 })];

    const first = collectOpenLoopReminders(loops, { now: NOW, scope: "repl", ledger });
    expect(first.map((item) => item.loop.id)).toEqual(["stale"]);
    expect(first[0].text).toContain('You asked me to finish "Ship 4.4"');

    ledger.remember("repl", loops[0]);
    expect(collectOpenLoopReminders(loops, { now: NOW, scope: "repl", ledger })).toEqual([]);
    expect(collectOpenLoopReminders(loops, { now: NOW, scope: "gateway", ledger })).toHaveLength(1);
  });

  it("respects a custom idle window", () => {
    const ledger = new LoopReminderLedger({ file: null });
    const loops = [loop({ updatedAt: NOW - 12 * 60 * 60 * 1000 })];

    expect(
      collectOpenLoopReminders(loops, { now: NOW, scope: "repl", ledger, idleMs: 6 * 60 * 60 * 1000 }),
    ).toHaveLength(1);
    expect(collectOpenLoopReminders(loops, { now: NOW, scope: "repl", ledger, idleMs: 48 * 60 * 60 * 1000 })).toEqual(
      [],
    );
  });
});
