import { afterEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bakePremiereTitle, pruneTitleCache, writeZip } from "../../src/tools/mogrt-bake.js";

const folders: string[] = [];
function directory() { const dir = mkdtempSync(join(tmpdir(), "title-cache-")); folders.push(dir); return dir; }
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true }); });
function titleName(index: number) { return `Basic-Title-${index.toString(16).padStart(16, "0")}.mogrt`; }
function seed(dir: string, count: number) {
  for (let i = 0; i < count; i++) {
    const path = join(dir, titleName(i));
    writeFileSync(path, `title ${i}`);
    utimesSync(path, 1000 + i, 1000 + i);
  }
}

function template(dir: string): string {
  const body = Buffer.from(JSON.stringify({ mTextParam: { mStyleSheet: { mText: "Default" } } }), "utf16le");
  const header = Buffer.alloc(8); header.writeUInt32LE(body.length, 0);
  const xml = `<PremiereData><Param><StartKeyframeValue Encoding="base64">${Buffer.concat([header, body]).toString("base64")}</StartKeyframeValue></Param></PremiereData>`;
  const path = join(dir, "Basic Title.mogrt");
  writeFileSync(path, writeZip([
    { name: "definition.json", data: Buffer.from(JSON.stringify({ capsuleID: "fixture", clientControls: [{ type: 6, value: { strDB: [{ localeString: "en_US", str: "Default" }] } }] })) },
    { name: "project.prgraphic", data: writeZip([{ name: "Delivery.prproj", data: gzipSync(Buffer.from(xml)) }]) },
  ]));
  return path;
}

describe("bounded baked-title cache", () => {
  it("retains the newest 50 regular title files by modification time", () => {
    const dir = directory(); seed(dir, 60);
    pruneTitleCache(dir);
    expect(readdirSync(dir).sort()).toEqual(Array.from({ length: 50 }, (_, i) => titleName(i + 10)).sort());
  });
  it("does not prune a cache with fewer than 50 copies", () => {
    const dir = directory(); seed(dir, 4);
    pruneTitleCache(dir);
    expect(readdirSync(dir)).toHaveLength(4);
  });
  it("preserves unrelated names, staging files, uppercase hashes, and subdirectories", () => {
    const dir = directory(); seed(dir, 52);
    const unrelated = ["Basic Title.mogrt", "custom.mogrt", "title-1234.mogrt", "title-0123456789ABCDEF.mogrt", "title-0123456789abcdef.mogrt.123.tmp", "extension-0123456789abcdef.MOGRT", "space name-0123456789abcdef.mogrt"];
    for (const name of unrelated) writeFileSync(join(dir, name), "keep");
    const nested = join(dir, "folder-0123456789abcdef.mogrt"); mkdirSync(nested); writeFileSync(join(nested, "child.mogrt"), "keep");
    pruneTitleCache(dir);
    for (const name of unrelated) expect(existsSync(join(dir, name))).toBe(true);
    expect(existsSync(join(nested, "child.mogrt"))).toBe(true);
    expect(readdirSync(dir)).toHaveLength(50 + unrelated.length + 1);
  });
  it("does not follow or delete matching symlinks", () => {
    const dir = directory(); seed(dir, 52);
    const external = directory(), target = join(external, "template.mogrt"); writeFileSync(target, "keep");
    const link = join(dir, "link-0123456789abcdef.mogrt"); symlinkSync(target, link);
    pruneTitleCache(dir);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(dir)).toHaveLength(51);
  });
  it("does not follow a cache-directory symlink", () => {
    const dir = directory(), external = directory(); seed(external, 52);
    const link = join(dir, "cache"); symlinkSync(external, link);
    pruneTitleCache(link);
    expect(readdirSync(external)).toHaveLength(52);
  });
  it("tolerates a missing cache", () => {
    expect(() => pruneTitleCache(join(directory(), "missing"))).not.toThrow();
  });
  it("prunes after baking a new verified title", () => {
    const source = template(directory()), cache = directory(); seed(cache, 51);
    const result = bakePremiereTitle(source, ["New title"], cache);
    expect(result.checks.every((check) => check.actual === check.expected)).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readdirSync(cache)).toHaveLength(50);
  });
  it("refreshes an old reused copy before pruning so its import path remains available", () => {
    const source = template(directory()), cache = directory();
    const first = bakePremiereTitle(source, ["Reused title"], cache);
    utimesSync(first.path, 1, 1); seed(cache, 51);
    const reused = bakePremiereTitle(source, ["Reused title"], cache);
    expect(reused.reused).toBe(true);
    expect(existsSync(reused.path)).toBe(true);
    expect(lstatSync(reused.path).mtimeMs).toBeGreaterThan(1000 * 1050);
    expect(readdirSync(cache)).toHaveLength(50);
  });

});
