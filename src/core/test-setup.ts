import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "ntox-test-"));
process.env.NTOX_DIR = testDir;
// Ownership marker: proof that this directory was created by NTOX's test setup.
// src/core/policy-memory.test.ts refuses destructive cleanup unless it finds this file.
writeFileSync(join(testDir, ".ntox-test-owned"), "created by ntox vitest test-setup\n");

for (const key of [
  "NTOX_API_KEY",
  "NTOX_API_KEY_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "TOGETHER_API_KEY",
  "MISTRAL_API_KEY",
]) {
  delete process.env[key];
}
