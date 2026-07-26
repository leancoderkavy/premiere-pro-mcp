import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { buildToolScript } from "../bridge/script-builder.js";
import {
  getTempDir,
  sendCommand,
  type BridgeOptions,
  type CommandResult,
} from "../bridge/file-bridge.js";

const MAX_CANDIDATES = 50;
const AUTOSAVE_DIR_NAMES = [
  "Adobe Premiere Pro Auto-Save",
  "Premiere Pro Auto-Save",
];

interface ProjectSnapshot {
  name: string;
  path: string;
}

export interface RecoveryCandidate {
  path: string;
  fileName: string;
  modifiedAt: string;
  modifiedMs: number;
  sizeBytes: number;
  newerThanProjectFile: boolean | null;
}

export function discoverAdjacentRecoveryCandidates(
  projectPath: string,
): RecoveryCandidate[] {
  if (!projectPath || extname(projectPath).toLowerCase() !== ".prproj") return [];
  const absoluteProjectPath = resolve(projectPath);
  const projectDirectory = dirname(absoluteProjectPath);
  const projectStem = basename(projectPath, extname(projectPath)).toLowerCase();
  let projectModifiedMs: number | null = null;
  try {
    projectModifiedMs = statSync(absoluteProjectPath).mtimeMs;
  } catch {
    // An unsaved/new or inaccessible project may not exist on disk yet.
  }

  const roots = [
    ...AUTOSAVE_DIR_NAMES.map((name) => join(projectDirectory, name)),
    projectDirectory,
  ];
  const seen = new Set<string>();
  const candidates: RecoveryCandidate[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (extname(name).toLowerCase() !== ".prproj") continue;
      if (!name.toLowerCase().includes(projectStem)) continue;
      const candidatePath = resolve(root, name);
      if (candidatePath === absoluteProjectPath || seen.has(candidatePath)) continue;
      seen.add(candidatePath);
      try {
        const stat = statSync(candidatePath);
        if (!stat.isFile()) continue;
        candidates.push({
          path: candidatePath,
          fileName: basename(candidatePath),
          modifiedAt: stat.mtime.toISOString(),
          modifiedMs: stat.mtimeMs,
          sizeBytes: stat.size,
          newerThanProjectFile:
            projectModifiedMs === null ? null : stat.mtimeMs > projectModifiedMs,
        });
      } catch {
        // A candidate can disappear during an autosave; omit unstable entries.
      }
    }
  }
  return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

export function collectBridgeTelemetry(
  bridgeOptions: BridgeOptions,
  nowMs = Date.now(),
) {
  const directory = getTempDir(bridgeOptions);
  const counts = { pendingCommands: 0, pendingResponses: 0, busyOperations: 0 };
  let oldestPendingAgeMs: number | null = null;
  let directoryAccessible = false;
  try {
    if (existsSync(directory)) {
      directoryAccessible = true;
      for (const name of readdirSync(directory)) {
        let bucket: keyof typeof counts | null = null;
        if (/^cmd_.+\.jsx$/.test(name)) bucket = "pendingCommands";
        else if (/^res_.+\.json$/.test(name)) bucket = "pendingResponses";
        else if (/^busy_.+\.json$/.test(name)) bucket = "busyOperations";
        if (!bucket) continue;
        counts[bucket]++;
        try {
          const age = Math.max(0, nowMs - statSync(join(directory, name)).mtimeMs);
          oldestPendingAgeMs =
            oldestPendingAgeMs === null ? age : Math.max(oldestPendingAgeMs, age);
        } catch {
          // Aggregate telemetry remains useful if one transient file disappears.
        }
      }
    }
  } catch {
    directoryAccessible = false;
  }
  return {
    schemaVersion: 1,
    directoryAccessible,
    ...counts,
    oldestPendingAgeMs,
    healthy:
      directoryAccessible &&
      counts.busyOperations === 0 &&
      (oldestPendingAgeMs === null || oldestPendingAgeMs < 30_000),
    privacy:
      "Aggregate local bridge state only; no paths, filenames, script contents, project names, or media names are returned.",
  };
}

function projectSnapshot(result: CommandResult): ProjectSnapshot | null {
  if (!result.success || !result.data || typeof result.data !== "object") return null;
  const value = result.data as Record<string, unknown>;
  if (typeof value.name !== "string" || typeof value.path !== "string") return null;
  return { name: value.name, path: value.path };
}

export function getRecoveryTools(bridgeOptions: BridgeOptions) {
  return {
    inspect_project_recovery: {
      description:
        "Read-only recovery inspection: diagnose the active project path and list adjacent Premiere Auto-Save project candidates without opening, copying, or restoring anything.",
      parameters: {},
      handler: async () => {
        const result = await sendCommand(
          buildToolScript(`
            if (!app.project) return __error("No project is open");
            return __result({
              name: app.project.name || "",
              path: app.project.path || ""
            });
          `),
          bridgeOptions,
        );
        if (!result.success) return result;
        const project = projectSnapshot(result);
        if (!project) {
          return {
            success: false,
            error: "Premiere returned an invalid project snapshot",
          };
        }
        const hasSavedPath =
          project.path.length > 0 &&
          extname(project.path).toLowerCase() === ".prproj";
        const candidates = hasSavedPath
          ? discoverAdjacentRecoveryCandidates(project.path)
          : [];
        return {
          success: true,
          data: {
            project: {
              name: project.name,
              path: project.path || null,
              hasSavedPath,
              fileExists: hasSavedPath ? existsSync(project.path) : false,
            },
            unsavedChanges: {
              status: "not_exposed",
              dirty: null,
              reason:
                "Premiere's documented scripting APIs do not expose the current dirty/unsaved flag.",
            },
            recovery: {
              mode: "read_only_discovery",
              candidateCount: candidates.length,
              truncated: candidates.length >= MAX_CANDIDATES,
              candidates,
              automaticRestoreSupported: false,
              guidance:
                candidates.length > 0
                  ? "Review modification times and file sizes, then use Premiere Pro's File > Open to inspect a chosen copy. Keep the current project open until you have confirmed the recovery."
                  : hasSavedPath
                    ? "No adjacent .prproj recovery candidates were found. Check Premiere Pro's configured Auto Save location and Creative Cloud recovery UI manually."
                    : "Save the project to establish a project directory; then inspect Premiere's Auto Save location manually.",
            },
          },
        };
      },
    },

    get_bridge_telemetry: {
      description:
        "Inspect privacy-preserving aggregate bridge health: pending command/response counts, busy operations, and queue age without returning project or personal data.",
      parameters: {},
      handler: async () => ({
        success: true,
        data: collectBridgeTelemetry(bridgeOptions),
      }),
    },
  };
}
