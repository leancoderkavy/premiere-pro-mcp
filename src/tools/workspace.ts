import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, sendPanelCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getWorkspaceTools(bridgeOptions: BridgeOptions) {
  return {
    get_workspaces: {
      description: "List all available workspace layouts in Premiere Pro",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var workspaces = app.getWorkspaces();
          if (!workspaces) return __refuse("Could not retrieve workspaces");
          var list = [];
          for (var i = 0; i < workspaces.length; i++) {
            list.push(workspaces[i]);
          }
          return __result({ workspaces: list, count: list.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_workspace: {
      description: "Request a workspace layout. The documented API has no current-workspace getter; acceptance is committed_unverified and the visible layout must be checked in Premiere.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name of the workspace to activate (use get_workspaces to see available options)",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string }) => {
        if (typeof args.name !== "string" || !args.name.trim()) return { success: false, error: "name must be a non-empty workspace name." };
        const script = buildToolScript(`
          var result = app.setWorkspace("${escapeForExtendScript(args.name)}");
          if (result === false) return __error("Failed to set workspace: ${escapeForExtendScript(args.name)}", { set: false, verified: false, outcome: "failed" });
          return __result({ set: result === true ? true : null, workspace: "${escapeForExtendScript(args.name)}", requestedWorkspace: "${escapeForExtendScript(args.name)}", appliedWorkspace: null, verified: false, outcome: "committed_unverified", verification: "api-return", limitation: "The documented API has no current-workspace getter; check the visible layout in Premiere." });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_extensions: {
      description: "List the CEP extension panels installed in Premiere Pro (id, name, window type, and the isActive flag CEP reports). isActive does not show whether a panel is open: in Premiere 26.3 it stayed false for open panels. Use an id with open_extension. CEP connector only.",
      parameters: {},
      handler: async () => sendPanelCommand({ action: "list_extensions" }, bridgeOptions),
    },

    open_extension: {
      description: "Open an installed CEP extension panel in Premiere Pro by its extension id (see list_extensions). CEP has no panel-visibility getter, so success is committed_unverified: check the panel in Premiere. Another extension cannot be closed from here. CEP connector only.",
      parameters: {
        type: "object" as const,
        properties: {
          extension_id: {
            type: "string",
            description: "Extension id from list_extensions, for example com.example.panel",
          },
          params: {
            type: "string",
            description: "Optional startup parameters passed to the extension; usually omitted",
          },
        },
        required: ["extension_id"],
      },
      handler: async (args: { extension_id: string; params?: string }) => {
        if (typeof args.extension_id !== "string" || !args.extension_id.trim()) {
          return { success: false, error: "extension_id must be a non-empty extension id (see list_extensions)." };
        }
        return sendPanelCommand({ action: "open_extension", extensionId: args.extension_id.trim(), params: typeof args.params === "string" ? args.params : "" }, bridgeOptions);
      },
    },
  };
}
