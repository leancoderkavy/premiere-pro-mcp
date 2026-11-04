import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
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
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/sequence-points", timeoutMs: 5000 };
const playhead = getPlayheadTools(bridgeOptions);
const targeting = getTrackTargetingTools(bridgeOptions);
const editor = getEditorRequestTools(bridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

/**
 * Mirrors Premiere Pro 25.2: in/out and work-area getters return seconds as
 * strings, -400000 means unset, and scripted work-area writes are ignored.
 */
function sequence(options: { inSeconds?: number; outSeconds?: number; workAreaWritable?: boolean; workAreaEnabled?: boolean; ignorePlayer?: boolean; frameTicks?: number } = {}) {
  let inPoint = options.inSeconds ?? -400000;
  let outPoint = options.outSeconds ?? -400000;
  let workIn = 0;
  let enabled = options.workAreaEnabled ?? false;
  let workOut = 121.6;
  let player = 0;
  return {
    sequenceID: "seq-points",
    timebase: String(options.frameTicks ?? TICKS / 25),
    end: String(121.6 * TICKS),
    getSettings: () => ({ videoDisplayFormat: 100 }),
    videoTracks: { numTracks: 0 },
    audioTracks: { numTracks: 0 },
    markers: { getFirstMarker: () => null },
    getInPoint: () => String(inPoint),
    getOutPoint: () => String(outPoint),
    setInPoint: (seconds: number) => { inPoint = seconds; },
    // Live 25.2.3: an out-point before the in-point clears the in-point.
    // Live 26.5.2: writing the unset value -400000 clears only that point.
    setOutPoint: (seconds: number) => { outPoint = seconds; if (seconds > -399999 && inPoint > -399999 && seconds < inPoint) inPoint = -400000; },
    getWorkAreaInPoint: () => String(workIn),
    getWorkAreaOutPoint: () => String(workOut),
    setWorkAreaInPoint: (seconds: number) => { if (enabled && options.workAreaWritable) workIn = Number(seconds); },
    setWorkAreaOutPoint: (seconds: number) => { if (enabled && options.workAreaWritable) workOut = Number(seconds); },
    isWorkAreaEnabled: () => enabled,
    setWorkAreaEnabled: (value: boolean) => { enabled = value; },
    getPlayerPosition: () => ({ ticks: String(player) }),
    // Live 25.2.3 ignores a negative position.
    setPlayerPosition: (ticks: string) => { if (!options.ignorePlayer && parseFloat(ticks) >= 0) player = parseFloat(ticks); },
  };
}

function host(seq: ReturnType<typeof sequence>, timeFormatted?: (displayFormat: number) => string) {
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: seq, sequences: { numSequences: 1, 0: seq } } },
      ...(timeFormatted ? {
        Time: function Time(this: { ticks: string; getFormatted: (frameRate: unknown, displayFormat: number) => string }) {
          this.ticks = "0";
          this.getFormatted = (_frameRate, displayFormat) => timeFormatted(displayFormat);
        },
      } : {}),
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

describe("clear_sequence_in_out", () => {
  it("unsets both points instead of marking the whole sequence", async () => {
    const seq = sequence({ inSeconds: 10, outSeconds: 20 });
    host(seq);
    await expect(targeting.clear_sequence_in_out.handler({})).resolves.toMatchObject({
      success: true,
      data: { outcome: "verified", verified: true, inSeconds: null, outSeconds: null, inSet: false, outSet: false, inMethod: "unset", outMethod: "unset" },
    });
    expect(seq.getInPoint()).toBe("-400000");
    expect(seq.getOutPoint()).toBe("-400000");
  });

  it("clears one point and leaves the other unchanged", async () => {
    host(sequence({ inSeconds: 10, outSeconds: 20 }));
    await expect(targeting.clear_sequence_in_out.handler({ clear_in: false })).resolves.toMatchObject({
      success: true,
      data: { inSeconds: 10, outSeconds: null, clearedIn: false, clearedOut: true },
    });
    host(sequence({ inSeconds: 10, outSeconds: 20 }));
    await expect(targeting.clear_sequence_in_out.handler({ clear_out: false })).resolves.toMatchObject({
      success: true,
      data: { inSeconds: null, outSeconds: 20 },
    });
  });

  it("falls back to the sequence bounds within half a frame when the host rejects the unset value", async () => {
    // Live 26.5.2 reads an out point at the sequence end back rounded (1083.01525 for 1083.0152667).
    const seq = Object.assign(sequence({ inSeconds: 10, outSeconds: 20 }), { zeroPoint: "0" });
    seq.setInPoint = (seconds: number) => { if (seconds >= 0) (seq as any).__in = seconds; };
    seq.getInPoint = () => String((seq as any).__in ?? 10);
    seq.setOutPoint = (seconds: number) => { if (seconds >= 0) (seq as any).__out = seconds - 0.0000167; };
    seq.getOutPoint = () => String((seq as any).__out ?? 20);
    host(seq);
    await expect(targeting.clear_sequence_in_out.handler({})).resolves.toMatchObject({
      success: true,
      data: { outcome: "verified", inMethod: "sequence_bounds", outMethod: "sequence_bounds", inSeconds: 0 },
    });
  });

  it("fails when Premiere keeps the mark", async () => {
    const seq = sequence({ inSeconds: 10, outSeconds: 20 });
    seq.setInPoint = () => {};
    host(seq);
    const result = await runWithUndoTracking(true, () => targeting.clear_sequence_in_out.handler({})) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not clear the sequence in point");
    expect(result.data?.mutationOutcome).not.toBe("not_applied");
    expect(result.data).toMatchObject({ outcome: "failed", verified: false, inSeconds: 10, outSeconds: null });
  });
});

describe("work area", () => {
  it("get_work_area returns seconds, not seconds divided by ticks-per-second", async () => {
    host(sequence());
    const result = await playhead.get_work_area.handler() as Result;
    expect(result.data).toMatchObject({ inSeconds: 0, enabled: false });
    expect(result.data?.outSeconds).toBeCloseTo(121.6);
  });

  it("set_work_area fails and turns the bar back off when Premiere ignores the write", async () => {
    // Live 26.5.2: the point setters return and change nothing, even with the bar enabled.
    const seq = sequence();
    host(seq);
    const result = await playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ignored the work-area point writes.*turned back off.*UXP/);
    expect(result.data).toMatchObject({ outcome: "failed", verified: false, workAreaIn: 0, enabledByTool: false, workAreaEnabled: false, barRestored: true });
    expect(seq.isWorkAreaEnabled()).toBe(false);
  });

  it("leaves an already enabled bar on when Premiere ignores the write", async () => {
    const seq = sequence({ workAreaEnabled: true });
    const disable = vi.spyOn(seq, "setWorkAreaEnabled");
    host(seq);
    const result = await playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 }) as Result;
    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ outcome: "failed", workAreaEnabled: true });
    expect(result.data).not.toHaveProperty("barRestored");
    expect(disable).not.toHaveBeenCalled();
  });

  it("reports when the bar it enabled cannot be turned back off", async () => {
    const seq = sequence();
    let enabled = false;
    seq.isWorkAreaEnabled = () => enabled;
    seq.setWorkAreaEnabled = (value: boolean) => { if (value) enabled = true; };
    host(seq);
    const result = await playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be turned back off/);
    expect(result.data).toMatchObject({ outcome: "failed", workAreaEnabled: true, barRestored: false });
  });

  it("set_work_area writes seconds and verifies them when Premiere accepts the write", async () => {
    host(sequence({ workAreaWritable: true }));
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({
      success: true,
      data: { workAreaIn: 10, workAreaOut: 30, verified: true },
    });
  });

  it("enables a disabled bar before writing and verifies its state", async () => {
    const seq = sequence({ workAreaWritable: true });
    host(seq);
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({ data: { outcome: "verified", enabledByTool: true, workAreaEnabled: true } });
    expect(seq.isWorkAreaEnabled()).toBe(true);
  });

  it("refuses a missing or ineffective enable API without writing points", async () => {
    for (const missing of [true, false]) {
      const seq = sequence({ workAreaWritable: true });
      if (missing) delete (seq as any).setWorkAreaEnabled;
      else seq.setWorkAreaEnabled = () => {};
      const write = vi.spyOn(seq, "setWorkAreaInPoint");
      host(seq);
      const result = await playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 }) as Result;
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ outcome: "failed", workAreaEnabled: false });
      expect(result.error).toContain("Work Area Bar");
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("keeps unreadable enabled state distinct from false and catches disabled getters", async () => {
    const seq = sequence();
    seq.isWorkAreaEnabled = () => undefined as any;
    seq.getWorkAreaInPoint = () => { throw new Error("disabled"); };
    host(seq);
    await expect(playhead.get_work_area.handler()).resolves.toMatchObject({ data: { enabled: null, inSeconds: null } });
    const { getSequenceTools } = await import("../../src/tools/sequence.js");
    await expect(getSequenceTools(bridgeOptions).is_work_area_enabled.handler()).resolves.toMatchObject({ success: false });
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({ success: false, data: { outcome: "failed" } });
  });

  it("does not claim verification for a throwing write or one-frame readback drift", async () => {
    for (const throws of [true, false]) {
      const seq = sequence({ workAreaWritable: true, workAreaEnabled: true });
      if (throws) seq.setWorkAreaOutPoint = () => { throw new Error("write failed"); };
      else seq.getWorkAreaOutPoint = () => "30.04";
      host(seq);
      await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({ data: { outcome: "committed_unverified", verified: false } });
    }
  });

  it("reports an uncertain enable attempt or unreadable point readback without claiming verification", async () => {
    let seq = sequence({ workAreaWritable: true });
    seq.setWorkAreaEnabled = () => { throw new Error("host enable failed"); };
    host(seq);
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({ data: { outcome: "committed_unverified", verified: false } });
    seq = sequence({ workAreaWritable: true, workAreaEnabled: true });
    seq.getWorkAreaOutPoint = () => { throw new Error("read failed"); };
    host(seq);
    await expect(playhead.set_work_area.handler({ in_seconds: 10, out_seconds: 30 })).resolves.toMatchObject({ data: { outcome: "committed_unverified", verified: false, workAreaOut: null } });
  });

  it("rejects nonfinite and negative points without sending a script", async () => {
    for (const in_seconds of [NaN, Infinity, -1]) {
      await expect(playhead.set_work_area.handler({ in_seconds, out_seconds: 30 })).resolves.toMatchObject({ success: false });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it.each([
    [23.976, TICKS * 1001 / 24000],
    [29.97, TICKS * 1001 / 30000],
    [25, TICKS / 25],
  ])("snaps work-area and sequence marks to the %.3f fps frame grid", async (_fps, frameTicks) => {
    const seq = sequence({ frameTicks, workAreaWritable: true });
    host(seq);
    const work = await playhead.set_work_area.handler({ in_seconds: 0.5, out_seconds: 10.5 }) as Result;
    expect(work.success).toBe(true);
    const inSeconds = Number(seq.getWorkAreaInPoint());
    const outSeconds = Number(seq.getWorkAreaOutPoint());
    expect(inSeconds * TICKS / frameTicks).toBeCloseTo(Math.round(inSeconds * TICKS / frameTicks), 5);
    expect(outSeconds * TICKS / frameTicks).toBeCloseTo(Math.round(outSeconds * TICKS / frameTicks), 5);
    expect(work.data).toHaveProperty("requestedInSeconds", 0.5);
    expect(work.data).toHaveProperty("appliedInSeconds");

    const marks = await playhead.set_sequence_in_out_points.handler({ in_seconds: 0.5, out_seconds: 10.5 }) as Result;
    expect(marks.success).toBe(true);
    expect(Number(seq.getInPoint()) * TICKS / frameTicks).toBeCloseTo(Math.round(Number(seq.getInPoint()) * TICKS / frameTicks), 5);
    expect(Number(seq.getOutPoint()) * TICKS / frameTicks).toBeCloseTo(Math.round(Number(seq.getOutPoint()) * TICKS / frameTicks), 5);
    expect(marks.data).toHaveProperty("requestedInSeconds", 0.5);
    expect(marks.data).toHaveProperty("appliedInSeconds");
  });
});

describe("navigate_playhead to sequence points", () => {
  it("reports Premiere's sequence display-format timecode", async () => {
    const seq = sequence();
    host(seq, (displayFormat) => displayFormat === 100 ? "00;00;00;01" : "00:00:00:01");

    const result = await editor.navigate_playhead.handler({ action: "step_forward" } as never) as Result;

    expect(result.success).toBe(true);
    expect(result.data?.timecode).toBe("00;00;00;01");
  });

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

  it.each([
    [23.976, TICKS * 1001 / 24000],
    [29.97, TICKS * 1001 / 30000],
    [25, TICKS / 25],
  ])("snaps %.3f fps playhead writes to integer frames and reports changed requests", async (_fps, frameTicks) => {
    const seq = sequence({ frameTicks });
    host(seq);
    const result = await playhead.set_playhead_position.handler({ time_seconds: 0.5 }) as Result;
    const actualTicks = Number(seq.getPlayerPosition().ticks);
    expect(actualTicks / frameTicks).toBeCloseTo(Math.round(actualTicks / frameTicks), 6);
    expect(result.data).toMatchObject({ verified: true, requestedSeconds: 0.5 });
    expect(result.data?.appliedSeconds as number).toBeCloseTo(actualTicks / TICKS, 7);
  });

  it("keeps integer-frame requests exact without adding snap receipt fields", async () => {
    const frameTicks = TICKS * 1001 / 24000;
    const seq = sequence({ frameTicks });
    host(seq);
    const requested = frameTicks * 24 / TICKS;
    const result = await playhead.set_playhead_position.handler({ time_seconds: requested }) as Result;
    expect(Number(seq.getPlayerPosition().ticks) / frameTicks).toBeCloseTo(24, 6);
    expect(result.data).not.toHaveProperty("appliedSeconds");
  });
});

describe("set_sequence_in_out_points", () => {
  it("sets and verifies the points", async () => {
    host(sequence());
    await expect(playhead.set_sequence_in_out_points.handler({ in_seconds: 25, out_seconds: 29 })).resolves.toMatchObject({ success: true, data: { inSeconds: 25, outSeconds: 29, verified: true } });
  });

  it.each([1582, 1750, 2752, 2997, 3401])("stores both marks at or after their frame starts (In frame %i) when Premiere floors marks to audio samples", async (frame) => {
    // Live 26.5.2: marks are floored to the 48 kHz grid, and an In stored just
    // before a frame start made an In/Out export begin one frame early.
    const frameTicks = TICKS * 1001 / 30000;
    const frameSeconds = 1001 / 30000;
    const seq = sequence({ frameTicks });
    const stored = { in: -400000, out: -400000 };
    const floorToSample = (seconds: number) => Math.floor(seconds * 48000) / 48000;
    seq.getSettings = () => ({ videoDisplayFormat: 100, audioSampleRate: { ticks: "5292000" } }) as any;
    seq.setInPoint = (seconds: number) => { stored.in = floorToSample(seconds); };
    seq.setOutPoint = (seconds: number) => { stored.out = floorToSample(seconds); };
    seq.getInPoint = () => String(stored.in);
    seq.getOutPoint = () => String(stored.out);
    host(seq);
    const result = await playhead.set_sequence_in_out_points.handler({ in_seconds: frame * frameSeconds, out_seconds: (frame + 10) * frameSeconds }) as Result;
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(Math.floor(stored.in / frameSeconds + 1e-9)).toBe(frame);
    expect(stored.in - frame * frameSeconds).toBeLessThan(1 / 48000 + 1e-12);
    expect(Math.floor(stored.out / frameSeconds + 1e-9)).toBe(frame + 10);
    expect(stored.out - (frame + 10) * frameSeconds).toBeLessThan(1 / 48000 + 1e-12);
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
