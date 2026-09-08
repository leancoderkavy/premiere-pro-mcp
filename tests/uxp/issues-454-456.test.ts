import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/454
// Premiere 26.3 hands back base track items whose documented transition, timing,
// and identity getters only appear through VideoClipTrackItem.cast().
describe("issue #454 — video-transition inspection casts the track item", () => {
  function transitionHost(options: { castable?: boolean } = {}) {
    const clipView = {
      getProjectItem: vi.fn(async () => baseProjectItem),
      getStartTime: vi.fn(async () => ({ seconds: 4 })),
      getEndTime: vi.fn(async () => ({ seconds: 9 })),
      hasVideoTransition: vi.fn(async () => false),
    };
    // The raw item exposes none of the VideoClipTrackItem surface.
    const rawItem = { name: "clip" };
    const projectItemView = { getId: vi.fn(async () => "project-item-1") };
    const baseProjectItem = { name: "source" };
    const videoTrack = { getTrackItems: vi.fn(async () => [rawItem]) };
    const sequence = {
      guid: "sequence-1",
      getVideoTrackCount: vi.fn(async () => 1),
      getVideoTrack: vi.fn(async () => videoTrack),
    };
    const project = { guid: "project-1", getActiveSequence: vi.fn(async () => sequence) };
    const ppro: Record<string, unknown> = {
      Project: { getActiveProject: vi.fn(async () => project) },
      Constants: { TrackItemType: { CLIP: 1 }, TransitionPosition: { START: 0, END: 1 } },
      ProjectItem: { cast: vi.fn((item: unknown) => (item === baseProjectItem ? projectItemView : null)) },
    };
    if (options.castable !== false) {
      ppro.VideoClipTrackItem = { cast: vi.fn((item: unknown) => (item === rawItem ? clipView : null)) };
    }
    return { clipView, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
  }

  const target = { videoTrackIndex: 0, clipIndex: 0, position: "end" };

  it("reads a complete snapshot from an item that only exposes the cast surface", async () => {
    const host = transitionHost();

    await expect(host.registry.dispatch("transition.video.inspect", target)).resolves.toMatchObject({
      target: {
        sequenceGuid: "sequence-1",
        videoTrackIndex: 0,
        clipIndex: 0,
        projectItemId: "project-item-1",
        startSeconds: 4,
        endSeconds: 9,
        position: "end",
        transitionPresent: false,
      },
    });
    expect(host.clipView.hasVideoTransition).toHaveBeenCalled();
  });

  it("names the missing methods when no cast can supply them", async () => {
    await expect(transitionHost({ castable: false }).registry.dispatch("transition.video.inspect", target))
      .rejects.toMatchObject({
        code: "UXP_COMMAND_UNAVAILABLE",
        message: expect.stringContaining("VideoClipTrackItem.getProjectItem"),
      });
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/456
// getId() is documented on ProjectItem, so a bin or clip reached through the
// project tree has to be identified through ProjectItem.cast().
describe("issue #456 — project-item identity resolves through ProjectItem.cast", () => {
  function proxyHost() {
    const clip = {
      canChangeMediaPath: vi.fn(async () => true),
      isOffline: vi.fn(async () => false),
      canProxy: vi.fn(async () => true),
      hasProxy: vi.fn(async () => false),
    };
    // Neither the root bin nor the clip exposes getId directly.
    const root = { getItems: vi.fn(async () => [clip]) };
    const project = { guid: "project-1", getRootItem: vi.fn(async () => root) };
    const ppro = {
      Project: { getActiveProject: vi.fn(async () => project) },
      ProjectItem: { cast: vi.fn((item: unknown) => (item === clip ? { getId: async () => "clip-1" } : null)) },
      FolderItem: { cast: vi.fn((item: unknown) => (item === root ? root : null)) },
      ClipProjectItem: { cast: vi.fn((item: unknown) => (item === clip ? clip : null)) },
    };
    return { registry: Commands.createCommandRegistry({ ppro, Protocol }) };
  }

  it("inspects a proxy target whose ID is only reachable through the cast", async () => {
    await expect(proxyHost().registry.dispatch("source.proxy.inspect", { projectItemId: "clip-1" })).resolves.toEqual({
      projectGuid: "project-1",
      projectItemId: "clip-1",
      canChangeMediaPath: true,
      isOffline: false,
      canProxy: true,
      hasProxy: false,
    });
  });

  it("still reports an honest capability error when no cast exposes getId", async () => {
    const clip = { canProxy: vi.fn(async () => true) };
    const root = { getItems: vi.fn(async () => [clip]), getId: vi.fn(async () => "root-1") };
    const project = { guid: "project-1", getRootItem: vi.fn(async () => root) };
    const registry = Commands.createCommandRegistry({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        FolderItem: { cast: vi.fn((item: unknown) => (item === root ? root : null)) },
        ClipProjectItem: { cast: vi.fn(() => null) },
      },
      Protocol,
    });

    // The requested ID is never found because nothing can answer for identity.
    await expect(registry.dispatch("source.proxy.inspect", { projectItemId: "clip-1" }))
      .rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
  });

  it("identifies a timeline clip's source through ProjectItem.cast for source labels", async () => {
    const source = {
      getColorLabelIndex: vi.fn(async () => 3),
    };
    const rawSourceItem = { name: "source" };
    const trackItem = {
      getProjectItem: vi.fn(async () => rawSourceItem),
      getStartTime: vi.fn(async () => ({ seconds: 1 })),
      getEndTime: vi.fn(async () => ({ seconds: 6 })),
    };
    const videoTrack = { getTrackItems: vi.fn(async () => [trackItem]) };
    const sequence = {
      guid: "sequence-1",
      getVideoTrackCount: vi.fn(async () => 1),
      getVideoTrack: vi.fn(async () => videoTrack),
    };
    const project = { guid: "project-1", getActiveSequence: vi.fn(async () => sequence) };
    const registry = Commands.createCommandRegistry({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        Constants: { TrackItemType: { CLIP: 1 } },
        ClipProjectItem: { cast: vi.fn((item: unknown) => (item === rawSourceItem ? source : null)) },
        ProjectItem: { cast: vi.fn((item: unknown) => (item === rawSourceItem ? { getId: async () => "source-1" } : null)) },
      },
      Protocol,
    });

    await expect(registry.dispatch("timeline.sourceLabel.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0,
    })).resolves.toMatchObject({
      sourceProjectItemId: "source-1",
      sourceColorLabelIndex: 3,
    });
  });
});
