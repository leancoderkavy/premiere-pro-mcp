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
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { confirmationToken, getEditPlanTools } from "../../src/tools/edit-plans.js";
import { staticEditPlanTokenStore } from "../helpers/static-edit-plan-token-store.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";
import { getSpotWorkflowTools, spotWorkflowConfirmationToken } from "../../src/tools/spot-workflows.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/issue-562", timeoutMs: 5000 };
const TICKS = 254016000000;

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalled();
  return mockedSendCommand.mock.calls[0][0] as string;
}

function ticksOf(seconds: number) {
  return String(Math.round(seconds * TICKS));
}

function secondsOf(ticks: string | number) {
  return parseFloat(String(ticks)) / TICKS;
}

function rangesOf(track: { clips: { numItems: number; [i: number]: { start: { ticks: string }; end: { ticks: string } } } }) {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < track.clips.numItems; i++) {
    ranges.push([
      Math.round(secondsOf(track.clips[i].start.ticks) * 100) / 100,
      Math.round(secondsOf(track.clips[i].end.ticks) * 100) / 100,
    ]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function makeClip(id: string, startSeconds: number, endSeconds: number, itemId = id) {
  let startT = Math.round(startSeconds * TICKS);
  let endT = Math.round(endSeconds * TICKS);
  const assign = (value: unknown) => {
    if (value && typeof value === "object" && "ticks" in (value as object)) {
      return parseFloat(String((value as { ticks: string }).ticks));
    }
    return parseFloat(String(value));
  };
  return {
    nodeId: id,
    name: id,
    projectItem: { nodeId: itemId, name: itemId },
    components: { numItems: 0 },
    get start() { return { ticks: String(startT) }; },
    set start(value: unknown) { startT = assign(value); },
    get end() { return { ticks: String(endT) }; },
    set end(value: unknown) { endT = assign(value); },
  };
}

function makeTrack(clips: ReturnType<typeof makeClip>[], syncLocked = true, locked = false) {
  const arr = clips.slice();
  const clipsCol: { numItems: number; [i: number]: ReturnType<typeof makeClip> } = {
    get numItems() { return arr.length; },
  } as { numItems: number; [i: number]: ReturnType<typeof makeClip> };
  const reindex = () => {
    for (let i = 0; i < 64; i++) delete clipsCol[i];
    arr.forEach((clip, index) => { clipsCol[index] = clip; });
  };
  reindex();
  const track = {
    clips: clipsCol,
    transitions: { get numItems() { return 0; } },
    isLocked() { return track._locked; },
    _arr: arr,
    _reindex: reindex,
    _syncLocked: syncLocked,
    _locked: locked,
  };
  return track;
}

function parseQeTimecode(value: string, fps: number) {
  const parts = String(value).split(/[:;]/).map((part) => parseInt(part, 10) || 0);
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts.slice(-4);
  return ((h * 3600 + m * 60 + s) * fps + f) * (TICKS / fps);
}

function insertOnTrack(
  track: ReturnType<typeof makeTrack>,
  item: { nodeId: string; getInPoint: () => { ticks: string }; getOutPoint: () => { ticks: string } },
  atTicks: string | number,
  newId: string,
) {
  const at = parseFloat(String(atTicks));
  const duration = parseFloat(item.getOutPoint().ticks) - parseFloat(item.getInPoint().ticks);
  const spawned: ReturnType<typeof makeClip>[] = [];
  for (const clip of track._arr.slice()) {
    const start = parseFloat(clip.start.ticks);
    const end = parseFloat(clip.end.ticks);
    if (start < at - 1 && end > at + 1) {
      spawned.push(makeClip(`${clip.nodeId}-right`, secondsOf(at), secondsOf(end), clip.projectItem.nodeId));
      clip.end = String(at);
    }
  }
  track._arr.push(...spawned);
  const movers = track._arr.filter((clip) => parseFloat(clip.start.ticks) >= at - 1)
    .sort((a, b) => parseFloat(b.start.ticks) - parseFloat(a.start.ticks));
  for (const clip of movers) {
    clip.end = String(parseFloat(clip.end.ticks) + duration);
    clip.start = String(parseFloat(clip.start.ticks) + duration);
  }
  track._arr.push(makeClip(newId, secondsOf(at), secondsOf(at + duration), item.nodeId));
  track._reindex();
}

function issue562Host(options: {
  qe?: boolean;
  allLocked?: boolean;
  playheadSeconds?: number;
  lockedVideo?: number[];
  unlockedVideo?: number[];
  omitIsLocked?: boolean;
  noopRazor?: boolean;
  insertNoop?: boolean;
  sequenceID?: string;
  emptyTargets?: boolean;
  overlaySeconds?: [number, number];
  sourceDurationSeconds?: number;
  mediaKind?: "audio_only" | "video_only";
  displaceTargetTail?: boolean;
  displacePreRazoredTail?: boolean;
  noAudioRazor?: boolean;
  razorThrowsAfterCut?: boolean;
  insertThrowsAfterMutation?: boolean;
} = {}) {
  // Premiere's getIn/OutPoint(mediaType): 1 = video, 2 = audio, 4 = any. A missing
  // stream reads back as a zero-length span.
  const missingType = options.mediaKind === "audio_only" ? 1 : options.mediaKind === "video_only" ? 2 : 0;
  const source = {
    nodeId: "src",
    name: "src",
    getInPoint() { return { ticks: ticksOf(0) }; },
    getOutPoint(mediaType?: number) {
      return { ticks: ticksOf(mediaType !== undefined && mediaType === missingType ? 0 : options.sourceDurationSeconds ?? 2) };
    },
  };
  const overlay = options.overlaySeconds ?? [6, 10];
  const v1 = makeTrack(options.emptyTargets ? [] : [
    makeClip("v1a", 0, 4, "a"), makeClip("v1b", 4, 8, "b"),
    makeClip("v1c", 8, 12, "c"), makeClip("v1d", 12, 18, "d"),
  ]);
  const v2 = makeTrack([makeClip("v2", overlay[0], overlay[1], "cam2")]);
  const v3 = makeTrack([makeClip("v3", 2, 36, "cam3")]);
  const a1 = makeTrack(options.emptyTargets ? [] : [
    makeClip("a1a", 0, 4, "a"), makeClip("a1b", 4, 8, "b"),
    makeClip("a1c", 8, 12, "c"), makeClip("a1d", 12, 18, "d"),
  ]);
  const a2 = makeTrack([makeClip("a2", overlay[0], overlay[1], "cam2")]);
  const a3 = makeTrack([makeClip("a3", 2, 36, "cam3")]);
  const videoTracks = { 0: v1, 1: v2, 2: v3, get numTracks() { return 3; } };
  const audioTracks = { 0: a1, 1: a2, 2: a3, get numTracks() { return 3; } };
  (options.lockedVideo ?? []).forEach((index) => {
    [v1, v2, v3][index]._locked = true;
    [a1, a2, a3][index]._locked = true;
  });
  (options.unlockedVideo ?? []).forEach((index) => {
    [v1, v2, v3][index]._syncLocked = false;
    [a1, a2, a3][index]._syncLocked = false;
  });
  if (options.omitIsLocked) {
    [v1, v2, v3, a1, a2, a3].forEach((track) => {
      delete (track as { isLocked?: unknown }).isLocked;
    });
  }
  let insertionCount = 0;
  const seq = {
    sequenceID: options.sequenceID ?? "seq-562",
    name: options.sequenceID ?? "seq-562",
    timebase: String(TICKS / 24),
    videoTracks,
    audioTracks,
    getPlayerPosition() { return { ticks: ticksOf(options.playheadSeconds ?? 8) }; },
    insertClip(item: typeof source, time: string | number, vTrack: number, aTrack: number) {
      if (options.insertNoop) return;
      insertionCount++;
      const targetTracks = [videoTracks[vTrack as 0 | 1 | 2], audioTracks[aTrack as 0 | 1 | 2]];
      const beforeIds = targetTracks.map((track) => new Set(track._arr.map((clip) => clip.nodeId)));
      // Like Premiere, only a track that receives part of the item is rippled.
      if (options.mediaKind !== "audio_only") insertOnTrack(videoTracks[vTrack as 0 | 1 | 2], item, time, `ins-v-${vTrack}-${insertionCount}`);
      if (options.mediaKind !== "video_only") insertOnTrack(audioTracks[aTrack as 0 | 1 | 2], item, time, `ins-a-${aTrack}-${insertionCount}`);
      if (options.displaceTargetTail || options.displacePreRazoredTail) {
        targetTracks.forEach((track, index) => {
          const tail = track._arr.find((clip) => clip.nodeId.endsWith("-right") &&
            (options.displacePreRazoredTail || !beforeIds[index].has(clip.nodeId)));
          if (tail) {
            const duration = parseFloat(tail.end.ticks) - parseFloat(tail.start.ticks);
            tail.start = ticksOf(24);
            tail.end = String(parseFloat(ticksOf(24)) + duration);
          }
        });
      }
      if (options.insertThrowsAfterMutation) throw new Error("insert threw after changing a track");
    },
  };

  function qeTrackFor(track: ReturnType<typeof makeTrack>) {
    const qeTrack: {
      isSyncLocked: () => boolean;
      isLocked?: () => boolean;
      razor: (timecode: string) => void;
    } = {
      isSyncLocked() { return options.allLocked === false ? false : track._syncLocked; },
      razor(timecode: string) {
        if (options.noopRazor) return;
        const at = parseQeTimecode(timecode, 24);
        const spawned: ReturnType<typeof makeClip>[] = [];
        for (const clip of track._arr.slice()) {
          const start = parseFloat(clip.start.ticks);
          const end = parseFloat(clip.end.ticks);
          if (start < at - 1 && end > at + 1) {
            spawned.push(makeClip(`${clip.nodeId}-right`, secondsOf(at), secondsOf(end), clip.projectItem.nodeId));
            clip.end = String(at);
          }
        }
        track._arr.push(...spawned);
        track._reindex();
        if (options.razorThrowsAfterCut) throw new Error("razor threw after changing a track");
      },
    };
    if (!options.omitIsLocked) {
      qeTrack.isLocked = () => track._locked;
    }
    if (options.noAudioRazor && [a1, a2, a3].includes(track)) delete (qeTrack as { razor?: unknown }).razor;
    return qeTrack;
  }

  const qeSeq = {
    getVideoTrackAt(index: number) { return qeTrackFor([v1, v2, v3][index]); },
    getAudioTrackAt(index: number) { return qeTrackFor([a1, a2, a3][index]); },
  };

  const sandbox: Record<string, unknown> = {
    app: {
      enableQE() {},
      project: {
        activeSequence: seq,
        sequences: { 0: seq, get numSequences() { return 1; } },
        rootItem: { children: { numItems: 1, 0: source } },
      },
      sourceMonitor: { getProjectItem() { return source; } },
    },
    Time: function Time(this: { ticks: string; getFormatted?: () => string }) {
      this.ticks = "0";
    },
  };
  if (options.qe !== false) {
    sandbox.qe = { project: { getActiveSequence() { return qeSeq; } } };
  }
  return { sandbox, seq, source };
}

function runScript(script: string, sandbox: Record<string, unknown>) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, sandbox)));
}

function runHelper(
  sandbox: Record<string, unknown>,
  seq: unknown,
  item: unknown,
  timeSeconds: number,
  scope = "sync_locked",
) {
  sandbox.seq = seq;
  sandbox.item = item;
  return JSON.parse(String(runInNewContext(
    `${getHelpersSource()}\nJSON.stringify(__insertClipHonoringSyncLock(seq, item, "${ticksOf(timeSeconds)}", 0, 0, "${scope}"));`,
    sandbox,
  )));
}

beforeEach(() => vi.clearAllMocks());

describe("issue #562 — insert_from_source honors sync lock", () => {
  const source = getSourceMonitorTools(bridgeOptions);

  it("documents sync-lock scope and refuses unverified success", () => {
    expect(source.insert_from_source.description).toMatch(/sync-locked/i);
    expect(source.insert_from_source.parameters.properties.scope).toMatchObject({
      type: "string",
      enum: ["sync_locked", "target_tracks"],
    });
  });

  it("rejects invalid track indexes before contacting Premiere", async () => {
    await expect(source.insert_from_source.handler({ video_track_index: -1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("does not return inserted:true from Sequence.insertClip alone", async () => {
    const helpers = getHelpersSource();
    expect(helpers).toContain("function __insertClipHonoringSyncLock(");
    expect(helpers).toContain("isSyncLocked()");
    expect(helpers).toContain("__writeClipSpan(");
    expect(helpers).toContain("expectedVideoAdded");
    const script = await scriptFor(source.insert_from_source, {});
    expect(script).toContain('__insertClipHonoringSyncLock(seq, item, pos, 0, 0, "sync_locked")');
    expect(script).not.toMatch(/seq\.insertClip\([^)]+\);\s*return __result\(\{\s*inserted:\s*true/);
  });

  it("ripples every sync-locked track in the published six-track repro", async () => {
    const script = await scriptFor(source.insert_from_source, {
      video_track_index: 0,
      audio_track_index: 0,
    });
    const { sandbox, seq } = issue562Host();
    const result = runScript(script, sandbox);

    expect(result).toMatchObject({ success: true, data: { inserted: true, verified: true, syncLockHonored: true } });
    expect(rangesOf(seq.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 10], [10, 14], [14, 20]]);
    expect(rangesOf(seq.audioTracks[0])).toEqual([[0, 4], [4, 8], [8, 10], [10, 14], [14, 20]]);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 8], [10, 12]]);
    expect(rangesOf(seq.audioTracks[1])).toEqual([[6, 8], [10, 12]]);
    expect(rangesOf(seq.videoTracks[2])).toEqual([[2, 8], [10, 38]]);
    expect(rangesOf(seq.audioTracks[2])).toEqual([[2, 8], [10, 38]]);
  });

  it("ripples sync-locked neighbours when the playhead splits a clip on the target track", async () => {
    const script = await scriptFor(source.insert_from_source, {
      video_track_index: 0,
      audio_track_index: 0,
    });
    const { sandbox, seq } = issue562Host({ playheadSeconds: 6 });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { inserted: true, verified: true, syncLockHonored: true } });
    expect(rangesOf(seq.videoTracks[0])).toEqual([[0, 4], [4, 6], [6, 8], [8, 10], [10, 14], [14, 20]]);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[8, 12]]);
    expect(rangesOf(seq.videoTracks[2])).toEqual([[2, 6], [8, 38]]);
  });

  it("pre-razors target straddlers so Premiere does not create a displaced tail during insert", () => {
    const { sandbox, seq, source: item } = issue562Host({ displaceTargetTail: true });
    const result = runHelper(sandbox, seq, item, 6);
    expect(result).toMatchObject({ ok: true, data: { verified: true } });
    expect(rangesOf(seq.videoTracks[0])).toContainEqual([8, 10]);
    expect(rangesOf(seq.audioTracks[0])).toContainEqual([8, 10]);
  });

  it("preflights every target razor before changing either target track", () => {
    const { sandbox, seq, source: item } = issue562Host({ noAudioRazor: true });
    const beforeVideo = rangesOf(seq.videoTracks[0]);
    const beforeAudio = rangesOf(seq.audioTracks[0]);
    const result = runHelper(sandbox, seq, item, 6);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/nothing was changed.*audio track 0.*razor/i);
    expect(rangesOf(seq.videoTracks[0])).toEqual(beforeVideo);
    expect(rangesOf(seq.audioTracks[0])).toEqual(beforeAudio);
  });

  it("refuses a subframe target cut before any QE razor changes the timeline", () => {
    const { sandbox, seq, source: item } = issue562Host();
    const beforeVideo = rangesOf(seq.videoTracks[0]);
    const beforeAudio = rangesOf(seq.audioTracks[0]);
    const result = runHelper(sandbox, seq, item, 6.01);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/nothing was changed.*frame boundary/i);
    expect(rangesOf(seq.videoTracks[0])).toEqual(beforeVideo);
    expect(rangesOf(seq.audioTracks[0])).toEqual(beforeAudio);
  });

  it("marks a throwing QE razor as changed even on its first attempted cut", () => {
    const { sandbox, seq, source: item } = issue562Host({ razorThrowsAfterCut: true });
    const result = runHelper(sandbox, seq, item, 6);
    expect(result).toMatchObject({ ok: false, changed: true });
    expect(result.error).toMatch(/timeline may be partially changed/i);
  });

  it("marks an insert that throws after mutation as changed without a QE cut", () => {
    const { sandbox, seq, source: item } = issue562Host({ emptyTargets: true, insertThrowsAfterMutation: true });
    const result = runHelper(sandbox, seq, item, 0);
    expect(result).toMatchObject({ ok: false, changed: true });
    expect(result.error).toMatch(/timeline may be partially changed/i);
  });

  it("target_tracks refuses a straddling target before mutation when QE is unavailable", () => {
    const { sandbox, seq, source: item } = issue562Host({ qe: false });
    const beforeVideo = rangesOf(seq.videoTracks[0]);
    const result = runHelper(sandbox, seq, item, 6, "target_tracks");
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/QE.*razor it in Premiere/i);
    expect(rangesOf(seq.videoTracks[0])).toEqual(beforeVideo);
  });

  it("target_tracks pre-razors a straddling target when QE is available", () => {
    const { sandbox, seq, source: item } = issue562Host({ displaceTargetTail: true });
    const result = runHelper(sandbox, seq, item, 6, "target_tracks");
    expect(result).toMatchObject({ ok: true, data: { verified: true, syncLockHonored: false } });
    expect(rangesOf(seq.videoTracks[0])).toContainEqual([8, 10]);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
  });

  it("refuses verified success when Premiere still displaces a pre-razored target tail", () => {
    const { sandbox, seq, source: item } = issue562Host({ displacePreRazoredTail: true });
    const result = runHelper(sandbox, seq, item, 6);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeline changed.*tail adjacent/i);
    expect(result.error).toContain("24s");
  });

  it("reports a displaced tail as a changed, unverified add_to_timeline result", async () => {
    const script = await scriptFor(getTimelineTools(bridgeOptions).add_to_timeline, { item_id: "src", start_seconds: 6 });
    const { sandbox } = issue562Host({ displacePreRazoredTail: true });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, outcome: "committed_unverified", verified: false } });
    expect(result.data.displacedTails[0]).toContain("24s");
  });

  it.each([1 / 24, 4 - 1 / 24])("detects displaced one-frame boundary tails at %ss", (timeSeconds) => {
    const { sandbox, seq, source: item } = issue562Host({ displacePreRazoredTail: true });
    const result = runHelper(sandbox, seq, item, timeSeconds);
    expect(result).toMatchObject({ ok: false, changed: true });
    expect(result.displacedTails[0]).toContain("24s");
  });

  it.each([false, true])("preserves displaced-tail evidence in a batch (earlier placement: %s)", async (earlierPlacement) => {
    const script = await scriptFor(getCompetitorGapTools(bridgeOptions).add_to_timeline_batch, {
      clips: [
        ...(earlierPlacement ? [{ item_id: "src", start_seconds: 0 }] : []),
        { item_id: "src", start_seconds: earlierPlacement ? 7 : 6 },
      ],
    });
    const { sandbox } = issue562Host({ displacePreRazoredTail: true });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: false, data: {
      timelineChanged: true, outcome: "committed_unverified", verified: false,
      failedPlacement: earlierPlacement ? 1 : 0,
    } });
    expect(result.data.displacedTails[0]).toContain("24s");
    expect(result.data.completedPlacements).toHaveLength(earlierPlacement ? 1 : 0);
    expect(result.error).not.toContain("Nothing was changed");
  });

  it.each([false, true])("preserves displaced-tail evidence in an edit plan (earlier operation: %s)", async (earlierOperation) => {
    const plan = { operations: [
      ...(earlierOperation ? [{ type: "insert_clip" as const, item_id: "src", start_seconds: 0 }] : []),
      { type: "insert_clip" as const, item_id: "src", start_seconds: earlierOperation ? 7 : 6 },
    ] };
    const tools = getEditPlanTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      tokenStore: staticEditPlanTokenStore,
    });
    const script = await scriptFor(tools.apply_edit_plan, { plan, confirmation_token: confirmationToken(plan) });
    const { sandbox } = issue562Host({ displacePreRazoredTail: true });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: false, data: {
      timelineChanged: true, outcome: "committed_unverified", verified: false,
      undoSteps: null,
    } });
    expect(result.data.displacedTails[0]).toContain("24s");
    expect(result.data.appliedOperations).toHaveLength(earlierOperation ? 1 : 0);
    expect(result.error).not.toContain("Nothing was changed");
  });

  it("refuses before mutation when a participating track is locked", async () => {
    const script = await scriptFor(source.insert_from_source, {});
    const { sandbox, seq } = issue562Host({ lockedVideo: [1] });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locked/i);
    expect(rangesOf(seq.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 12], [12, 18]]);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
  });

  it("leaves unlocked neighbours in place while rippling locked ones", async () => {
    const script = await scriptFor(source.insert_from_source, {});
    const { sandbox, seq } = issue562Host({ unlockedVideo: [1] });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { verified: true, syncLockHonored: true } });
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
    expect(rangesOf(seq.audioTracks[1])).toEqual([[6, 10]]);
    expect(rangesOf(seq.videoTracks[2])).toEqual([[2, 8], [10, 38]]);
  });

  it("refuses before mutation when QE cannot report track lock", async () => {
    const script = await scriptFor(source.insert_from_source, {});
    const { sandbox, seq } = issue562Host({ omitIsLocked: true });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/isLocked/i);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
  });

  it("refuses before mutation when QE cannot report sync lock", async () => {
    const script = await scriptFor(source.insert_from_source, {});
    const { sandbox, seq } = issue562Host({ qe: false });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sync-lock/i);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
  });

  it("target_tracks scope inserts only the named pair and reports the desync", async () => {
    const script = await scriptFor(source.insert_from_source, { scope: "target_tracks" });
    expect(script).toContain('"target_tracks"');
    expect(script).not.toContain('"sync_locked"');
    const { sandbox, seq } = issue562Host({ qe: false });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({
      success: true,
      data: { inserted: true, verified: true, syncLockHonored: false },
    });
    expect(result.data.warning).toMatch(/desync/i);
    expect(rangesOf(seq.videoTracks[0])[2]).toEqual([8, 10]);
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 10]]);
    expect(rangesOf(seq.videoTracks[2])).toEqual([[2, 36]]);
  });

  it("refuses a DOM-locked named track even for target_tracks", async () => {
    const script = await scriptFor(source.insert_from_source, { scope: "target_tracks" });
    const { sandbox, seq } = issue562Host({ qe: false, lockedVideo: [0] });
    const result = runScript(script, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/locked/i);
    expect(rangesOf(seq.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 12], [12, 18]]);
  });

  it("refuses before mutation when the target sequence is not active", () => {
    const target = issue562Host({ sequenceID: "target-seq" });
    const active = issue562Host({ sequenceID: "active-seq" });
    const sandbox = {
      ...target.sandbox,
      app: {
        enableQE() {},
        project: { activeSequence: active.seq, sequences: { 0: active.seq, 1: target.seq, get numSequences() { return 2; } } },
      },
      qe: active.sandbox.qe,
    };
    const result = runHelper(sandbox, target.seq, target.source, 8);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/active/i);
    expect(rangesOf(target.seq.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 12], [12, 18]]);
    expect(rangesOf(active.seq.videoTracks[2])).toEqual([[2, 36]]);
  });

  it("fails closed when QE razor does not split a spanning neighbour", () => {
    const { sandbox, seq, source: item } = issue562Host({ noopRazor: true });
    const result = runHelper(sandbox, seq, item, 8);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/razor|split|partial/i);
    expect(rangesOf(seq.videoTracks[2])).toEqual([[2, 36]]);
  });

  it("says razors already landed if insertClip then adds nothing", () => {
    const { sandbox, seq, source: item } = issue562Host({ insertNoop: true });
    const beforeV3 = rangesOf(seq.videoTracks[2]);
    const result = runHelper(sandbox, seq, item, 8);
    expect(result).toMatchObject({ ok: false, changed: true });
    expect(result.error).toMatch(/razored|partially changed/i);
    expect(rangesOf(seq.videoTracks[2])).not.toEqual(beforeV3);
  });
});

describe("issue #562 — other Sequence.insertClip callers use the same helper", () => {
  it("add_to_timeline ripples sync-locked neighbours at the requested time", async () => {
    const script = await scriptFor(getTimelineTools(bridgeOptions).add_to_timeline, {
      item_id: "src",
      start_seconds: 8,
      track_index: 0,
      audio_track_index: 0,
    });
    expect(script).toContain("__insertClipHonoringSyncLock(");
    const { sandbox, seq } = issue562Host();
    (sandbox.app as { project: { rootItem?: unknown } }).project.rootItem = {
      children: { numItems: 1, 0: (sandbox.app as { sourceMonitor: { getProjectItem: () => unknown } }).sourceMonitor.getProjectItem() },
    };
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { verified: true, syncLockHonored: true } });
    expect(rangesOf(seq.videoTracks[1])).toEqual([[6, 8], [10, 12]]);
  });

  it("apply_edit_plan insert_clip and add_to_timeline_batch call the helper", async () => {
    const plan = { operations: [{ type: "insert_clip" as const, item_id: "src", start_seconds: 8 }] };
    const tools = getEditPlanTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      operationIdFactory: () => "apply-562",
      tokenStore: staticEditPlanTokenStore,
    });
    await tools.apply_edit_plan.handler({ plan, confirmation_token: confirmationToken(plan) });
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain("__insertClipHonoringSyncLock(");

    mockedSendCommand.mockClear();
    await getCompetitorGapTools(bridgeOptions).add_to_timeline_batch.handler({
      clips: [{ item_id: "src", track_index: 0, start_seconds: 8, audio_track_index: 0 }],
    });
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain("__insertClipHonoringSyncLock(");

    mockedSendCommand.mockClear();
    const spots = getSpotWorkflowTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "spot-562",
    });
    const preview = await spots.preview_motion_graphics_demo.handler({
      sequence_id: "sequence-1",
      asset_item_ids: ["item-a"],
    });
    await spots.apply_spot_workflow_plan.handler({
      plan: preview.data.plan,
      confirmation_token: spotWorkflowConfirmationToken(preview.data.plan),
    });
    const spotScript = String(mockedSendCommand.mock.calls[0][0]);
    expect(spotScript).toContain("__insertClipHonoringSyncLock(");
    expect(spotScript).toContain("__secondsToTicks(targetStart).toString()");
    expect(spotScript).toContain("ins.changed || placed.length ? { timelineChanged: true");
    expect(spotScript).toContain('"target_tracks"');
    expect(spotScript).not.toContain('"sync_locked"');
  });

  it("apply_spot_workflow_plan insert-then-trim leaves a title overlay in place", async () => {
    const spots = getSpotWorkflowTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "spot-overlay-562",
    });
    const preview = await spots.preview_motion_graphics_demo.handler({
      sequence_id: "sequence-1",
      asset_item_ids: ["src"],
      clip_duration_seconds: 5,
      transition_name: "none",
    });
    await spots.apply_spot_workflow_plan.handler({
      plan: preview.data.plan,
      confirmation_token: spotWorkflowConfirmationToken(preview.data.plan),
    });
    const script = String(mockedSendCommand.mock.calls[0][0]);
    const { sandbox, seq } = issue562Host({
      sequenceID: "sequence-1",
      emptyTargets: true,
      overlaySeconds: [0.4, 2],
      sourceDurationSeconds: 10,
    });
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: true, data: { applied: true } });
    expect(rangesOf(seq.videoTracks[1])).toEqual([[0.4, 2]]);
    expect(rangesOf(seq.videoTracks[0])[0]).toEqual([0, 5]);
  });

  it("spot workflows report completed placements when a later source is invalid", async () => {
    const spots = getSpotWorkflowTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "spot-partial-730",
    });
    const preview = await spots.preview_motion_graphics_demo.handler({
      sequence_id: "sequence-1", asset_item_ids: ["src", "bad"], clip_duration_seconds: 5, transition_name: "none",
    });
    const script = await scriptFor(spots.apply_spot_workflow_plan, {
      plan: preview.data.plan, confirmation_token: spotWorkflowConfirmationToken(preview.data.plan),
    });
    const { sandbox, source } = issue562Host({ sequenceID: "sequence-1", emptyTargets: true, sourceDurationSeconds: 10 });
    const bad = { nodeId: "bad", name: "bad", getInPoint: () => ({ ticks: ticksOf(0) }), getOutPoint: () => ({ ticks: ticksOf(0) }) };
    (sandbox.app as { project: { rootItem: unknown } }).project.rootItem = { children: { numItems: 2, 0: source, 1: bad } };
    const result = runScript(script, sandbox);
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, outcome: "committed_unverified", verified: false } });
    expect(result.data.completedPlacements).toHaveLength(1);
    expect(result.error).toContain("Earlier placements remain");
  });
});

describe("insert of an item with only audio or only video keeps the target pair in sync", () => {
  it("ripples the sync-locked video target when inserting audio-only media (live Premiere 25.2 desync)", () => {
    const { sandbox, seq, source } = issue562Host({ mediaKind: "audio_only" });
    const result = runHelper(sandbox, seq, source, 8);
    expect(result.ok).toBe(true);
    const s = seq as unknown as { videoTracks: Record<number, ReturnType<typeof makeTrack>>; audioTracks: Record<number, ReturnType<typeof makeTrack>> };
    // No clip was added to V1, but V1 moved with A1, so each picture keeps its sound.
    expect(rangesOf(s.videoTracks[0])).toEqual([[0, 4], [4, 8], [10, 14], [14, 20]]);
    expect(rangesOf(s.audioTracks[0])).toEqual([[0, 4], [4, 8], [8, 10], [10, 14], [14, 20]]);
    expect(rangesOf(s.videoTracks[1])).toEqual([[6, 8], [10, 12]]);
  });

  it("leaves a video target alone when it is not sync-locked", () => {
    const { sandbox, seq, source } = issue562Host({ mediaKind: "audio_only", unlockedVideo: [0] });
    const result = runHelper(sandbox, seq, source, 8);
    expect(result.ok).toBe(true);
    const s = seq as unknown as { videoTracks: Record<number, ReturnType<typeof makeTrack>> };
    expect(rangesOf(s.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 12], [12, 18]]);
  });

  it("ripples the sync-locked audio target when inserting video-only media such as a still", () => {
    const { sandbox, seq, source } = issue562Host({ mediaKind: "video_only" });
    const result = runHelper(sandbox, seq, source, 8);
    expect(result.ok).toBe(true);
    const s = seq as unknown as { videoTracks: Record<number, ReturnType<typeof makeTrack>>; audioTracks: Record<number, ReturnType<typeof makeTrack>> };
    expect(rangesOf(s.videoTracks[0])).toEqual([[0, 4], [4, 8], [8, 10], [10, 14], [14, 20]]);
    expect(rangesOf(s.audioTracks[0])).toEqual([[0, 4], [4, 8], [10, 14], [14, 20]]);
  });
});
