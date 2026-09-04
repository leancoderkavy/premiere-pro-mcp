import { describe, expect, it, vi } from "vitest";
import { buildCaptionTimingPlan, parseCaptionArtifact } from "../src/ai/caption-timing.js";

vi.mock("../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { getCaptionTools } from "../src/tools/captions.js";

const SRT = `1
00:00:00,000 --> 00:00:02,000
Opening

2
00:00:05,000 --> 00:00:07,000
Middle

3
00:00:08,000 --> 00:00:10,000
Ending`;

describe("caption timing plans", () => {
  it("parses bounded SRT and VTT artifacts without exposing cue text in the plan", () => {
    const srt = parseCaptionArtifact(SRT, "srt");
    const vtt = parseCaptionArtifact(`WEBVTT

00:00:00.000 --> 00:00:02.000 align:start
Opening`, "vtt");
    expect(srt.cues).toHaveLength(3);
    expect(vtt.cues).toEqual([{ startSeconds: 0, endSeconds: 2 }]);

    const plan = buildCaptionTimingPlan(SRT, "srt", { targetDurationSeconds: 10 });
    expect(plan).toMatchObject({
      status: "aligned",
      applied: false,
      cueCount: 3,
      correction: { proposed: false, kind: "none" },
    });
    expect(JSON.stringify(plan)).not.toContain("Opening");
  });

  it("proposes only a safe constant-offset correction", () => {
    const plan = buildCaptionTimingPlan(SRT, "srt", {
      observedOffsetSeconds: -1,
      targetDurationSeconds: 11,
    });
    expect(plan).toMatchObject({
      status: "constant_offset",
      correction: { kind: "shift", shiftSeconds: 1, scale: 1, proposed: true },
    });
    expect(plan.samples.at(-1)).toMatchObject({
      before: { endSeconds: 10 },
      after: { endSeconds: 11 },
    });
  });

  it("requires explicit authorization before proposing proportional drift correction", () => {
    const withheld = buildCaptionTimingPlan(SRT, "srt", { targetDurationSeconds: 12 });
    expect(withheld).toMatchObject({ status: "review_required", correction: { proposed: false, kind: "none" } });

    const planned = buildCaptionTimingPlan(SRT, "srt", {
      targetDurationSeconds: 12,
      allowProportionalScaling: true,
    });
    expect(planned).toMatchObject({
      status: "proportional_drift",
      correction: { kind: "scale", proposed: true, scale: 1.2 },
    });
    expect(planned.samples.at(-1)).toMatchObject({ after: { endSeconds: 12 } });
  });

  it("rejects invalid timing, overlap, and unsafe leading negative correction", () => {
    expect(() => parseCaptionArtifact("1\n00:00:02,000 --> 00:00:01,000\nBad", "srt"))
      .toThrow("must end after");
    expect(() => parseCaptionArtifact("1\n00:00:00,000 --> 00:00:02,000\nA\n\n2\n00:00:01,000 --> 00:00:03,000\nB", "srt"))
      .toThrow("overlaps");
    expect(() => parseCaptionArtifact("00:00:00,000 --> later\nBad", "srt"))
      .toThrow("invalid timecode");

    const unsafe = buildCaptionTimingPlan(SRT, "srt", { observedOffsetSeconds: 1 });
    expect(unsafe).toMatchObject({ status: "review_required", correction: { proposed: false, shiftSeconds: 0 } });
  });
});

describe("guided lecture-caption action", () => {
  it("returns a local review plan with separate structural, playback, and rendered-output states", async () => {
    const tool = getCaptionTools({}).create_caption_track as any;
    const result = await tool.handler({
      action: "plan_lecture_workflow",
      caption_content: SRT,
      artifact_format: "srt",
      target_duration_seconds: 10,
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        applied: false,
        workflow: {
          id: "guided_lecture_caption_workflow",
          appliesCaptionArtifact: false,
          verification: {
            structuralReadback: "not_run",
            playbackReview: "not_run",
            renderedOutputReview: "not_run",
          },
        },
      },
    });
    expect(result.data.workflow.steps.map((step: { route: string }) => step.route)).toEqual([
      "manage_sequences_uxp",
      "create_caption_track",
      "create_caption_track",
      "read_sequence_captions",
      "export_sequence_review_frames",
    ]);
  });

  it("preserves import behavior and rejects an import without its project item", async () => {
    const tool = getCaptionTools({}).create_caption_track as any;
    await expect(tool.handler({})).resolves.toMatchObject({ success: false, error: expect.stringContaining("item_id") });
  });
});
