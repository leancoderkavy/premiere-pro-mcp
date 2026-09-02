import { describe, expect, it } from "vitest";
import { planDerivedSilenceRemoval } from "../../src/tools/silence-removal.js";

describe("derived silence-removal planner", () => {
  it.each([24000 / 1001, 30000 / 1001, 60000 / 1001])("snaps removal inward at %s fps", (frameRate) => {
    const plan = planDerivedSilenceRemoval({ durationSeconds: 10, frameRate, silenceRanges: [{ startSeconds: 1.001, endSeconds: 2.009 }] });
    expect(plan.removalRanges).toEqual([{ startFrame: Math.ceil(1.001 * frameRate - 1e-7), endFrame: Math.floor(2.009 * frameRate + 1e-7) }]);
    expect(plan.keptFrames + plan.removedFrames).toBe(plan.totalFrames);
  });

  it("merges overlapping frame ranges and retains requested handles", () => {
    const plan = planDerivedSilenceRemoval({ durationSeconds: 6, frameRate: 30, keepHandleFrames: 2, silenceRanges: [
      { startSeconds: 1, endSeconds: 3 }, { startSeconds: 2.8, endSeconds: 4 },
    ] });
    expect(plan.removalRanges).toEqual([{ startFrame: 32, endFrame: 118 }]);
    expect(plan.keepRanges).toEqual([{ startFrame: 0, endFrame: 32 }, { startFrame: 118, endFrame: 180 }]);
  });

  it("merges snapped overlapping silences before applying outer handles", () => {
    const plan = planDerivedSilenceRemoval({ durationSeconds: 10, frameRate: 30, keepHandleFrames: 10, silenceRanges: [
      { startSeconds: 0, endSeconds: 5 }, { startSeconds: 4.5, endSeconds: 10 },
    ] });
    expect(plan.removalRanges).toEqual([{ startFrame: 10, endFrame: 290 }]);
    expect(plan.keepRanges).toEqual([{ startFrame: 0, endFrame: 10 }, { startFrame: 290, endFrame: 300 }]);
  });

  it("merges snapped overlapping silences before applying outer handles", () => {
    const plan = planDerivedSilenceRemoval({ durationSeconds: 10, frameRate: 30, keepHandleFrames: 10, silenceRanges: [
      { startSeconds: 0, endSeconds: 5 }, { startSeconds: 4.5, endSeconds: 10 },
    ] });
    expect(plan.removalRanges).toEqual([{ startFrame: 10, endFrame: 290 }]);
    expect(plan.keepRanges).toEqual([{ startFrame: 0, endFrame: 10 }, { startFrame: 290, endFrame: 300 }]);
  });

  it("refuses invalid, truncated, and all-silence plans", () => {
    expect(() => planDerivedSilenceRemoval({ durationSeconds: 1, frameRate: 30, silenceRanges: [{ startSeconds: 0, endSeconds: 1 }] })).toThrow("entire source");
    expect(() => planDerivedSilenceRemoval({ durationSeconds: 10, frameRate: 30, maximumRemovals: 1, silenceRanges: [
      { startSeconds: 1, endSeconds: 2 }, { startSeconds: 3, endSeconds: 4 },
    ] })).toThrow("maximumRemovals");
    expect(() => planDerivedSilenceRemoval({ durationSeconds: 2, frameRate: 30, silenceRanges: [{ startSeconds: -1, endSeconds: 1 }] })).toThrow("outside");
  });
});
