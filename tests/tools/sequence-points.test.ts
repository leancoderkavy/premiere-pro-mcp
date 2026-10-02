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
import { getPlayheadTools } from "../../src/tools/playhead.js";
import { getEditorRequestTools } from "../../src/tools/editor-requests.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/sequence-points", timeoutMs: 5000 };
const playhead = getPlayheadTools(bridgeOptions);
const editor = getEditorRequestTools(bridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

/**
 * Mirrors Premiere Pro 25.2: in/out and work-area getters return seconds as
 * strings, -400000 means unset, and scripted work-area writes are ignored.
 */
function sequence(options: { inSeconds?: number; outSeconds?: number; workAreaWritable?: boolean; ignorePlayer?: boolean } = {}) {
  let inPoint = options.inSeconds ?? -400000;
  let outPoint = options.outSeconds ?? -400000;
  let workIn = 0;
  let workOut = 121.6;
  let player = 0;
  return {
    sequenceID: "seq-points",
    timebase: String(TICKS / 25),
    end: String(121.6 * TICKS),
    videoTracks: { numTracks: 0 },
    audioTracks: { numTracks: 0 },
    markers: { getFirstMarker: () => null },
    getInPoint: () => String(inPoint),
    getOutPoint: () => String(outPoint),
    setInPoint: (seconds: number) => { inPoint = seconds; },
    // Live 25.2.3: an out-point before the in-point clears the in-point.
    setOutPoint: (seconds: number) => { outPoint = seconds; if (inPoint > -399999 && seconds < inPoint) inPoint = -400000; },
    getWorkAreaInPoint: () => String(workIn),
    getWorkAreaOutPoint: () => String(workOut),
    setWorkAreaInPoint: (seconds: number) => { if (options.workAreaWritable) workIn = Number(seconds); },
    setWorkAreaOutPoint: (seconds: number) => { if (options.workAreaWritable) workOut = Number(seconds); },
    isWorkAreaEnabled: () => false,
    getPlayerPosition: () => ({ ticks: String(player) }),
    // Live 25.2.3 ignores a negative position.
    setPlayerPosition: (ticks: string) => { if (!options.ignorePlayer && parseFloat(ticks) >= 0) player = parseFloat(ticks); },
  };
}

function host(seq: ReturnType<typeof sequence>) {
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: seq, sequences: { numSequences: 1, 0: seq } } },
    }))));
}

describe("sequence point helpers", () => {
  const run = (expression: string) => runInNewContext(`${getHelpersSource()}\n${expression}`, {});
  it("reads seconds and maps Premiere's -400000 unset marker to null", () => {
    expect(run('__sequencePointSeconds("5")')).toBe(5);
    expect(run('__sequencePointSeconds("121.59999999999999")')).toBeCloseTo(121.6);
    expect(run('__sequencePointSeconds("-400000")')).toBeNull();
    expect(run('__sequencePointSeconds("junk")')).toBeNull();
  });

  it("derives the sample rate in Hz from a sample-period Time", () => {
    expect(run('__sampleRateHz({ seconds: 2.083333333e-05, ticks: "5292000" })')).toBe(48000);
    expect(run('__sampleRateHz({ ticks: "5760000" })')).toBe(44100);
    expect(run("__sampleRateHz(48000)")).toBe(48000);
    expect(run("__sampleRateHz(null)")).toBeNull();
  });
});

describe("get_sequence_in_out_points", () => {
  it("reports unset points as null instead of -400000", async () => {
    host(sequence());
    await expect(playhead.get_sequence_in_out_points.handler()).resolves.toMatchObject({
      success: true,
      data: { inSeconds: null, outSeconds: null, inSet: false, outSet: false },
    });
  });

  it("reports set points in seconds", async () => {
    host(sequence({ inSeconds: 5, outSeconds: 20 }));
    await expect(playhead.get_sequence_in_out_points.handler()).resolves.toMatchObject({
      data: { inSeconds: 5, outSeconds: 20, inSet: true, outSet: true },
    });
  });
});

describe("work area", () => {
  it("get_work_area returns seconds, not seconds divided by ticks-per-second", async () => {
    host(sequence());
    const result = await playhead.get_work_area.handler() as Result;
    expect(result.data).toMatchObject({ inSeconds: 0, enabled: false });
    expect(result.data?.outSeconds).toBeCloseTo(121.6);
  });

  it("set_work_area refuses to report success when Premiere ignores the write", async () => {
    host(sequence());
    const result = await playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/did not apply the work area.*set_sequence_in_out_points/);
  });

  it("set_work_area writes seconds and verifies them when Premiere accepts the write", async () => {
    host(sequence({ workAreaWritable: true }));
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({
      success: true,
      data: { workAreaIn: 10, workAreaOut: 30, verified: true },
    });
  });
});

describe("navigate_playhead to sequence points", () => {
  it("moves to the work-area out point in seconds", async () => {
    host(sequence());
    const result = await editor.navigate_playhead.handler({ action: "work_area_out" } as never) as Result;
    expect(result.success).toBe(true);
    expect(result.data?.toSeconds as number).toBeCloseTo(121.6);
  });

  it("refuses to move when no in point is set", async () => {
    host(sequence());
    await expect(editor.navigate_playhead.handler({ action: "in_point" } as never)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no in point set"),
    });
  });

  it("moves to a set in point", async () => {
    host(sequence({ inSeconds: 5 }));
    const result = await editor.navigate_playhead.handler({ action: "in_point" } as never) as Result;
    expect(result.data?.toSeconds).toBe(5);
  });
});

describe("set_playhead_position reads the position back", () => {
  it("moves the playhead and reports the observed position", async () => {
    const seq = sequence();
    host(seq);
    await expect(playhead.set_playhead_position.handler({ time_seconds: 30 })).resolves.toMatchObject({ success: true, data: { positionSeconds: 30, verified: true } });
    expect(parseFloat(seq.getPlayerPosition().ticks) / TICKS).toBe(30);
  });

  it("clamps a time past the sequence end and verifies its stored position", async () => {
    const seq = sequence();
    host(seq);
    await expect(playhead.set_playhead_position.handler({ time_seconds: 10000 })).resolves.toMatchObject({ success: true, data: { positionSeconds: 121.6, clamped: true, verified: true } });
    expect(Number(seq.getPlayerPosition().ticks) / TICKS).toBe(121.6);
  });

  it("refuses a negative time before building a script", async () => {
    await expect(playhead.set_playhead_position.handler({ time_seconds: -5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("reports where the playhead is when Premiere ignores the move", async () => {
    host(sequence({ ignorePlayer: true }));
    await expect(playhead.set_playhead_position.handler({ time_seconds: 12 })).resolves.toMatchObject({ success: true, data: { positionSeconds: 0, verified: false, outcome: "committed_unverified" } });
  });
});

describe("set_sequence_in_out_points", () => {
  it("sets and verifies the points", async () => {
    host(sequence());
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: 25, out_seconds: 29 })).resolves.toMatchObject({ success: true, data: { inSeconds: 25, outSeconds: 29, verified: true } });
  });

  it("refuses an out-point before the in-point, keeping the existing points", async () => {
    const seq = sequence({ inSeconds: 5, outSeconds: 9 });
    host(seq);
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: 29, out_seconds: 25 })).resolves.toMatchObject({ success: false, error: "out_seconds must be after in_seconds. Nothing was changed." });
    expect([seq.getInPoint(), seq.getOutPoint()]).toEqual(["5", "9"]);
  });

  it("refuses negative points and an out-point past the sequence end", async () => {
    const seq = sequence({ inSeconds: 5, outSeconds: 9 });
    host(seq);
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: -3, out_seconds: 4 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative") });
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: 5, out_seconds: 10000 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("sequence end") });
    expect([seq.getInPoint(), seq.getOutPoint()]).toEqual(["5", "9"]);
  });

  it("reports the points Premiere left when a write does not stick", async () => {
    const seq = sequence({ inSeconds: 5, outSeconds: 9 });
    seq.setInPoint = () => {};
    host(seq);
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: 6, out_seconds: 8 })).resolves.toMatchObject({
      success: false,
      data: { inSeconds: 5, outSeconds: 8, previousInSeconds: 5, previousOutSeconds: 9 },
    });
  });
});
