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
import { getKeyframeTools } from "../../src/tools/keyframes.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getKeyframeTools({ tempDir: "/tmp/keyframe-time-base", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
const ticks = (seconds: number) => String(Math.round(seconds * TICKS));

beforeEach(() => vi.clearAllMocks());

type HostOptions = { speed?: number; reversed?: boolean; speedReadError?: boolean; ignoreRemove?: boolean; failReadAfterRemove?: boolean; postKeys?: { value: unknown }; mediaKeys?: Array<[number, number]> };

/**
 * One clip on V1 at timeline 25-35s whose in-point is media 30s, as measured on
 * Premiere 25.2.3. Its Opacity keys are stored by media time, like the host's.
 */
function host(options: HostOptions = {}) {
  const keys = new Map<number, number>((options.mediaKeys ?? []).map(([seconds, value]) => [Math.round(seconds * TICKS), value]));
  let timeVarying = keys.size > 0;
  let removed = false;
  const interpolation: Record<number, number> = {};
  const sorted = () => [...keys.keys()].sort((a, b) => a - b);
  const time = (t: number) => ({ ticks: String(t), seconds: t / TICKS });
  const prop = {
    displayName: "Opacity",
    areKeyframesSupported: () => true,
    isTimeVarying: () => timeVarying,
    setTimeVarying: (value: boolean) => { timeVarying = value; if (!value) keys.clear(); },
    getKeys: () => { if (removed && options.failReadAfterRemove) throw new Error("getKeys failed"); if (removed && options.postKeys) return options.postKeys.value; return sorted().map(time); },
    addKey: (t: { ticks: string }) => { const k = Number(t.ticks); if (!keys.has(k)) keys.set(k, 100); },
    setValueAtKey: (t: { ticks: string }, value: number) => { keys.set(Number(t.ticks), value); },
    getValueAtKey: (t: { ticks: string }) => keys.get(Number(t.ticks)) ?? null,
    removeKey: (t: { ticks: string }) => { removed = true; if (!options.ignoreRemove) keys.delete(Number(t.ticks)); },
    setInterpolationTypeAtKey: (t: { ticks: string }, type: number) => { interpolation[Number(t.ticks)] = type; },
    getValueAtTime: (t: { ticks: string }) => {
      const at = Number(t.ticks);
      const list = sorted();
      if (!list.length) return 100;
      if (at <= list[0]) return keys.get(list[0]);
      for (let i = 1; i < list.length; i++) {
        if (at <= list[i]) {
          const [a, b] = [list[i - 1], list[i]];
          return keys.get(a)! + ((keys.get(b)! - keys.get(a)!) * (at - a)) / (b - a);
        }
      }
      return keys.get(list[list.length - 1]);
    },
  };
  const component = { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: prop } };
  const clip = {
    nodeId: "clip1",
    start: { ticks: ticks(25) },
    end: { ticks: ticks(35) },
    inPoint: { ticks: ticks(30) },
    components: { numItems: 1, 0: component },
    getSpeed: () => { if (options.speedReadError) throw new Error("speed failed"); return options.speed ?? 1; },
    isSpeedReversed: () => options.reversed ?? false,
  };
  const seq = { videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
  function Time(this: { ticks: string }) { this.ticks = "0"; }
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: seq } }, Time }))));
  return {
    mediaKeys: () => sorted().map((k) => [k / TICKS, keys.get(k)]),
    interpolation,
  };
}

const target = { node_id: "clip1", effect_name: "Opacity", property_name: "Opacity" };

describe("keyframe times are seconds from the clip's start, stored as media time", () => {
  it("add_keyframe stores the key at the clip's in-point plus the offset", async () => {
    const state = host();
    await expect(tools.add_keyframe.handler({ ...target, time_seconds: 2, value: 20 }))
      .resolves.toMatchObject({ success: true, data: { time: 2, mediaSeconds: 32, readBackValue: 20 } });
    expect(state.mediaKeys()).toEqual([[32, 20]]);
  });

  it("get_keyframes reports clip-relative times next to the stored media time", async () => {
    host({ mediaKeys: [[32, 20], [34, 80]] });
    await expect(tools.get_keyframes.handler(target)).resolves.toMatchObject({
      success: true,
      data: { keyframes: [{ time: 2, mediaSeconds: 32, value: 20 }, { time: 4, mediaSeconds: 34, value: 80 }] },
    });
  });

  it("get_value_at_time reads the curve at the converted time", async () => {
    host({ mediaKeys: [[32, 20], [34, 80]] });
    await expect(tools.get_value_at_time.handler({ ...target, time_seconds: 3 }))
      .resolves.toMatchObject({ success: true, data: { value: 50, mediaSeconds: 33 } });
  });

  it("refuses a time past the clip's end without writing", async () => {
    const state = host();
    await expect(tools.add_keyframe.handler({ ...target, time_seconds: 12, value: 20 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("past the clip's end at 10s") });
    expect(state.mediaKeys()).toEqual([]);
  });

  it("accepts normal speed reported as 100 percent on older hosts", async () => {
    const state = host({ speed: 100 });
    await expect(tools.add_keyframe.handler({ ...target, time_seconds: 2, value: 20 })).resolves.toMatchObject({ success: true });
    expect(state.mediaKeys()).toEqual([[32, 20]]);
  });

  it("refuses keyframe writes when speed cannot be read", async () => {
    const state = host({ speedReadError: true });
    await expect(tools.add_keyframe.handler({ ...target, time_seconds: 2, value: 20 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("speed or reverse state") });
    expect(state.mediaKeys()).toEqual([]);
  });

  it("refuses on a clip with a speed change or reverse, changing nothing", async () => {
    for (const options of [{ speed: 2 }, { reversed: true }]) {
      const state = host(options);
      await expect(tools.add_keyframe.handler({ ...target, time_seconds: 2, value: 20 }))
        .resolves.toMatchObject({ success: false, error: expect.stringContaining("speed change or is reversed") });
      expect(state.mediaKeys()).toEqual([]);
    }
  });

  it("get_keyframes still lists media time on a speed-changed clip", async () => {
    host({ speed: 2, mediaKeys: [[32, 20]] });
    await expect(tools.get_keyframes.handler(target)).resolves.toMatchObject({
      success: true,
      data: { keyframes: [{ time: null, mediaSeconds: 32 }], timeBase: expect.stringContaining("speed change") },
    });
  });
});

describe("keyframe removal reads the keys back", () => {
  it.each([null, undefined, { length: 1, 0: { ticks: "unreadable" } }])("does not certify removal after invalid key readback (%s)", async (value) => {
    host({ mediaKeys: [[32, 20]], ignoreRemove: true, postKeys: { value } });
    await expect(tools.remove_keyframe.handler({ ...target, time_seconds: 2 })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null } });
    host({ mediaKeys: [[32, 20]], ignoreRemove: true, postKeys: { value } });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 0, end_seconds: 10 })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null } });
  });
  it("remove_keyframe removes the key at that clip time and lists the rest", async () => {
    const state = host({ mediaKeys: [[32, 20], [34, 80]] });
    await expect(tools.remove_keyframe.handler({ ...target, time_seconds: 2 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, time: 2, remainingKeys: [4] } });
    expect(state.mediaKeys()).toEqual([[34, 80]]);
  });

  it("remove_keyframe refuses when no key is at that time", async () => {
    const state = host({ mediaKeys: [[32, 20]] });
    await expect(tools.remove_keyframe.handler({ ...target, time_seconds: 3 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("keys are at [2]s") });
    expect(state.mediaKeys()).toEqual([[32, 20]]);
  });

  it("remove_keyframe reports committed_unverified when the key survives", async () => {
    host({ mediaKeys: [[32, 20]], ignoreRemove: true });
    await expect(tools.remove_keyframe.handler({ ...target, time_seconds: 2 }))
      .resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", timelineChanged: true, remainingKeys: [2] } });
  });

  it("remove_keyframe reports committed_unverified when the post-removal read throws", async () => {
    host({ mediaKeys: [[32, 20]], ignoreRemove: true, failReadAfterRemove: true });
    await expect(tools.remove_keyframe.handler({ ...target, time_seconds: 2 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("could not be read back"), data: { outcome: "committed_unverified", verified: false } });
  });

  it("remove_keyframe_range removes only the keys inside the range, inclusive", async () => {
    const state = host({ mediaKeys: [[31, 10], [32, 20], [34, 80], [36, 90]] });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 2, end_seconds: 4 }))
      .resolves.toMatchObject({ success: true, data: { removedCount: 2, removedKeys: [2, 4], remainingKeys: [1, 6] } });
    expect(state.mediaKeys()).toEqual([[31, 10], [36, 90]]);
  });

  it("remove_keyframe_range refuses an empty range or reversed bounds", async () => {
    host({ mediaKeys: [[32, 20]] });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 5, end_seconds: 6 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No keyframes between 5s and 6s") });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 4, end_seconds: 2 }))
      .resolves.toMatchObject({ success: false, error: "end_seconds must not be before start_seconds." });
  });

  it("refuses a range ending past the visible clip without removing keys", async () => {
    const state = host({ mediaKeys: [[32, 20], [34, 80]] });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 2, end_seconds: 99 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("end_seconds 99s is past the clip's end") });
    expect(state.mediaKeys()).toEqual([[32, 20], [34, 80]]);
  });

  it("remove_keyframe_range reports committed_unverified when keys survive", async () => {
    host({ mediaKeys: [[32, 20]], ignoreRemove: true });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 0, end_seconds: 10 }))
      .resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", remainingKeys: [2] } });
  });

  it("remove_keyframe_range reports committed_unverified when the post-removal read throws", async () => {
    host({ mediaKeys: [[32, 20]], ignoreRemove: true, failReadAfterRemove: true });
    await expect(tools.remove_keyframe_range.handler({ ...target, start_seconds: 0, end_seconds: 10 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("could not be read back"), data: { outcome: "committed_unverified", verified: false } });
  });
});

describe("set_keyframe_interpolation", () => {
  it("sets the measured code on the stored key and does not claim verification", async () => {
    const state = host({ mediaKeys: [[32, 20], [34, 80]] });
    await expect(tools.set_keyframe_interpolation.handler({ ...target, time_seconds: 2, interpolation: "hold" }))
      .resolves.toMatchObject({ success: true, data: { outcome: "committed_unverified", verified: false, time: 2 } });
    expect(state.interpolation).toEqual({ [Math.round(32 * TICKS)]: 4 });
  });

  it("refuses when no key is at that time, or for an unknown interpolation", async () => {
    const state = host({ mediaKeys: [[32, 20]] });
    await expect(tools.set_keyframe_interpolation.handler({ ...target, time_seconds: 1, interpolation: "linear" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No keyframe at 1s") });
    await expect(tools.set_keyframe_interpolation.handler({ ...target, time_seconds: 2, interpolation: "toString" }))
      .resolves.toMatchObject({ success: false, error: "interpolation must be linear, hold or bezier." });
    expect(state.interpolation).toEqual({});
  });
});

describe("keyframe arguments are validated before a script is built", () => {
  it.each([
    ["add_keyframe", { time_seconds: Number.NaN, value: 1 }, "time_seconds must be a finite"],
    ["add_keyframe", { time_seconds: 1, value: Number.POSITIVE_INFINITY }, "value must be a finite number."],
    ["add_keyframe", { time_seconds: -1, value: 1 }, "time_seconds must be a finite"],
    ["remove_keyframe", { time_seconds: "2" }, "time_seconds must be a finite"],
    ["remove_keyframe_range", { start_seconds: 0, end_seconds: Number.NaN }, "end_seconds must be a finite"],
    ["set_keyframe_interpolation", { time_seconds: Number.NaN, interpolation: "linear" }, "time_seconds must be a finite"],
    ["get_value_at_time", { time_seconds: Number.NEGATIVE_INFINITY }, "time_seconds must be a finite"],
  ] as const)("%s refuses %j", async (tool, extra, message) => {
    const handler = (tools as unknown as Record<string, { handler: (args: unknown) => Promise<unknown> }>)[tool].handler;
    await expect(handler({ ...target, ...extra })).resolves.toMatchObject({ success: false, error: expect.stringContaining(message) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
