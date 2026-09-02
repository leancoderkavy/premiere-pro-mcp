import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type SourceProxyArgs = {
  project_item_id: string;
  include_proxy_path?: boolean;
};

function invoke(bridge: UxpWebSocketBridge, args: Record<string, unknown>) {
  return bridge.request("source.proxy.inspect", args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

/** Read bounded native proxy readiness for one explicit media-backed Project item. */
export function getUxpSourceProxyWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_source_proxy_uxp: {
      description: "Read documented proxy-readiness state for one explicit media-backed Project item. Proxy attachment state, offline state, and native capability booleans are read twice through a bounded Project-item tree; a native proxy path is queried and returned only when include_proxy_path is true and a proxy is reported attached. The command rejects changed project, target, or selected proxy state. It does not enumerate folders in its response, does not access the filesystem, validate a path's existence, inspect media contents, attach or relink proxy media, modify Premiere, prove an atomic snapshot, proxy compatibility, playback, persistence, Undo, or licensed-host behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact media-backed Project-item ID from a recent native Project inspection." },
          include_proxy_path: { type: "boolean", description: "When true, query and return the native proxy path only if Premiere reports an attached proxy. Otherwise the path getter is not called." },
        },
        required: ["project_item_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      availability: {
        backend: "uxp", minimumPremiereVersion: "26.3.0", capability: "source.proxy.inspect",
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises source.proxy.inspect.",
          "The bridge bounds traversal to 4096 reachable items and an explicitly requested native proxy path to 4096 characters.",
          "The complete selected snapshot is read twice, but Adobe exposes no atomic read transaction; a UI or another extension can still change a value between native calls.",
        ],
      },
      handler: async (args: SourceProxyArgs) => invoke(bridge, {
        projectItemId: args.project_item_id,
        ...(args.include_proxy_path === undefined ? {} : { includeProxyPath: args.include_proxy_path }),
      }),
    },
  };
}
