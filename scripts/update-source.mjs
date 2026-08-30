#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = new Set(process.argv.slice(2));
const allowed = new Set(["--check"]);
const unknown = [...requested].filter((argument) => !allowed.has(argument));

if (unknown.length > 0) {
  console.error(`Unknown update option: ${unknown.join(", ")}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...options,
  }).trim();
}

function runInherited(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function npmInvocation() {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && existsSync(fromNpm)) return [process.execPath, [fromNpm]];

  const candidates = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  return npmCli ? [process.execPath, [npmCli]] : [process.platform === "win32" ? "npm.cmd" : "npm", []];
}

function runNpm(args) {
  const [command, prefix] = npmInvocation();
  runInherited(command, [...prefix, ...args]);
}

function fail(message) {
  console.error(`Source update stopped: ${message}`);
  process.exit(1);
}

let repositoryRoot;
try {
  repositoryRoot = run("git", ["rev-parse", "--show-toplevel"]);
} catch {
  fail("this command must run from a Git clone of premiere-pro-mcp.");
}

if (resolve(repositoryRoot) !== root) {
  fail("run this command from the premiere-pro-mcp repository root.");
}

const workingTreeDirty = Boolean(run("git", ["status", "--porcelain"]));

try {
  runInherited("git", ["fetch", "origin", "--tags"]);
  const counts = run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
    .split(/\s+/)
    .map(Number);
  const [ahead, behind] = counts;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    fail("could not compare this checkout with its configured upstream.");
  }

  if (requested.has("--check")) {
    const status = behind > 0
      ? `Source update available: ${behind} commit${behind === 1 ? "" : "s"} behind upstream.${ahead > 0 ? ` This checkout also has ${ahead} local commit${ahead === 1 ? "" : "s"}.` : ""}`
      : "Source checkout is up to date with its upstream.";
    console.log(`${status}${workingTreeDirty ? " Local changes were detected, so automatic source update will refuse to run." : ""}`);
    process.exit(0);
  }

  if (workingTreeDirty) {
    fail("your checkout has uncommitted or untracked files. Commit, stash, or move them before updating.");
  }

  if (behind === 0) {
    console.log("Source checkout is already up to date. To repair the connector, run npm run install-cep after fully quitting Premiere.");
    process.exit(0);
  }

  if (ahead > 0) {
    fail("this checkout has local commits. Update or merge it manually so no work is overwritten.");
  }

  console.log("Updating source, dependencies, build output, and the Premiere connector...");
  runInherited("git", ["merge", "--ff-only", "@{upstream}"]);
  runNpm(["ci"]);
  runNpm(["run", "build"]);
  runInherited(process.execPath, ["dist/index.js", "--install-cep"]);
  console.log("Update complete. Restart Premiere and your MCP client, then run verify_premiere_connection before editing.");
} catch (error) {
  const message = error instanceof Error && error.message ? error.message : "an update command failed.";
  fail(message);
}
