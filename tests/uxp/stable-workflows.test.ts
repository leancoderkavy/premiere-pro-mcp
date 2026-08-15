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
  const selection = { getTrackItems: vi.fn(async () => [videoItem]) };
  const sequence = {
    guid: "sequence-1",
    getSelection: vi.fn(async () => selection),
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
    status: vi.fn(() => ({ configured: true, accessMode: "request", rootName: "Approved", persistent: true, pathDisclosure: "redacted" })),
    assertPathAllowed: vi.fn((path: string) => path.replace(/\\/g, "/")),
  };
  return {
    registry: Commands.createCommandRegistry({ ppro, Protocol, workspace }),
    ppro, project, components, audioComponents, sourceClip, workspace,
  };
}

describe("stable Premiere UXP workflow expansion", () => {
  it("advertises each workflow from runtime probes and labels workspace-bound commands", async () => {
    const value = stableHost();
    const capabilities = await value.registry.capabilities();
    expect(Object.keys(capabilities.commands)).toEqual(expect.arrayContaining([
      "effects.catalog", "effects.chain.add", "selection.inspect", "effects.selection.add",
      "sceneEdit.detect", "proxy.attach", "ingest.configure", "media.relink",
      "metadata.update", "color.preflight", "footage.conform", "sourceMonitor.open",
      "storage.preflight", "scratch.configure", "workspace.status",
    ]));
    expect(capabilities.commands["effects.selection.add"]).toMatchObject({
      supported: true, documented: true, destructive: true, undoable: true,
    });
    expect(capabilities.commands["media.relink"]).toMatchObject({
      supported: true, undoable: false, workspaceRequired: true, targetCapabilityProbe: "invocation",
    });
    expect(capabilities.workspace).toMatchObject({ configured: true, pathDisclosure: "redacted" });
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
