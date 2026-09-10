import { defineConfig } from "@playwright/test"

const port = Number(process.env.LANDING_E2E_PORT || 3160)

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    // Deliberately exercise enrollment against the local fixture. Production
    // correctly excludes Playwright's normal HeadlessChrome user agent.
    userAgent: "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36",
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
})
