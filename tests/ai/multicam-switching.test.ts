import { describe, expect, it } from "vitest";
import { planMulticamAngleSwitches, type AngleCut } from "../../src/ai/multicam-switching.js";

const SEGMENTS = [
  { speaker: "Alice", start_seconds: 0, end_seconds: 8 },
  { speaker: "Bob", start_seconds: 8, end_seconds: 14 },
  { speaker: "Alice", start_seconds: 13.5, end_seconds: 20 }, // crosstalk 13.5..14
  { speaker: "Bob", start_seconds: 20.4, end_seconds: 21 }, // 0.6s interjection
  { speaker: "Alice", start_seconds: 21, end_seconds: 30 },
  { speaker: "Bob", start_seconds: 32, end_seconds: 60 },
];

const CAMERAS = [
  { camera_id: "A", speakers: ["Alice"], video_track_index: 1 },
  { camera_id: "B", speakers: ["Bob"], video_track_index: 2 },
  { camera_id: "W", role: "wide", video_track_index: 0, label: "Wide" },
];

function contiguous(cuts: AngleCut[]) {
  for (let index = 1; index < cuts.length; index++) expect(cuts[index].start_seconds).toBe(cuts[index - 1].end_seconds);
  for (let index = 1; index < cuts.length; index++) expect(cuts[index].camera_id).not.toBe(cuts[index - 1].camera_id);
}

describe("planMulticamAngleSwitches", () => {
  it("validates inputs", () => {
    expect(() => planMulticamAngleSwitches({ speaker_segments: [], cameras: CAMERAS })).toThrow(/speaker_segments/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: [] })).toThrow(/cameras/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: [{ speaker: "A", start_seconds: 5, end_seconds: 5 }], cameras: CAMERAS })).toThrow(/greater than start/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: [{ camera_id: "A" }, { camera_id: "A" }] })).toThrow(/duplicated/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: [{ camera_id: "A", video_track_index: 1 }, { camera_id: "B", video_track_index: 1 }] })).toThrow(/used by another camera/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS, cutaway_every_seconds: 10, cutaway_seconds: 12 })).toThrow(/shorter than cutaway_every_seconds/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS, min_hold_seconds: 3, cutaway_every_seconds: 10, cutaway_seconds: 2 })).toThrow(/at least min_hold_seconds/);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: [{ camera_id: "A", role: "handheld" }] })).toThrow(/role/);
  });

  it("follows the active speaker, covers crosstalk, absorbs short holds, and holds through silence", () => {
    const plan = planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS, frame_rate: 25, min_hold_seconds: 2, overlap_min_seconds: 0.4 });
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.duration_seconds).toBe(60);
    contiguous(plan.cuts);
    expect(plan.cuts[0]).toMatchObject({ camera_id: "A", start_seconds: 0, reason: "speaker" });
    expect(plan.cuts[1]).toMatchObject({ camera_id: "B", start_seconds: 8 });
    // The 0.5s crosstalk is below min_hold, so no wide cover survives as its own cut...
    expect(plan.cuts.some((cut) => cut.reason === "overlap_cover")).toBe(false);
    expect(plan.stats.overlap_cover_count).toBe(1);
    // ...and Bob's 0.6s interjection at 20.4 is absorbed into Alice's hold.
    const bobInterjection = plan.cuts.find((cut) => cut.camera_id === "B" && cut.start_seconds >= 20 && cut.start_seconds < 21);
    expect(bobInterjection).toBeUndefined();
    expect(plan.warnings.some((warning) => warning.includes("absorbed"))).toBe(true);
    // Silence from 30..32 stays on the previous camera and merges into it.
    const alice2 = plan.cuts.find((cut) => cut.camera_id === "A" && cut.start_seconds <= 21 && cut.end_seconds >= 30)!;
    expect(alice2.end_seconds).toBe(32);
    expect(plan.cuts[plan.cuts.length - 1]).toMatchObject({ camera_id: "B", end_seconds: 60 });
    expect(plan.cuts.every((cut) => cut.duration_seconds >= 2 - 1e-9)).toBe(true);
    expect(plan.cuts.every((cut) => Math.abs(cut.start_seconds * 25 - Math.round(cut.start_seconds * 25)) < 1e-6)).toBe(true);
    expect(plan.switch_times_seconds).toEqual(plan.cuts.slice(1).map((cut) => cut.start_seconds));
    expect(plan.razor_plan.times_seconds).toEqual(plan.switch_times_seconds);
    expect(plan.markers).toHaveLength(plan.cuts.length);
    expect(plan.markers[0].name).toBe("A · Alice");
    expect(plan.cameras.find((camera) => camera.camera_id === "W")!.cut_count).toBe(0);
    expect(plan.warnings.some((warning) => warning.includes("'W' is never on air"))).toBe(true);
    const onAir = plan.cameras.reduce((sum, camera) => sum + camera.on_air_seconds, 0);
    expect(onAir).toBeCloseTo(60, 3);
    const enableA = plan.enable_plan.find((entry) => entry.camera_id === "A")!;
    expect(enableA.video_track_index).toBe(1);
    expect(enableA.enabled_ranges.length + enableA.disabled_ranges.length).toBe(plan.cuts.length);
    expect(plan.routes).toContain("razor_all_tracks");
    expect(plan.apply_steps[0]).toContain("create_sequence_checkpoint");
  });

  it("uses a two-shot for longer crosstalk and leads the incoming speaker", () => {
    const segments = [
      { speaker: "Alice", start_seconds: 0, end_seconds: 10 },
      { speaker: "Bob", start_seconds: 7, end_seconds: 20 },
      { speaker: "Alice", start_seconds: 25, end_seconds: 40 },
    ];
    const cameras = [
      { camera_id: "A", speakers: ["Alice"] },
      { camera_id: "B", speakers: ["Bob"] },
      { camera_id: "AB", speakers: ["Alice", "Bob"] },
    ];
    const plan = planMulticamAngleSwitches({ speaker_segments: segments, cameras, min_hold_seconds: 1, lead_switch_seconds: 0.5, frame_rate: 30 });
    contiguous(plan.cuts);
    const cover = plan.cuts.find((cut) => cut.reason === "overlap_cover")!;
    expect(cover.camera_id).toBe("AB");
    expect(cover.start_seconds).toBe(7);
    // Bob's single is led by half a second as Alice finishes.
    expect(cover.end_seconds).toBe(9.5);
    expect(plan.cameras.find((camera) => camera.camera_id === "AB")!.role).toBe("two_shot");
    const leads = plan.cuts.filter((cut) => cut.reason === "lead_in");
    expect(leads.map((cut) => [cut.camera_id, cut.start_seconds])).toEqual([["B", 9.5], ["A", 24.5]]);
    // Silence 20..25 holds on B until Alice's led return.
    expect(plan.cuts.find((cut) => cut.camera_id === "B" && cut.start_seconds === 9.5)!.end_seconds).toBe(24.5);
  });

  it("inserts cover cutaways during long monologues", () => {
    const plan = planMulticamAngleSwitches({
      speaker_segments: [{ speaker: "Host", start_seconds: 0, end_seconds: 120 }],
      cameras: [{ camera_id: "H", speakers: ["Host"] }, { camera_id: "W", role: "wide" }],
      min_hold_seconds: 2,
      cutaway_every_seconds: 30,
      cutaway_seconds: 3,
    });
    contiguous(plan.cuts);
    const cutaways = plan.cuts.filter((cut) => cut.reason === "cutaway");
    expect(cutaways.length).toBe(plan.stats.cutaway_count);
    expect(cutaways.length).toBeGreaterThanOrEqual(3);
    expect(cutaways.every((cut) => cut.camera_id === "W" && cut.duration_seconds === 3)).toBe(true);
    expect(cutaways[0].start_seconds).toBe(30);
    expect(plan.cuts[0]).toMatchObject({ camera_id: "H", start_seconds: 0, end_seconds: 30 });
    expect(plan.cuts[plan.cuts.length - 1].end_seconds).toBe(120);
  });

  it("falls back for unmapped speakers and warns", () => {
    const plan = planMulticamAngleSwitches({
      speaker_segments: [
        { speaker: "Alice", start_seconds: 0, end_seconds: 10 },
        { speaker: "Guest", start_seconds: 10, end_seconds: 20 },
      ],
      cameras: [{ camera_id: "A", speakers: ["Alice"] }, { camera_id: "W", role: "wide" }],
    });
    expect(plan.stats.unmapped_speakers).toEqual(["Guest"]);
    expect(plan.cuts[1]).toMatchObject({ camera_id: "W", reason: "unmapped_speaker_fallback" });
    expect(plan.warnings.some((warning) => warning.includes("Guest"))).toBe(true);
  });

  it("respects start and total duration bounds", () => {
    const plan = planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS, start_seconds: 10, total_duration_seconds: 40 });
    expect(plan.cuts[0].start_seconds).toBe(10);
    expect(plan.cuts[plan.cuts.length - 1].end_seconds).toBe(40);
    expect(() => planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS, start_seconds: 50, total_duration_seconds: 40 })).toThrow(/greater than start_seconds/);
  });

  it("is deterministic", () => {
    const first = planMulticamAngleSwitches({ speaker_segments: SEGMENTS, cameras: CAMERAS });
    const second = planMulticamAngleSwitches({ speaker_segments: [...SEGMENTS].reverse(), cameras: CAMERAS });
    expect(second.cuts).toEqual(first.cuts);
  });
});
