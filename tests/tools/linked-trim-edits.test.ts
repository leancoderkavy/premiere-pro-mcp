import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationTicks: vi.fn().mockResolvedValue(3600 * 254016000000) }));

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: { mediaPath: "/fixture/source.mp4" } }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { probeMediaDurationSeconds } from "../../src/tools/media-evidence.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTimelineTools } from "../../src/tools/timeline.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/linked-trim", timeoutMs: 5000 };
const tools = getAdvancedTools(bridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(probeMediaDurationSeconds).mockResolvedValue(100); });

const ticksOf = (value: unknown) => parseFloat(typeof value === "object" && value ? String((value as { ticks: string }).ticks) : String(value));
const secs = (t: number) => Math.round((t / TICKS) * 1000) / 1000;

function makeClip(id: string, start: number, end: number, inPoint: number, options: { rejectInPoint?: boolean } = {}) {
  let s = start * TICKS; let e = end * TICKS; let i = inPoint * TICKS; let o = (inPoint + end - start) * TICKS;
  const clip = {
    nodeId: id,
    name: "Interview A.mp4",
    group: null as unknown[] | null,
    get start() { return { ticks: String(Math.round(s)) }; }, set start(v: unknown) { s = ticksOf(v); },
    get end() { return { ticks: String(Math.round(e)) }; }, set end(v: unknown) { e = ticksOf(v); },
    get inPoint() { return { ticks: String(Math.round(i)) }; },
    set inPoint(v: unknown) { if (options.rejectInPoint) throw new Error("locked"); i = ticksOf(v); },
    get outPoint() { return { ticks: String(Math.round(o)) }; }, set outPoint(v: unknown) { o = ticksOf(v); },
    get duration() { return { ticks: String(Math.round(e - s)) }; },
    components: { numItems: 0 },
    projectItem: { getMediaPath: () => "/Users/me/Desktop/Interview A.mp4" },
    getSpeed: () => 1,
    isSpeedReversed: () => false,
    getLinkedItems() {
      if (!clip.group) return null;
      const list: Record<string | number, unknown> = { numItems: clip.group.length };
      clip.group.forEach((m, k) => { list[k] = m; });
      return list;
    },
    snapshot: () => [secs(s), secs(e), secs(i), secs(o)],
  };
  return clip;
}

/** Three linked shots on V1/A1: 0-10, 10-30, 30-60 (source time = timeline time). */
function host(options: { audioRejectsInPoint?: boolean; audioLocked?: boolean } = {}) {
  const ranges: Array<[number, number]> = [[0, 10], [10, 30], [30, 60]];
  const video = ranges.map(([a, b], k) => makeClip(`v${k}`, a, b, a));
  const audio = ranges.map(([a, b], k) => makeClip(`a${k}`, a, b, a, { rejectInPoint: options.audioRejectsInPoint && k === 1 }));
  video.forEach((v, k) => { v.group = [v, audio[k]]; audio[k].group = [v, audio[k]]; });
  const collection = (list: unknown[]) => new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
  const seq = {
    sequenceID: "seq",
    timebase: String(TICKS / 25),
    videoTracks: { numTracks: 1, 0: { clips: collection(video), isLocked: () => false } },
    audioTracks: { numTracks: 1, 0: { clips: collection(audio), isLocked: () => options.audioLocked === true } },
  };
  const context = {
    app: { project: { documentID: "project", activeSequence: seq, sequences: { numSequences: 1, 0: seq } } },
    Time: function Time(this: { ticks: string }) { this.ticks = "0"; },
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return { video, audio, context };
}

describe("trim edits keep linked audio in sync", () => {
  it("slip_edit slips the linked audio too", async () => {
    const { video, audio } = host();
    const result = await tools.slip_edit.handler({ node_id: "v1", offset_seconds: 1 }) as Result;
    expect(result.success).toBe(true);
    expect(result.data?.linkedPartnersEdited).toEqual([{ nodeId: "a1", trackType: "audio", trackIndex: 0, verified: true }]);
    expect(video[1].snapshot()).toEqual([10, 30, 11, 31]);
    expect(audio[1].snapshot()).toEqual(video[1].snapshot());
  });

  it("roll_edit rolls the linked audio cut too", async () => {
    const { video, audio } = host();
    await expect(tools.roll_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: true });
    for (const list of [video, audio]) {
      expect(list[1].snapshot().slice(0, 2)).toEqual([10, 30.5]);
      expect(list[2].snapshot().slice(0, 3)).toEqual([30.5, 60, 30.5]);
    }
  });

  it("slide_edit trims both neighbours' source points so their pictures do not shift", async () => {
    const { video, audio } = host();
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: -0.5 })).resolves.toMatchObject({ success: true });
    for (const list of [video, audio]) {
      expect(list[0].snapshot()).toEqual([0, 9.5, 0, 9.5]);
      expect(list[1].snapshot().slice(0, 3)).toEqual([9.5, 29.5, 10]);
      // Live Premiere 25.2 bug: the following clip kept in=30 and showed source 30.5 at 30.0.
      expect(list[2].snapshot().slice(0, 3)).toEqual([29.5, 60, 29.5]);
    }
  });

  it("include_linked false edits only the given clip", async () => {
    const { video, audio } = host();
    await expect(tools.slip_edit.handler({ node_id: "v1", offset_seconds: 1, include_linked: false })).resolves.toMatchObject({ success: true, data: { linkedPartnersEdited: [] } });
    expect(video[1].snapshot()[2]).toBe(11);
    expect(audio[1].snapshot()[2]).toBe(10);
  });

  it("says the timeline changed when a partner that passed its check is then rejected by Premiere", async () => {
    host({ audioRejectsInPoint: true });
    const result = await tools.slip_edit.handler({ node_id: "v1", offset_seconds: 1 }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/slip was applied to the clip but not to its linked audio clip on track 1.*timeline changed and was not rolled back/);
    expect(result.data).toMatchObject({ timelineChanged: true, failedPartner: { nodeId: "a1" } });
  });
});

describe("trim_clip and set_clip_duration move the visible edge and follow linked audio", () => {
  const timeline = getTimelineTools(bridgeOptions);

  it("a head trim moves the clip start with its in point (Premiere 25.2 left the start in place)", async () => {
    const { video, audio } = host();
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_in_seconds: 15 }) as Result;
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(video[1].snapshot()).toEqual([15, 30, 15, 30]);
    expect(audio[1].snapshot()).toEqual([15, 30, 15, 30]);
  });

  it("a tail trim moves the clip end with its out point", async () => {
    const { video, audio } = host();
    await expect(timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 25 })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot()).toEqual([10, 25, 10, 25]);
    expect(audio[1].snapshot()).toEqual([10, 25, 10, 25]);
  });

  it("set_clip_duration keeps the out point consistent with the new end", async () => {
    const { video, audio } = host();
    await expect(timeline.set_clip_duration.handler({ node_id: "v1", duration_seconds: 12 })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot()).toEqual([10, 22, 10, 22]);
    expect(audio[1].snapshot()).toEqual([10, 22, 10, 22]);
  });
});

describe("remove_from_timeline takes linked partners and verifies", () => {
  const timeline = getTimelineTools(bridgeOptions);
  const removable = (options: { stubborn?: string; audioLocked?: boolean } = {}) => {
    const { video, audio } = host({ audioLocked: options.audioLocked });
    for (const list of [video, audio]) {
      for (const clip of [...list]) {
        (clip as unknown as { remove: () => number }).remove = () => {
          if (clip.nodeId !== options.stubborn) list.splice(list.indexOf(clip), 1);
          return 0;
        };
      }
    }
    return { video, audio };
  };

  it("removes the shot's audio with it by default (live: plan remove left the audio behind)", async () => {
    const { video, audio } = removable();
    const result = await timeline.remove_from_timeline.handler({ node_id: "v1" }) as Result;
    expect(result).toMatchObject({ success: true, data: { removedClipIds: ["v1", "a1"], linkedPartnersRemoved: 1, verified: true } });
    expect(video.map((c) => c.nodeId)).toEqual(["v0", "v2"]);
    expect(audio.map((c) => c.nodeId)).toEqual(["a0", "a2"]);
  });

  it("keeps the partner when include_linked is false", async () => {
    const { audio } = removable();
    await expect(timeline.remove_from_timeline.handler({ node_id: "v1", include_linked: false })).resolves.toMatchObject({ success: true, data: { linkedPartnersRemoved: 0 } });
    expect(audio).toHaveLength(3);
  });

  it("fails, saying the timeline changed, when Premiere leaves a clip behind", async () => {
    removable({ stubborn: "a1" });
    await expect(timeline.remove_from_timeline.handler({ node_id: "v1" })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/^The timeline changed: 1 clip\(s\) were removed, but Premiere did not remove/) });
  });

  it("removes nothing when a linked partner sits on a locked track", async () => {
    const { video, audio } = removable({ audioLocked: true });
    await expect(timeline.remove_from_timeline.handler({ node_id: "v1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect(video.map((c) => c.nodeId)).toEqual(["v0", "v1", "v2"]);
    expect(audio.map((c) => c.nodeId)).toEqual(["a0", "a1", "a2"]);
  });

  it("routes ripple removal through the verified ripple delete, never remove(true, ...)", async () => {
    mockedSendCommand.mockResolvedValue({ success: true, data: {} });
    await timeline.remove_from_timeline.handler({ node_id: "v1", ripple: true });
    const script = String(mockedSendCommand.mock.calls.at(-1)?.[0]);
    expect(script).not.toMatch(/\.remove\(true/);
    expect(script).toContain("Ripple delete refused");
  });
});

describe("slide_edit checks linked partners before changing anything", () => {
  it("refuses without moving the picture when the linked audio has a gap (live: video slid, audio refused)", async () => {
    const { video, audio } = host();
    audio[1].start = { ticks: String(10.5 * TICKS) };
    const before = video.map((clip) => clip.snapshot());
    const result = await tools.slide_edit.handler({ node_id: "v1", offset_seconds: 1 }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect(video.map((clip) => clip.snapshot())).toEqual(before);
  });
});

describe("rename_clip", () => {
  it("renames through the clip itself, so a gap before it cannot misdirect the rename (live: QE index hit the gap)", async () => {
    const { video } = host();
    await expect(tools.rename_clip.handler({ node_id: "v1", new_name: "Speaker close-up" }))
      .resolves.toMatchObject({ success: true, data: { renamed: true, verified: true, newName: "Speaker close-up" } });
    expect(video[1].name).toBe("Speaker close-up");
  });
});

describe("linked edits check every partner before changing anything", () => {
  const timeline = getTimelineTools(bridgeOptions);
  const snap = (list: ReturnType<typeof host>["video"]) => list.map((clip) => clip.snapshot());

  it.each([
    ["trim_clip (partner is retimed)", (h: ReturnType<typeof host>) => {
      h.audio[1].outPoint = { ticks: String(50 * TICKS) };
      h.audio[1].getSpeed = () => 2;
    }, () => timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 29 })],
    ["set_clip_duration (partner would overlap its next clip)", (h: ReturnType<typeof host>) => {
      // The picture ends 2 s early (gap before V1's next shot); its audio does not.
      h.video[1].end = { ticks: String(28 * TICKS) };
      h.video[1].outPoint = { ticks: String(28 * TICKS) };
    }, () => timeline.set_clip_duration.handler({ node_id: "v1", duration_seconds: 19.5 })],
    ["roll_edit (partner has a gap at the cut)", (h: ReturnType<typeof host>) => {
      h.audio[1].end = { ticks: String(28 * TICKS) };
    }, () => tools.roll_edit.handler({ node_id: "v1", offset_seconds: 0.5 })],
  ])("%s refuses without touching the picture", async (_name, setup, call) => {
    const h = host();
    setup(h);
    const before = [snap(h.video), snap(h.audio)];
    const result = await call() as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect([snap(h.video), snap(h.audio)]).toEqual(before);
  });

  it("slip_edit refuses when the partner's source range cannot move", async () => {
    const { video, audio } = host();
    audio[1].inPoint = { ticks: "0" };
    const before = [snap(video), snap(audio)];
    await expect(tools.slip_edit.handler({ node_id: "v1", offset_seconds: -1 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect([snap(video), snap(audio)]).toEqual(before);
  });

  it("does not report verified when a partner's result is committed_unverified", async () => {
    const { audio } = host();
    // Shortening keeps the partner's keyframe scan unreadable after the write.
    let reads = 0;
    Object.defineProperty(audio[1], "components", { get: () => { reads += 1; if (reads > 2) throw new Error("components unreadable"); return { numItems: 0 }; } });
    const result = await timeline.set_clip_duration.handler({ node_id: "v1", duration_seconds: 15 }) as Result;
    expect(result).toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", linkedPartnersEdited: [{ nodeId: "a1", verified: false }] } });
  });
});

describe("trim_clip will not extend into a neighbour", () => {
  const timeline = getTimelineTools(bridgeOptions);

  it("refuses a tail extension that would overlap the next clip", async () => {
    const { video } = host();
    video[1].end = { ticks: String(25 * TICKS) };
    video[1].outPoint = { ticks: String(25 * TICKS) };
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 32, include_linked: false }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("would overlap the next clip") });
    expect(video[1].snapshot()).toEqual([10, 25, 10, 25]);
  });

  it("refuses a head extension that would overlap the previous clip", async () => {
    const { video } = host();
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_in_seconds: 8, include_linked: false }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("would overlap the previous clip") });
    expect(video[1].snapshot()).toEqual([10, 30, 10, 30]);
  });

  it("extends into free space", async () => {
    const { video } = host();
    video[1].end = { ticks: String(25 * TICKS) };
    video[1].outPoint = { ticks: String(25 * TICKS) };
    await expect(timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 28, include_linked: false })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot()).toEqual([10, 28, 10, 28]);
  });
});

describe("linked partners get the clip's change as an offset (J/L cuts, slipped audio)", () => {
  const timeline = getTimelineTools(bridgeOptions);

  /** The middle shot's audio is slipped 2 s later in its source (in 12 instead of 10). */
  function slippedAudioHost() {
    const h = host();
    h.audio[1].inPoint = { ticks: String(12 * TICKS) };
    h.audio[1].outPoint = { ticks: String(32 * TICKS) };
    return h;
  }

  it("a head trim moves the partner's in point by the same amount, not to the same value", async () => {
    const { video, audio } = slippedAudioHost();
    await expect(timeline.trim_clip.handler({ node_id: "v1", new_in_seconds: 15 })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot()).toEqual([15, 30, 15, 30]);
    expect(audio[1].snapshot()).toEqual([15, 30, 17, 32]);
  });

  it("a tail trim moves the partner's out point by the same amount", async () => {
    const { audio } = slippedAudioHost();
    await expect(timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 25 })).resolves.toMatchObject({ success: true });
    expect(audio[1].snapshot()).toEqual([10, 25, 12, 27]);
  });

  it("set_clip_duration moves a partner that starts later by the same end offset", async () => {
    const { video, audio } = host();
    // L cut: the audio starts 1 s after the picture (11-30 on A1).
    audio[1].start = { ticks: String(11 * TICKS) };
    audio[1].inPoint = { ticks: String(11 * TICKS) };
    await expect(timeline.set_clip_duration.handler({ node_id: "v1", duration_seconds: 15 })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot().slice(0, 2)).toEqual([10, 25]);
    expect(audio[1].snapshot().slice(0, 2)).toEqual([11, 25]);
  });
});

describe("a partner Premiere moves while the main clip is written", () => {
  const timeline = getTimelineTools(bridgeOptions);

  it("is not given the offset a second time, and the result says the timeline changed", async () => {
    const { video, audio } = host();
    // Emulate a host that carries a linked partner along with the main clip's in-point write.
    const setIn = Object.getOwnPropertyDescriptor(video[1], "inPoint")!.set!;
    Object.defineProperty(video[1], "inPoint", {
      get: Object.getOwnPropertyDescriptor(video[1], "inPoint")!.get,
      set(value: unknown) {
        setIn.call(video[1], value);
        audio[1].inPoint = value;
        audio[1].start = { ticks: String(15 * TICKS) };
      },
    });
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_in_seconds: 15 }) as Result;
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, failedPartner: { nodeId: "a1" } } });
    expect(result.error).toContain("Premiere moved it while the main clip was written");
    expect(audio[1].snapshot().slice(0, 3)).toEqual([15, 30, 15]);
  });

  it("names the real problem when a partner's in point would go below zero", async () => {
    const { video, audio } = host();
    // Leave room before the shot so only the partner's source limits the trim.
    for (const clip of [video[0], audio[0]]) { clip.end = { ticks: String(2 * TICKS) }; clip.outPoint = { ticks: String(2 * TICKS) }; }
    audio[1].inPoint = { ticks: String(3 * TICKS) };
    audio[1].outPoint = { ticks: String(23 * TICKS) };
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_in_seconds: 5 }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("before the start of its media") });
  });
});


describe("physical source bounds fail before timeline mutation", () => {
  it.each([39, 10.02])("rejects source out %s beyond physical duration without frame tolerance and leaves linked clips unchanged", async newOut => {
    const { video, audio } = host();
    const before = [...video, ...audio].map(clip => clip.snapshot());
    const timeline = getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: async () => 10 });
    const advanced = getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => 10 });
    await expect(timeline.trim_clip.handler({ node_id: "v0", new_out_seconds: newOut })).resolves.toMatchObject({ success: false, error: expect.stringContaining("real media duration") });
    await expect(advanced.slip_edit.handler({ node_id: "v0", offset_seconds: 2 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("real media duration") });
    expect([...video, ...audio].map(clip => clip.snapshot())).toEqual(before);
  });

  it("refuses different linked media before applying either clip", async () => {
    const { video, audio } = host();
    audio[1].projectItem.getMediaPath = () => "/unprobed/audio.wav";
    const before = [...video, ...audio].map(clip => clip.snapshot());
    const advanced = getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => 3600 });
    await expect(advanced.slip_edit.handler({ node_id: "v1", offset_seconds: 1 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("without the preflight duration evidence") });
    expect([...video, ...audio].map(clip => clip.snapshot())).toEqual(before);
  });

  it.each([null, NaN, Infinity, -1, 0])("refuses unknown or invalid physical duration %s without sending a mutation", async duration => {
    host();
    const advanced = getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => duration });
    await expect(advanced.slip_edit.handler({ node_id: "v1", offset_seconds: 1 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Physical media duration") });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });
});

describe("source end tick precision", () => {
  it.each([40000, 0.5 / TICKS])("refuses duration %s outside the exact positive tick range before mutation", async duration => {
    const { video, audio } = host();
    const before = [...video, ...audio].map(clip => clip.snapshot());
    const advanced = getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => duration });
    const timeline = getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: async () => duration });
    await expect(advanced.slip_edit.handler({ node_id: "v0", offset_seconds: 1 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("exact tick range") });
    await expect(timeline.trim_clip.handler({ node_id: "v0", new_out_seconds: 9 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("exact tick range") });
    expect([...video, ...audio].map(clip => clip.snapshot())).toEqual(before);
    expect(mockedSendCommand).toHaveBeenCalledTimes(2);
  });
});

describe("exact probed tick caps", () => {
  it("allows the exact source end and rejects one tick beyond it before changing either linked clip", async () => {
    const { video, audio } = host();
    const cap = 61 * TICKS;
    const timeline = getTimelineTools(bridgeOptions, { probeMediaDurationTicks: async () => cap });
    await expect(timeline.trim_clip.handler({ node_id: "v2", new_out_seconds: cap / TICKS })).resolves.toMatchObject({ success: true });
    const before = [...video, ...audio].map(clip => clip.snapshot());
    const beforeTicks = [...video, ...audio].map(clip => [clip.inPoint.ticks, clip.outPoint.ticks, clip.start.ticks, clip.end.ticks]);
    await expect(timeline.trim_clip.handler({ node_id: "v2", new_out_seconds: (cap + 1) / TICKS })).resolves.toMatchObject({ success: false, error: expect.stringContaining("real media duration") });
    expect([...video, ...audio].map(clip => clip.snapshot())).toEqual(before);
    expect([...video, ...audio].map(clip => [clip.inPoint.ticks, clip.outPoint.ticks, clip.start.ticks, clip.end.ticks])).toEqual(beforeTicks);
  });

  it("slip accepts the exact tick cap without subtracting a global epsilon", async () => {
    const { video, audio } = host();
    const advanced = getAdvancedTools(bridgeOptions, { probeMediaDurationTicks: async () => 31 * TICKS });
    await expect(advanced.slip_edit.handler({ node_id: "v1", offset_seconds: 1 })).resolves.toMatchObject({ success: true });
    expect(video[1].snapshot()).toEqual([10, 30, 11, 31]);
    expect(audio[1].snapshot()).toEqual([10, 30, 11, 31]);
  });
});


describe("physical evidence stays bound to project and sequence context", () => {
  it.each(["trim", "slip"])("%s refuses a copied project reusing clip and sequence IDs", async (operation) => {
    const { video, audio, context } = host();
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    const writes = [...video, ...audio].flatMap((clip) => [vi.spyOn(clip, "inPoint", "set"), vi.spyOn(clip, "outPoint", "set"), vi.spyOn(clip, "start", "set"), vi.spyOn(clip, "end", "set")]);
    const probe = async () => {
      context.app.project = { ...context.app.project, documentID: "copied-project" };
      return 3600 * TICKS;
    };
    const result = operation === "trim"
      ? await getTimelineTools(bridgeOptions, { probeMediaDurationTicks: probe }).trim_clip.handler({ node_id: "v1", new_out_seconds: 29 })
      : await getAdvancedTools(bridgeOptions, { probeMediaDurationTicks: probe }).slip_edit.handler({ node_id: "v1", offset_seconds: 1 });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("changed after media preflight") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it.each(["trim", "slip"])("%s refuses an active sequence switch reusing clip IDs and media", async (operation) => {
    const { video, audio, context } = host();
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    const writes = [...video, ...audio].flatMap((clip) => [vi.spyOn(clip, "inPoint", "set"), vi.spyOn(clip, "outPoint", "set"), vi.spyOn(clip, "start", "set"), vi.spyOn(clip, "end", "set")]);
    const probe = async () => {
      context.app.project.activeSequence = { ...context.app.project.activeSequence, sequenceID: "copied-sequence" };
      return 3600 * TICKS;
    };
    const result = operation === "trim"
      ? await getTimelineTools(bridgeOptions, { probeMediaDurationTicks: probe }).trim_clip.handler({ node_id: "v1", new_out_seconds: 29 })
      : await getAdvancedTools(bridgeOptions, { probeMediaDurationTicks: probe }).slip_edit.handler({ node_id: "v1", offset_seconds: 1 });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("changed after media preflight") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});

describe("slide edge write order (#719)", () => {
  it("extends the center end before moving its start past the old end", async () => {
    const { video, audio } = host();
    for (const list of [video, audio]) {
      list[1].end = { ticks: String(11 * TICKS) }; list[1].outPoint = { ticks: String(11 * TICKS) };
      list[2].start = { ticks: String(11 * TICKS) }; list[2].inPoint = { ticks: String(11 * TICKS) };
      const start = Object.getOwnPropertyDescriptor(list[1], "start")!;
      Object.defineProperty(list[1], "start", {
        get: start.get,
        set(value: unknown) { if (ticksOf(value) < ticksOf(list[1].end)) start.set!.call(list[1], value); },
      });
    }
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 3 })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(video[1].snapshot()).toEqual([13, 14, 10, 11]);
    expect(audio[1].snapshot()).toEqual(video[1].snapshot());
  });
});

describe("slide failure receipts (#719)", () => {
  it("refuses a negative adjacent source in point before touching any clip", async () => {
    const { video, audio } = host();
    video[2].inPoint = { ticks: String(0.2 * TICKS) };
    video[2].outPoint = { ticks: String(30.2 * TICKS) };
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: -0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid adjacent source range") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
  });

  it("reports partial mutation when the main clip ignores its new start", async () => {
    const { video, audio } = host();
    Object.defineProperty(video[1], "start", { get: () => ({ ticks: String(10 * TICKS) }), set: () => {} });
    const result = await tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 }) as Result;
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", timelineChanged: true, rollbackPerformed: false, linkedPartnersEdited: [] } });
    expect(result.error).toContain("Do not retry");
    expect(video[0].snapshot()[1]).toBe(10.5);
    expect(audio[0].snapshot()[1]).toBe(10);
  });

  it("reports partial mutation if a source setter throws after edge writes", async () => {
    const { video } = host();
    Object.defineProperty(video[0], "outPoint", { get: () => ({ ticks: String(10 * TICKS) }), set: () => { throw new Error("rejected source write"); } });
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("rejected source write"), data: { outcome: "committed_unverified", timelineChanged: true } });
  });

  it("does not accept an unexpected center source-window change", async () => {
    const { video } = host();
    const setEnd = Object.getOwnPropertyDescriptor(video[1], "end")!.set!;
    const getEnd = Object.getOwnPropertyDescriptor(video[1], "end")!.get!;
    Object.defineProperty(video[1], "end", { get: getEnd, set(value: unknown) { setEnd.call(video[1], value); video[1].outPoint = { ticks: String(31 * TICKS) }; } });
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified" } });
  });
});

describe("physical media bounds for adjacent edits (#718/#719)", () => {
  it("refuses a roll source end past the actual file duration before mutation", async () => {
    const { video, audio } = host();
    vi.mocked(probeMediaDurationSeconds).mockResolvedValue(60);
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    video[1].inPoint = { ticks: String(39.8 * TICKS) };
    video[1].outPoint = { ticks: String(59.8 * TICKS) };
    const beforeAfterSetup = [...video, ...audio].map((clip) => clip.snapshot());
    await expect(tools.roll_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("exceed physical media duration") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(beforeAfterSetup);
    expect(before).not.toEqual(beforeAfterSetup);
  });
  it("refuses a slide when an existing neighbor is already past media end", async () => {
    const { video, audio } = host();
    vi.mocked(probeMediaDurationSeconds).mockResolvedValue(20);
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("existing source window") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
  });
  it("refuses unknown physical duration rather than treating it as unlimited", async () => {
    const { video, audio } = host();
    vi.mocked(probeMediaDurationSeconds).mockResolvedValue(null);
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    await expect(tools.roll_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("duration could not be verified") });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
  });
  it("refuses source replacement after probing", async () => {
    const { video, audio } = host();
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    vi.mocked(probeMediaDurationSeconds).mockImplementation(async () => { video[1].projectItem.getMediaPath = () => "/replacement.mp4"; return 100; });
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Media source changed") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
  });
  it("refuses changed placement after probing", async () => {
    const { video } = host();
    vi.mocked(probeMediaDurationSeconds).mockImplementation(async () => { video[1].start = { ticks: String(11 * TICKS) }; return 100; });
    await expect(tools.slide_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("placement or source window changed") });
    expect(video[0].snapshot()[1]).toBe(10);
  });
});

describe("exact physical source end", () => {
  it("does not allow a one-tick overrun under readback tolerance", async () => {
    const { video, audio } = host();
    vi.mocked(probeMediaDurationSeconds).mockResolvedValue(60);
    video[1].inPoint = { ticks: String(39.5 * TICKS + 1) };
    video[1].outPoint = { ticks: String(59.5 * TICKS + 1) };
    const before = [...video, ...audio].map((clip) => clip.snapshot());
    await expect(tools.roll_edit.handler({ node_id: "v1", offset_seconds: 0.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("exceed physical media duration") });
    expect([...video, ...audio].map((clip) => clip.snapshot())).toEqual(before);
  });
});
