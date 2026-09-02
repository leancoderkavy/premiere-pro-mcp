import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type HostOptions = {
  mutateSecondProxyRead?: boolean;
  projectItemCount?: number;
  hasProxy?: boolean;
};

function proxyHost(options: HostOptions = {}) {
  let proxyPath = "C:/proxies/clip-proxy.mov";
  let proxyReads = 0;
  const state = {
    canChangeMediaPath: true,
    isOffline: false,
    canProxy: true,
    hasProxy: options.hasProxy ?? true,
  };
  const unrelated = {
    getId: vi.fn(() => "unrelated-1"),
    canChangeMediaPath: vi.fn(() => { throw new Error("unrelated proxy state must not be read"); }),
    isOffline: vi.fn(() => { throw new Error("unrelated proxy state must not be read"); }),
    canProxy: vi.fn(() => { throw new Error("unrelated proxy state must not be read"); }),
    hasProxy: vi.fn(() => { throw new Error("unrelated proxy state must not be read"); }),
    getProxyPath: vi.fn(() => { throw new Error("unrelated proxy path must not be read"); }),
  };
  const clip = {
    getId: vi.fn(() => "clip-1"),
    canChangeMediaPath: vi.fn(async () => state.canChangeMediaPath),
    isOffline: vi.fn(async () => state.isOffline),
    canProxy: vi.fn(async () => state.canProxy),
    hasProxy: vi.fn(async () => state.hasProxy),
    getProxyPath: vi.fn(async () => {
      proxyReads += 1;
      if (options.mutateSecondProxyRead && proxyReads === 2) proxyPath = "C:/proxies/changed.mov";
      return proxyPath;
    }),
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

const target = { projectItemId: "clip-1", includeProxyPath: true };

describe("bounded documented UXP source-proxy inspection workflow", () => {
  it("double-resolves only the requested clip and reads the proxy path only with explicit opt-in", async () => {
    const value = proxyHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "source.proxy.inspect": {
        supported: true, readOnly: true, minHostVersion: "26.3.0", targetCapabilityProbe: "invocation",
      },
    } });
    await expect(value.registry.dispatch("source.proxy.inspect", target)).resolves.toEqual({
      projectGuid: "project-1",
      projectItemId: "clip-1",
      canChangeMediaPath: true,
      isOffline: false,
      canProxy: true,
      hasProxy: true,
      proxyPath: "C:/proxies/clip-proxy.mov",
    });
    expect(value.project.getRootItem).toHaveBeenCalledTimes(2);
    expect(value.root.getItems).toHaveBeenCalledTimes(2);
    expect(value.clip.canChangeMediaPath).toHaveBeenCalledTimes(2);
    expect(value.clip.isOffline).toHaveBeenCalledTimes(2);
    expect(value.clip.canProxy).toHaveBeenCalledTimes(2);
    expect(value.clip.hasProxy).toHaveBeenCalledTimes(2);
    expect(value.clip.getProxyPath).toHaveBeenCalledTimes(2);
    expect(value.unrelated.canChangeMediaPath).not.toHaveBeenCalled();
    expect(value.unrelated.getProxyPath).not.toHaveBeenCalled();
  });

  it("does not query a proxy path without opt-in or when no proxy is attached", async () => {
    const noOptIn = proxyHost();
    await expect(noOptIn.registry.dispatch("source.proxy.inspect", { projectItemId: "clip-1" })).resolves.toMatchObject({
      projectGuid: "project-1", projectItemId: "clip-1", hasProxy: true,
    });
    expect(noOptIn.clip.getProxyPath).not.toHaveBeenCalled();

    const noProxy = proxyHost({ hasProxy: false });
    await expect(noProxy.registry.dispatch("source.proxy.inspect", target)).resolves.toMatchObject({
      projectGuid: "project-1", projectItemId: "clip-1", hasProxy: false,
    });
    expect(noProxy.clip.getProxyPath).not.toHaveBeenCalled();
  });

  it("rejects malformed requests, non-media targets, and oversized traversal before any target proxy getter", async () => {
    const value = proxyHost();
    await expect(value.registry.dispatch("source.proxy.inspect", { projectItemId: "clip-1", includeProxyPath: "true" }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("source.proxy.inspect", { projectItemId: "unrelated-1" }))
      .rejects.toMatchObject({ code: "UXP_TARGET_NOT_MEDIA" });
    await expect(proxyHost({ projectItemCount: 4095 }).registry.dispatch("source.proxy.inspect", { projectItemId: "clip-1" }))
      .rejects.toMatchObject({ code: "UXP_TARGET_TOO_LARGE" });
    expect(value.clip.canChangeMediaPath).not.toHaveBeenCalled();
  });

  it("fails closed when an explicitly selected proxy path changes between complete snapshots", async () => {
    const value = proxyHost({ mutateSecondProxyRead: true });
    await expect(value.registry.dispatch("source.proxy.inspect", target))
      .rejects.toMatchObject({ code: "UXP_STALE_SOURCE_PROXY" });
    expect(value.clip.getProxyPath).toHaveBeenCalledTimes(2);
  });
});
