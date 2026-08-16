import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

const WAIT_RESPONSE_BUFFER_MS = 5_000;

type EventArgs = {
  action?: string;
  after_revision?: number;
  categories?: string[];
  event_names?: string[];
  limit?: number;
  timeout_ms?: number;
};

type ReadinessArgs = {
  action?: string;
  sequence_id?: string;
  expected_sequence_id?: string;
  operation_type?: string;
  after_revision?: number;
  timeout_ms?: number;
  poll_min_ms?: number;
  poll_max_ms?: number;
};

function invoke(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown> = {},
  hostWaitMs?: number,
) {
  const request = hostWaitMs === undefined
    ? bridge.request(command, args)
    : bridge.request(command, args, { minimumTimeoutMs: hostWaitMs + WAIT_RESPONSE_BUFFER_MS });
  return request
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
          after_revision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
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
        if (args.action === "wait") {
          return invoke(bridge, "events.wait", eventQuery(args, true), args.timeout_ms ?? 0);
        }
        return { success: false, error: `Unsupported event action: ${String(args.action)}` };
      },
    },
    wait_for_host_readiness_uxp: {
      description: "Capture a pre-dispatch readiness revision or wait, without retrying, for video-effect analysis or one documented operation-completion receipt.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["snapshot", "analysis", "operation"] },
          sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          operation_type: { type: "string", enum: ["import", "export", "effect_drop", "generative_extend"] },
          after_revision: {
            type: "integer", minimum: 0,
            description: "Required for operation waits; capture it with snapshot before dispatching the operation.",
          },
          timeout_ms: { type: "integer", minimum: 0, maximum: 60000 },
          poll_min_ms: { type: "integer", minimum: 100, maximum: 2000 },
          poll_max_ms: { type: "integer", minimum: 100, maximum: 5000 },
        },
        required: ["action"],
      },
      handler: async (args: ReadinessArgs) => {
        if (args.action === "snapshot") {
          return invoke(bridge, "readiness.snapshot", {
            ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
          });
        }
        if (args.action === "analysis") {
          return invoke(bridge, "readiness.analysis.wait", {
            ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
            ...(args.expected_sequence_id !== undefined ? { expectedSequenceId: args.expected_sequence_id } : {}),
            ...(args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
            ...(args.poll_min_ms !== undefined ? { pollMinMs: args.poll_min_ms } : {}),
            ...(args.poll_max_ms !== undefined ? { pollMaxMs: args.poll_max_ms } : {}),
          });
        }
        if (args.action === "operation") {
          const operations: Record<string, string> = {
            import: "import", export: "export", effect_drop: "effectDrop", generative_extend: "generativeExtend",
          };
          return invoke(bridge, "readiness.operation.wait", {
            ...(args.operation_type !== undefined ? { operationType: operations[args.operation_type] } : {}),
            ...(args.after_revision !== undefined ? { afterRevision: args.after_revision } : {}),
            ...(args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
          });
        }
        return { success: false, error: `Unsupported readiness action: ${String(args.action)}` };
      },
    },
  };
}
