import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationTicks: vi.fn().mockResolvedValue(3600 * 254016000000) }));

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "/fixture/source.mp4" } }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTrackTools } from "../../src/tools/tracks.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test", timeoutMs: 1000 };
const timeline = getTimelineTools(bridgeOptions);
const trackTargeting = getTrackTargetingTools(bridgeOptions);
const advanced = getAdvancedTools(bridgeOptions);
const tracks = getTrackTools(bridgeOptions);

beforeEach(() => vi.clearAllMocks());

describe("trim_clip verification", () => {
  it("requires exactly one edit point instead of reporting a no-op or multi-write as success", async () => {
    const result = await timeline.trim_clip.handler({ node_id: "abc" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("new_in_seconds");
    // The bridge must not be touched at all — there is nothing to apply.
    expect(mockedSendCommand).not.toHaveBeenCalled();

    const multiple = await timeline.trim_clip.handler({
      node_id: "abc",
      new_in_seconds: 2,
      new_out_seconds: 8,
    });
    expect(multiple.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("compares the read-back in point against the requested value", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("var actualIn = after.inPoint");
    expect(script).toContain("Math.abs(actualIn - requestedIn) > tolerance / 1000");
    expect(script).toContain("requestedTrimDeltaTicks = __secondsToTicks(2) - parseFloat(target.clip.inPoint.ticks)");
    expect(script).toContain("__trimDeltaTicks = __snapSequenceTicks(app.project.activeSequence, requestedTrimDeltaTicks)");
    expect(script).toContain("did not apply a verified timeline trim");
    expect(script).toContain("verified: true");
  });

  it("compares the read-back out point against the requested value", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("Math.abs(actualOut - requestedOut) > tolerance / 1000");
    expect(script).toContain("requestedTrimDeltaTicks = __secondsToTicks(8) - parseFloat(target.clip.outPoint.ticks)");
  });

  it("only writes the edge that was actually requested", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    // Head trim: the start edge and the in point move together; the tail is untouched.
    expect(script).toContain("var trimInTicks = parseFloat(originalInPointTicks) + __trimDeltaTicks;");
    expect(script).toContain("clip.start = trimStart;");
    expect(script).toContain("clip.inPoint = String(Math.round(trimInTicks));");
    expect(script).not.toContain("clip.end = trimEnd;");
    expect(script).not.toContain("clip.outPoint = String(Math.round(trimOutTicks));");
  });

  it("derives its tolerance from the sequence timebase so frame snapping is not a failure", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("seq.timebase");
    expect(script).toContain("frame grid could not be read");
    expect(script).toContain("var tolerance = __ticksToSeconds(frameTicks)");
  });

  it("refuses invalid numeric edit points before contacting Premiere", async () => {
    const result = await timeline.trim_clip.handler({
      node_id: "abc",
      new_out_seconds: Number.NaN,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("finite");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("verifies the visible timeline geometry as well as source metadata", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("var afterResult = __findClip(nodeId)");
    expect(script).toContain("return __runLinkedEdit(target, \"abc\", true, __editOne, \"trim\")");
    expect(script).toContain("var expectedStart = before.start");
    expect(script).toContain("var expectedEnd = before.end + (actualOut - before.outPoint)");
    expect(script).toContain("visible timeline duration does not match the applied source range");
    expect(script).toContain("visible timeline start/end ticks did not move");
    expect(script).toContain("source metadata was rolled back");
  });

  it("fails closed for retimed clips and unhandled out-of-range keyframes", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("does not support retimed or otherwise non-1x clips");
    expect(script).toContain("__findOutOfRangeKeyframes");
    expect(script).toContain("keyframe_policy: preserve");
    expect(script).toContain("keyframesOutsideVisibleRange");
  });

  it("allows explicit keyframe preservation while reporting that it was not fully verified", async () => {
    await timeline.trim_clip.handler({
      node_id: "abc",
      new_out_seconds: 8,
      keyframe_policy: "preserve",
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain('keyframePolicy: "preserve"');
    expect(script).toContain("keyframesVerified:");
  });
});

describe("split_clip verification", () => {
  it("refuses invalid local arguments before contacting Premiere", async () => {
    const invalidTime = await timeline.split_clip.handler({ time_seconds: -1 });
    expect(invalidTime.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();

    const invalidTrack = await timeline.split_clip.handler({
      time_seconds: 4,
      track_index: 1.5,
    });
    expect(invalidTrack.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("requires a clip to span the requested cut before attempting QE razor", async () => {
    await timeline.split_clip.handler({ time_seconds: 4, track_type: "audio" });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("function __eligibleClips");
    expect(script).toContain("if (!eligibleBefore.length)");
    expect(script).toContain("no razor was attempted");
  });

  it("verifies each left and right segment, not only a count increase", async () => {
    await timeline.split_clip.handler({ time_seconds: 4 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("var expectedClipCount = clipCountBefore + eligibleBefore.length");
    expect(script).toContain("function __hasSegment");
    expect(script).toContain("left segment");
    expect(script).toContain("right segment");
    expect(script).toContain('keyframeSemantics: "unverified"');
  });

  it("returns structured timeline state when QE split partially changes a track", async () => {
    await timeline.split_clip.handler({ time_seconds: 4 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("timelineChanged: true");
    expect(script).toContain('outcome: "not_applied"');
    expect(script).toContain("clipCountBefore: clipCountBefore");
    expect(script).toContain("clipCountAfter: clipCountAfter");
  });
});

describe("set_clip_properties verification", () => {
  it("refuses empty, non-finite, and out-of-range requests before dispatch", async () => {
    await expect(timeline.set_clip_properties.handler({ node_id: "c1" })).resolves.toMatchObject({ success: false });
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", opacity: Number.NaN })).resolves.toMatchObject({ success: false });
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", opacity: 101 })).resolves.toMatchObject({ success: false });
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", scale: -1 })).resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("preflights localized Scale before invoking localized write helpers", async () => {
    let stored = 100;
    const scale = { displayName: "Escala", getValue: () => stored, setValue: (value: number) => { stored = value; } };
    const clip = { nodeId: "c1", name: "Clip", components: { numItems: 1, 0: { displayName: "Movimiento", matchName: "AE.ADBE Motion", properties: { numItems: 2, 0: { displayName: "Escala uniforme", getValue: () => true }, 1: scale } } } };
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: { videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } } } },
    }))));
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", scale: 110 })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(stored).toBe(110);
  });

  it("refuses duplicate intrinsic property names with indices before writing", async () => {
    const first = { displayName: "Opacity", getValue: () => 100, setValue: vi.fn() };
    const second = { displayName: "Opacity", getValue: () => 80, setValue: vi.fn() };
    const clip = { nodeId: "c1", name: "Clip", components: { numItems: 1, 0: { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 2, 0: first, 1: second } } } };
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: { videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } } } },
    }))));
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", opacity: 50 })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Opacity is ambiguous at property indices [0, 1]"),
    });
    expect(first.setValue).not.toHaveBeenCalled();
    expect(second.setValue).not.toHaveBeenCalled();
  });

  it("preflights requested properties and reads them back after writing", async () => {
    await timeline.set_clip_properties.handler({ node_id: "c1", opacity: 50, scale: 110, position_x: 100, rotation: 10 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("Opacity value could not be read before mutation");
    expect(script).toContain("Motion Scale values could not be read before mutation");
    expect(script).toContain("Position value could not be read before mutation");
    expect(script).toContain("Rotation value could not be read before mutation");
    expect(script).toContain('outcome: timelineChanged || unverifiedProperties.length ? "committed_unverified" : "not_applied"');
    expect(script).toContain("timelineChanged: timelineChanged ? true : (unverifiedProperties.length ? null : false)");
    expect(script).toContain("readback: readback");
    expect(script).toContain("verified: true");
  });

  it.each([{ post: "throw", opacity: 50 }, { post: undefined, opacity: 50 }, { post: null, opacity: 0 }, { post: true, opacity: 1 }, { post: "50", opacity: 50 }])("preserves unknown state after an opacity write with invalid readback ($post)", async ({ post, opacity }) => {
    const property = {
      displayName: "Opacity", written: false,
      getValue() { if (!this.written) return 100; if (post === "throw") throw new Error("unreadable"); return post; },
      setValue: vi.fn(function (this: { written: boolean }) { this.written = true; }),
    };
    const clip = { nodeId: "c1", name: "Clip", components: { numItems: 1, 0: { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: property } } } };
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: { videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } } } },
    }))));
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", opacity })).resolves.toMatchObject({
      success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null, unverifiedProperties: ["opacity"], readback: { opacity: null } },
    });
    expect(property.setValue).toHaveBeenCalledWith(opacity, true);
  });

  it.each([false, true])("lists every unreadable requested property with localized names=%s", async (localized) => {
    function property(displayName: string, value: number | number[]) {
      let written = false;
      return { displayName, getValue() { if (written) throw new Error("post-write read failed"); return value; }, setValue: vi.fn(() => { written = true; }) };
    }
    const opacity = property(localized ? "Opacidad" : "Opacity", 100);
    const scale = property(localized ? "Escala" : "Scale", 100);
    const position = property(localized ? "Posición" : "Position", [0.5, 0.5]);
    const rotation = property(localized ? "Rotación" : "Rotation", 0);
    const clip = { nodeId: "c1", name: "Clip", components: { numItems: 2,
      0: { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: opacity } },
      1: { displayName: "Motion", matchName: "AE.ADBE Motion", properties: { numItems: 4, 0: { displayName: "Uniform Scale", getValue: () => true }, 1: scale, 2: position, 3: rotation } },
    } };
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: { frameSizeHorizontal: 1920, frameSizeVertical: 1080, videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } } } },
    }))));
    await expect(timeline.set_clip_properties.handler({ node_id: "c1", opacity: 50, scale: 110, position_x: 100, rotation: 10 })).resolves.toMatchObject({
      success: false, data: { outcome: "committed_unverified", timelineChanged: null, unverifiedProperties: ["opacity", "scale", "position", "rotation"] },
    });
    for (const prop of [opacity, scale, position, rotation]) expect(prop.setValue).toHaveBeenCalledOnce();
  });
});

describe("duplicate_clip verification", () => {
  it("does not claim the timeline changed when overwrite places no duplicate", async () => {
    const ticks = (seconds: number) => String(seconds * 254016000000);
    const item = {
      getInPoint: () => ({ ticks: "0", seconds: 0 }),
      getOutPoint: (type: number) => ({ ticks: ticks(type === 2 ? 0 : 2), seconds: type === 2 ? 0 : 2 }),
      setInPoint: vi.fn(), setOutPoint: vi.fn(),
    };
    const clip = { nodeId: "c1", projectItem: item, start: { ticks: "0" }, end: { ticks: ticks(2) }, inPoint: { ticks: "0" } };
    class Time { ticks = "0"; }
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      Time,
      app: { project: { activeSequence: { videoTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: clip } }, 1: { clips: { numItems: 0 }, overwriteClip: () => {} } }, audioTracks: { numTracks: 0 } } } },
    }))));
    await expect(timeline.duplicate_clip.handler({ node_id: "c1" })).resolves.toMatchObject({ success: false, data: { timelineChanged: null, outcome: "committed_unverified", verified: false } });
  });

  it("does not report success when a duplicate or linked partner is unverified", async () => {
    await timeline.duplicate_clip.handler({ node_id: "c1" });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('var duplicateVerified = drift < frameTicks / 2 && inDrift < inTolerance && linkedVerified');
    expect(script).toContain('if (!duplicateVerified) return __jsonStringify({ success: false');
    expect(script).toContain('outcome: "committed_unverified"');
    expect(script).toContain('var linkedVerified = !partner || (!!linkedCopy');
    expect(script).toContain('timelineChanged: true');
    expect(script).not.toContain("Math.max(videoTarget, 0)");
    expect(script).not.toContain("Math.max(audioTarget, 0)");
    expect(script).toContain("destTrack.overwriteClip(item, at)");
  });

  it.each([
    { kind: "audio-only", smashType: "video" as const },
    { kind: "video-only", smashType: "audio" as const },
  ])("does not overwrite $smashType track 0 when duplicating a $kind clip", async ({ smashType }) => {
    const ticks = (seconds: number) => String(seconds * 254016000000);
    const item = {
      getInPoint: () => ({ ticks: "0", seconds: 0 }),
      getOutPoint: (type: number) => smashType === "video"
        ? { ticks: ticks(type === 1 ? 0 : 2), seconds: type === 1 ? 0 : 2 }
        : { ticks: ticks(type === 2 ? 0 : 2), seconds: type === 2 ? 0 : 2 },
      setInPoint: vi.fn(), setOutPoint: vi.fn(),
    };
    const clip = { nodeId: "c1", projectItem: item, start: { ticks: "0" }, end: { ticks: ticks(2) }, inPoint: { ticks: "0" } };
    const occupant = { nodeId: "keep", start: { ticks: "0" }, end: { ticks: ticks(2) } };
    const seqOverwrite = vi.fn();
    const occupantTrackOverwrite = vi.fn();
    const dest = { clips: { numItems: 0 } as Record<string, unknown>, overwriteClip: (_placedItem: unknown, time: { ticks: string }) => {
      dest.clips = { numItems: 1, 0: { nodeId: "copy", start: { ticks: time.ticks }, end: { ticks: ticks(2) }, inPoint: { ticks: "0" } } };
    } };
    const occupantTrack = { clips: { numItems: 1, 0: occupant }, overwriteClip: occupantTrackOverwrite };
    const sourceTrack = { clips: { numItems: 1, 0: clip } };
    class Time { ticks = "0"; }
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      Time,
      app: { project: { activeSequence: {
        overwriteClip: seqOverwrite,
        videoTracks: smashType === "video"
          ? { numTracks: 1, 0: occupantTrack }
          : { numTracks: 2, 0: sourceTrack, 1: dest },
        audioTracks: smashType === "video"
          ? { numTracks: 2, 0: sourceTrack, 1: dest }
          : { numTracks: 1, 0: occupantTrack },
      } } },
    }))));
    await expect(timeline.duplicate_clip.handler({ node_id: "c1" })).resolves.toMatchObject({
      success: true, data: { verified: true, outcome: "verified", duplicated: true },
    });
    expect(seqOverwrite).not.toHaveBeenCalled();
    expect(occupantTrackOverwrite).not.toHaveBeenCalled();
    expect(occupantTrack.clips[0]).toBe(occupant);
  });

  // 29.97 fps: Premiere places the copy one frame short of the original's end.
  const frame = 8475667200;
  function oneFrameShortHost(endSettable: boolean) {
    const originalEnd = 677 * frame;
    const item = {
      getInPoint: () => ({ ticks: "0", seconds: 0 }),
      getOutPoint: (type: number) => type === 2 ? { ticks: "0", seconds: 0 } : { ticks: String(678 * frame), seconds: (678 * frame) / 254016000000 },
      setInPoint: vi.fn(), setOutPoint: vi.fn(),
    };
    const clip = { nodeId: "c1", projectItem: item, start: { ticks: "0" }, end: { ticks: String(originalEnd) }, inPoint: { ticks: "0" } };
    const target = { clips: { numItems: 0 } as Record<string, unknown>, overwriteClip: (_item: unknown, time: { ticks: string }) => {
      const placed = { nodeId: "copy", start: { ticks: time.ticks }, inPoint: { ticks: "0" }, endTicks: String(originalEnd - frame) };
      Object.defineProperty(placed, "end", {
        get: () => ({ ticks: placed.endTicks }),
        set: (endTime: { ticks: string }) => { if (!endSettable) throw new Error("end is read-only"); placed.endTicks = endTime.ticks; },
      });
      copy = placed as unknown as { end: { ticks: string } };
      target.clips = { numItems: 1, 0: copy };
    } };
    let copy: { end: { ticks: string } } | undefined;
    const sequence = {
      timebase: String(frame),
      videoTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: clip } }, 1: target },
      audioTracks: { numTracks: 0 },
    };
    class Time { ticks = "0"; }
    return { context: { app: { project: { activeSequence: sequence } }, Time }, originalEnd, copy: () => copy };
  }

  it("trims a copy that lands one frame short back to the original's end", async () => {
    const host = oneFrameShortHost(true);
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, host.context))));
    const result = await timeline.duplicate_clip.handler({ node_id: "c1" });
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", endCorrected: true } });
    expect(host.copy()?.end.ticks).toBe(String(host.originalEnd));
  });

  it("reports a one-frame-short copy as committed_unverified when its end cannot be corrected", async () => {
    const host = oneFrameShortHost(false);
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, host.context))));
    const result = await timeline.duplicate_clip.handler({ node_id: "c1" });
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", timelineChanged: true } });
  });

  // Source In 19.9866 s (sequence frame 599 at 29.97). Premiere floors the
  // project-item mark to the media's frame grid, then the placed copy's
  // source in to the sequence grid, so a 23.976 copy lands at frame 598.
  const ticksPerSecond = 254016000000;
  function mediaRateHost(options: { mediaRate: number; inSettable: boolean; extraInFrames?: number }) {
    const mediaFrame = ticksPerSecond / options.mediaRate;
    const originalStart = 100 * frame;
    const originalEnd = 200 * frame;
    const originalIn = 599 * frame;
    let markIn = 0;
    const item = {
      getInPoint: () => ({ ticks: "0", seconds: 0 }),
      getOutPoint: (type: number) => type === 2 ? { ticks: "0", seconds: 0 } : { ticks: String(5000 * frame), seconds: (5000 * frame) / ticksPerSecond },
      getFootageInterpretation: () => ({ frameRate: options.mediaRate }),
      setInPoint: vi.fn((seconds: number) => { markIn = seconds; }),
      setOutPoint: vi.fn(),
    };
    const clip = { nodeId: "c1", projectItem: item, start: { ticks: String(originalStart) }, end: { ticks: String(originalEnd) }, inPoint: { ticks: String(originalIn) } };
    const target = { clips: { numItems: 0 } as Record<string, unknown>, overwriteClip: (_item: unknown, time: { ticks: string }) => {
      const mediaIn = Math.floor((markIn * ticksPerSecond) / mediaFrame + 1e-9) * mediaFrame;
      const placedIn = (Math.floor(mediaIn / frame + 1e-9) + (options.extraInFrames ?? 0)) * frame;
      const placed = { nodeId: "copy", start: { ticks: time.ticks }, end: { ticks: String(originalEnd) }, inTicks: String(placedIn), outTicks: String(placedIn + (originalEnd - originalStart)) };
      for (const [key, field] of [["inPoint", "inTicks"], ["outPoint", "outTicks"]] as const) {
        Object.defineProperty(placed, key, {
          get: () => ({ ticks: placed[field] }),
          set: (markTime: { ticks: string }) => { if (!options.inSettable) throw new Error(`${key} is read-only`); placed[field] = markTime.ticks; },
        });
      }
      copy = placed as unknown as typeof copy;
      target.clips = { numItems: 1, 0: copy };
    } };
    let copy: { inPoint: { ticks: string }; outPoint: { ticks: string } } | undefined;
    const sequence = {
      timebase: String(frame),
      videoTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: clip } }, 1: target },
      audioTracks: { numTracks: 0 },
    };
    class Time { ticks = "0"; }
    return { context: { app: { project: { activeSequence: sequence } }, Time }, item, originalIn, mediaFrame, copy: () => copy };
  }

  it("lands a 23.976 copy in a 29.97 sequence on the original's source in", async () => {
    const host = mediaRateHost({ mediaRate: 23.976, inSettable: true });
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, host.context))));
    const result = await timeline.duplicate_clip.handler({ node_id: "c1" });
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", sourceIn: { corrected: true, snappedToMediaFrame: false } } });
    expect(host.copy()?.inPoint.ticks).toBe(String(host.originalIn));
    // The written mark carries a quarter media frame so the host's floor stays on the intended media frame.
    expect(host.item.setInPoint.mock.calls[0][0]).toBeCloseTo((host.originalIn + host.mediaFrame / 4) / ticksPerSecond, 9);
    expect(host.item.setInPoint.mock.calls.at(-1)?.[0]).toBeCloseTo(1001 / 24000 / 4, 9);
    expect(host.item.setInPoint.mock.calls.at(-1)?.[1]).toBe(4);
  });

  it("keeps same-rate marks unbiased and uncorrected", async () => {
    const host = mediaRateHost({ mediaRate: 30000 / 1001, inSettable: true });
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, host.context))));
    const result = await timeline.duplicate_clip.handler({ node_id: "c1" });
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", sourceIn: { corrected: false, snappedToMediaFrame: false } } });
    expect(host.item.setInPoint.mock.calls[0][0]).toBe(host.originalIn / ticksPerSecond);
    expect(host.copy()?.inPoint.ticks).toBe(String(host.originalIn));
  });

  it.each([
    { label: "the host refuses the source in write", inSettable: false, extraInFrames: 0 },
    { label: "the copy is more than a media frame off", inSettable: true, extraInFrames: 5 },
  ])("reports requested vs applied source in as committed_unverified when $label", async ({ inSettable, extraInFrames }) => {
    const host = mediaRateHost({ mediaRate: 23.976, inSettable, extraInFrames });
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, host.context))));
    const result = await timeline.duplicate_clip.handler({ node_id: "c1" });
    const appliedIn = Number(host.copy()?.inPoint.ticks);
    expect(appliedIn).not.toBe(host.originalIn);
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", timelineChanged: true, sourceIn: {
      requestedSeconds: host.originalIn / ticksPerSecond, appliedSeconds: appliedIn / ticksPerSecond, corrected: false, snappedToMediaFrame: false,
    } } });
  });
});

describe("move_clip verification", () => {
  it.each([
    [{ new_start_seconds: Number.NaN }, "new_start_seconds"],
    [{ new_start_seconds: Number.POSITIVE_INFINITY }, "new_start_seconds"],
    [{ new_start_seconds: -1 }, "new_start_seconds"],
    [{ new_start_seconds: 5, new_track_index: -1 }, "new_track_index"],
    [{ new_start_seconds: 5, new_track_index: 1.5 }, "new_track_index"],
  ] as const)("refuses invalid generated-script numbers before dispatch", async (args, field) => {
    const result = await timeline.move_clip.handler({ node_id: "abc", ...args });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(field) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("re-finds the clip after the move rather than trusting a stale reference", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain('var after = __findClip("abc")');
    expect(script).toContain("Math.abs(actualStartTicks - newStartTicks) > frameTicks / 1000");
    expect(script).toContain("actualEndTicks / frameTicks");
    expect(script).toContain("verified: true");
  });

  it("rejects an out-of-range track index instead of silently skipping the move", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 99,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("is out of range");
    expect(script).toContain("targetTracks.numTracks");
  });

  it("attempts the track change before writing the start time, so a failure leaves no partial edit", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    const trackMoveAt = script.indexOf("qeClip.moveToTrack");
    const startWriteAt = script.indexOf("__writeClipSpan(clip, newStartTicks, newEndTicks)");
    expect(trackMoveAt).toBeGreaterThan(-1);
    expect(startWriteAt).toBeGreaterThan(-1);
    expect(trackMoveAt).toBeLessThan(startWriteAt);
    // A silent moveToTrack no-op must stop before the time write, not after it.
    const trackCheckAt = script.indexOf("afterMove.trackIndex !== 1");
    expect(trackCheckAt).toBeGreaterThan(trackMoveAt);
    expect(trackCheckAt).toBeLessThan(startWriteAt);
  });

  it("writes both timeline edges and verifies duration and source in/out (#550)", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).not.toContain("clip.start = __secondsToTicks");
    expect(script).toContain("var newEndTicks = newStartTicks + spanTicks");
    expect(script).toContain("__writeClipSpan(clip, newStartTicks, newEndTicks)");
    expect(script).toContain("visible duration changed from");
    expect(script).toContain("source in/out points changed, so the clip was trimmed or slipped rather than moved");
    // Without a track change the vacated range is safe to write back.
    expect(script).toContain("__writeClipSpan(after.clip, originalStartTicks, originalEndTicks)");
    expect(script).toContain("The clip was restored to its original timeline range.");
  });

  it("does not rewrite the original range onto the new track after a failed combined move", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5, new_track_index: 1 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).not.toContain("__writeClipSpan(after.clip, originalStartTicks, originalEndTicks)");
    expect(script).toContain("its original range is not rewritten automatically");
    // moveToTrack may corrupt end on its own; the span is re-asserted first.
    expect(script).toContain("__writeClipSpan(afterMove.clip, originalStartTicks, originalEndTicks)");
    expect(script).toContain("Premiere changed the clip duration during the track move");
  });

  it("matches the QE clip by start time because QE item indices include gaps", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain('String(cand.type) !== "Clip"');
    expect(script).not.toContain("getItemAt(result.clipIndex)");
  });

  it("verifies the clip actually landed on the requested track", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("after.trackIndex !== 1");
    expect(script).toContain("qeClip.moveToTrack(videoDelta, audioDelta, \"0\", false)");
  });

  it("does not emit any track-move code when no track change was requested", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).not.toContain("moveToTrack");
    expect(script).not.toContain("after.trackIndex !==");
  });
});

describe("razor_all_tracks verification", () => {
  it("counts tracks whose clip count actually changed, not razor attempts", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("domTrack.clips.numItems > before");
    expect(script).toContain("verified: true");
  });

  it("treats only tracks with a clip spanning the cut point as eligible", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("function __spansPoint");
    expect(script).toContain("if (v > s && v < e) return true");
    expect(script).toContain("if (wasEligible) eligible++");
  });

  it("errors when any eligible track did not split", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("eligible > 0 && razored < eligible");
    expect(script).toContain("only partially applied");
    expect(script).toContain("no-op on some Premiere Pro 26.x");
  });

  it("surfaces per-track razor exceptions rather than swallowing them", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("failures.push");
    expect(script).toContain("failures: failures");
  });
});

describe("move_clip_to_track verification", () => {
  it("matches the QE clip by start time instead of the DOM clip index", async () => {
    // getItemAt(result.clipIndex) returns an "Empty" gap on any track with a
    // leading gap, which is what made this fail with a misleading error.
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).not.toContain("getItemAt(result.clipIndex)");
    expect(script).toContain('String(cand.type) !== "Clip"');
    expect(script).toContain("Math.abs(parseFloat(cand.start.ticks) - wantStart) < 1");
  });

  it("rejects an out-of-range target track", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 99,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("is out of range");
    expect(script).toContain("targetTracks.numTracks");
  });

  it("short-circuits when the clip is already on the requested track", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("alreadyOnTrack: true");
  });

  it("confirms against the DOM rather than trusting the QE call", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain('var after = __findClip("abc")');
    expect(script).toContain("after.trackIndex !== 1");
    expect(script).toContain("verified: true");
    expect(script).toContain("qeClip.moveToTrack(videoDelta, audioDelta, \"0\", false)");
    expect(script).toContain("inverted or empty timeline range");
  });

  it("re-asserts the original span after moveToTrack and fails closed on duration or source drift (#550)", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("__writeClipSpan(after.clip, beforeMoveStartTicks, beforeMoveEndTicks)");
    expect(script).toContain("Premiere changed the clip duration during the track move");
    expect(script).toContain("Premiere changed the clip's source in/out points during the track move");
    // The span is only re-asserted once the DOM confirms the clip changed track.
    expect(script.indexOf("after.trackIndex !== 1")).toBeLessThan(script.indexOf("__writeClipSpan(after.clip"));
  });

  it("explains the QE rejection instead of surfacing a raw parameter error", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    expect(script).toContain("catch (moveErr)");
    expect(script).toContain("The clip was left untouched");
    expect(script).toContain("overwriteClip");
  });
});

describe("track creation verification", () => {
  it("rejects invalid add_track requests locally instead of generating unsafe host code", async () => {
    const result = await tracks.add_track.handler({ track_type: "audio", count: 0 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("positive integer");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("uses a bounded QE fallback only after a public add_track failure with no mutation", async () => {
    await tracks.add_track.handler({ track_type: "audio", count: 2 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];

    expect(script).toContain('typeof seq.insertAudioTrackAt !== "function"');
    expect(script).toContain("afterPublic !== expected && afterPublic !== before");
    // QE signature: (videoCount, videoInsertIndex, audioCount, audioType, audioInsertIndex, submixCount, submixType).
    expect(script).toContain("qeSeq.addTracks(0, seq.videoTracks.numTracks, 2, 1, seq.audioTracks.numTracks, 0, 0)");
    expect(script).toContain("if (after !== expected)");
    expect(script).toContain("verified: true");
  });

  it("does not report QE add_tracks success until exact video and audio count readback", async () => {
    await advanced.add_tracks.handler({
      video_tracks: 1,
      audio_tracks: 2,
      audio_mono_tracks: 1,
      audio_51_tracks: 1,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];

    expect(script).toContain("var beforeVideo = seq.videoTracks.numTracks");
    expect(script).toContain("var expectedAudio = beforeAudio + 4");
    expect(script).toContain("qeSeq.addTracks(1, seq.videoTracks.numTracks, 2, 1, seq.audioTracks.numTracks, 0, 0)");
    expect(script).toContain("qeSeq.addTracks(0, seq.videoTracks.numTracks, 1, 0, seq.audioTracks.numTracks, 0, 0)");
    expect(script).toContain("qeSeq.addTracks(0, seq.videoTracks.numTracks, 1, 2, seq.audioTracks.numTracks, 0, 0)");
    expect(script).toContain("typeof qeSeq.addTracks !== \"function\"");
    expect(script).toContain("afterVideo !== expectedVideo || afterAudio !== expectedAudio");
    expect(script).toContain("verified: !existingTracksUnlocatable");
  });

  it("rejects an empty add_tracks request locally rather than returning a successful no-op", async () => {
    const result = await advanced.add_tracks.handler({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least one");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("track state writes verify Premiere readback", () => {
  it("validates lock and visibility arguments before dispatch", async () => {
    for (const result of [
      await tracks.lock_track.handler({ track_index: -1, locked: true }),
      await tracks.lock_track.handler({ track_index: 0.5, locked: true }),
      await tracks.toggle_track_visibility.handler({ track_index: 0, visible: "yes" as never }),
      await tracks.delete_track.handler({ track_type: "subtitle", track_index: 0 }),
    ]) expect(result.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("uses Premiere's numeric mute contract and returns readback state", async () => {
    await tracks.toggle_track_visibility.handler({ track_index: 0, visible: true });
    const visibilityScript = mockedSendCommand.mock.calls[0][0];
    expect(visibilityScript).toContain("track.setMute(0)");
    expect(visibilityScript).toContain("track.isMuted()");
    expect(visibilityScript).toContain('outcome: "verified"');
    expect(visibilityScript).toContain("timelineChanged: beforeMuted !== actualMuted");

    vi.clearAllMocks();
    await tracks.toggle_track_visibility.handler({ track_index: 0, visible: false });
    expect(mockedSendCommand.mock.calls[0][0]).toContain("track.setMute(1)");
  });

  it("reports lock and visibility mismatch as not_applied or committed_unverified", async () => {
    await tracks.lock_track.handler({ track_index: 0, locked: true });
    const lockScript = mockedSendCommand.mock.calls[0][0];
    expect(lockScript).toContain("track.setLocked(1)");
    expect(lockScript).toContain("track.isLocked()");
    expect(lockScript).toContain('outcome: beforeLocked !== actualLocked ? "committed_unverified" : "not_applied"');

    vi.clearAllMocks();
    await tracks.toggle_track_visibility.handler({ track_index: 0, visible: false });
    const visibilityScript = mockedSendCommand.mock.calls[0][0];
    expect(visibilityScript).toContain('outcome: beforeMuted !== actualMuted ? "committed_unverified" : "not_applied"');
    expect(visibilityScript).toContain("actualMuted: actualMuted");
  });

  it.each([undefined, null, 0, 1, "false"])("does not verify a non-boolean post-write track state (%s)", async (postState) => {
    mockedSendCommand.mockImplementationOnce(async (script) => {
      let reads = 0;
      const track = { name: "Video 1", isLocked: () => ++reads === 1 ? true : postState, setLocked: () => {} };
      return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: { videoTracks: { numTracks: 1, 0: track } } } } })));
    });
    await expect(tracks.lock_track.handler({ track_index: 0, locked: false })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null, actualLocked: null } });

    mockedSendCommand.mockImplementationOnce(async (script) => {
      let reads = 0;
      const track = { name: "Video 1", isMuted: () => ++reads === 1 ? true : postState, setMute: () => {} };
      return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: { videoTracks: { numTracks: 1, 0: track } } } } })));
    });
    await expect(tracks.toggle_track_visibility.handler({ track_index: 0, visible: true })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null, actualMuted: null } });
  });
});

describe("overwrite_clip verification", () => {
  it("rejects invalid indices locally before they can be interpolated into ExtendScript", async () => {
    const result = await advanced.overwrite_clip.handler({
      item_id: "source-1",
      audio_track_index: -1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("audio_track_index");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("checks both target tracks before overwriting, and routes through the unused-kind helper", async () => {
    await advanced.overwrite_clip.handler({
      item_id: "source-1",
      track_index: 1,
      audio_track_index: 2,
      start_seconds: 5,
    });
    const script = mockedSendCommand.mock.calls.at(-1)[0];
    const videoCheck = script.indexOf("Video track index 1 is out of range");
    const audioCheck = script.indexOf("Audio track index 2 is out of range");
    const call = script.lastIndexOf("__overwriteItemOnRequestedTracks(seq, item, startTicks");

    expect(videoCheck).toBeGreaterThan(-1);
    expect(audioCheck).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(audioCheck);
    expect(getHelpersSource()).toContain('typeof seq.overwriteClip !== "function"');
    expect(getHelpersSource()).toContain("Track.overwriteClip is unavailable on this Premiere build");
  });

  it("proves the requested source landed on a target track and errors on no new placement", async () => {
    await advanced.overwrite_clip.handler({ item_id: "source-1", start_seconds: 5 });
    const script = mockedSendCommand.mock.calls.at(-1)[0];

    expect(script).toContain("clip.projectItem ? String(clip.projectItem.nodeId)");
    expect(script).toContain("Math.abs(actualStartTicks - wantedStartTicks) <= frameTicks");
    expect(script).toContain("if (!videoPlaced && !audioPlaced)");
    expect(script).toContain("missingVideo = videoReceives && !videoPlaced");
    expect(script).toContain("produced no verifiable new placement");
    expect(script).toContain("verified: true");
  });

  it("auto_empty places the audio on the lowest audio track that is free for the clip's duration", async () => {
    const t = (seconds: number) => String(seconds * 254016000000);
    const item = { nodeId: "nest", name: "EP1 nest", getInPoint: () => ({ ticks: "0" }), getOutPoint: () => ({ ticks: t(2) }) };
    type Clip = { projectItem: { nodeId: string }; start: { ticks: string }; end: { ticks: string } };
    const music: Clip = { projectItem: { nodeId: "bgm" }, start: { ticks: t(0) }, end: { ticks: t(20) } };
    const later: Clip = { projectItem: { nodeId: "sfx" }, start: { ticks: t(6) }, end: { ticks: t(8) } };
    const lists: Clip[][] = [[], [music], [later], []];
    const track = (clips: Clip[]) => ({ clips: new Proxy({}, { get: (_t, key) => key === "numItems" ? clips.length : clips[Number(key)] }) });
    const host = (audioLists: Clip[][]) => {
      const seq = {
        timebase: String(254016000000 / 25),
        videoTracks: Object.assign({ numTracks: 1 }, [track(lists[0])]),
        audioTracks: Object.assign({ numTracks: audioLists.length }, audioLists.map(track)),
        overwriteClip: vi.fn((_item: unknown, startTicks: string, v: number, a: number) => {
          const placed = { projectItem: item, start: { ticks: startTicks }, end: { ticks: String(Number(startTicks) + Number(t(2))) } };
          lists[v].push(placed);
          audioLists[a].push(placed);
        }),
      };
      mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        Time: class { ticks = "0"; },
        app: { project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) }, activeSequence: seq } },
      }))));
      return seq;
    };
    // A1 holds music over 0-20 s and A2 a sound effect at 6-8 s: a 2 s clip at 5 s overlaps both, so A3 is used.
    const seq = host([lists[1], lists[2], lists[3]]);
    const placed = await advanced.overwrite_clip.handler({ item_id: "nest", start_seconds: 5, audio_track_index: "auto_empty" });
    expect(placed).toMatchObject({
      success: true,
      data: { verified: true, audioTrackIndex: 2, audioTrackAutoSelected: true },
    });
    expect(mutationReceipt(placed.success, placed.data, { dispatched: true }, "overwrite_clip").outcome).toBe("verified");
    expect(seq.overwriteClip).toHaveBeenCalledWith(item, expect.any(String), 0, 2);

    host([[music]]);
    await expect(advanced.overwrite_clip.handler({ item_id: "nest", start_seconds: 5, audio_track_index: "auto_empty" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no audio track free"),
      data: { code: "NO_EMPTY_AUDIO_TRACK" },
    });
    await expect(advanced.overwrite_clip.handler({ item_id: "nest", audio_track_index: "nearest" as never }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("auto_empty") });
  });

  const ticks = (seconds: number) => String(seconds * 254016000000);
  function overwriteHost(options: { videoSpan: number; audioSpan: number; dropAudio?: boolean; dropVideo?: boolean; metadata?: string; placedInSeconds?: number }) {
    const item: Record<string, unknown> = {
      nodeId: "source-1",
      name: "CCI DAY 1.mp4",
      getInPoint: () => ({ ticks: "0" }),
      getOutPoint: (type: number) => ({ ticks: ticks(type === 2 ? options.audioSpan : options.videoSpan) }),
    };
    if (options.metadata) item.getProjectMetadata = () => options.metadata;
    const occupant = { nodeId: "keep", projectItem: { nodeId: "keep" }, start: { ticks: ticks(5) } };
    const videoClips: Array<{ nodeId: string; projectItem: { nodeId: string }; start: { ticks: string } }> = [];
    const audioClips: Array<{ nodeId: string; projectItem: { nodeId: string }; start: { ticks: string } }> = [];
    if (options.audioSpan === 0) audioClips.push(occupant);
    if (options.videoSpan === 0) videoClips.push(occupant);
    const startFrom = (time: string | { ticks: string }) => typeof time === "string" ? time : time.ticks;
    const placeOn = (clips: typeof videoClips, nodeId: string, startTicks: string) => {
      clips.push({ nodeId, projectItem: item as { nodeId: string }, start: { ticks: startTicks }, inPoint: { ticks: ticks(options.placedInSeconds ?? 0) } } as typeof videoClips[number]);
    };
    const smashOccupant = (clips: typeof videoClips) => {
      const index = clips.indexOf(occupant);
      if (index >= 0) clips.splice(index, 1);
    };
    const track = (clips: typeof videoClips, kind: "video" | "audio") => ({
      clips: new Proxy({}, {
        get: (_t, key) => key === "numItems" ? clips.length : clips[Number(key)],
      }),
      overwriteClip: (_placed: unknown, time: string | { ticks: string }) => {
        if (kind === "video" && !options.dropVideo) placeOn(videoClips, "v-copy", startFrom(time));
        if (kind === "audio" && !options.dropAudio) placeOn(audioClips, "a-copy", startFrom(time));
      },
    });
    const seqOverwrite = vi.fn((_placed: unknown, startTicks: string) => {
      smashOccupant(videoClips);
      smashOccupant(audioClips);
      if (!options.dropVideo) placeOn(videoClips, "v-copy", startTicks);
      if (!options.dropAudio) placeOn(audioClips, "a-copy", startTicks);
    });
    const seq = {
      timebase: String(254016000000 / 24),
      videoTracks: Object.assign({ numTracks: 1 }, [track(videoClips, "video")]),
      audioTracks: Object.assign({ numTracks: 1 }, [track(audioClips, "audio")]),
      overwriteClip: seqOverwrite,
    };
    class Time { ticks = "0"; }
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      Time,
      app: { project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) }, activeSequence: seq } },
    }))));
    return { videoClips, audioClips, occupant, seqOverwrite };
  }

  it("does not verify an A/V overwrite that lands picture without sound", async () => {
    overwriteHost({ videoSpan: 2, audioSpan: 2, dropAudio: true });
    await expect(advanced.overwrite_clip.handler({ item_id: "source-1", start_seconds: 5 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("audio"),
      data: { outcome: "committed_unverified", verified: false, timelineChanged: true, placedOnVideoTrack: true, placedOnAudioTrack: false, missingStreams: ["audio"] },
    });
  });

  it("still verifies a video-only item that has no audio stream", async () => {
    overwriteHost({ videoSpan: 2, audioSpan: 0, dropAudio: true });
    await expect(advanced.overwrite_clip.handler({ item_id: "source-1", start_seconds: 5 })).resolves.toMatchObject({
      success: true,
      data: { overwritten: true, verified: true, placedOnVideoTrack: true, placedOnAudioTrack: false },
    });
  });

  it.each([
    { kind: "video-only", videoSpan: 2, audioSpan: 0, smash: "audio" as const },
    { kind: "audio-only", videoSpan: 0, audioSpan: 2, smash: "video" as const },
  ])("does not overwrite $smash track 0 when overwriting a $kind item", async ({ videoSpan, audioSpan, smash }) => {
    const host = overwriteHost({ videoSpan, audioSpan, dropAudio: smash === "audio", dropVideo: smash === "video" });
    await expect(advanced.overwrite_clip.handler({ item_id: "source-1", start_seconds: 5 })).resolves.toMatchObject({
      success: true,
      data: {
        overwritten: true,
        verified: true,
        placedOnVideoTrack: smash !== "video",
        placedOnAudioTrack: smash !== "audio",
      },
    });
    expect(host.seqOverwrite).not.toHaveBeenCalled();
    expect(smash === "audio" ? host.audioClips : host.videoClips).toContain(host.occupant);
  });
});

describe("overwrite_clip reports a source In that Premiere moved to a sequence frame", () => {
  const ticks = (seconds: number) => String(Math.round(seconds * 254016000000));
  // Audio subclip stored at 112.2797 s (48 kHz samples), as created live on 26.5.2.
  const audioSubclip = `<x:xmpmeta><rdf:RDF><rdf:Description>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>48000 Hz</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.AudioInPoint rdf:parseType="Resource"><rdf:value>00:01:52:13425</rdf:value><premierePrivateProjectMetaData:frame_rate>10160640000</premierePrivateProjectMetaData:frame_rate></premierePrivateProjectMetaData:Column.Intrinsic.AudioInPoint>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.AudioOutPoint rdf:parseType="Resource"><rdf:value>00:02:00:43424</rdf:value><premierePrivateProjectMetaData:frame_rate>10160640000</premierePrivateProjectMetaData:frame_rate></premierePrivateProjectMetaData:Column.Intrinsic.AudioOutPoint>`
    + `</rdf:Description></rdf:RDF></x:xmpmeta>`;

  function audioHost(placedInSeconds: number, metadata = audioSubclip) {
    const item = {
      nodeId: "dialogue-1",
      name: "A seg1 dialogue",
      getInPoint: () => ({ ticks: "0" }),
      getOutPoint: (type: number) => ({ ticks: type === 2 ? ticks(8.625) : "0" }),
      getProjectMetadata: () => metadata,
    };
    const audioClips: unknown[] = [];
    const track = (clips: unknown[]) => ({
      clips: new Proxy({}, { get: (_t, key) => key === "numItems" ? clips.length : clips[Number(key)] }),
      overwriteClip: (_placed: unknown, time: string | { ticks: string }) => {
        if (clips === audioClips) clips.push({ projectItem: item, start: { ticks: typeof time === "string" ? time : time.ticks }, inPoint: { ticks: ticks(placedInSeconds) } });
      },
    });
    const seq = {
      timebase: String(254016000000 / 24),
      videoTracks: Object.assign({ numTracks: 1 }, [track([])]),
      audioTracks: Object.assign({ numTracks: 1 }, [track(audioClips)]),
    };
    mockedSendCommand.mockImplementationOnce(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      Time: class { ticks = "0"; },
      app: { project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) }, activeSequence: seq } },
    }))));
  }

  it("flags the 30 ms early In live 26.5.2 produced for a sample-cut audio subclip", async () => {
    audioHost(112.25);
    const result = await advanced.overwrite_clip.handler({ item_id: "dialogue-1", start_seconds: 2 });
    expect(result).toMatchObject({ success: true, data: { verified: true, placedOnAudioTrack: true, sourceInShift: { stream: "audio", placedInSeconds: 112.25 } } });
    expect(result.data.sourceInShift.storedInSeconds).toBeCloseTo(112.2796875, 6);
    expect(result.data.sourceInShift.shiftSeconds).toBeCloseTo(-0.0296875, 6);
    expect(result.data.note).toContain("30 ms earlier");
    expect(result.data.note).toContain("cannot correct a shift smaller than one frame");
    expect(advanced.overwrite_clip.description).not.toContain("corrected with slip_edit");
    expect(advanced.overwrite_clip.description).toContain("slip_edit snaps to whole sequence frames");
  });

  it("subtracts MediaStart when the stored points carry no offset child", async () => {
    // A file starting at 00:01:00 stores its In as 00:02:52:13425; without MediaStart the
    // receipt would report a bogus 60 s shift.
    const withStart = audioSubclip
      .replace("00:01:52:13425", "00:02:52:13425").replace("00:02:00:43424", "00:03:00:43424")
      .replace("</rdf:Description>", "<premierePrivateProjectMetaData:Column.Intrinsic.MediaStart>00:01:00:00000</premierePrivateProjectMetaData:Column.Intrinsic.MediaStart></rdf:Description>");
    audioHost(112.2796875, withStart);
    let result = await advanced.overwrite_clip.handler({ item_id: "dialogue-1", start_seconds: 2 });
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(result.data).not.toHaveProperty("sourceInShift");
    audioHost(112.25, withStart);
    result = await advanced.overwrite_clip.handler({ item_id: "dialogue-1", start_seconds: 2 });
    expect(result.data.sourceInShift.shiftSeconds).toBeCloseTo(-0.0296875, 6);
  });

  it("adds nothing when the placed In matches the stored In", async () => {
    audioHost(112.2796875);
    const result = await advanced.overwrite_clip.handler({ item_id: "dialogue-1", start_seconds: 2 });
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(result.data).not.toHaveProperty("sourceInShift");
    expect(result.data).not.toHaveProperty("note");
  });
});

describe("__writeClipSpan write ordering (#550)", () => {
  // Premiere rejects a start write that would pass the clip's current end and
  // never carries end along with start, so the edge order decides whether the
  // clip moves or is silently stretched/trimmed.
  function writeSpan(currentStart: number, currentEnd: number, wantedStart: number, wantedEnd: number) {
    const writes: string[] = [];
    const item = {
      _start: String(currentStart),
      _end: String(currentEnd),
      get start() { return { ticks: this._start }; },
      set start(value: unknown) { writes.push("start"); this._start = String(value); },
      get end() { return { ticks: this._end }; },
      set end(value: unknown) { writes.push("end"); this._end = String(value); },
    };
    runInNewContext(`${getHelpersSource()}\n__writeClipSpan(item, ${wantedStart}, ${wantedEnd});`, { item });
    return { writes, start: item._start, end: item._end };
  }

  it("writes end before start when moving later", () => {
    const result = writeSpan(100, 200, 500, 600);
    expect(result.writes).toEqual(["end", "start"]);
    expect(result).toMatchObject({ start: "500", end: "600" });
  });

  it("writes start before end when moving earlier or staying in place", () => {
    expect(writeSpan(500, 600, 100, 200).writes).toEqual(["start", "end"]);
    expect(writeSpan(500, 600, 500, 700).writes).toEqual(["start", "end"]);
  });

  it("refuses an inverted or empty span before touching the clip", () => {
    expect(() => writeSpan(100, 200, 300, 300)).toThrow("must end after it starts");
  });
});
