import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync, chmodSync, watch, FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { getHelpersSource, helpersFileName, buildBootstrap } from "./script-builder.js";

const DEFAULT_TEMP_DIR = join(tmpdir(), "premiere-mcp-bridge");
const POLL_FALLBACK_MS = 250;
const DEFAULT_TIMEOUT_MS = 30000;

export interface BridgeOptions {
  tempDir?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

let commandCounter = 0;

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
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return;
  }

  // POSIX only — Windows doesn't model uid/mode the same way, and its per-user temp
  // dir isn't world-writable to begin with.
  if (process.platform === "win32") return;

  const st = statSync(dir);
  const myUid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (myUid !== undefined && st.uid !== myUid) {
    throw new Error(
      `Bridge temp dir ${dir} is owned by uid ${st.uid}, not this user (${myUid}). ` +
        `Refusing to use it — another user may have staged command files. ` +
        `Set PREMIERE_TEMP_DIR to a path only you control.`
    );
  }

  // Clamp to owner-only, in case it was created with looser perms before this fix.
  if ((st.mode & 0o077) !== 0) {
    chmodSync(dir, 0o700);
  }
}

export function getTempDir(options?: BridgeOptions): string {
  return options?.tempDir || process.env.PREMIERE_TEMP_DIR || DEFAULT_TEMP_DIR;
}

/**
 * Make sure this server version's helpers file exists in the temp dir, and return
 * the bootstrap line each command must carry so the CEP-side engine loads it once.
 */
function ensureHelpers(tempDir: string): string {
  const helpersPath = join(tempDir, helpersFileName());
  if (!existsSync(helpersPath)) {
    writeFileSync(helpersPath, getHelpersSource(), "utf-8");
  }
  return buildBootstrap(helpersPath);
}

/**
 * Send a command (ExtendScript) to the CEP plugin and wait for a response.
 * 
 * Protocol:
 * 1. Write script to <tempDir>/cmd_<id>.jsx
 * 2. CEP plugin picks it up, executes, writes result to <tempDir>/res_<id>.json
 * 3. We poll for the response file and parse it.
 */
export async function sendCommand(
  script: string,
  options?: BridgeOptions
): Promise<CommandResult> {
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensureDir(tempDir);

  const id = `${Date.now()}_${++commandCounter}`;
  const cmdFile = join(tempDir, `cmd_${id}.jsx`);
  const resFile = join(tempDir, `res_${id}.json`);
  const busyFile = join(tempDir, `busy_${id}.json`);

  // Validate script
  validateScript(script);

  // Write command file (bootstrap loads the helpers into the engine if needed)
  writeFileSync(cmdFile, `${ensureHelpers(tempDir)}
${script}`, "utf-8");

  // Poll for response
  const result = await pollForResponse(resFile, busyFile, timeoutMs);

  // Cleanup
  safeUnlink(cmdFile);
  safeUnlink(resFile);
  safeUnlink(busyFile);

  return result;
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
  const tempDir = getTempDir(options);
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  ensureDir(tempDir);

  const id = `${Date.now()}_${++commandCounter}`;
  const cmdFile = join(tempDir, `cmd_${id}.jsx`);
  const resFile = join(tempDir, `res_${id}.json`);
  const busyFile = join(tempDir, `busy_${id}.json`);

  validateScript(script, true);
  writeFileSync(cmdFile, `${ensureHelpers(tempDir)}
${script}`, "utf-8");
  const result = await pollForResponse(resFile, busyFile, timeoutMs);
  safeUnlink(cmdFile);
  safeUnlink(resFile);
  safeUnlink(busyFile);

  return result;
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
    let watcher: FSWatcher | undefined;
    let fallbackDelay = 100;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
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
          const raw = readFileSync(resFile, "utf-8");
          const result = JSON.parse(raw) as CommandResult;
          finish(result);
        } catch (e) {
          finish({
            success: false,
            error: `Failed to parse response: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        return;
      }

      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        const stillBusy = busyIsFresh();
        if (stillBusy && elapsed <= hardCapMs) {
          scheduleFallback();
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

    // Prefer event-driven notification for low response latency without constant stat calls.
    // fs.watch is not reliable on every network/virtual filesystem, so the slower timer above
    // remains the correctness fallback and also protects against missed/coalesced events.
    try {
      const responseName = basename(resFile);
      watcher = watch(dirname(resFile), { persistent: false }, (_event, filename) => {
        if (!filename || filename.toString() === responseName) check();
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
      });
    } catch {
      watcher = undefined;
    }

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
