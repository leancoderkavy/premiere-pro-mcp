import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), sendRawCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getScriptingTools } from "../../src/tools/scripting.js";
import { getInspectionTools } from "../../src/tools/inspection.js";
const TICKS = 254016000000;
const options = { tempDir: "/tmp/source-sync", timeoutMs: 1000 };
const tools = { ...getDiscoveryTools(options), ...getScriptingTools(options), ...getInspectionTools(options) };
const toolNames = ["get_active_sequence", "get_sequence_structure", "get_full_sequence_info"] as const;
function collection(items: any[], count = "numItems") { return Object.assign({ [count]: items.length }, items); }
function time(ticks: number) { return { ticks: String(ticks) }; }
function clip(id: string, inside = 20 * TICKS, start = 2 * TICKS, sourceId = "source") {
  return {
    nodeId: id, name: 'Clip"\\\nname', start: time(start), end: time(start + 5 * TICKS), duration: time(5 * TICKS),
    inPoint: time(inside), outPoint: time(inside + 5 * TICKS), mediaType: "Video",
    components: collection([]), projectItem: { nodeId: sourceId, name: "Source", getMediaPath: () => "/media/shared.mov" },
  } as any;
}
function fixture(video: any[], audio: any[], frame: unknown = TICKS / 25, background = false) {
  const track = (items: any[]) => ({ name: 'Track"\\\n', clips: collection(items), transitions: collection([]), isMuted: () => false, isLocked: () => false });
  const seq = { name: 'Edit"\\\nname', sequenceID: 'seq"\\id', timebase: frame, end: String(100 * TICKS),
    frameSizeHorizontal: 1920, frameSizeVertical: 1080, videoTracks: collection([track(video)], "numTracks"), audioTracks: collection([track(audio)], "numTracks") };
  const project = { activeSequence: background ? { sequenceID: "different", videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 0 } } : seq, sequences: collection([seq], "numSequences") };
  vi.mocked(sendCommand).mockImplementation(async script => {
    const source = getHelpersSource() + "\n" + script;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(source, { app: { project } })));
  });
  return seq;
}
function linked(video: any, audio: any) { video.getLinkedItems = () => collection([audio]); audio.getLinkedItems = () => collection([video]); }
beforeEach(() => vi.clearAllMocks());

for (const toolName of toolNames) {
  const run = (args = {}) => tools[toolName].handler(args as never) as Promise<any>;
  describe(`${toolName} audio source and alignment readback`, () => {
    for (const [rate, frameTicks] of [["25", TICKS / 25], ["23.976", 10594584000], ["29.97 DF", 8475667200]] as const) {
      it.each([-1, 1])(`reports a signed one-frame linked difference at ${rate} (%s)`, async sign => {
        const video = clip('video"\\id'), audio = clip('audio"\\id', 20 * TICKS + sign * frameTicks);
        linked(video, audio); fixture([video], [audio], String(frameTicks));
        const result = await run();
        expect(result.success).toBe(true);
        const audioInfo = result.data.audioTracks[0].clips[0];
        expect(audioInfo[toolName === "get_active_sequence" ? "inPoint" : "inPointSeconds"]).toBe((20 * TICKS + sign * frameTicks) / TICKS);
        expect(audioInfo[toolName === "get_active_sequence" ? "outPoint" : "outPointSeconds"]).toBe((25 * TICKS + sign * frameTicks) / TICKS);
        expect(result.data.syncWarnings).toEqual([expect.objectContaining({ basis: "linked", videoNodeId: video.nodeId, audioNodeId: audio.nodeId, sourceAlignmentDeltaTicks: String(sign * frameTicks), sourceAlignmentDeltaFrames: sign, sameSourceMedia: true })]);
        expect(result.data.syncCheck).toMatchObject({ frameTicks: String(frameTicks), comparedPairs: 1, truncated: false });
      });
      it(`does not warn below one exact ${rate} frame`, async () => {
        const video = clip("v"), audio = clip("a", 20 * TICKS + frameTicks - 1);
        linked(video, audio); fixture([video], [audio], frameTicks);
        expect((await run()).data.syncWarnings).toEqual([]);
      });
    }
    it("uses a unique same-start same-media pair when links are unavailable", async () => {
      const video = clip("v"), audio = clip("a", 20 * TICKS + TICKS / 25, 2 * TICKS, "duplicate-import");
      fixture([video], [audio]);
      const data = (await run()).data;
      expect(data.syncWarnings).toEqual([expect.objectContaining({ basis: "same_source_same_start", sameSourceMedia: true })]);
      expect(data.syncCheck.unreadableLinks).toBe(2);
    });
    it.each(["throw", "malformed", "outside-index", "truncated"])("does not guess a fallback partner after unresolved links: %s", async mode => {
      const video = clip("v"), audio = clip("a", 21 * TICKS);
      audio.getLinkedItems = () => {
        if (mode === "throw") throw new Error("unreadable links");
        if (mode === "malformed") return { numItems: NaN };
        if (mode === "truncated") return { numItems: 201 };
        return collection([{ nodeId: "actual-partner-not-readable" }]);
      };
      fixture([video], [audio]);
      const data = (await run({ track_type: "audio" })).data;
      expect(data.syncWarnings).toEqual([]);
      expect(data.syncCheck.status).toBe("partial");
    });
    it("does not match unrelated source media", async () => {
      const video = clip("v"), audio = clip("a", 21 * TICKS, 2 * TICKS, "other-source");
      audio.projectItem.getMediaPath = () => "/media/other.wav";
      fixture([video], [audio]);
      expect((await run()).data.syncWarnings).toEqual([]);
    });
    it("does not infer a fallback pair with different timeline starts", async () => {
      fixture([clip("v")], [clip("a", 21 * TICKS, 3 * TICKS)]);
      expect((await run()).data.syncWarnings).toEqual([]);
    });
    it("discloses ambiguous same-source candidates instead of guessing", async () => {
      fixture([clip("v")], [clip("a1", 21 * TICKS), clip("a2", 22 * TICKS)]);
      const data = (await run()).data;
      expect(data.syncWarnings).toEqual([]);
      expect(data.syncCheck).toMatchObject({ status: "partial", ambiguousMatches: 3 });
    });
    it("does not mistake an aligned linked J-cut for drift", async () => {
      const video = clip("v", 22 * TICKS, 2 * TICKS), audio = clip("a", 20 * TICKS, 0);
      linked(video, audio); fixture([video], [audio]);
      expect((await run()).data.syncWarnings).toEqual([]);
    });
    it("labels a linked difference across different source origins as heuristic", async () => {
      const video = clip("v"), audio = clip("a", 21 * TICKS, 2 * TICKS, "wav");
      audio.projectItem.getMediaPath = () => "/media/recording.wav";
      linked(video, audio); fixture([video], [audio]);
      const data = (await run()).data;
      expect(data.syncWarnings[0]).toMatchObject({ basis: "linked", sameSourceMedia: false });
      expect(data.syncCheck.scope).toContain("may intentionally use different source origins");
    });
    it("can compare a returned audio clip with its counterpart outside the page and filters", async () => {
      const video = clip("v"), audio = clip("a", 21 * TICKS);
      linked(video, audio); fixture([video], [audio]);
      const first = (await run({ clip_limit: 1 })).data;
      const second = (await run({ clip_offset: 1, clip_limit: 1 })).data;
      const audioOnly = (await run({ track_type: "audio", start_seconds: 2, end_seconds: 4 })).data;
      expect(first.pagination).toMatchObject({ returned: 1, nextOffset: 1 });
      expect(second.pagination).toMatchObject({ returned: 1, nextOffset: null });
      for (const data of [first, second, audioOnly]) expect(data.syncWarnings).toHaveLength(1);
      expect(second.audioTracks[0].clips[0].nodeId).toBe("a");
      expect(audioOnly.videoTracks[0].clips).toEqual([]);
    });
    it("marks unknown source identities as partial rather than declaring clean sync", async () => {
      const video = clip("v"), audio = clip("a", 21 * TICKS);
      delete video.projectItem; delete audio.projectItem;
      fixture([video], [audio]);
      const data = (await run()).data;
      expect(data.syncWarnings).toEqual([]);
      expect(data.syncCheck).toMatchObject({ status: "partial", unknownSources: 2, comparedPairs: 0 });
    });
    it("marks unreadable source ticks as partial", async () => {
      const video = clip("v"), audio = clip("a");
      audio.inPoint = { ticks: "not ticks" };
      linked(video, audio); fixture([video], [audio]);
      const data = (await run()).data;
      expect(data.syncWarnings).toEqual([]);
      expect(data.syncCheck).toMatchObject({ status: "partial", skippedClips: 1 });
    });
    it.each([undefined, "unknown", 0, NaN])("does not claim a clean check without the frame grid %s", async frame => {
      fixture([clip("v")], [clip("a", 21 * TICKS)], frame === undefined ? "" : frame);
      const data = (await run()).data;
      expect(data.syncWarnings).toEqual([]);
      expect(data.syncCheck).toMatchObject({ status: "unavailable", frameTicks: null, comparedPairs: 0 });
    });
    it("caps warnings while retaining clip pagination and payload bounds", async () => {
      const video = Array.from({ length: 40 }, (_, i) => clip(`v${i}`, 20 * TICKS, i * TICKS, `source${i}`));
      const audio = video.map((v, i) => clip(`a${i}`, 21 * TICKS, i * TICKS, `source${i}`));
      video.forEach((v, i) => linked(v, audio[i])); fixture(video, audio);
      const result = await run({ clip_limit: 200 });
      expect(result.success).toBe(true);
      expect(result.data.pagination.returned).toBe(80);
      expect(result.data.syncWarnings.length).toBeGreaterThan(0);
      expect(result.data.syncWarnings.length).toBeLessThanOrEqual(25);
      expect(result.data.syncWarnings.reduce((sum: number, warning: unknown) => sum + JSON.stringify(warning).length, 0)).toBeLessThanOrEqual(10000);
      expect(result.data.syncCheck).toMatchObject({ warningsTruncated: true, truncated: true, comparedPairs: 40 });
      expect(JSON.stringify(result).length).toBeLessThan(60000);
    });
  });
}

it.each(["get_sequence_structure", "get_full_sequence_info"] as const)("%s resolves linked clips inside a named background sequence", async toolName => {
  const video = clip("v"), audio = clip("a", 21 * TICKS);
  linked(video, audio); const seq = fixture([video], [audio], TICKS / 25, true);
  const result = await tools[toolName].handler({ sequence_id: seq.sequenceID }) as any;
  expect(result.success).toBe(true);
  expect(result.data.syncWarnings).toEqual([expect.objectContaining({ videoNodeId: "v", audioNodeId: "a" })]);
});

it("bounds the additional source scan on long sequences", async () => {
  const video = Array.from({ length: 10001 }, (_, i) => clip(`v${i}`));
  fixture(video, []);
  const result = await tools.get_active_sequence.handler({ clip_limit: 1 }) as any;
  expect(result.success).toBe(true);
  expect(result.data.syncCheck).toMatchObject({ scannedClips: 10000, truncated: true, status: "partial" });
  expect(result.data.pagination).toMatchObject({ totalClips: 10001, returned: 1, nextOffset: 1 });
});

it("shortens a large-name page and resumes without changing clip order", async () => {
  const video = Array.from({ length: 40 }, (_, i) => ({ ...clip(`v${i}`), name: "x".repeat(3000) }));
  fixture(video, []);
  const first = await tools.get_active_sequence.handler({}) as any;
  expect(first.success).toBe(true);
  expect(first.data.pagination.returned).toBeLessThan(50);
  expect(JSON.stringify(first).length).toBeLessThan(60000);
  const second = await tools.get_active_sequence.handler({ clip_offset: first.data.pagination.nextOffset }) as any;
  expect(second.data.videoTracks[0].clips[0].nodeId).toBe(`v${first.data.pagination.returned}`);
});

function doubleSystem(offsets: number[], frame = 10584000000, origin = 464044896000000) {
  const video = offsets.map((_, i) => clip(`picture-${i}`, origin + i * 10 * TICKS, i * 10 * TICKS, `video-subclip-${i}`));
  const audio = offsets.map((offset, i) => clip(`sound-${i}`, origin + i * 10 * TICKS + offset * frame, i * 10 * TICKS, `audio-subclip-${i}`));
  for (let i = 0; i < video.length; i++) {
    video[i].name = `Picture "${i}" \\ name\n`;
    audio[i].name = `Sound "${i}" \\ name\n`;
    video[i].projectItem.getMediaPath = () => "/private/media/Jeremy_raw_video.mp4";
    audio[i].projectItem.getMediaPath = () => "/private/media/Jeremy_raw_audio_enhanced.wav";
    video[i].getLinkedItems = () => null;
    audio[i].getLinkedItems = () => null;
  }
  fixture(video, audio, String(frame));
  return { video, audio };
}
for (const name of toolNames) {
  const run = (args = {}) => tools[name].handler(args as never) as Promise<any>;
  describe(`${name} separate picture and sound offset groups`, () => {
    it("reports the measured one-frame double-system offset without asserting its source zero is wrong", async () => {
      doubleSystem([-1]);
      const data = (await run()).data;
      expect(data.syncCheck.comparedPairs).toBe(1);
      expect(data.syncCheck.pairOffsets).toEqual([expect.objectContaining({ videoNodeId: "picture-0", audioNodeId: "sound-0", sourceAlignmentDeltaTicks: "-10584000000", sourceAlignmentDeltaFrames: -1, videoStartTicks: "0" })]);
      expect(data.syncWarnings).toEqual([]);
    });
    it.each([["24", 10584000000], ["23.976", 10594584000], ["29.97", 8475667200]])("reports constant offsets using exact %s sequence ticks without warning", async (_rate, frame) => {
      doubleSystem([-1, -1, -1], frame);
      const data = (await run()).data;
      expect(data.syncCheck.comparedPairs).toBe(3);
      expect(data.syncCheck.pairOffsets.map((p: any) => p.sourceAlignmentDeltaFrames)).toEqual([-1, -1, -1]);
      expect(data.syncWarnings).toEqual([]);
    });
    it("lists every observed pair and the mode when offsets within one media group differ", async () => {
      const { video, audio } = doubleSystem([-1, 0, -1]);
      const data = (await run()).data;
      expect(data.syncWarnings).toHaveLength(1);
      expect(data.syncWarnings[0]).toMatchObject({ code: "inconsistentOffset", pairCount: 3, distinctOffsets: 2, mostCommonOffsetFrames: -1, mostCommonOffsetCount: 2, mostCommonOffsetTied: false, pairsTruncated: false });
      expect(data.syncWarnings[0].pairs.map((p: any) => p.sourceAlignmentDeltaFrames)).toEqual([-1, 0, -1]);
      expect(data.syncWarnings[0].pairs[0]).toMatchObject({ videoName: video[0].name, audioName: audio[0].name, videoNodeId: video[0].nodeId, audioNodeId: audio[0].nodeId, timelineStartSeconds: 0 });
      expect(JSON.stringify({ warnings: data.syncWarnings, check: data.syncCheck })).not.toContain("/private/media/");
      expect(data.syncWarnings[0].scope).toContain("no pair is identified as correct");
    });
    it("includes bounded group context beyond a one-clip page and audio-only filters", async () => {
      doubleSystem([-1, 0, -1]);
      for (const args of [{ clip_limit: 1 }, { track_type: "audio", clip_limit: 1 }]) {
        const data = (await run(args)).data;
        expect(data.pagination.returned).toBe(1);
        expect(data.syncCheck.comparedPairs).toBe(3);
        expect(data.syncWarnings[0].pairs).toHaveLength(3);
        expect(data.syncCheck.scope).toContain("bounded context");
      }
    });
    it("discloses a tie rather than identifying one offset as correct", async () => {
      doubleSystem([-1, 0]);
      const data = (await run()).data;
      expect(data.syncWarnings[0]).toMatchObject({ mostCommonOffsetTied: true, mostCommonOffsetCount: 1, pairCount: 2 });
    });
    it("does not combine different picture/sound media groups", async () => {
      const { video, audio } = doubleSystem([-1, -1, 2]);
      video[2].projectItem.getMediaPath = () => "/private/media/other-picture.mov";
      audio[2].projectItem.getMediaPath = () => "/private/media/other-sound.wav";
      const data = (await run()).data;
      expect(data.syncCheck.comparedPairs).toBe(3);
      expect(data.syncWarnings).toEqual([]);
      expect(new Set(data.syncCheck.pairOffsets.map((p: any) => p.mediaPairGroup)).size).toBe(2);
    });
    it("leaves same-source one-frame warnings unchanged", async () => {
      const { video, audio } = doubleSystem([-1]);
      audio[0].projectItem.getMediaPath = video[0].projectItem.getMediaPath;
      const data = (await run()).data;
      expect(data.syncWarnings[0]).toMatchObject({ code: "SOURCE_ALIGNMENT_DIFFERENCE", basis: "same_source_same_start", sourceAlignmentDeltaFrames: -1 });
      expect(data.syncCheck.comparedPairs).toBe(1);
    });
  });
}
it("bounds separate-media candidate products and diagnostic payloads", async () => {
  const { video, audio } = doubleSystem(Array.from({ length: 100 }, (_, i) => i % 2));
  for (const item of [...video, ...audio]) { item.start = time(0); item.end = time(5 * TICKS); }
  const result = await tools.get_active_sequence.handler({ clip_limit: 200 }) as any;
  expect(result.success).toBe(true);
  expect(result.data.syncCheck.candidatePairs).toBe(4000);
  expect(result.data.syncCheck.comparedPairs).toBeLessThanOrEqual(4000);
  expect(result.data.syncCheck).toMatchObject({ truncated: true, status: "partial", pairOffsetsTruncated: true });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(60000);
  expect(result.data.pagination.returned).toBeGreaterThan(0);
});
