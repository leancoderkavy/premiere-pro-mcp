import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { capabilitiesForToolInvocation } from "../../src/security/capabilities.js";
import type { SourceVideoProbe } from "../../src/tools/source-freeze-frame.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string; data?: Record<string, any> };

function collection<T>(list: T[]) {
  return new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
}
const time = (ticks: number) => ({ ticks: String(ticks), seconds: ticks / TICKS });

interface HostOptions {
  occupied?: boolean;
  occupyAfterPreflight?: boolean;
  interpretedFps?: number;
  scaleDrift?: boolean;
  noPlacement?: boolean;
  mediaPath?: string;
  locked?: boolean;
}

let dir: string;
let mediaPath: string;
beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "sff-"));
  mediaPath = join(dir, "source.mov");
  writeFileSync(mediaPath, "fake");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A small Premiere stand-in: one source item, a 25 fps 1920x1080 sequence and one video track. */
function host(options: HostOptions = {}) {
  const frame = TICKS / 25;
  const scripts: string[] = [];
  const root: Record<string, any>[] = [{
    nodeId: "src-1", name: "Interview \"A\".mov", type: 1,
    getMediaPath: () => options.mediaPath ?? mediaPath,
    isSequence: () => false, isOffline: () => false,
    getFootageInterpretation: () => ({ frameRate: options.interpretedFps ?? 25 }),
  }];
  const trackClips: Record<string, any>[] = options.occupied ? [{ name: "Existing", start: time(0), end: time(10 * TICKS) }] : [];
  function makeProp(name: string, value: unknown) {
    const keys = new Map<string, unknown>();
    let varying = false;
    return {
      displayName: name,
      getValue: () => value,
      isTimeVarying: () => varying,
      setTimeVarying: (v: boolean) => { varying = v; },
      addKey: (t: { ticks: string }) => { if (!keys.has(t.ticks)) keys.set(t.ticks, value); },
      setValueAtKey: (t: { ticks: string }, v: unknown) => { keys.set(t.ticks, options.scaleDrift && name === "Scale" ? Number(v) + 5 : v); },
      getValueAtKey: (t: { ticks: string }) => keys.get(t.ticks),
      setInterpolationTypeAtKey: vi.fn(),
      getKeys: () => [...keys.keys()].map((ticks) => ({ ticks })),
    };
  }
  const motionProps = [makeProp("Position", [0.5, 0.5]), makeProp("Scale", 100), makeProp("Uniform Scale", true)];
  const track = {
    clips: collection(trackClips),
    isLocked: () => !!options.locked,
    overwriteClip: (item: Record<string, any>, at: { ticks: string }) => {
      if (options.noPlacement) return;
      const start = Number(at.ticks);
      const length = Math.round((item.__out * TICKS) / frame) * frame;
      trackClips.push({
        name: item.name, nodeId: "clip-1", projectItem: item,
        start: time(start), end: time(start + length), inPoint: time(0),
        getSpeed: () => 1, isSpeedReversed: () => false,
        components: collection([{ displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: collection([]) },
          { displayName: "Motion", matchName: "AE.ADBE Motion", properties: collection(motionProps) }]),
      });
    },
  };
  const app = {
    project: {
      documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      rootItem: { children: collection(root) },
      activeSequence: { timebase: String(frame), frameSizeHorizontal: 1920, frameSizeVertical: 1080, videoTracks: Object.assign(collection([track]), { numTracks: 1 }) },
      importFiles: (paths: string[]) => {
        const still: Record<string, any> = {
          nodeId: "still-1", name: "frame.png", type: 1, __out: 5,
          getMediaPath: () => paths[0],
          getFootageInterpretation: () => ({ frameRate: 25 }),
          getInPoint: () => ({ seconds: 0 }),
          getOutPoint: () => ({ seconds: still.__out }),
          setOutPoint: (seconds: number) => { still.__out = Math.floor(seconds * 25 + 1e-9) / 25; },
        };
        root.push(still);
        return true;
      },
    },
  };
  function File(this: { fsName: string }, path: string) { this.fsName = path; }
  function Time(this: { ticks: string; seconds: number }) { this.ticks = "0"; this.seconds = 0; }
  const context: Record<string, unknown> = { app, File, Time, $: { global: {} }, qe: { project: { undoStackIndex: () => 1 } } };
  mockedSendCommand.mockImplementation(async (script: string) => {
    scripts.push(script);
    if (options.occupyAfterPreflight && scripts.length === 2) trackClips.push({ name: "Late", start: time(0), end: time(TICKS) });
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context)));
  });
  return { scripts, trackClips, motionProps };
}

function tool(overrides: { probe?: Partial<SourceVideoProbe>; extract?: (media: string, seek: number, out: string) => Promise<void> } = {}) {
  const extract = vi.fn(overrides.extract ?? (async (_media: string, _seek: number, out: string) => { writeFileSync(out, "png"); }));
  const probe = vi.fn(async () => ({ durationSeconds: 10, frameRate: 25, width: 1920, height: 1080, variableFrameRate: false, ...overrides.probe }));
  const tools = getUtilityTools({ tempDir: "/tmp/utility", timeoutMs: 5000 } as BridgeOptions, { probeSourceVideo: probe, extractSourceFrame: extract });
  const run = (args: Record<string, unknown>) => tools.create_source_freeze_frame.handler(args as never) as Promise<Result>;
  return { run, extract, probe };
}

describe("create_source_freeze_frame", () => {
  it("requires inspect, edit and filesystem authority", () => {
    expect(capabilitiesForToolInvocation("create_source_freeze_frame", {})).toEqual(["inspect", "edit", "filesystem"]);
  });

  it("refuses invalid input before contacting Premiere or ffmpeg", async () => {
    const { run, extract } = tool();
    const out = join(dir, "f.png");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, time_seconds: 2 }, "not time_seconds"],
      [{ source_item_id: "", source_time_seconds: 1, output_path: out }, "source_item_id"],
      [{ source_item_id: "src-1", source_time_seconds: -1, output_path: out }, "source_time_seconds"],
      [{ source_item_id: "src-1", source_time_seconds: Number.NaN, output_path: out }, "source_time_seconds"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.tif") }, ".png, .jpg"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, duration_seconds: 0 }, "duration_seconds"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "missing", "f.png") }, "does not exist"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, place: { track_index: -1, start_seconds: 0 } }, "place needs"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, zoom: { from_scale: 100, to_scale: 120 } }, "zoom requires place"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, place: { track_index: 0, start_seconds: 0 }, zoom: { from_scale: 0, to_scale: 120 } }, "zoom.from_scale"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, place: { track_index: 0, start_seconds: 0 }, zoom: { from_scale: 100, to_scale: 120, to_position: [1] } }, "zoom.to_position"],
      [{ source_item_id: "src-1", source_time_seconds: 1, output_path: out, place: { track_index: 0, start_seconds: 0 }, zoom: { from_scale: 100, to_scale: 120, ease: "cubic" } }, "zoom.ease"],
    ];
    for (const [args, message] of cases) {
      await expect(run(args)).resolves.toMatchObject({ success: false, error: expect.stringContaining(message) });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("never overwrites an existing output file", async () => {
    const out = join(dir, "taken.png");
    writeFileSync(out, "old");
    const { run, extract } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: out })).resolves.toMatchObject({ success: false, error: expect.stringContaining("already exists") });
    expect(extract).not.toHaveBeenCalled();
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("decodes the source frame at a frame-snapped source time, imports it and verifies its length", async () => {
    host();
    const { run, extract } = tool();
    const out = join(dir, "f.png");
    const result = await run({ source_item_id: "src-1", source_time_seconds: 2.05, output_path: out, duration_seconds: 1.5 });
    expect(result).toMatchObject({ success: true, data: { outcome: "verified", verified: true, imported: true, nodeId: "still-1", appliedDurationSeconds: 1.52, completed: ["exported", "imported", "duration"], extraction: { frameIndex: 51, frameSeconds: 2.04, method: "ffmpeg_source_decode" } } });
    expect(extract).toHaveBeenCalledWith(mediaPath, expect.closeTo(2.04 - 0.01, 6), out);
  });

  it("escapes the item id and paths in the generated scripts", async () => {
    const { scripts } = host();
    const { run } = tool();
    await run({ source_item_id: 'Interview "A".mov', source_time_seconds: 0, output_path: join(dir, 'q"uote.png') });
    expect(scripts[0]).toContain('Interview \\"A\\".mov');
    expect(scripts[1]).toContain('q\\"uote.png');
    expect(scripts[1]).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it("refuses an interpreted frame rate that differs from the file before decoding", async () => {
    host({ interpretedFps: 23.976 });
    const { run, extract } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png") })).resolves.toMatchObject({ success: false, error: expect.stringContaining("interpreted at 23.976") });
    expect(extract).not.toHaveBeenCalled();
  });

  it("refuses a source time past the media end", async () => {
    host();
    const { run, extract } = tool({ probe: { durationSeconds: 3 } });
    await expect(run({ source_item_id: "src-1", source_time_seconds: 3, output_path: join(dir, "f.png") })).resolves.toMatchObject({ success: false, error: expect.stringContaining("past the source media end") });
    expect(extract).not.toHaveBeenCalled();
  });

  it("refuses when the media file is not local and readable", async () => {
    host({ mediaPath: join(dir, "gone.mov") });
    const { run } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png") })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not a readable local file") });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("reports an ffmpeg failure without touching Premiere", async () => {
    host();
    const { run } = tool({ extract: async () => { throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }); } });
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png") })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on PATH") });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("refuses an occupied placement range before writing any file", async () => {
    host({ occupied: true });
    const { run, extract } = tool();
    const out = join(dir, "f.png");
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: out, place: { track_index: 0, start_seconds: 2 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("never overwrites"), data: { code: "RANGE_OCCUPIED" } });
    expect(extract).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a locked track before writing any file", async () => {
    host({ locked: true });
    const { run, extract } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), place: { track_index: 0, start_seconds: 0 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("locked") });
    expect(extract).not.toHaveBeenCalled();
  });

  it("re-checks occupancy before placing and reports the imported still as committed", async () => {
    host({ occupyAfterPreflight: true });
    const { run } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), place: { track_index: 0, start_seconds: 0 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("no longer empty"), data: { outcome: "committed_unverified", imported: true, nodeId: "still-1", completed: ["exported", "imported", "duration"] } });
  });

  it("places the still and verifies Scale and Position zoom keyframes", async () => {
    const { motionProps } = host();
    const { run } = tool();
    const result = await run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), duration_seconds: 2, place: { track_index: 0, start_seconds: 4 }, zoom: { from_scale: 100, to_scale: 125, to_position: [1152, 432] } });
    expect(result).toMatchObject({ success: true, data: {
      outcome: "verified",
      completed: ["exported", "imported", "duration", "placement", "zoom_keyframes"],
      placement: { trackIndex: 0, startSeconds: 4, endSeconds: 6 },
      zoom: { firstKeySeconds: 0, lastKeySeconds: 1.96, scale: { from: 100, to: 125, readBack: [100, 125], keyCount: 2 }, position: { fromPixels: [960, 540], toPixels: [1152, 432], keyCount: 2 } },
    } });
    expect(result.data?.zoom.position.normalizedReadBack[1]).toEqual([0.6, 0.4]);
    expect(motionProps[1].setInterpolationTypeAtKey).not.toHaveBeenCalled();
  });

  it("reports zoom keyframes as committed_unverified when readback disagrees", async () => {
    host({ scaleDrift: true });
    const { run } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), place: { track_index: 0, start_seconds: 0 }, zoom: { from_scale: 100, to_scale: 120 } })).resolves.toMatchObject({ success: true, data: { outcome: "committed_unverified", verified: false, unverified: ["zoom_keyframes"], completed: ["exported", "imported", "duration", "placement"] } });
  });

  it("marks bezier interpolation as unverified because Premiere cannot read it back", async () => {
    const { motionProps } = host();
    const { run } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), place: { track_index: 0, start_seconds: 0 }, zoom: { from_scale: 100, to_scale: 120, ease: "bezier" } })).resolves.toMatchObject({ success: true, data: { outcome: "committed_unverified", unverified: ["keyframe_interpolation"] } });
    expect(motionProps[1].setInterpolationTypeAtKey).toHaveBeenCalledWith(expect.anything(), 5, true);
  });

  it("does not claim placement when Premiere accepts the overwrite but adds nothing", async () => {
    host({ noPlacement: true });
    const { run } = tool();
    await expect(run({ source_item_id: "src-1", source_time_seconds: 1, output_path: join(dir, "f.png"), place: { track_index: 0, start_seconds: 0 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on video track 0"), data: { outcome: "committed_unverified", imported: true } });
  });
});
