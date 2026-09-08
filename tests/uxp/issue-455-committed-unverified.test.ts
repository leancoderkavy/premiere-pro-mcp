import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/455
// When the host commits the transaction but produces a different result, the
// caller must be told the project already changed so it does not retry a
// destructive edit or abandon one that landed.

type SlipState = { start: number; end: number; inPoint: number; outPoint: number };

function slipHost(apply: (state: SlipState, inSeconds: number, outSeconds: number) => void) {
  const state: SlipState = { start: 10, end: 20, inPoint: 30, outPoint: 40 };
  const item = {
    getStartTime: vi.fn(async () => ({ seconds: state.start })),
    getEndTime: vi.fn(async () => ({ seconds: state.end })),
    getInPoint: vi.fn(async () => ({ seconds: state.inPoint })),
    getOutPoint: vi.fn(async () => ({ seconds: state.outPoint })),
    getDuration: vi.fn(async () => ({ seconds: state.end - state.start })),
    getSpeed: vi.fn(async () => 1),
    isSpeedReversed: vi.fn(async () => false),
    createSetInPointAction: vi.fn((time: { seconds: number }) => ({ kind: "in", seconds: time.seconds })),
    createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ kind: "out", seconds: time.seconds })),
  };
  const pending: { kind: string; seconds: number }[] = [];
  const videoTrack = { getTrackItems: vi.fn(async () => [item]) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0),
    getAudioTrack: vi.fn(async () => null),
  };
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: (action: { kind: string; seconds: number }) => boolean }) => void) => {
      pending.length = 0;
      callback({ addAction: (action) => { pending.push(action); return true; } });
      const inAction = pending.find((action) => action.kind === "in");
      const outAction = pending.find((action) => action.kind === "out");
      apply(state, inAction!.seconds, outAction!.seconds);
      return true;
    }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Constants: { TrackItemType: { CLIP: 1 } },
  };
  return { state, project, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const slipSnapshot = {
  projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0,
  startSeconds: 10, endSeconds: 20, inSeconds: 30, outSeconds: 40, durationSeconds: 10, speed: 1, reversed: false,
};

describe("issue #455 — a committed slip that lands wrong is not reported as a plain failure", () => {
  it("says the project already changed and describes the timeline move", async () => {
    // The host moves the whole item instead of only the source range.
    const host = slipHost((state, inSeconds, outSeconds) => {
      const offset = inSeconds - state.inPoint;
      state.inPoint = inSeconds;
      state.outPoint = outSeconds;
      state.start += offset;
      state.end += offset;
    });

    const failure = await host.registry.dispatch("trackItem.slip", {
      mediaType: "video", trackIndex: 0, clipIndex: 0,
      expectedSnapshot: slipSnapshot, slipBySeconds: 1, confirmSlip: true, operationId: "slip-1",
    }).catch((error: Error & { code?: string }) => error);

    expect(failure).toMatchObject({ code: "UXP_COMMITTED_UNVERIFIED" });
    expect((failure as Error).message).toContain("the project has already changed");
    expect((failure as Error).message).toContain("the timeline position moved (start 10s -> 11s, end 20s -> 21s)");
    expect((failure as Error).message).toContain("Do not retry this call");
    expect(host.state).toEqual({ start: 11, end: 21, inPoint: 31, outPoint: 41 });
  });

  it("still reports a correct slip as verified", async () => {
    const host = slipHost((state, inSeconds, outSeconds) => {
      state.inPoint = inSeconds;
      state.outPoint = outSeconds;
    });

    await expect(host.registry.dispatch("trackItem.slip", {
      mediaType: "video", trackIndex: 0, clipIndex: 0,
      expectedSnapshot: slipSnapshot, slipBySeconds: 1, confirmSlip: true, operationId: "slip-2",
    })).resolves.toMatchObject({ slipped: true, outcome: "verified" });
  });
});

type RippleState = { projectItemId: string; start: number; end: number; inPoint: number; outPoint: number };

function rippleHost(ripple: boolean) {
  const states: RippleState[] = [
    { projectItemId: "target-1", start: 0, end: 10, inPoint: 20, outPoint: 30 },
    { projectItemId: "following-1", start: 10, end: 20, inPoint: 40, outPoint: 50 },
  ];
  function itemFor(state: RippleState) {
    return {
      getProjectItem: vi.fn(async () => ({ getId: vi.fn(async () => state.projectItemId) })),
      getStartTime: vi.fn(async () => ({ seconds: state.start })),
      getEndTime: vi.fn(async () => ({ seconds: state.end })),
      getInPoint: vi.fn(async () => ({ seconds: state.inPoint })),
      getOutPoint: vi.fn(async () => ({ seconds: state.outPoint })),
      getDuration: vi.fn(async () => ({ seconds: state.end - state.start })),
      getSpeed: vi.fn(async () => 1),
      isSpeedReversed: vi.fn(async () => false),
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
  const createRemoveItemsAction = vi.fn(() => ({
    apply: () => {
      const index = items.indexOf(selected!);
      const duration = states[index]!.end - states[index]!.start;
      states.splice(index, 1);
      items.splice(index, 1);
      // A build that ignores the ripple flag deletes the clip and leaves a gap.
      if (!ripple) return;
      for (let later = index; later < states.length; later += 1) {
        states[later]!.start -= duration;
        states[later]!.end -= duration;
      }
    },
  }));
  const project = {
    guid: "project-1", getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: (action: { apply: () => void }) => boolean }) => void) => {
      callback({ addAction: (action) => { action.apply(); return true; } });
      return true;
    }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    SequenceEditor: { getEditor: vi.fn(() => ({ createRemoveItemsAction })) },
    TrackItemSelection: {
      createEmptySelection: vi.fn((callback: (selection: { addItem: (item: typeof items[number]) => boolean }) => void) => {
        callback({ addItem: (item) => { selected = item; return true; } });
        return true;
      }),
    },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: 1, AUDIO: 2 } },
  };
  return { states, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const rippleSnapshot = {
  projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0, trackItemCount: 2,
  target: { projectItemId: "target-1", startSeconds: 0, endSeconds: 10, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
  following: { projectItemId: "following-1", startSeconds: 10, endSeconds: 20, inSeconds: 40, outSeconds: 50, durationSeconds: 10, speed: 1, reversed: false },
};

describe("issue #455 — a committed delete that did not ripple is reported as committed", () => {
  it("names the gap the delete left instead of implying nothing happened", async () => {
    const host = rippleHost(false);

    const failure = await host.registry.dispatch("trackItem.rippleDelete", {
      mediaType: "video", trackIndex: 0, clipIndex: 0,
      expectedSnapshot: rippleSnapshot, confirmRippleDelete: true, operationId: "ripple-1",
    }).catch((error: Error & { code?: string }) => error);

    expect(failure).toMatchObject({ code: "UXP_COMMITTED_UNVERIFIED" });
    expect((failure as Error).message).toContain("the project has already changed");
    expect((failure as Error).message).toContain("the delete left a gap of 10s");
    expect((failure as Error).message).toContain("Do not retry this call");
    // The clip really is gone, which is exactly why a retry must not happen.
    expect(host.states).toHaveLength(1);
  });

  it("still reports a genuine ripple delete as verified", async () => {
    await expect(rippleHost(true).registry.dispatch("trackItem.rippleDelete", {
      mediaType: "video", trackIndex: 0, clipIndex: 0,
      expectedSnapshot: rippleSnapshot, confirmRippleDelete: true, operationId: "ripple-2",
    })).resolves.toMatchObject({ rippleDeleted: true, outcome: "verified" });
  });
});
