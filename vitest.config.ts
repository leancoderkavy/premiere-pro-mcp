import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/resources/**/*.json"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 91,
        branches: 90,
        functions: 94,
        // Windows-only platform branches produce a slightly lower line result in CI.
        lines: 93,
      },
    },
  },
});
