import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { buildToolScript } from "../bridge/script-builder.js";
import {
  getTempDir,
  getBridgeLiveness,
  sendCommand,
  type BridgeOptions,
  type CommandResult,
} from "../bridge/file-bridge.js";

const MAX_CANDIDATES = 50;
const DEFAULT_PROJECT_BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const PROJECT_BACKUP_MAX_BYTES_ENV = "PREMIERE_MCP_PROJECT_BACKUP_MAX_BYTES";
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

export interface ProjectBackupReceipt {
  sourcePath: string;
  backupPath: string;
  sizeBytes: number;
  checksumSha256: string;
  sourceUnchanged: true;
  byteIdentical: true;
}

export interface ProjectBackupOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

let projectBackupInProgress = false;

function projectBackupMaxBytes(override?: number): number {
  const configured = override ?? (process.env[PROJECT_BACKUP_MAX_BYTES_ENV] === undefined
    ? DEFAULT_PROJECT_BACKUP_MAX_BYTES
    : Number(process.env[PROJECT_BACKUP_MAX_BYTES_ENV]));
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new Error(`${PROJECT_BACKUP_MAX_BYTES_ENV} must be a positive safe integer`);
  }
  return configured;
}

function sameFileVersion(left: Stats, right: Stats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function throwIfBackupCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("project backup cancelled");
  error.name = "AbortError";
  throw error;
}

async function removePartialBackup(backupPath: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(backupPath, { force: true, maxRetries: 8, retryDelay: 25 });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function sha256File(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ checksum: string; bytes: number }> {
  // Node 20 can open a leaked descriptor after emitting close when a filesystem
  // stream is constructed with an already-aborted signal.
  throwIfBackupCancelled(signal);
  const digest = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(path, { signal });
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error(`Project file exceeds the ${maxBytes}-byte backup budget`);
    digest.update(chunk);
  }
  return { checksum: digest.digest("hex"), bytes };
}

export async function createProjectBackup(
  projectPath: string,
  now = new Date(),
  options: ProjectBackupOptions = {},
): Promise<ProjectBackupReceipt> {
  const sourcePath = resolve(projectPath);
  if (extname(sourcePath).toLowerCase() !== ".prproj") {
    throw new Error("project_path must point to an Adobe Premiere .prproj file");
  }
  if (projectBackupInProgress) throw new Error("another project backup is already in progress");
  projectBackupInProgress = true;
  let backupPath: string | undefined;
  let backupCreated = false;
  try {
    throwIfBackupCancelled(options.signal);
    const maxBytes = projectBackupMaxBytes(options.maxBytes);
    let before: Stats;
    try {
      before = await stat(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Project file does not exist: ${sourcePath}`);
      throw error;
    }
    if (!before.isFile()) throw new Error(`Project path is not a regular file: ${sourcePath}`);
    if (before.size > maxBytes) throw new Error(`Project file exceeds the ${maxBytes}-byte backup budget`);
    throwIfBackupCancelled(options.signal);

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    backupPath = `${sourcePath}.backup-${stamp}`;
    const backupHandle = await open(backupPath, "wx", before.mode & 0o777);
    backupCreated = true;
    let copiedBytes = 0;
    const byteLimiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (options.signal?.aborted) {
          callback(Object.assign(new Error("project backup cancelled"), { name: "AbortError" }));
          return;
        }
        copiedBytes += chunk.length;
        if (copiedBytes > maxBytes) callback(new Error(`Project file exceeds the ${maxBytes}-byte backup budget`));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(
        // Let pipeline attach cancellation after stream construction. Passing
        // an already-aborted signal to ReadStream leaks a handle on Node 20.
        createReadStream(sourcePath),
        byteLimiter,
        backupHandle.createWriteStream(),
        { signal: options.signal },
      );
    } finally {
      await backupHandle.close().catch(() => undefined);
    }

    const [afterCopy, backupAfterCopy] = await Promise.all([stat(sourcePath), stat(backupPath)]);
    if (!sameFileVersion(before, afterCopy)) {
      throw new Error("Project file changed while its backup was being created; do not rely on this copy");
    }
    const sourceHash = await sha256File(sourcePath, maxBytes, options.signal);
    const backupHash = await sha256File(backupPath, maxBytes, options.signal);
    const [afterHash, backupAfterHash] = await Promise.all([stat(sourcePath), stat(backupPath)]);
    if (!sameFileVersion(before, afterHash)) {
      throw new Error("Project file changed while its backup was being verified; do not rely on this copy");
    }
    if (!sameFileVersion(backupAfterCopy, backupAfterHash) ||
        copiedBytes !== before.size ||
        sourceHash.bytes !== before.size ||
        backupHash.bytes !== before.size ||
        backupHash.checksum !== sourceHash.checksum) {
      throw new Error("Project backup verification failed: copied bytes do not match the source");
    }
    return {
      sourcePath,
      backupPath,
      sizeBytes: backupAfterHash.size,
      checksumSha256: backupHash.checksum,
      sourceUnchanged: true,
      byteIdentical: true,
    };
  } catch (error) {
    if (backupCreated && backupPath) await removePartialBackup(backupPath).catch(() => undefined);
    throw error;
  } finally {
    projectBackupInProgress = false;
  }
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
  const heartbeat = getBridgeLiveness(bridgeOptions, nowMs);
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
    heartbeat,
    healthy:
      directoryAccessible &&
      heartbeat.state === "running" &&
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
    create_project_backup: {
      description:
        "Create a collision-safe, byte-verified backup beside an existing .prproj file without opening or modifying the source project.",
      parameters: {
        type: "object" as const,
        properties: {
          project_path: {
            type: "string",
            description: "Absolute or working-directory-relative path to an existing .prproj file",
          },
        },
        required: ["project_path"],
      },
      handler: async (args: { project_path: string }) => {
        try {
          return { success: true, data: await createProjectBackup(args.project_path) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },

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
        "Inspect privacy-preserving aggregate bridge health: pending command/response counts, busy operations, queue age, and CEP heartbeat state without returning project or personal data.",
      parameters: {},
      handler: async () => ({
        success: true,
        data: collectBridgeTelemetry(bridgeOptions),
      }),
    },
  };
}
