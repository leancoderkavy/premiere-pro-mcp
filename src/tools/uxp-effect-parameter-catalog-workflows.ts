import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type EffectParameterCatalogArgs = {
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  component_index: number;
  expected_sequence_guid?: string;
  expected_component_id?: string;
};

function invoke(bridge: UxpWebSocketBridge, args: Record<string, unknown>) {
  return bridge.request("parameters.catalog.inspect", args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

/** Bounded component-parameter discovery without reading raw parameter values. */
export function getUxpEffectParameterCatalogWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_effect_parameter_catalog_uxp: {
      description: "Inspect the bounded native descriptor catalog for one effect component on one active-sequence audio or video clip. The returned parameter index and display name can be used with existing parameter automation. It returns only animation capability/state, never raw parameter values (including Color or PointF), media paths, rendered pixels, or playback results. The bridge reads the complete catalog twice and rejects a changed project, active sequence, component identity, or parameter descriptor set.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          media_type: { type: "string", enum: ["video", "audio"] },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 511 },
          component_index: { type: "integer", minimum: 0, maximum: 511 },
          expected_sequence_guid: { type: "string", minLength: 1, maxLength: 512, description: "Optional active-sequence GUID from a prior catalog inspection. A changed sequence is rejected." },
          expected_component_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional component match or display name returned by a prior catalog inspection. A changed component is rejected." },
        },
        required: ["media_type", "track_index", "clip_index", "component_index"],
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "25.6",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Requires an authenticated UXP bridge whose capability handshake advertises parameters.catalog.inspect.", "Contract tests do not prove a licensed Premiere host, parameter values, editability, rendered output, playback, persistence, or Undo behavior."],
      },
      handler: async (args: EffectParameterCatalogArgs) => invoke(bridge, {
        mediaType: args.media_type,
        trackIndex: args.track_index,
        clipIndex: args.clip_index,
        componentIndex: args.component_index,
        ...(args.expected_sequence_guid === undefined ? {} : { expectedSequenceGuid: args.expected_sequence_guid }),
        ...(args.expected_component_id === undefined ? {} : { expectedComponentId: args.expected_component_id }),
      }),
    },
  };
}
