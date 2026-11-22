#!/usr/bin/env node
// Records the MCP tool names shipped by a published premiere-pro-mcp npm tarball.
//
// Plugin launch configurations pin an exact published version, and their bundled
// skills teach tool names. tests/plugin-launch-pin-capabilities.test.ts compares the
// taught tools with this snapshot offline. Regenerate it whenever the pins change:
//
//   node scripts/snapshot-published-tool-catalog.mjs [version]
//
// The version defaults to the README "### Latest release:" heading. The snapshot is
// read from the real registry tarball (package/docs/supported-actions.md), never from
// the source checkout.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE_NAME = "premiere-pro-mcp";
const OUTPUT_PATH = resolve("tests/fixtures/published-tool-catalog.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function readLatestRelease() {
  const readme = readFileSync(resolve("README.md"), "utf8");
  const match = readme.match(/^### Latest release: (\d+\.\d+\.\d+)$/m);
  if (!match) throw new Error("README.md is missing a '### Latest release: X.Y.Z' heading");
  return match[1];
}

function parseCatalogToolNames(markdown) {
  const names = new Set();
  for (const match of markdown.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)) names.add(match[1]);
  return [...names].sort();
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

const version = process.argv[2] ?? readLatestRelease();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version: ${version}`);
const spec = `${PACKAGE_NAME}@${version}`;
const workDir = mkdtempSync(join(tmpdir(), "premiere-pro-mcp-published-"));
try {
  const integrity = run(npm, ["view", spec, "dist.integrity"], workDir);
  const gitHead = run(npm, ["view", spec, "gitHead"], workDir);
  const tarball = run(npm, ["pack", spec, "--silent"], workDir).split(/\r?\n/).pop();
  run("tar", ["-xzf", tarball, "package/docs/supported-actions.md"], workDir);
  const tools = parseCatalogToolNames(
    readFileSync(join(workDir, "package", "docs", "supported-actions.md"), "utf8"),
  );
  if (tools.length === 0) throw new Error(`${spec} tarball catalog lists no tools`);
  const snapshot = {
    package: PACKAGE_NAME,
    version,
    integrity,
    gitHead,
    source: "npm registry tarball: package/docs/supported-actions.md",
    tools,
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${tools.length} tools from ${spec} to ${OUTPUT_PATH}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
