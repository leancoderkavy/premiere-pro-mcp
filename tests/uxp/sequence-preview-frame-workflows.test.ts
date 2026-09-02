import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type HostOptions = { pauseLockedPreflight?: boolean; sequenceCount?: number };

function previewFrameHost(options: HostOptions = {}) {
  let previewWidth = 640;
  let previewHeight = 360;
  let pendingRect: { width: number; height: number } | null = null;
  let getterCalls = 0;
  let notifyLockedPreflight: (() => void) | null = null;
  let releaseLockedPreflight: (() => void) | null = null;
  const lockedPreflight = new Promise<void>((resolve) => { notifyLockedPreflight = resolve; });
  const lockedPreflightRelease = new Promise<void>((resolve) => { releaseLockedPreflight = resolve; });
  const settings = {
    getPreviewFrameRect: vi.fn(async () => {
      getterCalls += 1;
      if (options.pauseLockedPreflight && getterCalls === 1) {
        notifyLockedPreflight?.();
        await lockedPreflightRelease;
      }
      return { width: previewWidth, height: previewHeight };
    }),
    setPreviewFrameRect: vi.fn(async (rect: { width: number; height: number }) => {
      pendingRect = { width: rect.width, height: rect.height };
      return true;
    }),
  };
  const sequence = {
    guid: "sequence-1",
    getSettings: vi.fn(async () => settings),
    createSetSettingsAction: vi.fn(() => ({
      apply: () => {
        if (!pendingRect) throw new Error("expected staged preview frame");
        previewWidth = pendingRect.width;
        previewHeight = pendingRect.height;
      },
    })),
  };
  const addAction = vi.fn((action: { apply: () => void }) => { action.apply(); return true; });
  const sequences = options.sequenceCount === 1025
    ? Array.from({ length: 1025 }, (_, index) => index === 0 ? sequence : { guid: `sequence-${index}` })
    : [sequence];
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => sequence),
    getSequences: vi.fn(async () => sequences),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  function RectF(this: { width: number; height: number }) { this.width = 0; this.height = 0; }
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    RectF,
  };
  return {
    project, sequence, settings, lockedPreflight, registry: Commands.createCommandRegistry({ ppro, Protocol }),
    releaseLockedPreflight: () => releaseLockedPreflight?.(),
    get dimensions() { return { width: previewWidth, height: previewHeight }; },
  };
}

const target = { sequenceId: "sequence-1" };
const expectedSnapshot = { projectGuid: "project-1", sequenceId: "sequence-1", previewWidth: 640, previewHeight: 360 };

describe("guarded documented UXP sequence preview-frame workflow", () => {
  it("advertises a bounded readback and double-reads one explicit sequence without a transaction", async () => {
    const value = previewFrameHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "sequence.previewFrame.inspect": { supported: true, readOnly: true, minHostVersion: "26.3.0" },
      "sequence.previewFrame.update": { supported: true, destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("sequence.previewFrame.inspect", target)).resolves.toEqual(expectedSnapshot);
    expect(value.settings.getPreviewFrameRect).toHaveBeenCalledTimes(2);
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("sets exactly the reviewed preview frame in one transaction and reads it back", async () => {
    const value = previewFrameHost();
    await expect(value.registry.dispatch("sequence.previewFrame.update", {
      ...target, previewWidth: 1920, previewHeight: 1080, expectedSnapshot,
      confirmSetPreviewFrame: true, operationId: "preview-frame-1",
    })).resolves.toMatchObject({
      operationId: "preview-frame-1", previewFrameUpdated: true, outcome: "verified", before: expectedSnapshot,
      after: { ...expectedSnapshot, previewWidth: 1920, previewHeight: 1080 },
      verificationBoundary: "sequence_preview_frame_readback", undoLabel: "Set sequence preview frame",
    });
    expect(value.settings.setPreviewFrameRect).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
    expect(value.sequence.createSetSettingsAction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.project.executeTransaction.mock.calls[0]?.[1]).toBe("Set sequence preview frame");
    expect(value.dimensions).toEqual({ width: 1920, height: 1080 });
  });

  it("requires authority, a complete fresh snapshot, a bounded rectangle, and a bounded sequence collection", async () => {
    const value = previewFrameHost();
    const update = { ...target, previewWidth: 1920, previewHeight: 1080, expectedSnapshot, operationId: "preview-frame-guard" };
    await expect(value.registry.dispatch("sequence.previewFrame.update", update)).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("sequence.previewFrame.update", {
      ...update, expectedSnapshot: { ...expectedSnapshot, previewWidth: 641 }, confirmSetPreviewFrame: true,
    })).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE_PREVIEW_FRAME" });
    await expect(value.registry.dispatch("sequence.previewFrame.update", {
      ...update, previewWidth: 10241, confirmSetPreviewFrame: true,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("sequence.previewFrame.inspect", { sequenceId: "missing" })).rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    await expect(previewFrameHost({ sequenceCount: 1025 }).registry.dispatch("sequence.previewFrame.inspect", target)).rejects.toMatchObject({ code: "UXP_TARGET_TOO_LARGE" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("replays an accepted operation ID without a second host transaction", async () => {
    const value = previewFrameHost();
    const args = { ...target, previewWidth: 1920, previewHeight: 1080, expectedSnapshot, confirmSetPreviewFrame: true, operationId: "preview-frame-replay" };
    await expect(value.registry.dispatch("sequence.previewFrame.update", args)).resolves.toMatchObject({ outcome: "verified" });
    await expect(value.registry.dispatch("sequence.previewFrame.update", args)).resolves.toMatchObject({ outcome: "verified", replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("serializes distinct operation IDs before preflight so stale second update cannot overwrite the first", async () => {
    const value = previewFrameHost({ pauseLockedPreflight: true });
    const first = value.registry.dispatch("sequence.previewFrame.update", {
      ...target, previewWidth: 1920, previewHeight: 1080, expectedSnapshot, confirmSetPreviewFrame: true, operationId: "preview-frame-first",
    });
    await value.lockedPreflight;
    const second = value.registry.dispatch("sequence.previewFrame.update", {
      ...target, previewWidth: 1280, previewHeight: 720, expectedSnapshot, confirmSetPreviewFrame: true, operationId: "preview-frame-second",
    });
    const secondExpectation = expect(second).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE_PREVIEW_FRAME" });
    value.releaseLockedPreflight();
    await expect(first).resolves.toMatchObject({ outcome: "verified", after: { previewWidth: 1920, previewHeight: 1080 } });
    await secondExpectation;
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(value.dimensions).toEqual({ width: 1920, height: 1080 });
  });
});
