import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type SlipHostOptions = {
  reverse?: boolean;
  speed?: number;
  pauseFirstSnapshot?: boolean;
};

function slipHost(options: SlipHostOptions = {}) {
  const state = { start: 10, end: 20, inPoint: 30, outPoint: 40 };
  let releaseFirstSnapshot: (() => void) | null = null;
  let firstSnapshotStarted: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => { firstSnapshotStarted = resolve; });
  const firstSnapshotRelease = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve; });
  let waitForFirstSnapshot = options.pauseFirstSnapshot === true;
  const item = {
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
    getSpeed: vi.fn(async () => options.speed ?? 1),
    isSpeedReversed: vi.fn(async () => options.reverse ?? false),
    createSetInPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { state.inPoint = time.seconds; } })),
    createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { state.outPoint = time.seconds; } })),
  };
  const videoTrack = { getTrackItems: vi.fn(async () => [item]) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0),
    getAudioTrack: vi.fn(async () => null),
  };
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => {
      callback({ addAction });
      return true;
    }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Constants: { TrackItemType: { CLIP: 1 } },
  };
  return {
    state,
    item,
    project,
    firstSnapshot,
    releaseFirstSnapshot: () => releaseFirstSnapshot?.(),
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

const expectedSnapshot = {
  projectGuid: "project-1",
  sequenceId: "sequence-1",
  mediaType: "video",
  trackIndex: 0,
  clipIndex: 0,
  startSeconds: 10,
  endSeconds: 20,
  inSeconds: 30,
  outSeconds: 40,
  durationSeconds: 10,
  speed: 1,
  reversed: false,
};

const target = { mediaType: "video", trackIndex: 0, clipIndex: 0 };

describe("guarded documented UXP track-item slip workflow", () => {
  it("advertises separate bounded inspection and one-transaction mutation commands", async () => {
    const value = slipHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({
      commands: {
        "trackItem.slip.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
        "trackItem.slip": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
      },
    });
    await expect(value.registry.dispatch("trackItem.slip.inspect", target)).resolves.toEqual(expectedSnapshot);
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("slips one reviewed forward 1x item without moving timeline timing and reads every guarded field back", async () => {
    const value = slipHost();
    await expect(value.registry.dispatch("trackItem.slip", {
      ...target,
      expectedSnapshot,
      slipBySeconds: 2.5,
      confirmSlip: true,
      operationId: "slip-apply-1",
    })).resolves.toMatchObject({
      operationId: "slip-apply-1",
      slipped: true,
      outcome: "verified",
      before: expectedSnapshot,
      after: { ...expectedSnapshot, inSeconds: 32.5, outSeconds: 42.5 },
      verificationBoundary: "track_item_source_and_timeline_readback",
    });
    expect(value.state).toEqual({ start: 10, end: 20, inPoint: 32.5, outPoint: 42.5 });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Slip timeline item source");
    expect(value.item.createSetInPointAction).toHaveBeenCalledWith({ seconds: 32.5 });
    expect(value.item.createSetOutPointAction).toHaveBeenCalledWith({ seconds: 42.5 });
  });

  it("requires a complete unchanged snapshot, confirmation, replay key, forward 1x state, and valid source bounds before action creation", async () => {
    const value = slipHost();
    await expect(value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot, slipBySeconds: 1, operationId: "missing-confirmation",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot, slipBySeconds: 1, confirmSlip: true,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot: { ...expectedSnapshot, endSeconds: 21 }, slipBySeconds: 1, confirmSlip: true, operationId: "stale",
    })).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    await expect(value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot, slipBySeconds: -31, confirmSlip: true, operationId: "negative-handle",
    })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();

    const reverse = slipHost({ reverse: true });
    await expect(reverse.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot: { ...expectedSnapshot, reversed: true }, slipBySeconds: 1, confirmSlip: true, operationId: "reverse",
    })).rejects.toMatchObject({ code: "UXP_TARGET_UNSUPPORTED" });
    expect(reverse.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays the same operation ID without creating a second host transaction", async () => {
    const value = slipHost();
    const args = { ...target, expectedSnapshot, slipBySeconds: 1, confirmSlip: true, operationId: "replay-slip" };
    await expect(value.registry.dispatch("trackItem.slip", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("trackItem.slip", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.state).toEqual({ start: 10, end: 20, inPoint: 31, outPoint: 41 });
  });

  it("serializes different operation IDs through preflight, action creation, and readback so a stale later snapshot cannot slip the wrong source", async () => {
    const value = slipHost({ pauseFirstSnapshot: true });
    const first = value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot, slipBySeconds: 1, confirmSlip: true, operationId: "concurrent-first",
    });
    await value.firstSnapshot;
    const second = value.registry.dispatch("trackItem.slip", {
      ...target, expectedSnapshot, slipBySeconds: 2, confirmSlip: true, operationId: "concurrent-second",
    });
    value.releaseFirstSnapshot();
    await expect(first).resolves.toMatchObject({ outcome: "verified", after: { inSeconds: 31, outSeconds: 41 } });
    await expect(second).rejects.toMatchObject({ code: "UXP_STALE_TRACK_ITEM" });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.state).toEqual({ start: 10, end: 20, inPoint: 31, outPoint: 41 });
  });
});
