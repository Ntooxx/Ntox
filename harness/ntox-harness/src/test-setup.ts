import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NTOX_DIR = mkdtempSync(join(tmpdir(), "ntox-harness-test-"));
for (const key of [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
]) {
  delete process.env[key];
}
