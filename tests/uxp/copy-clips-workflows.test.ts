import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

const T = 254016000000n;
const tick = (seconds: number) => String(BigInt(Math.round(seconds * 1000)) * T / 1000n);

type ItemState = { id: string; projectItemId: string; name: string; start: string; end: string; inPoint: string; outPoint: string; disabled: boolean; speed: number };
type Kind = "video" | "audio";

let counter = 0;

function makeItem(state: ItemState, options: { brokenTrim?: boolean } = {}) {
  const shiftBy = (field: "start" | "end" | "inPoint" | "outPoint", ticks: bigint) => { state[field] = String(BigInt(state[field]) + ticks); };
  return {
    state,
    getProjectItem: vi.fn(async () => ({ getId: vi.fn(async () => state.projectItemId) })),
    getStartTime: vi.fn(async () => ({ ticks: state.start })),
    getEndTime: vi.fn(async () => ({ ticks: state.end })),
    getInPoint: vi.fn(async () => ({ ticks: state.inPoint })),
    getOutPoint: vi.fn(async () => ({ ticks: state.outPoint })),
    getSpeed: vi.fn(async () => state.speed),
    isSpeedReversed: vi.fn(async () => false),
    getName: vi.fn(async () => state.name),
    isDisabled: vi.fn(async () => state.disabled),
    // Premiere 26.0.2 (measured live): every one of these is an edge trim
    // that moves the timeline edge and the matching source point together,
    // by the difference measured when the action is created. Two of them on
    // one edge in one transaction therefore trim that edge twice.
    createSetInPointAction: vi.fn((time: { ticks: string }) => { const d = BigInt(time.ticks) - BigInt(state.inPoint); return { apply: () => { shiftBy("inPoint", d); shiftBy("start", d); } }; }),
    createSetOutPointAction: vi.fn((time: { ticks: string }) => { const d = BigInt(time.ticks) - BigInt(state.outPoint); return { apply: () => { shiftBy("outPoint", d); shiftBy("end", d); } }; }),
    createSetStartAction: vi.fn((time: { ticks: string }) => { const d = BigInt(time.ticks) - BigInt(state.start); return { apply: () => { if (options.brokenTrim) return; shiftBy("start", d); shiftBy("inPoint", d); } }; }),
    createSetEndAction: vi.fn((time: { ticks: string }) => { const d = BigInt(time.ticks) - BigInt(state.end); return { apply: () => { shiftBy("end", d); shiftBy("outPoint", d); } }; }),
    createMoveAction: vi.fn((time: { ticks: string }) => ({ apply: () => { shiftBy("start", BigInt(time.ticks)); shiftBy("end", BigInt(time.ticks)); } })),
  };
}
type Item = ReturnType<typeof makeItem>;

function makeSequence(guid: string, name: string, video: Item[][], audio: Item[][]) {
  const tracks = { video, audio };
  const sorted = (items: Item[]) => [...items].sort((a, b) => Number(BigInt(a.state.start) - BigInt(b.state.start)));
  return {
    guid,
    name,
    tracks,
    getName: vi.fn(async () => name),
    getTimebase: vi.fn(async () => "254016000"),
    getVideoTrackCount: vi.fn(async () => video.length),
    getAudioTrackCount: vi.fn(async () => audio.length),
    getVideoTrack: vi.fn(async (index: number) => video[index] ? { getTrackItems: vi.fn(async () => sorted(video[index])) } : null),
    getAudioTrack: vi.fn(async (index: number) => audio[index] ? { getTrackItems: vi.fn(async () => sorted(audio[index])) } : null),
  };
}
type Seq = ReturnType<typeof makeSequence>;

function item(kind: Kind, projectItemId: string, start: number, end: number, inPoint: number, options: Partial<ItemState> = {}) {
  return makeItem({
    id: `${kind}-${++counter}`, projectItemId, name: options.name ?? projectItemId, start: tick(start), end: tick(end),
    inPoint: tick(inPoint), outPoint: tick(inPoint + end - start), disabled: false, speed: 1, ...options,
  });
}

/**
 * Source "Backup": host camera whole on V0 (0-100 s), a guest camera cut in
 * two on V1 (0-40, 40-100, the second disabled), b-roll on V2 at 30-35, mixdown
 * on A0 (0-100). Destination "Segment": a body clip on V0 at 20-30 s.
 */
function host(options: { brokenTrim?: boolean; readbackBreaks?: boolean } = {}) {
  counter = 0;
  const source = makeSequence("seq-backup", "Backup", [
    [item("video", "host", 0, 100, 1000, { name: "Host.MXF" })],
    [item("video", "guest", 0, 40, 2000, { name: "Guest A" }), item("video", "guest", 40, 100, 2040, { name: "Guest B", disabled: true })],
    [item("video", "broll", 30, 35, 5, { name: "Broll.mp4" })],
  ], [
    [item("audio", "mix", 0, 100, 3000, { name: "Mixdown.wav" })],
  ]);
  const destination = makeSequence("seq-segment", "Segment", [
    [item("video", "body", 20, 30, 0, { name: "Body" })], [], [],
  ], [[]]);
  const sequences: Seq[] = [source, destination];
  const findTrack = (sequence: Seq, target: Item) => {
    for (const kind of ["video", "audio"] as Kind[]) {
      const index = sequence.tracks[kind].findIndex((list) => list.includes(target));
      if (index !== -1) return { kind, index };
    }
    return null;
  };
  const cloneAction = vi.fn((sourceItem: Item, offset: { ticks: string }, videoOffset: number, audioOffset: number, alignToVideo: boolean, isInsert: boolean) => ({
    apply: () => {
      const found = sequences.map((sequence) => findTrack(sequence, sourceItem)).find(Boolean);
      if (!found) throw new Error("clone source not found");
      const shift = BigInt(offset.ticks);
      const copy = makeItem({ ...sourceItem.state, id: `clone-${++counter}`, start: String(BigInt(sourceItem.state.start) + shift), end: String(BigInt(sourceItem.state.end) + shift) }, options);
      if (options.readbackBreaks) copy.state.disabled = !copy.state.disabled;
      destination.tracks[found.kind][found.index + (found.kind === "video" ? videoOffset : audioOffset)].push(copy);
      expect(alignToVideo).toBe(false);
      expect(isInsert).toBe(false);
    },
  }));
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1",
    getSequences: vi.fn(async () => sequences),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithTicks: vi.fn((ticks: string) => ({ ticks })), createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    SequenceEditor: { getEditor: vi.fn((sequence: Seq) => {
      expect(sequence).toBe(destination);
      return { createCloneTrackItemAction: cloneAction };
    }) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: "video", AUDIO: "audio" } },
  };
  return { source, destination, project, cloneAction, addAction, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  sourceSequenceId: "seq-backup", destinationSequenceId: "seq-segment",
  sourceStartTicks: tick(30), sourceEndTicks: tick(35), destinationStartTicks: tick(0), ...overrides,
});
const names = (list: Item[]) => [...list].sort((a, b) => Number(BigInt(a.state.start) - BigInt(b.state.start))).map((entry) => entry.state.name);

describe("UXP copy clips between sequences", () => {
  it("plans every clip in the range with its trim and tick-exact destination", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", request());
    expect(plan).toMatchObject({ projectGuid: "project-1", sourceSequenceName: "Backup", destinationSequenceName: "Segment" });
    expect(plan.clips).toEqual([
      expect.objectContaining({ mediaType: "video", sourceTrackIndex: 0, targetTrackIndex: 0, name: "Host.MXF", startTicks: "0", endTicks: tick(5), inTicks: tick(1030), outTicks: tick(1035), trimHeadTicks: tick(30), trimTailTicks: tick(65) }),
      expect.objectContaining({ mediaType: "video", sourceTrackIndex: 1, name: "Guest A", startTicks: "0", endTicks: tick(5), inTicks: tick(2030), trimTailTicks: tick(5) }),
      expect.objectContaining({ mediaType: "video", sourceTrackIndex: 2, name: "Broll.mp4", startTicks: "0", endTicks: tick(5), inTicks: tick(5), trimHeadTicks: "0", trimTailTicks: "0" }),
      expect.objectContaining({ mediaType: "audio", sourceTrackIndex: 0, name: "Mixdown.wav", inTicks: tick(3030), outTicks: tick(3035) }),
    ]);
    expect(value.cloneAction).not.toHaveBeenCalled();
  });

  it("clones a range that holds only whole clips in one transaction", async () => {
    const value = host();
    const args = request({ videoTracks: [2], audioTracks: [], destinationStartTicks: tick(40) });
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    const result = await value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "whole" });
    expect(result).toMatchObject({ copied: true, verified: true, clipsCopied: 1, clipsTrimmed: 0, undoSteps: 1 });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.destination.tracks.video[2][0].state).toMatchObject({ name: "Broll.mp4", start: tick(40), end: tick(45), inPoint: tick(5) });
  });

  it("trims clips that cross the range edges at a parking spot and moves them into place", async () => {
    const value = host();
    const args = request({ sourceStartTicks: tick(35), sourceEndTicks: tick(45), destinationStartTicks: tick(5) });
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    const result = await value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "trimmed" });
    expect(result).toMatchObject({ copied: true, verified: true, clipsCopied: 4, clipsTrimmed: 4, undoSteps: 3 });
    const [v0, v1] = value.destination.tracks.video;
    expect(names(v0)).toEqual(["Host.MXF", "Body"]);
    expect(v0.find((entry) => entry.state.name === "Host.MXF")?.state).toMatchObject({ start: tick(5), end: tick(15), inPoint: tick(1035), outPoint: tick(1045) });
    expect(names(v1)).toEqual(["Guest A", "Guest B"]);
    expect(v1[0].state).toMatchObject({ start: tick(5), end: tick(10), inPoint: tick(2035), outPoint: tick(2040), disabled: false });
    expect(v1[1].state).toMatchObject({ start: tick(10), end: tick(15), inPoint: tick(2040), outPoint: tick(2045), disabled: true });
    expect(value.destination.tracks.audio[0][0].state).toMatchObject({ start: tick(5), end: tick(15), inPoint: tick(3035) });
    await expect(value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "trimmed" })).resolves.toMatchObject({ replayed: true });
    expect(value.cloneAction).toHaveBeenCalledTimes(4);
  });

  it("moves clips to other tracks with a track offset", async () => {
    const value = host();
    value.destination.tracks.audio.push([]);
    const args = request({ videoTracks: [0], audioTracks: [0], videoTrackOffset: 2, audioTrackOffset: 1, destinationStartTicks: tick(60) });
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    expect(plan.clips.map((placement: { targetTrackIndex: number }) => placement.targetTrackIndex)).toEqual([2, 1]);
    await value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "offset" });
    expect(value.destination.tracks.video[2][0].state).toMatchObject({ name: "Host.MXF", start: tick(60) });
    expect(value.destination.tracks.audio[1][0].state).toMatchObject({ name: "Mixdown.wav", start: tick(60) });
  });

  it("copies within the same sequence", async () => {
    const value = host();
    const args = request({ destinationSequenceId: "seq-backup", videoTracks: [2], audioTracks: [], destinationStartTicks: tick(50) });
    value.cloneAction.mockClear();
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    expect(plan.destinationSequenceName).toBe("Backup");
  });

  it("snaps times given in seconds to the sequence frame", async () => {
    const value = host();
    const frame = 10594584000n;
    for (const sequence of [value.source, value.destination]) sequence.getTimebase.mockResolvedValue(String(frame));
    value.source.tracks.video[0][0].state.end = String(frame * 3000n);
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", {
      sourceSequenceId: "seq-backup", destinationSequenceId: "seq-segment", videoTracks: [0], audioTracks: [],
      sourceStartSeconds: 50.0004, sourceEndSeconds: 52.02, destinationStartSeconds: 40,
    });
    for (const key of ["sourceStartTicks", "sourceEndTicks", "destinationStartTicks"]) expect(BigInt(plan[key]) % frame).toBe(0n);
    expect(plan.sourceStartTicks).toBe(String(1199n * frame));
    expect(plan.clips[0].startTicks).toBe(plan.destinationStartTicks);
    await expect(value.registry.dispatch("sequence.copyClips.inspect", { ...request(), sourceStartSeconds: 1 })).rejects.toThrow(/exactly one of sourceStartTicks/);
  });

  it("refuses sequences with different frame rates and times off the frame grid", async () => {
    const value = host();
    value.destination.getTimebase.mockResolvedValue("10160640000");
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request())).rejects.toThrow(/different frame rates/);
    const other = host();
    await expect(other.registry.dispatch("sequence.copyClips.inspect", request({ destinationStartTicks: "1" }))).rejects.toThrow(/not on a frame boundary/);
  });

  it("refuses an occupied destination", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request({ destinationStartTicks: tick(25) })))
      .rejects.toMatchObject({ code: "UXP_TARGET_OCCUPIED", message: expect.stringContaining("occupied by Body") });
  });

  it("refuses a missing destination track", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request({ videoTrackOffset: 1 }))).rejects.toThrow(/video track 3 does not exist/);
  });

  it("refuses an unknown sequence, an empty range and a retimed clip on the edge", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request({ sourceSequenceId: "nope" }))).rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request({ videoTracks: [2], audioTracks: [], sourceStartTicks: tick(50), sourceEndTicks: tick(60) }))).rejects.toThrow(/No clips/);
    value.source.tracks.video[0][0].state.speed = 2;
    await expect(value.registry.dispatch("sequence.copyClips.inspect", request())).rejects.toThrow(/Host.MXF crosses the edge/);
  });

  it("requires confirmation and an operation ID", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", request());
    await expect(value.registry.dispatch("sequence.copyClips", { ...request(), expectedSnapshot: plan, operationId: "x" })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("sequence.copyClips", { ...request(), expectedSnapshot: plan, confirmCopy: true })).rejects.toThrow();
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("rejects a stale plan before any action", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", request());
    value.source.tracks.video[2][0].state.inPoint = tick(6);
    await expect(value.registry.dispatch("sequence.copyClips", { ...request(), expectedSnapshot: plan, confirmCopy: true, operationId: "stale" })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("reports a readback mismatch as committed_unverified with the undo count", async () => {
    const value = host({ readbackBreaks: true });
    const args = request({ videoTracks: [2], audioTracks: [] });
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    const result = await value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "broken" });
    expect(result).toMatchObject({ copied: false, committed: true, outcome: "committed_unverified", undoSteps: 1 });
    expect(result.problems[0]).toContain("changed enabled state");
  });

  it("reports a trim that does not land as committed_unverified", async () => {
    const value = host({ brokenTrim: true });
    const args = request({ videoTracks: [0], audioTracks: [] });
    const plan = await value.registry.dispatch("sequence.copyClips.inspect", args);
    const result = await value.registry.dispatch("sequence.copyClips", { ...args, expectedSnapshot: plan, confirmCopy: true, operationId: "trim-broken" });
    expect(result).toMatchObject({ copied: false, committed: true, outcome: "committed_unverified" });
  });
});
