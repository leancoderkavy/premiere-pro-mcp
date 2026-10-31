import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Script, createContext, runInContext } from "node:vm";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

// Issue #642: QE track items include gaps ("Empty" items), so a DOM clip index
// passed to qeTrack.getItemAt() lands on the wrong item on any track with a
// leading or intermediate gap. Every QE clip lookup must match by start time.

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5_000 };
const TICKS = 254016000000;

type Handler = { handler: (args: never) => Promise<unknown> };

const advanced = getAdvancedTools(bridgeOptions);
const clipboard = getClipboardTools(bridgeOptions);
const effects = getEffectsTools(bridgeOptions);
const trackTargeting = getTrackTargetingTools(bridgeOptions);

const FIXED_TOOLS: Array<[string, Handler, Record<string, unknown>]> = [
  ["set_frame_blend", advanced.set_frame_blend, { node_id: "a", enabled: true }],
  ["set_time_interpolation", advanced.set_time_interpolation, { node_id: "a", interpolation_type: 1 }],
  ["apply_effect", effects.apply_effect, { node_id: "a", effect_name: "Gaussian Blur" }],
  ["apply_audio_effect", effects.apply_audio_effect, { node_id: "a", effect_name: "DeNoise" }],
  ["color_correct", effects.color_correct, { node_id: "a", exposure: 1 }],
  ["stabilize_clip", effects.stabilize_clip, { node_id: "a" }],
  ["batch_rename_clips", trackTargeting.batch_rename_clips, { pattern: "Shot_{n}", track_type: "video", track_index: 0 }],
  ["get_qe_clip_info", trackTargeting.get_qe_clip_info, { track_type: "video", track_index: 0, clip_index: 0 }],
];

function collection<T>(items: T[]) {
  Object.defineProperty(items, "numItems", { get: () => items.length });
  return items as T[] & { numItems: number };
}

type DomClip = {
  nodeId: string;
  name: string;
  start: { ticks: string };
  components: Array<{ displayName: string }> & { numItems: number };
  isSelected: () => boolean;
};

function domClip(nodeId: string, name: string, startSeconds: number, components: string[] = []): DomClip {
  return {
    nodeId,
    name,
    start: { ticks: String(startSeconds * TICKS) },
    components: collection(components.map((displayName) => ({ displayName }))),
    isSelected: () => true,
  };
}

function qeItem(type: string, startSeconds: number, dom?: DomClip, options: { ignoreEffects?: boolean } = {}) {
  const addEffect = (effect: { name: string }) => {
    if (!dom || options.ignoreEffects) return;
    dom.components.push({ displayName: effect.name });
  };
  return {
    type,
    name: dom ? dom.name : "",
    start: { ticks: String(startSeconds * TICKS) },
    // Live 25.2.3: a QE rename shows on the DOM clip at once.
    setName: vi.fn((name: string) => { if (dom) dom.name = name; }),
    removeEffects: vi.fn(),
    setFrameBlend: vi.fn(),
    setTimeInterpolationType: vi.fn(),
    addVideoEffect: vi.fn(addEffect),
    addAudioEffect: vi.fn(addEffect),
  };
}

/**
 * Video track 0 holds clip A at 5 s and clip B at 10 s. QE reports a leading
 * gap first, so the DOM index of A (0) addresses the gap on the QE side.
 */
function makeHost(options: { qeStartOffsetSeconds?: number; ignoreEffects?: boolean; videoEffects?: string[] } = {}) {
  const offset = options.qeStartOffsetSeconds ?? 0;
  const a = domClip("a", "Clip A", 5);
  const b = domClip("b", "Clip B", 10, ["Motion", "Opacity", "Gaussian Blur", "Missing FX"]);
  const gap = qeItem("Empty", 0);
  const qeA = qeItem("Clip", 5 + offset, a, { ignoreEffects: options.ignoreEffects });
  const qeB = qeItem("Clip", 10 + offset, b, { ignoreEffects: options.ignoreEffects });
  const qeItems = [gap, qeA, qeB];
  const qeTrack = { numItems: qeItems.length, getItemAt: (i: number) => qeItems[i] };
  const videoEffects = options.videoEffects ?? ["Gaussian Blur", "Lumetri Color", "Warp Stabilizer"];

  const videoTracks = collection([{ clips: collection([a, b]) }]) as unknown as { numTracks: number };
  videoTracks.numTracks = 1;
  const audioTracks = collection([]) as unknown as { numTracks: number };
  audioTracks.numTracks = 0;

  const context = createContext({
    app: {
      enableQE: vi.fn(),
      project: { activeSequence: { videoTracks, audioTracks } },
    },
    qe: {
      project: {
        getActiveSequence: () => ({
          getVideoTrackAt: () => qeTrack,
          getAudioTrackAt: () => ({ numItems: 0, getItemAt: () => null }),
        }),
        getVideoEffectByName: (name: string) => (videoEffects.indexOf(name) >= 0 ? { name } : null),
        getAudioEffectByName: () => null,
        getVideoEffectList: () => collection(videoEffects.map((name) => ({ name }))),
      },
    },
  });
  return { context, a, b, gap, qeA, qeB };
}

async function run(host: ReturnType<typeof makeHost>, tool: Handler, args: Record<string, unknown>) {
  mockedSendCommand.mockImplementationOnce(async (script: string) =>
    JSON.parse(runInContext(getHelpersSource() + "\n" + script, host.context) as string) as never);
  return (await tool.handler(args as never)) as { success: boolean; error?: string; data?: any };
}

function expectGapUntouched(host: ReturnType<typeof makeHost>) {
  for (const fn of ["setName", "removeEffects", "setFrameBlend", "setTimeInterpolationType", "addVideoEffect", "addAudioEffect"] as const) {
    expect(host.gap[fn]).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendCommand.mockReset();
});

describe("QE clip lookup by DOM clip start (#642)", () => {
  it.each(FIXED_TOOLS)("%s resolves the QE clip with __findQeClipByDomClip, not a DOM index", async (_name, tool, args) => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: {} } as never);
    await tool.handler(args as never);
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const script = String(mockedSendCommand.mock.calls[0][0]);
    expect(script).toContain("__findQeClipByDomClip(");
    expect(script).not.toMatch(/getItemAt\((?:result\.clipIndex|tgtResult\.clipIndex|c|\d+)\)/);
    expect(script).toContain("Could not match the QE clip for");
    // The generated ExtendScript must at least parse.
    expect(() => new Script(getHelpersSource() + "\n" + script)).not.toThrow();
  });

  it("rename_clip renames the DOM clip itself, so a leading gap cannot misdirect it", async () => {
    const host = makeHost();
    const result = await run(host, advanced.rename_clip, { node_id: "a", new_name: "Hero" });
    expect(result).toMatchObject({ success: true, data: { verified: true, newName: "Hero" } });
    expect(host.a.name).toBe("Hero");
    expect(host.b.name).toBe("Clip B");
    for (const item of [host.gap, host.qeA, host.qeB]) expect(item.setName).not.toHaveBeenCalled();
  });

  it("apply_lut refuses before touching the clip (Premiere 25.2.3 does not render a LUT set by path)", async () => {
    const result = await effects.apply_lut.handler({ node_id: "a", lut_path: "/tmp/look.cube" });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("set_frame_blend and set_time_interpolation address the matched clip", async () => {
    const host = makeHost();
    expect(await run(host, advanced.set_frame_blend, { node_id: "b", enabled: true })).toMatchObject({
      success: true, data: { frameBlend: true, outcome: "committed_unverified", verified: false },
    });
    expect(await run(host, advanced.set_time_interpolation, { node_id: "b", interpolation_type: 2 })).toMatchObject({
      success: true, data: { set: true, interpolationType: "Optical Flow", outcome: "committed_unverified", verified: false },
    });
    expect(host.qeB.setFrameBlend).toHaveBeenCalledWith(true);
    expect(host.qeB.setTimeInterpolationType).toHaveBeenCalledWith(2);
    expectGapUntouched(host);
  });

  it.each([
    ["set_frame_blend", advanced.set_frame_blend, { node_id: "b", enabled: true }, "setFrameBlend"],
    ["set_time_interpolation", advanced.set_time_interpolation, { node_id: "b", interpolation_type: 2 }, "setTimeInterpolationType"],
  ] as const)("%s reports a thrown QE write without claiming verification", async (_name, tool, args, method) => {
    const host = makeHost();
    (host.qeB[method] as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("write rejected"); });
    const result = await run(host, tool, args as unknown as Record<string, unknown>);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("mutation outcome is unknown"),
      data: { outcome: "committed_unverified", mutationAttempted: true, mutationOutcome: "unknown", verified: false },
    });
    expectGapUntouched(host);
  });

  it.each([
    ["set_frame_blend", advanced.set_frame_blend, { enabled: true }, "setFrameBlend"],
    ["set_time_interpolation", advanced.set_time_interpolation, { interpolation_type: 2 }, "setTimeInterpolationType"],
  ] as const)("%s safely escapes an adversarial clip ID", async (_name, tool, args, method) => {
    const host = makeHost();
    const result = await run(host, tool, { ...args, node_id: 'b\"); qeClip.setFrameBlend(false); (' });
    expect(result).toMatchObject({ success: false, error: "Clip not found" });
    expect(host.qeB[method]).not.toHaveBeenCalled();
    expectGapUntouched(host);
  });

  it("remove_all_effects never uses the broad QE removeEffects() and changes nothing without a targeted remove", async () => {
    // It removes each effect through Component.remove() or QE getComponentAt(i).remove();
    // this host has neither, so it is a capability error with nothing removed.
    const host = makeHost();
    const result = await run(host, advanced.remove_all_effects, { node_id: "b" });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Capability error") });
    for (const item of [host.gap, host.qeA, host.qeB]) expect(item.removeEffects).not.toHaveBeenCalled();
    expect(host.b.components.map((c) => c.displayName)).toEqual(["Motion", "Opacity", "Gaussian Blur", "Missing FX"]);
  });

  it("apply_effect adds the effect to the matched clip", async () => {
    const host = makeHost();
    const result = await run(host, effects.apply_effect, { node_id: "a", effect_name: "Gaussian Blur" });
    expect(result.success).toBe(true);
    expect(host.qeA.addVideoEffect).toHaveBeenCalledTimes(1);
    expect(host.qeB.addVideoEffect).not.toHaveBeenCalled();
    expectGapUntouched(host);
  });

  it("fails before mutating when no QE clip starts where the DOM clip does", async () => {
    const host = makeHost({ qeStartOffsetSeconds: 1 });
    for (const [, tool, args] of FIXED_TOOLS) {
      if (tool === trackTargeting.get_qe_clip_info) continue;
      const result = await run(host, tool, args);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Could not match the QE clip for .*by timeline start; nothing was changed\./);
    }
    for (const item of [host.gap, host.qeA, host.qeB]) {
      for (const fn of ["setName", "removeEffects", "setFrameBlend", "setTimeInterpolationType", "addVideoEffect", "addAudioEffect"] as const) {
        expect(item[fn]).not.toHaveBeenCalled();
      }
    }
  });

  it("batch_rename_clips renames each DOM clip through its matched QE clip", async () => {
    const host = makeHost();
    const result = await run(host, trackTargeting.batch_rename_clips, { pattern: "Shot_{n}", track_type: "video", track_index: 0 });
    expect(result.success).toBe(true);
    expect(result.data.renamed).toBe(2);
    expect(host.qeA.setName).toHaveBeenCalledWith("Shot_1");
    expect(host.qeB.setName).toHaveBeenCalledWith("Shot_2");
    expectGapUntouched(host);
  });

  it("get_qe_clip_info reads the QE clip matching the DOM clip index", async () => {
    const host = makeHost();
    // The fake QE clip must define every property the inspector reads.
    Object.assign(host.qeA, {
      mediaType: "Video", duration: "5", end: { ticks: "0" }, inPoint: { ticks: "0" }, outPoint: { ticks: "0" },
      speed: 1, audioChannelType: 0, numAudioChannels: 0,
    });
    const result = await run(host, trackTargeting.get_qe_clip_info, { track_type: "video", track_index: 0, clip_index: 0 });
    expect(result.success).toBe(true);
    expect(result.data.type).toBe("Clip");
    expect(result.data.name).toBe("Clip A");
  });
});

describe("copy_effects_between_clips value-copy delegation", () => {
  function listing(names = ["Gaussian Blur"]) {
    return { success: true, data: { names, source: "Clip B", target: "Clip A" } };
  }

  it("delegates the deduplicated source effects to value and keyframe copying", async () => {
    mockedSendCommand
      .mockResolvedValueOnce(listing() as never)
      .mockResolvedValueOnce({ success: true, data: { status: "verified", summary: { verified: 12 }, components: [{ component: "Gaussian Blur", status: "ok" }] } } as never);
    const result = await clipboard.copy_effects_between_clips.handler({ source_node_id: "b", target_node_id: "a" } as never) as any;
    expect(result).toMatchObject({ success: true, data: { status: "verified", verified: true, valuesCopied: true, copiedEffects: 1, copied: ["Gaussian Blur"], source: "Clip B", target: "Clip A", summary: { verified: 12 } } });
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "copy_effects_between_clips").outcome).toBe("verified");
    expect(mockedSendCommand).toHaveBeenCalledTimes(2);
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain('if (!seen["$" + name])');
    expect(String(mockedSendCommand.mock.calls[1][0])).toContain('__findQeClipByDomClip(');
    expect(String(mockedSendCommand.mock.calls[1][0])).toContain('"Gaussian Blur"');
  });

  it("preserves a committed-unverified value readback without claiming verification", async () => {
    mockedSendCommand
      .mockResolvedValueOnce(listing() as never)
      .mockResolvedValueOnce({ success: true, data: { status: "committed_unverified", summary: { failed: 1 }, components: [] } } as never);
    const result = await clipboard.copy_effects_between_clips.handler({ source_node_id: "b", target_node_id: "a", effect_name: "Gaussian Blur" } as never) as any;
    expect(result).toMatchObject({ success: true, data: { status: "committed_unverified", verified: false, valuesCopied: false, copiedEffects: 0 } });
  });

  it("surfaces an unknown effect and does not start a value copy", async () => {
    mockedSendCommand.mockResolvedValueOnce(listing([]) as never);
    const result = await clipboard.copy_effects_between_clips.handler({ source_node_id: "b", target_node_id: "a", effect_name: "Missing FX" } as never) as any;
    expect(result).toMatchObject({ success: false, error: "The source clip has no Missing FX effect; nothing was changed." });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed value copy such as a Premiere QE rejection", async () => {
    mockedSendCommand
      .mockResolvedValueOnce(listing() as never)
      .mockResolvedValueOnce({ success: false, error: "Premiere rejected the effect: Invalid parameter" } as never);
    const result = await clipboard.copy_effects_between_clips.handler({ source_node_id: "b", target_node_id: "a", effect_name: "Gaussian Blur" } as never) as any;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Premiere rejected the effect") });
  });
});
