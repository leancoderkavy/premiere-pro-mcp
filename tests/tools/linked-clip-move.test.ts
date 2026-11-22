import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotRevision, type TimelineSnapshot } from "../../src/ai/timeline-contract.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithExpectedHostTarget } from "../../src/bridge/project-guard.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExtendedEditPlanTools } from "../../src/tools/extended-edit-plans.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));

const T = 254016000000;
const time = (ticks: number) => ({ ticks: String(ticks) });
const collection = <T>(items: T[]) =>
  Object.defineProperty(items, "numItems", { get: () => items.length });

function clip(nodeId: string, initialStart: number, initialEnd: number) {
  let start = initialStart, end = initialEnd;
  const writes: string[] = [];
  return {
    nodeId, name: nodeId, projectItem: { nodeId: "media" },
    inPoint: time(T), outPoint: time(3 * T), writes,
    getLinkedItems: (): unknown => null,
    onWrite: (_field: "start" | "end", tick: number) => tick,
    get start() { return time(start); },
    set start(value: unknown) { writes.push("start"); start = this.onWrite("start", Number(value)); },
    get end() { return time(end); },
    set end(value: unknown) { writes.push("end"); end = this.onWrite("end", Number(value)); },
    hostShift(delta: number) { start += delta; end += delta; },
  };
}

function host() {
  const video = clip("v", 2 * T, 4 * T), audio = clip("a", 2 * T - 123, 4 * T - 456);
  video.getLinkedItems = () => collection([video, audio]);
  audio.getLinkedItems = () => collection([video, audio]);
  const track = (item: typeof video) => ({
    clips: collection([item]), isLocked: () => false,
    transitions: collection<{ start: ReturnType<typeof time>; end: ReturnType<typeof time> }>([]),
  });
  const v = track(video), a = track(audio);
  const sequence = { sequenceID: "seq", timebase: String(T / 25), videoTracks: { 0: v, numTracks: 1 }, audioTracks: { 0: a, numTracks: 1 } };
  const app = { project: { documentID: "project", activeSequence: sequence, path: "C:/project.prproj" }, enableQE: vi.fn() };
  const qe = { project: { getActiveSequence: vi.fn(), undoStackIndex: (): number | null => 4 } };
  const run = async (script: string) => {
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(runInNewContext(getHelpersSource() + script, { app, qe, $: { os: "Windows" },
      File: function(this: { fsName: string }, path: string) { this.fsName = path; },
    }));
  };
  vi.mocked(sendCommand).mockImplementation(run);
  return { video, audio, v, a, app, qe, run };
}

const move = (options: { new_track_index?: number; include_linked?: boolean; node_id?: string } = {}) =>
  getTimelineTools({}).move_clip.handler({ node_id: "v", new_start_seconds: 8, ...options });
const range = (item: ReturnType<typeof clip>) => [item.start.ticks, item.end.ticks, item.inPoint.ticks, item.outPoint.ticks];

beforeEach(() => vi.clearAllMocks());

describe("move_clip linked readback", () => {
  it("applies one tick delta to both ranges and declares the linked receipt boundary", async () => {
    const { video, audio } = host();
    const result = await move();
    expect(range(video)).toEqual([String(8 * T), String(10 * T), String(T), String(3 * T)]);
    expect(range(audio)).toEqual([String(8 * T - 123), String(10 * T - 456), String(T), String(3 * T)]);
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", affectedTargets: [{ nodeId: "v" }, { nodeId: "a" }] } });
    expect(mutationReceipt(result.success, "data" in result ? result.data : undefined, { dispatched: true }, "move_clip")).toMatchObject({
      outcome: "verified", verification: { boundary: expect.stringContaining("linked"), renderVerified: false },
    });
  });

  it("preserves the audio anchor's fractional frame offset when moving from audio", async () => {
    const { video, audio } = host();
    expect(await move({ node_id: "a" })).toMatchObject({ success: true });
    expect(audio.start.ticks).toBe(String(8 * T - 123));
    expect(video.start.ticks).toBe(String(8 * T));
  });

  it("does not write a partner Premiere already moved to the exact destination", async () => {
    const { video, audio } = host();
    video.onWrite = (field, tick) => { if (field === "start") audio.hostShift(6 * T); return tick; };
    expect(await move()).toMatchObject({ success: true, data: { verified: true } });
    expect(audio.writes).toEqual([]);
    expect(audio.start.ticks).toBe(String(8 * T - 123));
  });

  it("vacates a same-track partner before moving into its old range", async () => {
    const { video, audio, a, v } = host();
    a.clips.splice(0, 1);
    const partner = clip("a", 8 * T, 10 * T);
    v.clips.push(partner);
    video.getLinkedItems = () => collection([video, partner]);
    partner.getLinkedItems = () => collection([video, partner]);
    video.onWrite = (field, tick) => {
      if (field === "start" && tick === Number(partner.start.ticks)) throw new Error("destination still occupied");
      return tick;
    };
    expect(await move()).toMatchObject({ success: true, data: { verified: true } });
    expect(video.start.ticks).toBe(String(8 * T));
    expect(partner.start.ticks).toBe(String(14 * T));
    expect(audio.writes).toHaveLength(0);
  });

  it.each(["source transition", "destination transition", "occupied destination", "locked partner", "negative destination", "asymmetric linkage", "unknown linkage", "duplicate identity", "linked track request"])(
    "refuses a %s before any move", async scenario => {
      const { video, audio, a, app } = host();
      if (scenario === "source transition") a.transitions.push({ start: time(2 * T - 1000), end: time(2 * T) });
      if (scenario === "destination transition") a.transitions.push({ start: time(8 * T - 1000), end: time(8 * T) });
      if (scenario === "occupied destination") a.clips.push(clip("neighbor", 9 * T, 11 * T));
      if (scenario === "locked partner") a.isLocked = () => true;
      if (scenario === "negative destination") audio.hostShift(-10 * T);
      if (scenario === "asymmetric linkage") audio.getLinkedItems = () => null;
      if (scenario === "unknown linkage") video.getLinkedItems = () => undefined;
      if (scenario === "duplicate identity") a.clips.push(clip("a", 13 * T, 15 * T));
      if (scenario === "linked track request") Object.assign(app.project.activeSequence.videoTracks, { 1: { ...a, clips: collection([]) }, numTracks: 2 });
      const result = await move(scenario === "linked track request" ? { new_track_index: 1 } : {});
      expect(result).toMatchObject({ success: false });
      expect([...video.writes, ...audio.writes]).toEqual([]);
      expect(app.enableQE).not.toHaveBeenCalled();
    },
  );

  it("reads back a rollback after a write is rejected partway", async () => {
    const { video, audio } = host();
    const before = [range(video), range(audio)];
    audio.onWrite = (field, tick) => {
      if (field === "start" && tick > 4 * T) throw new Error("start rejected");
      return tick;
    };
    expect(await move()).toMatchObject({ success: false, data: { verified: false, rollbackVerified: true } });
    expect([range(video), range(audio)]).toEqual(before);
  });

  it.each([null, 4])("classifies a refused write using the available undo index (%s)", async undoIndex => {
    const { video, qe } = host();
    qe.project.undoStackIndex = () => undoIndex;
    video.onWrite = () => { throw new Error("Host refused move"); };
    const result = await move();
    expect(result).toMatchObject({ success: false, data: {
      outcome: undoIndex === null ? "unknown" : "not_applied",
      timelineChanged: undoIndex === null ? null : false,
      rollbackVerified: false,
    } });
  });

  it("leaves an unexpectedly moved partner alone and reports the partial outcome", async () => {
    const { video, audio } = host();
    video.onWrite = (field, tick) => {
      if (field === "start" && tick === 8 * T) audio.hostShift(5 * T);
      return tick;
    };
    expect(await move()).toMatchObject({ success: false, data: { verified: false, timelineChanged: true, outcome: "committed_unverified", rollbackVerified: false } });
    expect(video.start.ticks).toBe(String(2 * T));
    expect(audio.start.ticks).toBe(String(7 * T - 123));
    expect(audio.writes).toEqual([]);
  });

  it("rechecks an earlier member after the last member writes", async () => {
    const { video, audio } = host();
    audio.onWrite = (field, tick) => { if (field === "start" && tick > 7 * T) video.hostShift(123); return tick; };
    expect(await move()).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified" } });
  });

  it("supports direct explicit false when readback confirms partners stayed put", async () => {
    const { video, audio } = host();
    const oldAudio = range(audio);
    expect(await move({ include_linked: false })).toMatchObject({ success: true, data: { outcome: "verified", verified: true } });
    expect(video.start.ticks).toBe(String(8 * T));
    expect(range(audio)).toEqual(oldAudio);
  });

  it("warns and avoids a verified receipt if a partner changes despite explicit false", async () => {
    const { video, audio } = host();
    video.onWrite = (field, tick) => { if (field === "start") audio.hostShift(6 * T); return tick; };
    expect(await move({ include_linked: false })).toMatchObject({
      data: { verified: false, outcome: "committed_unverified", warning: expect.stringContaining("partner") },
    });
    expect(audio.writes).toEqual([]);
  });

  it("treats a linked clip on the same track as an occupant when opting out", async () => {
    const { video, audio, v, a } = host();
    a.clips.splice(0, 1);
    audio.hostShift(6 * T);
    v.clips.push(audio);
    expect(await move({ include_linked: false })).toMatchObject({ success: false, error: expect.stringContaining("occupies") });
    expect(video.writes).toEqual([]);
  });

  it("does not compensate an ambiguous live identity", async () => {
    const { video, audio, v } = host();
    audio.onWrite = (field, tick) => {
      if (field === "start") {
        v.clips.unshift(clip("v", 8 * T, 10 * T));
        throw new Error("host changed topology");
      }
      return tick;
    };
    expect(await move()).toMatchObject({ success: false, data: { rollbackVerified: false } });
    expect(v.clips[0].writes).toEqual([]);
    expect(video.start.ticks).toBe(String(8 * T));
  });

  it("does not compensate into a range that became occupied", async () => {
    const { video, audio, v } = host();
    audio.onWrite = (field, tick) => {
      if (field === "start" && tick > 4 * T) {
        v.clips.push(clip("other", 2 * T, 4 * T));
        throw new Error("start rejected");
      }
      return tick;
    };
    expect(await move()).toMatchObject({ success: false, data: { rollbackVerified: false, outcome: "committed_unverified" } });
    expect(video.start.ticks).toBe(String(8 * T));
  });

  it("refuses an out-of-range track index before attempting QE", async () => {
    const { video, audio, app } = host();
    video.getLinkedItems = () => null;
    audio.getLinkedItems = () => null;
    expect(await move({ new_track_index: 99 })).toMatchObject({ success: false, error: expect.stringContaining("out of range") });
    expect(video.writes).toEqual([]);
    expect(app.enableQE).not.toHaveBeenCalled();
  });

  it("refuses live linkage within the move command for a previously bound singleton", async () => {
    const { video, audio } = host();
    const result = await runWithExpectedHostTarget({
      backend: "cep", sequence_id: "seq", clip: {
        node_id: "v", track_type: "video", track_index: 0,
      },
    }, () => move({ include_linked: false }), { requireUnlinked: true });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("unlinked") });
    expect([...video.writes, ...audio.writes]).toEqual([]);
  });

  it("verifies a singleton time move when the destination overlaps only itself", async () => {
    const { video, audio } = host();
    video.getLinkedItems = () => null;
    audio.getLinkedItems = () => null;
    expect(await getTimelineTools({}).move_clip.handler({ node_id: "v", new_start_seconds: 3 })).toMatchObject({
      success: true, data: { moved: true, verified: true, outcome: "verified", newStart: 3, newEnd: 5, trackIndex: 0 },
    });
  });

  it.each(["moves", "no-ops", "throws after moving"])("reports the verified unlinked track path when QE %s", async behavior => {
    const { video, audio, v, app, qe } = host();
    video.getLinkedItems = () => null;
    audio.getLinkedItems = () => null;
    const dest = { ...v, clips: collection<typeof video>([]) };
    Object.assign(app.project.activeSequence.videoTracks, { 1: dest, numTracks: 2 });
    const moveToTrack = vi.fn(() => {
      if (behavior === "no-ops") return;
      v.clips.splice(0, 1);
      dest.clips.push(video);
      video.end = String(3 * T);
      if (behavior === "throws after moving") throw new Error("QE error");
    });
    const gap = { type: "Empty", start: video.start };
    const qeClip = { type: "Clip", start: video.start, moveToTrack };
    qe.project.getActiveSequence.mockReturnValue({ getVideoTrackAt: () => ({ numItems: 2, getItemAt: (i: number) => [gap, qeClip][i] }) });
    const result = await move({ new_track_index: 1 });
    expect(moveToTrack).toHaveBeenCalledWith(1, 0, "0", false);
    if (behavior === "moves") {
      expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", newStart: 8, newEnd: 10, trackIndex: 1 } });
      expect(v.clips).toHaveLength(0);
    } else {
      expect(result).toMatchObject({ success: false, data: { verified: false, outcome: behavior === "no-ops" ? "not_applied" : "committed_unverified" } });
      expect(video.start.ticks).toBe(String(2 * T));
    }
  });
});

describe("compound move binding", () => {
  function planHost() {
    const h = host();
    const first = clip("first", 12 * T, 14 * T);
    h.v.clips.push(first);
    const track = { id: "video:0", type: "video" as const, index: 0, locked: false, sync_locked: true, targeted: true, muted: false };
    const snapshot: TimelineSnapshot = {
      schema_version: 1, backend: "cep", project_id: "project", sequence_id: "seq", session_id: "session", revision: "",
      frame_rate: { numerator: 25, denominator: 1 }, display_start_ticks: "0",
      tracks: [track],
      clips: [h.video, first].map(item => ({
        id: item.nodeId, source_id: "media", track_id: track.id, start_ticks: item.start.ticks, end_ticks: item.end.ticks,
        in_ticks: item.inPoint.ticks, out_ticks: item.outPoint.ticks, source_duration_ticks: String(100 * T),
        speed: { numerator: 1, denominator: 1 }, reversed: false, enabled: true, linked_ids: [], identity: "host", effects: [], nested: false,
      })),
      completeness: { clips: true, links: true, locks: true, effects: true, transitions: true, markers: true },
      transitions: [], markers: [], pagination: { offset: 0, total: 2, next_offset: null },
    };
    snapshot.revision = snapshotRevision(snapshot);
    const plan = { project_path: "C:/project.prproj", snapshot, steps: [
      { tool: "enable_disable_clip", clip_id: "first", args: { node_id: "first", enabled: false } },
      { tool: "move_clip", clip_id: "v", args: { node_id: "v", new_start_seconds: 8 } },
    ] };
    const timeline = getTimelineTools({});
    const moveHandler = vi.fn(timeline.move_clip.handler);
    const enableHandler = vi.fn(async () => ({ success: true, data: { verified: true } }));
    const tools = getExtendedEditPlanTools({}, {
      send: h.run, getToolCatalog: () => ({
        move_clip: { ...timeline.move_clip, handler: moveHandler },
        enable_disable_clip: { ...timeline.enable_disable_clip, handler: enableHandler },
      }),
    });
    return { ...h, tools, plan, moveHandler, enableHandler };
  }

  it("refuses preview when a snapshot claims a linked clip is a singleton", async () => {
    const h = planHost();
    expect(await h.tools.preview_extended_edit_plan.handler({ plan: h.plan })).toMatchObject({
      success: false, error: expect.stringContaining("unlinked"),
    });
  });

  it("refuses an apply when the target became linked since preview", async () => {
    const h = planHost();
    const read = h.video.getLinkedItems;
    h.video.getLinkedItems = () => null;
    const preview = await h.tools.preview_extended_edit_plan.handler({ plan: h.plan });
    expect(preview).toMatchObject({ success: true });
    const { confirmation_token } = preview.data as { confirmation_token: string };
    h.video.getLinkedItems = read;
    expect(await h.tools.apply_extended_edit_plan.handler({ confirmation_token })).toMatchObject({
      success: false, error: expect.stringContaining("unlinked"),
    });
    expect(h.enableHandler).not.toHaveBeenCalled();
    expect(h.video.writes).toEqual([]);
  });

  it("passes explicit false and rechecks live linkage inside the write after an earlier step", async () => {
    const h = planHost();
    h.video.getLinkedItems = () => null;
    h.audio.getLinkedItems = () => null;
    h.enableHandler.mockImplementationOnce(async () => {
      h.video.getLinkedItems = () => collection([h.video, h.audio]);
      h.audio.getLinkedItems = () => collection([h.video, h.audio]);
      return { success: true, data: { verified: true } };
    });
    const preview = await h.tools.preview_extended_edit_plan.handler({ plan: h.plan });
    expect(preview).toMatchObject({ success: true, data: { steps: [{ tool: "enable_disable_clip" }, { args: { include_linked: false } }] } });
    const { confirmation_token } = preview.data as { confirmation_token: string };
    expect(await h.tools.apply_extended_edit_plan.handler({ confirmation_token })).toMatchObject({
      success: false, data: { failed_index: 1, receipt: { error: expect.stringContaining("unlinked") } },
    });
    expect(h.moveHandler).toHaveBeenCalledWith({ node_id: "v", new_start_seconds: 8, include_linked: false });
    expect([...h.video.writes, ...h.audio.writes]).toEqual([]);
  });
});
