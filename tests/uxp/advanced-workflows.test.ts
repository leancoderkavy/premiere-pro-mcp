import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Events = require("../../uxp-plugin/events.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type MutableItem = {
  id: string;
  name: string;
  isFolder?: boolean;
  isClip?: boolean;
  type?: number;
  parent?: MutableItem | null;
  children?: MutableItem[];
  color?: number;
  getId: ReturnType<typeof vi.fn>;
  getItems?: ReturnType<typeof vi.fn>;
  getParentBin: ReturnType<typeof vi.fn>;
  getColorLabelIndex: ReturnType<typeof vi.fn>;
  createSetNameAction: ReturnType<typeof vi.fn>;
  createSetColorLabelAction: ReturnType<typeof vi.fn>;
  createBinAction?: ReturnType<typeof vi.fn>;
  createSmartBinAction?: ReturnType<typeof vi.fn>;
  createMoveItemAction?: ReturnType<typeof vi.fn>;
  createRemoveItemAction?: ReturnType<typeof vi.fn>;
  createSubClipAction?: ReturnType<typeof vi.fn>;
};

function advancedHost() {
  let nextItem = 1;
  const makeItem = (id: string, name: string, options: Partial<MutableItem> = {}): MutableItem => {
    const item = {
      id, name, color: 0, type: options.isFolder ? 2 : 1, parent: null,
      children: options.isFolder ? [] : undefined,
      ...options,
    } as MutableItem;
    item.getId = vi.fn(async () => item.id);
    item.getItems = options.isFolder ? vi.fn(async () => item.children || []) : undefined;
    item.getParentBin = vi.fn(async () => item.parent);
    item.getColorLabelIndex = vi.fn(async () => item.color);
    item.createSetNameAction = vi.fn((name: string) => ({ apply: () => { item.name = name; } }));
    item.createSetColorLabelAction = vi.fn((color: number) => ({ apply: () => { item.color = color; } }));
    if (options.isFolder) {
      item.createBinAction = vi.fn((name: string) => ({ apply: () => {
        const created = makeItem(`created-bin-${nextItem++}`, name, { isFolder: true, parent: item });
        item.children?.push(created);
      } }));
      item.createSmartBinAction = vi.fn((name: string) => ({ apply: () => {
        const created = makeItem(`smart-bin-${nextItem++}`, name, { isFolder: true, parent: item });
        item.children?.push(created);
      } }));
      item.createMoveItemAction = vi.fn((child: MutableItem, destination: MutableItem) => ({ apply: () => {
        if (child.parent?.children) child.parent.children = child.parent.children.filter((value) => value !== child);
        destination.children?.push(child);
        child.parent = destination;
      } }));
      item.createRemoveItemAction = vi.fn((child: MutableItem) => ({ apply: () => {
        item.children = item.children?.filter((value) => value !== child);
      } }));
    }
    if (options.isClip) {
      item.createSubClipAction = vi.fn((name: string) => ({ apply: () => {
        const created = makeItem(`subclip-${nextItem++}`, name, { isClip: true, parent: item.parent });
        item.parent?.children?.push(created);
      } }));
    }
    return item;
  };

  const root = makeItem("root", "Root", { isFolder: true });
  const bin = makeItem("bin-1", "Rushes", { isFolder: true, parent: root });
  const clip = makeItem("clip-1", "Interview.mov", { isClip: true, parent: bin });
  root.children?.push(bin);
  bin.children?.push(clip);

  let markerCounter = 2;
  const makeMarker = (guid: string, name: string, startSeconds = 1) => {
    const state = { name, type: "Comment", comments: "", color: 0, start: startSeconds, duration: 0 };
    return {
      guid,
      getName: vi.fn(async () => state.name),
      getType: vi.fn(async () => state.type),
      getComments: vi.fn(async () => state.comments),
      getColorIndex: vi.fn(async () => state.color),
      getStart: vi.fn(async () => ({ seconds: state.start })),
      getDuration: vi.fn(async () => ({ seconds: state.duration })),
      createSetNameAction: vi.fn((value: string) => ({ apply: () => { state.name = value; } })),
      createSetTypeAction: vi.fn((value: string) => ({ apply: () => { state.type = value; } })),
      createSetCommentsAction: vi.fn((value: string) => ({ apply: () => { state.comments = value; } })),
      createSetDurationAction: vi.fn((value: { seconds: number }) => ({ apply: () => { state.duration = value.seconds; } })),
      createSetColorByIndexAction: vi.fn((value: number) => ({ apply: () => { state.color = value; } })),
      state,
    };
  };
  const markerValues = [makeMarker("marker-1", "Beat")];
  const markers = {
    getMarkers: vi.fn(() => markerValues),
    createAddMarkerAction: vi.fn((name: string, type: string, start: { seconds: number }, duration: { seconds: number }, comments: string) => ({ apply: () => {
      const marker = makeMarker(`marker-${markerCounter++}`, name, start.seconds);
      marker.state.type = type;
      marker.state.duration = duration.seconds;
      marker.state.comments = comments;
      markerValues.push(marker);
    } })),
    createMoveMarkerAction: vi.fn((marker: ReturnType<typeof makeMarker>, time: { seconds: number }) => ({ apply: () => { marker.state.start = time.seconds; } })),
    createRemoveMarkerAction: vi.fn((marker: ReturnType<typeof makeMarker>) => ({ apply: () => markerValues.splice(markerValues.indexOf(marker), 1) })),
  };

  const parameterState = { value: 50, varying: false, keyframes: [] as number[] };
  const parameter = {
    displayName: "Opacity",
    areKeyframesSupported: vi.fn(async () => true),
    isTimeVarying: vi.fn(() => parameterState.varying),
    getKeyframeListAsTickTimes: vi.fn(() => parameterState.keyframes.map((seconds) => ({ seconds }))),
    getStartValue: vi.fn(async () => ({ value: parameterState.value })),
    getValueAtTime: vi.fn(async () => parameterState.value),
    createKeyframe: vi.fn((value: number) => ({ value, position: null as { seconds: number } | null })),
    createSetValueAction: vi.fn((keyframe: { value: number }) => ({ apply: () => { parameterState.value = keyframe.value; } })),
    createSetTimeVaryingAction: vi.fn((value: boolean) => ({ apply: () => { parameterState.varying = value; } })),
    createAddKeyframeAction: vi.fn((keyframe: { position: { seconds: number } }) => ({ apply: () => parameterState.keyframes.push(keyframe.position.seconds) })),
    createRemoveKeyframeAction: vi.fn((time: { seconds: number }) => ({ apply: () => { parameterState.keyframes = parameterState.keyframes.filter((value) => value !== time.seconds); } })),
    createRemoveKeyframeRangeAction: vi.fn((start: { seconds: number }, end: { seconds: number }) => ({ apply: () => { parameterState.keyframes = parameterState.keyframes.filter((value) => value < start.seconds || value > end.seconds); } })),
    createSetInterpolationAtKeyframeAction: vi.fn(() => ({ apply: () => undefined })),
  };
  const component = {
    getMatchName: vi.fn(async () => "ADBE Opacity"),
    getDisplayName: vi.fn(async () => "Opacity"),
    getParamCount: vi.fn(() => 1),
    getParam: vi.fn(() => parameter),
  };
  const chain = { getComponentCount: vi.fn(() => 1), getComponentAtIndex: vi.fn(() => component) };

  const trackState = { name: "Interview V", start: 10, end: 20, inPoint: 0, outPoint: 10, disabled: false };
  const trackItem = {
    getComponentChain: vi.fn(async () => chain),
    getName: vi.fn(async () => trackState.name),
    getStartTime: vi.fn(async () => ({ seconds: trackState.start })),
    getEndTime: vi.fn(async () => ({ seconds: trackState.end })),
    getInPoint: vi.fn(async () => ({ seconds: trackState.inPoint })),
    getOutPoint: vi.fn(async () => ({ seconds: trackState.outPoint })),
    getDuration: vi.fn(async () => ({ seconds: trackState.end - trackState.start })),
    getSpeed: vi.fn(async () => 1),
    isSpeedReversed: vi.fn(async () => false),
    isAdjustmentLayer: vi.fn(async () => false),
    isDisabled: vi.fn(async () => trackState.disabled),
    createMoveAction: vi.fn((time: { seconds: number }) => ({ apply: () => { trackState.start += time.seconds; trackState.end += time.seconds; } })),
    createSetStartAction: vi.fn((time: { seconds: number }) => ({ apply: () => { trackState.start = time.seconds; } })),
    createSetEndAction: vi.fn((time: { seconds: number }) => ({ apply: () => { trackState.end = time.seconds; } })),
    createSetInPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { trackState.inPoint = time.seconds; } })),
    createSetOutPointAction: vi.fn((time: { seconds: number }) => ({ apply: () => { trackState.outPoint = time.seconds; } })),
    createSetDisabledAction: vi.fn((value: boolean) => ({ apply: () => { trackState.disabled = value; } })),
    createSetNameAction: vi.fn((value: string) => ({ apply: () => { trackState.name = value; } })),
  };

  const settingsState = {
    maximumBitDepth: false, maxRenderQuality: false, compositeInLinearColor: false,
    audioSampleRate: 48000, videoFrameRate: 23.976, videoFieldType: 0,
    videoPixelAspectRatio: "square", editingMode: "custom", previewFileFormat: "mpeg",
    previewCodec: "i-frame", videoWidth: 1280, videoHeight: 720,
  };
  const settings = {
    getMaximumBitDepth: vi.fn(async () => settingsState.maximumBitDepth),
    getMaxRenderQuality: vi.fn(async () => settingsState.maxRenderQuality),
    getCompositeInLinearColor: vi.fn(async () => settingsState.compositeInLinearColor),
    getAudioChannelCount: vi.fn(async () => 2),
    getAudioChannelType: vi.fn(async () => 1),
    getAudioSampleRate: vi.fn(async () => ({ value: settingsState.audioSampleRate })),
    getVideoFrameRate: vi.fn(() => ({ value: settingsState.videoFrameRate })),
    getVideoFieldType: vi.fn(async () => settingsState.videoFieldType),
    getVideoPixelAspectRatio: vi.fn(async () => settingsState.videoPixelAspectRatio),
    getEditingMode: vi.fn(async () => settingsState.editingMode),
    getPreviewFileFormat: vi.fn(async () => settingsState.previewFileFormat),
    getPreviewCodec: vi.fn(async () => settingsState.previewCodec),
    getVideoFrameRect: vi.fn(async () => ({ width: settingsState.videoWidth, height: settingsState.videoHeight })),
    getPreviewFrameRect: vi.fn(async () => ({ width: 640, height: 360 })),
    setMaximumBitDepth: vi.fn(async (value: boolean) => { settingsState.maximumBitDepth = value; return true; }),
    setMaxRenderQuality: vi.fn(async (value: boolean) => { settingsState.maxRenderQuality = value; return true; }),
    setCompositeInLinearColor: vi.fn(async (value: boolean) => { settingsState.compositeInLinearColor = value; return true; }),
    setAudioSampleRate: vi.fn(async (value: { value: number }) => { settingsState.audioSampleRate = value.value; return true; }),
    setVideoFrameRate: vi.fn((value: { value: number }) => { settingsState.videoFrameRate = value.value; return true; }),
    setVideoFieldType: vi.fn(async (value: number) => { settingsState.videoFieldType = value; return true; }),
    setVideoPixelAspectRatio: vi.fn(async (value: string) => { settingsState.videoPixelAspectRatio = value; return true; }),
    setEditingMode: vi.fn(async (value: string) => { settingsState.editingMode = value; return true; }),
    setPreviewFileFormat: vi.fn(async (value: string) => { settingsState.previewFileFormat = value; return true; }),
    setPreviewCodec: vi.fn(async (value: string) => { settingsState.previewCodec = value; return true; }),
    setVideoFrameRect: vi.fn(async (value: { width: number; height: number }) => { settingsState.videoWidth = value.width; settingsState.videoHeight = value.height; return true; }),
  };

  const selection = { getTrackItems: vi.fn(async () => [trackItem]) };
  const sequence = {
    guid: "sequence-1", name: "Assembly",
    getSelection: vi.fn(async () => selection),
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => ({ getTrackItems: vi.fn(async () => [trackItem]) })),
    getAudioTrackCount: vi.fn(async () => 1),
    getAudioTrack: vi.fn(async () => ({ getTrackItems: vi.fn(async () => [trackItem]) })),
    getSettings: vi.fn(async () => settings),
    createSetSettingsAction: vi.fn(() => ({ apply: () => undefined })),
    createCloneAction: vi.fn(() => ({ apply: () => sequences.push({ guid: "sequence-2", name: "Assembly Copy" }) })),
    createSubsequence: vi.fn(async () => ({ guid: "sequence-3", name: "Assembly Subsequence" })),
  };
  const sequences: Array<{ guid: string; name: string }> = [sequence];

  const addAction = vi.fn((action: { apply?: () => void }) => { action.apply?.(); return true; });
  const project = {
    guid: "project-1", name: "Documentary",
    getActiveSequence: vi.fn(async () => sequence),
    getSequences: vi.fn(async () => sequences),
    getRootItem: vi.fn(async () => root),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
    importFiles: vi.fn(async (paths: string[], _suppress: boolean, target?: MutableItem) => {
      const parent = target || root;
      for (const path of paths) parent.children?.push(makeItem(`import-${nextItem++}`, path.split("/").at(-1) || path, { isClip: true, parent }));
      return true;
    }),
    importSequences: vi.fn(async () => true),
    importAEComps: vi.fn(async () => true),
    importAllAEComps: vi.fn(async () => true),
    createSequenceFromMedia: vi.fn(async (name: string) => ({ guid: "sequence-created", name })),
    setActiveSequence: vi.fn(async () => true),
    openSequence: vi.fn(async () => true),
    closeSequence: vi.fn(async () => true),
    deleteSequence: vi.fn(async (target: { guid: string }) => { const index = sequences.indexOf(target); if (index >= 0) sequences.splice(index, 1); return true; }),
  };

  const editor = {
    createInsertProjectItemAction: vi.fn(() => ({ apply: () => undefined })),
    createOverwriteItemAction: vi.fn(() => ({ apply: () => undefined })),
    createCloneTrackItemAction: vi.fn(() => ({ apply: () => undefined })),
    createRemoveItemsAction: vi.fn(() => ({ apply: () => undefined })),
    insertMogrtFromPath: vi.fn(() => [trackItem]),
    insertMogrtFromLibrary: vi.fn(() => [trackItem]),
  };
  const manager = {
    isAMEInstalled: true,
    exportSequence: vi.fn(async () => true),
    encodeProjectItem: vi.fn(async () => true),
    encodeFile: vi.fn(async () => true),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    ProjectUtils: {
      getSelection: vi.fn(async () => ({ getItems: vi.fn(async () => [clip]) })),
      getProjectViewIds: vi.fn(async () => ["view-1"]),
      getProjectFromViewId: vi.fn(async () => project),
      getSelectionFromViewId: vi.fn(async () => ({ getItems: vi.fn(async () => [clip]) })),
    },
    Markers: { getMarkers: vi.fn(async () => markers) },
    Marker: { MARKER_TYPE_COMMENT: "Comment" },
    FolderItem: { cast: vi.fn((item: MutableItem) => { if (!item.isFolder) throw new Error("not folder"); return item; }) },
    ClipProjectItem: { cast: vi.fn((item: MutableItem) => { if (!item.isClip) throw new Error("not clip"); return item; }) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    FrameRate: { createWithValue: vi.fn((value: number) => ({ value })) },
    RectF: class RectF { width = 0; height = 0; },
    Guid: { fromString: vi.fn((value: string) => value) },
    Constants: {
      TrackItemType: { CLIP: 1 }, MediaType: { ANY: 0, VIDEO: 1, AUDIO: 2 },
      InterpolationMode: { LINEAR: 1, HOLD: 2, BEZIER: 3, TIME: 4 },
      ExportType: { QUEUE_TO_AME: "ame", QUEUE_TO_APP: "app", IMMEDIATELY: "now" },
    },
    SequenceEditor: { getEditor: vi.fn(() => editor) },
    EncoderManager: {
      getManager: vi.fn(() => manager),
      getExportFileExtension: vi.fn(async () => "mp4"),
      EXPORT_QUEUE_TO_AME: "ame", EXPORT_QUEUE_TO_APP: "app", EXPORT_IMMEDIATELY: "now",
    },
    Utils: { isAEInstalled: vi.fn(async () => true) },
  };
  const workspace = {
    status: vi.fn(() => ({ configured: true, accessMode: "request", rootName: "Approved", persistent: true, pathDisclosure: "redacted", canonicalPathValidation: "available" })),
    assertPathAllowed: vi.fn((path: string) => path.replace(/\\/g, "/")),
  };
  const events = Events.createEventJournal({ capacity: 16 });
  return {
    registry: Commands.createCommandRegistry({ ppro, Protocol, workspace, events }),
    project, ppro, workspace, markers, markerValues, root, bin, clip,
    sequence, sequences, settingsState, parameterState, trackState, editor, manager, events,
  };
}

describe("advanced stable Premiere UXP workflows", () => {
  it("advertises all ten groups from runtime probes and labels filesystem boundaries", async () => {
    const value = advancedHost();
    const capabilities = await value.registry.capabilities();
    expect(Object.keys(capabilities.commands)).toEqual(expect.arrayContaining([
      "projectSelection.views", "projectSelection.inspect", "markers.inspect", "markers.add", "markers.addBeatGrid", "markers.removeMany",
      "bins.inspect", "bins.create", "sequenceSettings.get", "sequenceSettings.update",
      "project.import", "parameters.inspect", "parameters.keyframeAdd", "trackItem.inspect",
      "trackItem.update", "timeline.insert", "timeline.mogrtPath", "sequences.inspect",
      "trackItem.splitEdit",
      "sequences.clone", "encoder.preflight", "encoder.sequence", "encoder.file",
    ]));
    expect(capabilities.commands["projectSelection.inspect"]).toMatchObject({ supported: true, readOnly: true });
    expect(capabilities.commands["markers.add"]).toMatchObject({ supported: true, destructive: true, undoable: true });
    expect(capabilities.commands["markers.addBeatGrid"]).toMatchObject({ supported: true, destructive: true, undoable: true });
    expect(capabilities.commands["markers.removeMany"]).toMatchObject({ supported: true, destructive: true, undoable: true });
    expect(capabilities.commands["project.import"]).toMatchObject({ supported: true, workspaceRequired: true, undoable: false });
    expect(capabilities.commands["encoder.sequence"]).toMatchObject({ supported: true, workspaceRequired: true, undoable: false });
  });

  it("uses Project-view selection and completes marker/bin actions with identity and field readback", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("projectSelection.views", {})).resolves.toMatchObject({
      count: 1, views: [{ viewId: "view-1", projectId: "project-1", projectName: "Documentary" }],
    });
    await expect(value.registry.dispatch("projectSelection.inspect", { viewId: "view-1" })).resolves.toMatchObject({
      count: 1, items: [{ id: "clip-1", name: "Interview.mov" }], resolver: "project_view_selection",
    });
    await expect(value.registry.dispatch("markers.add", {
      name: "Turn", startSeconds: 3, comments: "Cut here", operationId: "marker-add",
    })).resolves.toMatchObject({ added: true, outcome: "verified", marker: { name: "Turn", startSeconds: 3 } });
    await expect(value.registry.dispatch("markers.addBeatGrid", {
      beatTimesSeconds: [1, 2, 3], offsetSeconds: 0.5, namePrefix: "Beat",
      comments: "Detected grid", operationId: "beat-grid",
    })).resolves.toMatchObject({
      added: 3, outcome: "verified", verificationBoundary: "beat_marker_guid_and_time_readback",
      markers: [
        { name: "Beat 1", startSeconds: 1.5 },
        { name: "Beat 2", startSeconds: 2.5 },
        { name: "Beat 3", startSeconds: 3.5 },
      ],
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(2);
    await expect(value.registry.dispatch("markers.update", {
      markerGuid: "marker-1", expectedName: "Beat", name: "Beat updated",
      startSeconds: 2, colorIndex: 4, operationId: "marker-update",
    })).resolves.toMatchObject({
      updated: true, outcome: "verified",
      marker: { guid: "marker-1", name: "Beat updated", startSeconds: 2, colorIndex: 4 },
    });
    await expect(value.registry.dispatch("bins.create", {
      parentBinId: "bin-1", name: "Selects", operationId: "bin-create",
    })).resolves.toMatchObject({ created: true, outcome: "verified", item: { name: "Selects" } });
  });

  it("removes only explicit reviewed marker snapshots in one transaction and replays the operation id", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("markers.add", {
      name: "Remove", startSeconds: 4, durationSeconds: 1.5, operationId: "marker-batch-fixture",
    })).resolves.toMatchObject({ added: true, marker: { guid: "marker-2" } });
    const transactionCount = value.project.executeTransaction.mock.calls.length;
    const args = {
      confirmDestructive: true,
      markerSnapshots: [
        { markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 },
        { markerGuid: "marker-2", expectedName: "Remove", expectedStartSeconds: 4, expectedDurationSeconds: 1.5 },
      ],
      operationId: "marker-batch-remove",
    };

    await expect(value.registry.dispatch("markers.removeMany", args)).resolves.toMatchObject({
      requested: 2, removed: 2, markerGuids: ["marker-1", "marker-2"], remainingTargetGuids: [],
      remainingCount: 0, outcome: "verified", verified: true, verificationBoundary: "marker_guid_absence_readback",
    });
    await expect(value.registry.dispatch("markers.removeMany", args)).resolves.toMatchObject({
      requested: 2, removed: 2, replayed: true,
    });
    expect(value.markers.createRemoveMarkerAction).toHaveBeenCalledTimes(2);
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(transactionCount + 1);
  });

  it("rejects unconfirmed, duplicate, and stale marker batches before creating actions", async () => {
    const value = advancedHost();
    const snapshot = { markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 0, expectedDurationSeconds: 0 };
    await expect(value.registry.dispatch("markers.removeMany", { markerSnapshots: [snapshot] }))
      .rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true, markerSnapshots: [snapshot, snapshot],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true,
      markerSnapshots: [{ ...snapshot, expectedName: "Changed elsewhere" }],
    })).rejects.toMatchObject({ code: "UXP_STALE_MARKER" });
    expect(value.markers.createRemoveMarkerAction).not.toHaveBeenCalled();
    expect(value.project.lockedAccess).not.toHaveBeenCalled();
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("validates marker batch confirmation and bounds before resolving Premiere state", async () => {
    const value = advancedHost();
    const snapshot = { markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 };
    await expect(value.registry.dispatch("markers.removeMany", { markerSnapshots: [snapshot] }))
      .rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true, markerSnapshots: Array.from({ length: 129 }, () => snapshot),
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    expect(value.ppro.Project.getActiveProject).not.toHaveBeenCalled();
    expect(value.ppro.Markers.getMarkers).not.toHaveBeenCalled();
  });

  it("keeps batch-only marker arguments scoped to removeMany", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("markers.add", { name: "Unexpected", confirmDestructive: true }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("markers.update", {
      markerGuid: "marker-1", name: "Unexpected", markerSnapshots: [],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("markers.remove", { markerGuid: "marker-1", confirmDestructive: true }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    expect(value.ppro.Project.getActiveProject).not.toHaveBeenCalled();
    expect(value.ppro.Markers.getMarkers).not.toHaveBeenCalled();
  });

  it("serializes marker updates behind a batch removal snapshot and commit", async () => {
    const value = advancedHost();
    let releaseNameRead: () => void = () => undefined;
    const nameRead = new Promise<void>((resolve) => { releaseNameRead = resolve; });
    const marker = value.markerValues[0];
    marker.getName.mockImplementationOnce(async () => {
      await nameRead;
      return marker.state.name;
    });
    const removing = value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true,
      markerSnapshots: [{ markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 }],
    });
    await Promise.resolve();
    const updating = value.registry.dispatch("markers.update", { markerGuid: "marker-1", name: "Changed concurrently" });
    await Promise.resolve();
    expect(marker.createSetNameAction).not.toHaveBeenCalled();
    releaseNameRead();
    await expect(removing).resolves.toMatchObject({ outcome: "verified", removed: 1 });
    await expect(updating).rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    expect(marker.createSetNameAction).not.toHaveBeenCalled();
  });

  it("reports marker batch deletion as committed-unverified when GUID absence cannot be read back", async () => {
    const value = advancedHost();
    value.markers.createRemoveMarkerAction.mockImplementation(() => ({ apply: () => undefined }));
    await expect(value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true,
      markerSnapshots: [{ markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 }],
    })).resolves.toMatchObject({
      requested: 1, removed: null, remainingTargetGuids: ["marker-1"],
      outcome: "committed_unverified", verified: false, verificationBoundary: "marker_guid_absence_readback",
    });
  });

  it("reads removal fields only for requested markers and confirms absence by GUID without unrelated getters", async () => {
    const value = advancedHost();
    const target = value.markerValues[0];
    const unrelated = {
      ...target,
      guid: "marker-unrelated",
      getName: vi.fn(async () => { throw new Error("unrelated name getter"); }),
      getType: vi.fn(async () => { throw new Error("unrelated type getter"); }),
      getComments: vi.fn(async () => { throw new Error("unrelated comments getter"); }),
      getColorIndex: vi.fn(async () => { throw new Error("unrelated color getter"); }),
      getStart: vi.fn(async () => { throw new Error("unrelated start getter"); }),
      getDuration: vi.fn(async () => { throw new Error("unrelated duration getter"); }),
    };
    value.markerValues.push(unrelated);

    await expect(value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true,
      markerSnapshots: [{ markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 }],
    })).resolves.toMatchObject({
      requested: 1, removed: 1, remainingCount: 1, remainingTargetGuids: [], outcome: "verified",
    });
    expect(target.getName).toHaveBeenCalledOnce();
    expect(target.getStart).toHaveBeenCalledOnce();
    expect(target.getDuration).toHaveBeenCalledOnce();
    expect(unrelated.getName).not.toHaveBeenCalled();
    expect(unrelated.getType).not.toHaveBeenCalled();
    expect(unrelated.getComments).not.toHaveBeenCalled();
    expect(unrelated.getColorIndex).not.toHaveBeenCalled();
    expect(unrelated.getStart).not.toHaveBeenCalled();
    expect(unrelated.getDuration).not.toHaveBeenCalled();
  });

  it("serializes marker update and batch deletion by owner so changed snapshots fail stale without deletion", async () => {
    const value = advancedHost();
    const marker = value.markerValues[0];
    let releaseUpdate = () => undefined;
    let enteredUpdate = () => undefined;
    const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    const updateEntered = new Promise<void>((resolve) => { enteredUpdate = resolve; });
    let enteredRemovalContext = () => undefined;
    const removalContextEntered = new Promise<void>((resolve) => { enteredRemovalContext = resolve; });
    let markerCollectionRequests = 0;
    value.ppro.Markers.getMarkers.mockImplementation(async () => {
      markerCollectionRequests += 1;
      if (markerCollectionRequests === 2) enteredRemovalContext();
      return value.markers;
    });
    let pauseFirstNameRead = true;
    marker.getName.mockImplementation(async () => {
      if (pauseFirstNameRead) {
        pauseFirstNameRead = false;
        enteredUpdate();
        await updateGate;
      }
      return marker.state.name;
    });

    const update = value.registry.dispatch("markers.update", {
      markerGuid: "marker-1", expectedName: "Beat", name: "Renamed", operationId: "marker-update-concurrent",
    });
    await updateEntered;
    const removal = value.registry.dispatch("markers.removeMany", {
      confirmDestructive: true,
      markerSnapshots: [{ markerGuid: "marker-1", expectedName: "Beat", expectedStartSeconds: 1, expectedDurationSeconds: 0 }],
      operationId: "marker-remove-concurrent",
    });
    await removalContextEntered;
    await Promise.resolve();
    await Promise.resolve();
    expect(marker.getName).toHaveBeenCalledTimes(1);
    releaseUpdate();

    await expect(update).resolves.toMatchObject({ updated: true, outcome: "verified", marker: { name: "Renamed" } });
    await expect(removal).rejects.toMatchObject({ code: "UXP_STALE_MARKER" });
    expect(value.markers.createRemoveMarkerAction).not.toHaveBeenCalled();
    expect(value.markerValues).toHaveLength(1);
    expect(value.markerValues[0].state.name).toBe("Renamed");
  });

  it("creates a single-source silence-cut stringout without mutating an existing sequence", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("silence.deriveSequence", {
      sourceProjectItemId: "clip-1", name: "Interview Tight", confirmNonUndoable: true,
      operationId: "silence-stringout", keepRanges: [
        { startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 },
        { startSeconds: 4, endSeconds: 10, startFrame: 120, endFrame: 300 },
      ],
    })).resolves.toMatchObject({
      created: true, partial: false, outcome: "committed_unverified", originalChanged: false,
      createdSubclips: [{ name: "Interview Tight Keep 1" }, { name: "Interview Tight Keep 2" }],
      insertedProjectItemIds: expect.arrayContaining([expect.stringMatching(/^subclip-/)]),
      sequence: { name: "Interview Tight" },
    });
    expect(value.clip.createSubClipAction).toHaveBeenCalledTimes(2);
    expect(value.project.createSequenceFromMedia).toHaveBeenCalledTimes(1);
    expect(value.editor.createInsertProjectItemAction).toHaveBeenCalledTimes(1);
    expect(value.sequence.createCloneAction).not.toHaveBeenCalled();
  });

  it("caches a partial subclip transaction receipt so retry cannot duplicate artifacts", async () => {
    const value = advancedHost();
    value.clip.createSubClipAction
      .mockImplementationOnce((name: string) => ({ apply: () => {
        const created = { ...value.clip, id: "partial-subclip", name, getId: vi.fn(async () => "partial-subclip") };
        value.bin.children?.push(created);
      } }))
      .mockImplementationOnce(() => ({ apply: () => { throw new Error("host rejected second action"); } }));
    const args = {
      sourceProjectItemId: "clip-1", name: "Partial Tight", confirmNonUndoable: true, operationId: "partial-stringout",
      keepRanges: [
        { startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 },
        { startSeconds: 4, endSeconds: 10, startFrame: 120, endFrame: 300 },
      ],
    };
    await expect(value.registry.dispatch("silence.deriveSequence", args)).resolves.toMatchObject({
      partial: true, outcome: "committed_unverified", sequence: null,
      verificationBoundary: "derived_subclip_partial_transaction_receipt",
    });
    await expect(value.registry.dispatch("silence.deriveSequence", args)).resolves.toMatchObject({ partial: true, replayed: true });
    expect(value.clip.createSubClipAction).toHaveBeenCalledTimes(2);
    expect(value.project.createSequenceFromMedia).not.toHaveBeenCalled();
  });

  it("resolves the destination before creating subclips", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("silence.deriveSequence", {
      sourceProjectItemId: "clip-1", targetBinId: "missing-bin", name: "Invalid Target",
      confirmNonUndoable: true, operationId: "invalid-target", keepRanges: [
        { startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 },
      ],
    })).rejects.toThrow("projectItemId was not found");
    expect(value.clip.createSubClipAction).not.toHaveBeenCalled();
    expect(value.project.createSequenceFromMedia).not.toHaveBeenCalled();
  });

  it("does not cache failures that occur before a subclip transaction is attempted", async () => {
    const value = advancedHost();
    const implementation = value.clip.createSubClipAction.getMockImplementation();
    value.clip.createSubClipAction.mockImplementationOnce(() => { throw new Error("cannot construct action"); });
    const args = {
      sourceProjectItemId: "clip-1", name: "Retry Tight", confirmNonUndoable: true,
      operationId: "pre-transaction-retry", keepRanges: [
        { startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 },
      ],
    };
    await expect(value.registry.dispatch("silence.deriveSequence", args)).rejects.toThrow("cannot construct action");
    value.clip.createSubClipAction.mockImplementation(implementation!);
    await expect(value.registry.dispatch("silence.deriveSequence", args)).resolves.toMatchObject({
      created: true, partial: false,
    });
    expect(value.project.createSequenceFromMedia).toHaveBeenCalledTimes(1);
  });

  it("rejects a silence stringout before overflowing the destination bin", async () => {
    const value = advancedHost();
    value.bin.children?.push(...Array.from({ length: 1023 }, () => value.clip));
    await expect(value.registry.dispatch("silence.deriveSequence", {
      sourceProjectItemId: "clip-1", name: "Over Capacity", confirmNonUndoable: true, operationId: "over-capacity",
      keepRanges: [{ startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 }],
    })).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(value.clip.createSubClipAction).not.toHaveBeenCalled();
  });

  it("caches a partial subclip receipt instead of overflowing the sequence collection", async () => {
    const value = advancedHost();
    value.sequences.push(...Array.from({ length: 1023 }, (_, index) => ({ guid: `sequence-${index + 2}`, name: `Existing ${index + 2}` })));
    await expect(value.registry.dispatch("silence.deriveSequence", {
      sourceProjectItemId: "clip-1", name: "Sequence Capacity", confirmNonUndoable: true, operationId: "sequence-capacity",
      keepRanges: [{ startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 }],
    })).resolves.toMatchObject({
      partial: true, verificationBoundary: "derived_sequence_capacity_preflight", sequence: null,
    });
    expect(value.project.createSequenceFromMedia).not.toHaveBeenCalled();
  });

  it("caches a partial receipt when a post-mutation subclip snapshot rejects", async () => {
    const value = advancedHost();
    let idReads = 0;
    value.clip.createSubClipAction.mockImplementationOnce((name: string) => ({ apply: () => {
      const created = {
        ...value.clip, id: "subclip-snapshot-failure", name,
        getId: vi.fn(async () => { idReads += 1; if (idReads === 1) return "subclip-snapshot-failure"; throw new Error("snapshot unavailable"); }),
      };
      value.bin.children?.push(created);
    } }));
    value.ppro.SequenceEditor.getEditor.mockImplementationOnce(() => { throw new Error("editor unavailable"); });
    const args = {
      sourceProjectItemId: "clip-1", name: "Snapshot Tight", confirmNonUndoable: true, operationId: "snapshot-failure",
      keepRanges: [{ startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 }],
    };
    await expect(value.registry.dispatch("silence.deriveSequence", args)).resolves.toMatchObject({
      partial: true, verificationBoundary: "derived_sequence_partial_insert_receipt",
      createdSubclips: [{ id: "", name: "Snapshot Tight Keep 1" }],
    });
    await expect(value.registry.dispatch("silence.deriveSequence", args)).resolves.toMatchObject({ partial: true, replayed: true });
    expect(value.clip.createSubClipAction).toHaveBeenCalledTimes(1);
  });

  it("reconciles a sequence created before its host call rejects", async () => {
    const value = advancedHost();
    value.project.createSequenceFromMedia.mockImplementationOnce(async (name: string) => {
      value.sequences.push({ guid: "sequence-after-error", name });
      throw new Error("host rejected after creation");
    });
    await expect(value.registry.dispatch("silence.deriveSequence", {
      sourceProjectItemId: "clip-1", name: "Recovered Tight", confirmNonUndoable: true, operationId: "sequence-reconcile",
      keepRanges: [{ startSeconds: 0, endSeconds: 2, startFrame: 0, endFrame: 60 }],
    })).resolves.toMatchObject({
      partial: true, verificationBoundary: "derived_sequence_host_reconciliation",
      sequence: { id: "sequence-after-error", name: "Recovered Tight" },
    });
  });

  it("fails the silence-stringout capability probe when required host primitives are absent", async () => {
    const value = advancedHost();
    value.ppro.TickTime.createWithSeconds = undefined;
    const capabilities = await value.registry.capabilities();
    expect(capabilities.commands["silence.deriveSequence"]).toMatchObject({ supported: false });
  });

  it("rejects invalid beat grids before mutation and reports contradictory readback as unverified", async () => {
    const value = advancedHost();
    for (const args of [
      { beatTimesSeconds: [2, 1] },
      { beatTimesSeconds: [1, 1] },
      { beatTimesSeconds: [1], offsetSeconds: -2 },
    ]) {
      await expect(value.registry.dispatch("markers.addBeatGrid", args)).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    }
    expect(value.project.lockedAccess).not.toHaveBeenCalled();

    value.markerValues.push(...Array.from({ length: 2046 }, () => value.markerValues[0]));
    await expect(value.registry.dispatch("markers.addBeatGrid", { beatTimesSeconds: [1, 2] }))
      .rejects.toMatchObject({ code: "UXP_COLLECTION_LIMIT" });
    expect(value.project.lockedAccess).not.toHaveBeenCalled();

    const emptyGuid = advancedHost();
    emptyGuid.markers.createAddMarkerAction.mockImplementation((name: string, type: string, start: { seconds: number }) => ({ apply: () => {
      emptyGuid.markerValues.push({
        ...emptyGuid.markerValues[0], guid: "", getName: vi.fn(async () => name), getType: vi.fn(async () => type),
        getStart: vi.fn(async () => ({ seconds: start.seconds })),
      });
    } }));
    await expect(emptyGuid.registry.dispatch("markers.addBeatGrid", { beatTimesSeconds: [1] }))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false });

    const wrongTime = advancedHost();
    wrongTime.markers.createAddMarkerAction.mockImplementation((name: string, type: string, start: { seconds: number }) => ({ apply: () => {
      wrongTime.markerValues.push({
        ...wrongTime.markerValues[0], guid: "wrong-time-guid", getName: vi.fn(async () => name), getType: vi.fn(async () => type),
        getStart: vi.fn(async () => ({ seconds: start.seconds + 1 })),
      });
    } }));
    await expect(wrongTime.registry.dispatch("markers.addBeatGrid", { beatTimesSeconds: [1] }))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false });

    const wrongName = advancedHost();
    wrongName.markers.createAddMarkerAction.mockImplementation((_name: string, type: string, start: { seconds: number }) => ({ apply: () => {
      wrongName.markerValues.push({
        ...wrongName.markerValues[0], guid: "wrong-name-guid", getName: vi.fn(async () => "Unexpected"), getType: vi.fn(async () => type),
        getStart: vi.fn(async () => ({ seconds: start.seconds })),
      });
    } }));
    await expect(wrongName.registry.dispatch("markers.addBeatGrid", { beatTimesSeconds: [1] }))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false });

    const missingZeroTime = advancedHost();
    missingZeroTime.markers.createAddMarkerAction.mockImplementation((name: string, type: string) => ({ apply: () => {
      missingZeroTime.markerValues.push({
        ...missingZeroTime.markerValues[0], guid: "missing-zero-time-guid", getName: vi.fn(async () => name),
        getType: vi.fn(async () => type), getStart: vi.fn(async () => ({})),
      });
    } }));
    await expect(missingZeroTime.registry.dispatch("markers.addBeatGrid", { beatTimesSeconds: [0] }))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false });
    expect(missingZeroTime.markerValues[0].getName).not.toHaveBeenCalled();
    expect(missingZeroTime.markerValues[0].getStart).not.toHaveBeenCalled();

    const getterFailure = advancedHost();
    getterFailure.markers.createAddMarkerAction.mockImplementation((name: string, type: string, start: { seconds: number }) => ({ apply: () => {
      getterFailure.markerValues.push({
        ...getterFailure.markerValues[0], guid: "getter-failure-guid", getName: vi.fn(async () => { throw new Error("readback failed"); }),
        getType: vi.fn(async () => type), getStart: vi.fn(async () => ({ seconds: start.seconds })),
      });
    } }));
    const getterFailureArgs = { beatTimesSeconds: [1], operationId: "getter-failure-grid" };
    await expect(getterFailure.registry.dispatch("markers.addBeatGrid", getterFailureArgs))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false, added: null, afterCount: null });
    await expect(getterFailure.registry.dispatch("markers.addBeatGrid", getterFailureArgs))
      .resolves.toMatchObject({ outcome: "committed_unverified", verified: false });
    expect(getterFailure.project.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("updates sequence settings, imports workspace media, and automates a typed effect parameter", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("sequenceSettings.update", {
      updates: { maximumBitDepth: true, videoFrameRate: 24, videoWidth: 1920, videoHeight: 1080 },
      operationId: "settings-update",
    })).resolves.toMatchObject({
      updated: true, outcome: "verified",
      after: { maximumBitDepth: true, videoFrameRate: 24, videoFrame: { width: 1920, height: 1080 } },
    });
    await expect(value.registry.dispatch("project.import", {
      mode: "files", paths: ["D:/Approved/broll.mov"], targetBinId: "bin-1",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("project.import", {
      mode: "files", paths: ["D:/Approved/broll.mov"], targetBinId: "bin-1",
      confirmNonUndoable: true, operationId: "import-files",
    })).resolves.toMatchObject({
      imported: true, outcome: "committed_unverified", verified: false, requested: 1,
      observedAddedCount: 1, addedItemIds: [expect.stringMatching(/^import-/)],
    });
    await expect(value.registry.dispatch("parameters.set", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, paramIndex: 0,
      expectedComponentId: "ADBE Opacity", expectedParamName: "Opacity", value: 80,
      operationId: "parameter-set",
    })).resolves.toMatchObject({ updated: true, outcome: "verified", after: { value: 80 } });
    expect(value.workspace.assertPathAllowed).toHaveBeenCalledWith("D:/Approved/broll.mov", {
      label: "paths[0]", kind: "file",
    });
  });

  it("verifies relative track moves while keeping SequenceEditor transaction limits explicit", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("trackItem.update", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, moveBySeconds: 2,
      disabled: true, operationId: "track-move",
    })).resolves.toMatchObject({
      updated: true, outcome: "verified",
      before: { startSeconds: 10, endSeconds: 20, disabled: false },
      after: { startSeconds: 12, endSeconds: 22, disabled: true },
    });
    await expect(value.registry.dispatch("timeline.insert", {
      projectItemId: "clip-1", timeSeconds: 5, videoTrackIndex: 0, audioTrackIndex: 0,
      operationId: "timeline-insert",
    })).resolves.toMatchObject({
      inserted: true, outcome: "committed_unverified", verified: false,
      verificationBoundary: "sequence_editor_transaction",
      operation: { mutatesProject: true, undo: { supported: true } },
    });
    await expect(value.registry.dispatch("timeline.mogrtLibrary", {
      libraryName: "Brand", elementName: "Lower Third", timeSeconds: 5,
      videoTrackIndex: 0, audioTrackIndex: 0, confirmNonUndoable: true,
    })).resolves.toMatchObject({
      inserted: 1, source: "library", outcome: "committed_unverified", verified: false,
      verificationBoundary: "sequence_editor_host_return",
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(2);
  });

  it("creates an atomic L-cut with synchronized timeline and source edges", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("trackItem.splitEdit", {
      kind: "l_cut", audioTrackIndex: 0, audioClipIndex: 0, videoTrackIndex: 0, videoClipIndex: 0,
      extensionSeconds: 2, operationId: "l-cut",
    })).resolves.toMatchObject({
      splitEdit: "l_cut", extensionSeconds: 2, outcome: "verified",
      before: { audio: { endSeconds: 20, outSeconds: 10 }, video: { endSeconds: 20 } },
      after: { endSeconds: 22, outSeconds: 12 },
    });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("uses complete keyframe preflight/readback and reports absent removals as no-ops", async () => {
    const value = advancedHost();
    value.parameterState.keyframes = [1, 2, 3];
    const target = { mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, paramIndex: 0 };

    await expect(value.registry.dispatch("parameters.keyframeRemove", { ...target, timeSeconds: 2 }))
      .resolves.toMatchObject({ removed: true, removalRequested: true, outcome: "verified" });
    await expect(value.registry.dispatch("parameters.keyframeRemove", { ...target, timeSeconds: 2 }))
      .resolves.toMatchObject({ removed: false, unchanged: true, outcome: "verified", operation: { mutatesProject: false } });

    value.parameterState.keyframes = [1, 2, 3];
    await expect(value.registry.dispatch("parameters.keyframeRemoveRange", { ...target, timeSeconds: 1.5, endSeconds: 2.5 }))
      .resolves.toMatchObject({ removed: true, removalRequested: true, outcome: "verified" });
    await expect(value.registry.dispatch("parameters.keyframeRemoveRange", { ...target, timeSeconds: 1.5, endSeconds: 2.5 }))
      .resolves.toMatchObject({ removed: false, unchanged: true, outcome: "verified" });

    value.parameterState.keyframes = Array.from({ length: 257 }, (_, index) => index);
    await expect(value.registry.dispatch("parameters.keyframeRemove", { ...target, timeSeconds: 1 }))
      .rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
  });

  it("keeps direct sequence actions unverified with stable result keys and probes host methods", async () => {
    const value = advancedHost();
    for (const [command, resultField] of [
      ["sequences.activate", "activated"],
      ["sequences.open", "opened"],
      ["sequences.close", "closed"],
    ]) {
      await expect(value.registry.dispatch(command, { sequenceId: "sequence-1" }))
        .resolves.toMatchObject({ [resultField]: true, outcome: "committed_unverified", verified: false, verificationBoundary: "host_return" });
    }
    await expect(value.registry.dispatch("sequences.open", { sequenceId: "sequence-1" })).resolves.not.toHaveProperty("opend");
    await expect(value.registry.dispatch("sequenceSettings.update", {
      updates: { videoFrameRate: 241 },
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });

    delete (value.project as unknown as Record<string, unknown>).importAEComps;
    await expect(value.registry.capabilities()).resolves.toMatchObject({
      commands: { "project.import": { supported: false } },
    });

    const missingClose = advancedHost();
    Reflect.deleteProperty(missingClose.project, "closeSequence");
    await expect(missingClose.registry.capabilities()).resolves.toMatchObject({
      commands: {
        "sequences.activate": { supported: true },
        "sequences.open": { supported: true },
        "sequences.close": { supported: false },
      },
    });

    await expect(value.registry.dispatch("sequences.createFromMedia", {
      name: "New Assembly", projectItemIds: ["clip-1"], confirmNonUndoable: true,
    })).resolves.toMatchObject({
      created: true, outcome: "committed_unverified", verified: false,
      verificationBoundary: "create_sequence_host_return",
    });
    await expect(value.registry.dispatch("sequences.subsequence", {
      sequenceId: "sequence-1", confirmNonUndoable: true,
    })).resolves.toMatchObject({
      created: true, outcome: "committed_unverified", verified: false,
      verificationBoundary: "create_subsequence_host_return",
    });
  });

  it("caches partial receipts when direct sequence creation mutates before rejecting or loses identity", async () => {
    const rejected = advancedHost();
    rejected.project.createSequenceFromMedia.mockImplementationOnce(async (name: string) => {
      rejected.sequences.push({ guid: "sequence-created-before-error", name });
      throw new Error("host rejected after creation");
    });
    await expect(rejected.registry.dispatch("sequences.createFromMedia", {
      name: "Recovered Assembly", projectItemIds: ["clip-1"], confirmNonUndoable: true, operationId: "sequence-host-error",
    })).resolves.toMatchObject({
      created: true, partial: true, verificationBoundary: "create_sequence_host_reconciliation",
      sequence: { id: "sequence-created-before-error", name: "Recovered Assembly" },
    });
    await expect(rejected.registry.dispatch("sequences.createFromMedia", {
      name: "Recovered Assembly", projectItemIds: ["clip-1"], confirmNonUndoable: true, operationId: "sequence-host-error",
    })).resolves.toMatchObject({ partial: true, replayed: true });

    const missingIdentity = advancedHost();
    missingIdentity.project.createSequenceFromMedia.mockResolvedValueOnce({ name: "Unknown identity" });
    await expect(missingIdentity.registry.dispatch("sequences.createFromMedia", {
      name: "Unknown identity", projectItemIds: ["clip-1"], confirmNonUndoable: true,
    })).resolves.toMatchObject({
      created: true, partial: true, verificationBoundary: "create_sequence_identity_readback", sequence: { id: "" },
    });
  });

  it("reconciles a subsequence that exists when the direct host call rejects", async () => {
    const value = advancedHost();
    value.sequence.createSubsequence.mockImplementationOnce(async () => {
      value.sequences.push({ guid: "subsequence-created-before-error", name: "Recovered Subsequence" });
      throw new Error("host rejected after creation");
    });
    await expect(value.registry.dispatch("sequences.subsequence", {
      sequenceId: "sequence-1", confirmNonUndoable: true, operationId: "subsequence-host-error",
    })).resolves.toMatchObject({
      created: true, partial: true, verificationBoundary: "create_subsequence_host_reconciliation",
      sequence: { id: "subsequence-created-before-error", name: "Recovered Subsequence" },
    });
  });

  it("surfaces direct sequence rejections when no created sequence can be reconciled", async () => {
    const sequenceCreation = advancedHost();
    sequenceCreation.project.createSequenceFromMedia.mockRejectedValueOnce(new Error("host rejected"));
    await expect(sequenceCreation.registry.dispatch("sequences.createFromMedia", {
      name: "Rejected Assembly", projectItemIds: ["clip-1"], confirmNonUndoable: true,
    })).rejects.toMatchObject({ code: "UXP_HOST_REJECTED" });

    const subsequenceCreation = advancedHost();
    subsequenceCreation.sequence.createSubsequence.mockRejectedValueOnce(new Error("host rejected"));
    await expect(subsequenceCreation.registry.dispatch("sequences.subsequence", {
      sequenceId: "sequence-1", confirmNonUndoable: true,
    })).rejects.toMatchObject({ code: "UXP_HOST_REJECTED" });
  });

  it("caches partial direct receipts when post-rejection reconciliation cannot be read", async () => {
    const sequenceCreation = advancedHost();
    let sequenceReads = 0;
    sequenceCreation.project.getSequences.mockImplementation(async () => {
      sequenceReads++;
      if (sequenceReads > 1) throw new Error("sequence readback unavailable");
      return sequenceCreation.sequences;
    });
    sequenceCreation.project.createSequenceFromMedia.mockRejectedValueOnce(new Error("host rejected"));
    const sequenceArgs = {
      name: "Unverified Assembly", projectItemIds: ["clip-1"], confirmNonUndoable: true, operationId: "sequence-readback-failed",
    };
    await expect(sequenceCreation.registry.dispatch("sequences.createFromMedia", sequenceArgs)).resolves.toMatchObject({
      created: false, partial: true, verificationBoundary: "create_sequence_reconciliation_readback_failed",
    });
    await expect(sequenceCreation.registry.dispatch("sequences.createFromMedia", sequenceArgs)).resolves.toMatchObject({ partial: true, replayed: true });

    const subsequenceCreation = advancedHost();
    let subsequenceReads = 0;
    subsequenceCreation.project.getSequences.mockImplementation(async () => {
      subsequenceReads++;
      if (subsequenceReads > 2) throw new Error("sequence readback unavailable");
      return subsequenceCreation.sequences;
    });
    subsequenceCreation.sequence.createSubsequence.mockRejectedValueOnce(new Error("host rejected"));
    const subsequenceArgs = {
      sequenceId: "sequence-1", confirmNonUndoable: true, operationId: "subsequence-readback-failed",
    };
    await expect(subsequenceCreation.registry.dispatch("sequences.subsequence", subsequenceArgs)).resolves.toMatchObject({
      created: false, partial: true, verificationBoundary: "create_subsequence_reconciliation_readback_failed",
    });
    await expect(subsequenceCreation.registry.dispatch("sequences.subsequence", subsequenceArgs)).resolves.toMatchObject({ partial: true, replayed: true });
  });

  it("bounds ID-targeted sequence lookup before invoking the host mutation", async () => {
    const value = advancedHost();
    value.project.getSequences.mockResolvedValue(Array.from({ length: 1025 }, (_, index) => ({
      guid: `sequence-${index}`,
      name: `Sequence ${index}`,
    })));

    await expect(value.registry.dispatch("sequences.close", { sequenceId: "sequence-1024" }))
      .rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(value.project.closeSequence).not.toHaveBeenCalled();

    await expect(value.registry.dispatch("sequences.delete", { confirmNonUndoable: true }))
      .rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(value.project.deleteSequence).not.toHaveBeenCalled();
  });

  it("rejects bounded collection additions before starting a host mutation", async () => {
    const markerValue = advancedHost();
    markerValue.markers.getMarkers.mockReturnValue(Array.from({ length: 2048 }, () => markerValue.markerValues[0]));
    await expect(markerValue.registry.dispatch("markers.add", {
      name: "Over capacity", operationId: "marker-capacity",
    })).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(markerValue.markers.createAddMarkerAction).not.toHaveBeenCalled();
    expect(markerValue.project.lockedAccess).not.toHaveBeenCalled();

    const binValue = advancedHost();
    binValue.bin.children = Array.from({ length: 1024 }, () => binValue.clip);
    await expect(binValue.registry.dispatch("bins.create", {
      parentBinId: "bin-1", name: "Over capacity", operationId: "bin-capacity",
    })).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(binValue.bin.createBinAction).not.toHaveBeenCalled();
    expect(binValue.project.lockedAccess).not.toHaveBeenCalled();

    const smartBinValue = advancedHost();
    smartBinValue.bin.children = Array.from({ length: 1024 }, () => smartBinValue.clip);
    await expect(smartBinValue.registry.dispatch("bins.createSmart", {
      parentBinId: "bin-1", name: "Over capacity", searchQuery: "label:red",
      operationId: "smart-bin-capacity",
    })).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(smartBinValue.bin.createSmartBinAction).not.toHaveBeenCalled();
    expect(smartBinValue.project.lockedAccess).not.toHaveBeenCalled();

    const sequenceValue = advancedHost();
    sequenceValue.project.getSequences.mockResolvedValue(Array.from({ length: 1024 }, (_, index) => ({
      guid: `sequence-${index + 1}`,
      name: `Sequence ${index + 1}`,
    })));
    await expect(sequenceValue.registry.dispatch("sequences.clone", {
      operationId: "sequence-capacity",
    })).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(sequenceValue.sequence.createCloneAction).not.toHaveBeenCalled();
    expect(sequenceValue.project.lockedAccess).not.toHaveBeenCalled();
  });

  it("serializes distinct append operations against each target capacity", async () => {
    const markerValue = advancedHost();
    markerValue.markerValues.push(...Array.from({ length: 2046 }, () => markerValue.markerValues[0]));
    const markerResults = await Promise.allSettled([
      markerValue.registry.dispatch("markers.add", { name: "First", operationId: "marker-first" }),
      markerValue.registry.dispatch("markers.add", { name: "Second", operationId: "marker-second" }),
    ]);
    expect(markerResults.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(markerResults.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "UXP_PROJECT_TOO_LARGE" } });
    expect(markerValue.markers.createAddMarkerAction).toHaveBeenCalledOnce();
    expect(markerValue.markerValues).toHaveLength(2048);

    const binValue = advancedHost();
    binValue.bin.children = Array.from({ length: 1023 }, () => binValue.clip);
    const binResults = await Promise.allSettled([
      binValue.registry.dispatch("bins.create", {
        parentBinId: "bin-1", name: "Regular", operationId: "bin-first",
      }),
      binValue.registry.dispatch("bins.createSmart", {
        parentBinId: "bin-1", name: "Smart", searchQuery: "label:red", operationId: "bin-second",
      }),
    ]);
    expect(binResults.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(binResults.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "UXP_PROJECT_TOO_LARGE" } });
    expect((binValue.bin.createBinAction?.mock.calls.length || 0) + (binValue.bin.createSmartBinAction?.mock.calls.length || 0)).toBe(1);
    expect(binValue.bin.children).toHaveLength(1024);

    const sequenceValue = advancedHost();
    sequenceValue.sequences.push(...Array.from({ length: 1022 }, (_, index) => ({
      guid: `existing-sequence-${index}`,
      name: `Existing Sequence ${index}`,
    })));
    const sequenceResults = await Promise.allSettled([
      sequenceValue.registry.dispatch("sequences.clone", { operationId: "sequence-first" }),
      sequenceValue.registry.dispatch("sequences.clone", { operationId: "sequence-second" }),
    ]);
    expect(sequenceResults.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(sequenceResults.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "UXP_PROJECT_TOO_LARGE" } });
    expect(sequenceValue.sequence.createCloneAction).toHaveBeenCalledOnce();
    expect(sequenceValue.sequences).toHaveLength(1024);
  });

  it("clones sequences with identity readback and gates AME writes on explicit confirmation", async () => {
    const value = advancedHost();
    await expect(value.registry.dispatch("sequences.clone", {
      sequenceId: "sequence-1", operationId: "sequence-clone",
    })).resolves.toMatchObject({
      cloned: true, outcome: "verified", source: { id: "sequence-1" },
      sequence: { id: "sequence-2", name: "Assembly Copy" },
    });
    await expect(value.registry.dispatch("encoder.sequence", {
      sequenceId: "sequence-1", exportType: "queueToAme",
      outputFile: "D:/Approved/output.mp4", presetFile: "D:/Approved/h264.epr",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("encoder.sequence", {
      sequenceId: "sequence-1", exportType: "queueToAme",
      outputFile: "D:/Approved/output.mp4", presetFile: "D:/Approved/h264.epr",
      confirmExternalWrite: true, operationId: "encode-sequence",
    })).resolves.toMatchObject({
      queued: true, kind: "sequence", outcome: "committed_unverified", verified: false,
      verificationBoundary: "encoder_host_return",
      encodeJob: { jobId: "encode-sequence", state: "accepted", terminal: false },
    });
    expect(value.manager.exportSequence).toHaveBeenCalledWith(
      expect.objectContaining({ guid: "sequence-1" }), "ame",
      "D:/Approved/output.mp4", "D:/Approved/h264.epr", true,
    );
    value.events.recordHostEvent({ category: "encoder", name: "encoder.queued" });
    value.events.recordHostEvent({ category: "encoder", name: "encoder.complete" });
    await expect(value.registry.dispatch("encoder.wait", {
      jobId: "encode-sequence", timeoutMs: 100,
    })).resolves.toMatchObject({
      timedOut: false,
      job: { state: "completed", terminal: true, verificationBoundary: "encoder_terminal_event_only" },
    });

    const noProject = advancedHost();
    noProject.ppro.Project.getActiveProject.mockResolvedValue(null);
    await expect(noProject.registry.dispatch("encoder.preflight", {})).resolves.toEqual({
      ameInstalled: true, extension: null, sequenceId: null,
    });
  });
});
