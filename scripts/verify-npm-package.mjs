#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const npmCli = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  join(dirname(dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidate) => candidate && existsSync(candidate));
const requiredFiles = [
  "package/package.json",
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/cep-plugin/CSXS/manifest.xml",
  "package/uxp-plugin/manifest.json",
  "package/docs/supported-actions.md",
  "package/docs/premiere-surface-registry.md",
  "package/docs/adobe-beta-aaf-export-options-drift.md",
  "package/docs/adobe-beta-project-options-drift.md",
  "package/docs/adobe-beta-c2pa-drift.md",
  "package/docs/adobe-beta-media-drift.md",
  "package/docs/adobe-beta-media-manager-drift.md",
  "package/docs/adobe-beta-transcript-drift.md",
  "package/docs/adobe-beta-work-area-drift.md",
  "package/docs/uxp-js-api-inventory.md",
  "package/docs/premiere-doc-inventory.md",
  "package/docs/native-sdk-header-inventory.md",
  "package/docs/uxp-hybrid-addon-receipt.md",
  "package/docs/uxp-hybrid-ccx-receipt.md",
  "package/docs/uxp-hybrid-benchmark.md",
  "package/docs/cep-reference-inventory.md",
  "package/docs/extendscript-api-inventory.md",
  "package/dist/resources/premiere-surface-registry.json",
  "package/dist/resources/adobe-beta-aaf-export-options-drift.json",
  "package/dist/resources/adobe-beta-project-options-drift.json",
  "package/dist/resources/adobe-beta-c2pa-drift.json",
  "package/dist/resources/adobe-beta-media-drift.json",
  "package/dist/resources/adobe-beta-media-manager-drift.json",
  "package/dist/resources/adobe-beta-transcript-drift.json",
  "package/dist/resources/adobe-beta-work-area-drift.json",
  "package/dist/resources/uxp-js-api-inventory.json",
  "package/dist/resources/premiere-doc-inventory.json",
  "package/dist/resources/cep-reference-inventory.json",
  "package/dist/resources/extendscript-api-inventory.json",
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
  if (!npmCli) {
    throw new Error("The bundled npm CLI is unavailable for package verification");
  }
  return run(process.execPath, [npmCli, ...args], options);
}

let tarball;
let installDir;
let packDir;

try {
  packDir = mkdtempSync(join(tmpdir(), "premiere-pro-mcp-pack-output-"));
  const packed = JSON.parse(
    runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir]),
  );
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packEntries = Array.isArray(packed)
    ? packed
    : packed && typeof packed === "object"
      ? Object.values(packed)
      : [];
  const matchingPackages = packEntries.filter(
    (entry) =>
      entry?.name === packageJson.name &&
      entry?.version === packageJson.version &&
      typeof entry?.filename === "string",
  );
  if (matchingPackages.length !== 1) {
    throw new Error("npm pack did not return exactly one package matching package.json");
  }

  tarball = resolve(packDir, matchingPackages[0].filename);
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
  const installedPackageRoot = join(installDir, "node_modules", "premiere-pro-mcp");
  const installedRegistry = JSON.parse(readFileSync(join(
    installedPackageRoot,
    "dist",
    "resources",
    "premiere-surface-registry.json",
  ), "utf8"));
  if (installedRegistry.schemaVersion !== 1 || !Array.isArray(installedRegistry.integrationSurfaces)) {
    throw new Error("installed package did not contain a valid Premiere surface registry");
  }
  for (const surface of installedRegistry.integrationSurfaces) {
    if (surface.inventoryArtifact !== null &&
      (typeof surface.inventoryArtifact !== "string" || !existsSync(join(installedPackageRoot, surface.inventoryArtifact)))) {
      throw new Error(`installed package registry references a missing inventory artifact: ${surface.id}`);
    }
  }
  const help = run(process.execPath, [installedCli, "--help"], { cwd: installDir });
  if (!help.includes("Usage:")) {
    throw new Error("installed CLI --help did not return the expected usage text");
  }

  console.log(
    `Verified npm package contents and isolated CLI install: ${matchingPackages[0].filename}`,
  );
} finally {
  if (installDir) rmSync(installDir, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
  if (packDir) rmSync(packDir, { recursive: true, force: true });
}
