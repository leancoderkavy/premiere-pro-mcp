import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTimelineTools } from "../../src/tools/timeline.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test", timeoutMs: 1000 };
const sequenceTools = getSequenceTools(bridgeOptions);
const advanced = getAdvancedTools(bridgeOptions);
const timeline = getTimelineTools(bridgeOptions);

const TPS = 254016000000;
const FRAME = TPS / 25;
const t = (seconds: number) => Math.round(seconds * TPS);

beforeEach(() => vi.clearAllMocks());

let nodeCounter = 0;

class FakeItem {
  type = 1;
  marks: Record<number, { in: number; out: number }>;
  constructor(public nodeId: string, public name: string, mediaSeconds: number) {
    this.marks = { 1: { in: 0, out: t(mediaSeconds) }, 2: { in: 0, out: t(mediaSeconds) } };
  }
  getInPoint(mediaType: number) {
    return { ticks: String(this.marks[mediaType].in), seconds: this.marks[mediaType].in / TPS };
  }
  getOutPoint(mediaType: number) {
    return { ticks: String(this.marks[mediaType].out), seconds: this.marks[mediaType].out / TPS };
  }
  setInPoint(seconds: number, mediaType: number) { this.marks[mediaType].in = Math.round(seconds * TPS); }
  // Live 26.5.2: Premiere ignores an Out mark past the media's length (a still or a short clip).
  maxOutTicks: number | null = null;
  // Live 26.5.2: video marks are floored to the media's own frame grid.
  mediaFps: number | null = null;
  getFootageInterpretation() { return { frameRate: this.mediaFps ?? 25 }; }
  setOutPoint(seconds: number, mediaType: number) {
    let ticks = Math.round(seconds * TPS);
    if (this.maxOutTicks !== null && ticks > this.maxOutTicks) return;
    if (this.mediaFps && mediaType === 1) ticks = Math.floor(ticks / (TPS / this.mediaFps) + 1e-9) * Math.round(TPS / this.mediaFps);
    this.marks[mediaType].out = ticks;
  }
}

class FakeClip {
  track: FakeTrack | null = null;
  frozenEnd = false;
  constructor(
    public nodeId: string,
    public name: string,
    public projectItem: FakeItem,
    public _start: number,
    public _end: number,
    public _in: number,
    public _out: number,
  ) {}
  get start() { return { ticks: String(this._start) }; }
  set start(value: unknown) { this._start = parseFloat(String(value)); }
  get end() { return { ticks: String(this._end) }; }
  set end(value: unknown) {
    if (this.frozenEnd) return;
    this._end = parseFloat(typeof value === "object" && value !== null && "ticks" in value ? String((value as { ticks: string }).ticks) : String(value));
  }
  get inPoint() { return { ticks: String(this._in) }; }
  get outPoint() { return { ticks: String(this._out) }; }
  getSpeed() { return 1; }
  isSpeedReversed() { return false; }
  remove() {
    if (!this.track) return;
    this.track.items = this.track.items.filter((clip) => clip !== this);
    this.track = null;
  }
}

class FakeTrack {
  items: FakeClip[] = [];
  locked = false;
  overwriteIgnoresMarks = false;
  constructor(public type: "video" | "audio") {}
  get clips() {
    const sorted = [...this.items].sort((a, b) => a._start - b._start);
    const list: Record<string | number, unknown> = { numItems: sorted.length };
    sorted.forEach((clip, index) => { list[index] = clip; });
    return list;
  }
  isLocked() { return this.locked; }
  add(clip: FakeClip) {
    clip.track = this;
    this.items.push(clip);
    return clip;
  }
  overwriteClip(item: FakeItem, time: { ticks: string }) {
    const mediaType = this.type === "video" ? 1 : 2;
    const marks = this.overwriteIgnoresMarks ? { in: 0, out: t(10) } : item.marks[mediaType];
    const start = parseFloat(time.ticks);
    this.add(new FakeClip(`placed-${++nodeCounter}`, item.name, item, start, start + (marks.out - marks.in), marks.in, marks.out));
  }
}

function trackList(tracks: FakeTrack[]) {
  const list: Record<string | number, unknown> = { numTracks: tracks.length };
  tracks.forEach((track, index) => { list[index] = track; });
  return list;
}

function makeSequence(id: string, name: string, video: FakeTrack[], audio: FakeTrack[], projectItem?: FakeItem) {
  return {
    sequenceID: id,
    name,
    projectItem,
    timebase: String(FRAME),
    videoTracks: trackList(video),
    audioTracks: trackList(audio),
  };
}

function Time(this: { ticks: string }) { this.ticks = "0"; }

function execute(script: string, context: Record<string, unknown>) {
  expect(script).not.toMatch(/\b(let|const)\s|=>/);
  const output = runInNewContext(
    `Array.prototype.indexOf = undefined;\n${getHelpersSource()}\n${script}`,
    { Time, ...context },
  );
  return JSON.parse(String(output));
}

async function scriptFor(handler: (args: never) => Promise<unknown>, args: Record<string, unknown>) {
  mockedSendCommand.mockClear();
  await handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return mockedSendCommand.mock.calls[0][0] as string;
}

describe("unnest_sequence refuses unsafe unnests and verifies placements (#642)", () => {
  function fixture(options: { nestOutSeconds?: number } = {}) {
    const itemA = new FakeItem("item-a", "A", 10);
    const itemB = new FakeItem("item-b", "B", 10);
    // Video-only sources: footage with sound is refused because Track.overwriteClip
    // would also place audio on the matching track (live 26.5.2).
    itemA.marks[2] = { in: 0, out: 0 };
    itemB.marks[2] = { in: 0, out: 0 };
    const nestItem = new FakeItem("nest-item", "Nest", 2);
    const nestedV0 = new FakeTrack("video");
    const nestedV1 = new FakeTrack("video");
    nestedV0.add(new FakeClip("na", "A", itemA, 0, t(2), t(1), t(3)));
    nestedV1.add(new FakeClip("nb", "B", itemB, t(1), t(2), 0, t(1)));
    const nested = makeSequence("seq-nested", "Nest", [nestedV0, nestedV1], [], nestItem);

    const parentV = [new FakeTrack("video"), new FakeTrack("video"), new FakeTrack("video")];
    const parentA = [new FakeTrack("audio")];
    const nestClip = parentV[0].add(new FakeClip("nest-clip", "Nest", nestItem, t(10), t(12), 0, t(options.nestOutSeconds ?? 2)));
    if (options.nestOutSeconds !== undefined) nestClip._end = t(10 + options.nestOutSeconds);
    const parent = makeSequence("seq-parent", "Main", parentV, parentA);
    const app = {
      project: {
        activeSequence: parent,
        sequences: { numSequences: 2, 0: parent, 1: nested },
        rootItem: { children: { numItems: 0 } },
      },
    };
    return { app, parentV, itemA, itemB, nestClip };
  }

  async function unnest(app: unknown) {
    const script = await scriptFor(sequenceTools.unnest_sequence.handler, { node_id: "nest-clip" });
    return execute(script, { app });
  }

  it("unnests and verifies each clip's start and source in/out", async () => {
    const { app, parentV, itemA } = fixture();
    const result = await unnest(app);
    expect(result).toMatchObject({ success: true, data: { unnested: true, verified: true, outcome: "verified", clipsAdded: 2 } });
    expect(parentV[0].items).toHaveLength(1);
    expect(parentV[0].items[0]).toMatchObject({ name: "A", _start: t(10), _end: t(12), _in: t(1), _out: t(3) });
    expect(parentV[1].items[0]).toMatchObject({ name: "B", _start: t(11), _end: t(12), _in: 0, _out: t(1) });
    expect(itemA.marks[1]).toEqual({ in: 0, out: t(10) });
  });

  it("refuses a trimmed nest without changing the timeline", async () => {
    const { app, parentV, nestClip } = fixture({ nestOutSeconds: 1.5 });
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("trimmed");
    expect(result.error).toContain("nothing was changed");
    expect(parentV[0].items).toEqual([nestClip]);
    expect(parentV[1].items).toHaveLength(0);
  });

  it("refuses when the destination range is already occupied", async () => {
    const { app, parentV, nestClip } = fixture();
    const blocker = parentV[1].add(new FakeClip("blocker", "Blocker", new FakeItem("x", "X", 10), t(11.5), t(13), 0, t(1.5)));
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already occupied by Blocker");
    expect(result.error).toContain("nothing was changed");
    expect(parentV[0].items).toEqual([nestClip]);
    expect(parentV[1].items).toEqual([blocker]);
  });

  it("refuses unreadable other-media timing before removing the nest", async () => {
    const { app, parentV, nestClip, itemA } = fixture();
    const original = itemA.getOutPoint.bind(itemA);
    itemA.getOutPoint = (type: number) => { if (type === 2) throw new Error("unreadable"); return original(type); };
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("other-media timing is unreadable");
    expect(parentV[0].items).toEqual([nestClip]);
    expect(parentV[1].items).toHaveLength(0);
  });

  it("refuses a nested A/V item before removing the nest", async () => {
    const { app, parentV, nestClip, itemA } = fixture();
    itemA.marks[2] = { in: 0, out: t(10) };
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Unnest refused; nothing was changed\. A also has audio/);
    expect(result.error).toContain("Track.overwriteClip");
    expect(parentV[0].items).toEqual([nestClip]);
    expect(parentV[1].items).toHaveLength(0);
  });

  it("refuses when a nested clip's source range is not accepted, before removing the nest", async () => {
    const { app, parentV, nestClip, itemB } = fixture();
    itemB.maxOutTicks = 0;
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Unnest refused; nothing was changed\. Premiere did not accept a source range of 1s from 0s on project item B/);
    expect(parentV[0].items).toEqual([nestClip]);
    expect(parentV[1].items).toHaveLength(0);
    expect(itemB.marks[1]).toEqual({ in: 0, out: t(10) });
  });

  it("refuses when a destination track is locked", async () => {
    const { app, parentV, nestClip } = fixture();
    parentV[1].locked = true;
    const result = await unnest(app);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("is locked") });
    expect(parentV[0].items).toEqual([nestClip]);
  });

  it("reports a readback mismatch as a changed timeline instead of success", async () => {
    const { app, parentV } = fixture();
    parentV[1].overwriteIgnoresMarks = true;
    const result = await unnest(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("The timeline changed");
    expect(result.error).toContain("Use Undo");
    expect(result.error).toContain("B ends at");
  });
});

describe("move_clip_to_track verifies destination span and origin removal (#642)", () => {
  type MoveHook = (clip: FakeClip, destination: FakeTrack) => void;

  function fixture(hook?: MoveHook) {
    const video = [new FakeTrack("video"), new FakeTrack("video")];
    const clip = video[0].add(new FakeClip("clip-c", "C", new FakeItem("item-c", "C", 10), t(2), t(4), 0, t(2)));
    const parent = makeSequence("seq-parent", "Main", video, []);
    const qeTrack = (index: number) => ({
      get numItems() { return video[index].items.length; },
      getItemAt(position: number) {
        const domClip = [...video[index].items].sort((a, b) => a._start - b._start)[position];
        return {
          type: "Clip",
          start: { ticks: String(domClip._start) },
          moveToTrack(videoDelta: number) {
            const destination = video[index + videoDelta];
            domClip.remove();
            destination.add(domClip);
            hook?.(domClip, destination);
          },
        };
      },
    });
    const app = {
      enableQE() {},
      project: { activeSequence: parent, sequences: { numSequences: 1, 0: parent } },
    };
    const qe = { project: { getActiveSequence: () => ({ getVideoTrackAt: qeTrack, getAudioTrackAt: qeTrack }) } };
    return { app, qe, video, clip };
  }

  async function move(context: { app: unknown; qe: unknown }) {
    const script = await scriptFor(advanced.move_clip_to_track.handler, { node_id: "clip-c", target_track_index: 1 });
    return execute(script, context);
  }

  it("verifies the clip on the destination track with the same span", async () => {
    const context = fixture();
    const result = await move(context);
    expect(result).toMatchObject({ success: true, data: { moved: true, verified: true, outcome: "verified", newTrackIndex: 1 } });
    expect(context.video[0].items).toHaveLength(0);
    expect(context.video[1].items[0]).toMatchObject({ _start: t(2), _end: t(4) });
  });

  it("detects a span change that could not be restored", async () => {
    const context = fixture((clip) => {
      clip._end += t(1);
      clip.frozenEnd = true;
    });
    const result = await move(context);
    expect(result.success).toBe(false);
    expect(result.error).toContain("The timeline changed");
    expect(result.error).toContain("duration");
    expect(result.error).toContain("Use Undo");
  });

  it("detects a copy left on the origin track", async () => {
    const context = fixture((clip, destination) => {
      destination.items = destination.items.filter((item) => item !== clip);
      context.video[0].add(clip);
      destination.add(new FakeClip("copy", clip.name, clip.projectItem, clip._start, clip._end, clip._in, clip._out));
    });
    const result = await move(context);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("The timeline changed") });
  });

  it("refuses an occupied destination range before calling QE", async () => {
    const context = fixture(() => { throw new Error("moveToTrack must not run"); });
    context.video[1].add(new FakeClip("d", "D", new FakeItem("item-d", "D", 10), t(3), t(5), 0, t(2)));
    const result = await move(context);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already occupied by D");
    expect(result.error).toContain("nothing was changed");
    expect(context.video[0].items).toEqual([context.clip]);
  });

  it("refuses a locked destination track before calling QE", async () => {
    const context = fixture(() => { throw new Error("moveToTrack must not run"); });
    context.video[1].locked = true;
    const result = await move(context);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("is locked") });
    expect(context.video[0].items).toEqual([context.clip]);
  });

  it("rejects a non-integer target track before contacting Premiere", async () => {
    const result = await advanced.move_clip_to_track.handler({ node_id: "clip-c", target_track_index: 1.5 });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("non-negative integer") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("replace_clip keeps the original span (#642)", () => {
  function fixture() {
    const video = [new FakeTrack("video")];
    const original = video[0].add(new FakeClip("old", "Old", new FakeItem("item-old", "Old", 10), t(2), t(5), 0, t(3)));
    const neighbour = video[0].add(new FakeClip("next", "Next", new FakeItem("item-next", "Next", 10), t(5), t(7), 0, t(2)));
    const replacement = new FakeItem("item-new", "New", 10);
    replacement.marks[1] = { in: t(1), out: t(10) };
    replacement.marks[2] = { in: 0, out: 0 };
    const parent = makeSequence("seq-parent", "Main", video, [new FakeTrack("audio")]);
    const app = {
      project: {
        activeSequence: parent,
        sequences: { numSequences: 1, 0: parent },
        rootItem: { children: { numItems: 1, 0: replacement } },
      },
    };
    return { app, video, original, neighbour, replacement };
  }

  async function replace(app: unknown, newItemId = "item-new") {
    const script = await scriptFor(timeline.replace_clip.handler, { node_id: "old", new_item_id: newItemId });
    return execute(script, { app });
  }

  it("preserves start and end, leaves neighbours in place, and restores marks", async () => {
    const { app, video, neighbour, replacement } = fixture();
    const result = await replace(app);
    expect(result).toMatchObject({ success: true, data: { replaced: true, verified: true, outcome: "verified", startSeconds: 2, endSeconds: 5 } });
    const placed = video[0].items.find((clip) => clip.projectItem === replacement);
    expect(placed).toMatchObject({ _start: t(2), _end: t(5), _in: t(1), _out: t(4) });
    expect(neighbour).toMatchObject({ _start: t(5), _end: t(7) });
    expect(video[0].items.some((clip) => clip.nodeId === "old")).toBe(false);
    expect(replacement.marks[1]).toEqual({ in: t(1), out: t(10) });
  });

  it("reports a changed span as a failed replace with Undo guidance", async () => {
    const { app, video } = fixture();
    video[0].overwriteIgnoresMarks = true;
    const result = await replace(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("The timeline changed");
    expect(result.error).toContain("instead of 2s-5s");
    expect(result.error).toContain("Use Undo");
  });

  it("refuses a replacement too short for the span without removing the original", async () => {
    const { app, video, original, replacement } = fixture();
    replacement.maxOutTicks = t(3);
    const result = await replace(app);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Replace refused; nothing was changed\. Premiere did not accept a source range of 3s from 1s on project item New/);
    expect(video[0].items).toContain(original);
    expect(video[0].items.some((clip) => clip.projectItem === replacement)).toBe(false);
    expect(replacement.marks[1]).toEqual({ in: t(1), out: t(10) });
  });

  it("fills the span with media at another frame rate by extending the placed end", async () => {
    const { app, video, original, neighbour, replacement } = fixture();
    replacement.mediaFps = 24000 / 1001;
    const result = await replace(app);
    expect(result).toMatchObject({ success: true, data: { replaced: true, verified: true, endCorrected: true, startSeconds: 2, endSeconds: 5 } });
    const placed = video[0].items.find((clip) => clip.projectItem === replacement);
    expect(placed).toMatchObject({ _start: t(2), _end: t(5) });
    expect(video[0].items).not.toContain(original);
    expect(neighbour).toMatchObject({ _start: t(5), _end: t(7) });
  });

  it("reports a failed replace when the placed end cannot be extended", async () => {
    const { app, video, replacement } = fixture();
    replacement.mediaFps = 24000 / 1001;
    const realOverwrite = video[0].overwriteClip.bind(video[0]);
    video[0].overwriteClip = (item, time) => { realOverwrite(item, time); video[0].items[video[0].items.length - 1].frozenEnd = true; };
    const result = await replace(app);
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not verify");
  });

  it("refuses a replacement that also has audio, before removing the original", async () => {
    const { app, video, original, replacement } = fixture();
    replacement.marks[2] = { in: 0, out: t(10) };
    const result = await replace(app);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Replace refused; nothing was changed\. New also has audio/);
    expect(video[0].items).toContain(original);
    expect(video[0].items.some((clip) => clip.projectItem === replacement)).toBe(false);
  });

  it("refuses a locked track without removing the original", async () => {
    const { app, video, original } = fixture();
    video[0].locked = true;
    const result = await replace(app);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("nothing was changed") });
    expect(video[0].items).toContain(original);
  });

  it("escapes the replacement item id", async () => {
    await timeline.replace_clip.handler({ node_id: "old", new_item_id: 'x"); evil(); ("' });
    const script = mockedSendCommand.mock.calls[0][0] as string;
    expect(script).toContain('__findProjectItem("x\\"); evil(); (\\"")');
  });
});
