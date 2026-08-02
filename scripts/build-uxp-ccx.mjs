#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateUxpManifest,
  validateUxpSource,
} from "./validate-distribution.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const documentationFiles = new Set(["README.md", "DISTRIBUTION.md"]);

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(`UXP CCX build failed: ${message}`);
}

function u16(value) {
  assert(value >= 0 && value <= 0xffff, "ZIP field exceeds 16-bit limit");
  return value;
}

function u32(value) {
  assert(value >= 0 && value <= 0xffffffff, "ZIP field exceeds 32-bit limit");
  return value;
}

async function collectFiles(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const source = path.join(directory, entry.name);
    const target = relative ? `${relative}/${entry.name}` : entry.name;
    const stat = await lstat(source);
    assert(!stat.isSymbolicLink(), `refusing to package symbolic link ${target}`);
    if (stat.isDirectory()) {
      files.push(...(await collectFiles(source, target)));
      continue;
    }
    assert(stat.isFile(), `refusing to package non-file entry ${target}`);
    if (documentationFiles.has(entry.name)) continue;
    files.push({ name: target, data: await readFile(source) });
  }
  return files;
}

function buildStoredZip(files) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(u32(checksum), 14);
    local.writeUInt32LE(u32(file.data.length), 18);
    local.writeUInt32LE(u32(file.data.length), 22);
    local.writeUInt16LE(u16(name.length), 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(u32(checksum), 16);
    central.writeUInt32LE(u32(file.data.length), 20);
    central.writeUInt32LE(u32(file.data.length), 24);
    central.writeUInt16LE(u16(name.length), 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(u32(offset), 42);

    localRecords.push(local, name, file.data);
    centralRecords.push(central, name);
    offset += local.length + name.length + file.data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(u16(files.length), 8);
  end.writeUInt16LE(u16(files.length), 10);
  end.writeUInt32LE(u32(centralDirectory.length), 12);
  end.writeUInt32LE(u32(offset), 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function verifyStoredZip(archive, expectedNames) {
  const endOffset = archive.length - 22;
  assert(endOffset >= 0 && archive.readUInt32LE(endOffset) === 0x06054b50, "archive is missing a ZIP end record");
  assert(archive.readUInt16LE(endOffset + 20) === 0, "archive must not contain a ZIP comment");
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  let cursor = archive.readUInt32LE(endOffset + 16);
  assert(cursor + centralSize === endOffset, "archive central directory has an unexpected length");
  assert(entryCount === expectedNames.length, "archive entry count does not match the staged plugin files");
  const names = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert(archive.readUInt32LE(cursor) === 0x02014b50, "archive central directory entry is invalid");
    assert(archive.readUInt16LE(cursor + 10) === 0, "archive must use stored ZIP entries");
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert(!names.includes(name), `archive contains duplicate entry ${name}`);
    names.push(name);
    assert(archive.readUInt32LE(localOffset) === 0x04034b50, `archive local entry is invalid for ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localName = archive
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString("utf8");
    assert(localName === name, `archive local entry name does not match ${name}`);
    assert(compressedSize === uncompressedSize, `archive unexpectedly compresses ${name}`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + uncompressedSize);
    assert(data.length === uncompressedSize, `archive data is truncated for ${name}`);
    assert(crc32(data) === checksum, `archive checksum is invalid for ${name}`);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  assert(
    JSON.stringify(names.sort()) === JSON.stringify([...expectedNames].sort()),
    "archive contents do not match the staged plugin files",
  );
}

function channelConfiguration(sourceManifest) {
  const channel = process.env.UXP_DISTRIBUTION_CHANNEL ?? "direct";
  assert(["direct", "marketplace"].includes(channel), "UXP_DISTRIBUTION_CHANNEL must be direct or marketplace");
  if (channel === "direct") {
    return { channel, pluginId: sourceManifest.id };
  }

  const pluginId = process.env.UXP_MARKETPLACE_PLUGIN_ID?.trim();
  assert(
    pluginId,
    "marketplace builds require UXP_MARKETPLACE_PLUGIN_ID from Adobe Developer Distribution",
  );
  assert(pluginId !== sourceManifest.id, "Marketplace builds must use a distinct Adobe-assigned plugin id");
  return { channel, pluginId };
}

async function main() {
  const { manifest: sourceManifest, packageJson, pluginRoot } = await validateUxpSource();
  const { channel, pluginId } = channelConfiguration(sourceManifest);
  const manifest = { ...sourceManifest, id: pluginId };
  validateUxpManifest(manifest, packageJson, { expectedId: pluginId });

  const files = await collectFiles(pluginRoot);
  const manifestIndex = files.findIndex((file) => file.name === "manifest.json");
  assert(manifestIndex >= 0, "UXP package is missing manifest.json");
  files[manifestIndex] = {
    name: "manifest.json",
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  };
  files.sort((left, right) => left.name.localeCompare(right.name));

  const archive = buildStoredZip(files);
  verifyStoredZip(
    archive,
    files.map((file) => file.name),
  );
  await mkdir(artifacts, { recursive: true });
  const output = path.join(
    artifacts,
    `premiere-pro-mcp-uxp-${packageJson.version}-${channel}.ccx`,
  );
  await writeFile(output, archive);
  console.log(`Built ${path.relative(root, output)}`);
  console.log(`SHA-256 ${createHash("sha256").update(archive).digest("hex")}`);
  console.log(`Channel ${channel}; package structure validated, not live Premiere installation validation.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
