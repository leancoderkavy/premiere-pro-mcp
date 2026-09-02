import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type SlideHostOptions = { pauseFirstSnapshot?: boolean };

function slideHost(options: SlideHostOptions = {}) {
  const state = {
    previous: { start: 0, end: 10, inPoint: 0, outPoint: 10 },
    target: { start: 10, end: 20, inPoint: 20, outPoint: 30 },
    following: { start: 20, end: 30, inPoint: 30, outPoint: 40 },
  };
  let releaseFirstSnapshot: (() => void) | null = null;
  let firstSnapshotStarted: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => { firstSnapshotStarted = resolve; });
  const firstSnapshotRelease = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve; });
  let waitForFirstSnapshot = options.pauseFirstSnapshot === true;

  function itemFor(key: keyof typeof state) {
    const itemState = state[key];
    return {
      getStartTime: vi.fn(async () => ({ seconds: itemState.start })),
      getEndTime: vi.fn(async () => ({ seconds: itemState.end })),
      getInPoint: vi.fn(async () => {
        if (key === "target" && waitForFirstSnapshot) {
          waitForFirstSnapshot = false;
          firstSnapshotStarted?.();
          await firstSnapshotRelease;
        }
        return { seconds: itemState.inPoint };
      }),
      getOutPoint: vi.fn(async () => ({ seconds: itemState.outPoint })),
      getDuration: vi.fn(async () => ({ seconds: itemState.end - itemState.start })),
      getSpeed: vi.fn(async () => 1),
      isSpeedReversed: vi.fn(async () => false),
      createMoveAction: vi.fn((time: { seconds: number }) => ({ apply: () => { itemState.start += time.seconds; itemState.end += time.seconds; } })),
      createSetStartAction: vi.fn((time: { seconds: number }) => ({ apply: () => { itemState.start = time.seconds; } })),
      createSetEndAction: vi.fn((time: { seconds: number }) => ({ apply: () => { itemState.end = time.seconds; } })),
      createSetInPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { itemState.inPoint = time.seconds; } })),
      createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { itemState.outPoint = time.seconds; } })),
    };
  }
  const previous = itemFor("previous"), target = itemFor("target"), following = itemFor("following");
  const videoTrack = { getTrackItems: vi.fn(async () => [previous, target, following]) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1), getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0), getAudioTrack: vi.fn(async () => null),
  };
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1", getActiveSequence: vi.fn(async () => sequence), lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) }, TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Constants: { TrackItemType: { CLIP: 1 } },
  };
  return { state, previous, target, following, project, firstSnapshot, releaseFirstSnapshot: () => releaseFirstSnapshot?.(), registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const expectedSnapshot = {
  projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 1,
  previous: { startSeconds: 0, endSeconds: 10, inSeconds: 0, outSeconds: 10, durationSeconds: 10, speed: 1, reversed: false },
  target: { startSeconds: 10, endSeconds: 20, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
  following: { startSeconds: 20, endSeconds: 30, inSeconds: 30, outSeconds: 40, durationSeconds: 10, speed: 1, reversed: false },
};
const targetCoordinates = { mediaType: "video", trackIndex: 0, clipIndex: 1 };

describe("guarded documented UXP track-item slide workflow", () => {
  it("advertises bounded inspection and a replay-safe undoable transaction command", async () => {
    const value = slideHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "trackItem.slide.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
      "trackItem.slide": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("trackItem.slide.inspect", targetCoordinates)).resolves.toEqual(expectedSnapshot);
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("slides a complete reviewed triplet in one transaction and reads every timeline and source boundary back", async () => {
    const value = slideHost();
    await expect(value.registry.dispatch("trackItem.slide", {
      ...targetCoordinates, expectedSnapshot, slideBySeconds: 2, confirmSlide: true, operationId: "slide-apply-1",
    })).resolves.toMatchObject({
      operationId: "slide-apply-1", slid: true, outcome: "verified", before: expectedSnapshot,
      after: {
        ...expectedSnapshot,
        previous: { ...expectedSnapshot.previous, endSeconds: 12, outSeconds: 12, durationSeconds: 12 },
        target: { ...expectedSnapshot.target, startSeconds: 12, endSeconds: 22 },
        following: { ...expectedSnapshot.following, startSeconds: 22, inSeconds: 32, durationSeconds: 8 },
      },
      verificationBoundary: "three_track_item_source_and_timeline_readback",
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Slide timeline item");
    expect(value.target.createMoveAction).toHaveBeenCalledWith({ seconds: 2 });
    expect(value.previous.createSetEndAction).toHaveBeenCalledWith({ seconds: 12 });
    expect(value.previous.createSetOutPointAction).toHaveBeenCalledWith({ seconds: 12 });
    expect(value.following.createSetStartAction).toHaveBeenCalledWith({ seconds: 22 });
    expect(value.following.createSetInPointAction).toHaveBeenCalledWith({ seconds: 32 });
    expect(value.state).toEqual({
      previous: { start: 0, end: 12, inPoint: 0, outPoint: 12 },
      target: { start: 12, end: 22, inPoint: 20, outPoint: 30 },
      following: { start: 22, end: 30, inPoint: 32, outPoint: 40 },
    });
  });

  it("rejects incomplete confirmation/replay/stale/edge requests before action creation", async () => {
    const value = slideHost();
    await expect(value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: 1, operationId: "missing-confirmation" })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: 1, confirmSlide: true })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("trackItem.slide", {
      ...targetCoordinates, expectedSnapshot: { ...expectedSnapshot, following: { ...expectedSnapshot.following, inSeconds: 31 } }, slideBySeconds: 1, confirmSlide: true, operationId: "stale",
    })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    await expect(value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: 10, confirmSlide: true, operationId: "zero-following" })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    await expect(value.registry.dispatch("trackItem.slide.inspect", { mediaType: "video", trackIndex: 0, clipIndex: 0 })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays a completed operation ID without creating a second host transaction", async () => {
    const value = slideHost();
    const args = { ...targetCoordinates, expectedSnapshot, slideBySeconds: -2, confirmSlide: true, operationId: "replay-slide" };
    await expect(value.registry.dispatch("trackItem.slide", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("trackItem.slide", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.state.target).toEqual({ start: 8, end: 18, inPoint: 20, outPoint: 30 });
  });

  it("serializes different operation IDs through the complete triplet preflight so a stale request cannot trim the wrong neighbours", async () => {
    const value = slideHost({ pauseFirstSnapshot: true });
    const first = value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: 1, confirmSlide: true, operationId: "concurrent-first" });
    await value.firstSnapshot;
    const second = value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: -1, confirmSlide: true, operationId: "concurrent-second" });
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    value.releaseFirstSnapshot();
    await expect(first).resolves.toMatchObject({ outcome: "verified" });
    await secondExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.state).toEqual({
      previous: { start: 0, end: 11, inPoint: 0, outPoint: 11 }, target: { start: 11, end: 21, inPoint: 20, outPoint: 30 }, following: { start: 21, end: 30, inPoint: 31, outPoint: 40 },
    });
  });

  it("shares the track lock with slips so a concurrent source-only edit cannot bypass the slide snapshot", async () => {
    const value = slideHost({ pauseFirstSnapshot: true });
    const slide = value.registry.dispatch("trackItem.slide", { ...targetCoordinates, expectedSnapshot, slideBySeconds: 1, confirmSlide: true, operationId: "slide-before-slip" });
    await value.firstSnapshot;
    const slip = value.registry.dispatch("trackItem.slip", {
      ...targetCoordinates,
      expectedSnapshot: { projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 1, startSeconds: 10, endSeconds: 20, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
      slipBySeconds: 1, confirmSlip: true, operationId: "slip-after-slide",
    });
    const slipExpectation = expect(slip).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    value.releaseFirstSnapshot();
    await expect(slide).resolves.toMatchObject({ outcome: "verified" });
    await slipExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
  });
});
