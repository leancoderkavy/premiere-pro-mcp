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

function makeItem(state: ItemState) {
  return {
    state,
    getProjectItem: vi.fn(async () => state.projectItemId === "nest-item" ? nestProjectItem : projectItem(state.projectItemId)),
    getStartTime: vi.fn(async () => ({ ticks: state.start })),
    getEndTime: vi.fn(async () => ({ ticks: state.end })),
    getInPoint: vi.fn(async () => ({ ticks: state.inPoint })),
    getOutPoint: vi.fn(async () => ({ ticks: state.outPoint })),
    getSpeed: vi.fn(async () => state.speed),
    isSpeedReversed: vi.fn(async () => false),
    getName: vi.fn(async () => state.name),
    isDisabled: vi.fn(async () => state.disabled),
  };
}
type Item = ReturnType<typeof makeItem>;

function projectItem(id: string) { return { getId: vi.fn(async () => id), isSequence: vi.fn(async () => false) }; }
let nestProjectItem: { getId: () => Promise<string>; isSequence: () => Promise<boolean>; getSequence: () => unknown };

function makeSequence(guid: string, video: Item[][], audio: Item[][]) {
  const tracks = { video, audio };
  const sorted = (items: Item[]) => [...items].sort((a, b) => Number(BigInt(a.state.start) - BigInt(b.state.start)));
  return {
    guid,
    tracks,
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
 * Parent "Segment": nest on V0 and A0 at 0-4 s, body after it. Nested "Hook":
 * camera on V0, a disabled second camera on V1, a mixdown on A0.
 */
function host(options: { nestAt?: number; trimNest?: boolean; occupy?: boolean; videoOnly?: boolean; dropAudioTrack?: boolean; readbackBreaks?: boolean } = {}) {
  counter = 0;
  const nested = makeSequence("seq-hook", [
    [item("video", "cam", 0, 2, 10, { name: "Camera.MXF" })],
    [item("video", "cam2", 2, 4, 20, { name: "Camera2.MXF", disabled: true })],
  ], [
    [item("audio", "mix", 0, 4, 10, { name: "Mixdown.wav" })],
  ]);
  nestProjectItem = { getId: vi.fn(async () => "nest-item"), isSequence: vi.fn(async () => true), getSequence: vi.fn(() => nested) };
  const at = options.nestAt ?? 0;
  const nestEnd = at + (options.trimNest ? 3 : 4);
  const parentVideo: Item[][] = [
    [item("video", "nest-item", at, nestEnd, 0, { name: "Hook" }), item("video", "cam", at + 4, at + 20, 50, { name: "Body" })],
    [],
  ];
  const parentAudio: Item[][] = [[item("audio", "mix", at + 4, at + 20, 50, { name: "Body" })]];
  if (!options.videoOnly) parentAudio[0].push(item("audio", "nest-item", at, nestEnd, 0, { name: "Hook" }));
  if (options.occupy) parentVideo[1].push(item("video", "logo", 3, 5, 0, { name: "Logo" }));
  if (options.dropAudioTrack) parentVideo.pop();
  const parent = makeSequence("seq-segment", parentVideo, parentAudio);
  const removeAction = vi.fn((selection: { items: Item[] }) => ({
    apply: () => {
      for (const list of [...parent.tracks.video, ...parent.tracks.audio]) {
        for (const target of selection.items) {
          const at = list.indexOf(target);
          if (at !== -1) list.splice(at, 1);
        }
      }
    },
  }));
  const cloneAction = vi.fn((source: Item, offset: { ticks: string }, videoOffset: number, audioOffset: number, alignToVideo: boolean, isInsert: boolean) => ({
    apply: () => {
      const kind: Kind = nested.tracks.video.some((list) => list.includes(source)) ? "video" : "audio";
      const sourceTrack = nested.tracks[kind].findIndex((list) => list.includes(source));
      const target = sourceTrack + (kind === "video" ? videoOffset : audioOffset);
      const shift = BigInt(offset.ticks);
      const copy = makeItem({ ...source.state, id: `clone-${++counter}`, start: String(BigInt(source.state.start) + shift), end: String(BigInt(source.state.end) + shift) });
      if (options.readbackBreaks) copy.state.inPoint = "0";
      parent.tracks[kind][target].push(copy);
      expect(alignToVideo).toBe(false);
      expect(isInsert).toBe(false);
    },
  }));
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => parent),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithTicks: vi.fn((ticks: string) => ({ ticks })), createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    SequenceEditor: { getEditor: vi.fn(() => ({ createCloneTrackItemAction: cloneAction, createRemoveItemsAction: removeAction })) },
    TrackItemSelection: {
      createEmptySelection: vi.fn((callback: (selection: unknown) => void) => {
        const selection = { items: [] as Item[], addItem: vi.fn((target: Item) => { selection.items.push(target); return true; }) };
        callback(selection);
        return true;
      }),
    },
    ClipProjectItem: { cast: vi.fn((value: unknown) => value) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: "video", AUDIO: "audio" } },
  };
  return { parent, nested, project, cloneAction, removeAction, addAction, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const nestCoordinates = { mediaType: "video", trackIndex: 0, clipIndex: 0 };

describe("clone-based UXP unnest", () => {
  it("plans a picture-and-sound nest as one pair with tick-exact clone placements", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    expect(plan).toMatchObject({
      projectGuid: "project-1", sequenceId: "seq-segment", nestedSequenceId: "seq-hook", nestedSequenceName: "Hook", offsetTicks: "0",
      references: [
        { mediaType: "video", trackIndex: 0, clipIndex: 0, startTicks: "0", endTicks: tick(4) },
        { mediaType: "audio", trackIndex: 0, clipIndex: 0, startTicks: "0", endTicks: tick(4) },
      ],
    });
    expect(plan.clones).toEqual([
      expect.objectContaining({ mediaType: "video", sourceTrackIndex: 0, targetTrackIndex: 0, name: "Camera.MXF", projectItemId: "cam", startTicks: "0", endTicks: tick(2), inTicks: tick(10), disabled: false }),
      expect.objectContaining({ mediaType: "video", sourceTrackIndex: 1, targetTrackIndex: 1, name: "Camera2.MXF", startTicks: tick(2), endTicks: tick(4), disabled: true }),
      expect.objectContaining({ mediaType: "audio", sourceTrackIndex: 0, targetTrackIndex: 0, name: "Mixdown.wav", startTicks: "0", endTicks: tick(4) }),
    ]);
    expect(value.cloneAction).not.toHaveBeenCalled();
  });

  it("shifts every clone by the nest's position in the parent", async () => {
    const value = host({ nestAt: 10 });
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    expect(plan.offsetTicks).toBe(tick(10));
    expect(plan.clones.map((placement: { startTicks: string }) => placement.startTicks)).toEqual([tick(10), tick(12), tick(10)]);
    await expect(value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "shifted" })).resolves.toMatchObject({ verified: true });
    expect(value.parent.tracks.video[1][0].state.start).toBe(tick(12));
  });

  it("finds the same pair from the audio half of the nest", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.unnest.inspect", { mediaType: "audio", trackIndex: 0, clipIndex: 0 });
    expect(plan.references).toHaveLength(2);
    expect(plan.clones).toHaveLength(3);
  });

  it("removes the nest and clones every clip in one transaction, then verifies the readback", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    const result = await value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "unnest-1" });
    expect(result).toMatchObject({ unnested: true, verified: true, outcome: "verified", clipsCloned: 3, referencesRemoved: 2, undoLabel: "Unnest Hook" });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.addAction).toHaveBeenCalledTimes(5);
    expect(value.removeAction).toHaveBeenCalledTimes(2);
    expect(value.cloneAction).toHaveBeenCalledTimes(3);
    const [videoTrack0, videoTrack1] = value.parent.tracks.video;
    expect(videoTrack0.map((entry) => entry.state.name).sort()).toEqual(["Body", "Camera.MXF"]);
    expect(videoTrack1[0].state).toMatchObject({ name: "Camera2.MXF", start: tick(2), disabled: true });
    expect(value.parent.tracks.audio[0].map((entry) => entry.state.name).sort()).toEqual(["Body", "Mixdown.wav"]);
    // Operation-ID replay does not clone again.
    await expect(value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "unnest-1" })).resolves.toMatchObject({ replayed: true });
    expect(value.cloneAction).toHaveBeenCalledTimes(3);
  });

  it("clones only the nested video when the nest was placed picture-only", async () => {
    const value = host({ videoOnly: true });
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    expect(plan.references).toHaveLength(1);
    expect(plan.clones.map((placement: { mediaType: string }) => placement.mediaType)).toEqual(["video", "video"]);
    await value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "unnest-video" });
    expect(value.parent.tracks.audio[0].map((entry) => entry.state.name)).toEqual(["Body"]);
  });

  it("rejects a plan that no longer matches before any action is created", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    value.nested.tracks.video[0][0].state.inPoint = tick(11);
    await expect(value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "stale" })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("requires confirmation and an operation ID", async () => {
    const value = host();
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    await expect(value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, operationId: "x" })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true })).rejects.toThrow();
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("refuses a trimmed nest", async () => {
    const value = host({ trimNest: true });
    await expect(value.registry.dispatch("sequence.unnest.inspect", nestCoordinates)).rejects.toThrow(/trimmed/);
  });

  it("refuses an occupied destination range", async () => {
    const value = host({ occupy: true });
    await expect(value.registry.dispatch("sequence.unnest.inspect", nestCoordinates)).rejects.toMatchObject({ code: "UXP_TARGET_OCCUPIED", message: expect.stringContaining("occupied by Logo") });
  });

  it("refuses a missing destination track", async () => {
    const value = host({ dropAudioTrack: true });
    await expect(value.registry.dispatch("sequence.unnest.inspect", nestCoordinates)).rejects.toThrow(/video track 1 does not exist/);
  });

  it("refuses two nest clips of one media type at the same position", async () => {
    const value = host();
    value.parent.tracks.video[1].push(item("video", "nest-item", 0, 4, 0, { name: "Hook" }));
    await expect(value.registry.dispatch("sequence.unnest.inspect", nestCoordinates)).rejects.toThrow(/More than one video clip/);
  });

  it("refuses a clip that is not a nested sequence", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.unnest.inspect", { mediaType: "video", trackIndex: 0, clipIndex: 1 })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
  });

  it("reports a committed transaction whose readback differs as committed_unverified", async () => {
    const value = host({ readbackBreaks: true });
    const plan = await value.registry.dispatch("sequence.unnest.inspect", nestCoordinates);
    const result = await value.registry.dispatch("sequence.unnest", { ...nestCoordinates, expectedSnapshot: plan, confirmUnnest: true, operationId: "broken" });
    expect(result).toMatchObject({ unnested: false, committed: true, verified: false, outcome: "committed_unverified" });
    expect(result.problems[0]).toContain("does not have its nested source range");
  });
});
