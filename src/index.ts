#!/usr/bin/env node

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "gateway") {
    const { runGateway } = await import("./gateway/index.js");
    await runGateway();
  } else if (mode === "setup") {
    const { default: runSetup } = await import("./setup.js");
    await runSetup();
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