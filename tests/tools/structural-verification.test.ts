import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test", timeoutMs: 1000 };
const timeline = getTimelineTools(bridgeOptions);
const trackTargeting = getTrackTargetingTools(bridgeOptions);
const advanced = getAdvancedTools(bridgeOptions);

beforeEach(() => vi.clearAllMocks());

describe("trim_clip verification", () => {
  it("refuses a call with neither edit point instead of reporting a no-op as success", async () => {
    const result = await timeline.trim_clip.handler({ node_id: "abc" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("new_in_seconds");
    // The bridge must not be touched at all — there is nothing to apply.
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("compares the read-back in point against the requested value", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("var actualIn = __ticksToSeconds(clip.inPoint.ticks)");
    expect(script).toContain("Math.abs(actualIn - 2) > tolerance");
    expect(script).toContain("did not apply the requested trim");
    expect(script).toContain("verified: true");
  });

  it("compares the read-back out point against the requested value", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_out_seconds: 8 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("Math.abs(actualOut - 8) > tolerance");
  });

  it("only checks the edit points that were actually requested", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("Math.abs(actualIn - 2)");
    expect(script).not.toContain("Math.abs(actualOut -");
  });

  it("derives its tolerance from the sequence timebase so frame snapping is not a failure", async () => {
    await timeline.trim_clip.handler({ node_id: "abc", new_in_seconds: 2 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("seq.timebase");
    expect(script).toContain("TICKS_PER_SECOND / 24");
    expect(script).toContain("var tolerance = __ticksToSeconds(frameTicks)");
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

  it("errors only when eligible tracks existed and nothing split", async () => {
    await trackTargeting.razor_all_tracks.handler({ time_seconds: 7 });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("eligible > 0 && razored === 0");
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
