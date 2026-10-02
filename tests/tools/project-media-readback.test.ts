import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { basename, resolve } from "node:path";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

const hostFiles = vi.hoisted(() => new Set<string>());
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  existsSync: (path: string) => hostFiles.has(path),
  statSync: () => ({ isFile: () => true }),
}));

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getProjectTools } from "../../src/tools/project.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridge = { tempDir: "/tmp/project-media", timeoutMs: 5000 } as BridgeOptions;
const media = getMediaTools(bridge);
const metadata = getMetadataTools(bridge);
const project = getProjectTools(bridge);
type Result = { success: boolean; error?: string; data?: Record<string, any> };
type Tool = { handler: (args: never) => Promise<unknown> };
const run = (tool: Tool, args: Record<string, unknown>) => tool.handler(args as never) as Promise<Result>;

beforeEach(() => vi.clearAllMocks());

type Item = Record<string, any>;
const filePath = (path: string) => resolve(path);

/** A project as measured on Premiere 25.2.3. Options make individual writes no-ops. */
function host(options: { existingFiles?: string[]; ignore?: string[]; resetParOnInterp?: boolean } = {}) {
  hostFiles.clear();
  for (const path of options.existingFiles ?? []) hostFiles.add(path);
  const ignored = (name: string) => options.ignore?.includes(name);
  const root: Item = { nodeId: "root", name: "Proj.prproj", type: 3, treePath: "\\Proj.prproj", kids: [] as Item[] };
  const bin: Item = { nodeId: "bin", name: "Footage", type: 2, treePath: "\\Proj.prproj\\Footage", kids: [] as Item[] };
  const interp = { frameRate: 25, pixelAspectRatio: 1 };
  const clip: Item = {
    nodeId: "i1", name: "a.mp4", type: 1, treePath: "\\Proj.prproj\\a.mp4", label: 2, path: filePath("/media/a.mp4"),
    getColorLabel: () => clip.label,
    setColorLabel: (i: number) => { if (!ignored("label") && i >= 0 && i <= 15) clip.label = i; },
    getFootageInterpretation: () => ({ ...interp }),
    setFootageInterpretation: (next: typeof interp) => {
      if (ignored("interp")) return;
      interp.frameRate = next.frameRate;
      interp.pixelAspectRatio = options.resetParOnInterp ? 1 : next.pixelAspectRatio;
    },
    setOverrideFrameRate: (rate: number) => { if (!ignored("rate")) interp.frameRate = rate; },
    setOverridePixelAspectRatio: (n: number, d: number) => { if (!ignored("par")) interp.pixelAspectRatio = n / d; },
    getMediaPath: () => clip.path,
    canChangeMediaPath: () => true,
    changeMediaPath: (p: string) => { if (ignored("relink")) return false; clip.path = p; return true; },
    moveBin: (target: Item) => { if (!ignored("move")) clip.treePath = `${target.treePath}\\${clip.name}`; },
  };
  root.kids.push(bin, clip);
  for (const item of [root, bin]) {
    item.children = new Proxy({}, { get: (_t, key) => (key === "numItems" ? item.kids.length : item.kids[Number(key)]) });
    item.renameBin = (name: string) => { if (!ignored("renameBin")) item.name = name; };
  }
  let nextId = 100;
  let luminance = 203;
  const app = {
    project: {
      rootItem: root,
      importFiles: (paths: string[], _suppress: boolean, target: Item) => {
        for (const p of paths) {
          if (ignored(`import:${p}`)) continue;
          target.kids.push({ nodeId: `n${nextId++}`, name: basename(p), type: 1, getMediaPath: () => p });
        }
        return true;
      },
      getGraphicsWhiteLuminance: () => luminance,
      setGraphicsWhiteLuminance: (value: number) => { if (!ignored("luminance")) luminance = value; },
    },
  };
  const existing = new Set(options.existingFiles ?? []);
  function File(this: { fsName: string; exists: boolean }, path: string) {
    this.fsName = path;
    this.exists = existing.has(path);
  }
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, File }))));
  return { root, bin, clip, interp };
}

describe("project item writes read back", () => {
  it.each([null, true, "1"])("does not certify invalid interpretation scalar %s", async (value) => {
    const { clip } = host();
    clip.getFootageInterpretation = () => ({ frameRate: value, pixelAspectRatio: value });
    await expect(run(media.set_override_frame_rate, { item_id: "i1", frame_rate: 1 })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
    await expect(run(media.set_override_pixel_aspect_ratio, { item_id: "i1", numerator: 1, denominator: 1 })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
  });

  it("set_color_label verifies and refuses indexes Premiere ignores", async () => {
    const { clip } = host();
    await expect(run(metadata.set_color_label, { item_id: "i1", color_index: 5 })).resolves.toMatchObject({ success: true, data: { colorIndex: 5, verified: true } });
    await expect(run(metadata.set_color_label, { item_id: "i1", color_index: 99 })).resolves.toMatchObject({ success: false, error: "color_index must be an integer from 0 to 15." });
    expect(clip.label).toBe(5);
    host({ ignore: ["label"] });
    await expect(run(metadata.set_color_label, { item_id: "i1", color_index: 5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("kept color label 2") });
  });

  it("set_footage_interpretation catches a field Premiere reset", async () => {
    host();
    await expect(run(metadata.set_footage_interpretation, { item_id: "i1", frame_rate: 24 })).resolves.toMatchObject({ success: true, data: { frameRate: 24, pixelAspectRatio: 1, verified: true } });
    const { interp } = host({ resetParOnInterp: true });
    interp.pixelAspectRatio = 2;
    await expect(run(metadata.set_footage_interpretation, { item_id: "i1", frame_rate: 24 })).resolves.toMatchObject({ success: false, data: { frameRate: 24, pixelAspectRatio: 1 } });
    await expect(run(metadata.set_footage_interpretation, { item_id: "i1" })).resolves.toMatchObject({ success: false, error: "Provide frame_rate, pixel_aspect_ratio, or both." });
  });

  it("set_override_frame_rate refuses 0 and verifies the rate", async () => {
    const { interp } = host();
    await expect(run(media.set_override_frame_rate, { item_id: "i1", frame_rate: 0 })).resolves.toMatchObject({ success: false, error: "frame_rate must be a positive number." });
    expect(interp.frameRate).toBe(25);
    await expect(run(media.set_override_frame_rate, { item_id: "i1", frame_rate: 30 })).resolves.toMatchObject({ success: true, data: { frameRate: 30, verified: true } });
    host({ ignore: ["rate"] });
    await expect(run(media.set_override_frame_rate, { item_id: "i1", frame_rate: 30 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("reads 25 fps") });
  });

  it("set_override_pixel_aspect_ratio verifies the ratio", async () => {
    host();
    await expect(run(media.set_override_pixel_aspect_ratio, { item_id: "i1", numerator: 2, denominator: 1 })).resolves.toMatchObject({ success: true, data: { pixelAspectRatio: 2, verified: true } });
    await expect(run(media.set_override_pixel_aspect_ratio, { item_id: "i1", numerator: 2, denominator: 0 })).resolves.toMatchObject({ success: false });
    host({ ignore: ["par"] });
    await expect(run(media.set_override_pixel_aspect_ratio, { item_id: "i1", numerator: 2, denominator: 1 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("reads 1") });
  });

  it("retains the default refusal and unverified unsafe CEP relink", async () => {
    const { clip } = host({ existingFiles: [filePath("/media/b.mp4")] });
    const result = await run(media.relink_media, { item_id: "i1", new_path: filePath("/media/b.mp4") });
    expect(result.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(clip.path).toBe(filePath("/media/a.mp4"));
    await expect(run(media.relink_media, { item_id: "i1", new_path: filePath("/media/b.mp4"), allow_unsafe_cep_relink: true })).resolves.toMatchObject({ success: true, data: { newPath: filePath("/media/b.mp4"), verified: false, outcome: "committed_unverified" } });
  });

  it("move_item_to_bin refuses a non-bin target and verifies treePath", async () => {
    host();
    await expect(run(media.move_item_to_bin, { item_id: "i1", target_bin: "i1" })).resolves.toMatchObject({ success: false, error: "a.mp4 is not a bin; nothing was moved." });
    await expect(run(media.move_item_to_bin, { item_id: "i1", target_bin: "Footage" })).resolves.toMatchObject({ success: true, data: { verified: true, toBin: "Footage" } });
    host({ ignore: ["move"] });
    await expect(run(media.move_item_to_bin, { item_id: "i1", target_bin: "Footage" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not move a.mp4") });
  });

  it("rename_bin and set_graphics_white_luminance read back", async () => {
    host();
    await expect(run(project.rename_bin, { bin_id: "Footage", new_name: 'B-roll "2"' })).resolves.toMatchObject({ success: true, data: { newName: 'B-roll "2"', verified: true } });
    await expect(run(project.set_graphics_white_luminance, { luminance: 100 })).resolves.toMatchObject({ success: true, data: { graphicsWhiteLuminance: 100, verified: true } });
    host({ ignore: ["renameBin", "luminance"] });
    await expect(run(project.rename_bin, { bin_id: "Footage", new_name: "X" })).resolves.toMatchObject({ success: false, error: "Premiere kept the bin name Footage." });
    await expect(run(project.set_graphics_white_luminance, { luminance: 100 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("reads 203") });
  });
});

describe("import_media confirms new project items", () => {
  it("imports into a bin and names each new item", async () => {
    const { bin } = host({ existingFiles: [filePath("/m/x.wav"), filePath("/m/y.wav")] });
    const result = await run(media.import_media, { file_paths: [filePath("/m/x.wav"), filePath("/m/y.wav")], target_bin: "Footage" });
    expect(result).toMatchObject({ success: true, data: { imported: 2, verified: true } });
    expect(result.data?.items.map((item: { mediaPath: string }) => item.mediaPath)).toEqual([filePath("/m/x.wav"), filePath("/m/y.wav")]);
    expect(bin.kids).toHaveLength(2);
  });

  it("refuses missing files before importing anything", async () => {
    const { root } = host({ existingFiles: [filePath("/m/x.wav")] });
    await expect(run(media.import_media, { file_paths: [filePath("/m/x.wav"), filePath("/m/nope.wav")] })).resolves.toMatchObject({ success: false, error: expect.stringContaining(`File(s) not found: ${filePath("/m/nope.wav")}`) });
    expect(root.kids).toHaveLength(2);
  });

  it("reports files that produced no project item", async () => {
    host({ existingFiles: [filePath("/m/x.wav"), filePath("/m/y.wav")], ignore: [`import:${filePath("/m/y.wav")}`] });
    await expect(run(media.import_media, { file_paths: [filePath("/m/x.wav"), filePath("/m/y.wav")] })).resolves.toMatchObject({
      success: false,
      data: { notImported: [filePath("/m/y.wav")], imported: [{ mediaPath: filePath("/m/x.wav") }] },
    });
  });
});
