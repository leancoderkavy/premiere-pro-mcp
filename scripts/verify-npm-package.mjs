#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const npmCli = join(
  dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const requiredFiles = [
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/cep-plugin/CSXS/manifest.xml",
  "package/uxp-plugin/manifest.json",
  "package/docs/supported-actions.md",
  "package/scripts/install-cep.ps1",
  "package/scripts/install-cep.sh",
];

function tarEntries(tarball) {
  const archive = gunzipSync(readFileSync(tarball));
  const entries = new Set();
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!name || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid tar entry at byte ${offset} in ${tarball}`);
    }

    entries.add(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

function runNpm(args, options = {}) {
  if (!existsSync(npmCli)) {
    throw new Error("The bundled npm CLI is unavailable for package verification");
  }
  return run(process.execPath, [npmCli, ...args], options);
}

let tarball;
let installDir;

try {
  const packed = JSON.parse(runNpm(["pack", "--json", "--ignore-scripts"]));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
    throw new Error("npm pack did not return exactly one package filename");
  }

  tarball = resolve(root, packed[0].filename);
  const entries = tarEntries(tarball);
  const missing = requiredFiles.filter((path) => !entries.has(path));
  if (missing.length > 0) {
    throw new Error(`npm package is missing required files: ${missing.join(", ")}`);
  }

  installDir = mkdtempSync(join(tmpdir(), "premiere-pro-mcp-pack-"));
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    cwd: installDir,
  });

  const installedCli = join(installDir, "node_modules", "premiere-pro-mcp", "dist", "index.js");
  if (!existsSync(installedCli)) {
    throw new Error("isolated package installation did not contain the CLI entrypoint");
  }
  const help = run(process.execPath, [installedCli, "--help"], { cwd: installDir });
  if (!help.includes("Usage:")) {
    throw new Error("installed CLI --help did not return the expected usage text");
  }

  console.log(`Verified npm package contents and isolated CLI install: ${packed[0].filename}`);
} finally {
  if (installDir) rmSync(installDir, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}
