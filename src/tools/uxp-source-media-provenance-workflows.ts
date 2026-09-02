import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type SourceMediaProvenanceArgs = {
  project_item_id: string;
  include_media_file_path?: boolean;
  include_originating_project_path?: boolean;
};

function invoke(bridge: UxpWebSocketBridge, args: Record<string, unknown>) {
  return bridge.request("source.provenance.inspect", args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

/** Read selected native source-media provenance paths for one explicit project item. */
export function getUxpSourceMediaProvenanceWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_source_media_provenance_uxp: {
      description: "Read selected documented source-media provenance paths for one explicit media-backed Project item. At least one explicit include flag is required before either native path is queried or returned. The command resolves the requested item through a bounded Project-item tree twice and rejects a changed project, target item, or requested path; it does not enumerate folders in its response, access the filesystem, inspect media contents or metadata, validate a path's existence, modify Premiere, prove an atomic snapshot, origin lineage, rights, persistence, or licensed-host behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact media-backed Project-item ID from a recent native project inspection." },
          include_media_file_path: { type: "boolean", description: "Must be true to query and return the native media-file path; otherwise it is not read." },
          include_originating_project_path: { type: "boolean", description: "Must be true to query and return the native originating-project path; otherwise it is not read." },
        },
        required: ["project_item_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      availability: {
        backend: "uxp", minimumPremiereVersion: "26.3.0", capability: "source.provenance.inspect",
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises source.provenance.inspect.",
          "At least one path-disclosure opt-in must be true. The bridge bounds traversal to 4096 reachable items and each selected native path to 4096 characters.",
          "The complete selected snapshot is read twice, but Adobe exposes no atomic read transaction; a UI or another extension can still change a value between native calls.",
        ],
      },
      handler: async (args: SourceMediaProvenanceArgs) => invoke(bridge, {
        projectItemId: args.project_item_id,
        ...(args.include_media_file_path === undefined ? {} : { includeMediaFilePath: args.include_media_file_path }),
        ...(args.include_originating_project_path === undefined ? {} : { includeOriginatingProjectPath: args.include_originating_project_path }),
      }),
    },
  };
}
