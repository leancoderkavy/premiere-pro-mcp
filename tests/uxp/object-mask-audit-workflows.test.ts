import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type Options = { sequenceMasks?: Record<string, boolean>; changeSequenceMaskOnSecondRead?: boolean; disappearOnSecondLookup?: boolean };

function objectMaskHost(options: Options = {}) {
  const sequences = [
    { guid: "sequence-b", name: "B sequence" },
    { guid: "sequence-a", name: "A sequence" },
  ];
  const sequenceMasks = new Map(Object.entries({ "sequence-a": false, "sequence-b": true, ...options.sequenceMasks }));
  const sequenceCalls = new Map<string, number>();
  let sequenceLookupCalls = 0;
  const project = {
    guid: "project-1",
    getActiveSequence: vi.fn(async () => null),
    getSequences: vi.fn(async () => sequences),
    getSequence: vi.fn(async (guid: { toString: () => string }) => {
      sequenceLookupCalls += 1;
      if (options.disappearOnSecondLookup && sequenceLookupCalls > 1) return null;
      return sequences.find((sequence) => sequence.guid === guid.toString()) || null;
    }),
  };
  const hasObjectMask = vi.fn((target: typeof project | (typeof sequences)[number]) => {
    if (target === project) return Array.from(sequenceMasks.values()).some(Boolean);
    const sequence = target as (typeof sequences)[number];
    const calls = (sequenceCalls.get(sequence.guid) || 0) + 1;
    sequenceCalls.set(sequence.guid, calls);
    if (options.changeSequenceMaskOnSecondRead && sequence.guid === "sequence-a" && calls > 1) return true;
    return sequenceMasks.get(sequence.guid) || false;
  });
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    Guid: { fromString: vi.fn((value: string) => ({ toString: () => value })) },
    ObjectMaskUtils: { hasObjectMask },
  };
  return { project, sequences, ppro, hasObjectMask, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

describe("bounded documented UXP object-mask audit", () => {
  it("advertises a read-only target-probed audit and double-reads a deterministic full-project sequence result", async () => {
    const value = objectMaskHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "objectMask.audit": { supported: true, readOnly: true, minHostVersion: "26.3.0", targetCapabilityProbe: "invocation" },
    } });
    await expect(value.registry.dispatch("objectMask.audit", {})).resolves.toEqual({
      projectGuid: "project-1",
      scope: "all_project_sequences",
      projectHasObjectMask: true,
      sequenceCount: 2,
      maskedSequenceCount: 1,
      sequences: [
        { id: "sequence-a", name: "A sequence", hasObjectMask: false },
        { id: "sequence-b", name: "B sequence", hasObjectMask: true },
      ],
      verificationBoundary: "bounded_project_and_sequence_object_mask_double_readback",
    });
    expect(value.project.getSequences).toHaveBeenCalledTimes(2);
    expect(value.hasObjectMask).toHaveBeenCalledTimes(6);
  });

  it("resolves exact requested GUIDs without enumerating every project sequence", async () => {
    const value = objectMaskHost();
    await expect(value.registry.dispatch("objectMask.audit", {
      expectedProjectGuid: "project-1", sequenceIds: ["sequence-b", "sequence-a"],
    })).resolves.toMatchObject({
      scope: "explicit_sequences",
      sequences: [
        { id: "sequence-a", hasObjectMask: false },
        { id: "sequence-b", hasObjectMask: true },
      ],
    });
    expect(value.project.getSequences).not.toHaveBeenCalled();
    expect(value.project.getSequence).toHaveBeenCalledTimes(4);
    expect(value.ppro.Guid.fromString).toHaveBeenCalledTimes(4);
  });

  it("rejects duplicate, stale, and oversized selectors without presenting a mixed audit", async () => {
    const value = objectMaskHost();
    await expect(value.registry.dispatch("objectMask.audit", { sequenceIds: ["sequence-a", "sequence-a"] }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("objectMask.audit", { expectedProjectGuid: "other-project" }))
      .rejects.toMatchObject({ code: "UXP_STALE_OBJECT_MASK_AUDIT" });
    await expect(value.registry.dispatch("objectMask.audit", { unexpected: true }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });

    const tooLarge = objectMaskHost();
    tooLarge.project.getSequences.mockResolvedValueOnce(Array.from({ length: 65 }, (_, index) => ({ guid: `sequence-${index}`, name: "too many" })));
    await expect(tooLarge.registry.dispatch("objectMask.audit", {})).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
  });

  it("fails closed when a sequence result or exact target changes during the double read", async () => {
    const changed = objectMaskHost({ changeSequenceMaskOnSecondRead: true });
    await expect(changed.registry.dispatch("objectMask.audit", {})).rejects.toMatchObject({ code: "UXP_STALE_OBJECT_MASK_AUDIT" });

    const missing = objectMaskHost({ disappearOnSecondLookup: true });
    await expect(missing.registry.dispatch("objectMask.audit", { sequenceIds: ["sequence-a"] }))
      .rejects.toMatchObject({ code: "UXP_STALE_OBJECT_MASK_AUDIT" });
  });

  it("does not claim compatibility when the documented static object-mask API is absent", async () => {
    const value = objectMaskHost();
    delete (value.ppro as { ObjectMaskUtils?: unknown }).ObjectMaskUtils;
    const registry = Commands.createCommandRegistry({ ppro: value.ppro, Protocol });
    await expect(registry.capabilities()).resolves.toMatchObject({ commands: {
      "objectMask.audit": { supported: false, reason: expect.any(String) },
    } });
  });
});
