import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type State = { projectItemId: string; start: number; end: number; inPoint: number; outPoint: number; speed: number; reversed: boolean };
type HostOptions = { pauseFirstSnapshot?: boolean };

function rippleHost(options: HostOptions = {}) {
  const states: State[] = [
    { projectItemId: "target-1", start: 0, end: 10, inPoint: 20, outPoint: 30, speed: 1, reversed: false },
    { projectItemId: "following-1", start: 10, end: 20, inPoint: 40, outPoint: 50, speed: 1, reversed: false },
  ];
  let releaseFirstSnapshot: (() => void) | null = null;
  let firstSnapshotStarted: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => { firstSnapshotStarted = resolve; });
  const firstSnapshotRelease = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve; });
  let pauseFirstSnapshot = options.pauseFirstSnapshot === true;

  function itemFor(state: State) {
    return {
      getProjectItem: vi.fn(async () => ({ getId: vi.fn(async () => state.projectItemId) })),
      getStartTime: vi.fn(async () => ({ seconds: state.start })),
      getEndTime: vi.fn(async () => ({ seconds: state.end })),
      getInPoint: vi.fn(async () => {
        if (pauseFirstSnapshot) {
          pauseFirstSnapshot = false;
          firstSnapshotStarted?.();
          await firstSnapshotRelease;
        }
        return { seconds: state.inPoint };
      }),
      getOutPoint: vi.fn(async () => ({ seconds: state.outPoint })),
      getDuration: vi.fn(async () => ({ seconds: state.end - state.start })),
      getSpeed: vi.fn(async () => state.speed),
      isSpeedReversed: vi.fn(async () => state.reversed),
    };
  }

  const items = states.map(itemFor);
  const videoTrack = { getTrackItems: vi.fn(async () => items) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1), getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0), getAudioTrack: vi.fn(async () => null),
  };
  let selected: typeof items[number] | null = null;
  const createRemoveItemsAction = vi.fn((_selection: unknown, ripple: boolean, mediaType: number, shiftOverlapping: boolean) => ({
    apply: () => {
      if (!selected || !ripple || mediaType !== 1 || shiftOverlapping !== false) throw new Error("unexpected remove action");
      const index = items.indexOf(selected);
      if (index < 0) throw new Error("selected item was not on the track");
      const duration = states[index]!.end - states[index]!.start;
      states.splice(index, 1);
      items.splice(index, 1);
      for (let later = index; later < states.length; later += 1) {
        states[later]!.start -= duration;
        states[later]!.end -= duration;
      }
    },
  }));
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1", getActiveSequence: vi.fn(async () => sequence), lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    SequenceEditor: { getEditor: vi.fn(() => ({ createRemoveItemsAction })) },
    TrackItemSelection: { createEmptySelection: vi.fn((callback: (selection: { addItem: (item: typeof items[number], select: boolean) => boolean }) => void) => {
      callback({ addItem: (item) => { selected = item; return true; } });
      return true;
    }) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: 1, AUDIO: 2 } },
  };
  return {
    states, items, project, createRemoveItemsAction, firstSnapshot, releaseFirstSnapshot: () => releaseFirstSnapshot?.(),
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

const target = { projectItemId: "target-1", startSeconds: 0, endSeconds: 10, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false };
const following = { projectItemId: "following-1", startSeconds: 10, endSeconds: 20, inSeconds: 40, outSeconds: 50, durationSeconds: 10, speed: 1, reversed: false };
const expectedSnapshot = { projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0, trackItemCount: 2, target, following };
const targetCoordinates = { mediaType: "video", trackIndex: 0, clipIndex: 0 };

describe("guarded documented UXP contiguous track-item ripple delete workflow", () => {
  it("advertises bounded inspection and an idempotent undoable transaction command", async () => {
    const value = rippleHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "trackItem.rippleDelete.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
      "trackItem.rippleDelete": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("trackItem.rippleDelete.inspect", targetCoordinates)).resolves.toEqual(expectedSnapshot);
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("removes exactly one reviewed item in one ripple transaction and reads back only its successor coordinate", async () => {
    const value = rippleHost();
    await expect(value.registry.dispatch("trackItem.rippleDelete", {
      ...targetCoordinates, expectedSnapshot, confirmRippleDelete: true, operationId: "ripple-apply-1",
    })).resolves.toMatchObject({
      operationId: "ripple-apply-1", rippleDeleted: true, outcome: "verified", before: expectedSnapshot,
      after: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0,
        successorClipIndex: 0, trackItemCount: 1,
        successor: { ...following, startSeconds: 0, endSeconds: 10 },
      },
      verificationBoundary: "contiguous_successor_track_item_readback",
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Ripple delete timeline item");
    expect(value.createRemoveItemsAction).toHaveBeenCalledWith(expect.objectContaining({ addItem: expect.any(Function) }), true, 1, false);
    expect(value.states).toEqual([{ projectItemId: "following-1", start: 0, end: 10, inPoint: 40, outPoint: 50, speed: 1, reversed: false }]);
  });

  it("does not invoke unrelated earlier item getters during preflight or successor-only readback", async () => {
    const value = rippleHost();
    const unrelatedGetter = vi.fn(async () => { throw new Error("unrelated item must not be read"); });
    value.states.unshift({ projectItemId: "unrelated-1", start: 0, end: 5, inPoint: 0, outPoint: 5, speed: 1, reversed: false });
    value.items.unshift({
      getProjectItem: unrelatedGetter, getStartTime: unrelatedGetter, getEndTime: unrelatedGetter,
      getInPoint: unrelatedGetter, getOutPoint: unrelatedGetter, getDuration: unrelatedGetter,
      getSpeed: unrelatedGetter, isSpeedReversed: unrelatedGetter,
    });
    const reviewedTarget = { mediaType: "video", trackIndex: 0, clipIndex: 1 };
    const reviewedSnapshot = { ...expectedSnapshot, clipIndex: 1, trackItemCount: 3 };
    await expect(value.registry.dispatch("trackItem.rippleDelete", {
      ...reviewedTarget, expectedSnapshot: reviewedSnapshot, confirmRippleDelete: true, operationId: "bounded-readback",
    })).resolves.toMatchObject({ outcome: "verified", after: { trackItemCount: 2, successorClipIndex: 1 } });
    expect(unrelatedGetter).not.toHaveBeenCalled();
  });

  it("rejects missing authority, stale state, a final item, and a gap before action creation", async () => {
    const value = rippleHost();
    await expect(value.registry.dispatch("trackItem.rippleDelete", { ...targetCoordinates, expectedSnapshot, operationId: "missing-confirmation" })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("trackItem.rippleDelete", { ...targetCoordinates, expectedSnapshot, confirmRippleDelete: true })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("trackItem.rippleDelete", {
      ...targetCoordinates, expectedSnapshot: { ...expectedSnapshot, following: { ...following, outSeconds: 51 } }, confirmRippleDelete: true, operationId: "stale",
    })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    const gap = rippleHost();
    gap.states[1]!.start = 11;
    await expect(gap.registry.dispatch("trackItem.rippleDelete.inspect", targetCoordinates)).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    const finalItem = rippleHost();
    await expect(finalItem.registry.dispatch("trackItem.rippleDelete.inspect", { ...targetCoordinates, clipIndex: 1 })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays a completed operation ID without creating a second host transaction", async () => {
    const value = rippleHost();
    const args = { ...targetCoordinates, expectedSnapshot, confirmRippleDelete: true, operationId: "replay-ripple" };
    await expect(value.registry.dispatch("trackItem.rippleDelete", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("trackItem.rippleDelete", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.states).toHaveLength(1);
  });

  it("serializes distinct operation IDs so a stale reviewed ripple cannot remove the wrong successor", async () => {
    const value = rippleHost({ pauseFirstSnapshot: true });
    const first = value.registry.dispatch("trackItem.rippleDelete", { ...targetCoordinates, expectedSnapshot, confirmRippleDelete: true, operationId: "concurrent-first" });
    await value.firstSnapshot;
    const second = value.registry.dispatch("trackItem.rippleDelete", { ...targetCoordinates, expectedSnapshot, confirmRippleDelete: true, operationId: "concurrent-second" });
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    value.releaseFirstSnapshot();
    await expect(first).resolves.toMatchObject({ outcome: "verified" });
    await secondExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.states).toEqual([{ projectItemId: "following-1", start: 0, end: 10, inPoint: 40, outPoint: 50, speed: 1, reversed: false }]);
  });
});
