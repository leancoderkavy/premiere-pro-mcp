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
      description: "Switch to a specific workspace layout (e.g., 'Editing', 'Color', 'Audio', 'Effects', 'Graphics')",
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
        const script = buildToolScript(`
          var result = app.setWorkspace("${escapeForExtendScript(args.name)}");
          if (!result) return __error("Failed to set workspace: ${escapeForExtendScript(args.name)}");
          return __result({ set: true, workspace: "${escapeForExtendScript(args.name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
