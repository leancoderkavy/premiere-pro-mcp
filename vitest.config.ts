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
        // V8 reports the same exercised branches differently across supported
        // Node majors; Node 22 currently reports 89.14% while 20 and 24 clear 90%.
        branches: 89,
        functions: 94,
        // Windows-only platform branches produce a slightly lower line result in CI.
        lines: 93,
      },
    },
  },
});
