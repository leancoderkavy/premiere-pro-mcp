import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function host(options: { transitions?: boolean; commit?: boolean } = {}) {
  const addAction = vi.fn(() => true);
  const add = vi.fn(() => ({ kind: "add" }));
  const remove = vi.fn(() => ({ kind: "remove" }));
  const clip = { createAddVideoTransitionAction: add, createRemoveVideoTransitionAction: remove };
  const track = { getTrackItems: vi.fn(async () => [clip]) };
  const sequence = {
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => track),
    getPlayerPosition: vi.fn(async () => ({ seconds: 3 }))
  };
  const project = {
    getActiveSequence: vi.fn(async () => sequence),
    lockedAccess: vi.fn((callback: () => void) => callback()),
    executeTransaction: vi.fn((callback: (compound: unknown) => void) => {
      callback({ addAction });
      return options.commit !== false;
    })
  };
  const optionValues: Record<string, unknown> = {};
  const transitionApis = options.transitions === false ? {} : {
    TransitionFactory: {
      getVideoTransitionMatchNames: vi.fn(async () => ["CrossDissolve", "DipToBlack"]),
      createVideoTransition: vi.fn(async (name: string) => ({ name }))
    },
    AddTransitionOptions: vi.fn(() => ({
      setApplyToStart: vi.fn((value: boolean) => { optionValues.applyToStart = value; }),
      setDuration: vi.fn((value: unknown) => { optionValues.duration = value; }),
      setForceSingleSided: vi.fn((value: boolean) => { optionValues.forceSingleSided = value; }),
      setTransitionAlignment: vi.fn((value: number) => { optionValues.transitionAlignment = value; })
    }))
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Constants: { TrackItemType: { CLIP: 1 }, TransitionPosition: { START: 0, END: 1 } },
    ...transitionApis
  };
  return { registry: Commands.createCommandRegistry({ ppro, fs: {}, Protocol }), ppro, project, sequence, track, clip, add, remove, addAction, optionValues };
}

describe("UXP command registry", () => {
  it("reports support per command from the runtime API surface", async () => {
    const available = await host().registry.capabilities();
    expect(available.commands["transition.video.add"]).toMatchObject({ supported: true, destructive: true, undoable: true, minHostVersion: "25.6.0" });
    const unavailable = await host({ transitions: false }).registry.capabilities();
    expect(unavailable.commands["transition.video.add"]).toMatchObject({ supported: false, reason: expect.any(String) });
  });

  it("lists installed video transition match names", async () => {
    await expect(host().registry.dispatch("transition.video.list", {})).resolves.toEqual({
      matchNames: ["CrossDissolve", "DipToBlack"], count: 2
    });
  });

  it("adds a configured transition in a locked undoable transaction", async () => {
    const value = host();
    await expect(value.registry.dispatch("transition.video.add", {
      videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve", position: "start",
      durationSeconds: 0.5, forceSingleSided: true, transitionAlignment: 1
    })).resolves.toMatchObject({ applied: true, verified: "transaction", position: "start" });
    expect(value.project.lockedAccess).toHaveBeenCalledOnce();
    expect(value.project.executeTransaction).toHaveBeenCalledWith(expect.any(Function), "Add video transition");
    expect(value.add).toHaveBeenCalledWith({ name: "CrossDissolve" }, expect.any(Object));
    expect(value.optionValues).toEqual({ applyToStart: true, duration: { seconds: 0.5 }, forceSingleSided: true, transitionAlignment: 1 });
  });

  it("removes the requested transition side in a transaction", async () => {
    const value = host();
    await expect(value.registry.dispatch("transition.video.remove", { videoTrackIndex: 0, clipIndex: 0, position: "end" }))
      .resolves.toMatchObject({ removed: true, position: "end" });
    expect(value.remove).toHaveBeenCalledWith(1);
  });

  it("rejects unknown transitions, invalid targets, and failed commits", async () => {
    await expect(host().registry.dispatch("transition.video.add", { videoTrackIndex: 0, clipIndex: 0, matchName: "Missing" }))
      .rejects.toMatchObject({ code: "UXP_TRANSITION_NOT_FOUND" });
    await expect(host().registry.dispatch("transition.video.remove", { videoTrackIndex: 1, clipIndex: 0 }))
      .rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    await expect(host({ commit: false }).registry.dispatch("transition.video.remove", { videoTrackIndex: 0, clipIndex: 0 }))
      .rejects.toMatchObject({ code: "UXP_TRANSACTION_FAILED" });
  });
});

describe("UXP transition argument validation", () => {
  it("requires explicit non-negative clip coordinates and a match name", () => {
    expect(() => Commands.validateAddArgs({ videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve" })).not.toThrow();
    expect(() => Commands.validateAddArgs({ videoTrackIndex: -1, clipIndex: 0, matchName: "CrossDissolve" })).toThrow("videoTrackIndex");
    expect(() => Commands.validateAddArgs({ videoTrackIndex: 0, clipIndex: 0, matchName: "CrossDissolve", surprise: true })).toThrow("Unknown argument");
  });
});
