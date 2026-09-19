import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_FILE_TYPE_DIRECTORY = 0o040000;
const UNIX_FILE_TYPE_REGULAR = 0o100000;
const ZIP_HOST_UNIX = 3;
const PLUGIN_ID = "com.ppmcp.premiere.uxp";

function readZipEntries(archive: Buffer) {
  const endOffset = archive.length - 22;
  expect(archive.readUInt32LE(endOffset)).toBe(0x06054b50);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, versionMadeBy, externalAttributes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe("direct UXP CCX packaging", () => {
  it("wraps plugin files in one bundle root with readable Unix permission bits", () => {
    const built = spawnSync(process.execPath, ["scripts/build-uxp-ccx.mjs"], {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
    expect(built.status, built.stderr || built.stdout).toBe(0);

    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const archive = readFileSync(path.join("artifacts", `premiere-pro-mcp-uxp-${packageJson.version}-direct.ccx`));
    const entries = readZipEntries(archive);
    const bundleRoot = `${PLUGIN_ID}/`;
    const directory = entries.find((entry) => entry.name === bundleRoot);
    const files = entries.filter((entry) => !entry.name.endsWith("/"));

    expect(directory).toBeDefined();
    expect(entries.every((entry) => entry.name === bundleRoot || entry.name.startsWith(bundleRoot))).toBe(true);
    expect(files.some((entry) => entry.name === `${PLUGIN_ID}/manifest.json`)).toBe(true);
    expect((directory!.externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK).toBe(UNIX_FILE_TYPE_DIRECTORY);
    expect((directory!.externalAttributes >>> 16) & 0o777).toBe(0o755);

    for (const entry of files) {
      expect(entry.versionMadeBy >>> 8).toBe(ZIP_HOST_UNIX);
      expect((entry.externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK).toBe(UNIX_FILE_TYPE_REGULAR);
      expect((entry.externalAttributes >>> 16) & 0o777).toBe(0o644);
    }
  });
});
