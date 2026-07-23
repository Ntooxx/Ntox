#!/usr/bin/env node

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, saveConfig } from "./core/config.js";

const rl = readline.createInterface({ input, output });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${question}: `, (answer) => resolve(answer.trim()));
  });
}

function confirm(question: string): Promise<boolean> {
  return ask(`${question} (y/n)`).then((a) => a.toLowerCase() === "y" || a === "");
}

export default async function setup(): Promise<void> {
  const config = loadConfig();

  console.log("");
  console.log("  NTOX Setup Wizard");
  console.log("  " + "=".repeat(40));
  console.log("");

  // Step 1: API Key
  const hasKey = !!config.apiKey;
  console.log(`  1. API Key ${hasKey ? "(already set)" : ""}`);
  console.log("     You need an API key from OpenRouter, OpenAI, or another provider.");
  if (!hasKey) {
    const key = await ask("     Enter your API key (or press Enter to skip)");
    if (key) config.apiKey = key;
  }
  console.log("");

  // Step 2: Provider + Model
  console.log("  2. Provider & Model (current defaults shown)");
  const prov = await ask(`     Provider [${config.provider}]`);
  if (prov) config.provider = prov;
  const model = await ask(`     Model [${config.model}]`);
  if (model) config.model = model;

  const modelPrefix = (config.model || "").split("/")[0];
  const knownProviders = ["openrouter", "openai", "deepseek", "groq", "anthropic", "together", "mistral", "ollama", "lmstudio", "openai-compatible"];
  if (modelPrefix && knownProviders.includes(modelPrefix) && modelPrefix !== config.provider && config.provider !== "openrouter") {
    console.log(`\n  Warning: Model "${config.model}" has prefix "${modelPrefix}/" but provider is "${config.provider}".`);
    console.log(`  This will likely fail. Consider switching provider or model.`);
  }
  console.log("");

  // Step 3: Telegram bot
  console.log("  3. Telegram Bot (optional)");
  console.log("     To chat with NTOX on Telegram:");
  console.log("     - Open Telegram and message @BotFather");
  console.log("     - Send /newbot and choose a name");
  console.log("     - BotFather gives you a token like: 123456:ABCdef...");
  console.log("");

  const hasTelegram = !!config.telegramToken;
  if (hasTelegram) {
    console.log(`     Current token: ${config.telegramToken.slice(0, 20)}...`);
    const change = await confirm("     Change it?");
    if (change) {
      const token = await ask("     Paste your bot token");
      if (token) config.telegramToken = token;
    }
  } else {
    const wantTelegram = await confirm("     Do you want to set up a Telegram bot?");
    if (wantTelegram) {
      const token = await ask("     Paste your bot token from @BotFather");
      if (token) config.telegramToken = token;
    }
  }
  console.log("");

  // Save
  saveConfig(config);
  console.log("  Config saved to ~/.ntox/config.json");
  console.log("");

  // What next
  console.log("  What now?");
  console.log("");
  console.log("    npx ntox              — Start the REPL (chat in terminal)");
  if (config.telegramToken) {
    console.log("    npx ntox gateway      — Start the Telegram bot");
  }
  console.log("    npx ntox setup        — Run this wizard again");
  console.log("");

  rl.close();
}

// Allow running directly: npx tsx src/setup.ts
const isMain = process.argv[1]?.endsWith("setup.ts") || process.argv[1]?.endsWith("setup.js");
if (isMain) {
  setup().catch((e) => {
    console.error("Setup failed:", e);
    process.exit(1);
  });
}