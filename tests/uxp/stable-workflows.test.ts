import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function stableHost() {
  const makeComponent = (matchName: string, displayName = matchName) => ({
    getMatchName: vi.fn(async () => matchName),
    getDisplayName: vi.fn(async () => displayName),
    getParamCount: vi.fn(() => 2),
  });
  const components = [makeComponent("Intrinsic", "Intrinsic")];
  const chain = {
    getComponentCount: vi.fn(() => components.length),
    getComponentAtIndex: vi.fn((index: number) => components[index]),
    createAppendComponentAction: vi.fn((component: ReturnType<typeof makeComponent>) => ({ apply: () => components.push(component) })),
    createInsertComponentAction: vi.fn((component: ReturnType<typeof makeComponent>, index: number) => ({ apply: () => components.splice(index, 0, component) })),
    createRemoveComponentAction: vi.fn((component: ReturnType<typeof makeComponent>) => ({ apply: () => components.splice(components.indexOf(component), 1) })),
  };
  const sourceClip = {
    isClip: true,
    name: "Interview.mov",
    getId: vi.fn(async () => "source-1"),
    canProxy: vi.fn(async () => true),
    hasProxy: vi.fn(async () => proxyPath.length > 0),
    getProxyPath: vi.fn(async () => proxyPath),
    attachProxy: vi.fn(async (path: string) => { proxyPath = path; return true; }),
    canChangeMediaPath: vi.fn(async () => true),
    isOffline: vi.fn(async () => offline),
    getMediaFilePath: vi.fn(async () => mediaPath),
    changeMediaFilePath: vi.fn(async (path: string) => { mediaPath = path; offline = false; return true; }),
    refreshMedia: vi.fn(async () => true),
    getFootageInterpretation: vi.fn(async () => footage),
    createSetFootageInterpretationAction: vi.fn(() => ({ apply: () => undefined })),
    getInputLUTID: vi.fn(async () => inputLutId),
    createSetInputLUTIDAction: vi.fn((value: string) => ({ apply: () => { inputLutId = value; } })),
    getEmbeddedLUTID: vi.fn(async () => "embedded-lut"),
  };
  let proxyPath = "", mediaPath = "D:/Approved/missing.mov", offline = true, inputLutId = "";
  const footageValues: Record<string, unknown> = {
    frameRate: 23.976, pixelAspectRatio: 1, fieldType: 1, removePullDown: false,
    alphaUsage: 0, ignoreAlpha: false, invertAlpha: false, vrConform: 0,
    vrLayout: 0, vrHorzView: 180, vrVertView: 180, footageInputLutId: "",
  };
  const getterNames: Record<string, string> = {
    getFrameRate: "frameRate", getPixelAspectRatio: "pixelAspectRatio", getFieldType: "fieldType",
    getRemovePullDown: "removePullDown", getAlphaUsage: "alphaUsage", getIgnoreAlpha: "ignoreAlpha",
    getInvertAlpha: "invertAlpha", getVrConform: "vrConform", getVrLayout: "vrLayout",
    getVrHorzView: "vrHorzView", getVrVertView: "vrVertView", getInputLUTID: "footageInputLutId",
  };
  const setterNames: Record<string, string> = {
    setFrameRate: "frameRate", setPixelAspectRatio: "pixelAspectRatio", setFieldType: "fieldType",
    setRemovePullDown: "removePullDown", setAlphaUsage: "alphaUsage", setIgnoreAlpha: "ignoreAlpha",
    setInvertAlpha: "invertAlpha", setVrConform: "vrConform", setVrLayout: "vrLayout",
    setVrHorzView: "vrHorzView", setVrVertView: "vrVertView", setInputLUTID: "footageInputLutId",
  };
  const footage: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [method, key] of Object.entries(getterNames)) footage[method] = vi.fn(() => footageValues[key]);
  for (const [method, key] of Object.entries(setterNames)) footage[method] = vi.fn((value: unknown) => { footageValues[key] = value; return true; });

  const videoItem = {
    name: "Interview V",
    getTrackIndex: vi.fn(async () => 0),
    getComponentChain: vi.fn(async () => chain),
    getProjectItem: vi.fn(async () => sourceClip),
    getStartTime: vi.fn(async () => ({ seconds: 10 })),
    getEndTime: vi.fn(async () => ({ seconds: 20 })),
  };
  const audioComponents = [makeComponent("Volume", "Volume")];
  const audioChain = {
    getComponentCount: vi.fn(() => audioComponents.length),
    getComponentAtIndex: vi.fn((index: number) => audioComponents[index]),
    createAppendComponentAction: vi.fn((component: ReturnType<typeof makeComponent>) => ({ apply: () => audioComponents.push(component) })),
    createInsertComponentAction: vi.fn((component: ReturnType<typeof makeComponent>, index: number) => ({ apply: () => audioComponents.splice(index, 0, component) })),
    createRemoveComponentAction: vi.fn((component: ReturnType<typeof makeComponent>) => ({ apply: () => audioComponents.splice(audioComponents.indexOf(component), 1) })),
  };
  const audioItem = {
    name: "Interview A",
    getTrackIndex: vi.fn(async () => 0),
    getComponentChain: vi.fn(async () => audioChain),
    getProjectItem: vi.fn(async () => sourceClip),
    getStartTime: vi.fn(async () => ({ seconds: 10 })),
    getEndTime: vi.fn(async () => ({ seconds: 20 })),
  };
  const videoTrack = { getTrackItems: vi.fn(async () => [videoItem]) };
  const audioTrack = { getTrackItems: vi.fn(async () => [audioItem]) };
  type MockTrackItem = typeof videoItem | typeof audioItem;
  let selectedItems: MockTrackItem[] = [videoItem];
  const makeSelection = (initial: MockTrackItem[]) => {
    const items = [...initial];
    return {
      items,
      addItem: vi.fn((item: MockTrackItem, skipDuplicateCheck = false) => {
        if (!skipDuplicateCheck && items.includes(item)) return false;
        items.push(item);
        return true;
      }),
      removeItem: vi.fn((item: MockTrackItem) => {
        const index = items.indexOf(item);
        if (index < 0) return false;
        items.splice(index, 1);
        return true;
      }),
      getTrackItems: vi.fn(async () => [...items]),
    };
  };
  const sequence = {
    guid: "sequence-1",
    getSelection: vi.fn(async () => makeSelection(selectedItems)),
    setSelection: vi.fn((selection: ReturnType<typeof makeSelection>) => {
      selectedItems = [...selection.items];
      return true;
    }),
    clearSelection: vi.fn(async () => { selectedItems = []; return true; }),
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 1),
    getAudioTrack: vi.fn(async () => audioTrack),
  };
  const root = { isFolder: true, getItems: vi.fn(async () => [sourceClip]) };
  let projectMetadata = "project-before", xmpMetadata = "xmp-before", ingestEnabled = false;
  const ingestSettings = {
    getIsIngestEnabled: vi.fn(async () => ingestEnabled),
    setIngestEnabled: vi.fn(async (value: boolean) => { ingestEnabled = value; return true; }),
  };
  const scratchPaths = new Map<number, string>([[0, "capture-before"], [1, "audio-before"], [2, "video-before"]]);
  const scratchSettings = {
    getScratchDiskPath: vi.fn((type: number) => scratchPaths.get(type) ?? "unset"),
    setScratchDiskPath: vi.fn((type: number, destination: number) => { scratchPaths.set(type, `destination-${destination}`); return true; }),
  };
  const addAction = vi.fn((action: { apply?: () => void }) => { action.apply?.(); return true; });
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => sequence),
    getRootItem: vi.fn(async () => root),
    getColorSettings: vi.fn(async () => ({
      getGraphicsWhiteLuminance: vi.fn(async () => 203),
      getSupportedGraphicsWhiteLuminances: vi.fn(async () => [100, 203, 300]),
    })),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  let monitorItem: typeof sourceClip | null = null, monitorPosition = 0;
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    ProjectItem: { cast: vi.fn((item: unknown) => item) },
    ClipProjectItem: { cast: vi.fn((item: { isClip?: boolean }) => { if (!item.isClip) throw new Error("not clip"); return item; }) },
    FolderItem: { cast: vi.fn((item: { isFolder?: boolean }) => { if (!item.isFolder) throw new Error("not folder"); return item; }) },
    ProjectUtils: { getSelection: vi.fn(async () => ({ getItems: vi.fn(async () => [sourceClip]) })) },
    TrackItemSelection: {
      createEmptySelection: vi.fn((callback: (selection: ReturnType<typeof makeSelection>) => void) => {
        callback(makeSelection([]));
        return true;
      }),
    },
    Constants: {
      TrackItemType: { CLIP: 1 },
      ScratchDiskFolderType: { CAPTURE: 0, AUDIO_PREVIEW: 1, VIDEO_PREVIEW: 2, AUTO_SAVE: 3, CCL_LIBRARIES: 4, CAPSULE_MEDIA: 5 },
      ScratchDiskFolder: { SAME_AS_PROJECT: 10, MY_DOCUMENTS: 11 },
    },
    VideoFilterFactory: {
      getMatchNames: vi.fn(async () => ["PR.Test"]),
      getDisplayNames: vi.fn(async () => ["Test Video Effect"]),
      createComponent: vi.fn(async (name: string) => makeComponent(name, "Test Video Effect")),
    },
    AudioFilterFactory: {
      getDisplayNames: vi.fn(async () => ["Test Audio Effect"]),
      createComponentByDisplayName: vi.fn(async (name: string) => makeComponent(name, name)),
    },
    SequenceUtils: {
      SEQUENCE_OPERATION_APPLYCUT: "ApplyCuts",
      SEQUENCE_OPERATION_CREATEMARKER: "CreateMarkers",
      SEQUENCE_OPERATION_CREATESUBCLIP: "CreateSubclips",
      performSceneEditDetectionOnSelection: vi.fn(async () => true),
    },
    ProjectSettings: {
      getIngestSettings: vi.fn(async () => ingestSettings),
      createSetIngestSettingsAction: vi.fn(() => ({ apply: () => undefined })),
      getScratchDiskSettings: vi.fn(async () => scratchSettings),
      createSetScratchDiskSettingsAction: vi.fn(() => ({ apply: () => undefined })),
    },
    Metadata: {
      getProjectMetadata: vi.fn(async () => projectMetadata),
      getXMPMetadata: vi.fn(async () => xmpMetadata),
      createSetProjectMetadataAction: vi.fn((_item: unknown, value: string) => ({ apply: () => { projectMetadata = value; } })),
      createSetXMPMetadataAction: vi.fn((_item: unknown, value: string) => ({ apply: () => { xmpMetadata = value; } })),
    },
    SourceMonitor: {
      getPosition: vi.fn(async () => ({ seconds: monitorPosition })),
      setPosition: vi.fn(async (value: { seconds: number }) => { monitorPosition = value.seconds; return true; }),
      getProjectItem: vi.fn(async () => monitorItem),
      openProjectItem: vi.fn(async (item: typeof sourceClip) => { monitorItem = item; return true; }),
      openFilePath: vi.fn(async () => true),
      play: vi.fn(async () => true),
      closeClip: vi.fn(async () => { monitorItem = null; return true; }),
      closeAllClips: vi.fn(async () => { monitorItem = null; return true; }),
    },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    PRProduction: { getActiveProduction: vi.fn(() => ({ getScratchDiskSettings: vi.fn(async () => scratchSettings) })) },
  };
  const workspace = {
    status: vi.fn(() => ({ configured: true, accessMode: "request", rootName: "Approved", persistent: true, pathDisclosure: "redacted", canonicalPathValidation: "available" })),
    assertPathAllowed: vi.fn((path: string) => path.replace(/\\/g, "/")),
  };
  return {
    registry: Commands.createCommandRegistry({ ppro, Protocol, workspace }),
    ppro, project, sequence, videoItem, audioItem, components, audioComponents, sourceClip, workspace,
    selectedItems: () => [...selectedItems],
    selectMany: (count: number) => { selectedItems = Array.from({ length: count }, () => videoItem); },
    selectAudio: () => { selectedItems = [audioItem]; },
  };
}

describe("stable Premiere UXP workflow expansion", () => {
  it("advertises each workflow from runtime probes and labels workspace-bound commands", async () => {
    const value = stableHost();
    const capabilities = await value.registry.capabilities();
    expect(Object.keys(capabilities.commands)).toEqual(expect.arrayContaining([
      "effects.catalog", "effects.chain.add", "selection.inspect", "selection.fingerprints.inspect", "selection.targets.inspect", "selection.update", "effects.selection.add",
      "sceneEdit.detect", "proxy.attach", "ingest.configure", "media.relink",
      "metadata.update", "color.preflight", "footage.conform", "sourceMonitor.open",
      "storage.preflight", "scratch.configure", "workspace.status",
    ]));
    expect(capabilities.commands["effects.selection.add"]).toMatchObject({
      supported: true, documented: true, destructive: true, undoable: true,
    });
    expect(capabilities.commands["selection.update"]).toMatchObject({
      supported: true, documented: true, readOnly: false, destructive: false,
      undoable: false, idempotent: true, minHostVersion: "25.6.0",
    });
    expect(capabilities.commands["selection.targets.inspect"]).toMatchObject({
      supported: true, documented: true, readOnly: true, targetCapabilityProbe: "invocation",
    });
    expect(capabilities.commands["media.relink"]).toMatchObject({
      supported: true, undoable: false, workspaceRequired: true, targetCapabilityProbe: "invocation",
    });
    expect(capabilities.workspace).toMatchObject({ configured: true, pathDisclosure: "redacted" });
  });

  it("probes Source Monitor state, play, and close commands independently", async () => {
    const missingPlay = stableHost();
    Reflect.deleteProperty(missingPlay.ppro.SourceMonitor, "play");
    const withoutPlay = await missingPlay.registry.capabilities();
    expect(withoutPlay.commands["sourceMonitor.state"]).toMatchObject({ supported: true });
    expect(withoutPlay.commands["sourceMonitor.play"]).toMatchObject({ supported: false });
    expect(withoutPlay.commands["sourceMonitor.close"]).toMatchObject({ supported: true });

    const missingCloseClip = stableHost();
    Reflect.deleteProperty(missingCloseClip.ppro.SourceMonitor, "closeClip");
    const withoutCloseClip = await missingCloseClip.registry.capabilities();
    expect(withoutCloseClip.commands["sourceMonitor.state"]).toMatchObject({ supported: true });
    expect(withoutCloseClip.commands["sourceMonitor.play"]).toMatchObject({ supported: true });
    expect(withoutCloseClip.commands["sourceMonitor.close"]).toMatchObject({ supported: false });

    const missingCloseAll = stableHost();
    Reflect.deleteProperty(missingCloseAll.ppro.SourceMonitor, "closeAllClips");
    const withoutCloseAll = await missingCloseAll.registry.capabilities();
    expect(withoutCloseAll.commands["sourceMonitor.close"]).toMatchObject({ supported: false });
  });

  it("keeps selection inspection available when mutation APIs are unavailable", async () => {
    const missingFactory = stableHost();
    Reflect.deleteProperty(missingFactory.ppro.TrackItemSelection, "createEmptySelection");
    const withoutFactory = await missingFactory.registry.capabilities();
    expect(withoutFactory.commands["selection.inspect"]).toMatchObject({ supported: true, readOnly: true });
    expect(withoutFactory.commands["selection.update"]).toMatchObject({ supported: false, readOnly: false });

    const missingSet = stableHost();
    Reflect.deleteProperty(missingSet.sequence, "setSelection");
    const withoutSet = await missingSet.registry.capabilities();
    expect(withoutSet.commands["selection.inspect"]).toMatchObject({ supported: true });
    expect(withoutSet.commands["selection.update"]).toMatchObject({ supported: false });

    const noProject = stableHost();
    noProject.ppro.Project.getActiveProject.mockResolvedValue(null as never);
    const withoutProject = await noProject.registry.capabilities();
    expect(withoutProject.commands["selection.update"]).toMatchObject({ supported: true });

    const noSequence = stableHost();
    noSequence.project.getActiveSequence.mockResolvedValue(null as never);
    const withoutSequence = await noSequence.registry.capabilities();
    expect(withoutSequence.commands["selection.update"]).toMatchObject({ supported: true });
  });

  it("runs native effect and selection batches as verified action transactions", async () => {
    const value = stableHost();
    await expect(value.registry.dispatch("effects.catalog", { mediaType: "all" })).resolves.toMatchObject({
      video: { matchNames: ["PR.Test"] }, audio: { displayNames: ["Test Audio Effect"] },
    });
    await expect(value.registry.dispatch("effects.chain.add", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, effectId: "PR.Test",
    })).resolves.toMatchObject({ applied: true, outcome: "verified", beforeCount: 1, after: { count: 2 } });
    await expect(value.registry.dispatch("effects.chain.add", {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, effectId: "Test Audio Effect",
    })).resolves.toMatchObject({ applied: true, outcome: "verified", beforeCount: 1, after: { count: 2 } });
    await expect(value.registry.dispatch("selection.inspect", {})).resolves.toMatchObject({
      count: 1, items: [{ mediaType: "video", trackIndex: 0, clipIndex: 0 }],
    });
    await expect(value.registry.dispatch("effects.selection.add", {
      mediaType: "video", effectId: "PR.Test",
    })).resolves.toMatchObject({ applied: 1, outcome: "verified" });
    await expect(value.registry.dispatch("effects.selection.remove", {
      mediaType: "video", componentIndex: 2, expectedEffectId: "PR.Test",
    })).resolves.toMatchObject({ removed: 1, outcome: "verified" });
    await expect(value.registry.dispatch("effects.chain.remove", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 1, expectedEffectId: "PR.Other",
    })).rejects.toMatchObject({ code: "UXP_STALE_EFFECT_CHAIN" });
    expect(value.project.executeTransaction).toHaveBeenCalledTimes(4);
    expect(value.components).toHaveLength(2);
    expect(value.audioComponents).toHaveLength(2);
  });

  it("constructs, updates, clears, and replays deterministic timeline selections", async () => {
    const value = stableHost();
    const video = {
      mediaType: "video", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };
    const audio = {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };

    await expect(value.registry.dispatch("selection.fingerprints.inspect", {})).resolves.toMatchObject({
      sequenceGuid: "sequence-1", count: 1,
      items: [{ mediaType: "video", projectItem: { id: "source-1" }, startSeconds: 10, endSeconds: 20 }],
    });
    await expect(value.registry.dispatch("selection.targets.inspect", {
      items: [
        { mediaType: "video", trackIndex: 0, clipIndex: 0 },
        { mediaType: "audio", trackIndex: 0, clipIndex: 0 },
      ],
    })).resolves.toMatchObject({
      sequenceGuid: "sequence-1", count: 2,
      items: [
        { targetIndex: 0, mediaType: "video", projectItem: { id: "source-1" }, startSeconds: 10, endSeconds: 20 },
        { targetIndex: 1, mediaType: "audio", projectItem: { id: "source-1" }, startSeconds: 10, endSeconds: 20 },
      ],
    });
    await expect(value.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [video, audio], operationId: "selection-1",
    })).resolves.toMatchObject({
      updated: true, changed: true, mode: "replace", count: 2, outcome: "verified",
      verified: "timeline_selection_readback",
      operation: { mutatesProject: false, undo: { supported: false } },
    });
    await expect(value.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [video, audio], operationId: "selection-1",
    })).resolves.toMatchObject({ replayed: true, count: 2 });
    expect(value.sequence.setSelection).toHaveBeenCalledTimes(1);

    await expect(value.registry.dispatch("selection.update", {
      mode: "remove", expectedSequenceGuid: "sequence-1", items: [video], operationId: "selection-2",
    })).resolves.toMatchObject({ count: 1, items: [{ mediaType: "audio" }] });
    await expect(value.registry.dispatch("selection.update", {
      mode: "add", expectedSequenceGuid: "sequence-1", items: [video], operationId: "selection-3",
    })).resolves.toMatchObject({ count: 2 });
    await expect(value.registry.dispatch("selection.update", {
      mode: "clear", expectedSequenceGuid: "sequence-1", operationId: "selection-4",
    })).resolves.toMatchObject({ count: 0, items: [] });
    await expect(value.registry.dispatch("selection.fingerprints.inspect", {})).resolves.toMatchObject({ count: 0, items: [] });
    expect(value.selectedItems()).toEqual([]);
  });

  it("supports the pre-26.3 Promise form of Sequence.setSelection", async () => {
    const value = stableHost();
    const implementation = value.sequence.setSelection.getMockImplementation();
    value.sequence.setSelection.mockImplementation(((selection: unknown) =>
      Promise.resolve(implementation?.(selection as never))) as never);

    await expect(value.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", operationId: "selection-async",
      items: [{
        mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
        expectedStartSeconds: 10, expectedEndSeconds: 20,
      }],
    })).resolves.toMatchObject({ count: 1, items: [{ mediaType: "audio" }] });
  });

  it("enumerates each target track once per selection resolution", async () => {
    const value = stableHost();
    const audioTrack = await value.sequence.getAudioTrack(0);
    const secondAudioItem = {
      ...value.audioItem,
      name: "Interview A 2",
      getStartTime: vi.fn(async () => ({ seconds: 30 })),
      getEndTime: vi.fn(async () => ({ seconds: 40 })),
    };
    audioTrack.getTrackItems.mockResolvedValue([value.audioItem, secondAudioItem]);
    audioTrack.getTrackItems.mockClear();

    await expect(value.registry.dispatch("selection.targets.inspect", {
      items: [
        { mediaType: "audio", trackIndex: 0, clipIndex: 0 },
        { mediaType: "audio", trackIndex: 0, clipIndex: 1 },
      ],
    })).resolves.toMatchObject({
      count: 2,
      items: [
        { targetIndex: 0, startSeconds: 10, endSeconds: 20 },
        { targetIndex: 1, startSeconds: 30, endSeconds: 40 },
      ],
    });
    expect(audioTrack.getTrackItems).toHaveBeenCalledTimes(1);
  });

  it("clears or replaces a manual selection larger than the mutation limit", async () => {
    const target = {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };
    const cleared = stableHost();
    cleared.selectMany(65);
    await expect(cleared.registry.dispatch("selection.update", {
      mode: "clear", expectedSequenceGuid: "sequence-1",
    })).resolves.toMatchObject({ changed: true, count: 0, items: [] });

    const replaced = stableHost();
    replaced.selectMany(65);
    await expect(replaced.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).resolves.toMatchObject({ changed: true, count: 1, items: [{ mediaType: "audio" }] });
  });

  it("revalidates and uses the active sequence immediately before selection mutation", async () => {
    const target = {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };
    const refreshed = stableHost();
    const getSelection = refreshed.sequence.getSelection.getMockImplementation();
    const setSelection = refreshed.sequence.setSelection.getMockImplementation();
    const refreshedSequence = {
      ...refreshed.sequence,
      getSelection: vi.fn(() => getSelection?.()),
      setSelection: vi.fn((selection: Parameters<typeof refreshed.sequence.setSelection>[0]) => setSelection?.(selection)),
    };
    refreshed.sequence.getSelection.mockImplementationOnce(async () => {
      const selection = await getSelection?.();
      refreshed.project.getActiveSequence.mockResolvedValue(refreshedSequence);
      return selection as Awaited<ReturnType<NonNullable<typeof getSelection>>>;
    });
    await expect(refreshed.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).resolves.toMatchObject({ count: 1, items: [{ mediaType: "audio" }] });
    expect(refreshed.sequence.setSelection).not.toHaveBeenCalled();
    expect(refreshedSequence.setSelection).toHaveBeenCalledTimes(1);
    expect(refreshedSequence.getSelection).toHaveBeenCalledTimes(4);

    const switched = stableHost();
    const originalSelection = switched.sequence.getSelection.getMockImplementation();
    const inactiveSequence = { ...switched.sequence, guid: "sequence-2", setSelection: vi.fn() };
    switched.sequence.getSelection.mockImplementationOnce(async () => {
      const selection = await originalSelection?.();
      switched.project.getActiveSequence.mockResolvedValue(inactiveSequence);
      return selection as Awaited<ReturnType<NonNullable<typeof originalSelection>>>;
    });
    await expect(switched.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });
    expect(switched.sequence.setSelection).not.toHaveBeenCalled();
    expect(inactiveSequence.setSelection).not.toHaveBeenCalled();

    const switchedDuringPlan = stableHost();
    const getPlanningSelection = switchedDuringPlan.sequence.getSelection.getMockImplementation();
    const lateInactiveSequence = { ...switchedDuringPlan.sequence, guid: "sequence-2", setSelection: vi.fn() };
    let planningSelectionCalls = 0;
    switchedDuringPlan.sequence.getSelection.mockImplementation(async () => {
      planningSelectionCalls += 1;
      const selection = await getPlanningSelection?.();
      if (planningSelectionCalls === 2) {
        switchedDuringPlan.project.getActiveSequence.mockResolvedValue(lateInactiveSequence);
      }
      return selection as Awaited<ReturnType<NonNullable<typeof getPlanningSelection>>>;
    });
    await expect(switchedDuringPlan.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });
    expect(switchedDuringPlan.sequence.setSelection).not.toHaveBeenCalled();
    expect(lateInactiveSequence.setSelection).not.toHaveBeenCalled();

    const replacedDuringPlan = stableHost();
    const getReplacedSelection = replacedDuringPlan.sequence.getSelection.getMockImplementation();
    const setReplacedSelection = replacedDuringPlan.sequence.setSelection.getMockImplementation();
    const finalAudioItem = { ...replacedDuringPlan.audioItem };
    const finalSequence = {
      ...replacedDuringPlan.sequence,
      getSelection: vi.fn(() => getReplacedSelection?.()),
      setSelection: vi.fn((selection: Parameters<typeof replacedDuringPlan.sequence.setSelection>[0]) =>
        setReplacedSelection?.(selection)),
      getAudioTrack: vi.fn(async () => ({ getTrackItems: vi.fn(async () => [finalAudioItem]) })),
    };
    let replacedSelectionCalls = 0;
    replacedDuringPlan.sequence.getSelection.mockImplementation(async () => {
      replacedSelectionCalls += 1;
      const selection = await getReplacedSelection?.();
      if (replacedSelectionCalls === 2) replacedDuringPlan.project.getActiveSequence.mockResolvedValue(finalSequence as never);
      return selection as Awaited<ReturnType<NonNullable<typeof getReplacedSelection>>>;
    });
    await expect(replacedDuringPlan.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).resolves.toMatchObject({ count: 1, items: [{ mediaType: "audio" }] });
    expect(replacedDuringPlan.sequence.setSelection).not.toHaveBeenCalled();
    expect(finalSequence.setSelection).toHaveBeenCalledWith(expect.objectContaining({ items: [finalAudioItem] }));

    const switchedDuringFinalPlan = stableHost();
    const getFinalPlanningSelection = switchedDuringFinalPlan.sequence.getSelection.getMockImplementation();
    const setFinalPlanningSelection = switchedDuringFinalPlan.sequence.setSelection.getMockImplementation();
    const lateSameGuidSequence = {
      ...switchedDuringFinalPlan.sequence,
      setSelection: vi.fn((selection: Parameters<typeof switchedDuringFinalPlan.sequence.setSelection>[0]) =>
        setFinalPlanningSelection?.(selection)),
    };
    let finalPlanningSelectionCalls = 0;
    switchedDuringFinalPlan.sequence.getSelection.mockImplementation(async () => {
      finalPlanningSelectionCalls += 1;
      const selection = await getFinalPlanningSelection?.();
      if (finalPlanningSelectionCalls === 3) {
        switchedDuringFinalPlan.project.getActiveSequence.mockResolvedValue(lateSameGuidSequence);
      }
      return selection as Awaited<ReturnType<NonNullable<typeof getFinalPlanningSelection>>>;
    });
    await expect(switchedDuringFinalPlan.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).resolves.toMatchObject({ count: 1, items: [{ mediaType: "audio" }] });
    expect(switchedDuringFinalPlan.sequence.setSelection).not.toHaveBeenCalled();
    expect(lateSameGuidSequence.setSelection).toHaveBeenCalledTimes(1);

    const movedDuringFinalFetch = stableHost();
    let activeSequenceCalls = 0;
    let targetMoved = false;
    movedDuringFinalFetch.audioItem.getStartTime.mockImplementation(async () => ({ seconds: targetMoved ? 11 : 10 }));
    movedDuringFinalFetch.project.getActiveSequence.mockImplementation(async () => {
      activeSequenceCalls += 1;
      if (activeSequenceCalls === 4) targetMoved = true;
      return movedDuringFinalFetch.sequence;
    });
    await expect(movedDuringFinalFetch.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SELECTION_TARGET" });
    expect(movedDuringFinalFetch.sequence.setSelection).not.toHaveBeenCalled();
  });

  it("revalidates same-sequence targets and requires native timeline fingerprints", async () => {
    const target = {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };
    const changed = stableHost();
    changed.audioItem.getStartTime
      .mockResolvedValueOnce({ seconds: 10 })
      .mockResolvedValueOnce({ seconds: 10 })
      .mockResolvedValue({ seconds: 11 });
    await expect(changed.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SELECTION_TARGET" });
    expect(changed.sequence.setSelection).not.toHaveBeenCalled();

    const unavailable = stableHost();
    const sourceFallback = vi.fn(async () => ({ seconds: 10 }));
    Object.assign(unavailable.audioItem, { getInPoint: sourceFallback });
    unavailable.audioItem.getStartTime.mockRejectedValueOnce(new Error("timeline time unavailable"));
    await expect(unavailable.registry.dispatch("selection.targets.inspect", {
      items: [{ mediaType: "audio", trackIndex: 0, clipIndex: 0 }],
    })).rejects.toMatchObject({ code: "UXP_SELECTION_FINGERPRINT_UNAVAILABLE" });
    expect(sourceFallback).not.toHaveBeenCalled();

    const missingId = stableHost();
    missingId.sourceClip.getId.mockResolvedValueOnce("");
    await expect(missingId.registry.dispatch("selection.targets.inspect", {
      items: [{ mediaType: "video", trackIndex: 0, clipIndex: 0 }],
    })).rejects.toMatchObject({ code: "UXP_SELECTION_FINGERPRINT_UNAVAILABLE" });

    const currentUnavailable = stableHost();
    const currentSourceFallback = vi.fn(async () => ({ seconds: 10 }));
    Object.assign(currentUnavailable.videoItem, { getInPoint: currentSourceFallback });
    currentUnavailable.videoItem.getStartTime.mockRejectedValue(new Error("timeline time unavailable"));
    await expect(currentUnavailable.registry.dispatch("selection.fingerprints.inspect", {}))
      .rejects.toMatchObject({ code: "UXP_SELECTION_FINGERPRINT_UNAVAILABLE" });
    expect(currentSourceFallback).not.toHaveBeenCalled();

    await expect(currentUnavailable.registry.dispatch("selection.inspect", {})).resolves.toMatchObject({
      count: 1, items: [{ mediaType: "video", startSeconds: 10 }],
    });
    expect(currentSourceFallback).toHaveBeenCalledTimes(1);

    const unclassified = stableHost();
    unclassified.sequence.getVideoTrack.mockResolvedValue({ getTrackItems: vi.fn(async () => []) } as never);
    unclassified.sequence.getAudioTrack.mockResolvedValue({ getTrackItems: vi.fn(async () => []) } as never);
    await expect(unclassified.registry.dispatch("selection.fingerprints.inspect", {}))
      .rejects.toMatchObject({ code: "UXP_UNCLASSIFIED_SELECTION" });
    await expect(unclassified.registry.dispatch("selection.inspect", {})).resolves.toMatchObject({
      count: 1, items: [{ mediaType: "unknown", trackIndex: 0, clipIndex: null }],
    });

    const relative = stableHost();
    const relativeSelection = relative.sequence.getSelection.getMockImplementation();
    let relativeSelectionCalls = 0;
    relative.sequence.getSelection.mockImplementation(async () => {
      relativeSelectionCalls += 1;
      if (relativeSelectionCalls === 4) relative.selectAudio();
      return relativeSelection?.() as ReturnType<NonNullable<typeof relativeSelection>>;
    });
    await expect(relative.registry.dispatch("selection.update", {
      mode: "add", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SELECTION" });
    expect(relative.sequence.setSelection).not.toHaveBeenCalled();
  });

  it("rejects stale, duplicate, oversized, rejected, and mismatched selection updates", async () => {
    const target = {
      mediaType: "audio", trackIndex: 0, clipIndex: 0, expectedProjectItemId: "source-1",
      expectedStartSeconds: 10, expectedEndSeconds: 20,
    };
    const staleSequence = stableHost();
    await expect(staleSequence.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-old", items: [target],
    })).rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });

    const staleTarget = stableHost();
    await expect(staleTarget.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1",
      items: [{ ...target, expectedProjectItemId: "source-old" }],
    })).rejects.toMatchObject({ code: "UXP_STALE_SELECTION_TARGET" });
    expect(staleTarget.sequence.setSelection).not.toHaveBeenCalled();

    const invalid = stableHost();
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "replace", items: [target],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "clear", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "clear", expectedSequenceGuid: "sequence-1", items: null,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1",
      items: [{ ...target, expectedStartSeconds: 21 }],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target, target],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.targets.inspect", {
      items: [
        { mediaType: "video", trackIndex: 0, clipIndex: 0 },
        { mediaType: "video", trackIndex: 0, clipIndex: 0 },
      ],
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(invalid.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1",
      items: Array.from({ length: 65 }, (_, clipIndex) => ({ ...target, clipIndex })),
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });

    const rejected = stableHost();
    rejected.sequence.setSelection.mockReturnValueOnce(false);
    await expect(rejected.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_SELECTION_REJECTED" });

    const clearRejected = stableHost();
    clearRejected.sequence.clearSelection.mockResolvedValueOnce(false);
    await expect(clearRejected.registry.dispatch("selection.update", {
      mode: "clear", expectedSequenceGuid: "sequence-1",
    })).rejects.toMatchObject({ code: "UXP_SELECTION_REJECTED" });

    const mismatch = stableHost();
    mismatch.sequence.setSelection.mockImplementationOnce(() => true);
    await expect(mismatch.registry.dispatch("selection.update", {
      mode: "replace", expectedSequenceGuid: "sequence-1", items: [target],
    })).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });
  });

  it("uses the native selection for all scene-edit modes without claiming undo", async () => {
    const value = stableHost();
    for (const [mode, hostOperation] of [
      ["applyCuts", "ApplyCuts"],
      ["createMarkers", "CreateMarkers"],
      ["createSubclips", "CreateSubclips"],
    ]) {
      await expect(value.registry.dispatch("sceneEdit.detect", { mode })).resolves.toMatchObject({
        detected: true, mode, selectedItemCount: 1, outcome: "committed_unverified",
        operation: { mutatesProject: true, undo: { supported: false } },
      });
      expect(value.ppro.SequenceUtils.performSceneEditDetectionOnSelection)
        .toHaveBeenLastCalledWith(hostOperation, expect.any(Object));
    }
  });

  it("guards non-undoable proxy/relink calls and verifies host readback", async () => {
    const value = stableHost();
    await expect(value.registry.dispatch("proxy.attach", {
      projectItemId: "source-1", mediaPath: "D:/Approved/proxy.mov",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(value.registry.dispatch("proxy.attach", {
      projectItemId: "source-1", mediaPath: "D:/Approved/proxy.mov", confirmNonUndoable: true,
    })).resolves.toMatchObject({ attached: true, outcome: "verified", after: { hasProxy: true } });
    await expect(value.registry.dispatch("proxy.attach", {
      projectItemId: "source-1", mediaPath: "D:/Approved/proxy-2.mov", confirmNonUndoable: true,
    })).rejects.toMatchObject({ code: "UXP_PROXY_ALREADY_ATTACHED" });
    await expect(value.registry.dispatch("ingest.configure", { enabled: true })).resolves.toMatchObject({
      configured: true, outcome: "verified", enabled: true,
    });
    await expect(value.registry.dispatch("media.relink", {
      projectItemId: "source-1", newPath: "D:/Approved/online.mov",
      expectedCurrentPath: "D:/Approved/missing.mov", confirmNonUndoable: true,
    })).resolves.toMatchObject({ relinked: true, outcome: "verified", after: { offline: false } });
    expect(value.workspace.assertPathAllowed).toHaveBeenCalledTimes(3);
  });

  it("updates metadata and footage conformance transactionally with readback", async () => {
    const value = stableHost();
    await expect(value.registry.dispatch("metadata.update", {
      projectItemId: "source-1", projectMetadata: "project-after", xmpMetadata: "xmp-after", updatedFields: ["Column.Intrinsic.LogNote"],
    })).resolves.toMatchObject({ updated: true, outcome: "verified", metadata: { projectMetadata: "project-after", xmpMetadata: "xmp-after" } });
    await expect(value.registry.dispatch("color.preflight", { projectItemId: "source-1" })).resolves.toMatchObject({
      project: { graphicsWhiteLuminance: 203 }, clip: { frameRate: 23.976, embeddedLutId: "embedded-lut" },
    });
    await expect(value.registry.dispatch("footage.conform", {
      projectItemId: "source-1", frameRate: 24, pixelAspectRatio: 1.2, inputLutId: "lut-guid",
    })).resolves.toMatchObject({ conformed: true, outcome: "verified", after: { frameRate: 24, pixelAspectRatio: 1.2, inputLutId: "lut-guid" } });
  });

  it("rejects metadata whose combined serialized UTF-8 result exceeds the frame budget", async () => {
    const value = stableHost();
    value.ppro.Metadata.getProjectMetadata.mockResolvedValueOnce("é".repeat(300000));
    value.ppro.Metadata.getXMPMetadata.mockResolvedValueOnce("é".repeat(300000));
    await expect(value.registry.dispatch("metadata.get", { projectItemId: "source-1" }))
      .rejects.toMatchObject({ code: "UXP_RESULT_TOO_LARGE" });
  });

  it("covers Source Monitor audition and project/Production storage preflight", async () => {
    const value = stableHost();
    await expect(value.registry.dispatch("sourceMonitor.open", { projectItemId: "source-1" })).resolves.toMatchObject({
      opened: true, source: "projectItem", outcome: "verified",
    });
    await expect(value.registry.dispatch("sourceMonitor.open", { filePath: "D:/Approved/take.mov" })).resolves.toMatchObject({
      opened: true, source: "file", outcome: "committed_unverified",
    });
    await expect(value.registry.dispatch("sourceMonitor.play", { speed: 1.5 })).resolves.toMatchObject({ playing: true, speed: 1.5 });
    await expect(value.registry.dispatch("sourceMonitor.close", { all: true })).resolves.toMatchObject({ closed: true, outcome: "verified" });
    await expect(value.registry.dispatch("storage.preflight", {})).resolves.toMatchObject({
      project: { ingestEnabled: false }, production: { apiAvailable: true, active: true },
    });
    await expect(value.registry.dispatch("scratch.configure", {
      folderTypes: ["capture", "autoSave"], destination: "sameAsProject",
    })).resolves.toMatchObject({ configured: true, outcome: "committed_unverified", destination: "sameAsProject" });
    await expect(value.registry.dispatch("workspace.status", {})).resolves.toMatchObject({ configured: true, pathDisclosure: "redacted" });
    expect(value.workspace.assertPathAllowed).toHaveBeenCalledWith("D:/Approved/take.mov", {
      label: "Source Monitor filePath", kind: "file",
    });
  });
});
