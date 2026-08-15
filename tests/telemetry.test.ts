import { afterEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => {}),
  constructor: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(apiKey: string, options: unknown) {
      posthog.constructor(apiKey, options);
    }
    capture = posthog.capture;
    shutdown = posthog.shutdown;
  },
}));

const ENV_KEYS = [
  "POSTHOG_API_KEY", "POSTHOG_HOST", "POSTHOG_DISTINCT_ID", "FLY_MACHINE_ID",
  "POSTHOG_ENVIRONMENT", "NODE_ENV", "FLY_REGION", "PREMIERE_MCP_TRANSPORT",
  "npm_package_version",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("telemetry", () => {
  it("is a stable no-op when no API key is configured", async () => {
    delete process.env.POSTHOG_API_KEY;
    const { getTelemetry } = await import("../src/telemetry.js");
    const first = getTelemetry();
    expect(first.enabled).toBe(false);
    expect(getTelemetry()).toBe(first);
    expect(() => first.capture("ignored", { value: 1 })).not.toThrow();
    await expect(first.shutdown()).resolves.toBeUndefined();
    expect(posthog.constructor).not.toHaveBeenCalled();
  });

  it("configures PostHog and merges safe common and event properties", async () => {
    Object.assign(process.env, {
      POSTHOG_API_KEY: "test-key",
      POSTHOG_HOST: "https://example.invalid",
      POSTHOG_DISTINCT_ID: "installation-1",
      POSTHOG_ENVIRONMENT: "test",
      FLY_REGION: "sea",
      PREMIERE_MCP_TRANSPORT: "stdio",
      npm_package_version: "9.8.7",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getTelemetry } = await import("../src/telemetry.js");
    const telemetry = getTelemetry();
    telemetry.capture("tool_called", { service: "override", ok: true });

    expect(posthog.constructor).toHaveBeenCalledWith("test-key", {
      host: "https://example.invalid", flushAt: 1, flushInterval: 10_000,
    });
    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: "installation-1",
      event: "tool_called",
      properties: expect.objectContaining({
        service: "override", service_version: "9.8.7", environment: "test",
        region: "sea", transport: "stdio", ok: true, $process_person_profile: false,
      }),
    });
    await telemetry.shutdown();
    expect(posthog.shutdown).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("telemetry enabled"));
    error.mockRestore();
  });

  it("emits only the bounded activation properties", async () => {
    const { captureActivationEvent } = await import("../src/telemetry.js");
    const telemetry = { enabled: true, capture: vi.fn(), shutdown: vi.fn(async () => {}) };
    captureActivationEvent(telemetry, "premiere_mcp_activation_check_started", { backend: "uxp" });
    captureActivationEvent(telemetry, "premiere_mcp_activation_check_finished", { backend: "cep", outcome: "ready" });
    expect(telemetry.capture).toHaveBeenNthCalledWith(1, "premiere_mcp_activation_check_started", {
      activation_stage: "first_run", backend: "uxp",
    });
    expect(telemetry.capture).toHaveBeenNthCalledWith(2, "premiere_mcp_activation_check_finished", {
      activation_stage: "first_run", backend: "cep", outcome: "ready",
    });
  });
});
