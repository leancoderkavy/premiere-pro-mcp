import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type CloneHostOptions = { pauseFirstSnapshot?: boolean };

function cloneHost(options: CloneHostOptions = {}) {
  const states: Array<{ projectItemId: string; start: number; end: number; inPoint: number; outPoint: number; speed: number; reversed: boolean }> = [
    { projectItemId: "source-1", start: 0, end: 10, inPoint: 20, outPoint: 30, speed: 1, reversed: false },
  ];
  let releaseFirstSnapshot: (() => void) | null = null;
  let firstSnapshotStarted: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => { firstSnapshotStarted = resolve; });
  const firstSnapshotRelease = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve; });
  let waitForFirstSnapshot = options.pauseFirstSnapshot === true;

  function itemFor(state: typeof states[number]) {
    return {
      getProjectItem: vi.fn(async () => ({ getId: vi.fn(async () => state.projectItemId) })),
      getStartTime: vi.fn(async () => ({ seconds: state.start })),
      getEndTime: vi.fn(async () => ({ seconds: state.end })),
      getInPoint: vi.fn(async () => {
        if (waitForFirstSnapshot) {
          waitForFirstSnapshot = false;
          firstSnapshotStarted?.();
          await firstSnapshotRelease;
        }
        return { seconds: state.inPoint };
      }),
      getOutPoint: vi.fn(async () => ({ seconds: state.outPoint })),
      getDuration: vi.fn(async () => ({ seconds: state.end - state.start })),
      getSpeed: vi.fn(async () => state.speed),
      isSpeedReversed: vi.fn(async () => state.reversed),
      createSetInPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { state.inPoint = time.seconds; } })),
      createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { state.outPoint = time.seconds; } })),
    };
  }
  const items = states.map(itemFor);
  const videoTrack = { getTrackItems: vi.fn(async () => items) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1), getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0), getAudioTrack: vi.fn(async () => null),
  };
  const cloneAction = vi.fn((item: ReturnType<typeof itemFor>, offset: { seconds: number }, videoOffset: number, audioOffset: number, alignToVideo: boolean, isInsert: boolean) => ({
    apply: () => {
      const sourceIndex = items.indexOf(item);
      const source = states[sourceIndex]!;
      const copy = {
        projectItemId: source.projectItemId, start: source.start + offset.seconds, end: source.end + offset.seconds,
        inPoint: source.inPoint, outPoint: source.outPoint, speed: source.speed, reversed: source.reversed,
      };
      states.splice(sourceIndex + 1, 0, copy);
      items.splice(sourceIndex + 1, 0, itemFor(copy));
    },
  }));
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1", getActiveSequence: vi.fn(async () => sequence), lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) }, TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    SequenceEditor: { getEditor: vi.fn(() => ({ createCloneTrackItemAction: cloneAction })) }, Constants: { TrackItemType: { CLIP: 1 } },
  };
  return { states, items, cloneAction, project, firstSnapshot, releaseFirstSnapshot: () => releaseFirstSnapshot?.(), registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const source = { projectItemId: "source-1", startSeconds: 0, endSeconds: 10, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false };
const expectedSnapshot = { projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0, trackItemCount: 1, source };
const targetCoordinates = { mediaType: "video", trackIndex: 0, clipIndex: 0 };

describe("guarded documented UXP append-only track-item duplicate workflow", () => {
  it("advertises bounded inspection and an idempotent undoable transaction command", async () => {
    const value = cloneHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "trackItem.clone.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
      "trackItem.clone": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("trackItem.clone.inspect", targetCoordinates)).resolves.toEqual(expectedSnapshot);
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("appends one reviewed final item in one transaction and reads only the source plus deterministic new coordinate", async () => {
    const value = cloneHost();
    await expect(value.registry.dispatch("trackItem.clone", {
      ...targetCoordinates, expectedSnapshot, confirmDuplicate: true, operationId: "clone-apply-1",
    })).resolves.toMatchObject({
      operationId: "clone-apply-1", duplicated: true, outcome: "verified", before: expectedSnapshot,
      after: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0,
        sourceClipIndex: 0, duplicateClipIndex: 1, trackItemCount: 2, source,
        duplicate: { ...source, startSeconds: 10, endSeconds: 20 },
      },
      verificationBoundary: "source_and_appended_track_item_readback",
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Duplicate timeline item after source");
    expect(value.cloneAction).toHaveBeenCalledWith(value.items[0], { seconds: 10 }, 0, 0, false, true);
    expect(value.states).toEqual([
      { projectItemId: "source-1", start: 0, end: 10, inPoint: 20, outPoint: 30, speed: 1, reversed: false },
      { projectItemId: "source-1", start: 10, end: 20, inPoint: 20, outPoint: 30, speed: 1, reversed: false },
    ]);
  });

  it("rejects missing confirmation/replay, stale state, and non-final sources before action creation", async () => {
    const value = cloneHost();
    await expect(value.registry.dispatch("trackItem.clone", { ...targetCoordinates, expectedSnapshot, operationId: "missing-confirmation" })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("trackItem.clone", { ...targetCoordinates, expectedSnapshot, confirmDuplicate: true })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("trackItem.clone", {
      ...targetCoordinates, expectedSnapshot: { ...expectedSnapshot, source: { ...source, outSeconds: 31 } }, confirmDuplicate: true, operationId: "stale",
    })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    const nonFinal = cloneHost();
    nonFinal.states.push({ projectItemId: "later-1", start: 10, end: 20, inPoint: 0, outPoint: 10, speed: 1, reversed: false });
    nonFinal.items.push({ ...nonFinal.items[0], getProjectItem: vi.fn(async () => ({ getId: vi.fn(async () => "later-1") })) });
    await expect(nonFinal.registry.dispatch("trackItem.clone.inspect", targetCoordinates)).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays a completed operation ID without creating a second host transaction", async () => {
    const value = cloneHost();
    const args = { ...targetCoordinates, expectedSnapshot, confirmDuplicate: true, operationId: "replay-clone" };
    await expect(value.registry.dispatch("trackItem.clone", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("trackItem.clone", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.states).toHaveLength(2);
  });

  it("serializes different operation IDs so a stale reviewed final-item snapshot cannot create a second duplicate", async () => {
    const value = cloneHost({ pauseFirstSnapshot: true });
    const first = value.registry.dispatch("trackItem.clone", { ...targetCoordinates, expectedSnapshot, confirmDuplicate: true, operationId: "concurrent-first" });
    await value.firstSnapshot;
    const second = value.registry.dispatch("trackItem.clone", { ...targetCoordinates, expectedSnapshot, confirmDuplicate: true, operationId: "concurrent-second" });
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    value.releaseFirstSnapshot();
    await expect(first).resolves.toMatchObject({ outcome: "verified" });
    await secondExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.states).toHaveLength(2);
  });
});
