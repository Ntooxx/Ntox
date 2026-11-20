#!/usr/bin/env node
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const command = argv[0] ?? "--help";

function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function help(): void {
  console.log(`ntox-harness

Usage:
  ntox-harness verify --request <file.json> [--ntox-dir <dir>]
  ntox-harness stats  [--ntox-dir <dir>]

The harness owns the Ed25519 keypair and the promotion gate. The agent process
must never be able to call this command with its own credentials.
`);
}

async function main(): Promise<void> {
  if (command === "--help" || command === "-h") {
    help();
    return;
  }

  const dir = option("--ntox-dir");
  if (dir) process.env.NTOX_DIR = dir;
  const { NtoxHarnessAuthority } = await import("./authority.js");

  if (command === "verify") {
    const requestPath = option("--request");
    if (!requestPath) throw new Error("verify requires --request <file.json>");
    const request = JSON.parse(readFileSync(requestPath, "utf8"));
    const authority = new NtoxHarnessAuthority({ keyDir: dir });
    const result = authority.verifyAndPromote(request);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "stats") {
    const authority = new NtoxHarnessAuthority({ keyDir: dir });
    console.log(JSON.stringify(authority.stats(), null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
