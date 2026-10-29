import { describe, expect, it, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { planRangeClip, rippleRemoveRangesScript, getRippleRemoveRangesTools, TimelineRange } from "../../src/tools/ripple-remove-ranges.js";
import { resolveQeBatchSize } from "../../src/tools/qe-batch-size.js";
import { BridgeOptions, sendCommand } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), getTempDir: vi.fn(() => "/tmp/test") }));
const bridge: BridgeOptions = { tempDir: "/tmp/ripple-range-tests", timeoutMs: 1500 };
const ranges: TimelineRange[] = Array.from({ length: 50 }, (_, i) => ({ start: i * 20, end: i * 20 + 2 }));
const TICKS = 254016000000;

function fakeTimecode(frame: number, timebase: number, displayFormat: number) {
  const nominal = Math.round(TICKS / timebase);
  let displayFrame = frame;
  const dropFrames = displayFormat === 102 ? 2 : displayFormat === 104 ? 4 : 0;
  if (dropFrames) {
    const framesPerTenMinutes = nominal * 600 - dropFrames * 9;
    const framesPerMinute = nominal * 60 - dropFrames;
    const tenMinuteBlocks = Math.floor(frame / framesPerTenMinutes);
    const remainder = frame % framesPerTenMinutes;
    displayFrame += dropFrames * 9 * tenMinuteBlocks;
    if (remainder >= dropFrames) displayFrame += dropFrames * Math.floor((remainder - dropFrames) / framesPerMinute);
  }
  const ff = displayFrame % nominal;
  const totalSeconds = Math.floor(displayFrame / nominal);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  const separator = dropFrames ? ";" : ":";
  return [hh, mm, ss, ff].map(pad).join(separator);
}

function fakeTimeline(options: { clips: Array<{ id: string; start: number; end: number }>; locked?: boolean; frameRate?: number; displayFormat?: number; razorOffsetFrames?: number; otherActive?: boolean; razorFails?: boolean }) {
  let nextId = 0;
  let undoIndex = 0;
  const moveCalls = new Map<string, number>();
  const razorCalls: string[] = [];
  const original = new Map(options.clips.map((clip) => [clip.id, { ...clip }]));
  const toTicks = (seconds: number) => String(Math.round(seconds * TICKS));
  const fromTicks = (time: { ticks: string }) => Number(time.ticks) / TICKS;
  const frameDuration = TICKS / (options.frameRate ?? 25);
  const makeClip = (id: string, start: number, end: number) => ({
    nodeId: id, name: id, start: { ticks: toTicks(start) }, end: { ticks: toTicks(end) },
    move(delta: { ticks: string }) {
      moveCalls.set(id, (moveCalls.get(id) ?? 0) + 1);
      const amount = Number(delta.ticks);
      this.start.ticks = String(Number(this.start.ticks) + amount);
      this.end.ticks = String(Number(this.end.ticks) + amount);
      undoIndex++;
    },
    remove() {
      const index = list.findIndex((clip) => clip.nodeId === id);
      if (index >= 0) list.splice(index, 1);
      undoIndex++;
    },
  });
  const list: ReturnType<typeof makeClip>[] = [];
  for (const clip of options.clips) list.push(makeClip(clip.id, clip.start, clip.end));
  Object.defineProperty(list, "numItems", { get: () => list.length });
  let clipReads = 0;
  const clipsDom = new Proxy(list, { get(target, property, receiver) {
    if (typeof property === "string" && /^\d+$/.test(property)) clipReads++;
    return Reflect.get(target, property, receiver);
  } });
  const track = { transitions: { numItems: 0 }, clips: clipsDom, isLocked: () => options.locked === true };
  const qeTrack = {
    isLocked: () => options.locked === true,
    isSyncLocked: () => true,
    razor(timecode: string) {
      if (options.razorFails) throw new Error("razor failed");
      razorCalls.push(timecode);
      const [hh, mm, ss, ff] = timecode.split(/[:;]/).map(Number);
      const nominal = Math.round(TICKS / frameDuration);
      const displayFrames = (((hh * 60 + mm) * 60 + ss) * nominal + ff);
      const dropFrames = options.displayFormat === 102 ? 2 : options.displayFormat === 104 ? 4 : 0;
      const totalMinutes = hh * 60 + mm;
      const dropped = dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
      const cut = (displayFrames - dropped + (options.razorOffsetFrames ?? 0)) * frameDuration;
      for (let i = 0; i < list.length; i++) {
        const clip = list[i];
        const start = Number(clip.start.ticks), end = Number(clip.end.ticks);
        if (start < cut && end > cut) {
          const seconds = cut / TICKS;
          const left = makeClip(`${clip.nodeId}-razor-${++nextId}`, start / TICKS, seconds);
          const right = makeClip(`${clip.nodeId}-razor-${++nextId}`, seconds, end / TICKS);
          list.splice(i, 1, left, right);
          undoIndex++;
          i++;
        }
      }
    },
  };
  const sequence = {
    sequenceID: "fake-sequence",
    timebase: String(frameDuration),
    getSettings: () => ({ videoDisplayFormat: options.displayFormat ?? 100 }),
    videoTracks: Object.assign({ numTracks: 1 }, [track]),
    audioTracks: { numTracks: 0 },
  };
  const qeSequence = { getVideoTrackAt: () => qeTrack, getAudioTrackAt: () => qeTrack, getUndoStackIndex: () => undoIndex };
  const otherSequence = { sequenceID: "other-sequence", name: "Other" };
  const context = { $: { global: {} }, app: { project: { activeSequence: options.otherActive ? otherSequence : sequence, sequences: { numSequences: 1, 0: Object.assign(sequence, { name: "Target" }) } }, enableQE() {} }, qe: { project: { getActiveSequence: () => qeSequence, undoStackIndex: () => undoIndex } }, Time: class { ticks = "0"; getFormatted(frameRate: { ticks: string }, displayFormat: number) { return fakeTimecode(Math.floor(Number(this.ticks) / Number(frameRate.ticks) + 0.000001), Number(frameRate.ticks), displayFormat); } } };
  const run = (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))) as { success: boolean; data?: Record<string, any>; error?: string };
  return { run, moveCalls, list, original, fromTicks, razorCalls, get clipReads() { return clipReads; } };
}

type LinkedFakeClip = { nodeId: string; name: string; start: { ticks: string }; end: { ticks: string }; group: { members: LinkedFakeClip[] } | null; selected: boolean; [key: string]: any };

// One video and one audio track whose clips share link groups. Like Premiere 26.5.2,
// a razor keeps the left piece in the original link group and leaves the right piece unlinked.
function linkedFakeTimeline(options: { pairs: Array<{ id: string; start: number; end: number }>; linkSelectionWorks?: boolean }) {
  let nextId = 0;
  let undoIndex = 0;
  const frameDuration = TICKS / 25;
  const toTicks = (seconds: number) => String(Math.round(seconds * TICKS));
  const lists: Record<"video" | "audio", LinkedFakeClip[]> = { video: [], audio: [] };
  const live = () => [...lists.video, ...lists.audio];
  const makeClip = (type: "video" | "audio", id: string, start: number, end: number): LinkedFakeClip => ({
    nodeId: id, name: id, start: { ticks: toTicks(start) }, end: { ticks: toTicks(end) }, group: null, selected: false,
    getLinkedItems() {
      if (!this.group) return null;
      const members = this.group.members.filter((clip: LinkedFakeClip) => live().includes(clip));
      return Object.assign([...members], { numItems: members.length });
    },
    setSelected(value: boolean) { this.selected = value; },
    move(delta: { ticks: string }) {
      this.start.ticks = String(Number(this.start.ticks) + Number(delta.ticks));
      this.end.ticks = String(Number(this.end.ticks) + Number(delta.ticks));
      undoIndex++;
    },
    remove() {
      const index = lists[type].indexOf(this as LinkedFakeClip);
      if (index >= 0) lists[type].splice(index, 1);
      undoIndex++;
    },
  });
  for (const pair of options.pairs) {
    const video = makeClip("video", `${pair.id}-v`, pair.start, pair.end);
    const audio = makeClip("audio", `${pair.id}-a`, pair.start, pair.end);
    video.group = audio.group = { members: [video, audio] };
    lists.video.push(video);
    lists.audio.push(audio);
  }
  const domTrack = (type: "video" | "audio") => {
    const clips = new Proxy(lists[type], { get(target, property, receiver) {
      if (property === "numItems") return target.length;
      return Reflect.get(target, property, receiver);
    } });
    return { clips, transitions: { numItems: 0 }, isLocked: () => false };
  };
  const qeTrack = (type: "video" | "audio") => ({
    isLocked: () => false,
    isSyncLocked: () => true,
    razor(timecode: string) {
      const [hh, mm, ss, ff] = timecode.split(":").map(Number);
      const cut = ((((hh * 60 + mm) * 60 + ss) * 25) + ff) * frameDuration;
      const list = lists[type];
      for (let i = 0; i < list.length; i++) {
        const clip = list[i];
        const start = Number(clip.start.ticks), end = Number(clip.end.ticks);
        if (start < cut && end > cut) {
          const left = makeClip(type, `${clip.nodeId}-razor-${++nextId}`, start / TICKS, cut / TICKS);
          const right = makeClip(type, `${clip.nodeId}-razor-${++nextId}`, cut / TICKS, end / TICKS);
          if (clip.group) { left.group = clip.group; clip.group.members = clip.group.members.map((member) => member === clip ? left : member); }
          list.splice(i, 1, left, right);
          undoIndex++;
          i++;
        }
      }
    },
  });
  const sequence = {
    sequenceID: "fake-sequence",
    name: "Target",
    timebase: String(frameDuration),
    getSettings: () => ({ videoDisplayFormat: 100 }),
    videoTracks: Object.assign({ numTracks: 1 }, [domTrack("video")]),
    audioTracks: Object.assign({ numTracks: 1 }, [domTrack("audio")]),
    linkSelection() {
      if (options.linkSelectionWorks === false) return;
      const selected = live().filter((clip) => clip.selected);
      const group = { members: selected };
      for (const clip of selected) clip.group = group;
      undoIndex++;
    },
  };
  const videoQe = qeTrack("video"), audioQe = qeTrack("audio");
  const qeSequence = { getVideoTrackAt: () => videoQe, getAudioTrackAt: () => audioQe, getUndoStackIndex: () => undoIndex };
  const context = { $: { global: {} }, app: { project: { activeSequence: sequence, sequences: { numSequences: 1, 0: sequence } }, enableQE() {} }, qe: { project: { getActiveSequence: () => qeSequence, undoStackIndex: () => undoIndex } }, Time: class { ticks = "0"; getFormatted(frameRate: { ticks: string }, displayFormat: number) { return fakeTimecode(Math.floor(Number(this.ticks) / Number(frameRate.ticks) + 0.000001), Number(frameRate.ticks), displayFormat); } } };
  const run = (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))) as { success: boolean; data?: Record<string, any>; error?: string };
  const span = (clip: LinkedFakeClip) => `${Number(clip.start.ticks) / TICKS}-${Number(clip.end.ticks) / TICKS}`;
  const partners = (clip: LinkedFakeClip) => {
    const linked = clip.getLinkedItems();
    return linked ? Array.from(linked as LinkedFakeClip[], span).sort() : null;
  };
  return { run, lists, live, span, partners };
}

// Match the Node handler: every fake evalScript drives one bounded razor batch.
function runBatchedRipple(host: { run(script: string): { success: boolean; data?: Record<string, any>; error?: string } }, args: Parameters<typeof rippleRemoveRangesScript>[0], fingerprint: string, afterCommand?: () => void) {
  const operationId = "fake-ripple-operation";
  let undoSteps = 0;
  for (let batch = 0; batch < 1000; batch++) {
    const result = host.run(rippleRemoveRangesScript(args, true, batch === 0 ? fingerprint : "", "razor", operationId));
    afterCommand?.();
    undoSteps += result.data?.undoSteps ?? 0;
    if (!result.success) return result;
    if (result.data?.complete) {
      const finish = host.run(rippleRemoveRangesScript(args, true, "", "finish", operationId));
      afterCommand?.();
      if (finish.data) finish.data.undoSteps = undoSteps + (finish.data.undoSteps ?? 0);
      return finish;
    }
  }
  throw new Error("Fake-host razor batching did not complete");
}

describe("ripple_remove_timeline_ranges", () => {
  beforeEach(() => vi.mocked(sendCommand).mockReset());

  it("plans 1,500 clips across 50 removals with at most one move per survivor", () => {
    const clips = Array.from({ length: 1500 }, (_, i) => ({ nodeId: `c${i}`, start: i, end: i + 0.5 }));
    const moveCalls = new Map<string, number>();
    let removed = 0;
    for (const clip of clips) {
      const item = planRangeClip(clip, ranges, 0.001);
      if (item.removed) removed++;
      else if (item.shift > 0) moveCalls.set(item.nodeId, (moveCalls.get(item.nodeId) ?? 0) + 1);
    }
    const reference = (start: number) => ranges.filter((r) => r.end <= start).reduce((sum, r) => sum + r.end - r.start, 0);
    for (const clip of clips) {
      const actual = planRangeClip(clip, ranges, 0.001);
      expect(actual.shift).toBe(reference(clip.start));
      expect(actual.removed).toBe(ranges.some((r) => clip.start >= r.start - 0.001 && clip.end <= r.end + 0.001));
    }
    expect(removed).toBeGreaterThan(0);
    expect(Math.max(...moveCalls.values())).toBe(1);
  });

  it("does not reapply the large-ripple guard after a saved razor batch starts", () => {
    const host = fakeTimeline({ clips: Array.from({ length: 401 }, (_, i) => ({ id: `clip-${i}`, start: 0, end: 100 })) });
    const ranges = Array.from({ length: 10 }, (_, i) => ({ start: 2 + i * 4, end: 3 + i * 4 }));
    const allowed = { ranges, scope: "sync_locked" as const, range_content: "delete" as const, allow_large_ripple: true };
    const preview = host.run(rippleRemoveRangesScript(allowed, false));
    const operationId = "large-ripple-regression";
    const first = host.run(rippleRemoveRangesScript(allowed, true, String(preview.data?.timelineFingerprint), "razor", operationId, 1));
    expect(first).toMatchObject({ success: true, data: { complete: false } });
    // This mimics a later handler batch: state exists and razors already changed
    // clip topology. Before KAV-312's fix, this was refused as not_applied.
    const resumed = host.run(rippleRemoveRangesScript({ ...allowed, allow_large_ripple: false }, true, String(preview.data?.timelineFingerprint), "razor", operationId, 1));
    expect(resumed).toMatchObject({ success: true, data: { complete: false } });
  });

  it("clears saved razor state when a razor batch fails", () => {
    const host = fakeTimeline({ clips: [{ id: "clip", start: 0, end: 4 }], razorFails: true });
    const args = { ranges: [{ start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    const operationId = "failed-razor";
    expect(host.run(rippleRemoveRangesScript(args, true, String(preview.data?.timelineFingerprint), "razor", operationId, 1))).toMatchObject({ success: false, data: { mutationAttempted: true } });
    expect(host.run(rippleRemoveRangesScript(args, true, "", "finish", operationId))).toMatchObject({ success: false, error: expect.stringContaining("recovery state is unavailable") });
  });

  it("resolves QE batch sizes from the environment with safe bounds", () => {
    expect(resolveQeBatchSize(undefined, { PREMIERE_MCP_QE_BATCH_SIZE: "4" })).toBe(4);
    expect(resolveQeBatchSize(undefined, { PREMIERE_MCP_QE_BATCH_SIZE: "500" })).toBe(32);
    expect(resolveQeBatchSize(undefined, { PREMIERE_MCP_QE_BATCH_SIZE: "0" })).toBe(1);
    expect(resolveQeBatchSize(16, { PREMIERE_MCP_QE_BATCH_SIZE: "4" })).toBe(16);
  });

  it("runs the generated script against 1,500 fake clips and 50 ranges, moving each survivor once to reference positions", () => {
    const host = fakeTimeline({ clips: Array.from({ length: 1500 }, (_, i) => ({ id: `clip-${i}`, start: i, end: i + 1 })) });
    const args = { ranges, scope: "sync_locked" as const, range_content: "delete" as const, allow_large_ripple: true };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    expect(preview.success).toBe(true);
    const fingerprint = String(preview.data?.timelineFingerprint);
    const applied = runBatchedRipple(host, args, fingerprint);
    expect(applied.success).toBe(true);
    expect(applied.data?.verified).toBe(true);
    expect(Math.max(...host.moveCalls.values())).toBe(1);
    for (const [id, original] of host.original) {
      const removed = ranges.some((range) => original.start >= range.start && original.end <= range.end);
      const actual = host.list.find((clip) => clip.nodeId === id);
      if (removed) expect(actual).toBeUndefined();
      else {
        const removedBefore = ranges.filter((range) => range.end <= original.start).reduce((sum, range) => sum + range.end - range.start, 0);
        expect(actual).toBeDefined();
        expect(host.fromTicks(actual!.start)).toBeCloseTo(original.start - removedBefore, 5);
        expect(host.fromTicks(actual!.end)).toBeCloseTo(original.end - removedBefore, 5);
      }
    }
    expect(applied.data?.estimatedSeconds).toBe(Math.ceil((applied.data!.clipsShifted * 0.15) + (applied.data!.clipsRemoved + 1) * 0.5));
  });

  it("precomputes razor spans with bounded DOM clip reads for 1,500 clips and 50 ranges", () => {
    const host = fakeTimeline({ clips: Array.from({ length: 1500 }, (_, i) => ({ id: `clip-${i}`, start: i, end: i + 1 })) });
    const testRanges = Array.from({ length: 50 }, (_, i) => ({ start: i * 20 + 0.5, end: i * 20 + 2.5 }));
    const args = { ranges: testRanges, scope: "sync_locked" as const, range_content: "delete" as const, allow_large_ripple: true };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    expect(preview.success).toBe(true);
    let previousReads = host.clipReads;
    const readsPerCommand: number[] = [];
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint), () => {
      readsPerCommand.push(host.clipReads - previousReads);
      previousReads = host.clipReads;
    });
    expect(applied.success).toBe(true);
    expect(readsPerCommand).toHaveLength(14);
    // Every saved razor batch fingerprints its current timeline before resuming.
    expect(Math.max(...readsPerCommand)).toBeLessThanOrEqual(6500);
  });

  it.each([
    { frameRate: 23.976, displayFormat: 110 },
    { frameRate: 29.97, displayFormat: 102 },
  ])("cuts and verifies fractional frame-rate ranges with Premiere timecode (%s)", ({ frameRate, displayFormat }) => {
    const host = fakeTimeline({ clips: [{ id: "clip", start: 0, end: 100 }], frameRate, displayFormat });
    const rangeStart = frameRate === 29.97 ? 60.06 : 1;
    const rangeEnd = frameRate === 29.97 ? 61.061061061 : 2;
    const args = { ranges: [{ start: rangeStart, end: rangeEnd }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    expect(preview.success).toBe(true);
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(true);
    expect(applied.data?.verified).toBe(true);
    expect(host.list).toHaveLength(2);
    const survivingSeconds = host.list.reduce((sum, clip) => sum + host.fromTicks(clip.end) - host.fromTicks(clip.start), 0);
    expect(survivingSeconds).toBeCloseTo(100 - (frameRate === 29.97 ? 30 / frameRate : 1), 2);
    expect(host.razorCalls[0]).toBe(frameRate === 29.97 ? "00;01;00;02" : "00:00:01:00");
  });

  it("refuses a razor boundary more than half a frame from the snapped cut before removing or moving", () => {
    const host = fakeTimeline({ clips: [{ id: "clip", start: 0, end: 4 }], frameRate: 29.97, displayFormat: 102, razorOffsetFrames: 1 });
    const args = { ranges: [{ start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(false);
    expect(applied.error).toContain("still straddles a snapped range edge");
    expect(applied.data?.mutationOutcome).toBe("unknown");
    expect(host.list.length).toBeGreaterThan(1);
    expect(host.moveCalls.size).toBe(0);
  });

  it("does not report frame-exact decimal ranges as adjustments", () => {
    const host = fakeTimeline({ clips: [{ id: "clip", start: 0, end: 3 }] });
    const result = host.run(rippleRemoveRangesScript({ ranges: [{ start: 1.08, end: 2.16 }], scope: "sync_locked", range_content: "delete" }, false));
    expect(result.success).toBe(true);
    expect(result.data?.adjustments).toEqual([]);
  });

  it("bounds preview samples, reports per-track counts, and returns undo steps from shared undo tracking", () => {
    const host = fakeTimeline({ clips: Array.from({ length: 100 }, (_, i) => ({ id: `clip-${i}`, start: i, end: i + 1 })) });
    const args = { ranges: [{ start: 10, end: 11 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    expect(preview.data?.plannedClips).toHaveLength(50);
    expect(preview.data?.plannedClipsTruncated).toBe(true);
    expect(preview.data?.plannedClipsTotal).toBeGreaterThan(50);
    expect(preview.data?.trackCounts).toHaveProperty("video:0");
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(true);
    expect(applied.data?.undoSteps).toBeGreaterThan(0);
    expect(applied.data?.undoStackIndex).toBe(applied.data?.undoSteps);
  });

  it("handles sequence start, adjacent intervals, and a clip fully inside a range", () => {
    const adjacent = [{ start: 0, end: 1 }, { start: 1, end: 2 }];
    expect(planRangeClip({ nodeId: "whole", start: 0, end: 2 }, adjacent, 0.001)).toMatchObject({ removed: true, shift: 0 });
    expect(planRangeClip({ nodeId: "after", start: 2, end: 3 }, adjacent, 0.001)).toMatchObject({ removed: false, shift: 2 });
  });

  it("executes adjacent ranges at sequence start and deletes the full clip in the fake host", () => {
    const host = fakeTimeline({ clips: [{ id: "whole", start: 0, end: 2 }, { id: "after", start: 2, end: 3 }] });
    const args = { ranges: [{ start: 0, end: 1 }, { start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(true);
    expect(host.list.map((clip) => clip.nodeId)).toEqual(["after"]);
    expect(host.fromTicks(host.list[0].start)).toBeCloseTo(0, 5);
    expect(host.moveCalls.get("after")).toBe(1);
  });

  it("refuses a locked participating track before razor, removal, or move", () => {
    const host = fakeTimeline({ clips: [{ id: "before", start: 0, end: 1 }, { id: "inside", start: 1, end: 2 }, { id: "after", start: 2, end: 3 }], locked: true });
    const result = host.run(rippleRemoveRangesScript({ ranges: [{ start: 1, end: 2 }], scope: "sync_locked", range_content: "delete" }, false));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be readable, unlocked, and sync-locked/);
    expect(host.list).toHaveLength(3);
    expect(host.moveCalls.size).toBe(0);
  });

  it("refuses a sequence_id that is not the active sequence before any QE read or edit", () => {
    // Live 26.5.2: with another sequence active, QE read that sequence's sync lock and razored it,
    // while the requested sequence stayed unchanged (mutationOutcome unknown).
    const host = fakeTimeline({ clips: [{ id: "before", start: 0, end: 1 }, { id: "inside", start: 1, end: 2 }, { id: "after", start: 2, end: 3 }], otherActive: true });
    const args = { sequence_id: "fake-sequence", ranges: [{ start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const };
    for (const mutate of [false, true]) {
      const result = host.run(rippleRemoveRangesScript(args, mutate, "any"));
      expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
      expect(result.error).toMatch(/only reaches the active sequence.*Target/);
    }
    expect(host.razorCalls).toHaveLength(0);
    expect(host.list).toHaveLength(3);
    expect(host.moveCalls.size).toBe(0);
    const active = fakeTimeline({ clips: [{ id: "before", start: 0, end: 1 }, { id: "inside", start: 1, end: 2 }, { id: "after", start: 2, end: 3 }] });
    expect(active.run(rippleRemoveRangesScript(args, false)).success).toBe(true);
  });

  it("relinks moved audio/video pieces that the per-track razors left unlinked", () => {
    // Live 26.5.2: after removing 2-3 s from a linked 0-8 s clip, the moved 3-8 s pieces
    // came back with getLinkedItems() null on both tracks.
    const host = linkedFakeTimeline({ pairs: [{ id: "clip", start: 0, end: 8 }] });
    const args = { ranges: [{ start: 2, end: 3 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    expect(preview.success).toBe(true);
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(true);
    expect(applied.data?.verified).toBe(true);
    expect(applied.data?.relinkedGroups).toBe(1);
    for (const type of ["video", "audio"] as const) {
      expect(host.lists[type].map(host.span)).toEqual(["0-2", "2-7"]);
      for (const clip of host.lists[type]) expect(host.partners(clip)).toEqual([host.span(clip), host.span(clip)]);
    }
    expect(host.live().some((clip) => clip.selected)).toBe(false);
  });

  it("reports committed_unverified when moved pieces do not read back relinked", () => {
    const host = linkedFakeTimeline({ pairs: [{ id: "clip", start: 0, end: 8 }], linkSelectionWorks: false });
    const args = { ranges: [{ start: 2, end: 3 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = host.run(rippleRemoveRangesScript(args, false));
    const applied = runBatchedRipple(host, args, String(preview.data?.timelineFingerprint));
    expect(applied.success).toBe(false);
    expect(applied.error).toMatch(/could not be relinked/);
    expect(applied.data).toMatchObject({ outcome: "committed_unverified", timelineChanged: true, relinkedGroups: 0 });
    expect(host.lists.video.map(host.span)).toEqual(["0-2", "2-7"]);
  });

  it("refuses partial clip overlap in the shared planner", () => {
    expect(() => planRangeClip({ nodeId: "straddler", start: 0.5, end: 2.5 }, [{ start: 1, end: 2 }], 0.001)).toThrow(/partially overlaps/);
  });

  it("emits edit-authority script with lock checks, frame snapping, fingerprint revalidation, and one move call", () => {
    const script = rippleRemoveRangesScript({ ranges: [{ start: 1, end: 2 }], scope: "sync_locked", range_content: "delete", allow_large_ripple: false }, true, "123");
    expect(script).toContain("isSyncLocked");
    expect(script).toContain("isLocked");
    expect(script).toContain("Timeline changed since preview");
    expect(script).toContain("clip.move(delta)");
    expect(script).toContain("summary.plannedClips.push");
    expect(script).toContain("Large ripple refused before mutation");
  });

  it("requires a preview token and rejects overlapping/unsorted ranges before dispatch", async () => {
    const tool = getRippleRemoveRangesTools(bridge).ripple_remove_timeline_ranges;
    const invalid = await tool.handler({ ranges: [{ start: 2, end: 3 }, { start: 1, end: 2.5 }], scope: "sync_locked", range_content: "delete" });
    expect(invalid.success).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();
    const denied = await tool.handler({ ranges: [{ start: 1, end: 2 }], scope: "sync_locked", range_content: "delete", dry_run: false });
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/confirmation_token/);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("returns a full dry-run plan and applies bounded razor batches with a scaled timeout", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { timelineFingerprint: "fingerprint", plannedClips: [{ nodeId: "clip" }], clipsShifted: 1500 } });
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { timelineFingerprint: "fingerprint", clipsShifted: 1500 } });
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { complete: true, undoSteps: 8 } });
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { verified: true, undoSteps: 2 } });
    const tool = getRippleRemoveRangesTools(bridge).ripple_remove_timeline_ranges;
    const args = { ranges: [{ start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const, allow_large_ripple: true };
    const preview = await tool.handler(args);
    const token = (preview.data as { confirmationToken: string }).confirmationToken;
    expect((preview.data as { plannedClips: unknown[] }).plannedClips).toHaveLength(1);
    const applied = await tool.handler({ ...args, dry_run: false, confirmation_token: token, allow_large_ripple: true });
    expect(applied.success).toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(4);
    expect(vi.mocked(sendCommand).mock.calls[2][0]).toContain('razorCalls >= 8');
    expect(vi.mocked(sendCommand).mock.calls[3][0]).toContain('"finish"');
    expect(vi.mocked(sendCommand).mock.calls[2][1]).toMatchObject({ timeoutMs: 630000, mutationOnTimeout: true });
    expect(applied.data).toMatchObject({ undoSteps: 10 });
    await expect(tool.handler({ ...args, dry_run: false, confirmation_token: token, allow_large_ripple: true })).resolves.toMatchObject({ success: false });
  });

  it("drives 41 razors through bounded batches and preserves prior undo accounting on failure", async () => {
    vi.mocked(sendCommand)
      .mockResolvedValueOnce({ success: true, data: { timelineFingerprint: "fingerprint", clipsShifted: 0 } })
      .mockResolvedValueOnce({ success: true, data: { timelineFingerprint: "fingerprint", clipsShifted: 0 } });
    for (let i = 0; i < 5; i++) vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { complete: false, undoSteps: 8 } });
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: false, error: "Stack overrun", data: { undoSteps: 1 } });
    const tool = getRippleRemoveRangesTools(bridge).ripple_remove_timeline_ranges;
    const args = { ranges: [{ start: 1, end: 2 }], scope: "sync_locked" as const, range_content: "delete" as const };
    const preview = await tool.handler(args);
    const result = await tool.handler({ ...args, dry_run: false, confirmation_token: (preview.data as { confirmationToken: string }).confirmationToken });
    expect(result).toMatchObject({ success: false, error: "Stack overrun", data: { undoSteps: 41, timelineChanged: true } });
    expect(sendCommand).toHaveBeenCalledTimes(8);
  });
});
