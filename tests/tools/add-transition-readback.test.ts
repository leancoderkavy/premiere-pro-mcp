import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTransitionsTools } from "../../src/tools/transitions.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const FRAME = TICKS / 25;
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/transition-readback", timeoutMs: 5000 };
const tools = getTransitionsTools(bridgeOptions);

beforeEach(() => vi.clearAllMocks());

const t = (seconds: number) => ({ ticks: String(Math.round(seconds * TICKS)) });

/**
 * Three 6 s clips on V1 at 25 fps. `place` decides where Premiere puts the
 * transition relative to the cut, mirroring live Premiere 25.2 behavior: a
 * 1 s (25-frame) Cross Dissolve centered on the 6 s cut lands at 5.52-6.52 s.
 */
function hostWith(place: (cutSeconds: number) => [number, number], existing: Array<[number, number]> = [], options: { ignoreAll?: boolean; ignoreAfterFirst?: boolean; onlyFirstAtWrongEdge?: boolean; throwAfterAdd?: boolean; readbackThrows?: boolean; addExtra?: boolean } = {}) {
  const clips = [[0, 6], [6, 12], [12, 18]].map(([start, end], index) => ({ nodeId: `n${index + 1}`, name: `clip${index}`, start: t(start), end: t(end) }));
  const domTransitions: Array<{ start: { ticks: string }; end: { ticks: string } }> = [];
  const domTrack = {
    clips: Object.assign({ numItems: clips.length }, clips),
    transitions: {
      get numItems() { if (options.readbackThrows && domTransitions.length) throw new Error("transition readback unavailable"); return domTransitions.length; },
    } as Record<string | number, unknown>,
  };
  for (const [start, end] of existing) {
    const placed = { start: t(start), end: t(end) };
    domTrack.transitions[domTransitions.length] = placed;
    domTransitions.push(placed);
  }
  let calls = 0;
  const qeClips = clips.map((clip) => ({
    type: "Clip",
    start: clip.start,
    addTransition: () => {
      calls += 1;
      if (options.ignoreAll) return;
      if (options.ignoreAfterFirst && calls > 1) return;
      const cutSeconds = parseFloat(clip.start.ticks) / TICKS;
      const [start, end] = place(cutSeconds);
      const actual = options.onlyFirstAtWrongEdge && calls > 1 ? [cutSeconds + 1, cutSeconds + 2] as [number, number] : [start, end];
      const placed = { start: t(actual[0]), end: t(actual[1]) };
      domTrack.transitions[domTransitions.length] = placed;
      domTransitions.push(placed);
      if (options.addExtra) {
        const extra = { start: t(cutSeconds + 1), end: t(cutSeconds + 2) };
        domTrack.transitions[domTransitions.length] = extra;
        domTransitions.push(extra);
      }
      if (options.throwAfterAdd) throw new Error("native write failed after mutation");
    },
  }));
  const context = {
    app: {
      enableQE: () => {},
      project: { activeSequence: { timebase: String(FRAME), videoTracks: { numTracks: 1, 0: domTrack }, audioTracks: { numTracks: 0 } } },
    },
    qe: {
      project: {
        getActiveSequence: () => ({ getVideoTrackAt: () => ({ numItems: qeClips.length, getItemAt: (i: number) => qeClips[i] }) }),
        getVideoTransitionByName: (name: string) => ({ name }),
      },
    },
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return { calls: () => calls };
}

const add = (cut: number) =>
  tools.add_transition.handler({ transition_name: "Cross Dissolve", track_index: 0, cut_point_seconds: cut, duration_seconds: 1 }) as Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;

describe("add_transition readback", () => {
  it.each([
    [{ track_index: -1, cut_point_seconds: 6, duration_seconds: 1 }, "track_index"],
    [{ track_index: 0.5, cut_point_seconds: 6, duration_seconds: 1 }, "track_index"],
    [{ track_index: 0, cut_point_seconds: Number.NaN, duration_seconds: 1 }, "cut_point_seconds"],
    [{ track_index: 0, cut_point_seconds: 6, duration_seconds: 0 }, "duration_seconds"],
    [{ track_index: 0, cut_point_seconds: 6, duration_seconds: Number.POSITIVE_INFINITY }, "duration_seconds"],
  ])("refuses invalid arguments before dispatch: %j", async (args, field) => {
    const result = await tools.add_transition.handler({ transition_name: "Cross Dissolve", ...args } as never);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(field) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("verifies an odd-frame dissolve that Premiere centers half a frame off the cut", async () => {
    // Live readback was 5.52000001073161-6.52000001073161 s: 12 frames before the
    // cut, 13 after, plus a few ticks of drift, so the midpoint sits just over
    // half a frame from the cut.
    const drift = 2726 / TICKS;
    hostWith((cut) => [cut - (12 * FRAME) / TICKS + drift, cut + (13 * FRAME) / TICKS + drift]);
    await expect(add(6)).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("verifies a transition pushed entirely to one side of the cut (no handles)", async () => {
    hostWith((cut) => [cut - 1, cut]);
    await expect(add(12)).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("still fails when the new transition does not cover the requested cut", async () => {
    hostWith(() => [1, 2]);
    await expect(add(6)).resolves.toMatchObject({
      success: false,
      data: { outcome: "committed_unverified", timelineChanged: true },
    });
  });

  it("refuses to verify an unexpected extra transition", async () => {
    hostWith((cut) => [cut - 0.5, cut + 0.5], [], { addExtra: true });
    await expect(add(6)).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, transitionsAdded: 2 } });
  });

  it("reports an attempted mutation when transition readback becomes unreadable", async () => {
    hostWith((cut) => [cut - 0.5, cut + 0.5], [], { readbackThrows: true });
    await expect(add(6)).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null, transitionsAdded: null } });
  });

  it("reports the stored transition duration separately from the request", async () => {
    hostWith((cut) => [cut - 0.25, cut + 0.25]);
    await expect(add(6)).resolves.toMatchObject({ success: true, data: { requestedDurationSeconds: 1, durationSeconds: 0.5, placements: [{ durationSeconds: 0.5 }] } });
  });

  it("preserves mutation evidence when the native call throws after adding", async () => {
    hostWith((cut) => [cut - 0.5, cut + 0.5], [], { throwAfterAdd: true });
    await expect(add(6)).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: true, transitionsAdded: 1 } });
  });

  it("distinguishes a transition no-op from a verified write", async () => {
    hostWith(() => [1, 2], [], { ignoreAll: true });
    const result = await add(6);
    expect(result).toMatchObject({ success: false, data: { outcome: "not_applied", timelineChanged: false } });
  });
});

describe("add_transition_to_clip and batch_add_transitions readback", () => {
  it("rejects unsupported positions and non-positive durations before dispatch", async () => {
    const invalidPosition = await tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", position: "end; alert(1)" });
    expect(invalidPosition).toMatchObject({ success: false, error: expect.stringContaining("position") });
    const invalidDuration = await tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", duration_seconds: -1 });
    expect(invalidDuration).toMatchObject({ success: false, error: expect.stringContaining("duration_seconds") });
    const invalidBatchTrack = await tools.batch_add_transitions.handler({ transition_name: "Cross Dissolve", track_index: 1.25 });
    expect(invalidBatchTrack).toMatchObject({ success: false, error: expect.stringContaining("track_index") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("batch verifies odd-frame dissolves at every cut (live: 3 of 4 reported)", async () => {
    const drift = 2726 / TICKS;
    hostWith((cut) => [cut - (12 * FRAME) / TICKS + drift, cut + (13 * FRAME) / TICKS + drift]);
    const result = await tools.batch_add_transitions.handler({ transition_name: "Cross Dissolve", track_index: 0, duration_seconds: 1 }) as { success: boolean; error?: string };
    expect(result.success).toBe(true);
  });

  it("reports partial batch application with changed state and failed cut indexes", async () => {
    hostWith((cut) => [cut - 0.5, cut + 0.5], [], { ignoreAfterFirst: true });
    const result = await tools.batch_add_transitions.handler({ transition_name: "Cross Dissolve", track_index: 0, duration_seconds: 1 });
    expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", timelineChanged: true, added: 1, requestedCount: 2, failedCuts: [1] } });
  });

  it("add_transition_to_clip verifies a dissolve that covers the clip start", async () => {
    const drift = 2726 / TICKS;
    hostWith((cut) => [cut - (12 * FRAME) / TICKS + drift, cut + (13 * FRAME) / TICKS + drift]);
    const result = await tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", position: "start", duration_seconds: 1 }) as { success: boolean; error?: string };
    expect(result).toMatchObject({ success: true });
  });
});

describe("batch_add_transitions with an existing transition", () => {
  it("leaves a cut that already has a transition and verifies the rest", async () => {
    hostWith((cut) => [cut - 0.5, cut + 0.5]);
    await tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", position: "start", duration_seconds: 1 });
    const result = await tools.batch_add_transitions.handler({ transition_name: "Cross Dissolve", track_index: 0, duration_seconds: 1 }) as { success: boolean; data?: Record<string, unknown> };
    expect(result).toMatchObject({ success: true, data: { added: 1, alreadyPresent: 1, verified: true } });
  });
});

describe("transition readback ignores transitions that were already there", () => {
  it("add_transition refuses a cut that already has a transition instead of verifying the old one", async () => {
    const host = hostWith((cut) => [cut - 0.5, cut + 0.5], [[5.5, 6.5]]);
    await expect(add(6)).resolves.toMatchObject({ success: false, error: expect.stringContaining("already covers the cut") });
    expect(host.calls()).toBe(0);
  });

  it("add_transition_to_clip refuses an edge that already has a transition", async () => {
    const host = hostWith((cut) => [cut - 0.5, cut + 0.5], [[11.5, 12.5]]);
    await expect(tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", position: "both" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("already covers the clip end") });
    expect(host.calls()).toBe(0);
  });

  it("add_transition_to_clip fails when the only transition at the edge is not new", async () => {
    // Premiere adds its transition at the wrong edge (the clip end); the clip start
    // had nothing before, so only a new transition there may verify.
    hostWith((cut) => [cut + 5.5, cut + 6.5]);
    await expect(tools.add_transition_to_clip.handler({ node_id: "n2", transition_name: "Cross Dissolve", position: "start" }))
      .resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", timelineChanged: true, startVerified: false } });
  });
});
