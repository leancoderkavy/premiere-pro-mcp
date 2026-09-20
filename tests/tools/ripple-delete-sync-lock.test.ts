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
import { getAdvancedTools } from "../../src/tools/advanced.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/ripple-sync-lock", timeoutMs: 5000 };
const TICKS = 254016000000;

async function scriptFor(args: Record<string, unknown>) {
  mockedSendCommand.mockClear();
  await getAdvancedTools(bridgeOptions).ripple_delete.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return String(mockedSendCommand.mock.calls[0][0]);
}

function secondsOf(ticks: string | number) {
  return parseFloat(String(ticks)) / TICKS;
}

function rangesOf(track: { clips: { numItems: number; [i: number]: { start: { ticks: string }; end: { ticks: string } } } }) {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < track.clips.numItems; i++) {
    ranges.push([
      Math.round(secondsOf(track.clips[i].start.ticks) * 100) / 100,
      Math.round(secondsOf(track.clips[i].end.ticks) * 100) / 100,
    ]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function makeClip(id: string, startSeconds: number, endSeconds: number) {
  let startT = Math.round(startSeconds * TICKS);
  let endT = Math.round(endSeconds * TICKS);
  const assign = (value: unknown) => {
    if (value && typeof value === "object" && "ticks" in (value as object)) {
      return parseFloat(String((value as { ticks: string }).ticks));
    }
    return parseFloat(String(value));
  };
  return {
    nodeId: id,
    name: id,
    get start() { return { ticks: String(startT) }; },
    set start(value: unknown) { startT = assign(value); },
    get end() { return { ticks: String(endT) }; },
    set end(value: unknown) { endT = assign(value); },
    remove() {},
  };
}

function makeTrack(clips: ReturnType<typeof makeClip>[], syncLocked = true, locked = false) {
  const arr = clips.slice();
  const clipsCol: { numItems: number; [i: number]: ReturnType<typeof makeClip> } = {
    get numItems() { return arr.length; },
  } as { numItems: number; [i: number]: ReturnType<typeof makeClip> };
  const reindex = () => {
    for (let i = 0; i < 64; i++) delete clipsCol[i];
    arr.forEach((clip, index) => { clipsCol[index] = clip; });
  };
  reindex();
  const track = {
    clips: clipsCol,
    isLocked() { return track._locked; },
    _arr: arr,
    _reindex: reindex,
    _syncLocked: syncLocked,
    _locked: locked,
  };
  for (const clip of arr) {
    (clip as unknown as { remove: () => void }).remove = () => {
      const index = arr.indexOf(clip);
      if (index >= 0) {
        arr.splice(index, 1);
        reindex();
      }
    };
  }
  return track;
}

function rippleHost(options: {
  throwSyncLockOnVideo?: number[];
  omitSyncLocked?: boolean;
  omitIsLocked?: boolean;
  lockedVideo?: number[];
} = {}) {
  const v1 = makeTrack([makeClip("v1-target", 0, 4), makeClip("v1-later", 4, 10)], true, false);
  const v2 = makeTrack([makeClip("v2-later", 4, 8)], true, (options.lockedVideo ?? []).includes(1));
  const a1 = makeTrack([makeClip("a1-later", 4, 10)], true, false);
  const videoTracks = {
    0: v1,
    1: v2,
    get numTracks() { return 2; },
  };
  const audioTracks = {
    0: a1,
    get numTracks() { return 1; },
  };
  const seq = {
    sequenceID: "seq-1",
    timebase: String(TICKS / 24),
    videoTracks,
    audioTracks,
  };

  function qeTrackFor(track: ReturnType<typeof makeTrack>, type: "video" | "audio", index: number) {
    const qeTrack: {
      isSyncLocked?: () => boolean;
      isLocked?: () => boolean;
    } = {};
    if (!options.omitSyncLocked) {
      qeTrack.isSyncLocked = () => {
        if (type === "video" && (options.throwSyncLockOnVideo ?? []).includes(index)) {
          throw new Error("QE track missing");
        }
        return track._syncLocked;
      };
    }
    if (!options.omitIsLocked) {
      qeTrack.isLocked = () => track._locked;
    }
    return qeTrack;
  }

  const sandbox: Record<string, unknown> = {
    app: {
      enableQE() {},
      project: { activeSequence: seq },
    },
    qe: {
      project: {
        getActiveSequence() {
          return {
            getVideoTrackAt(index: number) {
              return qeTrackFor([v1, v2][index], "video", index);
            },
            getAudioTrackAt(index: number) {
              return qeTrackFor([a1][index], "audio", index);
            },
          };
        },
      },
    },
  };
  return { sandbox, seq, v1, v2, a1 };
}

function runScript(script: string, sandbox: Record<string, unknown>) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, sandbox)));
}

beforeEach(() => vi.clearAllMocks());

describe("ripple_delete fail-closes when QE cannot report sync lock", () => {
  it("emits a null-sentinel sync-lock read instead of treating unread tracks as unlocked", async () => {
    const script = await scriptFor({ node_id: "v1-target" });
    expect(script).toContain("var slv = null;");
    expect(script).toContain("var sla = null;");
    expect(script).toContain("Could not read isSyncLocked() on video track");
    expect(script).toContain("Could not read isSyncLocked() on audio track");
    expect(script).toContain("Could not read isLocked()");
    expect(script).not.toMatch(/var slv = false;\s*try \{ slv = !!qeTrackFor\("video", ti\)\.isSyncLocked\(\); \} catch \(e1\) \{\}/);
  });

  it("leaves the timeline unchanged when a sync-locked neighbour cannot be probed", async () => {
    const script = await scriptFor({ node_id: "v1-target" });
    const { sandbox, v1, v2 } = rippleHost({ throwSyncLockOnVideo: [1] });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not read isSyncLocked\(\) on video track 1/);
    expect(rangesOf(v1)).toEqual([[0, 4], [4, 10]]);
    expect(rangesOf(v2)).toEqual([[4, 8]]);
  });

  it("leaves the timeline unchanged when QE omits isSyncLocked", async () => {
    const script = await scriptFor({ node_id: "v1-target" });
    const { sandbox, v1, v2 } = rippleHost({ omitSyncLocked: true });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not read isSyncLocked\(\)/);
    expect(rangesOf(v1)).toEqual([[0, 4], [4, 10]]);
    expect(rangesOf(v2)).toEqual([[4, 8]]);
  });

  it("leaves the timeline unchanged when lock state cannot be read", async () => {
    const script = await scriptFor({ node_id: "v1-target" });
    const { sandbox, seq, v1, v2 } = rippleHost({ omitIsLocked: true });
    delete (seq.videoTracks[0] as { isLocked?: () => boolean }).isLocked;
    delete (seq.videoTracks[1] as { isLocked?: () => boolean }).isLocked;
    delete (seq.audioTracks[0] as { isLocked?: () => boolean }).isLocked;
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not read isLocked\(\)/);
    expect(rangesOf(v1)).toEqual([[0, 4], [4, 10]]);
    expect(rangesOf(v2)).toEqual([[4, 8]]);
  });

  it("ripples every readable sync-locked neighbour when QE answers", async () => {
    const script = await scriptFor({ node_id: "v1-target" });
    const { sandbox, v1, v2, a1 } = rippleHost();
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { rippled: true, verified: true } });
    expect(rangesOf(v1)).toEqual([[0, 6]]);
    expect(rangesOf(v2)).toEqual([[0, 4]]);
    expect(rangesOf(a1)).toEqual([[0, 6]]);
  });

  it("own_track does not consult isSyncLocked", async () => {
    const script = await scriptFor({ node_id: "v1-target", scope: "own_track" });
    expect(script).not.toContain("isSyncLocked()");
    const { sandbox, v1, v2 } = rippleHost({ throwSyncLockOnVideo: [1] });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { rippled: true, verified: true, scope: "own_track" } });
    expect(rangesOf(v1)).toEqual([[0, 6]]);
    expect(rangesOf(v2)).toEqual([[4, 8]]);
  });
});
