import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import {
  getTimelineTools,
  SPEED_UNAVAILABLE_DESCRIPTION,
  SPEED_UNAVAILABLE_ERROR,
} from "../../src/tools/timeline.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { capabilityForTool, guardToolHandler, resolveCapabilities } from "../../src/security/capabilities.js";
import { buildPremiereInstructions } from "../../src/workflows/agent-instructions.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test", timeoutMs: 1000 };
const timeline = getTimelineTools(bridgeOptions);
const advanced = getAdvancedTools(bridgeOptions);

const TPS = 254016000000;
const FRAME = TPS / 25;
const sec = (s: number) => String(Math.round(s * TPS));

beforeEach(() => vi.clearAllMocks());

type EndWriter = (requestedTicks: number, clip: MockClip) => number;

interface MockClipOptions {
  nodeId: string;
  name: string;
  start: number;
  end: number;
  mediaPath?: string;
  endWriter?: EndWriter;
  rejectTimeObject?: boolean;
  keyframes?: number[];
}

class MockClip {
  nodeId: string;
  name: string;
  _start: string;
  _end: string;
  writes: Array<{ edge: string; kind: string; ticks: string }> = [];
  components: unknown;
  projectItem: { getMediaPath(): string };
  private readonly endWriter?: EndWriter;
  private readonly rejectTimeObject: boolean;

  constructor(options: MockClipOptions) {
    this.nodeId = options.nodeId;
    this.name = options.name;
    this._start = sec(options.start);
    this._end = sec(options.end);
    this.endWriter = options.endWriter;
    this.rejectTimeObject = options.rejectTimeObject ?? false;
    const mediaPath = options.mediaPath ?? "C:/media/clip.mov";
    this.projectItem = { getMediaPath: () => mediaPath };
    const keys = (options.keyframes ?? []).map((seconds) => ({ ticks: sec(seconds) }));
    const property = { isTimeVarying: () => keys.length > 0, getKeys: () => keys };
    this.components = keys.length
      ? { numItems: 1, 0: { properties: { numItems: 1, 0: property } } }
      : { numItems: 0 };
  }

  get start() { return { ticks: this._start }; }
  set start(value: unknown) {
    this.writes.push({ edge: "start", kind: typeof value, ticks: String(value) });
    this._start = String(value);
  }
  get end() { return { ticks: this._end }; }
  set end(value: unknown) {
    const isObject = typeof value === "object" && value !== null;
    if (isObject && this.rejectTimeObject) throw new Error("Time object rejected");
    const ticks = isObject ? String((value as { ticks: string }).ticks) : String(value);
    this.writes.push({ edge: "end", kind: isObject ? "Time" : "string", ticks });
    const applied = this.endWriter ? this.endWriter(parseFloat(ticks), this) : parseFloat(ticks);
    this._end = String(applied);
  }
  get inPoint() { return { ticks: "0" }; }
  get outPoint() { return { ticks: String(parseFloat(this._end) - parseFloat(this._start)) }; }
  getSpeed() { return 1; }
  isSpeedReversed() { return 0; }
}

function listOf<T>(items: T[]) {
  const list: Record<string | number, unknown> = { numItems: items.length };
  items.forEach((item, index) => { list[index] = item; });
  return list;
}

function sequenceWith(clips: MockClip[]) {
  const track = { clips: listOf(clips) };
  return {
    timebase: String(FRAME),
    videoTracks: { numTracks: 1, 0: track },
    audioTracks: { numTracks: 0 },
  };
}

async function run(args: Record<string, unknown>, clips: MockClip[]) {
  mockedSendCommand.mockClear();
  await timeline.set_clip_duration.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  const script = mockedSendCommand.mock.calls[0][0] as string;
  function Time(this: { ticks: string }) { this.ticks = "0"; }
  const output = runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { activeSequence: sequenceWith(clips) } },
    Time,
  });
  return JSON.parse(String(output));
}

describe("set_clip_duration validation (#592)", () => {
  it.each([
    [{ node_id: "c1" }, "exactly one"],
    [{ node_id: "c1", duration_seconds: 5, end_seconds: 10 }, "exactly one"],
    [{ node_id: "c1", duration_seconds: 0 }, "greater than 0"],
    [{ node_id: "c1", duration_seconds: -2 }, "greater than 0"],
    [{ node_id: "c1", duration_seconds: Number.NaN }, "finite"],
    [{ node_id: "c1", end_seconds: Number.POSITIVE_INFINITY }, "finite"],
    [{ node_id: "c1", duration_seconds: 90000 }, "at most 86400"],
    [{ node_id: "c1", duration_seconds: 5, keyframe_policy: "drop" }, "keyframe_policy"],
    [{ node_id: "  ", duration_seconds: 5 }, "non-empty node_id"],
  ])("rejects %o before touching the bridge", async (args, message) => {
    const result = await timeline.set_clip_duration.handler(args as never);
    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining(message) }));
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("escapes the node id before embedding it in ExtendScript", async () => {
    await timeline.set_clip_duration.handler({ node_id: 'x"); evil(); ("', duration_seconds: 3 });
    const script = mockedSendCommand.mock.calls[0][0] as string;
    expect(script).toContain('__findClip("x\\"); evil(); (\\"")');
    expect(script).not.toContain('__findClip("x"); evil();');
  });

  it("uses only ES3 syntax in the generated host script", async () => {
    await timeline.set_clip_duration.handler({ node_id: "c1", end_seconds: 12 });
    const script = mockedSendCommand.mock.calls[0][0] as string;
    expect(script).not.toMatch(/\b(let|const)\s|=>|`/);
    expect(script).not.toContain("setSpeed");
    expect(script).not.toContain("enableQE");
  });
});

describe("set_clip_duration authority", () => {
  it("requires edit authority", async () => {
    expect(capabilityForTool("set_clip_duration")).toBe("edit");
    const handler = vi.fn(async () => "ok");
    await expect(
      guardToolHandler("set_clip_duration", handler, resolveCapabilities("inspect"), () => "op-1")({}),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit" });
    expect(handler).not.toHaveBeenCalled();
    await expect(
      guardToolHandler("set_clip_duration", handler, resolveCapabilities("inspect,edit"))({}),
    ).resolves.toBe("ok");
  });
});

describe("set_clip_duration host behavior", () => {
  it("extends a still image with a tick-based Time write and verifies the readback", async () => {
    const still = new MockClip({ nodeId: "c1", name: "photo.png", start: 2, end: 7, mediaPath: "D:/stills/photo.PNG" });
    const result = await run({ node_id: "c1", duration_seconds: 30 }, [still]);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      outcome: "verified",
      verified: true,
      changed: true,
      isStillImage: true,
      timelineStart: 2,
      timelineEnd: 32,
      durationSeconds: 30,
      previousEnd: 7,
      linkedItemsAdjusted: false,
    });
    expect(still.writes).toEqual([{ edge: "end", kind: "Time", ticks: sec(32) }]);
  });

  it("accepts an absolute timeline end", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.mov", start: 0, end: 10 });
    const result = await run({ node_id: "c1", end_seconds: 4 }, [clip]);
    expect(result.data).toMatchObject({ verified: true, timelineEnd: 4, durationSeconds: 4, isStillImage: false });
  });

  it("falls back to a tick string when the host rejects a Time object", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.png", start: 0, end: 5, mediaPath: "a.png", rejectTimeObject: true });
    const result = await run({ node_id: "c1", duration_seconds: 12 }, [clip]);
    expect(result.data.verified).toBe(true);
    expect(clip.writes).toEqual([{ edge: "end", kind: "string", ticks: sec(12) }]);
  });

  it("refuses to overlap the next clip on the same track without writing", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.png", start: 0, end: 5, mediaPath: "a.png" });
    const next = new MockClip({ nodeId: "c2", name: "b.mov", start: 10, end: 20 });
    const result = await run({ node_id: "c1", duration_seconds: 15 }, [clip, next]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("would overlap the next clip 'b.mov'");
    expect(result.error).toContain("No change was attempted");
    expect(clip.writes).toEqual([]);
  });

  it("allows extending exactly up to the next clip", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.png", start: 0, end: 5, mediaPath: "a.png" });
    const next = new MockClip({ nodeId: "c2", name: "b.mov", start: 10, end: 20 });
    const result = await run({ node_id: "c1", end_seconds: 10 }, [clip, next]);
    expect(result.data).toMatchObject({ verified: true, timelineEnd: 10 });
  });

  it("restores the original end and fails when Premiere clamps the extension", async () => {
    const clip = new MockClip({
      nodeId: "c1", name: "a.mov", start: 0, end: 5,
      endWriter: (ticks) => Math.min(ticks, 7 * TPS),
    });
    const result = await run({ node_id: "c1", duration_seconds: 20 }, [clip]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not apply a verified duration change");
    expect(result.error).toContain("original start and end were restored");
    expect(result.error).toContain("no more frames");
    expect(clip._end).toBe(sec(5));
  });

  it("points still images at clear_item_in_out when the host clamps them", async () => {
    const clip = new MockClip({
      nodeId: "c1", name: "p.jpg", start: 0, end: 5, mediaPath: "p.jpg",
      endWriter: (_ticks, self) => parseFloat(self._end),
    });
    const result = await run({ node_id: "c1", duration_seconds: 20 }, [clip]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not apply the duration change");
    expect(result.error).toContain("clear_item_in_out");
    expect(result.error).toContain("The clip is unchanged");
  });

  it("rejects shortening that would strand keyframes unless preserve is requested", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.mov", start: 0, end: 10, keyframes: [1, 8] });
    const rejected = await run({ node_id: "c1", duration_seconds: 4 }, [clip]);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("Refusing to shorten");
    expect(clip.writes).toEqual([]);

    const preserved = await run({ node_id: "c1", duration_seconds: 4, keyframe_policy: "preserve" }, [clip]);
    expect(preserved.data).toMatchObject({ verified: true, keyframesOutsideVisibleRange: 1, keyframePolicy: "preserve" });
  });

  it("reports a verified no-op when the clip already has the requested end", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.mov", start: 1, end: 6 });
    const result = await run({ node_id: "c1", end_seconds: 6 }, [clip]);
    expect(result.data).toMatchObject({ verified: true, changed: false, durationSeconds: 5 });
    expect(clip.writes).toEqual([]);
  });

  it("rejects an end within one frame of the start and an unknown clip", async () => {
    const clip = new MockClip({ nodeId: "c1", name: "a.mov", start: 5, end: 10 });
    const tooShort = await run({ node_id: "c1", end_seconds: 5.01 }, [clip]);
    expect(tooShort.error).toContain("at least one frame");
    const missing = await run({ node_id: "nope", duration_seconds: 3 }, [clip]);
    expect(missing.error).toContain("Clip not found: nope");
    expect(clip.writes).toEqual([]);
  });
});

describe("clip speed stays unavailable with consistent guidance (#593)", () => {
  it("shares one description and error across every speed surface", async () => {
    expect(timeline.speed_change.description).toBe(SPEED_UNAVAILABLE_DESCRIPTION);
    expect(advanced.set_clip_speed_qe.description).toBe(SPEED_UNAVAILABLE_DESCRIPTION);
    expect(SPEED_UNAVAILABLE_DESCRIPTION).toContain("set_clip_duration");
    expect(SPEED_UNAVAILABLE_ERROR).toContain("set_clip_duration");

    const results = await Promise.all([
      timeline.speed_change.handler({ node_id: "c1", speed_percent: 50 }),
      advanced.set_clip_speed_qe.handler({ node_id: "c1", speed_percent: 50 }),
      timeline.set_clip_properties.handler({ node_id: "c1", speed: 0.5 }),
    ]);
    for (const result of results) {
      expect(result).toEqual({ success: false, error: SPEED_UNAVAILABLE_ERROR });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("routes agents to set_clip_duration in the MCP instructions", () => {
    const text = buildPremiereInstructions(new Set(["set_clip_duration"]));
    expect(text).toContain("set_clip_duration");
    expect(text).toContain("speed_change and set_clip_speed_qe always fail before mutation");
  });
});
