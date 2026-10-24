import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, renameSync, statSync, lstatSync, realpathSync, chmodSync, watch, FSWatcher, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { getHelpersSource, helpersFileName, buildBootstrap } from "./script-builder.js";
import { validateBridgeScriptSize } from "./script-size.js";
import { withHostLease, ownsHostLease, inspectHostRecovery, markHostRecovery, HostLeaseError } from "./host-lease.js";
import { undoTrackingEnabled } from "./undo-tracking.js";
import { assertInvocationNotCancelled, currentInvocation, markHostDispatch, measureStage, measureStageSync, reportHostHeartbeat, startStage } from "../workflows/invocation-context.js";
import { AsyncResource } from "node:async_hooks";

export function getDarwinUserTempDirectory(): string | null {
  try {
    // GUI-launched MCP clients can omit TMPDIR. On macOS, getconf still returns
    // the same per-user temporary root inherited by Premiere's CEP process.
    const value = execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value && isAbsolute(value) ? value : null;
  } catch {
    return null;
  }
}

export function getDefaultBridgeTempDir(
  platform: NodeJS.Platform = process.platform,
  fallbackTempDirectory = tmpdir(),
  readDarwinUserTempDirectory: () => string | null = getDarwinUserTempDirectory,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const hasConfiguredNodeTempDirectory = Boolean(
    environment.TMPDIR || environment.TMP || environment.TEMP,
  );
  const temporaryRoot =
    platform === "darwin" && !hasConfiguredNodeTempDirectory
      ? readDarwinUserTempDirectory() ?? fallbackTempDirectory
      : fallbackTempDirectory;
  return join(temporaryRoot, "premiere-mcp-bridge");
}

const DEFAULT_TEMP_DIR = getDefaultBridgeTempDir();
const POLL_FALLBACK_MS = 250;
const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_QUEUED_BRIDGE_COMMANDS = 32;
export const MAX_BRIDGE_RESPONSE_BYTES = 1_048_576;
export const BRIDGE_HEARTBEAT_FILE = "bridge-heartbeat.json";
export const BRIDGE_HEARTBEAT_STALE_MS = 3_000;

type ResponseListener = () => void;

interface SharedResponseWatcher {
  watcher?: FSWatcher;
  listeners: Map<string, Set<ResponseListener>>;
}

interface QueuedBridgeCommand {
  run: () => Promise<CommandResult>;
  resolve: (result: CommandResult) => void;
  reject: (error: unknown) => void;
}

interface BridgeCommandScheduler {
  running: boolean;
  pending: QueuedBridgeCommand[];
}

// One Premiere scripting engine serves each bridge directory. Serialize command
// publication per directory so concurrent MCP requests cannot make independent
// CEP panels issue overlapping host edits. The bounded queue fails fast instead
// of accumulating unbounded command files and response watchers under load.
const commandSchedulers = new Map<string, BridgeCommandScheduler>();

function scheduleBridgeCommand(
  tempDir: string,
  run: () => Promise<CommandResult>,
): Promise<CommandResult> {
  let scheduler = commandSchedulers.get(tempDir);
  if (!scheduler) {
    scheduler = { running: false, pending: [] };
    commandSchedulers.set(tempDir, scheduler);
  }

  if (scheduler.running && scheduler.pending.length >= MAX_QUEUED_BRIDGE_COMMANDS) {
    return Promise.resolve({
      success: false,
      error: `Bridge command queue is full (${MAX_QUEUED_BRIDGE_COMMANDS} waiting); retry after an active command finishes`,
    });
  }

  return new Promise<CommandResult>((resolve, reject) => {
    // The next item starts from the previous request's completion callback.
    // Bind every AsyncLocalStorage guard to this request at enqueue time.
    scheduler!.pending.push({ run: AsyncResource.bind(run), resolve, reject });
    runNextBridgeCommand(tempDir, scheduler!);
  });
}

function runNextBridgeCommand(tempDir: string, scheduler: BridgeCommandScheduler): void {
  if (scheduler.running) return;
  const next = scheduler.pending.shift();
  if (!next) {
    commandSchedulers.delete(tempDir);
    return;
  }
  scheduler.running = true;
  void next.run()
    .then(next.resolve, next.reject)
    .finally(() => {
      scheduler.running = false;
      runNextBridgeCommand(tempDir, scheduler);
    });
}

// CEP commands can be issued concurrently, especially when an MCP client
// inspects several independent surfaces. A watcher is attached to the bridge
// directory rather than to an individual response so one OS handle wakes all
// matching in-flight commands. Timers below remain the correctness fallback
// for filesystems where fs.watch drops or coalesces events.
const responseWatchers = new Map<string, SharedResponseWatcher>();

function watchResponseFile(resFile: string, listener: ResponseListener): () => void {
  const directory = dirname(resFile);
  const responseName = basename(resFile);
  let shared = responseWatchers.get(directory);
  if (!shared) {
    shared = { listeners: new Map() };
    responseWatchers.set(directory, shared);
  }

  let listeners = shared.listeners.get(responseName);
  if (!listeners) {
    listeners = new Set();
    shared.listeners.set(responseName, listeners);
  }
  listeners.add(listener);

  if (!shared.watcher) {
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        const names = filename
          ? [filename.toString()]
          : Array.from(shared!.listeners.keys());
        for (const name of names) {
          for (const callback of shared!.listeners.get(name) ?? []) callback();
        }
      });
      shared.watcher = watcher;
      watcher.on("error", () => {
        if (shared!.watcher !== watcher) return;
        shared!.watcher = undefined;
        watcher.close();
        if (shared!.listeners.size === 0) responseWatchers.delete(directory);
      });
    } catch {
      // The polling fallback below remains active when a filesystem does not
      // support notifications (for example some network or virtual drives).
    }
  }

  return () => {
    const registered = shared!.listeners.get(responseName);
    registered?.delete(listener);
    if (registered?.size === 0) shared!.listeners.delete(responseName);
    if (shared!.listeners.size > 0) return;
    shared!.watcher?.close();
    responseWatchers.delete(directory);
  };
}

export interface BridgeOptions {
  tempDir?: string;
  timeoutMs?: number;
  /** Mark a command as mutating so accepted-but-unanswered timeouts report unknown state. */
  mutationOnTimeout?: boolean;
  /** Host application named in timeout guidance (default "Premiere Pro"). */
  hostLabel?: string;
  /**
   * Host-specific bootstrap contract. Premiere is the default; companion
   * bridges (such as After Effects) supply their own narrow helper surface.
   */
  helpers?: BridgeHelpers;
  /**
   * Reject a health-style command without publishing it when a current CEP
   * connector explicitly reports that it is waiting or its heartbeat is stale.
   * A missing heartbeat remains compatible with older installed connectors.
   */
  failFastOnUnreadyHeartbeat?: boolean;
  /**
   * Treat a missing heartbeat as "connector not running" and fail at once.
   * For connectors that always publish one (the bundled After Effects panel),
   * so a closed host is reported immediately instead of after the full timeout.
   */
  requireHeartbeat?: boolean;
  /** Mark a command as mutating so a queued-behind-busy timeout can prove it was not applied. */
  mutating?: boolean;
}

export interface BridgeHelpers {
  source: string;
  fileName: string;
  buildBootstrap: (helpersPath: string) => string;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type BridgeLivenessState = "running" | "waiting" | "stale" | "unknown";

export interface BridgeLiveness {
  state: BridgeLivenessState;
  ageMs: number | null;
}

export interface WindowsBridgeDirectoryAcl {
  ownerSid: string;
  currentUserSid: string;
  unsafeWriteAces: Array<{ sid: string; isInherited: boolean }>;
  unsafeAncestorEntries?: Array<{ sid: string; path: string; reason: string }>;
}

export type WindowsBridgeDirectoryAclInspector = (
  directory: string,
  initialize: boolean,
) => WindowsBridgeDirectoryAcl;

/**
 * Windows capability SIDs (S-1-15-3-*) and app-container package SIDs (S-1-15-2-*)
 * are not logon principals: no other user can act as one to stage or read bridge
 * files. Stock profiles inherit a FullControl capability ACE on %USERPROFILE%\AppData,
 * so treating these as untrusted rejects every path under %LOCALAPPDATA% (issue #581).
 */
export function isWindowsCapabilitySid(sid: string | undefined): boolean {
  return typeof sid === "string" && sid.toUpperCase().startsWith("S-1-15-");
}

export const WINDOWS_BRIDGE_ACL_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$path = [Environment]::GetEnvironmentVariable("PREMIERE_MCP_ACL_PATH", "Process")',
  'if ([string]::IsNullOrWhiteSpace($path)) { throw "Bridge path environment variable is missing" }',
  '$acl = [System.IO.Directory]::GetAccessControl($path)',
  '$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$initialize = [Environment]::GetEnvironmentVariable("PREMIERE_MCP_ACL_INITIALIZE", "Process") -eq "1"',
  '$trustedAncestors = @($current, "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")',
  '$replacement = [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership',
  '$unsafeAncestors = @()',
  '$ancestor = (New-Object System.IO.DirectoryInfo($path)).Parent',
  'while ($null -ne $ancestor) {',
  '  $ancestorAttributes = [System.IO.File]::GetAttributes($ancestor.FullName)',
  '  if (($ancestorAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { $unsafeAncestors += [pscustomobject]@{ sid = ""; path = $ancestor.FullName; reason = "reparse_point" } }',
  '  $ancestorAcl = [System.IO.Directory]::GetAccessControl($ancestor.FullName)',
  '  $ancestorOwner = $ancestorAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
  '  if ($ancestorOwner -notin $trustedAncestors) { $unsafeAncestors += [pscustomobject]@{ sid = $ancestorOwner; path = $ancestor.FullName; reason = "owner" } }',
  '  $unsafeAncestors += @($ancestorAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {',
  '    $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) -and (($_.FileSystemRights -band $replacement) -ne 0) -and $_.IdentityReference.Value -notin $trustedAncestors -and $_.IdentityReference.Value -notlike "S-1-15-*"',
  '  } | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Value; path = $ancestor.FullName; reason = "replacement_rights" } })',
  '  $ancestor = $ancestor.Parent',
  '}',
  'if ($initialize) {',
  '  if ($unsafeAncestors.Count -ne 0) { throw ("Bridge directory ancestry is unsafe: " + (($unsafeAncestors | ForEach-Object { "{0} ({1}: {2})" -f $_.path, $_.reason, $_.sid }) -join "; ")) }',
  '  $acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($current)))',
  '  $acl.SetAccessRuleProtection($true, $false)',
  '  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit',
  '  $propagation = [System.Security.AccessControl.PropagationFlags]::None',
  '  foreach ($sid in @($current, "S-1-5-18", "S-1-5-32-544")) {',
  '    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)',
  '    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, $propagation, [System.Security.AccessControl.AccessControlType]::Allow)',
  '    [void]$acl.AddAccessRule($rule)',
  '  }',
  '  [System.IO.Directory]::SetAccessControl($path, $acl)',
  '  $acl = [System.IO.Directory]::GetAccessControl($path)',
  '}',
  '$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
  '$mutating = [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::AppendData -bor [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership',
  '$trusted = @($current, "S-1-5-18", "S-1-5-32-544")',
  '$unsafe = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {',
  '  $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and (($_.FileSystemRights -band $mutating) -ne 0)',
  '} | ForEach-Object {',
  '  if ($_.IdentityReference.Value -notin $trusted -and $_.IdentityReference.Value -notlike "S-1-15-*") { [pscustomobject]@{ sid = $_.IdentityReference.Value; isInherited = [bool]$_.IsInherited } }',
  '})',
  '[pscustomobject]@{ ownerSid = $owner; currentUserSid = $current; unsafeWriteAces = $unsafe; unsafeAncestorEntries = $unsafeAncestors } | ConvertTo-Json -Compress',
].join("\n");

// Starting powershell.exe can take several seconds on a loaded Windows machine (CI runners
// with coverage timed out at 5 s). A timeout still fails closed: the caller throws.
const WINDOWS_ACL_CHECK_TIMEOUT_MS = 30_000;

export function inspectWindowsBridgeDirectoryAcl(
  directory: string,
  initialize: boolean,
  privacy: { readAccess?: boolean; file?: boolean } = {},
): WindowsBridgeDirectoryAcl {
  let script = WINDOWS_BRIDGE_ACL_SCRIPT;
  if (privacy.readAccess) {
    script = script.replace('\n$trusted = @(', '\n$mutating = $mutating -bor [System.Security.AccessControl.FileSystemRights]::ReadData -bor [System.Security.AccessControl.FileSystemRights]::ReadExtendedAttributes\n$trusted = @(');
  }
  if (privacy.file) {
    script = script.replaceAll("[System.IO.Directory]::GetAccessControl($path)", "[System.IO.File]::GetAccessControl($path)")
      .replace("[System.IO.Directory]::SetAccessControl($path, $acl)", "[System.IO.File]::SetAccessControl($path, $acl)")
      .replace("$inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit", "$inheritance = [System.Security.AccessControl.InheritanceFlags]::None");
  }
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const raw = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: WINDOWS_ACL_CHECK_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        PREMIERE_MCP_ACL_PATH: directory,
        PREMIERE_MCP_ACL_INITIALIZE: initialize ? "1" : "0",
      },
    },
  );
  const parsed = JSON.parse(raw) as Omit<WindowsBridgeDirectoryAcl, "unsafeWriteAces"> & {
    unsafeWriteAces?: WindowsBridgeDirectoryAcl["unsafeWriteAces"][number] | WindowsBridgeDirectoryAcl["unsafeWriteAces"];
    unsafeAncestorEntries?: NonNullable<WindowsBridgeDirectoryAcl["unsafeAncestorEntries"]>[number] | WindowsBridgeDirectoryAcl["unsafeAncestorEntries"];
  };
  return {
    ownerSid: parsed.ownerSid,
    currentUserSid: parsed.currentUserSid,
    unsafeWriteAces: Array.isArray(parsed.unsafeWriteAces)
      ? parsed.unsafeWriteAces
      : parsed.unsafeWriteAces
        ? [parsed.unsafeWriteAces]
        : [],
    unsafeAncestorEntries: Array.isArray(parsed.unsafeAncestorEntries)
      ? parsed.unsafeAncestorEntries
      : parsed.unsafeAncestorEntries
        ? [parsed.unsafeAncestorEntries]
        : [],
  };
}

function validatePosixBridgeAncestors(directory: string, myUid: number): void {
  const candidates = new Set([directory, realpathSync(directory)]);
  const checked = new Set<string>();
  for (const candidate of candidates) {
    let ancestor = dirname(candidate);
    while (ancestor && !checked.has(ancestor)) {
      checked.add(ancestor);
      const entry = lstatSync(ancestor);
      if (entry.uid !== 0 && entry.uid !== myUid) {
        throw new Error(`Bridge path has an untrusted replaceable ancestor ${ancestor}.`);
      }
      if (!entry.isSymbolicLink()) {
        if (!entry.isDirectory()) {
          throw new Error(`Bridge ancestor is not a directory: ${ancestor}`);
        }
        const groupReplaceable = (entry.mode & 0o030) === 0o030;
        const otherReplaceable = (entry.mode & 0o003) === 0o003;
        const sticky = (entry.mode & 0o1000) !== 0;
        if ((groupReplaceable || otherReplaceable) && !sticky) {
          throw new Error(`Bridge path has a replaceable ancestor ${ancestor}.`);
        }
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
}

/**
 * Create the bridge temp dir private to this user, and — critically — refuse to trust
 * one we didn't create.
 *
 * The dir sits at a predictable, world-accessible path (e.g. /tmp/premiere-mcp-bridge)
 * and the CEP panel executes ANY cmd_*.jsx it finds there, inside Premiere, as the
 * logged-in user. On a shared machine another user could pre-create that path and drop
 * command files, or read the res_*.json we write (which contain project data). And
 * mkdirSync({recursive:true}) is a no-op on an existing dir — it does NOT re-apply the
 * mode — so "create it 0o700" alone does not protect against a dir that was already there.
 *
 * So: if it exists, verify it's ours and lock its permissions down; if it isn't ours,
 * fail loudly rather than executing whatever an attacker staged in it.
 */
export function ensurePrivateBridgeDirectory(
  dir: string,
  platform: NodeJS.Platform = process.platform,
  myUid: number | undefined = typeof process.getuid === "function" ? process.getuid() : undefined,
  inspectWindowsAcl: WindowsBridgeDirectoryAclInspector = inspectWindowsBridgeDirectoryAcl,
): void {
  const createdPath = mkdirSync(dir, { recursive: true, mode: 0o700 });
  const newlyCreated = createdPath !== undefined;

  let st = lstatSync(dir);
  if (st.isSymbolicLink()) {
    throw new Error(`Bridge temp dir ${dir} is a symbolic link or junction; refusing to use it.`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Bridge temp path ${dir} is not a directory.`);
  }

  if (platform === "win32") {
    let acl: WindowsBridgeDirectoryAcl;
    try {
      acl = inspectWindowsAcl(dir, newlyCreated);
    } catch (error) {
      throw new Error(
        `Could not verify the Windows ACL for bridge temp dir ${dir}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!acl.ownerSid || !acl.currentUserSid || acl.ownerSid !== acl.currentUserSid) {
      throw new Error(`Bridge temp dir ${dir} is not owned by the current Windows user.`);
    }
    const unsafeWriteAces = acl.unsafeWriteAces.filter((ace) => !isWindowsCapabilitySid(ace.sid));
    if (unsafeWriteAces.length > 0) {
      const identities = unsafeWriteAces.map((ace) => ace.sid || "unknown");
      throw new Error(
        `Bridge temp dir ${dir} grants write access to untrusted identities (${identities.join(", ")}).`,
      );
    }
    const unsafeAncestors = (acl.unsafeAncestorEntries ?? []).filter(
      (entry) => entry.reason !== "replacement_rights" || !isWindowsCapabilitySid(entry.sid),
    );
    if (unsafeAncestors.length > 0) {
      const details = unsafeAncestors
        .map((entry) => `${entry.path} (${entry.reason}: ${entry.sid || "none"})`)
        .join("; ");
      throw new Error(`Bridge path has a replaceable ancestor ${details}.`);
    }
    if (newlyCreated && readdirSync(dir).length > 0) {
      throw new Error(
        `Bridge temp dir ${dir} rejected because unexpected contents appeared during creation.`,
      );
    }
    return;
  }

  if (myUid === undefined || st.uid !== myUid) {
    throw new Error(
      `Bridge temp dir ${dir} is owned by uid ${st.uid}, not this user (${myUid}). ` +
        `Refusing to use it — another user may have staged command files. ` +
        `Set PREMIERE_TEMP_DIR to a path only you control.`
    );
  }

  // Tightening a preexisting writable directory would launder commands another
  // user could already have staged. Refuse it and require a clean private path.
  if (!newlyCreated && (st.mode & 0o022) !== 0) {
    throw new Error(
      `Bridge temp dir ${dir} was writable by other users before validation. ` +
        `Refusing to use staged contents; remove it and let the connector create a private directory.`
    );
  }

  validatePosixBridgeAncestors(dir, myUid);

  // Read/execute-only group access cannot have staged commands, so clamp it for
  // response privacy and verify the result before publishing anything.
  if ((st.mode & 0o077) !== 0) {
    chmodSync(dir, 0o700);
    st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== myUid || (st.mode & 0o077) !== 0) {
      throw new Error(`Bridge temp dir ${dir} could not be verified as private after chmod.`);
    }
  }
}

export function getTempDir(options?: BridgeOptions): string {
  return options?.tempDir || process.env.PREMIERE_TEMP_DIR || DEFAULT_TEMP_DIR;
}

/**
 * Inspect the CEP panel's small, content-free heartbeat. This never creates a
 * directory or reads command, response, project, or media data. Unknown is
 * intentionally non-fatal so a server upgrade stays compatible with older CEP
 * panels that do not publish a heartbeat yet.
 */
export function getBridgeLiveness(
  options?: BridgeOptions,
  nowMs = Date.now(),
): BridgeLiveness {
  const heartbeatPath = join(getTempDir(options), BRIDGE_HEARTBEAT_FILE);
  try {
    if (!existsSync(heartbeatPath)) return { state: "unknown", ageMs: null };
    const raw = readFileSync(heartbeatPath, "utf-8");
    const heartbeat = JSON.parse(raw) as Record<string, unknown>;
    if (
      heartbeat.protocolVersion !== 1 ||
      (heartbeat.state !== "running" && heartbeat.state !== "waiting")
    ) {
      return { state: "unknown", ageMs: null };
    }
    const ageMs = Math.max(0, nowMs - statSync(heartbeatPath).mtimeMs);
    return ageMs > BRIDGE_HEARTBEAT_STALE_MS
      ? { state: "stale", ageMs }
      : { state: heartbeat.state, ageMs };
  } catch {
    return { state: "unknown", ageMs: null };
  }
}

/** Transport compatibility is independent from host API support and liveness. */
export function getBridgeCompatibility(options?: BridgeOptions) {
  const legacy = { compatible: true, boundary: "legacy_transport", commandSchemaVersion: null as number | null, receiptVersion: null as number | null };
  try {
    const path = join(getTempDir(options), BRIDGE_HEARTBEAT_FILE);
    if (!existsSync(path)) return legacy;
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 4096) return { ...legacy, compatible: false, boundary: "invalid_heartbeat" };
    const value = JSON.parse(raw);
    if (value.commandSchemaVersion === undefined && value.receiptVersion === undefined) return legacy;
    return {
      compatible: value.commandSchemaVersion === 1 && value.receiptVersion === 1,
      boundary: "versioned_command_and_receipt_schema",
      commandSchemaVersion: Number.isInteger(value.commandSchemaVersion) ? value.commandSchemaVersion as number : null,
      receiptVersion: Number.isInteger(value.receiptVersion) ? value.receiptVersion as number : null,
    };
  } catch { return { ...legacy, compatible: false, boundary: "unreadable_heartbeat" }; }
}

function heartbeatFailure(liveness: BridgeLiveness, hostLabel = "Premiere Pro", requireHeartbeat = false): CommandResult | null {
  if (liveness.state === "waiting") {
    return {
      success: false,
      error:
        `The CEP connector is open but not running. In ${hostLabel}, open Window > Extensions > MCP Bridge, wait for it to finish starting, then retry once.`,
    };
  }
  if (liveness.state === "stale") {
    return {
      success: false,
      error:
        `The CEP connector heartbeat is stale. Reopen Window > Extensions > MCP Bridge in ${hostLabel}, dismiss any blocking dialog, and retry once after it reports running.` +
        (hostLabel === "Premiere Pro" ? ` ${BRIDGE_BLOCKING_HINT}` : ""),
    };
  }
  if (requireHeartbeat && liveness.state === "unknown") {
    return {
      success: false,
      error:
        `${hostLabel} is not running its MCP connector (no heartbeat). Open ${hostLabel}, then Window > Extensions > MCP Bridge, and retry. No command was sent.`,
    };
  }
  return null;
}

/**
 * Make sure this server version's helpers file exists in the temp dir, and return
 * the bootstrap line each command must carry so the CEP-side engine loads it once.
 */
function ensureHelpers(tempDir: string, helpers?: BridgeHelpers): string {
  const activeHelpers = helpers ?? {
    source: getHelpersSource(),
    fileName: helpersFileName(),
    buildBootstrap,
  };
  const helpersPath = join(tempDir, activeHelpers.fileName);
  if (!existsSync(helpersPath)) {
    writeFileSync(helpersPath, activeHelpers.source, "utf-8");
  }
  return activeHelpers.buildBootstrap(helpersPath);
}

/**
 * Send a command (ExtendScript) to the CEP plugin and wait for a response.
 * 
 * Protocol:
 * 1. Write the script to a staging file, then atomically publish it as
 *    <tempDir>/cmd_<id>.jsx. The CEP panel only sees complete commands.
 * 2. CEP plugin picks it up, executes, writes result to <tempDir>/res_<id>.json
 * 3. We poll for the response file and parse it.
 */
export async function sendCommand(
  script: string,
  options?: BridgeOptions
): Promise<CommandResult> {
  validateScript(script);
  const tempDir = getTempDir(options);
  return executeOwnedCommand(tempDir, options, () => sendCommandUnchecked(script, options));
}

/** Hold one cooperating-process lease across a tool's inspect/apply/readback calls. */
export async function withBridgeWorkflow<T>(options: BridgeOptions | undefined, work: () => Promise<T>): Promise<T> {
  const tempDir = getTempDir(options);
  ensurePrivateBridgeDirectory(tempDir);
  if (ownsHostLease(tempDir)) return work();
  // Reuse the bounded scheduler for the entire workflow. Nested commands bypass
  // it under the inherited lease, avoiding a queue/lease inversion deadlock.
  const finishQueue = startStage("queue_wait");
  return scheduleBridgeCommand(tempDir, () => withHostLease(tempDir, options?.timeoutMs || DEFAULT_TIMEOUT_MS, async () => {
    finishQueue();
    return { success: true, data: await work() };
  })).then((result) => {
    if (!result.success) throw new HostLeaseError("HOST_WORKFLOW_QUEUE_FULL", result.error || "Protected workflow queue is full");
    return result.data as T;
  }).finally(finishQueue);
}
async function executeOwnedCommand(tempDir: string, options: BridgeOptions | undefined, work: () => Promise<CommandResult>): Promise<CommandResult> {
  ensurePrivateBridgeDirectory(tempDir);
  const nested = ownsHostLease(tempDir);
  const finishQueue = nested ? () => {} : startStage("queue_wait");
  const run = async () => {
    try {
      return await withHostLease(tempDir, options?.timeoutMs || DEFAULT_TIMEOUT_MS, async () => {
        finishQueue();
        const mutating = options?.mutating ?? (options?.mutationOnTimeout === true || undoTrackingEnabled());
        if (mutating && !getBridgeCompatibility(options).compatible) return { success: false, data: { mutationOutcome: "not_applied" }, error: "CEP_SCHEMA_INCOMPATIBLE: install the matching CEP panel before editing; no command was dispatched" };
        if (mutating && inspectHostRecovery(tempDir).recoveryRequired) return { success: false, data: { mutationOutcome: "not_applied", recoveryRequired: true }, error: "HOST_RECOVERY_REQUIRED: inspect current Premiere state and acknowledge the matching recovery revision before another edit" };
        const result = await measureStage("host_wait", work);
        const data = result.data as { mutationOutcome?: string } | undefined;
        if (data?.mutationOutcome === "unknown") markHostRecovery(tempDir, "unknown_command_outcome");
        return result;
      });
    } catch (error) {
      if (error instanceof HostLeaseError) return { success: false, data: { mutationOutcome: error.code === "HOST_LEASE_LOST" ? "unknown" : "not_applied", ...(error.code === "HOST_LEASE_LOST" ? { recoveryRequired: true } : {}) }, error: `${error.code}: ${error.message}` };
      throw error;
    }
  };
  return (nested ? run() : scheduleBridgeCommand(tempDir, run)).finally(finishQueue);
}

async function sendCommandUnchecked(
  script: string,
  options?: BridgeOptions,
): Promise<CommandResult> {
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensurePrivateBridgeDirectory(tempDir);

  if (options?.failFastOnUnreadyHeartbeat || options?.requireHeartbeat) {
    const failure = heartbeatFailure(getBridgeLiveness(options), options.hostLabel, options.requireHeartbeat === true);
    if (failure) return failure;
  }

  const id = randomUUID();
  const cmdFile = join(tempDir, `cmd_${id}.jsx`);
  const stagedCmdFile = `${cmdFile}.staged`;
  const resFile = join(tempDir, `res_${id}.json`);
  const busyFile = join(tempDir, `busy_${id}.json`);

  try {
    // Write a complete command before its .jsx name makes it visible to CEP.
    // renameSync is atomic when both paths are in the bridge directory.
    measureStageSync("dispatch", () => {
    writeFileSync(stagedCmdFile, `${ensureHelpers(tempDir, options?.helpers)}
${script}`, "utf-8");
    assertInvocationNotCancelled();
    renameSync(stagedCmdFile, cmdFile);
    if (options?.mutating ?? (options?.mutationOnTimeout === true || undoTrackingEnabled())) markHostDispatch();
    });

    const mutating = options?.mutating ?? (options?.mutationOnTimeout === true || undoTrackingEnabled());
    return await pollForResponse(resFile, busyFile, timeoutMs, options?.hostLabel, options?.mutating === false ? false : (options?.mutationOnTimeout === true || undoTrackingEnabled()), mutating);
  } finally {
    safeUnlink(stagedCmdFile);
    safeUnlink(cmdFile);
    safeUnlink(resFile);
    safeUnlink(busyFile);
  }
}

function validateScript(script: string, allowUnsafe = false): void {
  validateBridgeScriptSize(script);

  if (allowUnsafe) return;

  // Block dangerous patterns in user-provided parameters
  // Note: we don't block these in our own generated code, only check for injection
  const dangerousPatterns = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bSystem\s*\.\s*callSystem\s*\(/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(script)) {
      throw new Error(`Script contains blocked pattern: ${pattern.source}`);
    }
  }
}

/**
 * Send a raw/custom ExtendScript allowing all patterns (for LLM-authored scripts).
 * Still enforces size limit. The script should already include helpers via buildToolScript.
 */
export async function sendRawCommand(
  script: string,
  options?: BridgeOptions
): Promise<CommandResult> {
  validateScript(script, true);
  const tempDir = getTempDir(options);
  return executeOwnedCommand(tempDir, options, () => sendRawCommandUnchecked(script, options));
}

async function sendRawCommandUnchecked(
  script: string,
  options?: BridgeOptions,
): Promise<CommandResult> {
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensurePrivateBridgeDirectory(tempDir);

  if (options?.failFastOnUnreadyHeartbeat || options?.requireHeartbeat) {
    const failure = heartbeatFailure(getBridgeLiveness(options), options.hostLabel, options.requireHeartbeat === true);
    if (failure) return failure;
  }

  const id = randomUUID();
  const cmdFile = join(tempDir, `cmd_${id}.jsx`);
  const stagedCmdFile = `${cmdFile}.staged`;
  const resFile = join(tempDir, `res_${id}.json`);
  const busyFile = join(tempDir, `busy_${id}.json`);

  try {
    measureStageSync("dispatch", () => {
    writeFileSync(stagedCmdFile, `${ensureHelpers(tempDir, options?.helpers)}
${script}`, "utf-8");
    assertInvocationNotCancelled();
    renameSync(stagedCmdFile, cmdFile);
    if (options?.mutating ?? (options?.mutationOnTimeout === true || undoTrackingEnabled())) markHostDispatch();
    });
    const mutating = options?.mutating ?? (options?.mutationOnTimeout === true || undoTrackingEnabled());
    return await pollForResponse(resFile, busyFile, timeoutMs, options?.hostLabel, options?.mutating === false ? false : (options?.mutationOnTimeout === true || undoTrackingEnabled()), mutating);
  } finally {
    safeUnlink(stagedCmdFile);
    safeUnlink(cmdFile);
    safeUnlink(resFile);
    safeUnlink(busyFile);
  }
}

/** A busy file unchanged for this long past the deadline means the CEP panel is stuck. */
const STUCK_BUSY_MS = 10_000;
export const BRIDGE_BLOCKING_HINT =
  "Call get_bridge_telemetry (read-only; it sends no command) and read its blocking.state to see whether a dialog is blocking Premiere before you retry.";
/** How often a live (fresh busy marker) CEP command emits a progress heartbeat. */
export const HOST_HEARTBEAT_INTERVAL_MS = 10_000;

async function pollForResponse(
  resFile: string,
  busyFile: string,
  timeoutMs: number,
  hostLabel = "Premiere Pro",
  mutationOnTimeout = false,
  mutating = false,
): Promise<CommandResult> {
  const start = Date.now();
  // The CEP plugin writes busy_<id>.json every ~2s while evalScript is in flight.
  // A fresh busy file past the deadline means Premiere accepted the script but hasn't
  // returned — nearly always a modal dialog blocking the scripting engine, or a
  // genuinely long operation — so we keep waiting up to a hard cap instead of
  // misreporting "is the plugin running?".
  const hardCapMs = Math.max(timeoutMs * 4, 120_000);
  let sawBusy = false;
  let busyAgeMs = 0;
  let lastResponseParseError: string | undefined;
  // Captured here: the shared response watcher can call check() from another
  // invocation's async context, which must never receive this command's heartbeat.
  const invocation = currentInvocation();
  let lastHeartbeatAt = start;
  const heartbeat = (elapsed: number) => {
    if (!invocation?.notify || invocation.progressToken === undefined) return;
    const now = Date.now();
    if (now - lastHeartbeatAt < HOST_HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatAt = now;
    // Only a busy marker the panel refreshed recently proves the host is still
    // running this command; a queued, stuck, or vanished command gets no heartbeat.
    try {
      if (!existsSync(busyFile) || now - statSync(busyFile).mtimeMs >= STUCK_BUSY_MS) return;
    } catch {
      return;
    }
    void reportHostHeartbeat(elapsed, invocation);
  };

  // fresh: refreshed within STUCK_BUSY_MS; stuck: present but unchanged for
  // longer (a crashed panel leaves its busy file behind); absent/unknown: gone,
  // or unreadable. A stuck busy file is never deleted: if the panel is only
  // slow, removing it could run the command twice.
  const busyState = (): "fresh" | "stuck" | "absent" | "unknown" => {
    try {
      if (!existsSync(busyFile)) return "absent";
      sawBusy = true;
      busyAgeMs = Date.now() - statSync(busyFile).mtimeMs;
      return busyAgeMs < STUCK_BUSY_MS ? "fresh" : "stuck";
    } catch {
      return "unknown";
    }
  };

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let stopWatching = () => {};
    let fallbackDelay = 100;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stopWatching();
      resolve(result);
    };
    // Point Premiere clients at the no-command blocking diagnosis. Companion
    // hosts (After Effects) use their own bridge, which that tool does not read.
    const finishTimedOut = (result: CommandResult) => finish(
      hostLabel === "Premiere Pro" ? { ...result, error: `${result.error} ${BRIDGE_BLOCKING_HINT}` } : result,
    );

    const scheduleFallback = () => {
      if (!settled) {
        timer = setTimeout(check, fallbackDelay);
        fallbackDelay = POLL_FALLBACK_MS;
      }
    };

    const check = () => {
      if (settled) return;
      if (existsSync(resFile)) {
        try {
          const responseSize = statSync(resFile).size;
          if (responseSize > MAX_BRIDGE_RESPONSE_BYTES) {
            finish({
              success: false,
              error: `Bridge response exceeds the ${MAX_BRIDGE_RESPONSE_BYTES}-byte limit`,
            });
            return;
          }
          const result = measureStageSync("readback", () => JSON.parse(readFileSync(resFile, "utf-8")) as CommandResult);
          if (typeof result !== "object" || result === null || typeof result.success !== "boolean") {
            lastResponseParseError = "Failed to parse response: missing boolean success field";
          } else if (result.success && typeof result.data === "string" && /^EvalScript error/i.test(result.data)) {
            // Older connectors wrapped CEP's script-crash message as successful data.
            finish({
              success: false,
              error: `${hostLabel} could not run the generated script (${result.data}). No result was produced; treat the command as failed.`,
            });
            return;
          } else {
            finish(result);
            return;
          }
        } catch (e) {
          // A CEP response can be observed while an older connector is still writing it.
          // Keep polling the same response file; never resend the host operation.
          lastResponseParseError =
            `Failed to parse response: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const elapsed = Date.now() - start;
      heartbeat(elapsed);
      if (elapsed >= timeoutMs) {
        // Keep waiting (up to the hard cap) only while the panel keeps
        // refreshing its busy file. One that has not changed for STUCK_BUSY_MS
        // means the panel is stuck or gone; fail now instead of waiting hours.
        const busy = busyState();
        if (busy === "fresh" && elapsed <= hardCapMs) {
          scheduleFallback();
          return;
        }
        if (busy === "stuck") {
          finishTimedOut({
            success: false,
            ...(mutationOnTimeout ? { data: { mutationOutcome: "unknown", timelineChanged: null } } : {}),
            error: mutationOnTimeout
              ? `${hostLabel} accepted the edit but stopped responding; the timeline state is unknown and ${hostLabel} may still be applying it. Wait until the host is idle, inspect the timeline, then decide whether a retry is safe.`
              :
              `The CEP panel appears stuck: its busy marker for this command has not changed for ${Math.round(busyAgeMs / 1000)} s. ` +
              `Reload it in ${hostLabel} (Window > Extensions > MCP Bridge). ` +
              (mutating ? `The mutation outcome is unknown; inspect ${hostLabel} before retrying.` : `The command may or may not have run; check ${hostLabel} before retrying.`),
            ...(mutating ? { data: { mutationOutcome: "unknown", timelineChanged: null } } : {}),
          });
          return;
        }
        if (lastResponseParseError) {
          finish({ success: false, error: lastResponseParseError });
          return;
        }
        const cmdFile = join(dirname(resFile), basename(resFile).replace(/^res_/, "cmd_").replace(/\.json$/, ".jsx"));
        const queuedState = cancelQueuedBehindLivePanel(cmdFile, busyFile, hardCapMs);
        const panelHostName = hostLabel === "Premiere Pro" ? "Premiere" : hostLabel;
        finishTimedOut({
          success: false,
          ...(mutationOnTimeout && sawBusy ? { data: { mutationOutcome: "unknown", timelineChanged: null } } : {}),
          error: sawBusy
            ? mutationOnTimeout
              ? `${hostLabel} accepted the edit but did not finish within ${elapsed}ms. The timeline state is unknown; ${hostLabel} may still be applying it. Wait until the host is idle, inspect the timeline, and only then consider a retry.`
              : `${hostLabel} accepted the script but did not finish within ${elapsed}ms. ` +
              `A modal dialog or a long analysis inside ${hostLabel} is likely blocking the scripting engine — ` +
              `check the ${hostLabel} window and dismiss any open dialog.` +
              (mutating ? ` The mutation outcome is unknown; inspect the timeline before retrying.` : ` The result, if any, will be discarded.`)
              : queuedState === "cancelled"
              ? `${panelHostName} is busy or blocked by an earlier command (for example an export or a dialog). This command was not run; retry when ${panelHostName} is responsive.`
              : queuedState === "claim_race"
                ? `${hostLabel} is busy with an earlier command, and Premiere claimed this command while its timeout was expiring. Its outcome is unknown; inspect ${hostLabel} before retrying.`
                : mutating
                  ? `The mutation did not return within ${timeoutMs}ms. Its outcome is unknown; inspect ${hostLabel} before retrying.`
              : `Command timed out after ${timeoutMs}ms. Is the MCP connector panel running in ${hostLabel}?`,
          ...(mutating && queuedState === "cancelled"
            ? { data: { mutationOutcome: "not_applied", timelineChanged: false } }
            : mutating && (sawBusy || queuedState === "claim_race")
              ? { data: { mutationOutcome: "unknown", timelineChanged: null } }
              : mutating
                ? { data: { mutationOutcome: "unknown", timelineChanged: null } }
              : {}),
        });
        return;
      }

      scheduleFallback();
    };

    // Prefer event-driven notification for low response latency without
    // allocating one fs.watch handle per concurrent command. The timer above
    // still protects against missed or coalesced filesystem events.
    stopWatching = watchResponseFile(resFile, check);
    check();
  });
}

function cancelQueuedBehindLivePanel(
  cmdFile: string,
  ownBusyFile: string,
  hardCapMs: number,
): "cancelled" | "claim_race" | "none" {
  // The panel atomically renames a command to `.claimed` immediately before
  // execution. A mere existence check races that rename, so claim the opposite
  // rename ourselves: success proves the panel did not pick up this command.
  if (!existsSync(cmdFile)) return "none";
  try {
    const directory = dirname(ownBusyFile);
    const now = Date.now();
    const anotherCommandIsWithinHardCap = readdirSync(directory).some((name) => {
      if (!name.startsWith("busy_") || !name.endsWith(".json")) return false;
      const otherBusyFile = join(directory, name);
      if (otherBusyFile === ownBusyFile) return false;
      try { return now - statSync(otherBusyFile).mtimeMs < hardCapMs; }
      catch { return false; }
    });
    const heartbeat = getBridgeLiveness({ tempDir: directory }, now);
    const panelHeartbeatIsRecent = heartbeat.state === "running" || heartbeat.state === "waiting";
    if (!anotherCommandIsWithinHardCap && !panelHeartbeatIsRecent) return "none";
    const cancelledFile = `${cmdFile}.cancelled`;
    try {
      renameSync(cmdFile, cancelledFile);
      safeUnlink(cancelledFile);
      return "cancelled";
    } catch {
      // CEP claimed the command first. It may still run, so timeout is unknown.
      return "claim_race";
    }
  } catch {
    return "none";
  }
}

export type BridgeBlockingState =
  | "idle"
  | "busy"
  | "likely_blocked_by_dialog"
  | "stuck"
  | "connector_not_running"
  | "unknown";

export interface BridgeBlockingDiagnosis {
  state: BridgeBlockingState;
  reason: string;
  summary: string;
  commandSent: false;
  heartbeat: BridgeLiveness;
  activeCommand: {
    markerAgeMs: number;
    elapsedMs: number | null;
    expectedMs: number;
    tool: string | null;
  } | null;
  counts: {
    queuedCommands: number;
    oldestQueuedAgeMs: number | null;
    busyMarkers: number;
    freshBusyMarkers: number;
    stalledBusyMarkers: number;
  };
  runningToolCalls: { tool: string; ageMs: number }[];
  thresholds: { heartbeatStaleMs: number; stuckBusyMs: number; expectedCommandMs: number };
  windowProbe: { performed: false; reason: string };
  nextSteps: string[];
}

export interface BridgeBlockingInput {
  /** A command running longer than this while the panel is alive is treated as likely blocked. */
  expectedCommandMs?: number;
  /** In-process running tool calls (tool name and start time only). */
  runningToolCalls?: readonly { tool: string; startedAt: string }[];
  /** Test seams for the POSIX owner check. */
  myUid?: number;
  platform?: NodeJS.Platform;
}

const MAX_BUSY_MARKER_BYTES = 256;
const MAX_REPORTED_TOOL_CALLS = 5;
const WINDOW_PROBE_SKIPPED =
  "No operating-system window probe is performed: on macOS it needs Accessibility permission, and window titles can contain project or media names. The diagnosis uses only bridge heartbeat and busy-marker timing.";

/** Read the panel-reported elapsed time from a busy marker; never returns its id. */
function readBusyElapsedMs(file: string): number | null {
  try {
    if (statSync(file).size > MAX_BUSY_MARKER_BYTES) return null;
    const value = JSON.parse(readFileSync(file, "utf-8")) as { elapsedMs?: unknown } | null;
    const elapsed = value?.elapsedMs;
    return typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
  } catch {
    return null;
  }
}

/**
 * Diagnose whether the CEP bridge is blocked (for example by a modal dialog)
 * without sending a command. A modal blocks Premiere's scripting engine, so a
 * probe script could never run. This reads only file timing in the private
 * bridge directory: the 1 s panel heartbeat, `busy_<id>.json` markers (written
 * every 2 s by the panel while evalScript is in flight, starting 2 s in), and
 * queued `cmd_<id>.jsx` files. It never creates, deletes, or renames files and
 * never returns paths, file names, command ids, or command contents.
 */
export function diagnoseBridgeBlocking(
  options?: BridgeOptions,
  nowMs = Date.now(),
  input: BridgeBlockingInput = {},
): BridgeBlockingDiagnosis {
  const directory = getTempDir(options);
  const expectedMs = input.expectedCommandMs ?? options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runningToolCalls = (input.runningToolCalls ?? [])
    .map((call) => ({ tool: call.tool, ageMs: Math.max(0, nowMs - Date.parse(call.startedAt)) }))
    .filter((call) => Number.isFinite(call.ageMs))
    .slice(0, MAX_REPORTED_TOOL_CALLS);
  const counts = { queuedCommands: 0, oldestQueuedAgeMs: null as number | null, busyMarkers: 0, freshBusyMarkers: 0, stalledBusyMarkers: 0 };
  const result = (
    state: BridgeBlockingState,
    reason: string,
    summary: string,
    nextSteps: string[],
    heartbeat: BridgeLiveness,
    activeCommand: BridgeBlockingDiagnosis["activeCommand"] = null,
  ): BridgeBlockingDiagnosis => ({
    state,
    reason,
    summary,
    commandSent: false,
    heartbeat,
    activeCommand,
    counts,
    runningToolCalls,
    thresholds: { heartbeatStaleMs: BRIDGE_HEARTBEAT_STALE_MS, stuckBusyMs: STUCK_BUSY_MS, expectedCommandMs: expectedMs },
    windowProbe: { performed: false, reason: WINDOW_PROBE_SKIPPED },
    nextSteps,
  });
  const recheck = "Then call get_bridge_telemetry again; it sends no command.";
  const openPanel = "In Premiere Pro, open Window > Extensions > MCP Bridge and make sure it reports running.";
  const sameUser = "Check that the MCP server and Premiere Pro run as the same user.";
  const noHeartbeat: BridgeLiveness = { state: "unknown", ageMs: null };

  let directoryStats: Stats;
  try {
    if (!existsSync(directory)) {
      return result("connector_not_running", "bridge_directory_missing",
        "The bridge directory does not exist yet, so the CEP connector has not started for this server.",
        [openPanel, recheck], noHeartbeat);
    }
    directoryStats = lstatSync(directory);
  } catch {
    return result("unknown", "bridge_directory_unreadable", "The bridge directory could not be inspected.", [sameUser, recheck], noHeartbeat);
  }
  const platform = input.platform ?? process.platform;
  const myUid = input.myUid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory() || (platform !== "win32" && myUid !== undefined && directoryStats.uid !== myUid)) {
    return result("unknown", "bridge_directory_untrusted",
      "The bridge path is not a private directory owned by this user, so its markers were not read.",
      ["Remove the bridge directory or set PREMIERE_TEMP_DIR to a path only you control, then restart the connector.", recheck],
      noHeartbeat);
  }

  const heartbeat = getBridgeLiveness(options, nowMs);
  let freshest: { markerAgeMs: number; elapsedMs: number | null } | null = null;
  let stalest: { markerAgeMs: number; elapsedMs: number | null } | null = null;
  try {
    for (const name of readdirSync(directory)) {
      const queued = /^cmd_.+\.jsx$/.test(name);
      if (!queued && !/^busy_.+\.json$/.test(name)) continue;
      const file = join(directory, name);
      let ageMs: number;
      try {
        const entry = lstatSync(file);
        if (!entry.isFile()) continue;
        ageMs = Math.max(0, nowMs - entry.mtimeMs);
      } catch {
        continue; // claimed or finished between listing and stat
      }
      if (queued) {
        counts.queuedCommands++;
        counts.oldestQueuedAgeMs = Math.max(counts.oldestQueuedAgeMs ?? 0, ageMs);
        continue;
      }
      counts.busyMarkers++;
      const marker = { markerAgeMs: ageMs, elapsedMs: readBusyElapsedMs(file) };
      if (ageMs < STUCK_BUSY_MS) {
        counts.freshBusyMarkers++;
        if (!freshest || (marker.elapsedMs ?? -1) > (freshest.elapsedMs ?? -1)) freshest = marker;
      } else {
        counts.stalledBusyMarkers++;
        if (!stalest || ageMs > stalest.markerAgeMs) stalest = marker;
      }
    }
  } catch {
    return result("unknown", "bridge_directory_unreadable", "The bridge directory could not be listed.", [sameUser, recheck], heartbeat);
  }

  // The panel runs one command at a time and host work is serialized, so a
  // single running tool call is the one the marker belongs to.
  const tool = runningToolCalls.length === 1 ? runningToolCalls[0].tool : null;
  const dismiss = "Bring Premiere Pro to the front and dismiss any open dialog (for example Missing Media, Save, or an alert).";
  const noReplay = "Do not resend edits: call get_last_operations and read the timeline back first.";

  if (freshest) {
    const activeCommand = { ...freshest, expectedMs, tool };
    if (freshest.elapsedMs !== null && freshest.elapsedMs >= expectedMs) {
      return result("likely_blocked_by_dialog", "command_exceeded_expected_time",
        `Premiere Pro accepted a command ${Math.round(freshest.elapsedMs / 1000)} s ago and the panel is alive, but the scripting engine has not returned. A modal dialog is the usual cause; a long export or analysis looks the same.`,
        [dismiss, "If no dialog is visible, wait for any long export or analysis to finish.", noReplay, recheck],
        heartbeat, activeCommand);
    }
    return result("busy", "command_executing",
      "Premiere Pro is executing a command and the panel is refreshing its busy marker.",
      ["Wait for the running command to return before sending another edit.", recheck], heartbeat, activeCommand);
  }

  // Nothing removes a busy marker whose panel was reloaded or crashed. With no
  // call of this server still running, such a marker is history, not a block:
  // ignore it once the heartbeat is live again, or once it is older than any
  // command this server would still wait for, so the other states stay reachable.
  const heartbeatLive = heartbeat.state === "running" || heartbeat.state === "waiting";
  const orphaned = stalest !== null && runningToolCalls.length === 0
    && (heartbeatLive || stalest.markerAgeMs > expectedMs + STUCK_BUSY_MS);
  if (stalest && !orphaned) {
    const activeCommand = { ...stalest, expectedMs, tool };
    if (heartbeat.state === "running" || heartbeat.state === "waiting") {
      return result("stuck", "busy_marker_orphaned",
        "A busy marker stopped refreshing while the panel heartbeat is live: the panel that ran that command was reloaded or crashed, and its result will not arrive.",
        [noReplay, "Reload the panel (Window > Extensions > MCP Bridge) if commands keep timing out.", recheck],
        heartbeat, activeCommand);
    }
    return result("stuck", "panel_frozen_with_command_in_flight",
      "The panel heartbeat and the busy marker both stopped refreshing while a command was in flight. A modal dialog, a long export that blocks the panel, or a crashed panel causes this.",
      [dismiss, "If Premiere Pro is not open or shows no dialog, reload the panel (Window > Extensions > MCP Bridge).", noReplay, recheck],
      heartbeat, activeCommand);
  }

  if (heartbeat.state === "stale") {
    return result("connector_not_running", "heartbeat_stale",
      "The CEP panel heartbeat stopped refreshing: the panel is closed, Premiere Pro quit, or a dialog is freezing the panel.",
      [dismiss, `If no dialog is visible: ${openPanel}`, recheck], heartbeat);
  }
  if (heartbeat.state === "waiting") {
    return result("connector_not_running", "connector_stopped",
      "The CEP panel is open but its connector is stopped.",
      ["In the MCP Bridge panel, click Start Bridge.", recheck], heartbeat);
  }
  if (heartbeat.state === "unknown") {
    return existsSync(join(directory, BRIDGE_HEARTBEAT_FILE))
      ? result("unknown", "heartbeat_unreadable",
        "The heartbeat file is present but unreadable or from an unsupported connector version.",
        ["Install the CEP panel that matches this server (npm run install-cep), then restart it.", recheck], heartbeat)
      : result("connector_not_running", "no_heartbeat",
        "No connector heartbeat exists: the panel has not started, or it predates heartbeat support.",
        [openPanel, recheck], heartbeat);
  }

  if (counts.queuedCommands > 0 && (counts.oldestQueuedAgeMs ?? 0) >= STUCK_BUSY_MS) {
    return result("unknown", "queue_not_draining",
      "The panel heartbeat is live, but queued commands are not being picked up.",
      ["Reload the panel (Window > Extensions > MCP Bridge).", recheck], heartbeat);
  }
  if (counts.queuedCommands > 0) {
    return result("busy", "command_starting",
      "A command is queued and the panel is live; it should start within a second.",
      [recheck], heartbeat);
  }
  return result("idle", "panel_idle",
    "The panel heartbeat is live and no command is in flight.",
    ["The bridge is ready. If an earlier call timed out, check get_last_operations before retrying it."], heartbeat);
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Clean up any stale command/response files from the temp directory.
 */
export function cleanupTempDir(options?: BridgeOptions): void {
  const tempDir = getTempDir(options);
  if (!existsSync(tempDir)) return;

  // Validate before enumerating or deleting. Startup cleanup must never follow
  // an attacker-controlled symlink/junction or adopt an untrusted directory.
  ensurePrivateBridgeDirectory(tempDir);

  try {
    const files = readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith("cmd_") || file.startsWith("res_") || file.startsWith("busy_")) {
        safeUnlink(join(tempDir, file));
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
