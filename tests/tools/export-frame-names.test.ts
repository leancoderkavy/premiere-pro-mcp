import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
const TICKS = 254016000000;

/**
 * Minimal ExtendScript File stand-in over an in-memory directory, and a QE
 * exporter that mimics Premiere 25.2: it cuts the output name at the first
 * dot, so "shot-12.5s" is written as "shot-12.png".
 */
function run(requestedPath: string, options: { missingFolder?: boolean } = {}) {
  const files = new Map<string, number>();
  const qeCalls: string[] = [];
  class File {
    fsName: string;
    constructor(path: string) { this.fsName = path; }
    get name() { return encodeURI(this.fsName.substring(this.fsName.lastIndexOf("/") + 1)); }
    get exists() { return files.has(this.fsName); }
    get length() { return files.get(this.fsName) ?? 0; }
    get parent() { return options.missingFolder ? { exists: false, fsName: this.fsName.substring(0, this.fsName.lastIndexOf("/")) } : null; }
    remove() { files.delete(this.fsName); return true; }
    rename(name: string) {
      const target = this.fsName.substring(0, this.fsName.lastIndexOf("/") + 1) + name;
      files.set(target, files.get(this.fsName) ?? 0);
      files.delete(this.fsName);
      this.fsName = target;
      return true;
    }
  }
  const qeSeq = {
    name: "Sweep",
    exportFramePNG(_timecode: string, base: string) {
      qeCalls.push(base);
      const slash = base.lastIndexOf("/");
      const name = base.substring(slash + 1);
      const cut = name.indexOf(".") >= 0 ? name.substring(0, name.indexOf(".")) : name;
      files.set(base.substring(0, slash + 1) + cut + ".png", 1024);
      return true;
    },
  };
  const seq = {
    timebase: String(TICKS / 25),
    videoDisplayFormat: 101,
    getPlayerPosition: () => ({ ticks: "0" }),
  };
  const Time = function (this: { ticks: string; getFormatted: () => string }) {
    this.ticks = "0";
    this.getFormatted = () => "00:00:12:12";
  };
  const context = { app: { enableQE: () => {}, project: { activeSequence: seq } }, qe: { project: { getActiveSequence: () => qeSeq } }, File, Time };
  const result = runInNewContext(`${getHelpersSource()}\n__exportStillFrame(${JSON.stringify(requestedPath)}, "${Math.round(12.5 * TICKS)}")`, context);
  return { result, files: [...files.keys()], qeCalls };
}

describe("export_frame file names", () => {
  it("writes exactly the requested name when it contains dots, via the QE fast path", () => {
    const { result, files } = run("/Users/me/frames/shot-12.5s.png");
    expect(result).toMatchObject({ ok: true, method: "qe", path: "/Users/me/frames/shot-12.5s.png" });
    expect(files).toEqual(["/Users/me/frames/shot-12.5s.png"]);
  });

  it("qualifies animation separately from a file-verified QE capture receipt", async () => {
    vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInNewContext(String(script), {
      __exportStillFrame: () => ({ ok: true, method: "qe", path: "/work/frame.png" }),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
    }))));
    const result = await getExportTools({}).export_frame.handler({ output_path: "/work/frame.png" });
    expect(result).toMatchObject({ success: true, data: { exported: true, method: "qe", renderVerified: false,
      verificationScope: expect.stringContaining("does not establish motion over time") } });
  });
  it("refuses a missing output folder before QE or Media Encoder runs", () => {
    // Live 26.5.2: QE returned false and AME wrote nothing, so the failure came back
    // after dispatch with an unknown outcome and locked further edits.
    const { result, files, qeCalls } = run("/Users/me/missing/shot.png", { missingFolder: true });
    expect(result).toMatchObject({ ok: false, notApplied: true, error: expect.stringContaining("Output folder does not exist: /Users/me/missing") });
    expect(qeCalls).toEqual([]);
    expect(files).toEqual([]);
  });

  it("reports a missing-folder refusal from export_frame as not applied", async () => {
    vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInNewContext(String(script), {
      __exportStillFrame: () => ({ ok: false, notApplied: true, error: "Output folder does not exist: /missing", notes: [] }),
      __error: (error: string, data: unknown) => JSON.stringify({ success: false, error, data }),
    }))));
    const result = await getExportTools({}).export_frame.handler({ output_path: "/missing/frame.png" });
    expect(result).toMatchObject({ success: false, error: "Output folder does not exist: /missing", data: { mutationOutcome: "not_applied", timelineChanged: false } });
  });

  it("still works for plain names", () => {
    const { result, files } = run("/Users/me/frames/plain.png");
    expect(result).toMatchObject({ ok: true, method: "qe" });
    expect(files).toEqual(["/Users/me/frames/plain.png"]);
  });
});

describe("__exportStillFrame keeps an existing destination until a replacement exists", () => {
  const dest = "/tmp/hero.png";

  function fileHost(options: { qeWrites?: boolean; qeThrows?: boolean; destExists?: boolean }) {
    const files = new Map<string, number>();
    if (options.destExists !== false) files.set(dest, 32);
    class File {
      fsName: string;
      constructor(path: string) { this.fsName = path; }
      get name() { return encodeURI(this.fsName.substring(this.fsName.lastIndexOf("/") + 1)); }
      get exists() { return files.has(this.fsName); }
      get length() { return files.get(this.fsName) ?? 0; }
      get parent() { return null; }
      remove() { files.delete(this.fsName); return true; }
      rename(name: string) {
        const target = this.fsName.substring(0, this.fsName.lastIndexOf("/") + 1) + name;
        files.set(target, files.get(this.fsName) ?? 0);
        files.delete(this.fsName);
        this.fsName = target;
        return true;
      }
    }
    const qeSeq = {
      name: "Sweep",
      exportFramePNG(_timecode: string, base: string) {
        if (options.qeWrites) files.set(`${base}.png`, 1024);
        return true;
      },
    };
    const Time = function (this: { ticks: string; getFormatted: () => string }) {
      this.ticks = "0";
      this.getFormatted = () => "00:00:00:00";
    };
    const context = {
      File,
      Time,
      app: {
        enableQE() { if (options.qeThrows) throw new Error("QE unavailable"); },
        encoder: { ENCODE_IN_TO_OUT: 1 },
        project: { activeSequence: { timebase: String(TICKS / 24), getPlayerPosition: () => ({ ticks: "0" }) } },
      },
      qe: { project: { getActiveSequence: () => qeSeq } },
    };
    const result = runInNewContext(`${getHelpersSource()}\n__exportStillFrame(${JSON.stringify(dest)}, "0");`, context);
    return { result, files };
  }

  it("does not delete the original still when QE and AME both fail", () => {
    const { result, files } = fileHost({ qeThrows: true, destExists: true });
    expect(result).toMatchObject({ ok: false });
    expect(files.get(dest)).toBe(32);
  });

  it("replaces the original still only after QE writes a non-empty temp file", () => {
    const { result, files } = fileHost({ qeWrites: true, destExists: true });
    expect(result).toMatchObject({ ok: true, method: "qe", path: dest });
    expect(files.get(dest)).toBe(1024);
    expect([...files.keys()].some((path) => path.includes("mcp-frame-"))).toBe(false);
  });

  it("restores the original still when the replacement cannot be renamed onto it", () => {
    const files = new Map<string, number>([[dest, 32]]);
    class File {
      fsName: string;
      constructor(path: string) { this.fsName = path; }
      get name() { return encodeURI(this.fsName.substring(this.fsName.lastIndexOf("/") + 1)); }
      get exists() { return files.has(this.fsName); }
      get length() { return files.get(this.fsName) ?? 0; }
      get parent() { return null; }
      remove() { files.delete(this.fsName); return true; }
      rename(name: string) {
        const target = this.fsName.substring(0, this.fsName.lastIndexOf("/") + 1) + name;
        if (name === "hero.png" && this.fsName.includes("mcp-frame-")) throw new Error("replacement locked");
        files.set(target, files.get(this.fsName) ?? 0);
        files.delete(this.fsName);
        this.fsName = target;
        return true;
      }
    }
    const qeSeq = { name: "Sweep", exportFramePNG(_timecode: string, base: string) { files.set(`${base}.png`, 1024); return true; } };
    const Time = function (this: { ticks: string; getFormatted: () => string }) { this.ticks = "0"; this.getFormatted = () => "00:00:00:00"; };
    const result = runInNewContext(`${getHelpersSource()}\n__exportStillFrame(${JSON.stringify(dest)}, "0");`, {
      File, Time,
      app: { enableQE() {}, encoder: { ENCODE_IN_TO_OUT: 1 }, project: { activeSequence: { timebase: String(TICKS / 24), getPlayerPosition: () => ({ ticks: "0" }) } } },
      qe: { project: { getActiveSequence: () => qeSeq } },
    });
    expect(result).toMatchObject({ ok: false });
    expect(files.get(dest)).toBe(32);
    expect([...files.keys()].filter((path) => path.includes(".mcp-prev"))).toEqual([]);
  });
});

describe("__exportStillFrame does not steal a sibling still as the capture", () => {
  function listingHost(options: { dest?: string; siblings?: Record<string, number>; qeWrites?: string; ameWrites?: string }) {
    const dest = options.dest ?? "/renders/hero.tiff";
    const files = new Map<string, number>(Object.entries(options.siblings ?? {}));
    class File {
      fsName: string;
      constructor(path: string) { this.fsName = path; }
      get name() { return encodeURI(this.fsName.substring(this.fsName.lastIndexOf("/") + 1)); }
      get exists() { return files.has(this.fsName); }
      get length() { return files.get(this.fsName) ?? 0; }
      get parent() {
        const dir = this.fsName.substring(0, this.fsName.lastIndexOf("/") + 1);
        return {
          exists: true,
          getFiles(filter?: (file: File) => boolean) {
            const listed = [...files.keys()].filter((path) => path.startsWith(dir) && path !== dir).map((path) => new File(path));
            return typeof filter === "function" ? listed.filter(filter) : listed;
          },
        };
      }
      remove() { files.delete(this.fsName); return true; }
      rename(name: string) {
        const target = this.fsName.substring(0, this.fsName.lastIndexOf("/") + 1) + name;
        files.set(target, files.get(this.fsName) ?? 0);
        files.delete(this.fsName);
        this.fsName = target;
        return true;
      }
    }
    const qeSeq = {
      name: "Sweep",
      exportFramePNG(_timecode: string, base: string) {
        if (options.qeWrites) files.set(options.qeWrites.replace("QE_BASE", base), 1024);
        return true;
      },
    };
    const Time = function (this: { ticks: string; getFormatted: () => string }) { this.ticks = "0"; this.getFormatted = () => "00:00:00:00"; };
    let inTicks = 0, outTicks = TICKS;
    const seq = {
      timebase: String(TICKS / 24),
      sequenceID: "seq",
      getPlayerPosition: () => ({ ticks: "0" }),
      getInPointAsTime: () => ({ ticks: String(inTicks) }),
      getOutPointAsTime: () => ({ ticks: String(outTicks) }),
      setInPoint(seconds: number) { inTicks = Math.floor(seconds * 48000) * (TICKS / 48000); },
      setOutPoint(seconds: number) { outTicks = Math.floor(seconds * 48000) * (TICKS / 48000); },
      exportAsMediaDirect(path: string) { if (options.ameWrites) files.set(path.replace(dest, options.ameWrites), 2048); },
    };
    const result = runInNewContext(`${getHelpersSource()}
      __findStillPreset = function () { return options.ameWrites ? "/tmp/still.epr" : ""; };
      __exportStillFrame(${JSON.stringify(dest)}, "0");`, {
      File, Time, Folder: function Folder() { return {}; }, options,
      app: { enableQE() { throw new Error("QE unavailable"); }, encoder: { ENCODE_IN_TO_OUT: 1 }, project: { activeSequence: seq } },
      qe: { project: { getActiveSequence: () => qeSeq } },
    });
    return { dest, result, files };
  }

  it("leaves hero-v2.tiff alone when hero.tiff was never written", () => {
    const sibling = "/renders/hero-v2.tiff";
    const { dest, result, files } = listingHost({ siblings: { [sibling]: 64 } });
    expect(result).toMatchObject({ ok: false });
    expect(files.get(sibling)).toBe(64);
    expect(files.has(dest)).toBe(false);
  });

  it("promotes a newly written AME numbered still onto the requested name", () => {
    const { dest, result, files } = listingHost({ dest: "/renders/hero.png", ameWrites: "/renders/hero1.png" });
    expect(result).toMatchObject({ ok: true, method: "ame", path: dest });
    expect(files.get(dest)).toBe(2048);
    expect(files.has("/renders/hero1.png")).toBe(false);
  });

  it("does not promote a pre-existing numbered sibling as this capture", () => {
    const numbered = "/renders/hero1.png";
    const { dest, result, files } = listingHost({ dest: "/renders/hero.png", siblings: { [numbered]: 64 }, ameWrites: "" });
    expect(result).toMatchObject({ ok: false });
    expect(files.get(numbered)).toBe(64);
    expect(files.has(dest)).toBe(false);
  });
});

describe("export_sequence extension and default preset", () => {
  it("prefers AME's H.264 (MP4) folder over the QuickTime folder for the default preset", () => {
    const presets = [
      { name: "H264 Match Source - High bitrate", path: "/ame/3F3F3F3F_4D6F6F56/H264 Match Source - High bitrate.epr", format: "3F3F3F3F_4D6F6F56" },
      { name: "Match Source - High bitrate", path: "/ame/4E49434B_48323634/Match Source - High bitrate.epr", format: "4E49434B_48323634" },
    ];
    const chosen = runInNewContext(`${getHelpersSource()}\n__collectAllPresets = function () { return presets; };\n__findH264Preset();`, { presets });
    expect(chosen).toBe("/ame/4E49434B_48323634/Match Source - High bitrate.epr");
  });
});

describe("export_sequence default preset never uses an ingest/proxy preset", () => {
  const ppro = "/Applications/Adobe Premiere Pro 2024/Adobe Premiere Pro 2024.app/Contents";

  it("skips IngestPresets/Proxy and picks Premiere's own Match Source preset", () => {
    const presets = [
      { name: "00_1024x540 H.264", path: `${ppro}/Settings/IngestPresets/Proxy/00_1024x540 H.264.epr`, format: "Proxy" },
      { name: "01 - Match Source - High bitrate", path: `${ppro}/MediaIO/systempresets/4E49434B_48323634/01 - Match Source - High bitrate.epr`, format: "4E49434B_48323634" },
    ];
    const chosen = runInNewContext(`${getHelpersSource()}\n__collectAllPresets = function () { return presets; };\n__findH264Preset();`, { presets });
    expect(chosen).toBe(`${ppro}/MediaIO/systempresets/4E49434B_48323634/01 - Match Source - High bitrate.epr`);
  });

  it("skips mixed-case Windows ingest paths", () => {
    const presets = [{ name: "H.264", path: "C:\\Adobe\\settings\\INGESTPRESETS\\proxy\\small.epr", format: "Proxy" }];
    expect(runInNewContext(`${getHelpersSource()}
__collectAllPresets = function () { return presets; };
__findH264Preset();`, { presets })).toBe("");
  });

  it("returns no default when only ingest presets exist, so export_sequence asks for preset_path", () => {
    const presets = [
      { name: "00_1024x540 H.264", path: `${ppro}/Settings/IngestPresets/Proxy/00_1024x540 H.264.epr`, format: "Proxy" },
    ];
    const chosen = runInNewContext(`${getHelpersSource()}\n__collectAllPresets = function () { return presets; };\n__findH264Preset();`, { presets });
    expect(chosen).toBe("");
  });

  it("searches Premiere's MediaIO/systempresets when Media Encoder is not installed", () => {
    const searched = runInNewContext(`${getHelpersSource()}
      var searched = [];
      __adobeAppFolders = function (prefix) { return prefix === "Adobe Media Encoder" ? [] : [{ fsName: "PPRO" }]; };
      __adobeApplicationResourceFolder = function (app, rel) { return { fsName: app.fsName + "/" + rel, exists: true }; };
      __collectEprFiles = function (folder, out) { searched.push(folder.fsName); return out; };
      Folder.myDocuments = { fsName: "/nowhere" };
      __collectAllPresets();
      searched;`, { Folder: function Folder() { return { exists: false }; } });
    expect(searched).toEqual(["PPRO/Settings/IngestPresets", "PPRO/MediaIO/systempresets"]);
  });

  it("does not add Premiere's systempresets when Media Encoder provides them", () => {
    const searched = runInNewContext(`${getHelpersSource()}
      var searched = [];
      __adobeAppFolders = function (prefix) { return [{ fsName: prefix === "Adobe Media Encoder" ? "AME" : "PPRO" }]; };
      __adobeApplicationResourceFolder = function (app, rel) { return { fsName: app.fsName + "/" + rel, exists: true }; };
      __collectEprFiles = function (folder, out) { searched.push(folder.fsName); return out; };
      Folder.myDocuments = { fsName: "/nowhere" };
      __collectAllPresets();
      searched;`, { Folder: function Folder() { return { exists: false }; } });
    expect(searched).toEqual(["AME/MediaIO/systempresets", "PPRO/Settings/IngestPresets"]);
  });
});
