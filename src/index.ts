#!/usr/bin/env node

const HELP = `
ntox — cognitive CLI agent

Usage:
  ntox              Start the REPL
  ntox gateway      Start multi-channel gateway (Telegram, Discord, WhatsApp, Web)
  ntox gateway web  Start the local web chat only
  ntox setup        Interactive setup wizard
  ntox doctor       Check config, provider, browser, sandbox, and workspace health
  ntox --help       Show this help
  ntox --version    Show version

Inside the REPL:
  /help             List all commands
  /config           View or set configuration
  /model            Switch model
  /provider         Switch provider

Examples:
  ntox                          # Start chatting
  ntox doctor                   # Diagnose setup problems
  ntox gateway                  # Run as a service
  ntox gateway --channel telegram  # Run Telegram bot only
  ntox gateway web              # Run the browser chat only
`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(HELP);
    return;
  }
  if (arg === "--version" || arg === "-v") {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname ?? ".", "..", "package.json"), "utf-8"));
    console.log(pkg.version);
    return;
  }
  if (arg === "gateway") {
    const { runGateway } = await import("./gateway/index.js");
    const channelArg = process.argv[3] === "--channel" ? process.argv[4] : process.argv[3];
    await runGateway(channelArg);
  } else if (arg === "setup") {
    const { default: runSetup } = await import("./setup.js");
    await runSetup();
  } else if (arg === "doctor") {
    const { default: runDoctor } = await import("./doctor.js");
    await runDoctor();
  } else {
    const { Repl } = await import("./cli/repl.js");
    const repl = new Repl();
    await repl.start();
  }
}

main().catch((e: unknown) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
