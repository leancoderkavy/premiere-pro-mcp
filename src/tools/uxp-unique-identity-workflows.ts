import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type UniqueIdentityArgs = {
  project_item_id?: string;
  sequence_guid?: string;
  expected_project_guid?: string;
  expected_unique_id?: string;
};

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

/** Read an opaque native serializable identity without retaining or mutating it. */
export function getUxpUniqueIdentityWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_unique_object_identity_uxp: {
      description: "Read the opaque documented Premiere unique serializable identity for exactly one existing project item or sequence, without changing the project. Select exactly one locator. The bridge independently resolves and reads the target twice, rejecting an active-project, locator, or unique-identity change rather than returning a mixed snapshot. It does not expose paths, metadata, content, timeline placement, editability, rendering, playback, persistence guarantees, or a licensed-host result.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_item_id: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Exact Premiere project-item ID to resolve within at most 512 project-tree items. Provide this or sequence_guid, but not both.",
          },
          sequence_guid: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Exact Premiere sequence GUID to resolve. Provide this or project_item_id, but not both.",
          },
          expected_project_guid: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Optional active-project GUID from a prior native snapshot. Rejects inspection if it no longer matches before the second read.",
          },
          expected_unique_id: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Optional expected opaque serializable identity. Rejects inspection if the first native target read does not match.",
          },
        },
        oneOf: [
          { required: ["project_item_id"] },
          { required: ["sequence_guid"] },
        ],
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "26.3",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises object.uniqueIdentity.inspect.",
          "Contract tests do not prove a licensed host, identity lifetime across sessions, or that an identity authorizes a later edit.",
        ],
      },
      handler: async (args: UniqueIdentityArgs = {}) => invoke(bridge, "object.uniqueIdentity.inspect", {
        ...(args.project_item_id === undefined ? {} : { projectItemId: args.project_item_id }),
        ...(args.sequence_guid === undefined ? {} : { sequenceGuid: args.sequence_guid }),
        ...(args.expected_project_guid === undefined ? {} : { expectedProjectGuid: args.expected_project_guid }),
        ...(args.expected_unique_id === undefined ? {} : { expectedUniqueId: args.expected_unique_id }),
      }),
    },
  };
}
