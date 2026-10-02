import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getExportTools({ tempDir: "/tmp/export-seq", timeoutMs: 5000 } as BridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

/** QuickTime-folder preset: Premiere reports ".mov" and writes a MOV whatever the path says (live 25.2). */
function host(options: { writes?: boolean; marks?: [number, number]; workArea?: [number | string, number | string] | "disabled" | "missing"; enabledState?: unknown; missingEnabled?: boolean; enabledThrows?: boolean; sequenceEnd?: string; returns?: unknown; existing?: string[] } = {}) {
  const written: string[] = [];
  const modes: number[] = [];
  // Files on disk: path -> [size, mtime]. A pre-existing file starts at 2048 bytes.
  const disk = new Map<string, [number, number]>((options.existing ?? []).map((path) => [path, [2048, 1000]]));
  let clock = 2000;
  const seq: Record<string, unknown> = {
    end: options.sequenceEnd ?? String(121.6 * 254016000000),
    getInPoint: () => options.marks?.[0] ?? 0,
    getOutPoint: () => options.marks?.[1] ?? 121.6,
    getExportFileExtension: () => ".mov",
    exportAsMediaDirect: (path: string, _preset: string, mode: number) => {
      modes.push(mode);
      if (options.writes !== false) { written.push(path); disk.set(path, [4096, clock++]); }
      return options.returns ?? "";
    },
  };
  if (options.workArea !== "missing") {
    const enabled = options.workArea !== "disabled";
    const bounds = Array.isArray(options.workArea) ? options.workArea : [0, 121.6];
    if (!options.missingEnabled) seq.isWorkAreaEnabled = () => { if (options.enabledThrows) throw new Error("unreadable"); return "enabledState" in options ? options.enabledState : enabled; };
    seq.getWorkAreaInPoint = () => bounds[0];
    seq.getWorkAreaOutPoint = () => bounds[1];
  }
  function File(this: { exists: boolean; length: number; modified: { getTime: () => number } | null }, path: string) {
    const entry = disk.get(path);
    this.exists = !!entry;
    this.length = entry ? entry[0] : 0;
    this.modified = entry ? { getTime: () => entry[1] } : null;
  }
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: seq }, encoder: { ENCODE_ENTIRE: 0, ENCODE_IN_TO_OUT: 1, ENCODE_WORKAREA: 2 } }, File }))));
  return Object.assign(written, { modes });
}

const preset = join(mkdtempSync(join(tmpdir(), "epr-")), "H264 Match Source - High bitrate.epr");
writeFileSync(preset, "<PremiereData><ExporterFileType>1299148630</ExporterFileType></PremiereData>");

describe("export_sequence", () => {
  it("refuses a .mp4 path for a preset that writes .mov (live: mislabeled QuickTime file)", async () => {
    const written = host();
    const result = await tools.export_sequence.handler({ output_path: "/out/full.mp4", preset_path: preset }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("writes .mov files but output_path ends in .mp4") });
    expect([...written]).toEqual([]);
  });

  it("adds the preset's extension when the path has none and verifies the file", async () => {
    host();
    await expect(tools.export_sequence.handler({ output_path: "/out/full", preset_path: preset })).resolves.toMatchObject({
      success: true,
      data: { outputPath: "/out/full.mov", extension: "mov", verified: true, sizeBytes: 4096 },
    });
  });

  it("fails when Premiere writes nothing", async () => {
    host({ writes: false });
    await expect(tools.export_sequence.handler({ output_path: "/out/full.mov", preset_path: preset })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not write") });
  });

  it("renders the in/out range and reports its expected duration (live: 24.4-34.9 s welcome)", async () => {
    const written = host({ marks: [24.4, 34.9] });
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "in_to_out" })).resolves.toMatchObject({
      success: true,
      data: { range: "in_to_out", rangeStartSeconds: 24.4, expectedDurationSeconds: 10.5 },
    });
    expect(written.modes).toEqual([1]);
  });

  it("refuses in_to_out without marks instead of rendering the whole sequence", async () => {
    const written = host();
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "in_to_out" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("needs sequence in/out points") });
    expect(written.modes).toEqual([]);
  });

  it("renders a partial work area and reports its expected duration", async () => {
    const written = host({ workArea: [24.4, 34.9] });
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({
      success: true,
      data: { range: "work_area", rangeStartSeconds: 24.4, expectedDurationSeconds: 10.5, verified: true },
    });
    expect(written.modes).toEqual([2]);
  });

  it("refuses work_area when the bar is disabled instead of rendering the whole sequence", async () => {
    const written = host({ workArea: "disabled" });
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("needs the work area enabled"),
    });
    expect(written.modes).toEqual([]);
  });

  it("refuses work_area when the bar spans the whole sequence", async () => {
    const written = host({ workArea: [0, 121.6] });
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("needs a work area around part of the sequence"),
    });
    expect(written.modes).toEqual([]);
  });

  it("refuses work_area when the host cannot read the bar", async () => {
    const written = host({ workArea: "missing" });
    await expect(tools.export_sequence.handler({ output_path: "/out/welcome.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/needs (?:a work area|the work area enabled)|getWorkAreaInPoint/),
    });
    expect(written.modes).toEqual([]);
  });

  it.each([
    { missingEnabled: true }, { enabledState: 1 }, { enabledState: "true" }, { enabledState: null }, { enabledThrows: true },
  ])("refuses unverified enabled state %j with valid partial bounds", async (option) => {
    const written = host({ workArea: [20, 30], ...option });
    await expect(tools.export_sequence.handler({ output_path: "/out/partial.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({ success: false });
    expect(written.modes).toEqual([]);
  });

  it.each<[number, number]>([[-5, 200], [-1, 30], [20, 122], [30, 20], [20, Infinity], [NaN, 30]])("refuses out-of-bounds work area %s..%s", async (start, end) => {
    const written = host({ workArea: [start, end] });
    await expect(tools.export_sequence.handler({ output_path: "/out/partial.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({ success: false });
    expect(written.modes).toEqual([]);
  });

  it.each<[number | string, number | string]>([["20bad", 30], [20, "30bad"], ["", 30]])("refuses malformed work-area bounds %s..%s", async (start, end) => {
    const written = host({ workArea: [start, end] });
    await expect(tools.export_sequence.handler({ output_path: "/out/partial.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({ success: false });
    expect(written.modes).toEqual([]);
  });

  it.each(["NaN", "Infinity", "", "-1", "30888345600000garbage"])("refuses work area with invalid sequence end %s", async (sequenceEnd) => {
    const written = host({ workArea: [20, 30], sequenceEnd });
    await expect(tools.export_sequence.handler({ output_path: "/out/partial.mov", preset_path: preset, range: "work_area" })).resolves.toMatchObject({ success: false });
    expect(written.modes).toEqual([]);
  });

  it("fails when Premiere returns false, even if a file appears (#647)", async () => {
    host({ returns: false });
    await expect(tools.export_sequence.handler({ output_path: "/out/full.mov", preset_path: preset })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Premiere rejected the sequence export") });
  });

  it("refuses an output_path that already exists, so a stale file cannot pass as the render", async () => {
    const written = host({ existing: ["/out/full.mov"] });
    await expect(tools.export_sequence.handler({ output_path: "/out/full.mov", preset_path: preset })).resolves.toMatchObject({ success: false, error: expect.stringContaining("already exists") });
    expect(written.modes).toEqual([]);
  });

  it("with overwrite, fails when the existing file was not replaced", async () => {
    host({ existing: ["/out/full.mov"], writes: false });
    await expect(tools.export_sequence.handler({ output_path: "/out/full.mov", preset_path: preset, overwrite: true })).resolves.toMatchObject({ success: false, error: expect.stringContaining("was not replaced") });
  });

  it("with overwrite, verifies the replaced file", async () => {
    host({ existing: ["/out/full.mov"] });
    await expect(tools.export_sequence.handler({ output_path: "/out/full.mov", preset_path: preset, overwrite: true })).resolves.toMatchObject({ success: true, data: { replacedExistingFile: true, sizeBytes: 4096, verified: true } });
  });
});
