#!/usr/bin/env node

import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      name: `${packageJson.name}-claude-desktop`,
      version: packageJson.version,
      private: true,
      type: packageJson.type,
      dependencies: packageJson.dependencies,
      overrides: packageJson.overrides,
    },
    null,
    2,
  )}\n`,
);

await run("npm", ["ci", "--omit=dev", "--ignore-scripts"], stage);

const mcpbPath = path.join(
  artifacts,
  `premiere-pro-mcp-${packageJson.version}.mcpb`,
);
const dxtPath = path.join(
  artifacts,
  `premiere-pro-mcp-${packageJson.version}.dxt`,
);

await run(
  "npx",
  ["-y", "@anthropic-ai/mcpb@2.1.2", "pack", stage, mcpbPath],
  root,
);
await copyFile(mcpbPath, dxtPath);

console.log(`Built ${path.relative(root, mcpbPath)}`);
console.log(`Built ${path.relative(root, dxtPath)} (legacy extension)`);
