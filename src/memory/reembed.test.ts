import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReembed, formatReembedReport } from "./reembed.js";
import type { Embedder } from "./embedding-service.js";
import type { Episode } from "../types/index.js";

const TARGET = "remote:test/active-model";

function mockEmbedder(): Embedder & { embed: ReturnType<typeof vi.fn> } {
  return {
    kind: "remote",
    currentModel: TARGET,
    embed: vi.fn(async (text: string) => ({ vector: [text.length, 1], model: TARGET })),
  } as Embedder & { embed: ReturnType<typeof vi.fn> };
}

function episode(overrides: Partial<Episode> & { userMessage: string }): string {
  return JSON.stringify({
    id: `ep_${overrides.userMessage.slice(0, 6)}`,
    timestamp: 1,
    sessionId: "s1",
    assistantResponse: "resp",
    summary: "sum",
    embedding: [],
    ...overrides,
  });
}

function readRows(filePath: string): Episode[] {
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Episode];
      } catch {
        return [];
      }
    });
}

describe("runReembed", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ntox-test-reembed-"));
    path = join(dir, "episodes.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixture(): void {
    writeFileSync(
      path,
      [
        episode({ userMessage: "mismatched remote", embedding: [1, 0], embeddingModel: "remote:test/other-model" }),
        episode({ userMessage: "already active", embedding: [2, 0], embeddingModel: TARGET }),
        episode({ userMessage: "untagged legacy", embedding: [3, 0] }),
        episode({ userMessage: "no vector yet", embedding: [] }),
        episode({ userMessage: " ", embedding: [] }),
        "not-json-line",
      ].join("\n") + "\n",
    );
  }

  it("dry run reports mismatches without writing or backing up", async () => {
    writeFixture();
    const before = readFileSync(path, "utf-8");

    const report = await runReembed({ episodesPath: path, embedder: mockEmbedder(), dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.total).toBe(6);
    expect(report.withVector).toBe(3);
    expect(report.byModel).toEqual({ "remote:test/other-model": 1, [TARGET]: 1, "local-hash": 1 });
    // mismatched remote + untagged legacy + vectorless-with-text
    expect(report.mismatched).toBe(3);
    expect(report.migrated).toBe(0);
    expect(readFileSync(path, "utf-8")).toBe(before);
    expect(readdirSync(dir)).toEqual(["episodes.jsonl"]);
  });

  it("migrates mismatches, keeps matches, and writes a backup first", async () => {
    writeFixture();
    const original = readFileSync(path, "utf-8");

    const embedder = mockEmbedder();
    const report = await runReembed({ episodesPath: path, embedder, dryRun: false, now: () => 12345 });

    expect(report.backupPath).toBe(`${path}.bak.12345`);
    expect(existsSync(report.backupPath!)).toBe(true);
    expect(readFileSync(report.backupPath!, "utf-8")).toBe(original);
    expect(report.migrated).toBe(3);
    expect(report.failed).toBe(0);

    const rows = readRows(path);
    const byText = new Map(rows.map((row) => [row.userMessage, row]));

    expect(byText.get("mismatched remote")?.embeddingModel).toBe(TARGET);
    expect(byText.get("untagged legacy")?.embeddingModel).toBe(TARGET);
    expect(byText.get("no vector yet")?.embeddingModel).toBe(TARGET);
    expect(byText.get("no vector yet")?.embedding.length).toBe(2);
    expect(byText.get("already active")?.embedding).toEqual([2, 0]);
    expect(embedder.embed).toHaveBeenCalledTimes(3);
  });

  it("preserves unparseable JSONL lines verbatim", async () => {
    writeFixture();
    await runReembed({ episodesPath: path, embedder: mockEmbedder(), now: () => 1 });
    expect(readFileSync(path, "utf-8")).toContain("not-json-line");
  });

  it("is idempotent: a second run is a no-op", async () => {
    writeFixture();
    const embedder = mockEmbedder();
    await runReembed({ episodesPath: path, embedder, now: () => 111 });
    const afterFirst = readFileSync(path, "utf-8");

    const second = await runReembed({ episodesPath: path, embedder, now: () => 222 });

    expect(second.mismatched).toBe(0);
    expect(second.migrated).toBe(0);
    expect(second.backupPath).toBeUndefined();
    expect(readFileSync(path, "utf-8")).toBe(afterFirst);
    expect(readdirSync(dir).filter((name) => name.includes(".bak."))).toHaveLength(1);
  });

  it("is idempotent under fallback and --force retries marked rows", async () => {
    writeFileSync(
      path,
      [
        episode({ userMessage: "fallback one", embedding: [1, 0], embeddingModel: "local-hash" }),
        episode({ userMessage: "fallback two", embedding: [2, 0], embeddingModel: "local-hash" }),
      ].join("\n") + "\n",
    );
    const embedder = mockEmbedder();
    embedder.embed.mockResolvedValue({ vector: [7, 7], model: "local-hash" });

    const first = await runReembed({ episodesPath: path, embedder, now: () => 1 });
    expect(first.migrated).toBe(2);
    expect(readRows(path).every((row) => row.reembedTargetModel === TARGET)).toBe(true);

    const afterFirst = readFileSync(path, "utf-8");
    const second = await runReembed({ episodesPath: path, embedder, now: () => 2 });
    expect(second.mismatched).toBe(0);
    expect(second.backupPath).toBeUndefined();
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf-8")).toBe(afterFirst);

    const forced = await runReembed({ episodesPath: path, embedder, force: true, now: () => 3 });
    expect(forced.migrated).toBe(2);
    expect(embedder.embed).toHaveBeenCalledTimes(4);
  });

  it("processes in batches and leaves failed rows unchanged", async () => {
    writeFileSync(
      path,
      [
        episode({ userMessage: "one", embedding: [1, 0], embeddingModel: "local-hash" }),
        episode({ userMessage: "two", embedding: [2, 0], embeddingModel: "local-hash" }),
        episode({ userMessage: "three", embedding: [3, 0], embeddingModel: "local-hash" }),
      ].join("\n") + "\n",
    );
    const embedder = mockEmbedder();
    embedder.embed.mockImplementation(async (text: string) =>
      text === "two" ? null : { vector: [9, 9], model: TARGET },
    );

    const report = await runReembed({ episodesPath: path, embedder, batch: 1, now: () => 5 });

    expect(report.migrated).toBe(2);
    expect(report.failed).toBe(1);
    const rows = readRows(path);
    const byText = new Map(rows.map((row) => [row.userMessage, row]));
    expect(byText.get("two")?.embeddingModel).toBe("local-hash");
    expect(byText.get("two")?.embedding).toEqual([2, 0]);
    expect(byText.get("one")?.embeddingModel).toBe(TARGET);
  });

  it("returns an empty report when the file does not exist", async () => {
    const report = await runReembed({ episodesPath: join(dir, "missing.jsonl"), embedder: mockEmbedder() });
    expect(report.total).toBe(0);
    expect(report.mismatched).toBe(0);
    expect(report.backupPath).toBeUndefined();
  });

  it("formats a readable report", () => {
    const text = formatReembedReport({
      targetModel: TARGET,
      total: 6,
      withVector: 3,
      byModel: { "local-hash": 3 },
      mismatched: 3,
      migrated: 3,
      failed: 0,
      dryRun: false,
      backupPath: "/tmp/x.bak.1",
    });
    expect(text).toContain(TARGET);
    expect(text).toContain("migrated: 3 of 3");
    expect(text).toContain("/tmp/x.bak.1");
  });
});
