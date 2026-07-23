import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { Tool } from "../types/index.js";
import { NTOX_DIR } from "../core/config.js";
import { randomUUID } from "node:crypto";

const CHECKPOINTS_DIR = join(NTOX_DIR, "checkpoints");
const MAX_PER_FILE = 50;

function ensureDir(): void {
  if (!existsSync(CHECKPOINTS_DIR)) mkdirSync(CHECKPOINTS_DIR, { recursive: true });
}

function checkpointPath(id: string): string {
  return join(CHECKPOINTS_DIR, `${id}.json`);
}

function loadAll(): { id: string; originalPath: string; timestamp: number; content: string }[] {
  ensureDir();
  const files = readdirSync(CHECKPOINTS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    try {
      return JSON.parse(readFileSync(join(CHECKPOINTS_DIR, f), "utf-8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function evictOldest(filePath: string): void {
  const all = loadAll()
    .filter((c) => c.originalPath === filePath)
    .sort((a, b) => a.timestamp - b.timestamp);
  while (all.length >= MAX_PER_FILE) {
    const oldest = all.shift();
    if (!oldest) break;
    const p = checkpointPath(oldest.id);
    try { if (existsSync(p)) writeFileSync(p, ""); } catch { /* evict best effort */ }
  }
}

export const checkpointTool: Tool = {
  name: "checkpoint",
  description: "Create file snapshots, list checkpoints, or rollback to a previous snapshot. Use 'create' before risky edits, 'rollback' to restore, 'list' to see available checkpoints.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "rollback"], description: "Action: create, list, or rollback" },
      path: { type: "string", description: "File path (required for create and list)" },
      checkpointId: { type: "string", description: "Checkpoint ID (required for rollback)" },
    },
    required: ["action"],
  },
  async execute(args) {
    const action = String(args.action);

    if (action === "create") {
      const filePath = args.path ? String(args.path) : "";
      if (!filePath) return { success: false, error: "path is required for create" };
      if (!existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

      ensureDir();
      evictOldest(filePath);

      const content = readFileSync(filePath, "utf-8");
      const id = `${Date.now()}_${basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_")}_${randomUUID().slice(0, 6)}`;
      const checkpoint = { id, originalPath: filePath, timestamp: Date.now(), content };
      writeFileSync(checkpointPath(id), JSON.stringify(checkpoint));
      return { success: true, data: { checkpointId: id, path: filePath, size: content.length } };
    }

    if (action === "list") {
      const filePath = args.path ? String(args.path) : null;
      const all = loadAll();
      const filtered = filePath ? all.filter((c) => c.originalPath === filePath) : all;
      const sorted = filtered
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((c) => ({ id: c.id, path: c.originalPath, timestamp: new Date(c.timestamp).toISOString() }));
      return { success: true, data: { checkpoints: sorted, count: sorted.length } };
    }

    if (action === "rollback") {
      const checkpointId = args.checkpointId ? String(args.checkpointId) : "";
      if (!checkpointId) return { success: false, error: "checkpointId is required for rollback" };

      const cpPath = checkpointPath(checkpointId);
      if (!existsSync(cpPath)) return { success: false, error: `Checkpoint not found: ${checkpointId}` };

      const checkpoint = JSON.parse(readFileSync(cpPath, "utf-8"));
      if (!checkpoint.originalPath || typeof checkpoint.content !== "string") {
        return { success: false, error: "Invalid checkpoint data" };
      }

      writeFileSync(checkpoint.originalPath, checkpoint.content);
      return { success: true, data: { restoredTo: checkpoint.originalPath, checkpointId, size: checkpoint.content.length } };
    }

    return { success: false, error: `Unknown action: ${action}. Use create, list, or rollback.` };
  },
};