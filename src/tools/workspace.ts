import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getWorkspaceTools(bridgeOptions: BridgeOptions) {
  return {
    get_workspaces: {
      description: "List all available workspace layouts in Premiere Pro",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var workspaces = app.getWorkspaces();
          if (!workspaces) return __error("Could not retrieve workspaces");
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
  };
}
