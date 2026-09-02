import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function host(options: { transitions?: boolean; commit?: boolean } = {}) {
  const addAction = vi.fn((action: { apply?: () => void }) => {
    action.apply?.();
    return true;
  });
  const add = vi.fn(() => ({ kind: "add" }));
  const remove = vi.fn(() => ({ kind: "remove" }));
  const liftAction = { kind: "lift" };
  const selectedItem = { guid: "selected-clip" };
  const selection = { getTrackItems: vi.fn(async () => [selectedItem]) };
  const createRemoveItemsAction = vi.fn(() => liftAction);
  const clip = { createAddVideoTransitionAction: add, createRemoveVideoTransitionAction: remove };
  const track = { getTrackItems: vi.fn(async () => [clip]) };
  const exportedFrames: string[] = [];
  const exportSequenceFrame = vi.fn(async (_sequence: unknown, _position: unknown, filename: string) => {
    exportedFrames.push(filename);
    return true;
  });
  const range = { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 };
  const sequence = {
    guid: "sequence-1",
    name: "Timeline",
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => track),
    getSelection: vi.fn(async () => selection),
    getPlayerPosition: vi.fn(async () => ({ seconds: 3 })),
    getFrameSize: vi.fn(async () => ({ width: 1920, height: 1080 })),
    getInPoint: vi.fn(async () => ({ seconds: range.inSeconds })),
    getOutPoint: vi.fn(async () => ({ seconds: range.outSeconds })),
    getZeroPoint: vi.fn(async () => ({ seconds: range.zeroPointSeconds })),
    getEndTime: vi.fn(async () => ({ seconds: range.endSeconds })),
    createSetInPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { range.inSeconds = time.seconds; } })),
    createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { range.outSeconds = time.seconds; } })),
    createSetZeroPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { range.zeroPointSeconds = time.seconds; } })),
  };
  const project = {
    guid: "project-1",
    name: "Example",
    path: "/projects/example.prproj",
    getActiveSequence: vi.fn(async () => sequence),
    getSequences: vi.fn(async () => [sequence]),
    save: vi.fn(async () => true),
    createSequenceWithPresetPath: vi.fn(async (name: string) => ({ guid: "sequence-2", name })),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: unknown) => void) => {
      if (options.commit === false) return false;
      callback({ addAction });
      return true;
    })
  };
  const optionValues: Record<string, unknown> = {};
  const transitionApis = options.transitions === false ? {} : {
    TransitionFactory: {
      getVideoTransitionMatchNames: vi.fn(async () => ["CrossDissolve", "DipToBlack"]),
      createVideoTransition: vi.fn(async (name: string) => ({ name }))
    },
    AddTransitionOptions: vi.fn(() => ({
      setApplyToStart: vi.fn((value: boolean) => { optionValues.applyToStart = value; }),
      setDuration: vi.fn((value: unknown) => { optionValues.duration = value; }),
      setForceSingleSided: vi.fn((value: boolean) => { optionValues.forceSingleSided = value; }),
      setTransitionAlignment: vi.fn((value: number) => { optionValues.transitionAlignment = value; })
    }))
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { ANY: 0 }, TransitionPosition: { START: 0, END: 1 } },
    SequenceEditor: { getEditor: vi.fn(async () => ({ createRemoveItemsAction })) },
    ProjectConverter: {
      exportAsOpenTimelineIO: vi.fn(async () => true),
      exportAsFinalCutProXML: vi.fn(async () => true),
    },
    Transcript: { querySupportedLanguages: vi.fn(async () => [{ languageCode: "en-US" }]) },
    ObjectMaskUtils: { hasObjectMask: vi.fn(() => true) },
    EncoderManager: {
      launchEncoder: vi.fn(async () => true),
      setEmbeddedXMPEnabled: vi.fn(async () => true),
      setSidecarXMPEnabled: vi.fn(async () => true),
      startBatchEncode: vi.fn(async () => true),
    },
    Exporter: { exportSequenceFrame },
    ...transitionApis
  };
  return { registry: Commands.createCommandRegistry({ ppro, fs: {}, Protocol }), ppro, project, sequence, range, track, clip, add, remove, addAction, optionValues, selection, createRemoveItemsAction, exportSequenceFrame, exportedFrames };
}

describe("UXP command registry", () => {
  it("reports support per command from the runtime API surface", async () => {
    const available = await host().registry.capabilities();
    expect(available.commands["transition.video.add"]).toMatchObject({ supported: true, destructive: true, undoable: true, minHostVersion: "25.6.0" });
    expect(available.commands["timeline.selection.lift"]).toMatchObject({ supported: true, destructive: true, undoable: true, minHostVersion: "25.6.0" });
    expect(available.commands["sequence.range.inspect"]).toMatchObject({ supported: true, readOnly: true, minHostVersion: "25.6.0" });
    expect(available.commands["sequence.range.update"]).toMatchObject({ supported: true, destructive: true, undoable: true, idempotent: true, minHostVersion: "25.6.0" });
    for (const command of ["sequence.createPreset", "interchange.export", "interchange.aaf.export", "frame.export"]) {
      expect(available.commands[command]).toMatchObject({ workspaceRequired: true });
    }
    const unavailable = await host({ transitions: false }).registry.capabilities();
    expect(unavailable.commands["transition.video.add"]).toMatchObject({ supported: false, reason: expect.any(String) });
  });

  it("requires an explicit available canonical-path state for path command discovery", async () => {
    const value = host();
    const missingState = Commands.createCommandRegistry({
      ppro: value.ppro,
      Protocol,
      workspace: { status: () => ({ configured: true }), assertPathAllowed: (path: string) => path },
    });
    await expect(missingState.capabilities()).resolves.toMatchObject({
      commands: { "sequence.createPreset": { supported: false, workspaceRequired: true } },
    });

    const availableState = Commands.createCommandRegistry({
      ppro: value.ppro,
      Protocol,
      workspace: { status: () => ({ configured: true, canonicalPathValidation: "available" }), assertPathAllowed: (path: string) => path },
    });
    await expect(availableState.capabilities()).resolves.toMatchObject({
      commands: { "sequence.createPreset": { supported: true, workspaceRequired: true } },
    });
  });

  it("lists installed video transition match names", async () => {
    await expect(host().registry.dispatch("transition.video.list", {})).resolves.toEqual({
      matchNames: ["CrossDissolve", "DipToBlack"], count: 2
    });
  });

  it("accepts a transition match name returned by an earlier list when host enumeration changes", async () => {
    const value = host();
    value.ppro.TransitionFactory.getVideoTransitionMatchNames
      .mockResolvedValueOnce(["ADBE Cross Dissolve New"])
      .mockResolvedValueOnce(["ADBE Additive Dissolve"]);

    await expect(value.registry.dispatch("transition.video.list", {})).resolves.toEqual({
      matchNames: ["ADBE Cross Dissolve New"], count: 1,
    });
    await expect(value.registry.dispatch("transition.video.add", {
      videoTrackIndex: 0, clipIndex: 0, matchName: "ADBE Cross Dissolve New", position: "start",
    })).resolves.toMatchObject({ applied: true, matchName: "ADBE Cross Dissolve New" });
    expect(value.ppro.TransitionFactory.createVideoTransition).toHaveBeenCalledWith("ADBE Cross Dissolve New");
  });

  it("exports a PNG with a bare host filename and a one-extension returned path", async () => {
    const value = host();
    await expect(value.registry.dispatch("frame.export", {
      outputDirectory: "C:/approved", filename: "frame.png",
    })).resolves.toMatchObject({ path: "C:/approved/frame.png", exporterResult: true });
    expect(value.exportSequenceFrame).toHaveBeenCalledWith(
      value.sequence, { seconds: 3 }, "frame", "C:/approved", 1920, 1080,
    );
    expect(value.exportedFrames).toEqual(["frame"]);
  });

  it("does not report a frame path when Premiere rejects the export", async () => {
    const value = host();
    value.exportSequenceFrame.mockResolvedValueOnce(false);
    await expect(value.registry.dispatch("frame.export", {
      outputDirectory: "C:/approved", filename: "frame.png",
    })).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });
  });

  it("returns a stable compact project snapshot", async () => {
    await expect(host().registry.dispatch("project.snapshot", {})).resolves.toMatchObject({
      revision: expect.stringMatching(/^uxp-/),
      project: { guid: "project-1", name: "Example" },
      activeSequenceGuid: "sequence-1",
      sequences: [{ guid: "sequence-1", name: "Timeline" }],
    });
  });

  it("inspects and transactionally updates a complete guarded sequence range", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.range.inspect", {})).resolves.toEqual({
      sequenceGuid: "sequence-1",
      range: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      verificationBoundary: "sequence_range_readback",
    });
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2, outSeconds: 110, zeroPointSeconds: 7200 },
      operationId: "range-1",
    })).resolves.toMatchObject({
      updated: true,
      outcome: "verified",
      sequenceGuid: "sequence-1",
      range: { inSeconds: 2, outSeconds: 110, zeroPointSeconds: 7200, endSeconds: 120 },
      operation: { mutatesProject: true, verification: { status: "verified" }, undo: { supported: true } },
      operationId: "range-1",
    });
    expect(value.project.lockedAccess).toHaveBeenCalledOnce();
    expect(value.project.executeTransaction).toHaveBeenCalledWith(expect.any(Function), "Update sequence range");
    expect(value.sequence.createSetInPointAction).toHaveBeenCalledWith({ seconds: 2 });
    expect(value.sequence.createSetOutPointAction).toHaveBeenCalledWith({ seconds: 110 });
    expect(value.sequence.createSetZeroPointAction).toHaveBeenCalledWith({ seconds: 7200 });
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2, outSeconds: 110, zeroPointSeconds: 7200 },
      operationId: "range-1",
    })).resolves.toMatchObject({ replayed: true });
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
  });

  it("serializes concurrent sequence-range updates with different operation IDs", async () => {
    const value = host();
    const expectedRange = { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 };
    const first = value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange,
      updates: { inSeconds: 2 },
      operationId: "range-concurrent-first",
    });
    const second = value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange,
      updates: { outSeconds: 110 },
      operationId: "range-concurrent-second",
    });

    await expect(first).resolves.toMatchObject({
      updated: true,
      operationId: "range-concurrent-first",
      range: { inSeconds: 2, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
    });
    await expect(second).rejects.toMatchObject({ code: "UXP_STALE_RANGE" });
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
    expect(value.range).toEqual({ inSeconds: 2, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 });
  });

  it("fails closed for stale, malformed, and out-of-bounds sequence-range updates", async () => {
    const value = host();
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "other-sequence",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2 },
    })).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 0, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2 },
    })).rejects.toMatchObject({ code: "UXP_STALE_RANGE" });
    const durationChanged = host();
    durationChanged.range.endSeconds = 119;
    await expect(durationChanged.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2 },
    })).rejects.toMatchObject({ code: "UXP_STALE_RANGE" });
    expect(durationChanged.project.executeTransaction).not.toHaveBeenCalled();
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 111, outSeconds: 110 },
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: {},
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    expect(value.sequence.createSetInPointAction).not.toHaveBeenCalled();
    expect(value.project.executeTransaction).not.toHaveBeenCalled();

    const rejectedAction = host();
    rejectedAction.sequence.createSetInPointAction.mockReturnValue(undefined);
    await expect(rejectedAction.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2 },
    })).rejects.toMatchObject({ code: "UXP_ACTION_REJECTED" });
  });

  it("rejects failed range readback and advertises only the supported command variant", async () => {
    const value = host();
    value.sequence.getOutPoint
      .mockResolvedValueOnce({ seconds: 100 })
      .mockResolvedValueOnce({ seconds: 99 });
    await expect(value.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { outSeconds: 110 },
    })).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });

    const durationChanged = host();
    durationChanged.sequence.getEndTime
      .mockResolvedValueOnce({ seconds: 120 })
      .mockResolvedValueOnce({ seconds: 119 });
    await expect(durationChanged.registry.dispatch("sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 100, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2 },
    })).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });

    const unavailable = host();
    unavailable.sequence.createSetZeroPointAction = undefined;
    const capabilities = await unavailable.registry.capabilities();
    expect(capabilities.commands["sequence.range.inspect"]).toMatchObject({ supported: true });
    expect(capabilities.commands["sequence.range.update"]).toMatchObject({ supported: false, reason: expect.any(String) });
  });

  it("deduplicates completed mutations by operation id", async () => {
    const value = host();
    const args = { operationId: "save-123" };
    await expect(value.registry.dispatch("project.save", args)).resolves.toMatchObject({
      saved: true, outcome: "verified", operationId: "save-123",
    });
    await expect(value.registry.dispatch("project.save", args)).resolves.toMatchObject({
      saved: true, replayed: true,
    });
    expect(value.project.save).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent mutations with the same operation id", async () => {
    const value = host();
    let releaseSave: (saved: boolean) => void = () => undefined;
    value.project.save.mockReturnValue(new Promise<boolean>((resolve) => { releaseSave = resolve; }));
    const args = { operationId: "save-concurrent" };

    const first = value.registry.dispatch("project.save", args);
    const second = value.registry.dispatch("project.save", args);
    await vi.waitFor(() => expect(value.project.save).toHaveBeenCalledOnce());
    releaseSave(true);

    const results = await Promise.all([first, second]);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ saved: true, operationId: "save-concurrent" }),
      expect.objectContaining({ saved: true, operationId: "save-concurrent", replayed: true }),
    ]));
    expect(results.filter((result) => result.replayed === true)).toHaveLength(1);
    expect(value.project.save).toHaveBeenCalledOnce();
  });

  it("shares concurrent mutation failures and releases the operation id for retry", async () => {
    const value = host();
    let rejectSave: (error: Error) => void = () => undefined;
    value.project.save
      .mockReturnValueOnce(new Promise<boolean>((_resolve, reject) => { rejectSave = reject; }))
      .mockResolvedValueOnce(true);
    const args = { operationId: "save-retry" };

    const first = value.registry.dispatch("project.save", args);
    const second = value.registry.dispatch("project.save", args);
    await vi.waitFor(() => expect(value.project.save).toHaveBeenCalledOnce());
    rejectSave(new Error("save failed"));

    const failures = await Promise.allSettled([first, second]);
    expect(failures).toEqual([
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "save failed" }) }),
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "save failed" }) }),
    ]);
    await expect(value.registry.dispatch("project.save", args)).resolves.toMatchObject({
      saved: true, operationId: "save-retry",
    });
    expect(value.project.save).toHaveBeenCalledTimes(2);
  });

  it("applies replay protection to the injected transcript import mutator", async () => {
    const value = host();
    const importTranscript = vi.fn(async () => ({ imported: true }));
    const registry = Commands.createCommandRegistry({
      ppro: value.ppro,
      Protocol,
      transcriptImportHandler: importTranscript,
      transcriptImportProbe: () => true,
    });
    const args = { json: "{}", operationId: "transcript-import" };

    const results = await Promise.all([
      registry.dispatch("transcript.import", args),
      registry.dispatch("transcript.import", args),
    ]);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ imported: true, operationId: "transcript-import" }),
      expect.objectContaining({ imported: true, operationId: "transcript-import", replayed: true }),
    ]));
    await expect(registry.dispatch("transcript.import", args)).resolves.toMatchObject({
      imported: true, replayed: true,
    });
    expect(importTranscript).toHaveBeenCalledOnce();
    await expect(registry.capabilities()).resolves.toMatchObject({
      commands: { "transcript.import": { supported: true, destructive: true, undoable: true } },
    });
  });

  it("exports supported interchange formats and configures AME", async () => {
    const value = host();
    await expect(value.registry.dispatch("interchange.export", {
      format: "otio", outputFilePath: "/tmp/edit.otio",
    })).resolves.toMatchObject({ exported: true, format: "otio", outcome: "verified" });
    await expect(value.registry.dispatch("encoder.configure", {
      launch: true, embeddedXmp: true, startBatch: true,
    })).resolves.toMatchObject({
      configured: true,
      outcome: "committed_unverified",
      performed: ["launch", "embeddedXmp", "startBatch"],
    });
  });

  it("adds a configured transition in a locked undoable transaction", async () => {
    const value = host();
    await expect(value.registry.dispatch("transition.video.add", {
      videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve", position: "start",
      durationSeconds: 0.5, forceSingleSided: true, transitionAlignment: 1
    })).resolves.toMatchObject({ applied: true, verified: "transaction", position: "start" });
    expect(value.project.lockedAccess).toHaveBeenCalledOnce();
    expect(value.project.executeTransaction).toHaveBeenCalledWith(expect.any(Function), "Add video transition");
    expect(value.add).toHaveBeenCalledWith({ name: "CrossDissolve" }, expect.any(Object));
    expect(value.optionValues).toEqual({ applyToStart: true, duration: { seconds: 0.5 }, forceSingleSided: true, transitionAlignment: 1 });
  });

  it("removes the requested transition side in a transaction", async () => {
    const value = host();
    await expect(value.registry.dispatch("transition.video.remove", { videoTrackIndex: 0, clipIndex: 0, position: "end" }))
      .resolves.toMatchObject({ removed: true, position: "end" });
    expect(value.remove).toHaveBeenCalledWith(1);
  });

  it("lifts the current selection without ripple in one undoable transaction", async () => {
    const value = host();
    await expect(value.registry.dispatch("timeline.selection.lift", {
      expectedSequenceGuid: "sequence-1", operationId: "lift-1",
    })).resolves.toMatchObject({
      lifted: true, selectedItemCount: 1, ripple: false, outcome: "committed_unverified", operationId: "lift-1",
      operation: { mutatesProject: true, verification: { status: "not_verified" }, undo: { supported: true } },
    });
    expect(value.createRemoveItemsAction).toHaveBeenCalledWith(value.selection, false, 0, false);
    expect(value.project.executeTransaction).toHaveBeenCalledWith(expect.any(Function), "Lift selected timeline items");
  });

  it("rejects a stale target before creating a selection-lift action", async () => {
    const value = host();
    await expect(value.registry.dispatch("timeline.selection.lift", { expectedSequenceGuid: "other-sequence" }))
      .rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });
    expect(value.createRemoveItemsAction).not.toHaveBeenCalled();
  });

  it("rejects unknown transitions, invalid targets, and failed commits", async () => {
    await expect(host().registry.dispatch("transition.video.add", { videoTrackIndex: 0, clipIndex: 0, matchName: "Missing" }))
      .rejects.toMatchObject({ code: "UXP_TRANSITION_NOT_FOUND" });
    await expect(host().registry.dispatch("transition.video.remove", { videoTrackIndex: 1, clipIndex: 0 }))
      .rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    await expect(host({ commit: false }).registry.dispatch("transition.video.remove", { videoTrackIndex: 0, clipIndex: 0 }))
      .rejects.toMatchObject({ code: "UXP_TRANSACTION_FAILED" });
  });
});

describe("UXP transition argument validation", () => {
  it("requires explicit non-negative clip coordinates and a match name", () => {
    expect(() => Commands.validateAddArgs({ videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve" })).not.toThrow();
    expect(() => Commands.validateAddArgs({ videoTrackIndex: -1, clipIndex: 0, matchName: "CrossDissolve" })).toThrow("videoTrackIndex");
    expect(() => Commands.validateAddArgs({ videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve", surprise: true })).toThrow("Unknown argument");
  });
});
