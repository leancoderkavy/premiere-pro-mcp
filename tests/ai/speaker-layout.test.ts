import { describe, expect, it } from "vitest";
import { framingForRegion, planActiveSpeakerReframe, planSpeakerCheckerboard, speakerTurns, UNKNOWN_SPEAKER } from "../../src/ai/speaker-layout.js";
import type { TranscriptWord } from "../../src/ai/word-timeline.js";

const revision = `sha256:${"a".repeat(64)}`;

function word(text: string, start: number, end: number, speaker?: string): TranscriptWord {
  return speaker ? { text, start_seconds: start, end_seconds: end, speaker_label: speaker } : { text, start_seconds: start, end_seconds: end };
}

function timeline(words: TranscriptWord[]) {
  return { source_project_item_id: "clip-1", transcript_revision: revision, words };
}

/** A: 0-3s, B: 3-6s, A: 6-9s. */
const abaWords = [word("hi", 0, 1, "A"), word("there", 1, 3, "A"), word("yes", 3, 6, "B"), word("okay", 6, 9, "A")];
const source1080 = { width: 1920, height: 1080 };
const regionsAB = [
  { speaker_label: "A", x: 0.6, y: 0.2, width: 0.2, height: 0.4 },
  { speaker_label: "B", x: 0.1, y: 0.2, width: 0.2, height: 0.4 },
];

describe("speakerTurns", () => {
  it("merges consecutive words by speaker", () => {
    const result = speakerTurns(abaWords);
    expect(result.turns.map((turn) => [turn.speaker_label, turn.start_seconds, turn.end_seconds, turn.word_count])).toEqual([["A", 0, 3, 2], ["B", 3, 6, 1], ["A", 6, 9, 1]]);
    expect(result.speakers).toEqual(["A", "B"]);
    expect(result.absorbed_count).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("absorbs short interior interjections into the surrounding speaker", () => {
    const words = [word("so", 0, 2, "A"), word("yeah", 2, 2.3, "B"), word("anyway", 2.3, 5, "A")];
    const result = speakerTurns(words, { min_turn_seconds: 0.8 });
    expect(result.turns).toEqual([{ speaker_label: "A", start_seconds: 0, end_seconds: 5, word_count: 3, absorbed_word_count: 1 }]);
    expect(result.absorbed_count).toBe(1);
    expect(result.warnings[0]).toMatch(/1 interjection/);
  });

  it("absorbs a short turn between different speakers into the preceding speaker", () => {
    const words = [word("so", 0, 2, "A"), word("mm", 2, 2.3, "C"), word("right", 2.3, 5, "B")];
    const result = speakerTurns(words);
    expect(result.turns.map((turn) => [turn.speaker_label, turn.start_seconds, turn.end_seconds])).toEqual([["A", 0, 2.3], ["B", 2.3, 5]]);
  });

  it("keeps short turns at the boundaries", () => {
    const words = [word("hey", 0, 0.3, "B"), word("so", 0.3, 3, "A"), word("bye", 3, 3.2, "B")];
    const result = speakerTurns(words);
    expect(result.turns.map((turn) => turn.speaker_label)).toEqual(["B", "A", "B"]);
    expect(result.absorbed_count).toBe(0);
  });

  it("splits same-speaker words separated by more than merge_gap_seconds", () => {
    const words = [word("one", 0, 1, "A"), word("two", 3, 4, "A")];
    expect(speakerTurns(words, { merge_gap_seconds: 0.5 }).turns).toHaveLength(2);
    expect(speakerTurns(words, { merge_gap_seconds: 2.5 }).turns).toHaveLength(1);
  });

  it("assigns unlabelled words to the unknown speaker and warns", () => {
    const words = [word("hi", 0, 2, "A"), word("mystery", 2, 5)];
    const result = speakerTurns(words);
    expect(result.turns.map((turn) => turn.speaker_label)).toEqual(["A", UNKNOWN_SPEAKER]);
    expect(result.speakers).toEqual(["A", UNKNOWN_SPEAKER]);
    expect(result.unknown_word_count).toBe(1);
    expect(result.warnings[0]).toMatch(/no speaker_label/);
  });

  it("requires at least one labelled speaker", () => {
    expect(() => speakerTurns([word("a", 0, 1), word("b", 1, 2)])).toThrow(/at least one word with speaker_label/);
    expect(() => speakerTurns([])).toThrow(/at least one word/);
  });

  it("validates options", () => {
    expect(() => speakerTurns(abaWords, { min_turn_seconds: 0.1 })).toThrow(/min_turn_seconds/);
    expect(() => speakerTurns(abaWords, { merge_gap_seconds: -1 })).toThrow(/merge_gap_seconds/);
  });
});

describe("planSpeakerCheckerboard", () => {
  it("assigns one track per speaker and pads segments with clamped handles", () => {
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(abaWords), frame_rate: 30, handle_frames: 3 });
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.evidence).toMatchObject({ source_project_item_id: "clip-1", transcript_revision: revision, word_count: 4 });
    expect(plan.speakers).toEqual([
      { label: "A", track_index: 0, audio_track_index: 0, turn_count: 2, total_seconds: 6 },
      { label: "B", track_index: 1, audio_track_index: 1, turn_count: 1, total_seconds: 3 },
    ]);
    // Turns touch, so the handle cannot extend past the shared boundary (midpoint of a zero gap).
    expect(plan.segments.map((segment) => [segment.speaker_label, segment.start_frame, segment.end_frame, segment.video_track_index, segment.requires_move])).toEqual([
      ["A", 0, 90, 0, false],
      ["B", 90, 180, 1, true],
      ["A", 180, 273, 0, false],
    ]);
    expect(plan.split_points_seconds).toEqual([3, 6, 9.1]);
    expect(plan.tracks_to_add).toEqual({ video: 1, audio: 1 });
    expect(plan.routes.map((route) => route.tool)).toEqual(["get_sequence_structure", "add_track", "razor_all_tracks", "move_clip_to_track"]);
    expect(plan.alternative_routes.map((route) => route.tool)).toEqual(["edit_timeline_uxp", "transform_track_item_uxp", "create_sequence_from_clips"]);
  });

  it("splits gaps between turns at the midpoint when handles would overlap", () => {
    const words = [word("a", 0, 2, "A"), word("b", 2.1, 4, "B")];
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(words), frame_rate: 10, handle_frames: 2 });
    // gap 0.1s, handle 0.2s -> both segments meet at 2.05s, which snaps to frame 21 (2.1s) for both.
    expect(plan.segments[0].end_frame).toBe(plan.segments[1].start_frame);
    expect(plan.segments[0].end_frame).toBe(21);
  });

  it("pads outward into gaps wider than two handles", () => {
    const words = [word("a", 1, 2, "A"), word("b", 4, 5, "B")];
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(words), frame_rate: 10, handle_frames: 2 });
    expect(plan.segments.map((segment) => [segment.start_seconds, segment.end_seconds])).toEqual([[0.8, 2.2], [3.8, 5.2]]);
    expect(plan.split_points_seconds).toEqual([0.8, 2.2, 3.8, 5.2]);
  });

  it("never pads the first segment below zero", () => {
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(abaWords), handle_frames: 24 });
    expect(plan.segments[0].start_seconds).toBe(0);
  });

  it("alternates two tracks when track_per_speaker is false", () => {
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(abaWords), track_per_speaker: false, base_video_track_index: 2, base_audio_track_index: 3 });
    expect(plan.layout_mode).toBe("alternating");
    expect(plan.segments.map((segment) => [segment.video_track_index, segment.audio_track_index])).toEqual([[2, 3], [3, 4], [2, 3]]);
    expect(plan.speakers.every((speaker) => speaker.track_index === null)).toBe(true);
    expect(plan.tracks_to_add).toEqual({ video: 1, audio: 1 });
  });

  it("honours speaker_order and reserves slots for unused labels", () => {
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(abaWords), speaker_order: ["Guest", "B"] });
    expect(plan.speakers.map((speaker) => [speaker.label, speaker.track_index])).toEqual([["Guest", 0], ["B", 1], ["A", 2]]);
    expect(plan.tracks_to_add).toEqual({ video: 2, audio: 2 });
    expect(plan.warnings.join(" ")).toMatch(/Guest/);
    expect(plan.warnings.join(" ")).toMatch(/appended.*A/);
    expect(plan.segments.filter((segment) => segment.speaker_label === "A").every((segment) => segment.video_track_index === 2 && segment.requires_move)).toBe(true);
  });

  it("puts the unknown speaker on the last slot with a warning", () => {
    const plan = planSpeakerCheckerboard({ word_timeline: timeline([word("hi", 0, 2, "A"), word("who", 2, 5)]) });
    expect(plan.speakers.map((speaker) => speaker.label)).toEqual(["A", UNKNOWN_SPEAKER]);
    expect(plan.warnings.some((warning) => warning.includes("no speaker_label"))).toBe(true);
  });

  it("counts absorbed interjections", () => {
    const words = [word("so", 0, 2, "A"), word("yeah", 2, 2.3, "B"), word("anyway", 2.3, 5, "A")];
    const plan = planSpeakerCheckerboard({ word_timeline: timeline(words) });
    expect(plan.statistics.absorbed_interjections).toBe(1);
    expect(plan.segments).toHaveLength(1);
    expect(plan.speakers.find((speaker) => speaker.label === "B")?.turn_count).toBe(0);
  });

  it("is deterministic and sensitive to options", () => {
    const first = planSpeakerCheckerboard({ word_timeline: timeline(abaWords) });
    const second = planSpeakerCheckerboard({ word_timeline: timeline(abaWords) });
    expect(first).toEqual(second);
    expect(planSpeakerCheckerboard({ word_timeline: timeline(abaWords), handle_frames: 5 }).plan_revision).not.toBe(first.plan_revision);
  });

  it("rejects invalid input", () => {
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline(abaWords), bogus: 1 })).toThrow(/unknown field/);
    expect(() => planSpeakerCheckerboard({ word_timeline: { ...timeline(abaWords), transcript_revision: "nope" } })).toThrow(/sha256/);
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline(abaWords), handle_frames: 2.5 })).toThrow(/integer/);
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline(abaWords), frame_rate: 0 })).toThrow(/frame_rate/);
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline(abaWords), track_per_speaker: "yes" })).toThrow(/boolean/);
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline(abaWords), speaker_order: ["A", "A"] })).toThrow(/duplicate/);
    expect(() => planSpeakerCheckerboard({ word_timeline: timeline([word("x", 0, 1)]) })).toThrow(/speaker_label/);
  });
});

describe("framingForRegion", () => {
  it("matches the documented crop/scale/position formula for a 1080p source and 9:16 target", () => {
    // region px: rx=1152 ry=216 rw=384 rh=432; aspect 0.5625
    // ch = max(432/0.88 = 490.909, 384/0.5625 = 682.667) = 682.667 -> cw = 384
    // top = 216 - 0.12*682.667 = 134.08; left = 1152 + 192 - 192 = 1152
    // scale = 1920/682.667*100 = 281.25
    // crop centre = (1344, 475.413); pos.x = 540 - (1344-960)*2.8125 = -540; pos.y = 960 - (475.413-540)*2.8125 = 1141.65
    const framing = framingForRegion(regionsAB[0], source1080, 1080 / 1920, 0.12, 1920, { x: 540, y: 960 });
    expect(framing.crop_source_px).toEqual({ left: 1152, top: 134.08, width: 384, height: 682.667 });
    expect(framing.scale_percent).toBe(281.25);
    expect(framing.position).toEqual({ x: -540, y: 1141.65 });
    expect(framing.crop_percent).toEqual({ left: 60, top: 12.4148, right: 20, bottom: 24.3753 });
    expect(framing.region_fits).toBe(true);
  });

  it("clamps the crop inside the source frame and flags oversized regions", () => {
    const framing = framingForRegion({ speaker_label: "wide", x: 0, y: 0, width: 1, height: 1 }, source1080, 1080 / 1920, 0.12, 1920, { x: 540, y: 960 });
    expect(framing.crop_source_px.height).toBe(1080);
    expect(framing.crop_source_px.width).toBe(607.5);
    expect(framing.crop_source_px.top).toBe(0);
    expect(framing.region_fits).toBe(false);
  });
});

describe("planActiveSpeakerReframe", () => {
  const base = { word_timeline: timeline(abaWords), source_frame: source1080, speaker_regions: regionsAB };

  it("emits hold keyframes per switch with the documented Motion values", () => {
    const plan = planActiveSpeakerReframe({ ...base, layout: "active_speaker", switch_lead_seconds: 0.2 });
    expect(plan.layout).toBe("active_speaker");
    expect(plan.applied).toBe(false);
    expect(plan.switches).toEqual([
      { time_seconds: 0, frame: 0, speaker_label: "A", reason: "initial" },
      { time_seconds: 2.8, frame: 84, speaker_label: "B", reason: "turn_start" },
      { time_seconds: 5.8, frame: 174, speaker_label: "A", reason: "turn_start" },
    ]);
    expect(plan.keyframes).toHaveLength(6);
    expect(plan.keyframes[0]).toEqual({ time_seconds: 0, frame: 0, property: "Scale", value: 281.25, interpolation: "hold" });
    expect(plan.keyframes[1]).toEqual({ time_seconds: 0, frame: 0, property: "Position", value: { x: -540, y: 1141.65 }, interpolation: "hold" });
    expect(plan.keyframes[3]).toEqual({ time_seconds: 2.8, frame: 84, property: "Position", value: { x: 2160, y: 1141.65 }, interpolation: "hold" });
    expect(plan.coverage).toEqual({ seconds_by_speaker: { A: 6, B: 3 }, duration_seconds: 9 });
    expect(plan.routes?.map((route) => route.tool)).toEqual(["create_sequence_from_preset", "set_clip_scale", "set_clip_position", "add_keyframe"]);
    expect(plan.alternative_routes.map((route) => route.tool)).toEqual(["automate_effect_parameters_uxp", "auto_reframe_sequence"]);
    expect(plan.assumptions.join(" ")).toMatch(/static/);
  });

  it("applies the switch lead and never switches before zero", () => {
    const plan = planActiveSpeakerReframe({ ...base, layout: "active_speaker", switch_lead_seconds: 1, frame_rate: 10 });
    expect(plan.switches.map((sw) => sw.time_seconds)).toEqual([0, 2, 5]);
    const early = planActiveSpeakerReframe({ ...base, word_timeline: timeline([word("a", 0, 0.2, "A"), word("b", 0.2, 5, "B")]), layout: "active_speaker", switch_lead_seconds: 1, min_hold_seconds: 0.5 });
    expect(early.switches.map((sw) => [sw.time_seconds, sw.speaker_label, sw.reason])).toEqual([[0, "A", "initial"], [0.5, "B", "delayed_for_min_hold"]]);
  });

  it("absorbs turns shorter than min_hold_seconds", () => {
    const words = [word("so", 0, 3, "A"), word("yeah", 3, 3.4, "B"), word("anyway", 3.4, 6, "A")];
    const plan = planActiveSpeakerReframe({ ...base, word_timeline: timeline(words), layout: "active_speaker", min_hold_seconds: 1.5 });
    expect(plan.switches).toEqual([{ time_seconds: 0, frame: 0, speaker_label: "A", reason: "initial" }]);
    expect(plan.absorbed_turns).toBe(1);
    expect(plan.keyframes).toHaveLength(2);
  });

  it("delays or drops switches that would violate the hold time at the start", () => {
    const words = [word("hey", 0, 1, "A"), word("long", 1, 6, "B")];
    const delayed = planActiveSpeakerReframe({ ...base, word_timeline: timeline(words), layout: "active_speaker", min_hold_seconds: 2, switch_lead_seconds: 0 });
    expect(delayed.switches.map((sw) => [sw.time_seconds, sw.speaker_label, sw.reason])).toEqual([[0, "A", "initial"], [2, "B", "delayed_for_min_hold"]]);
    // B's delayed switch (2s) would leave only 0.2s before C starts, so B keeps A's framing.
    const sliver = planActiveSpeakerReframe({ ...base, speaker_regions: [...regionsAB, { speaker_label: "C", x: 0.4, y: 0.3, width: 0.1, height: 0.3 }], word_timeline: timeline([word("hey", 0, 1, "A"), word("mid", 1, 2.2, "B"), word("long", 2.2, 6, "C")]), layout: "active_speaker", min_hold_seconds: 2, switch_lead_seconds: 0 });
    expect(sliver.switches.map((sw) => [sw.time_seconds, sw.speaker_label])).toEqual([[0, "A"], [2.2, "C"]]);
    expect(sliver.absorbed_turns).toBe(1);
  });

  it("does not switch for a trailing interjection shorter than the hold time", () => {
    const plan = planActiveSpeakerReframe({ ...base, word_timeline: timeline([word("so", 0, 3, "A"), word("bye", 3, 3.2, "B")]), layout: "active_speaker", min_hold_seconds: 0.5, switch_lead_seconds: 0 });
    expect(plan.switches.map((sw) => sw.speaker_label)).toEqual(["A"]);
    expect(plan.absorbed_turns).toBe(1);
    expect(plan.coverage.seconds_by_speaker).toEqual({ A: 3.2 });
  });

  it("emits bezier keyframe pairs when ease_frames is set", () => {
    const plan = planActiveSpeakerReframe({ ...base, layout: "active_speaker", ease_frames: 6, frame_rate: 30, switch_lead_seconds: 0 });
    const scale = plan.keyframes.filter((keyframe) => keyframe.property === "Scale");
    expect(scale.map((keyframe) => keyframe.frame)).toEqual([0, 84, 90, 174, 180]);
    expect(plan.keyframes.every((keyframe) => keyframe.interpolation === "bezier")).toBe(true);
    const positions = plan.keyframes.filter((keyframe) => keyframe.property === "Position");
    expect(positions[1].value).toEqual(positions[0].value);
    expect(positions[2].value).toEqual({ x: 2160, y: 1141.65 });
  });

  it("selects the layout automatically", () => {
    expect(planActiveSpeakerReframe(base).layout).toBe("stacked");
    const wide = [{ ...regionsAB[0], x: 0.2, width: 0.7 }, regionsAB[1]];
    expect(planActiveSpeakerReframe({ ...base, speaker_regions: wide }).layout).toBe("active_speaker");
    const three = [...regionsAB, { speaker_label: "C", x: 0.4, y: 0.2, width: 0.1, height: 0.3 }];
    expect(planActiveSpeakerReframe({ ...base, speaker_regions: three }).layout).toBe("active_speaker");
    const solo = planActiveSpeakerReframe({ ...base, word_timeline: timeline([word("hi", 0, 3, "A")]), speaker_regions: [regionsAB[0]] });
    expect(solo.layout).toBe("active_speaker");
    expect(solo.switches).toHaveLength(1);
  });

  it("builds stacked layers whose windows tile the full target height", () => {
    const plan = planActiveSpeakerReframe({ ...base, layout: "stacked" });
    expect(plan.layout).toBe("stacked");
    expect(plan.layers).toHaveLength(2);
    expect(plan.layers!.map((layer) => layer.video_track_index)).toEqual([0, 1]);
    expect(plan.layers!.reduce((sum, layer) => sum + layer.target_rect.height, 0)).toBe(1920);
    expect(plan.layers!.map((layer) => layer.target_rect.y)).toEqual([0, 960]);
    for (const layer of plan.layers!) {
      // ch = max(432/0.88, 384/1.125) = 490.909 -> scale = 960 / 490.909 = 195.5556
      expect(layer.scale_percent).toBe(195.5556);
      expect(layer.crop_source_px.height * layer.scale_percent / 100).toBeCloseTo(960, 1);
      expect(layer.crop.left + layer.crop.right + (layer.crop_source_px.width / 1920) * 100).toBeCloseTo(100, 3);
      expect(layer.crop.top + layer.crop.bottom + (layer.crop_source_px.height / 1080) * 100).toBeCloseTo(100, 3);
    }
    expect(plan.layers![0].position).toEqual({ x: -210.933, y: 748.8 });
    expect(plan.keyframes).toEqual([]);
    expect(plan.routes.map((route) => route.tool)).toEqual(["create_sequence_from_preset", "duplicate_clip", "crop_clip", "set_clip_scale", "set_clip_position"]);
    expect(plan.coverage.seconds_by_speaker).toEqual({ A: 6, B: 3 });
  });

  it("builds split_left_right layers that tile the full target width", () => {
    const plan = planActiveSpeakerReframe({ ...base, layout: "split_left_right" });
    expect(plan.layers!.map((layer) => layer.target_rect)).toEqual([{ x: 0, y: 0, width: 540, height: 1920 }, { x: 540, y: 0, width: 540, height: 1920 }]);
    for (const layer of plan.layers!) expect(layer.crop_source_px.width * layer.scale_percent / 100).toBeCloseTo(540, 1);
  });

  it("requires exactly two regions for stacked layouts", () => {
    expect(() => planActiveSpeakerReframe({ ...base, layout: "stacked", speaker_regions: [regionsAB[0]], word_timeline: timeline([word("hi", 0, 3, "A")]) })).toThrow(/exactly 2/);
  });

  it("errors when a speaking speaker has no region", () => {
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [regionsAB[0]] })).toThrow(/missing a region for speaker\(s\): B/);
  });

  it("keeps the previous framing for unknown speakers and warns", () => {
    const words = [word("hi", 0, 3, "A"), word("who", 3, 6), word("back", 6, 9, "B")];
    const plan = planActiveSpeakerReframe({ ...base, word_timeline: timeline(words), layout: "active_speaker", switch_lead_seconds: 0 });
    expect(plan.switches.map((sw) => [sw.time_seconds, sw.speaker_label])).toEqual([[0, "A"], [6, "B"]]);
    expect(plan.warnings.some((warning) => warning.includes("no speaker_label"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("keep the previous speaker's framing"))).toBe(true);
    expect(plan.absorbed_turns).toBe(1);
  });

  it("warns about regions for speakers that never talk", () => {
    const plan = planActiveSpeakerReframe({ ...base, word_timeline: timeline([word("hi", 0, 3, "A")]) });
    expect(plan.warnings.some((warning) => warning.includes("never speak") && warning.includes("B"))).toBe(true);
  });

  it("is deterministic and binds the revision to the options", () => {
    const first = planActiveSpeakerReframe(base);
    expect(planActiveSpeakerReframe(base)).toEqual(first);
    expect(planActiveSpeakerReframe({ ...base, headroom: 0.2 }).plan_revision).not.toBe(first.plan_revision);
    expect(planActiveSpeakerReframe({ ...base, layout: "active_speaker" }).plan_revision).not.toBe(first.plan_revision);
  });

  it("rejects invalid input", () => {
    expect(() => planActiveSpeakerReframe({ word_timeline: timeline(abaWords), speaker_regions: regionsAB })).toThrow(/source_frame is required/);
    expect(() => planActiveSpeakerReframe({ ...base, source_frame: { width: 1920 } })).toThrow(/both width and height/);
    expect(() => planActiveSpeakerReframe({ ...base, target_frame: { width: 8, height: 1920 } })).toThrow(/target_frame.width/);
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [] })).toThrow(/between 1 and 8/);
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [...regionsAB, regionsAB[0]] })).toThrow(/duplicate/);
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [{ ...regionsAB[0], x: 0.9 }, regionsAB[1]] })).toThrow(/inside the normalized source frame/);
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [{ ...regionsAB[0], width: 0 }, regionsAB[1]] })).toThrow(/greater than 0/);
    expect(() => planActiveSpeakerReframe({ ...base, speaker_regions: [{ ...regionsAB[0], extra: 1 }, regionsAB[1]] })).toThrow(/unknown field/);
    expect(() => planActiveSpeakerReframe({ ...base, layout: "diagonal" })).toThrow(/layout must be one of/);
    expect(() => planActiveSpeakerReframe({ ...base, min_hold_seconds: 0.1 })).toThrow(/min_hold_seconds/);
    expect(() => planActiveSpeakerReframe({ ...base, switch_lead_seconds: 2 })).toThrow(/switch_lead_seconds/);
    expect(() => planActiveSpeakerReframe({ ...base, ease_frames: 1.5 })).toThrow(/integer/);
    expect(() => planActiveSpeakerReframe({ ...base, headroom: 0.9 })).toThrow(/headroom/);
    expect(() => planActiveSpeakerReframe({ ...base, unexpected: true })).toThrow(/unknown field/);
  });
});
