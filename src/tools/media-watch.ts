import { createHash } from "node:crypto";
import { readdirSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

const MAX_PENDING_EVENTS = 1_000;
const MAX_SCAN_FILES = 5_000;

type Snapshot = { relativePath: string; pathHash: string; size: number; modifiedMs: number; extension: string };
type WatchState = {
  id: string;
  workspaceRoot: string;
  watchRoot: string;
  extensions: Set<string>;
  recursive: boolean;
  targetBinId?: string;
  baseline: Map<string, Snapshot>;
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

function scan(root: string, extensions: Set<string>, recursive: boolean): Map<string, Snapshot> {
  const output = new Map<string, Snapshot>();
  const queue = [root];
  while (queue.length) {
    const directory = queue.shift() as string;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const resolved = realpathSync(candidate);
      if (!contained(root, resolved)) continue;
      if (entry.isDirectory()) { if (recursive) queue.push(resolved); continue; }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).slice(1).toLocaleLowerCase();
      if (!extensions.has(extension)) continue;
      const details = statSync(resolved);
      const relativePath = path.relative(root, resolved).replace(/\\/g, "/");
      output.set(relativePath, { relativePath, pathHash: hash(resolved.normalize("NFC").toLocaleLowerCase()), size: details.size, modifiedMs: details.mtimeMs, extension });
      if (output.size > MAX_SCAN_FILES) throw new Error(`watched folder exceeds the ${MAX_SCAN_FILES} file scan limit`);
    }
  }
  return output;
}

export class MediaWatchRegistry {
  private state?: WatchState;

  start(args: Record<string, unknown>) {
    if (this.state) throw new Error("a media watch is already active; stop it before starting another");
    const workspaceRoot = realpathSync(requiredPath(args.approved_workspace_path, "approved_workspace_path"));
    const watchRoot = realpathSync(requiredPath(args.watch_path, "watch_path"));
    if (!statSync(workspaceRoot).isDirectory() || !statSync(watchRoot).isDirectory()) throw new Error("approved workspace and watch path must be directories");
    if (!contained(workspaceRoot, watchRoot)) throw new Error("watch_path must be contained within approved_workspace_path");
    const extensions = extensionSet(args.allowed_extensions);
    const recursive = args.recursive === true;
    if (args.recursive !== undefined && typeof args.recursive !== "boolean") throw new Error("recursive must be a boolean");
    const targetBinId = args.target_bin_id === undefined ? undefined : String(args.target_bin_id);
    if (targetBinId !== undefined && (!targetBinId.trim() || targetBinId.length > 512)) throw new Error("target_bin_id must be 1-512 characters");
    const baseline = scan(watchRoot, extensions, recursive);
    const pending = new Set<string>();
    const state = { id: hash(`${watchRoot}:${Date.now()}`).slice(7, 39), workspaceRoot, watchRoot, extensions, recursive, targetBinId, baseline, pending, overflow: false, watcher: undefined as unknown as FSWatcher };
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
    return state ? { active: true, watch_id: state.id, recursive: state.recursive, allowed_extensions: [...state.extensions].sort(), baseline_file_count: state.baseline.size, pending_event_count: state.pending.size, overflow: state.overflow, target_bin_id: state.targetBinId ?? null, paths_redacted: true } : { active: false, paths_redacted: true };
  }

  preview(args: Record<string, unknown>) {
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
    const current = scan(state.watchRoot, state.extensions, state.recursive);
    const proposed = [...current.values()].filter((item) => {
      const prior = state.baseline.get(item.relativePath);
      return (!prior || prior.size !== item.size || prior.modifiedMs !== item.modifiedMs) && !known.has(item.pathHash);
    }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const plan = proposed.map((item) => ({ path_hash: item.pathHash, extension: item.extension, size: item.size, modified_ms: item.modifiedMs, target_bin_id: state.targetBinId ?? null, ...(includePaths ? { media_path: path.join(state.watchRoot, item.relativePath) } : {}) }));
    return { watch_id: state.id, plan_digest: hash(JSON.stringify(plan)), proposed_count: plan.length, proposed_imports: plan, incomplete: state.overflow, pending_event_count: state.pending.size, applied: false, paths_disclosed: includePaths, limitations: ["This preview does not import media.", "Files may still change after preview; revalidate them immediately before import."] };
  }

  rescan() {
    const state = this.state;
    if (!state) throw new Error("no media watch is active");
    state.baseline = scan(state.watchRoot, state.extensions, state.recursive);
    state.pending.clear(); state.overflow = false;
    return this.status();
  }

  close() {
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
          if (args.action === "start") return { success: true, data: registry.start(args) };
          if (args.action === "status") return { success: true, data: registry.status() };
          if (args.action === "scan") return { success: true, data: registry.rescan() };
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
        try { return { success: true, data: registry.preview(args) }; }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
