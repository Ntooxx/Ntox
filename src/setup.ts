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

  // Step 4: Discord bot
  console.log("  4. Discord Bot (optional)");
  console.log("     To chat with NTOX on Discord:");
  console.log("     - Create app at https://discord.com/developers/applications");
  console.log("     - Go to Bot > Reset Token and copy it");
  console.log("     - Enable MESSAGE CONTENT INTENT under Privileged Gateway Intents");
  console.log("     - Invite with: https://discord.com/api/oauth2/authorize?client_id=YOUR_ID&permissions=3072&scope=bot");
  console.log("");

  const hasDiscord = !!config.discordToken;
  if (hasDiscord) {
    console.log(`     Current token: ${config.discordToken.slice(0, 20)}...`);
    const change = await confirm("     Change it?");
    if (change) {
      const token = await ask("     Paste your bot token");
      if (token) config.discordToken = token;
    }
  } else {
    const wantDiscord = await confirm("     Do you want to set up a Discord bot?");
    if (wantDiscord) {
      const token = await ask("     Paste your bot token from Developer Portal");
      if (token) config.discordToken = token;
    }
  }
  console.log("");

  // Step 5: WhatsApp Business
  console.log("  5. WhatsApp Business API (optional)");
  console.log("     To chat with NTOX on WhatsApp:");
  console.log("     - Go to https://developers.facebook.com/apps/");
  console.log("     - Create a Business app with WhatsApp integration");
  console.log("     - Copy the Phone Number ID, Token, and create a Verify Token");
  console.log("     - Set up webhook URL: https://YOUR_DOMAIN/webhook (requires HTTPS)");
  console.log("");

  const hasWhatsApp = !!config.whatsappToken;
  if (hasWhatsApp) {
    console.log(`     Current token: ${config.whatsappToken.slice(0, 20)}...`);
    const change = await confirm("     Change WhatsApp settings?");
    if (change) {
      const token = await ask("     Paste your WhatsApp token");
      if (token) config.whatsappToken = token;
      const phoneNumberId = await ask("     Paste your Phone Number ID");
      if (phoneNumberId) config.whatsappPhoneNumberId = phoneNumberId;
      const verifyToken = await ask("     Create a Verify Token");
      if (verifyToken) config.whatsappVerifyToken = verifyToken;
      const port = await ask(`     Webhook port [${config.whatsappPort || 3001}]`);
      if (port) config.whatsappPort = parseInt(port, 10) || 3001;
    }
  } else {
    const wantWhatsApp = await confirm("     Do you want to set up WhatsApp?");
    if (wantWhatsApp) {
      const token = await ask("     Paste your WhatsApp token");
      if (token) config.whatsappToken = token;
      const phoneNumberId = await ask("     Paste your Phone Number ID");
      if (phoneNumberId) config.whatsappPhoneNumberId = phoneNumberId;
      const verifyToken = await ask("     Create a Verify Token");
      if (verifyToken) config.whatsappVerifyToken = verifyToken;
    }
  }
  console.log("");

  // Step 6: Web UI
  console.log("  6. Web UI (optional)");
  console.log("     NTOX comes with a built-in web chat interface.");
  console.log("");

  const webPort = await ask(`     Web UI port [${config.webPort || 3000}]`);
  if (webPort) config.webPort = parseInt(webPort, 10) || 3000;
  const webHost = await ask(`     Web UI host [${config.webHost || "127.0.0.1"}]`);
  if (webHost) config.webHost = webHost;
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
    console.log("    npx ntox gateway      — Start all configured channels");
  }
  if (config.discordToken) {
    console.log("    npx ntox gateway discord — Start Discord bot only");
  }
  if (config.whatsappToken) {
    console.log("    npx ntox gateway      — WhatsApp included in gateway");
  }
  console.log(`    npx ntox gateway web  — Web UI at http://${config.webHost || "127.0.0.1"}:${config.webPort || 3000}`);
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