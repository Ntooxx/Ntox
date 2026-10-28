import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getBaseDir(): string {
  return process.env.NTOX_DIR || join(homedir(), ".ntox");
}

export const NTOX_DIR = getBaseDir();
export const CONFIG_PATH = join(NTOX_DIR, "config.json");
export const CREDENTIALS_PATH = join(NTOX_DIR, "credentials.json");
export const CREDENTIALS_ENC_PATH = join(NTOX_DIR, "credentials.enc.json");
export const COST_PATH = join(NTOX_DIR, "costs.json");
export const MODELS_CACHE_PATH = join(NTOX_DIR, "models-cache.json");
export const MEMORY_DIR = join(NTOX_DIR, "memory");
export const EPISODES_PATH = join(MEMORY_DIR, "episodes.json");
export const EPISODES_JSONL_PATH = join(MEMORY_DIR, "episodes.jsonl");
export const DURABLE_MEMORY_PATH = join(MEMORY_DIR, "durable.json");
export const MISTAKES_PATH = join(MEMORY_DIR, "mistakes.json");
export const SKILLS_DIR = join(NTOX_DIR, "skills");
export const COGNITION_DIR = join(NTOX_DIR, "cognition");
/** Phase 3 procedural store — harness-authority-only (policy denies the agent tool surface). */
export const PROCEDURES_DIR = join(NTOX_DIR, "procedures");

export function getMemoryDir(): string {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
  return MEMORY_DIR;
}
