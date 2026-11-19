import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EPISODES_JSONL_PATH, EPISODES_PATH, loadConfig } from "../core/config.js";
import { LLMClient } from "../core/llm.js";
import { EmbeddingService, LOCAL_HASH_TAG, LocalOnlyEmbedder, type Embedder } from "./embedding-service.js";
import type { Episode } from "../types/index.js";

export interface ReembedOptions {
  /** Target embedding model id, `local-hash` for the local embedder, or undefined for the configured default. */
  model?: string;
  batch?: number;
  dryRun?: boolean;
  /** Ignore the idempotency marker and re-embed every eligible row (e.g. to retry
   *  rows previously written with a fallback vector). */
  force?: boolean;
  /** Injection point for tests; defaults to an embedder resolved from config. */
  embedder?: Embedder;
  /** Injection point for tests; defaults to the episodes index. */
  episodesPath?: string;
  now?: () => number;
}

export interface ReembedReport {
  targetModel: string;
  total: number;
  withVector: number;
  byModel: Record<string, number>;
  /** Rows that need re-embedding against the target (wrong/missing provenance or no vector). */
  mismatched: number;
  migrated: number;
  /** Rows left unchanged: embed returned null or the row has no re-embeddable text. */
  failed: number;
  dryRun: boolean;
  backupPath?: string;
}

interface Slot {
  /** Parsed row, or null for an unparseable JSONL line kept verbatim. */
  episode: Episode | null;
  raw?: string;
}

function resolveEmbedder(model?: string): Embedder {
  if (model === LOCAL_HASH_TAG) return new LocalOnlyEmbedder();
  const config = loadConfig();
  const embeddingModelId = model ?? config.embeddingModel;
  const llm = new LLMClient(
    config.apiKey,
    config.model,
    embeddingModelId,
    config.maxTokens,
    config.temperature,
    config.apiBaseUrl,
    config.provider,
  );
  return new EmbeddingService(llm);
}

function readSlots(path: string): { slots: Slot[]; format: "jsonl" | "json" } | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  if (path.endsWith(".jsonl")) {
    const slots: Slot[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        slots.push({ episode: JSON.parse(trimmed) as Episode });
      } catch {
        slots.push({ episode: null, raw: line });
      }
    }
    return { slots, format: "jsonl" };
  }
  try {
    const parsed = JSON.parse(raw) as Episode[];
    if (!Array.isArray(parsed)) return null;
    return { slots: parsed.map((episode) => ({ episode })), format: "json" };
  } catch {
    return null;
  }
}

function writeSlots(path: string, slots: Slot[], format: "jsonl" | "json"): void {
  if (format === "jsonl") {
    const lines = slots.map((slot) => (slot.episode ? JSON.stringify(slot.episode) : (slot.raw ?? "")));
    writeFileSync(path, lines.length > 0 ? lines.join("\n") + "\n" : "");
    return;
  }
  writeFileSync(path, JSON.stringify(slots.map((slot) => slot.episode).filter(Boolean), null, 2));
}

/** Migrates stored episode vectors onto one embedding model: groups entries by their
 *  stored provenance, re-embeds mismatches against the active model, backs the file up
 *  before the first rewrite, checkpoints per batch (resumable), and is a no-op when
 *  everything already matches. Rows already migrated toward the target are marked so
 *  a fallback-produced vector does not cause an endless retry on later runs. */
export async function runReembed(options: ReembedOptions = {}): Promise<ReembedReport> {
  let path = options.episodesPath ?? EPISODES_JSONL_PATH;
  const batchSize = Math.max(1, options.batch ?? 16);
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const now = options.now ?? Date.now;

  const embedder = options.embedder ?? resolveEmbedder(options.model);
  const targetModel = embedder.currentModel;

  const empty: ReembedReport = {
    targetModel,
    total: 0,
    withVector: 0,
    byModel: {},
    mismatched: 0,
    migrated: 0,
    failed: 0,
    dryRun,
  };

  let file = readSlots(path);
  if (!file && path === EPISODES_JSONL_PATH && existsSync(EPISODES_PATH)) {
    path = EPISODES_PATH;
    file = readSlots(path);
  }
  if (!file) return empty;

  const { slots, format } = file;
  const sourceHash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const checkpointPath = `${path}.reembed-checkpoint.json`;
  const pending: Array<{ index: number; vector: number[]; model: string; target: string }> = [];
  if (!force && existsSync(checkpointPath)) {
    try {
      const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
        sourceHash: string;
        targetModel: string;
        changes: typeof pending;
      };
      if (
        checkpoint.sourceHash === sourceHash &&
        checkpoint.targetModel === targetModel &&
        Array.isArray(checkpoint.changes)
      ) {
        for (const change of checkpoint.changes) {
          const episode = slots[change.index]?.episode;
          if (!episode || !Array.isArray(change.vector)) continue;
          episode.embedding = change.vector;
          episode.embeddingModel = change.model;
          episode.reembedTargetModel = change.target;
        }
        pending.push(...checkpoint.changes);
      }
    } catch {
      /* ignore corrupt or stale checkpoint */
    }
  }
  const byModel: Record<string, number> = {};
  let withVector = 0;
  const targets: number[] = [];
  let unfixable = 0;

  for (let i = 0; i < slots.length; i++) {
    const episode = slots[i].episode;
    if (!episode) continue;
    const hasVector = Array.isArray(episode.embedding) && episode.embedding.length > 0;
    const tag = episode.embeddingModel ?? (hasVector ? LOCAL_HASH_TAG : undefined);
    if (hasVector) {
      withVector += 1;
      byModel[tag ?? LOCAL_HASH_TAG] = (byModel[tag ?? LOCAL_HASH_TAG] ?? 0) + 1;
    }
    // A marker means this row was already migrated toward the target, even if the
    // embedder fell back to another model — the next run must be a true no-op.
    if (!force && ((hasVector && tag === targetModel) || episode.reembedTargetModel === targetModel)) continue;
    const hasText = episode.userMessage && episode.userMessage.trim().length > 0;
    if (!hasVector && !hasText) continue;
    if (!hasText) {
      unfixable += 1;
      continue;
    }
    targets.push(i);
  }

  const report: ReembedReport = {
    ...empty,
    total: slots.length,
    withVector,
    byModel,
    mismatched: targets.length + unfixable,
    failed: unfixable,
  };

  if (dryRun || targets.length === 0) {
    if (!dryRun && pending.length > 0) {
      writeSlots(path, slots, format);
      try {
        unlinkSync(checkpointPath);
      } catch {
        /* best effort */
      }
    }
    return report;
  }

  const backupPath = `${path}.bak.${now()}`;
  copyFileSync(path, backupPath);
  report.backupPath = backupPath;

  let migrated = 0;
  let failed = unfixable;
  for (let b = 0; b < targets.length; b += batchSize) {
    const results = await Promise.all(
      targets.slice(b, b + batchSize).map(async (index) => {
        const episode = slots[index].episode;
        if (!episode) return null;
        const result = await embedder.embed(episode.userMessage);
        return { index, episode, result };
      }),
    );
    for (const entry of results) {
      if (!entry) continue;
      const { index, episode, result } = entry;
      if (!result || result.vector.length === 0) {
        failed += 1;
        continue;
      }
      episode.embedding = result.vector;
      episode.embeddingModel = result.model;
      episode.reembedTargetModel = targetModel;
      pending.push({ index, vector: result.vector, model: result.model, target: targetModel });
      migrated += 1;
    }
    writeFileSync(checkpointPath, JSON.stringify({ sourceHash, targetModel, changes: pending }));
  }
  writeSlots(path, slots, format);
  try {
    unlinkSync(checkpointPath);
  } catch {
    /* best effort */
  }

  report.migrated = migrated;
  report.failed = failed;
  return report;
}

export function formatReembedReport(report: ReembedReport): string {
  const lines = [`Re-embed episodes → ${report.targetModel}`];
  const models = Object.entries(report.byModel)
    .map(([model, count]) => `${model} × ${count}`)
    .join(", ");
  lines.push(`  entries: ${report.total} (${report.withVector} with vectors)`);
  if (models) lines.push(`  stored provenance: ${models}`);
  if (report.dryRun) {
    lines.push(`  dry run: ${report.mismatched} entr${report.mismatched === 1 ? "y" : "ies"} would be re-embedded`);
    if (report.failed > 0)
      lines.push(`  ${report.failed} entr${report.failed === 1 ? "y" : "ies"} have no re-embeddable text`);
    return lines.join("\n");
  }
  if (report.mismatched === 0) {
    lines.push("  already consistent with the target model — nothing to do");
    return lines.join("\n");
  }
  lines.push(`  migrated: ${report.migrated} of ${report.mismatched}`);
  if (report.failed > 0) lines.push(`  failed: ${report.failed} (left unchanged)`);
  if (report.backupPath) lines.push(`  backup: ${report.backupPath}`);
  return lines.join("\n");
}
