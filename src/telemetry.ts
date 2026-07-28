import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

export type TelemetryProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface Telemetry {
  readonly enabled: boolean;
  capture(event: string, properties?: TelemetryProperties): void;
  shutdown(): Promise<void>;
}

class PostHogTelemetry implements Telemetry {
  readonly enabled = true;

  constructor(
    private readonly client: PostHog,
    private readonly distinctId: string,
    private readonly commonProperties: TelemetryProperties,
  ) {}

  capture(event: string, properties: TelemetryProperties = {}): void {
    this.client.capture({
      distinctId: this.distinctId,
      event,
      properties: {
        ...this.commonProperties,
        ...properties,
        $process_person_profile: false,
      },
    });
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }
}

const disabledTelemetry: Telemetry = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};

let telemetry: Telemetry | undefined;

export function getTelemetry(): Telemetry {
  if (telemetry) return telemetry;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    telemetry = disabledTelemetry;
    return telemetry;
  }

  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  const distinctId =
    process.env.POSTHOG_DISTINCT_ID ??
    process.env.FLY_MACHINE_ID ??
    `server-${randomUUID()}`;
  const client = new PostHog(apiKey, {
    host,
    flushAt: 20,
    flushInterval: 10_000,
  });

  telemetry = new PostHogTelemetry(client, distinctId, {
    service: "premiere-pro-mcp",
    service_version: process.env.npm_package_version ?? "unknown",
    environment: process.env.POSTHOG_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    region: process.env.FLY_REGION,
    transport: process.env.PREMIERE_MCP_TRANSPORT ?? "unknown",
  });

  console.error(`[premiere-pro-mcp] PostHog telemetry enabled (${host})`);
  return telemetry;
}
