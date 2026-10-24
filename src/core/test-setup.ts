import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NTOX_DIR = mkdtempSync(join(tmpdir(), "ntox-test-"));

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
