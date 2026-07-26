import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

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

export function getUxpTools(bridge: UxpWebSocketBridge) {
  return {
    get_uxp_capabilities: {
      description: "Report the authenticated local UXP bridge connection and the capabilities advertised by the connected Premiere host.",
      parameters: {},
      handler: async () => ({ success: true, data: bridge.getState() }),
    },
    get_uxp_state: {
      description: "Read the active project, sequence, and playhead state through the connected Premiere UXP bridge.",
      parameters: {},
      handler: async () => invoke(bridge, "state.get"),
    },
    export_frame_uxp: {
      description: "Export a sequence frame through Premiere's supported UXP Exporter and verify the output file in the host panel.",
      parameters: {
        type: "object" as const,
        properties: {
          output_directory: {
            type: "string",
            description: "Existing local directory available to the Premiere UXP plugin.",
          },
          filename: {
            type: "string",
            description: "Simple PNG filename without directory components.",
          },
          seconds: {
            type: "number",
            description: "Sequence time in seconds; omit to use the playhead.",
          },
          width: { type: "number", description: "Optional positive output width." },
          height: { type: "number", description: "Optional positive output height." },
        },
        required: ["output_directory", "filename"],
      },
      handler: async (args: {
        output_directory: string;
        filename: string;
        seconds?: number;
        width?: number;
        height?: number;
      }) => invoke(bridge, "frame.export", {
        outputDirectory: args.output_directory,
        filename: args.filename,
        ...(args.seconds === undefined ? {} : { seconds: args.seconds }),
        ...(args.width === undefined ? {} : { width: args.width }),
        ...(args.height === undefined ? {} : { height: args.height }),
      }),
    },
  };
}
