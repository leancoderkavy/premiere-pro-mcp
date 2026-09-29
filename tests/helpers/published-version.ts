import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The README "Latest release" heading is this repository's single anchor for
 * the published npm version. Client pins (README commands, plugin .mcp.json
 * files, and skills) must match it. Published-package counts and provenance
 * for the website live in leancoderkavy/premiere-pro-mcp-site, which syncs them
 * from the npm tarball.
 */
export function readPublishedVersion(root = process.cwd()): string {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const match = readme.match(/^### Latest release: (\d+\.\d+\.\d+)$/m);
  if (!match) throw new Error("README.md is missing a '### Latest release: X.Y.Z' heading");
  return match[1];
}

export function compareSemver(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}
