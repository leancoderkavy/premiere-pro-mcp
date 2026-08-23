import { buildToolScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import {
  buildProjectIntakeReport,
  MAX_PROJECT_INTAKE_ITEMS,
} from "../intake/project-intake.js";

export interface ProjectIntakeToolDependencies {
  captureSnapshot?: (maxItems: number) => Promise<CommandResult>;
}

function boundedMaxItems(value: unknown): number {
  if (value === undefined) return MAX_PROJECT_INTAKE_ITEMS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PROJECT_INTAKE_ITEMS) {
    throw new Error(`max_items must be an integer from 1 through ${MAX_PROJECT_INTAKE_ITEMS}`);
  }
  return value;
}

/**
 * Capture only the bounded fields required by the pure intake evaluator. The
 * script does not require an active sequence and never changes Premiere.
 */
export function projectIntakeCaptureScript(maxItems: number): string {
  return buildToolScript(`
    var project = app.project;
    if (!project || !project.rootItem) return __error("No project is open");

    var maximumItems = ${maxItems};
    var items = [];
    var truncated = false;

    function itemType(item) {
      if (item.type === 2) return "bin";
      if (item.type === 1 || item.type === 4) return "clip";
      return "other";
    }

    function walk(parent, parentId, depth) {
      if (!parent || !parent.children || depth > 32) {
        if (depth > 32) truncated = true;
        return;
      }
      for (var i = 0; i < parent.children.numItems; i++) {
        if (items.length >= maximumItems) { truncated = true; return; }
        var item = parent.children[i];
        var entry = {
          id: String(item.nodeId),
          name: String(item.name),
          type: itemType(item),
          parentId: String(parentId || "root")
        };
        try { if (item.treePath) entry.treePath = String(item.treePath); } catch(e) {}
        try {
          var mediaPath = item.getMediaPath();
          if (mediaPath) entry.mediaPath = String(mediaPath);
        } catch(e) {}
        try { entry.offline = Boolean(item.isOffline()); } catch(e) {}
        try { entry.hasProxy = Boolean(item.hasProxy()); } catch(e) {}
        try {
          var interpretation = item.getFootageInterpretation();
          if (interpretation && interpretation.frameRate) entry.frameRate = Number(interpretation.frameRate);
        } catch(e) {}
        items.push(entry);
        if (item.type === 2) walk(item, item.nodeId, depth + 1);
        if (truncated && items.length >= maximumItems) return;
      }
    }

    walk(project.rootItem, "root", 0);
    var projectId = "";
    try { if (project.documentID) projectId = String(project.documentID); } catch(e) {}
    if (!projectId) projectId = String(project.name);

    return __result({
      project: { id: projectId, name: String(project.name) },
      items: items,
      truncated: truncated,
      unavailableEvidence: []
    });
  `);
}

export function getProjectIntakeTools(
  bridgeOptions: BridgeOptions,
  dependencies: ProjectIntakeToolDependencies = {},
) {
  const capture = dependencies.captureSnapshot
    ?? ((maxItems: number) => sendCommand(projectIntakeCaptureScript(maxItems), bridgeOptions));

  return {
    preview_project_intake: {
      description: "Inspect a bounded Premiere project against an explicit facility intake template and return a path-redacted report plus a non-mutating organization proposal. It never changes Premiere or persists the template.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          template: {
            type: "object",
            description: "Versioned facility policy. Unknown fields and unsafe matching expressions are rejected by the intake engine.",
          },
          include_paths: {
            type: "boolean",
            description: "Include observed media paths in findings. Defaults to false; hashes are returned instead.",
          },
          max_items: {
            type: "integer",
            minimum: 1,
            maximum: MAX_PROJECT_INTAKE_ITEMS,
            description: `Maximum project items to inspect; defaults to ${MAX_PROJECT_INTAKE_ITEMS}. Truncation returns an incomplete report.`,
          },
        },
        required: ["template"],
      },
      handler: async (args: { template: unknown; include_paths?: boolean; max_items?: number }) => {
        try {
          const maxItems = boundedMaxItems(args.max_items);
          const captured = await capture(maxItems);
          if (!captured.success) return captured;
          return {
            success: true,
            data: buildProjectIntakeReport(captured.data, args.template, { includePaths: args.include_paths === true }),
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
