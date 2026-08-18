import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
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
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("var actualIn = after.inPoint");
    expect(script).toContain("Math.abs(actualIn - 2) > tolerance");
    expect(script).toContain("did not apply a verified timeline trim");
    expect(script).toContain("verified: true");
  });

  it("compares the read-back out point against the requested value", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("Math.abs(actualOut - 8) > tolerance");
  });

  it("only writes the edge that was actually requested", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("clip.inPoint = __secondsToTicks(2).toString();");
    expect(script).not.toContain("clip.outPoint = __secondsToTicks(2).toString();");
  });

  it("derives its tolerance from the sequence timebase so frame snapping is not a failure", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("seq.timebase");
    expect(script).toContain("TICKS_PER_SECOND / 24");
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
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("var afterResult = __findClip(\"abc\")");
    expect(script).toContain("var expectedStart = before.start");
    expect(script).toContain("var expectedEnd = before.end + (actualOut - before.outPoint)");
    expect(script).toContain("visible timeline duration does not match the applied source range");
    expect(script).toContain("source metadata may have changed, but this is not reported as success");
  });

  it("fails closed for retimed clips and unhandled out-of-range keyframes", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls[0][0];
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
    const script = mockedSendCommand.mock.calls[0][0];
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
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("function __eligibleClips");
    expect(script).toContain("if (!eligibleBefore.length)");
    expect(script).toContain("no razor was attempted");
  });

  it("verifies each left and right segment, not only a count increase", async () => {
    await timeline.split_clip.handler({ time_seconds: 4 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("var expectedClipCount = clipCountBefore + eligibleBefore.length");
    expect(script).toContain("function __hasSegment");
    expect(script).toContain("left segment");
    expect(script).toContain("right segment");
    expect(script).toContain('keyframeSemantics: "unverified"');
  });
});

describe("move_clip verification", () => {
  it("re-finds the clip after the move rather than trusting a stale reference", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('var after = __findClip("abc")');
    expect(script).toContain("Math.abs(actualStart - 5) > tolerance");
    expect(script).toContain("verified: true");
  });

  it("rejects an out-of-range track index instead of silently skipping the move", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 99,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("is out of range");
    expect(script).toContain("targetTracks.numTracks");
  });

  it("attempts the track change before writing the start time, so a failure leaves no partial edit", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    const trackMoveAt = script.indexOf("qeClip.moveToTrack");
    const startWriteAt = script.indexOf("clip.start = __secondsToTicks");
    expect(trackMoveAt).toBeGreaterThan(-1);
    expect(startWriteAt).toBeGreaterThan(-1);
    expect(trackMoveAt).toBeLessThan(startWriteAt);
  });

  it("matches the QE clip by start time because QE item indices include gaps", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('String(cand.type) !== "Clip"');
    expect(script).not.toContain("getItemAt(result.clipIndex)");
  });

  it("verifies the clip actually landed on the requested track", async () => {
    await timeline.move_clip.handler({
      node_id: "abc",
      new_start_seconds: 5,
      new_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("after.trackIndex !== 1");
  });

  it("does not emit any track-move code when no track change was requested", async () => {
    await timeline.move_clip.handler({ node_id: "abc", new_start_seconds: 5 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).not.toContain("moveToTrack");
    expect(script).not.toContain("after.trackIndex !==");
  });
});

describe("razor_all_tracks verification", () => {
  it("counts tracks whose clip count actually changed, not razor attempts", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("domTrack.clips.numItems > before");
    expect(script).toContain("verified: true");
  });

  it("treats only tracks with a clip spanning the cut point as eligible", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("function __spansPoint");
    expect(script).toContain("if (v > s && v < e) return true");
    expect(script).toContain("if (wasEligible) eligible++");
  });

  it("errors when any eligible track did not split", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("eligible > 0 && razored < eligible");
    expect(script).toContain("only partially applied");
    expect(script).toContain("no-op on some Premiere Pro 26.x");
  });

  it("surfaces per-track razor exceptions rather than swallowing them", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls[0][0];
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
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).not.toContain("getItemAt(result.clipIndex)");
    expect(script).toContain('String(cand.type) !== "Clip"');
    expect(script).toContain("Math.abs(parseFloat(cand.start.ticks) - wantStart) < 1");
  });

  it("rejects an out-of-range target track", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 99,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("is out of range");
    expect(script).toContain("targetTracks.numTracks");
  });

  it("short-circuits when the clip is already on the requested track", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("alreadyOnTrack: true");
  });

  it("confirms against the DOM rather than trusting the QE call", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('var after = __findClip("abc")');
    expect(script).toContain("after.trackIndex !== 1");
    expect(script).toContain("verified: true");
  });

  it("explains the QE rejection instead of surfacing a raw parameter error", async () => {
    await advanced.move_clip_to_track.handler({
      node_id: "abc",
      target_track_index: 1,
    });
    const script = mockedSendCommand.mock.calls[0][0];
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
    const script = mockedSendCommand.mock.calls[0][0];

    expect(script).toContain('typeof seq.insertAudioTrackAt !== "function"');
    expect(script).toContain("afterPublic !== expected && afterPublic !== before");
    expect(script).toContain("qeSeq.addTracks(0, 2, 0, 0)");
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
    const script = mockedSendCommand.mock.calls[0][0];

    expect(script).toContain("var beforeVideo = seq.videoTracks.numTracks");
    expect(script).toContain("var expectedAudio = beforeAudio + 4");
    expect(script).toContain("typeof qeSeq.addTracks !== \"function\"");
    expect(script).toContain("afterVideo !== expectedVideo || afterAudio !== expectedAudio");
    expect(script).toContain("verified: true");
  });

  it("rejects an empty add_tracks request locally rather than returning a successful no-op", async () => {
    const result = await advanced.add_tracks.handler({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least one");
    expect(mockedSendCommand).not.toHaveBeenCalled();
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

  it("checks both target tracks and host capability before calling overwriteClip", async () => {
    await advanced.overwrite_clip.handler({
      item_id: "source-1",
      track_index: 1,
      audio_track_index: 2,
      start_seconds: 5,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    const videoCheck = script.indexOf("Video track index 1 is out of range");
    const audioCheck = script.indexOf("Audio track index 2 is out of range");
    const call = script.indexOf("seq.overwriteClip(item");

    expect(videoCheck).toBeGreaterThan(-1);
    expect(audioCheck).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(audioCheck);
    expect(script).toContain('typeof seq.overwriteClip !== "function"');
  });

  it("proves the requested source landed on a target track and errors on no new placement", async () => {
    await advanced.overwrite_clip.handler({ item_id: "source-1", start_seconds: 5 });
    const script = mockedSendCommand.mock.calls[0][0];

    expect(script).toContain("clip.projectItem ? String(clip.projectItem.nodeId)");
    expect(script).toContain("Math.abs(actualStartTicks - wantedStartTicks) <= frameTicks");
    expect(script).toContain("if (!videoPlaced && !audioPlaced)");
    expect(script).toContain("produced no verifiable new placement");
    expect(script).toContain("verified: true");
  });
});
