import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type ObjectMaskAuditArgs = {
  expected_project_guid?: string;
  sequence_ids?: string[];
};

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

/** A bounded, double-read inventory of document-reported object-mask presence. */
export function getUxpObjectMaskAuditWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    audit_object_masks_uxp: {
      description: "Audit documented Object Mask presence across up to 64 Premiere sequences without changing the project. Omit sequence_ids only when the entire active project has at most 64 sequences; otherwise pass explicit exact GUIDs. The bridge double-reads the active-project identity, aggregate result, and every selected sequence result, rejecting drift instead of returning a mixed audit. It reports only yes/no presence—not mask count, location, tracking, editability, rendered pixels, or playback correctness.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          expected_project_guid: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Optional active-project GUID from a prior native snapshot. Rejects a changed active project before the audit begins.",
          },
          sequence_ids: {
            type: "array", minItems: 1, maxItems: 64, uniqueItems: true,
            description: "Optional exact Premiere sequence GUIDs to audit. Omit only to audit all sequences in a project containing at most 64 sequences.",
            items: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "26.3",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises objectMask.audit.", "Read-only contract tests do not prove a licensed host, mask visuals, tracking state, or playback."],
      },
      handler: async (args: ObjectMaskAuditArgs = {}) => invoke(bridge, "objectMask.audit", {
        ...(args.expected_project_guid === undefined ? {} : { expectedProjectGuid: args.expected_project_guid }),
        ...(args.sequence_ids === undefined ? {} : { sequenceIds: args.sequence_ids }),
      }),
    },
  };
}
