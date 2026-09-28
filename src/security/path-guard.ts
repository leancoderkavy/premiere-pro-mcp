import { lstatSync, readlinkSync } from "node:fs";
import { posix, win32 } from "node:path";

/**
 * Server-side symlink confinement for UXP path arguments (issue #640).
 *
 * The UXP panel checks lexical containment inside the approved workspace, but
 * Premiere 26.5 UXP cannot see through links: `Entry.nativePath` reports the
 * link's own path and `lstat` is unimplemented. The MCP server runs on the same
 * machine as Premiere, so it walks every absolute path argument with Node's
 * real filesystem before a command is sent and refuses any symlinked or
 * junctioned segment. Segments that do not exist yet (new output files) end
 * the walk; they cannot redirect anything.
 */

const MAX_DEPTH = 8;
const MAX_STRINGS = 512;

/** macOS calibration links that always point into /private. */
const SYSTEM_LINK_TARGETS: Readonly<Record<string, readonly string[]>> = {
  "/tmp": ["private/tmp", "/private/tmp"],
  "/var": ["private/var", "/private/var"],
  "/etc": ["private/etc", "/private/etc"],
};

export class SymlinkPathError extends Error {
  readonly code = "UXP_PATH_SYMLINK_REFUSED";
  constructor(readonly argumentPath: string) {
    super(`${argumentPath} goes through a symbolic link or junction. Use the real folder inside the approved workspace. No command was sent to Premiere.`);
    this.name = "SymlinkPathError";
  }
}

type PathFlavor = typeof posix | typeof win32;

function absoluteFlavor(value: string): PathFlavor | null {
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value)) return win32;
  if (value.startsWith("/") && !value.startsWith("//")) return posix;
  return null;
}

function isSystemLink(segment: string): boolean {
  const targets = SYSTEM_LINK_TARGETS[segment];
  if (!targets || process.platform !== "darwin") return false;
  try { return targets.includes(readlinkSync(segment)); } catch { return false; }
}

/** Returns the first symlinked segment of an absolute path, or null. */
export function findSymlinkedSegment(value: string): string | null {
  const flavor = absoluteFlavor(value);
  if (!flavor || value.includes("\0")) return null;
  const normalized = flavor.normalize(value);
  const root = flavor.parse(normalized).root;
  const parts = normalized.slice(root.length).split(flavor.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = flavor.join(current, part);
    let stats;
    try { stats = lstatSync(current); } catch { return null; }
    if (stats.isSymbolicLink() && !isSystemLink(current)) return current;
    if (!stats.isDirectory()) return null;
  }
  return null;
}

function collectStrings(value: unknown, path: string, out: Array<[string, string]>, depth: number): void {
  if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    if (absoluteFlavor(value)) out.push([path, value]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, out, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectStrings(entry, path ? `${path}.${key}` : key, out, depth + 1);
    }
  }
}

/** Throws SymlinkPathError when any absolute path argument crosses a link. */
export function assertNoSymlinkedPaths(args: unknown): void {
  const candidates: Array<[string, string]> = [];
  collectStrings(args, "", candidates, 0);
  for (const [argumentPath, value] of candidates) {
    if (findSymlinkedSegment(value)) throw new SymlinkPathError(argumentPath || "path");
  }
}
