import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type HostOptions = { pauseLockedPreflight?: boolean };

function sourceLabelHost(options: HostOptions = {}) {
  let colorIndex = 3;
  let colorGetterCalls = 0;
  let notifyLockedPreflight: (() => void) | null = null;
  let releaseLockedPreflight: (() => void) | null = null;
  const lockedPreflight = new Promise<void>((resolve) => { notifyLockedPreflight = resolve; });
  const lockedPreflightRelease = new Promise<void>((resolve) => { releaseLockedPreflight = resolve; });
  const source = {
    getId: vi.fn(async () => "source-1"),
    getColorLabelIndex: vi.fn(async () => {
      colorGetterCalls += 1;
      if (options.pauseLockedPreflight && colorGetterCalls === 2) {
        notifyLockedPreflight?.();
        await lockedPreflightRelease;
      }
      return colorIndex;
    }),
    createSetColorLabelAction: vi.fn((next: number) => ({ apply: () => { colorIndex = next; } })),
  };
  const item = {
    getProjectItem: vi.fn(async () => source),
    getStartTime: vi.fn(async () => ({ seconds: 12 })),
    getEndTime: vi.fn(async () => ({ seconds: 20 })),
  };
  const videoTrack = { getTrackItems: vi.fn(async () => [item]) };
  const audioTrack = { getTrackItems: vi.fn(async () => [item]) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1), getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 1), getAudioTrack: vi.fn(async () => audioTrack),
  };
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const project = {
    guid: "project-1", getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    ClipProjectItem: { cast: vi.fn((value: unknown) => value === source ? source : null) },
    Constants: { TrackItemType: { CLIP: 1 } },
  };
  return {
    project, source, get colorIndex() { return colorIndex; }, lockedPreflight,
    releaseLockedPreflight: () => releaseLockedPreflight?.(),
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

const target = { mediaType: "video", trackIndex: 0, clipIndex: 0 };
const expectedSnapshot = {
  projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0,
  trackItemCount: 1, sourceProjectItemId: "source-1", sourceColorLabelIndex: 3, startSeconds: 12, endSeconds: 20,
};

describe("guarded documented UXP timeline source-label workflow", () => {
  it("advertises bounded readback and returns an active-coordinate source snapshot without a transaction", async () => {
    const value = sourceLabelHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "timeline.sourceLabel.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
      "timeline.sourceLabel.update": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("timeline.sourceLabel.inspect", target)).resolves.toEqual(expectedSnapshot);
    await expect(value.registry.dispatch("timeline.sourceLabel.inspect", { ...target, mediaType: "audio" })).resolves.toMatchObject({ ...expectedSnapshot, mediaType: "audio" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("sets exactly the reviewed source label in one transaction and reads the coordinate back", async () => {
    const value = sourceLabelHost();
    await expect(value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 9, expectedSnapshot, confirmSetLabel: true, operationId: "source-label-1",
    })).resolves.toMatchObject({
      operationId: "source-label-1", sourceLabelUpdated: true, outcome: "verified", before: expectedSnapshot,
      after: { ...expectedSnapshot, sourceColorLabelIndex: 9 },
      verificationBoundary: "timeline_coordinate_source_color_label_readback", undoLabel: "Set timeline source label",
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Set timeline source label");
    expect(value.source.createSetColorLabelAction).toHaveBeenCalledWith(9);
    expect(value.colorIndex).toBe(9);
  });

  it("requires authority and a complete fresh snapshot before action creation", async () => {
    const value = sourceLabelHost();
    await expect(value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 9, expectedSnapshot, operationId: "missing-confirmation",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 9, expectedSnapshot, confirmSetLabel: true,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 9, expectedSnapshot: { ...expectedSnapshot, sourceColorLabelIndex: 2 }, confirmSetLabel: true, operationId: "stale",
    })).rejects.toMatchObject({ code: "UXP_STALE_SOURCE_LABEL" });
    await expect(value.registry.dispatch("timeline.sourceLabel.inspect", { ...target, clipIndex: 1 })).rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays an accepted operation ID without a second host transaction", async () => {
    const value = sourceLabelHost();
    const args = { ...target, colorIndex: 9, expectedSnapshot, confirmSetLabel: true, operationId: "source-label-replay" };
    await expect(value.registry.dispatch("timeline.sourceLabel.update", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("timeline.sourceLabel.update", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("serializes distinct operation IDs so a second reviewed label cannot overwrite the first", async () => {
    const value = sourceLabelHost({ pauseLockedPreflight: true });
    const first = value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 9, expectedSnapshot, confirmSetLabel: true, operationId: "source-label-first",
    });
    await value.lockedPreflight;
    const second = value.registry.dispatch("timeline.sourceLabel.update", {
      ...target, colorIndex: 11, expectedSnapshot, confirmSetLabel: true, operationId: "source-label-second",
    });
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "UXP_STALE_SOURCE_LABEL" });
    value.releaseLockedPreflight();
    await expect(first).resolves.toMatchObject({ outcome: "verified", after: { sourceColorLabelIndex: 9 } });
    await secondExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.colorIndex).toBe(9);
  });
});
