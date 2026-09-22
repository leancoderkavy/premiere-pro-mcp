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
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/issue-587", timeoutMs: 5000 };
const tools = getTrackTargetingTools(bridgeOptions);

type FakeTrack = {
  name: string;
  targeted: boolean;
  isTargeted: () => boolean;
  setTargeted: (value: boolean, broadcast: boolean) => void;
};

/** Premiere-like tracks: targeting is independent per track (not exclusive). */
function makeTracks(prefix: string, states: boolean[], opts: { ignoreSet?: number; throwRead?: number } = {}) {
  const tracks: Record<string | number, unknown> = { numTracks: states.length };
  states.forEach((state, i) => {
    const track: FakeTrack = {
      name: `${prefix}${i + 1}`,
      targeted: state,
      isTargeted() {
        if (opts.throwRead === i) throw new Error("unreadable");
        return this.targeted;
      },
      setTargeted(value: boolean) {
        if (opts.ignoreSet === i) return;
        this.targeted = value;
      },
    };
    tracks[i] = track;
  });
  return tracks as { numTracks: number; [i: number]: FakeTrack };
}

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return mockedSendCommand.mock.calls[0][0] as string;
}

function run(script: string, seq: unknown) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { activeSequence: seq } },
  })));
}

beforeEach(() => vi.clearAllMocks());

describe("issue #587 — track targeting matches Premiere's multi-target model", () => {
  it("does not claim Premiere enforces one targeted track per type", () => {
    expect(tools.set_target_track.description).not.toMatch(/only one video and one audio track/i);
    expect(tools.set_target_track.description).toMatch(/several tracks/i);
    expect(tools.set_target_track.parameters.properties.exclusive.description).toMatch(/default: true/);
    expect(tools.get_target_tracks.description).toMatch(/several/i);
  });

  it("exclusively targets one audio track and untargets the rest (default)", async () => {
    const audio = makeTracks("A", [true, true, true, true]);
    const seq = { videoTracks: makeTracks("V", [true]), audioTracks: audio };
    const script = await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 3, targeted: true });
    const result = run(script, seq);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      trackIndex: 3,
      exclusive: true,
      untargetedTracks: [0, 1, 2],
      targetedTracks: [3],
      verified: true,
      outcome: "verified",
    });
    expect([0, 1, 2, 3].map((i) => audio[i].targeted)).toEqual([false, false, false, true]);
    expect(seq.videoTracks[0].targeted).toBe(true);

    const readScript = await scriptFor(tools.get_target_tracks, {});
    const read = run(readScript, seq);
    expect(read.data.audio).toEqual([{ index: 3, name: "A4" }]);
    expect(read.data.video).toEqual([{ index: 0, name: "V1" }]);
  });

  it("keeps other tracks targeted when exclusive=false and reports them all", async () => {
    const audio = makeTracks("A", [true, false, false]);
    const script = await scriptFor(tools.set_target_track, {
      track_type: "audio", track_index: 2, targeted: true, exclusive: false,
    });
    const result = run(script, { videoTracks: makeTracks("V", []), audioTracks: audio });
    expect(result.data).toMatchObject({ exclusive: false, targetedTracks: [0, 2], outcome: "verified" });
  });

  it("untargeting never touches other tracks", async () => {
    const video = makeTracks("V", [true, true]);
    const script = await scriptFor(tools.set_target_track, { track_type: "video", track_index: 0, targeted: false });
    const result = run(script, { videoTracks: video, audioTracks: makeTracks("A", []) });
    expect(result.data).toMatchObject({ exclusive: false, targetedTracks: [1], outcome: "verified" });
    expect(video[1].targeted).toBe(true);
  });

  it("fails when readback shows the requested track did not change", async () => {
    const script = await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 1, targeted: true });
    const result = run(script, {
      videoTracks: makeTracks("V", []),
      audioTracks: makeTracks("A", [false, false], { ignoreSet: 1 }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Readback shows track 1 targeted=false/);
  });

  it("fails when another track stays targeted after exclusive targeting", async () => {
    const script = await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 0, targeted: true });
    const result = run(script, {
      videoTracks: makeTracks("V", []),
      audioTracks: makeTracks("A", [false, true], { ignoreSet: 1 }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/still targeted.*1/);
  });

  it("reports committed_unverified when a track state cannot be read back", async () => {
    const script = await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 0, targeted: true });
    const result = run(script, {
      videoTracks: makeTracks("V", []),
      audioTracks: makeTracks("A", [false, false], { throwRead: 1 }),
    });
    expect(result.data).toMatchObject({ verified: false, outcome: "committed_unverified", unreadableTracks: [1] });

    const readScript = await scriptFor(tools.get_target_tracks, {});
    const read = run(readScript, {
      videoTracks: makeTracks("V", [true]),
      audioTracks: makeTracks("A", [true, false], { throwRead: 1 }),
    });
    expect(read.data.unreadable).toEqual({ video: [], audio: [1] });
  });

  it("rejects out-of-range and invalid arguments", async () => {
    const script = await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 5, targeted: true });
    expect(run(script, { videoTracks: makeTracks("V", []), audioTracks: makeTracks("A", [true]) }).error)
      .toMatch(/out of range/);

    mockedSendCommand.mockClear();
    for (const args of [
      { track_type: "subtitle", track_index: 0, targeted: true },
      { track_type: "audio", track_index: -1, targeted: true },
      { track_type: "audio", track_index: 1.5, targeted: true },
      { track_type: "audio", track_index: 0, targeted: "yes" },
    ]) {
      await expect(tools.set_target_track.handler(args as never)).resolves.toMatchObject({ success: false });
    }
    await expect(tools.set_all_tracks_targeted.handler({ targeted: true, track_type: "x" } as never))
      .resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("set_all_tracks_targeted reads back every track", async () => {
    const seq = { videoTracks: makeTracks("V", [false, false]), audioTracks: makeTracks("A", [false, true]) };
    const ok = run(await scriptFor(tools.set_all_tracks_targeted, { targeted: true }), seq);
    expect(ok.data).toMatchObject({ tracksAffected: 4, outcome: "verified" });

    const audioOnly = run(await scriptFor(tools.set_all_tracks_targeted, { targeted: false, track_type: "audio" }), seq);
    expect(audioOnly.data).toMatchObject({ tracksAffected: 2, outcome: "verified" });
    expect(seq.videoTracks[0].targeted).toBe(true);

    const stuck = run(await scriptFor(tools.set_all_tracks_targeted, { targeted: false, track_type: "video" }), {
      videoTracks: makeTracks("V", [true, true], { ignoreSet: 1 }),
      audioTracks: makeTracks("A", []),
    });
    expect(stuck.success).toBe(false);
    expect(stuck.error).toMatch(/not untargeted: V1/);

    const unreadable = run(await scriptFor(tools.set_all_tracks_targeted, { targeted: true, track_type: "audio" }), {
      videoTracks: makeTracks("V", []),
      audioTracks: makeTracks("A", [false], { throwRead: 0 }),
    });
    expect(unreadable.data).toMatchObject({ outcome: "committed_unverified", unreadableTracks: ["A0"] });
  });

  it("emits ES3-only host code", async () => {
    for (const script of [
      await scriptFor(tools.set_target_track, { track_type: "audio", track_index: 0, targeted: true }),
      await scriptFor(tools.get_target_tracks, {}),
      await scriptFor(tools.set_all_tracks_targeted, { targeted: true }),
    ]) {
      expect(script).not.toMatch(/\b(let|const)\s|=>|`/);
    }
  });
});
