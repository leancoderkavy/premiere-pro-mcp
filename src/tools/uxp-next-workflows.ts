import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type EventArgs = {
  action?: string;
  after_revision?: number;
  categories?: string[];
  event_names?: string[];
  limit?: number;
  timeout_ms?: number;
};

function invoke(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown> = {},
) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

function eventQuery(args: EventArgs, includeTimeout: boolean) {
  return {
    ...(args.after_revision !== undefined ? { afterRevision: args.after_revision } : {}),
    ...(args.categories !== undefined ? { categories: args.categories } : {}),
    ...(args.event_names !== undefined ? { eventNames: args.event_names } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(includeTimeout && args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
  };
}

export function getUxpNextWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_premiere_events_uxp: {
      description: "List or briefly wait for bounded, redacted Premiere host-event receipts without polling the complete project state.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["list", "wait"] },
          after_revision: { type: "integer", minimum: 0 },
          categories: {
            type: "array", maxItems: 32, uniqueItems: true,
            items: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          },
          event_names: {
            type: "array", maxItems: 32, uniqueItems: true,
            items: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          },
          limit: { type: "integer", minimum: 1, maximum: 256 },
          timeout_ms: {
            type: "integer", minimum: 0, maximum: 60000,
            description: "Used only by wait; zero performs a non-blocking check.",
          },
        },
        required: ["action"],
      },
      handler: async (args: EventArgs) => {
        if (args.action === "list") return invoke(bridge, "events.list", eventQuery(args, false));
        if (args.action === "wait") return invoke(bridge, "events.wait", eventQuery(args, true));
        return { success: false, error: `Unsupported event action: ${String(args.action)}` };
      },
    },
  };
}
