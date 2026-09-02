import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type HostOptions = {
  mutateSecondMediaRead?: boolean;
  projectItemCount?: number;
};

function provenanceHost(options: HostOptions = {}) {
  let mediaPath = "C:/media/clip.mov";
  let originatingProjectPath = "C:/projects/origin.prproj";
  let mediaReads = 0;
  const unrelated = {
    getId: vi.fn(() => "unrelated-1"),
    getMediaFilePath: vi.fn(() => { throw new Error("unrelated media path must not be read"); }),
    getOriginatingProjectPath: vi.fn(() => { throw new Error("unrelated origin path must not be read"); }),
  };
  const clip = {
    getId: vi.fn(() => "clip-1"),
    getMediaFilePath: vi.fn(async () => {
      mediaReads += 1;
      if (options.mutateSecondMediaRead && mediaReads === 2) mediaPath = "C:/media/changed.mov";
      return mediaPath;
    }),
    getOriginatingProjectPath: vi.fn(async () => originatingProjectPath),
  };
  const extraItems = options.projectItemCount
    ? Array.from({ length: options.projectItemCount }, (_, index) => ({ getId: () => "extra-" + index }))
    : [];
  const root = {
    getId: vi.fn(() => "root-1"),
    getItems: vi.fn(async () => [clip, unrelated, ...extraItems]),
  };
  const project = {
    guid: "project-1",
    getRootItem: vi.fn(async () => root),
    getActiveSequence: vi.fn(async () => ({ guid: "sequence-1" })),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    FolderItem: { cast: vi.fn((item: unknown) => item === root ? root : null) },
    ClipProjectItem: { cast: vi.fn((item: unknown) => {
      if (item === clip) return clip;
      throw new Error("not a clip");
    }) },
  };
  return {
    clip,
    unrelated,
    project,
    root,
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

const target = {
  projectItemId: "clip-1",
  includeMediaFilePath: true,
  includeOriginatingProjectPath: true,
};

describe("bounded documented UXP source-media provenance workflow", () => {
  it("double-resolves only the requested clip and reads only explicitly selected paths", async () => {
    const value = provenanceHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "source.provenance.inspect": {
        supported: true, readOnly: true, minHostVersion: "26.3.0", targetCapabilityProbe: "invocation",
      },
    } });
    await expect(value.registry.dispatch("source.provenance.inspect", target)).resolves.toEqual({
      projectGuid: "project-1",
      projectItemId: "clip-1",
      mediaFilePath: "C:/media/clip.mov",
      originatingProjectPath: "C:/projects/origin.prproj",
    });
    expect(value.project.getRootItem).toHaveBeenCalledTimes(2);
    expect(value.root.getItems).toHaveBeenCalledTimes(2);
    expect(value.clip.getMediaFilePath).toHaveBeenCalledTimes(2);
    expect(value.clip.getOriginatingProjectPath).toHaveBeenCalledTimes(2);
    expect(value.unrelated.getMediaFilePath).not.toHaveBeenCalled();
    expect(value.unrelated.getOriginatingProjectPath).not.toHaveBeenCalled();
  });

  it("does not read a path whose disclosure flag was not selected", async () => {
    const value = provenanceHost();
    await expect(value.registry.dispatch("source.provenance.inspect", {
      projectItemId: "clip-1", includeOriginatingProjectPath: true,
    })).resolves.toEqual({
      projectGuid: "project-1", projectItemId: "clip-1", originatingProjectPath: "C:/projects/origin.prproj",
    });
    expect(value.clip.getMediaFilePath).not.toHaveBeenCalled();
    expect(value.clip.getOriginatingProjectPath).toHaveBeenCalledTimes(2);
  });

  it("rejects missing path authority, malformed requests, oversized traversal, and non-media targets before a path getter", async () => {
    const value = provenanceHost();
    await expect(value.registry.dispatch("source.provenance.inspect", { projectItemId: "clip-1" }))
      .rejects.toMatchObject({ code: "UXP_PATH_DISCLOSURE_REQUIRED" });
    await expect(value.registry.dispatch("source.provenance.inspect", {
      projectItemId: "clip-1", includeMediaFilePath: "true",
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("source.provenance.inspect", {
      projectItemId: "unrelated-1", includeMediaFilePath: true,
    })).rejects.toMatchObject({ code: "UXP_TARGET_NOT_MEDIA" });
    await expect(provenanceHost({ projectItemCount: 4095 }).registry.dispatch("source.provenance.inspect", {
      projectItemId: "clip-1", includeMediaFilePath: true,
    })).rejects.toMatchObject({ code: "UXP_TARGET_TOO_LARGE" });
    expect(value.clip.getMediaFilePath).not.toHaveBeenCalled();
  });

  it("fails closed when a selected provenance path changes between complete snapshots", async () => {
    const value = provenanceHost({ mutateSecondMediaRead: true });
    await expect(value.registry.dispatch("source.provenance.inspect", target))
      .rejects.toMatchObject({ code: "UXP_STALE_SOURCE_PROVENANCE" });
    expect(value.clip.getMediaFilePath).toHaveBeenCalledTimes(2);
    expect(value.clip.getOriginatingProjectPath).toHaveBeenCalledTimes(2);
  });
});
