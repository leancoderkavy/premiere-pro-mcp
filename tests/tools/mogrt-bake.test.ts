import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  bakePremiereTitle,
  defaultTitleDir,
  readPremiereTitleText,
  readTemplateKind,
  readZipEntries,
  readZipEntry,
  templateKind,
  writeZip,
} from "../../src/tools/mogrt-bake.js";

const workspace = mkdtempSync(join(tmpdir(), "mogrt-bake-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const loc = (en: string) => ({ strDB: [{ localeString: "en_US", str: en }, { localeString: "fr_FR", str: `fr-${en}` }] });

function sourceTextBlob(text: string): string {
  const json = { mTextParam: { mAlignment: 2, mStyleSheet: { mFontName: { mParamValues: [[0, "MyriadPro-Regular"]] }, mText: text }, mTabWidth: 400 }, mVersion: 1 };
  const body = Buffer.from(JSON.stringify(json), "utf16le");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]).toString("base64");
}

/** A Premiere-built template: layer order in the project differs from control order in definition.json. */
function premiereTemplate(path: string, controlDefaults: string[], layerTexts: string[]): string {
  const layers = layerTexts
    .map((text, i) => `<Param ObjectID="${i}"><StartKeyframeValue Encoding="base64" BinaryHash="h${i}">${sourceTextBlob(text)}</StartKeyframeValue></Param>`)
    .join("\n");
  const unrelated = `<Param><StartKeyframeValue Encoding="base64">${Buffer.from("not text").toString("base64")}</StartKeyframeValue></Param>`;
  const xml = `<?xml version="1.0"?><PremiereData>${unrelated}${layers}</PremiereData>`;
  const prgraphic = writeZip([{ name: "Delivery.prproj", data: gzipSync(Buffer.from(xml)) }]);
  const definition = {
    capsuleID: "original-capsule",
    clientControls: [
      { type: 8, uiName: loc("LayerName"), value: loc("Clip") },
      ...controlDefaults.map((text) => ({ type: 6, uiName: loc("TextLayer"), value: loc(text) })),
    ],
  };
  writeFileSync(path, writeZip([
    { name: "definition.json", data: Buffer.from("\uFEFF" + JSON.stringify(definition)) },
    { name: "project.prgraphic", data: prgraphic },
    { name: "project_ja_JP.prgraphic", data: prgraphic },
    { name: "thumb.png", data: Buffer.alloc(32, 7) },
  ]));
  return path;
}

describe("zip helpers", () => {
  it("round-trips entries through writeZip and readZipEntries", () => {
    const zip = writeZip([{ name: "a.txt", data: Buffer.from("alpha") }, { name: "ü/b.bin", data: Buffer.alloc(1000, 3) }]);
    expect(readZipEntries(zip).map((e) => [e.name, e.data.length])).toEqual([["a.txt", 5], ["ü/b.bin", 1000]]);
    expect(readZipEntry(zip, "a.txt")?.toString()).toBe("alpha");
    expect(readZipEntry(zip, "nope")).toBeNull();
  });

  it("detects template kinds from entry names", () => {
    expect(templateKind(["definition.json", "project.prgraphic"])).toBe("premiere");
    expect(templateKind(["definition.json", "project.aegraphic"])).toBe("after_effects");
    expect(templateKind(["definition.json"])).toBe("unknown");
  });

  it("chooses a per-platform title folder and honors PREMIERE_MCP_TITLE_DIR", () => {
    expect(defaultTitleDir({ PREMIERE_MCP_TITLE_DIR: "/x/titles" }, "darwin")).toBe("/x/titles");
    expect(defaultTitleDir({}, "darwin")).toMatch(/Library[\\/]Application Support[\\/]premiere-pro-mcp[\\/]titles$/);
    expect(defaultTitleDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32")).toMatch(/premiere-pro-mcp[\\/]titles$/);
  });
});

describe("bakePremiereTitle", () => {
  const lowerThird = premiereTemplate(join(workspace, "Lower Third.mogrt"), ["Second Line is Smaller", "Your Name Here"], ["Your Name Here", "Second Line is Smaller"]);
  const outDir = join(workspace, "titles");

  it("writes each line into the layer whose default text matches its field, and reads it back", () => {
    const result = bakePremiereTitle(lowerThird, ["Director", 'Ada "Countess" Lovelace'], outDir, () => "new-capsule");
    expect(result.reused).toBe(false);
    expect(result.checks.every((c) => c.actual === c.expected)).toBe(true);
    // Field 0 ("Second Line is Smaller") lives in layer 1; field 1 in layer 0.
    expect(readPremiereTitleText(result.path)).toEqual(['Ada "Countess" Lovelace', "Director"]);
    expect(readTemplateKind(result.path)).toBe("premiere");
  });

  it("updates definition.json in every locale, assigns a new capsuleID, drops localized projects, and keeps other entries", () => {
    const { path } = bakePremiereTitle(lowerThird, ["Role", "Name"], outDir, () => "capsule-2");
    const zip = readFileSync(path);
    const names = readZipEntries(zip).map((e) => e.name);
    expect(names).toEqual(["definition.json", "project.prgraphic", "thumb.png"]);
    const definition = JSON.parse(readZipEntry(zip, "definition.json")!.toString("utf8").replace(/^\uFEFF/, ""));
    expect(definition.capsuleID).toBe("capsule-2");
    const texts = definition.clientControls.filter((c: { type: number }) => c.type === 6).map((c: { value: { strDB: Array<{ str: string }> } }) => c.value.strDB.map((e) => e.str));
    expect(texts).toEqual([["Role", "Role"], ["Name", "Name"]]);
    // Styling in the blob survives.
    const prproj = readZipEntries(readZipEntry(zip, "project.prgraphic")!)[0];
    expect(gunzipSync(prproj.data).toString()).toContain('Encoding="base64" BinaryHash="h0"');
  });

  it("reuses the same file for the same template and text", () => {
    const first = bakePremiereTitle(lowerThird, ["Same", "Text"], outDir);
    const second = bakePremiereTitle(lowerThird, ["Same", "Text"], outDir);
    expect(second).toMatchObject({ path: first.path, reused: true });
  });

  it("does not reuse a file whose lines sit in the wrong fields", () => {
    const right = bakePremiereTitle(lowerThird, ["Alpha", "Beta"], outDir);
    const swapped = bakePremiereTitle(lowerThird, ["Beta", "Alpha"], join(workspace, "titles-swapped"));
    // Both lines appear in the file, but each in the other field's layer.
    writeFileSync(right.path, readFileSync(swapped.path));
    const again = bakePremiereTitle(lowerThird, ["Alpha", "Beta"], outDir);
    expect(again.reused).toBe(false);
    expect(again.checks.every((c) => c.actual === c.expected)).toBe(true);
    expect(readPremiereTitleText(again.path)).toEqual(["Beta", "Alpha"]);
  });

  it("refuses a linked cache directory instead of writing outside its private cache", () => {
    const outside = join(workspace, "outside-cache"), link = join(workspace, "linked-cache");
    mkdirSync(outside);
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => bakePremiereTitle(lowerThird, ["Role", "Name"], link)).toThrow(/symbolic link|junction/);
  });

  it("fills a partial set of lines and leaves the other layer's default text", () => {
    const { path } = bakePremiereTitle(lowerThird, ["Only role"], outDir);
    expect(readPremiereTitleText(path)).toEqual(["Your Name Here", "Only role"]);
  });

  it("rejects too many lines and non-Premiere templates", () => {
    expect(() => bakePremiereTitle(lowerThird, ["a", "b", "c"], outDir)).toThrow(/2 text field\(s\) but 3 line/);
    const ae = join(workspace, "ae.mogrt");
    writeFileSync(ae, writeZip([{ name: "definition.json", data: Buffer.from("{}") }, { name: "project.aegraphic", data: Buffer.from("x") }]));
    expect(() => bakePremiereTitle(ae, ["a"], outDir)).toThrow(/Not a Premiere-built template/);
  });

  const stockBasicTitle = "/Applications/Adobe Premiere Pro 2025/Adobe Premiere Pro 2025.app/Contents/Essential Graphics/Basic Title.mogrt";
  it.skipIf(!existsSync(stockBasicTitle))("bakes the real stock Basic Title when Premiere is installed", () => {
    expect(readPremiereTitleText(stockBasicTitle)).toEqual(["Your Title Here"]);
    const { path, checks } = bakePremiereTitle(stockBasicTitle, ["Real Stock Title"], outDir);
    expect(checks).toEqual([{ index: 0, expected: "Real Stock Title", actual: "Real Stock Title" }]);
    expect(readPremiereTitleText(path)).toEqual(["Real Stock Title"]);
  });
});

describe("readZipEntries size limits", () => {
  const archive = writeZip([
    { name: "a.bin", data: Buffer.alloc(3000, 0x41) },
    { name: "b.bin", data: Buffer.alloc(3000, 0x42) },
  ]);

  it("reads entries within the total cap", () => {
    expect(readZipEntries(archive, 4096, 8192).map((entry) => entry.data.length)).toEqual([3000, 3000]);
  });

  it("refuses entries whose total exceeds the cap, even when each is under the per-entry cap", () => {
    expect(() => readZipEntries(archive, 4096, 5000)).toThrow(/over the 5000-byte limit/);
  });
});
