import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function workAreaHost(options: { withWorkAreaUtils?: boolean; accept?: boolean; retain?: boolean } = {}) {
  const state = { inSeconds: 2, outSeconds: 30 };
  const sequence = {
    guid: "sequence-1",
    getEndTime: vi.fn(async () => ({ seconds: 60 })),
  };
  const project = {
    getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn(),
    executeTransaction: vi.fn(),
  };
  const setWorkAreaInOutPoints = vi.fn(async (_sequence: unknown, inTick: { seconds: number }, outTick: { seconds: number }) => {
    if (options.retain !== false) {
      state.inSeconds = inTick.seconds;
      state.outSeconds = outTick.seconds;
    }
    return options.accept !== false;
  });
  const ppro: Record<string, unknown> = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: (seconds: number) => ({ seconds }) },
  };
  if (options.withWorkAreaUtils !== false) {
    ppro.WorkAreaUtils = {
      getWorkAreaInPoint: vi.fn(async () => ({ seconds: state.inSeconds })),
      getWorkAreaOutPoint: vi.fn(async () => ({ seconds: state.outSeconds })),
      setWorkAreaInOutPoints,
    };
  }
  return { registry: Commands.createCommandRegistry({ ppro, Protocol }), setWorkAreaInOutPoints, state };
}

const validSet = {
  expectedSequenceGuid: "sequence-1",
  expectedWorkArea: { inSeconds: 2, outSeconds: 30 },
  inSeconds: 5,
  outSeconds: 20,
  operationId: "work-area-1",
};

describe("UXP WorkAreaUtils commands", () => {
  it("advertises Premiere 26.5 work-area commands only when WorkAreaUtils probes true", async () => {
    const available = await workAreaHost().registry.capabilities();
    expect(available.commands["workArea.inspect"]).toMatchObject({ supported: true, readOnly: true, minHostVersion: "26.5.0" });
    expect(available.commands["workArea.set"]).toMatchObject({ supported: true, destructive: false, undoable: false, idempotent: true, minHostVersion: "26.5.0" });
    const missing = await workAreaHost({ withWorkAreaUtils: false }).registry.capabilities();
    expect(missing.commands["workArea.inspect"]).toMatchObject({ supported: false, reason: expect.any(String) });
    expect(missing.commands["workArea.set"]).toMatchObject({ supported: false });
  });

  it("inspects and sets the work area with guarded native readback", async () => {
    const value = workAreaHost();
    await expect(value.registry.dispatch("workArea.inspect", {})).resolves.toEqual({
      sequenceGuid: "sequence-1",
      workArea: { inSeconds: 2, outSeconds: 30 },
      verificationBoundary: "work_area_readback",
    });
    await expect(value.registry.dispatch("workArea.set", validSet)).resolves.toMatchObject({
      updated: true,
      outcome: "verified",
      sequenceGuid: "sequence-1",
      workArea: { inSeconds: 5, outSeconds: 20 },
      verified: "work_area_readback",
    });
    expect(value.setWorkAreaInOutPoints).toHaveBeenCalledTimes(1);
  });

  it("fails closed for stale, invalid, rejected, and unretained work-area updates", async () => {
    const value = workAreaHost();
    await expect(value.registry.dispatch("workArea.set", { ...validSet, expectedSequenceGuid: "other" }))
      .rejects.toMatchObject({ code: "UXP_STALE_SEQUENCE" });
    await expect(value.registry.dispatch("workArea.set", { ...validSet, expectedWorkArea: { inSeconds: 0, outSeconds: 30 } }))
      .rejects.toMatchObject({ code: "UXP_STALE_RANGE" });
    await expect(value.registry.dispatch("workArea.set", { ...validSet, inSeconds: 20, outSeconds: 10 }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("workArea.set", { ...validSet, outSeconds: 90 }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("workArea.set", { ...validSet, extra: true }))
      .rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    expect(value.setWorkAreaInOutPoints).not.toHaveBeenCalled();

    await expect(workAreaHost({ accept: false }).registry.dispatch("workArea.set", validSet))
      .rejects.toMatchObject({ code: "UXP_ACTION_REJECTED" });
    await expect(workAreaHost({ retain: false }).registry.dispatch("workArea.set", validSet))
      .rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });
  });
});
