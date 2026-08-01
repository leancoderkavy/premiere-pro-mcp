import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function adobe263Host() {
  const audioTrack = { name: "A1", createSetNameAction: vi.fn((name: string) => ({ apply: () => { audioTrack.name = name; } })) };
  const videoTrack = { name: "V1", createSetNameAction: vi.fn((name: string) => ({ apply: () => { videoTrack.name = name; } })) };
  const captionTrack = { name: "Captions", createSetNameAction: vi.fn((name: string) => ({ apply: () => { captionTrack.name = name; } })) };
  const marker = {
    guid: { toString: () => "marker-guid-1" },
    getName: vi.fn(() => "Review"), getComments: vi.fn(() => "Check this cut"), getType: vi.fn(() => "Comment"),
    getColorIndex: vi.fn(() => 6), getStart: vi.fn(() => ({ seconds: 12.5 })), getDuration: vi.fn(() => ({ seconds: 1.25 })),
  };
  const source = {
    id: "source-1", name: "Interview", isClip: true,
    getId: vi.fn(() => "source-1"),
    createSubClipAction: vi.fn((name: string) => ({ apply: () => {
      rootItems.push({ id: "subclip-1", name, isClip: true, getId: () => "subclip-1" });
    } })),
  };
  const rootItems: Array<Record<string, unknown>> = [source];
  const root = { isFolder: true, getItems: vi.fn(async () => rootItems) };
  const sequence = {
    guid: "sequence-1",
    getAudioTrackCount: vi.fn(async () => 1), getAudioTrack: vi.fn(async () => audioTrack),
    getVideoTrackCount: vi.fn(async () => 1), getVideoTrack: vi.fn(async () => videoTrack),
    getCaptionTrackCount: vi.fn(async () => 1), getCaptionTrack: vi.fn(async () => captionTrack),
  };
  const addAction = vi.fn((action: { apply?: () => void }) => { action.apply?.(); return true; });
  const project = {
    getActiveSequence: vi.fn(async () => sequence), getRootItem: vi.fn(async () => root),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: { addAction: typeof addAction }) => void) => { callback({ addAction }); return true; }),
  };
  let sourcePosition = 0;
  const aafOptionValues: Record<string, unknown> = {};
  const aafOptions = {
    setMixdownVideo: vi.fn((value: boolean) => { aafOptionValues.mixdownVideo = value; }),
    setSampleRate: vi.fn((value: number) => { aafOptionValues.sampleRate = value; }),
    setAudioFileFormat: vi.fn((value: number) => { aafOptionValues.audioFileFormat = value; }),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    ClipProjectItem: { cast: vi.fn((item: { isClip?: boolean }) => { if (!item.isClip) throw new Error("not a clip"); return item; }) },
    ProjectItem: { cast: vi.fn((item: unknown) => item) },
    FolderItem: { cast: vi.fn((item: { isFolder?: boolean }) => { if (!item.isFolder) throw new Error("not a folder"); return item; }) },
    Markers: { getMarkers: vi.fn(async () => ({ getMarkers: vi.fn(async () => [marker]) })) },
    SourceMonitor: {
      setPosition: vi.fn(async (position: { seconds: number }) => { sourcePosition = position.seconds; return true; }),
      getPosition: vi.fn(async () => ({ seconds: sourcePosition })),
    },
    AAFExportOptions: vi.fn(() => aafOptions),
    Constants: { AAFExportAudioFormat: { AIFF: 0, WAV: 1 } },
    ProjectConverter: { exportAAF: vi.fn(async () => true) },
  };
  return {
    registry: Commands.createCommandRegistry({ ppro, Protocol }), ppro, project, source, audioTrack, marker, aafOptionValues,
  };
}

describe("Adobe Premiere Pro 26.3 UXP commands", () => {
  it("uses locked undoable action transactions for track renames and subclip creation, then reads both back", async () => {
    const value = adobe263Host();
    await expect(value.registry.dispatch("track.rename", {
      trackType: "audio", trackIndex: 0, name: "Dialogue", operationId: "track-1",
    })).resolves.toMatchObject({ renamed: true, name: "Dialogue", outcome: "verified", operationId: "track-1" });
    await expect(value.registry.dispatch("subclip.create", {
      projectItemId: "source-1", name: "Interview Select", startSeconds: 3, endSeconds: 9,
    })).resolves.toMatchObject({
      created: true, outcome: "verified", subclip: { projectItemId: "subclip-1", name: "Interview Select" },
    });
    expect(value.project.lockedAccess).toHaveBeenCalledTimes(2);
    expect(value.audioTrack.createSetNameAction).toHaveBeenCalledWith("Dialogue");
    expect(value.source.createSubClipAction).toHaveBeenCalledWith(
      "Interview Select", { seconds: 3 }, { seconds: 9 }, false, { takeVideo: true, takeAudio: true },
    );
  });

  it("returns stable marker GUIDs, verifies Source Monitor positioning, and applies bounded AAF options", async () => {
    const value = adobe263Host();
    await expect(value.registry.dispatch("marker.list", {})).resolves.toMatchObject({
      scope: "sequence", count: 1, markers: [{ guid: "marker-guid-1", startSeconds: 12.5, durationSeconds: 1.25 }],
    });
    await expect(value.registry.dispatch("sourceMonitor.position.set", { seconds: 4.5 })).resolves.toMatchObject({
      positioned: true, seconds: 4.5, outcome: "verified",
    });
    await expect(value.registry.dispatch("interchange.aaf.export", {
      outputFilePath: "/exports/edit.aaf",
      options: { mixdownVideo: true, sampleRate: 48000, audioFileFormat: "wav" },
    })).resolves.toMatchObject({ exported: true, format: "aaf", outcome: "committed_unverified", outputVerified: false });
    expect(value.aafOptionValues).toEqual({ mixdownVideo: true, sampleRate: 48000, audioFileFormat: 1 });
  });

  it("rejects unsafe subclip ranges and unbounded AAF options before invoking the host", async () => {
    const value = adobe263Host();
    await expect(value.registry.dispatch("subclip.create", {
      projectItemId: "source-1", name: "Invalid", startSeconds: 9, endSeconds: 3,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("interchange.aaf.export", {
      outputFilePath: "/exports/edit.aaf", options: { sampleRate: 12345 },
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
  });
});
