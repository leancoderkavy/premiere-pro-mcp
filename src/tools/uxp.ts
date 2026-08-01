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
  const operationId = {
    type: "string" as const,
    description: "Optional idempotency key (1-128 letters, numbers, dot, underscore, colon, or dash).",
  };
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
    inspect_project_uxp: {
      description: "Read a compact, revisioned project and sequence snapshot through documented Premiere UXP APIs.",
      parameters: {},
      handler: async () => invoke(bridge, "project.snapshot"),
    },
    save_project_uxp: {
      description: "Save the active project through UXP and require Premiere to confirm success.",
      parameters: {
        type: "object" as const,
        properties: { operation_id: operationId },
      },
      handler: async (args: { operation_id?: string }) => invoke(bridge, "project.save", {
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    create_sequence_with_preset_uxp: {
      description: "Create and verify a sequence from a preset path using the documented Premiere 26.3+ UXP API.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "New sequence name." },
          preset_path: { type: "string", description: "Local Premiere sequence preset path." },
          operation_id: operationId,
        },
        required: ["name", "preset_path"],
      },
      handler: async (args: { name: string; preset_path: string; operation_id?: string }) => invoke(bridge, "sequence.createPreset", {
        name: args.name, presetPath: args.preset_path,
        ...(args.operation_id ? { operationId: args.operation_id } : {}),
      }),
    },
    export_interchange_uxp: {
      description: "Export the active sequence as OpenTimelineIO or Final Cut Pro XML with explicit verification.",
      parameters: {
        type: "object" as const,
        properties: {
          format: { type: "string", enum: ["otio", "fcpxml"], description: "Interchange format." },
          output_file_path: { type: "string", description: "Absolute output file path." },
          suppress_ui: { type: "boolean", description: "Suppress Premiere export UI; defaults to true." },
          operation_id: operationId,
        },
        required: ["format", "output_file_path"],
      },
      handler: async (args: { format: "otio" | "fcpxml"; output_file_path: string; suppress_ui?: boolean; operation_id?: string }) =>
        invoke(bridge, "interchange.export", {
          format: args.format, outputFilePath: args.output_file_path,
          ...(args.suppress_ui === undefined ? {} : { suppressUI: args.suppress_ui }),
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
    },
    get_transcript_languages_uxp: {
      description: "List transcription languages supported by the connected Premiere 26.3+ host.",
      parameters: {},
      handler: async () => invoke(bridge, "transcript.languages"),
    },
    detect_object_masks_uxp: {
      description: "Detect whether the active project or sequence contains an Object Mask using Premiere 26.3+.",
      parameters: {
        type: "object" as const,
        properties: { scope: { type: "string", enum: ["sequence", "project"], description: "Inspection scope; defaults to sequence." } },
      },
      handler: async (args: { scope?: "sequence" | "project" }) => invoke(bridge, "objectMask.has", args.scope ? { scope: args.scope } : {}),
    },
    configure_encoder_uxp: {
      description: "Launch or configure Adobe Media Encoder and optionally start its queued batch using Premiere 26.3+.",
      parameters: {
        type: "object" as const,
        properties: {
          launch: { type: "boolean", description: "Launch AME if needed." },
          embedded_xmp: { type: "boolean", description: "Enable or disable embedded XMP." },
          sidecar_xmp: { type: "boolean", description: "Enable or disable sidecar XMP." },
          start_batch: { type: "boolean", description: "Start queued AME encodes." },
          operation_id: operationId,
        },
      },
      handler: async (args: { launch?: boolean; embedded_xmp?: boolean; sidecar_xmp?: boolean; start_batch?: boolean; operation_id?: string }) =>
        invoke(bridge, "encoder.configure", {
          ...(args.launch === undefined ? {} : { launch: args.launch }),
          ...(args.embedded_xmp === undefined ? {} : { embeddedXmp: args.embedded_xmp }),
          ...(args.sidecar_xmp === undefined ? {} : { sidecarXmp: args.sidecar_xmp }),
          ...(args.start_batch === undefined ? {} : { startBatch: args.start_batch }),
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        }),
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
