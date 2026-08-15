import { afterEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({ constructor: vi.fn(), capture: vi.fn() }));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(apiKey: string, options: unknown) {
      posthog.constructor(apiKey, options);
    }
    capture = posthog.capture;
    shutdown = vi.fn(async () => {});
  },
}));

const keys = [
  "POSTHOG_API_KEY", "POSTHOG_HOST", "POSTHOG_DISTINCT_ID", "FLY_MACHINE_ID",
  "POSTHOG_ENVIRONMENT", "NODE_ENV", "FLY_REGION", "PREMIERE_MCP_TRANSPORT",
  "npm_package_version",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function clearTelemetryEnvironment(): void {
  for (const key of keys) delete process.env[key];
}

describe("telemetry environment fallbacks", () => {
  it("uses Fly identity, Node environment, and default host/metadata", async () => {
    clearTelemetryEnvironment();
    Object.assign(process.env, {
      POSTHOG_API_KEY: "key",
      FLY_MACHINE_ID: "machine-1",
      NODE_ENV: "development",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getTelemetry } = await import("../src/telemetry.js");
    getTelemetry().capture("fallbacks");

    expect(posthog.constructor).toHaveBeenCalledWith("key", expect.objectContaining({
      host: "https://us.i.posthog.com",
    }));
    expect(posthog.capture).toHaveBeenCalledWith(expect.objectContaining({
      distinctId: "machine-1",
      properties: expect.objectContaining({
        service_version: "unknown",
        environment: "development",
        transport: "unknown",
      }),
    }));
  });

  it("generates an anonymous server identity and defaults to production", async () => {
    clearTelemetryEnvironment();
    process.env.POSTHOG_API_KEY = "key";
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getTelemetry } = await import("../src/telemetry.js");
    getTelemetry().capture("anonymous");

    expect(posthog.capture).toHaveBeenCalledWith(expect.objectContaining({
      distinctId: expect.stringMatching(/^server-[0-9a-f-]{36}$/i),
      properties: expect.objectContaining({ environment: "production" }),
    }));
  });
});
