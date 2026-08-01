#!/usr/bin/env node

import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateClaudeSource, validateClaudeStage } from "./validate-distribution.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "build", "claude-desktop");
const artifacts = path.join(root, "artifacts");
const manifestSource = path.join(root, "claude-desktop", "manifest.json");
const packageSource = path.join(root, "package.json");
const lockSource = path.join(root, "package-lock.json");

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });

function runNpm(args, cwd) {
  // On Windows, spawn("npm", ...) can fail because npm is exposed as npm.cmd
  // rather than an executable. Running npm's bundled CLI through this Node
  // process works on every supported platform and keeps shell execution off.
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return existsSync(npmCli)
    ? run(process.execPath, [npmCli, ...args], cwd)
    : run("npm", args, cwd);
}

function runMcpb(args) {
  return runNpm(
    ["exec", "--yes", "@anthropic-ai/mcpb@2.1.2", "--", ...args],
    root,
  );
}

await validateClaudeSource();
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, "server"), { recursive: true });
await mkdir(artifacts, { recursive: true });

await copyFile(manifestSource, path.join(stage, "manifest.json"));
await cp(path.join(root, "dist"), path.join(stage, "server", "dist"), {
  recursive: true,
});
await copyFile(lockSource, path.join(stage, "package-lock.json"));

const packageJson = JSON.parse(await readFile(packageSource, "utf8"));
await writeFile(
  path.join(stage, "package.json"),
  `${JSON.stringify(
    {
      // Keep this aligned with package-lock.json and manifest.json so npm ci and
      // MCPB validation both describe the same bundled server identity.
      name: packageJson.name,
      version: packageJson.version,
      private: true,
      type: packageJson.type,
      engines: packageJson.engines,
      dependencies: packageJson.dependencies,
      overrides: packageJson.overrides,
    },
    null,
    2,
  )}\n`,
);

await runNpm(["ci", "--omit=dev", "--ignore-scripts"], stage);
await validateClaudeStage(stage);
await runMcpb(["validate", path.join(stage, "manifest.json")]);

const mcpbPath = path.join(
  artifacts,
  `premiere-pro-mcp-${packageJson.version}.mcpb`,
);
await runMcpb(["pack", stage, mcpbPath]);
await runMcpb(["info", mcpbPath]);

console.log(`Built ${path.relative(root, mcpbPath)}`);
