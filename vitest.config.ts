import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "desktop/**/*.test.mjs"],
    setupFiles: ["./src/core/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
      thresholds: {
        lines: 40,
        functions: 45,
      },
    },
  },
});
