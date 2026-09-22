import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, renameSync, statSync, lstatSync, realpathSync, chmodSync, watch, FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { getHelpersSource, helpersFileName, buildBootstrap } from "./script-builder.js";

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
    scheduler!.pending.push({ run, resolve, reject });
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

export function inspectWindowsBridgeDirectoryAcl(
  directory: string,
  initialize: boolean,
): WindowsBridgeDirectoryAcl {
  const encodedCommand = Buffer.from(WINDOWS_BRIDGE_ACL_SCRIPT, "utf16le").toString("base64");
  const raw = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
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

function heartbeatFailure(liveness: BridgeLiveness): CommandResult | null {
  if (liveness.state === "waiting") {
    return {
      success: false,
      error:
        "The CEP connector is open but not running. In Premiere Pro, open Window > Extensions > MCP Bridge, wait for it to finish starting, then retry once.",
    };
  }
  if (liveness.state === "stale") {
    return {
      success: false,
      error:
        "The CEP connector heartbeat is stale. Reopen Window > Extensions > MCP Bridge in Premiere Pro, dismiss any blocking dialog, and retry once after it reports running.",
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
  return scheduleBridgeCommand(tempDir, () => sendCommandUnchecked(script, options));
}

async function sendCommandUnchecked(
  script: string,
  options?: BridgeOptions,
): Promise<CommandResult> {
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensurePrivateBridgeDirectory(tempDir);

  if (options?.failFastOnUnreadyHeartbeat) {
    const failure = heartbeatFailure(getBridgeLiveness(options));
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
    writeFileSync(stagedCmdFile, `${ensureHelpers(tempDir, options?.helpers)}
${script}`, "utf-8");
    renameSync(stagedCmdFile, cmdFile);

    return await pollForResponse(resFile, busyFile, timeoutMs);
  } finally {
    safeUnlink(stagedCmdFile);
    safeUnlink(cmdFile);
    safeUnlink(resFile);
    safeUnlink(busyFile);
  }
}

function validateScript(script: string, allowUnsafe = false): void {
  const MAX_SCRIPT_SIZE = 500 * 1024; // 500KB
  if (Buffer.byteLength(script, "utf-8") > MAX_SCRIPT_SIZE) {
    throw new Error("Script exceeds 500KB size limit");
  }

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
  return scheduleBridgeCommand(tempDir, () => sendRawCommandUnchecked(script, options));
}

async function sendRawCommandUnchecked(
  script: string,
  options?: BridgeOptions,
): Promise<CommandResult> {
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensurePrivateBridgeDirectory(tempDir);

  if (options?.failFastOnUnreadyHeartbeat) {
    const failure = heartbeatFailure(getBridgeLiveness(options));
    if (failure) return failure;
  }

  const id = randomUUID();
  const cmdFile = join(tempDir, `cmd_${id}.jsx`);
  const stagedCmdFile = `${cmdFile}.staged`;
  const resFile = join(tempDir, `res_${id}.json`);
  const busyFile = join(tempDir, `busy_${id}.json`);

  try {
    writeFileSync(stagedCmdFile, `${ensureHelpers(tempDir, options?.helpers)}
${script}`, "utf-8");
    renameSync(stagedCmdFile, cmdFile);
    return await pollForResponse(resFile, busyFile, timeoutMs);
  } finally {
    safeUnlink(stagedCmdFile);
    safeUnlink(cmdFile);
    safeUnlink(resFile);
    safeUnlink(busyFile);
  }
}

async function pollForResponse(
  resFile: string,
  busyFile: string,
  timeoutMs: number
): Promise<CommandResult> {
  const start = Date.now();
  // The CEP plugin writes busy_<id>.json every ~2s while evalScript is in flight.
  // A fresh busy file past the deadline means Premiere accepted the script but hasn't
  // returned — nearly always a modal dialog blocking the scripting engine, or a
  // genuinely long operation — so we keep waiting up to a hard cap instead of
  // misreporting "is the plugin running?".
  const hardCapMs = Math.max(timeoutMs * 4, 120_000);
  let sawBusy = false;
  let lastResponseParseError: string | undefined;

  const busyIsFresh = (): boolean => {
    try {
      if (!existsSync(busyFile)) return false;
      sawBusy = true;
      return Date.now() - statSync(busyFile).mtimeMs < 6_000;
    } catch {
      return false;
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
          const raw = readFileSync(resFile, "utf-8");
          const result = JSON.parse(raw) as CommandResult;
          if (typeof result !== "object" || result === null || typeof result.success !== "boolean") {
            lastResponseParseError = "Failed to parse response: missing boolean success field";
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
      if (elapsed >= timeoutMs) {
        const stillBusy = busyIsFresh();
        if (stillBusy && elapsed <= hardCapMs) {
          scheduleFallback();
          return;
        }
        if (lastResponseParseError) {
          finish({ success: false, error: lastResponseParseError });
          return;
        }
        finish({
          success: false,
          error: sawBusy
            ? `Premiere accepted the script but did not finish within ${elapsed}ms. ` +
              `A modal dialog inside Premiere Pro is likely blocking the scripting engine — ` +
              `check the Premiere window and dismiss any open dialog. ` +
              `(The result, if any, will be discarded.)`
            : `Command timed out after ${timeoutMs}ms. Is the CEP plugin running in Premiere Pro?`,
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
