import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type TickTimeArithmeticArgs = {
  operation: "add" | "subtract" | "multiply" | "divide";
  base_ticks: string;
  operand_ticks?: string;
  factor?: number;
};

function invoke(bridge: UxpWebSocketBridge, args: Record<string, unknown>) {
  return bridge.request("time.tickArithmetic.inspect", args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

/** Native, read-only TickTime arithmetic over already-quantized Premiere ticks. */
export function getUxpTickTimeArithmeticWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    calculate_tick_time_uxp: {
      description: "Calculate one bounded add, subtract, multiply, or divide operation using Premiere's documented native TickTime arithmetic over canonical tick integers. It returns native ticks and seconds readback only. It deliberately does not accept seconds or frame rates, align to frames, infer timecode, inspect any Premiere project object, mutate Premiere, or prove a licensed host.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
          base_ticks: { type: "string", pattern: "^(?:0|-?[1-9][0-9]{0,17})$", description: "Canonical signed Premiere tick integer (at most 18 digits)." },
          operand_ticks: { type: "string", pattern: "^(?:0|-?[1-9][0-9]{0,17})$", description: "Required for add or subtract; forbidden for multiply or divide." },
          factor: { type: "integer", minimum: -1_000_000, maximum: 1_000_000, not: { const: 0 }, description: "Required non-zero integer factor for multiply or divide; forbidden for add or subtract." },
        },
        required: ["operation", "base_ticks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "25.6",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises time.tickArithmetic.inspect.", "Contract tests verify the documented-call protocol, not a licensed Premiere host, frame alignment, sequence timecode, rendered output, or playback."],
      },
      handler: async (args: TickTimeArithmeticArgs) => invoke(bridge, {
        operation: args.operation,
        baseTicks: args.base_ticks,
        ...(args.operand_ticks === undefined ? {} : { operandTicks: args.operand_ticks }),
        ...(args.factor === undefined ? {} : { factor: args.factor }),
      }),
    },
  };
}
