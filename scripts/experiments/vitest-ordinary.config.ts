/**
 * ORDINARY-environment runner (review requirement #4): runs the memory-security proof
 * file WITHOUT the test-setup NTOX_DIR redirect, i.e. exactly how a misconfigured or
 * setup-less runner would behave — NTOX_DIR pointing at the real ~/.ntox.
 *
 * Expected outcome: the suite FAILS IMMEDIATELY via the ownedTempNtoxDir() beforeAll
 * guard with a [safety] error, before any test body executes — proving the tests cannot
 * write, symlink-manipulate, or recursively delete real user data when isolation is
 * missing. Run alongside the ordinary suite (isolated: must pass; this: must refuse).
 *
 * Usage: npx vitest run --config scripts/experiments/vitest-ordinary.config.ts
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  test: {
    root,
    globals: true,
    environment: "node",
    include: ["src/core/policy-memory.test.ts"],
    setupFiles: [],
    testTimeout: 10000,
  },
});
