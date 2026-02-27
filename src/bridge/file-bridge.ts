import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_TEMP_DIR = join(tmpdir(), "premiere-mcp-bridge");
const POLL_INTERVAL_MS = 100;
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

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function getTempDir(options?: BridgeOptions): string {
  return options?.tempDir || process.env.PREMIERE_TEMP_DIR || DEFAULT_TEMP_DIR;
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

  // Validate script
  validateScript(script);

  // Write command file
  writeFileSync(cmdFile, script, "utf-8");

  // Poll for response
  const result = await pollForResponse(resFile, timeoutMs);

  // Cleanup
  safeUnlink(cmdFile);
  safeUnlink(resFile);

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

  validateScript(script, true);
  writeFileSync(cmdFile, script, "utf-8");
  const result = await pollForResponse(resFile, timeoutMs);
  safeUnlink(cmdFile);
  safeUnlink(resFile);

  return result;
}

async function pollForResponse(
  resFile: string,
  timeoutMs: number
): Promise<CommandResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (existsSync(resFile)) {
        try {
          const raw = readFileSync(resFile, "utf-8");
          const result = JSON.parse(raw) as CommandResult;
          resolve(result);
        } catch (e) {
          resolve({
            success: false,
            error: `Failed to parse response: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        return;
      }

      if (Date.now() - start > timeoutMs) {
        resolve({
          success: false,
          error: `Command timed out after ${timeoutMs}ms. Is the CEP plugin running in Premiere Pro?`,
        });
        return;
      }

      setTimeout(check, POLL_INTERVAL_MS);
    };

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
      if (file.startsWith("cmd_") || file.startsWith("res_")) {
        safeUnlink(join(tempDir, file));
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
