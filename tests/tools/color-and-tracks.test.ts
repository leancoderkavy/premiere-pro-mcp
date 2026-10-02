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
import { getTrackTools } from "../../src/tools/tracks.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridge = { tempDir: "/tmp/color-tracks", timeoutMs: 5000 } as BridgeOptions;
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

function run(context: Record<string, unknown>) {
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
}

/** A Tint clip whose colour parameter behaves like Premiere 25.2's. */
function tintHost(options: { rejects?: boolean } = {}) {
  let argb = [255, 20, 40, 160];
  // getValue() packs ARGB into 16-bit fields of a 64-bit integer; a JS double drops the low bits.
  const packed = () => Number((BigInt(argb[0]) << 56n) | (BigInt(argb[1]) << 40n) | (BigInt(argb[2]) << 24n) | (BigInt(argb[3]) << 8n) | 0xc8n);
  const color = {
    displayName: "Map Black To",
    getValue: packed,
    getValueAtTime: packed,
    getColorValue: () => [...argb],
    setColorValue: (a: number, r: number, g: number, b: number) => { if (!options.rejects) argb = [a, r, g, b]; },
    isTimeVarying: () => false,
    areKeyframesSupported: () => true,
  };
  const amount = { displayName: "Amount to Tint", getValue: () => 100, getValueAtTime: () => 100, isTimeVarying: () => false, areKeyframesSupported: () => true };
  const tint = { displayName: "Tint", matchName: "AE.ADBE Tint", properties: { numItems: 2, 0: color, 1: amount } };
  const clip = { nodeId: "c1", name: "Shot", start: { ticks: "0" }, end: { ticks: String(254016000000 * 10) }, inPoint: { ticks: "0" }, getSpeed: () => 1, isSpeedReversed: () => false, components: { numItems: 1, 0: tint } };
  const seq = { videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
  function Time(this: { seconds: number; ticks: string }) { this.seconds = 0; this.ticks = "0"; }
  run({ Time, app: { project: { activeSequence: seq, sequences: { numSequences: 1, 0: seq } } } });
}

describe("colour parameters", () => {
  it("reads a colour as ARGB instead of the packed integer (live: 18374708470575309000)", async () => {
    tintHost();
    const result = await getKeyframeTools(bridge).get_value_at_time.handler({ node_id: "c1", effect_name: "Tint", property_name: "Map Black To", time_seconds: 1 }) as Result;
    expect(result.data).toMatchObject({ value: [255, 20, 40, 160], valueType: "color_argb" });
  });

  it("set_color_value verifies the colour Premiere applied", async () => {
    tintHost();
    await expect(getAdvancedTools(bridge).set_color_value.handler({ node_id: "c1", component_name: "Tint", property_name: "Map Black To", alpha: 255, red: 250, green: 230, blue: 200 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, color: { red: 250, green: 230, blue: 200 } } });
    tintHost({ rejects: true });
    await expect(getAdvancedTools(bridge).set_color_value.handler({ node_id: "c1", component_name: "Tint", property_name: "Map Black To", alpha: 255, red: 250, green: 230, blue: 200 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("instead of") });
    await expect(getAdvancedTools(bridge).set_color_value.handler({ node_id: "c1", component_name: "Tint", property_name: "Map Black To", alpha: 255, red: 300, green: 0, blue: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("0 to 255") });
  });
});

describe("delete_track", () => {
  function trackHost(clipCounts: number[], options: { names?: string[]; qeOffByOne?: boolean; renumbers?: boolean } = {}) {
    const list = clipCounts.map((n, i) => {
      const clips: Record<string | number, unknown> = { numItems: n };
      for (let c = 0; c < n; c++) clips[c] = { nodeId: `t${i}c${c}` };
      return { name: options.names?.[i] ?? `Video ${i + 1}`, clips, isLocked: () => false, isMuted: () => false };
    });
    const videoTracks = new Proxy({}, { get: (_t, k) => (k === "numTracks" ? list.length : list[Number(k)]) });
    const qeSeq = {
      removeVideoTrack: (index: number) => {
        list.splice(options.qeOffByOne ? index + 1 : index, 1);
        // Premiere renumbers positional default names ("Video 3" becomes "Video 2");
        // custom names such as "Cam 4" keep their number.
        if (options.renumbers !== false) {
          list.forEach((track, i) => { track.name = track.name.replace(/^(Video|Vidéo) \d+$/, `$1 ${i + 1}`); });
        }
      },
    };
    run({ app: { enableQE: () => {}, project: { activeSequence: { videoTracks, audioTracks: { numTracks: 1 } } } }, qe: { project: { getActiveSequence: () => qeSeq } } });
    return list;
  }

  it("removes the track through QE and verifies the count (live: deleteVideoTrackAt is not a function)", async () => {
    const list = trackHost([5, 0, 0]);
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 2 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, remainingTracks: 2 } });
    expect(list.map((t) => t.name)).toEqual(["Video 1", "Video 2"]);
  });

  it("refuses a track with clips unless forced", async () => {
    const list = trackHost([5, 0]);
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("holds 5 clip(s)") });
    expect(list).toHaveLength(2);
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 0, force: true }))
      .resolves.toMatchObject({ success: true, data: { clipsRemoved: 5 } });
  });

  it("fails, saying the timeline changed, when Premiere removes a different track", async () => {
    const list = trackHost([0, 2, 0], { qeOffByOne: true });
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timeline changed"), data: { removedTrackIndex: 1 } });
    expect(list).toHaveLength(2);
  });

  it("tells empty tracks apart by their custom names", async () => {
    trackHost([0, 0, 0], { names: ["Graphics", "B-roll", "Titles"], qeOffByOne: true });
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 0 }))
      .resolves.toMatchObject({ success: false, data: { removedTrackIndex: 1 } });
  });

  it("ignores default names in any host language, since they follow the track's position", async () => {
    trackHost([1, 0, 2], { names: ["Vidéo 1", "Vidéo 2", "Vidéo 3"] });
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 1 }))
      .resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it.each([
    ["a custom name ending in its own number moves down (Cam 4 on V4, delete V2)", [0, 0, 0, 0], ["Video 1", "Video 2", "Video 3", "Cam 4"], 1, true],
    ["a custom name ending in a lower number moves down (Take 2 on V3, delete V1)", [0, 0, 0], ["Video 1", "Video 2", "Take 2"], 0, true],
    ["a host that does not renumber default names", [0, 0, 0, 0], ["Video 1", "Video 2", "Video 3", "Video 4"], 1, false],
  ] as const)("reports a correct delete as verified when %s", async (_case, counts, names, index, renumbers) => {
    trackHost([...counts], { names: [...names], renumbers });
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: index }))
      .resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("still catches the wrong track being removed when names are custom and numbered", async () => {
    trackHost([0, 0, 0], { names: ["Video 1", "Cam A", "Cam 7"], qeOffByOne: true });
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 0 }))
      .resolves.toMatchObject({ success: false, data: { removedTrackIndex: 1 } });
  });

  it("ignores default names, which follow the track's position", async () => {
    trackHost([1, 0, 2]);
    await expect(getTrackTools(bridge).delete_track.handler({ track_type: "video", track_index: 1 }))
      .resolves.toMatchObject({ success: true, data: { verified: true } });
  });
});
