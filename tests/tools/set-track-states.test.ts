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

const mockedSendCommand = vi.mocked(sendCommand);
const bridge = { tempDir: "/tmp/set-track-states", timeoutMs: 5000 } as BridgeOptions;
const tools = getTrackTools(bridge);
type Result = { success: boolean; error?: string; data?: Record<string, any> };

beforeEach(() => vi.clearAllMocks());

type HostTrack = {
  name: string;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  writes: string[];
  isMuted: () => unknown;
  setMute: (v: number) => void;
  isLocked: () => unknown;
  setLocked: (v: number) => void;
};

/** A sequence with the given track counts; solo lives on the QE track when `qeSolo` is set. */
function host(options: { video?: number; audio?: number; qeSolo?: boolean; mutePersists?: boolean; lockReadback?: unknown } = {}) {
  const make = (prefix: string, count: number) => {
    const list: Record<string | number, unknown> & { numTracks: number } = { numTracks: count };
    const tracks: HostTrack[] = [];
    for (let i = 0; i < count; i++) {
      const track: HostTrack = {
        name: `${prefix} ${i + 1}`,
        muted: false,
        locked: false,
        solo: false,
        writes: [],
        isMuted() { return this.muted; },
        setMute(v: number) { this.writes.push(`mute:${v}`); if (options.mutePersists !== false) this.muted = v === 1; },
        isLocked() { return options.lockReadback !== undefined && this.writes.some(w => w.startsWith("lock")) ? options.lockReadback : this.locked; },
        setLocked(v: number) { this.writes.push(`lock:${v}`); this.locked = v === 1; },
      };
      tracks.push(track);
      list[i] = track;
    }
    return { list, tracks };
  };
  const video = make("Video", options.video ?? 1);
  const audio = make("Audio", options.audio ?? 3);
  const qeTrack = (track: HostTrack) => options.qeSolo
    ? { isSolo: () => track.solo, setSolo: (v: number) => { track.writes.push(`solo:${v}`); track.solo = v === 1; } }
    : { name: track.name };
  const qeSeq = {
    getVideoTrackAt: (i: number) => qeTrack(video.tracks[i]),
    getAudioTrackAt: (i: number) => qeTrack(audio.tracks[i]),
  };
  const seq = { videoTracks: video.list, audioTracks: audio.list };
  const context = {
    app: { project: { activeSequence: seq }, enableQE: () => undefined },
    qe: { project: { getActiveSequence: () => qeSeq } },
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return { video: video.tracks, audio: audio.tracks };
}

describe("set_track_states", () => {
  it("validates the request locally before any host call", async () => {
    for (const bad of [
      {},
      { tracks: [] },
      { tracks: [{ type: "caption", index: 0 }] },
      { tracks: [{ type: "audio", index: -1 }] },
      { tracks: [{ type: "audio", index: 0.5 }] },
      { tracks: [{ type: "audio", index: 0, muted: "yes" }] },
      { tracks: [{ type: "audio", index: 0 }, { type: "audio", index: 0, muted: true }] },
      { tracks: [{ type: "audio", index: 0 }], snapshot: "true" },
    ]) {
      const result = await (tools.set_track_states.handler as any)(bad) as Result;
      expect(result.success).toBe(false);
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("mutes several tracks in one command and reads every state back", async () => {
    const h = host({ audio: 3 });
    const result = await (tools.set_track_states.handler as any)({
      tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 1, muted: true }, { type: "audio", index: 2, muted: false }],
    }) as Result;
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", timelineChanged: true, trackCount: 3, writes: 2, changed: 2 } });
    expect(result.data!.tracks[0]).toMatchObject({ trackType: "audio", trackIndex: 0, trackName: "Audio 1", before: { muted: false }, after: { muted: true }, verified: true });
    expect(result.data!.tracks[2]).toMatchObject({ after: { muted: false } });
    expect(h.audio.map(t => t.muted)).toEqual([true, true, false]);
    // Already-matching states are not rewritten.
    expect(h.audio[2].writes).toEqual([]);
    expect(result.data!.restore).toBeUndefined();
  });

  it("snapshot returns a restore payload the tool accepts unchanged", async () => {
    const h = host({ video: 2, audio: 2 });
    h.audio[1].locked = true;
    const first = await (tools.set_track_states.handler as any)({
      snapshot: true,
      tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 1, locked: false, muted: true }, { type: "video", index: 1, muted: true }],
    }) as Result;
    expect(first.success).toBe(true);
    expect(first.data!.restore).toEqual({
      tracks: [
        { type: "audio", index: 0, muted: false, locked: false },
        { type: "audio", index: 1, muted: false, locked: true },
        { type: "video", index: 1, muted: false, locked: false },
      ],
    });
    expect(h.audio[1].locked).toBe(false);
    expect(h.video[1].muted).toBe(true);

    const back = await (tools.set_track_states.handler as any)(first.data!.restore) as Result;
    expect(back).toMatchObject({ success: true, data: { verified: true, timelineChanged: true } });
    expect(h.audio.map(t => [t.muted, t.locked])).toEqual([[false, false], [false, true]]);
    expect(h.video[1].muted).toBe(false);
  });

  it("snapshot with no state fields is a read-only capture", async () => {
    const h = host({ audio: 2 });
    h.audio[0].muted = true;
    const result = await (tools.set_track_states.handler as any)({ snapshot: true, tracks: [{ type: "audio", index: 0 }, { type: "audio", index: 1 }] }) as Result;
    expect(result).toMatchObject({ success: true, data: { writes: 0, changed: 0, timelineChanged: false, restore: { tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 1, muted: false }] } } });
    expect(h.audio.flatMap(t => t.writes)).toEqual([]);
  });

  it("refuses the whole request before mutation when one target is out of range", async () => {
    const h = host({ audio: 2 });
    const result = await (tools.set_track_states.handler as any)({ tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 5, muted: true }] }) as Result;
    expect(result).toMatchObject({ success: false, data: { code: "TRACK_OUT_OF_RANGE", trackIndex: 5, applied: false, outcome: "not_applied", mutationOutcome: "not_applied" } });
    expect(result.error).toContain("out of range");
    expect(h.audio[0].muted).toBe(false);
  });

  it("refuses solo before mutation when the host exposes no solo API, and reports support", async () => {
    const h = host({ audio: 2 });
    const result = await (tools.set_track_states.handler as any)({ tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 1, solo: true }] }) as Result;
    expect(result).toMatchObject({ success: false, data: { code: "TRACK_STATE_UNSUPPORTED", field: "solo", trackIndex: 1, applied: false, outcome: "not_applied", mutationOutcome: "not_applied", support: { muted: true, solo: false, locked: true } } });
    expect(h.audio[0].muted).toBe(false);
    expect(h.audio[1].writes).toEqual([]);
  });

  it("sets and reads solo back through the QE track when it is exposed there", async () => {
    const h = host({ audio: 3, qeSolo: true });
    const result = await (tools.set_track_states.handler as any)({ snapshot: true, tracks: [{ type: "audio", index: 1, solo: true }, { type: "audio", index: 2, solo: false }] }) as Result;
    expect(result).toMatchObject({ success: true, data: { verified: true, writes: 1 } });
    expect(result.data!.tracks[0]).toMatchObject({ before: { solo: false }, after: { solo: true } });
    expect(result.data!.restore.tracks[0]).toEqual({ type: "audio", index: 1, muted: false, solo: false, locked: false });
    expect(h.audio[1].writes).toEqual(["solo:1"]);
  });

  it("reports not_applied when Premiere ignores the write", async () => {
    host({ audio: 1, mutePersists: false });
    const result = await (tools.set_track_states.handler as any)({ tracks: [{ type: "audio", index: 0, muted: true }] }) as Result;
    expect(result).toMatchObject({ success: false, data: { outcome: "not_applied", verified: false, timelineChanged: false } });
    expect(result.data!.tracks[0]).toMatchObject({ verified: false, after: { muted: false } });
  });

  it("reports committed_unverified when a readback is not boolean after a write", async () => {
    host({ audio: 1, lockReadback: "locked" });
    const result = await (tools.set_track_states.handler as any)({ tracks: [{ type: "audio", index: 0, locked: true, muted: true }] }) as Result;
    expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: true } });
    expect(result.data!.tracks[0].after).toEqual({ muted: true, solo: null, locked: null });
  });

  it("reports committed_unverified when one of several writes does not land", async () => {
    const h = host({ audio: 2 });
    h.audio[1].setMute = function () { this.writes.push("mute:ignored"); };
    const result = await (tools.set_track_states.handler as any)({ tracks: [{ type: "audio", index: 0, muted: true }, { type: "audio", index: 1, muted: true }] }) as Result;
    expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, changed: 1, timelineChanged: true } });
    expect(result.data!.tracks.map((t: any) => t.verified)).toEqual([true, false]);
  });
});

describe("set_track_states authority", () => {
  it("needs edit authority to write and only inspect for a snapshot without state fields", async () => {
    const { capabilitiesForToolInvocation } = await import("../../src/security/capabilities.js");
    expect(capabilitiesForToolInvocation("set_track_states", { tracks: [{ type: "audio", index: 0, muted: true }] })).toEqual(["edit"]);
    expect(capabilitiesForToolInvocation("set_track_states", { snapshot: true, tracks: [{ type: "audio", index: 0, muted: true }] })).toEqual(["edit"]);
    expect(capabilitiesForToolInvocation("set_track_states", { snapshot: true, tracks: [{ type: "audio", index: 0 }, { type: "video", index: 1 }] })).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("set_track_states", { snapshot: true, tracks: [] })).toEqual(["edit"]);
  });
});
