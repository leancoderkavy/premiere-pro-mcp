import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const MAX_PENDING_EVENTS = 1_000;
interface ScanLimits {
  maxFiles: number;
  maxEntries: number;
  maxDirectories: number;
  maxDepth: number;
  maxQueue: number;
  maxElapsedMs: number;
  yieldEveryEntries: number;
}

const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxFiles: 5_000,
  maxEntries: 25_000,
  maxDirectories: 2_000,
  maxDepth: 32,
  maxQueue: 1_000,
  maxElapsedMs: 5_000,
  yieldEveryEntries: 64,
};

type ScanLimitReason = "file_limit" | "entry_limit" | "directory_limit" | "depth_limit" | "queue_limit" | "time_limit";
type ScanResult = {
  files: Map<string, Snapshot>;
  incomplete: boolean;
  limitReasons: ScanLimitReason[];
  visitedEntries: number;
  visitedDirectories: number;
};

export interface MediaWatchRegistryOptions {
  scanLimits?: Partial<ScanLimits>;
}

type Snapshot = { relativePath: string; pathHash: string; size: number; modifiedMs: number; extension: string };
type WatchState = {
  id: string;
  workspaceRoot: string;
  watchRoot: string;
  extensions: Set<string>;
  recursive: boolean;
  targetBinId?: string;
  baseline: Map<string, Snapshot>;
  scanIncomplete: boolean;
  scanLimitReasons: ScanLimitReason[];
  scanVisitedEntries: number;
  scanVisitedDirectories: number;
  pending: Set<string>;
  overflow: boolean;
  watcher: FSWatcher;
};

function hash(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function requiredPath(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path of at most 4096 characters`);
  return value;
}
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function extensionSet(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new Error("allowed_extensions must contain between 1 and 64 entries");
  const values = value.map((entry, index) => {
    if (typeof entry !== "string") throw new Error(`allowed_extensions[${index}] must be a string`);
    const normalized = entry.trim().replace(/^\.+/, "").toLocaleLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(normalized)) throw new Error(`allowed_extensions[${index}] is invalid`);
    return normalized;
  });
  if (new Set(values).size !== values.length) throw new Error("allowed_extensions contains duplicates");
  return new Set(values);
}

function scanLimits(overrides: Partial<ScanLimits> = {}): ScanLimits {
  const limits = { ...DEFAULT_SCAN_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    const permitsZero = name === "maxElapsedMs";
    if (!Number.isSafeInteger(value) || (permitsZero ? value < 0 : value < 1)) {
      throw new Error(`${name} must be ${permitsZero ? "a non-negative" : "a positive"} safe integer`);
    }
    const maximum = DEFAULT_SCAN_LIMITS[name as keyof ScanLimits];
    if (value > maximum) throw new Error(`${name} cannot exceed the production limit of ${maximum}`);
  }
  return limits;
}

function cancellationError(): Error {
  const error = new Error("media scan cancelled");
  error.name = "AbortError";
  return error;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function scan(
  root: string,
  extensions: Set<string>,
  recursive: boolean,
  limits: ScanLimits,
  signal: AbortSignal,
): Promise<ScanResult> {
  const output = new Map<string, Snapshot>();
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  const reasons = new Set<ScanLimitReason>();
  const startedAt = performance.now();
  let queueIndex = 0;
  let scheduledDirectories = 1;
  let visitedEntries = 0;
  let visitedDirectories = 0;
  let stopTraversal = false;

  while (queueIndex < queue.length && !stopTraversal) {
    if (signal.aborted) throw cancellationError();
    if (performance.now() - startedAt >= limits.maxElapsedMs) {
      reasons.add("time_limit");
      break;
    }
    const { directory, depth } = queue[queueIndex++];
    visitedDirectories++;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (signal.aborted) throw cancellationError();
      if (performance.now() - startedAt >= limits.maxElapsedMs) {
        reasons.add("time_limit");
        stopTraversal = true;
        break;
      }
      if (visitedEntries >= limits.maxEntries) {
        reasons.add("entry_limit");
        stopTraversal = true;
        break;
      }
      visitedEntries++;
      if (visitedEntries % limits.yieldEveryEntries === 0) await yieldToEventLoop();
      const candidate = path.join(directory, entry.name);
      const resolved = await realpath(candidate);
      if (!contained(root, resolved)) continue;
      if (entry.isDirectory()) {
        if (!recursive) continue;
        if (depth + 1 > limits.maxDepth) {
          reasons.add("depth_limit");
          continue;
        }
        if (scheduledDirectories >= limits.maxDirectories) {
          reasons.add("directory_limit");
          continue;
        }
        if (queue.length - queueIndex >= limits.maxQueue) {
          reasons.add("queue_limit");
          continue;
        }
        queue.push({ directory: resolved, depth: depth + 1 });
        scheduledDirectories++;
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).slice(1).toLocaleLowerCase();
      if (!extensions.has(extension)) continue;
      if (output.size >= limits.maxFiles) {
        reasons.add("file_limit");
        continue;
      }
      const details = await stat(resolved);
      const relativePath = path.relative(root, resolved).replace(/\\/g, "/");
      output.set(relativePath, { relativePath, pathHash: hash(resolved.normalize("NFC").toLocaleLowerCase()), size: details.size, modifiedMs: details.mtimeMs, extension });
    }
  }
  if (signal.aborted) throw cancellationError();
  return {
    files: output,
    incomplete: reasons.size > 0,
    limitReasons: [...reasons].sort(),
    visitedEntries,
    visitedDirectories,
  };
}

export class MediaWatchRegistry {
  private state?: WatchState;
  private readonly limits: ScanLimits;
  private scanController?: AbortController;

  constructor(options: MediaWatchRegistryOptions = {}) {
    this.limits = scanLimits(options.scanLimits);
  }

  private async runScan(root: string, extensions: Set<string>, recursive: boolean): Promise<ScanResult> {
    if (this.scanController) throw new Error("a media scan is already in progress");
    const controller = new AbortController();
    this.scanController = controller;
    try {
      return await scan(root, extensions, recursive, this.limits, controller.signal);
    } finally {
      if (this.scanController === controller) this.scanController = undefined;
    }
  }

  async start(args: Record<string, unknown>) {
    if (this.state) throw new Error("a media watch is already active; stop it before starting another");
    const workspacePath = requiredPath(args.approved_workspace_path, "approved_workspace_path");
    const watchPath = requiredPath(args.watch_path, "watch_path");
    const extensions = extensionSet(args.allowed_extensions);
    const recursive = args.recursive === true;
    if (args.recursive !== undefined && typeof args.recursive !== "boolean") throw new Error("recursive must be a boolean");
    const targetBinId = args.target_bin_id === undefined ? undefined : String(args.target_bin_id);
    if (targetBinId !== undefined && (!targetBinId.trim() || targetBinId.length > 512)) throw new Error("target_bin_id must be 1-512 characters");
    if (this.scanController) throw new Error("a media scan is already in progress");
    const controller = new AbortController();
    this.scanController = controller;
    let workspaceRoot: string;
    let watchRoot: string;
    let baseline: ScanResult;
    try {
      [workspaceRoot, watchRoot] = await Promise.all([realpath(workspacePath), realpath(watchPath)]);
      if (controller.signal.aborted) throw cancellationError();
      const [workspaceDetails, watchDetails] = await Promise.all([stat(workspaceRoot), stat(watchRoot)]);
      if (!workspaceDetails.isDirectory() || !watchDetails.isDirectory()) throw new Error("approved workspace and watch path must be directories");
      if (!contained(workspaceRoot, watchRoot)) throw new Error("watch_path must be contained within approved_workspace_path");
      baseline = await scan(watchRoot, extensions, recursive, this.limits, controller.signal);
      if (controller.signal.aborted) throw cancellationError();
    } finally {
      if (this.scanController === controller) this.scanController = undefined;
    }
    const pending = new Set<string>();
    const state = {
      id: hash(`${watchRoot}:${Date.now()}`).slice(7, 39),
      workspaceRoot,
      watchRoot,
      extensions,
      recursive,
      targetBinId,
      baseline: baseline.files,
      scanIncomplete: baseline.incomplete,
      scanLimitReasons: baseline.limitReasons,
      scanVisitedEntries: baseline.visitedEntries,
      scanVisitedDirectories: baseline.visitedDirectories,
      pending,
      overflow: false,
      watcher: undefined as unknown as FSWatcher,
    };
    const watcher = watch(watchRoot, { recursive }, (_event, filename) => {
      if (!filename) state.overflow = true;
      else if (state.pending.size >= MAX_PENDING_EVENTS) state.overflow = true;
      else state.pending.add(String(filename).replace(/\\/g, "/"));
    });
    watcher.on("error", () => { state.overflow = true; });
    watcher.unref();
    state.watcher = watcher;
    this.state = state;
    return this.status();
  }

  status() {
    const state = this.state;
    return state ? { active: true, watch_id: state.id, recursive: state.recursive, allowed_extensions: [...state.extensions].sort(), baseline_file_count: state.baseline.size, pending_event_count: state.pending.size, overflow: state.overflow, scan_incomplete: state.scanIncomplete, scan_limit_reasons: state.scanLimitReasons, scan_visited_entry_count: state.scanVisitedEntries, scan_visited_directory_count: state.scanVisitedDirectories, target_bin_id: state.targetBinId ?? null, paths_redacted: true } : { active: false, paths_redacted: true };
  }

  async preview(args: Record<string, unknown>) {
    const state = this.state;
    if (!state) throw new Error("no media watch is active");
    if (args.watch_id !== state.id) throw new Error("watch_id does not match the active media watch");
    const includePaths = args.include_paths === true;
    if (args.include_paths !== undefined && typeof args.include_paths !== "boolean") throw new Error("include_paths must be a boolean");
    const known = new Set<string>();
    if (args.known_media_path_hashes !== undefined) {
      if (!Array.isArray(args.known_media_path_hashes) || args.known_media_path_hashes.length > 5_000) throw new Error("known_media_path_hashes must contain at most 5000 entries");
      for (const [index, value] of args.known_media_path_hashes.entries()) {
        if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`known_media_path_hashes[${index}] must be a sha256 hash`);
        known.add(value);
      }
    }
    const current = await this.runScan(state.watchRoot, state.extensions, state.recursive);
    if (this.state !== state) throw cancellationError();
    const proposed = [...current.files.values()].filter((item) => {
      const prior = state.baseline.get(item.relativePath);
      return (!prior || prior.size !== item.size || prior.modifiedMs !== item.modifiedMs) && !known.has(item.pathHash);
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const plan = proposed.map((item) => ({ path_hash: item.pathHash, extension: item.extension, size: item.size, modified_ms: item.modifiedMs, target_bin_id: state.targetBinId ?? null, ...(includePaths ? { media_path: path.join(state.watchRoot, item.relativePath) } : {}) }));
    const scanLimitReasons = [...new Set([...state.scanLimitReasons, ...current.limitReasons])].sort();
    return { watch_id: state.id, plan_digest: hash(JSON.stringify(plan)), proposed_count: plan.length, proposed_imports: plan, incomplete: state.overflow || state.scanIncomplete || current.incomplete, scan_limit_reasons: scanLimitReasons, scan_visited_entry_count: current.visitedEntries, scan_visited_directory_count: current.visitedDirectories, pending_event_count: state.pending.size, applied: false, paths_disclosed: includePaths, limitations: ["This preview does not import media.", "Files may still change after preview; revalidate them immediately before import."] };
  }

  async rescan() {
    const state = this.state;
    if (!state) throw new Error("no media watch is active");
    const baseline = await this.runScan(state.watchRoot, state.extensions, state.recursive);
    if (this.state !== state) throw cancellationError();
    state.baseline = baseline.files;
    state.scanIncomplete = baseline.incomplete;
    state.scanLimitReasons = baseline.limitReasons;
    state.scanVisitedEntries = baseline.visitedEntries;
    state.scanVisitedDirectories = baseline.visitedDirectories;
    state.pending.clear(); state.overflow = false;
    return this.status();
  }

  close() {
    this.scanController?.abort();
    if (this.state) this.state.watcher.close();
    this.state = undefined;
  }
}

export function getMediaWatchTools(registry: MediaWatchRegistry) {
  return {
    manage_media_watch: {
      description: "Start, inspect, rescan, or stop one session-scoped local media-folder monitor. It records bounded file-change signals and never imports media automatically.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        action: { type: "string", enum: ["start", "status", "scan", "stop"], description: "Watcher action." },
        approved_workspace_path: { type: "string", maxLength: 4096, description: "Absolute approved workspace root; required for start." },
        watch_path: { type: "string", maxLength: 4096, description: "Absolute contained directory to monitor; required for start." },
        allowed_extensions: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 17 }, description: "File extensions eligible for proposals; required for start." },
        recursive: { type: "boolean", description: "Monitor contained subdirectories; defaults to false." },
        target_bin_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional proposed Premiere destination-bin ID." },
      }, required: ["action"] },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (args.action === "start") return { success: true, data: await registry.start(args) };
          if (args.action === "status") return { success: true, data: registry.status() };
          if (args.action === "scan") return { success: true, data: await registry.rescan() };
          if (args.action === "stop") { registry.close(); return { success: true, data: registry.status() }; }
          return { success: false, error: `Unsupported media-watch action: ${String(args.action)}` };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
    preview_watched_media_import: {
      description: "Compare the active watch baseline with a fresh contained scan and return a path-redacted import proposal. It never imports or changes Premiere.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        watch_id: { type: "string", minLength: 1, maxLength: 64, description: "ID returned when the session watch started." },
        known_media_path_hashes: { type: "array", maxItems: 5000, items: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, description: "Optional hashes already represented in the Premiere project." },
        include_paths: { type: "boolean", description: "Explicitly disclose contained paths for selected imports; defaults to false." },
      }, required: ["watch_id"] },
      handler: async (args: Record<string, unknown>) => {
        try { return { success: true, data: await registry.preview(args) }; }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
