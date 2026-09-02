import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type Options = {
  replaceItemOnSecondRootRead?: boolean;
  getRootItem?: boolean;
};

function nativeGuid(value: string) {
  return { toString: vi.fn(() => value) };
}

function uniqueIdentityHost(options: Options = {}) {
  const originalItem = { uniqueId: "unique-item-1", getId: vi.fn(async () => "item-1") };
  const replacementItem = { uniqueId: "unique-item-2", getId: vi.fn(async () => "item-1") };
  let currentItem = originalItem;
  const root = {
    getId: vi.fn(async () => "root"),
    getItems: vi.fn(async () => [currentItem]),
  };
  const sequence = { guid: nativeGuid("sequence-1"), uniqueId: "unique-sequence-1" };
  let rootReads = 0;
  const project = {
    guid: nativeGuid("project-1"),
    getActiveSequence: vi.fn(async () => null),
    getRootItem: vi.fn(async () => {
      rootReads += 1;
      if (options.replaceItemOnSecondRootRead && rootReads > 1) currentItem = replacementItem;
      return root;
    }),
    getSequence: vi.fn(async (guid: { toString: () => string }) =>
      guid.toString() === "sequence-1" ? sequence : null),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    Guid: { fromString: vi.fn((value: string) => nativeGuid(value)) },
    UniqueSerializeable: {
      cast: vi.fn((target: { uniqueId?: string }) => ({
        getUniqueID: vi.fn(async () => nativeGuid(target.uniqueId || "")),
      })),
    },
  };
  return {
    root,
    project,
    ppro,
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

describe("bounded documented UXP unique serializable identity inspection", () => {
  it("advertises a read-only target-probed command and double-reads one project-item identity", async () => {
    const value = uniqueIdentityHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "object.uniqueIdentity.inspect": {
        supported: true,
        readOnly: true,
        minHostVersion: "25.6.0",
        targetCapabilityProbe: "invocation",
      },
    } });

    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", {
      projectItemId: "item-1",
      expectedProjectGuid: "project-1",
      expectedUniqueId: "unique-item-1",
    })).resolves.toEqual({
      projectGuid: "project-1",
      target: { kind: "project_item", projectItemId: "item-1", uniqueId: "unique-item-1" },
      verificationBoundary: "bounded_unique_serializable_double_readback",
    });
    expect(value.project.getRootItem).toHaveBeenCalledTimes(2);
    expect(value.ppro.UniqueSerializeable.cast).toHaveBeenCalledTimes(2);
  });

  it("resolves an exact sequence GUID without traversing the project tree", async () => {
    const value = uniqueIdentityHost();
    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", {
      sequenceGuid: "sequence-1",
    })).resolves.toMatchObject({
      projectGuid: "project-1",
      target: { kind: "sequence", sequenceGuid: "sequence-1", uniqueId: "unique-sequence-1" },
    });
    expect(value.project.getRootItem).not.toHaveBeenCalled();
    expect(value.project.getSequence).toHaveBeenCalledTimes(2);
    expect(value.ppro.Guid.fromString).toHaveBeenCalledTimes(2);
  });

  it("rejects ambiguous, stale, unsupported, and oversized requests", async () => {
    const value = uniqueIdentityHost();
    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", {}))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", {
      projectItemId: "item-1", sequenceGuid: "sequence-1",
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", {
      projectItemId: "item-1", expectedUniqueId: "different",
    })).rejects.toMatchObject({ code: "UXP_STALE_UNIQUE_IDENTITY" });

    const tooLarge = uniqueIdentityHost();
    tooLarge.root.getItems.mockResolvedValueOnce(Array.from({ length: 512 }, (_, index) => ({
      getId: vi.fn(async () => `item-${index}`),
    })));
    await expect(tooLarge.registry.dispatch("object.uniqueIdentity.inspect", { projectItemId: "missing" }))
      .rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
  });

  it("fails closed when a retained project-item ID resolves to a replacement during the second read", async () => {
    const value = uniqueIdentityHost({ replaceItemOnSecondRootRead: true });
    await expect(value.registry.dispatch("object.uniqueIdentity.inspect", { projectItemId: "item-1" }))
      .rejects.toMatchObject({ code: "UXP_STALE_UNIQUE_IDENTITY" });
  });

  it("does not advertise compatibility when the documented unique serializable static API is absent", async () => {
    const value = uniqueIdentityHost();
    delete (value.ppro as { UniqueSerializeable?: unknown }).UniqueSerializeable;
    const registry = Commands.createCommandRegistry({ ppro: value.ppro, Protocol });
    await expect(registry.capabilities()).resolves.toMatchObject({ commands: {
      "object.uniqueIdentity.inspect": { supported: false, reason: expect.any(String) },
    } });
  });
});
