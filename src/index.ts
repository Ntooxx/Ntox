#!/usr/bin/env node

const HELP = `
ntox — cognitive CLI agent

Usage:
  ntox              Start the REPL
  ntox --continue   Resume the most recent REPL session
  ntox --resume <id> Resume a specific saved session
  ntox sessions     List saved sessions
  ntox --lite       Start the REPL with meta engines disabled
  ntox gateway      Start multi-channel gateway (Telegram, Discord, WhatsApp, Web)
  ntox gateway web  Start the local web chat only
  ntox api          Start local HTTP/SSE API for web apps (port from config, default 3100)
  ntox setup        Interactive setup wizard
  ntox doctor       Check config, provider, browser, sandbox, and workspace health
  ntox --help       Show this help
  ntox --version    Show version

Inside the REPL:
  /help             List all commands
  /config           View or set configuration
  /model            Switch model
  /provider         Switch provider

API endpoints (ntox api):
  GET  /api/health          Liveness + current model/provider
  POST /api/chat            { "message": "...", "sessionId": "optional" } → SSE stream
  POST /api/session/reset   { "sessionId": "optional" }

Examples:
  ntox                          # Start chatting
  ntox doctor                   # Diagnose setup problems
  ntox gateway                  # Run as a service
  ntox gateway --channel telegram  # Run Telegram bot only
  ntox gateway web              # Run the browser chat only
  ntox api                      # Expose NTOX to your webapp over HTTP/SSE
`;

async function main(): Promise<void> {
  if (process.argv.includes("--lite")) {
    process.env.NTOX_LITE = "1";
    process.argv = process.argv.filter((a) => a !== "--lite");
  }
  const arg = process.argv[2];
  const wantsContinue = process.argv.includes("--continue") || process.argv.includes("-c");
  const resumeIndex = process.argv.indexOf("--resume");
  const resumeArg = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined;
  if (resumeIndex >= 0 && (!resumeArg || resumeArg.startsWith("-"))) {
    console.error("Usage: ntox --resume <sessionId>");
    process.exit(1);
  }
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
  } else if (arg === "api") {
    const { runApi } = await import("./api/server.js");
    await runApi();
  } else if (arg === "setup") {
    const { default: runSetup } = await import("./setup.js");
    await runSetup();
  } else if (arg === "doctor") {
    const { default: runDoctor } = await import("./doctor.js");
    await runDoctor();
  } else if (arg === "sessions") {
    const { listSessionSnapshots } = await import("./core/session-store.js");
    const sessions = listSessionSnapshots(20);
    if (sessions.length === 0) {
      console.log("No saved sessions.");
      return;
    }
    for (const session of sessions) {
      const when = new Date(session.savedAt).toLocaleString();
      console.log(`${session.id}  ${when}  ${session.source}  ${session.messageCount} msgs  ${session.title}`);
    }
  } else {
    const { Repl } = await import("./cli/repl.js");
    let resumeSessionId = resumeArg;
    if (!resumeSessionId && wantsContinue) {
      const { getLastSessionId } = await import("./core/session-store.js");
      resumeSessionId = getLastSessionId("repl") ?? undefined;
      if (!resumeSessionId) console.log("No saved REPL session found; starting fresh.");
    }
    const repl = new Repl({ resumeSessionId });
    await repl.start();
  }
}

main().catch((e: unknown) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
