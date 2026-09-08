import { describe, expect, it } from "vitest";
import { anchoredPosition, deriveTriggerCandidates, normalizeEmphasisZoomOptions, planEmphasisZoomKeyframes } from "../../src/ai/emphasis-zoom.js";
import { validateWordTimeline } from "../../src/ai/word-timeline.js";

const REVISION = `sha256:${"a".repeat(64)}`;

function timeline(text: string, secondsPerWord = 0.5, gap = 0) {
  const words = text.split(/\s+/).map((token, index) => ({ text: token, start_seconds: index * (secondsPerWord + gap), end_seconds: index * (secondsPerWord + gap) + secondsPerWord }));
  return { source_project_item_id: "item-1", transcript_revision: REVISION, words };
}

function scaleKeys(plan: ReturnType<typeof planEmphasisZoomKeyframes>) {
  return plan.keyframes.filter((key) => key.property === "Scale").map((key) => [key.time_seconds, key.value as number, key.interpolation] as const);
}

describe("anchoredPosition", () => {
  it("keeps a talking head above centre anchored when zooming 112% in 1080x1920", () => {
    // subject_px = (0.5*1080, 0.4*1920) = (540, 768); centre = (540, 960); k = 1.12
    // position = centre + (centre - subject) * (k - 1) = (540 + 0, 960 + 192 * 0.12) = (540, 983.04)
    expect(anchoredPosition({ x: 540, y: 768 }, { x: 540, y: 960 }, 112, 100)).toEqual({ x: 540, y: 983.04 });
  });

  it("returns the centre when the subject is centred or the scale equals base", () => {
    expect(anchoredPosition({ x: 960, y: 540 }, { x: 960, y: 540 }, 150, 100)).toEqual({ x: 960, y: 540 });
    expect(anchoredPosition({ x: 100, y: 100 }, { x: 960, y: 540 }, 100, 100)).toEqual({ x: 960, y: 540 });
  });

  it("moves the clip toward the opposite side of an off-centre subject", () => {
    // subject at left third: (360, 540) in 1920x1080, k = 1.5 -> x = 960 + 600 * 0.5 = 1260
    expect(anchoredPosition({ x: 360, y: 540 }, { x: 960, y: 540 }, 150, 100)).toEqual({ x: 1260, y: 540 });
  });
});

describe("planEmphasisZoomKeyframes with supplied triggers", () => {
  it("lays out ease-in, hold, ease-out keyframes on whole frames", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [2] });
    expect(plan.applied).toBe(false);
    expect(plan.trigger).toBe("supplied");
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ index: 0, trigger_time_seconds: 2, reason: "supplied", kind: "punch", scale_peak: 112, start_seconds: 2, end_seconds: 3.5 });
    // frames: 0 (initial), 60, 63 (+3 ease in), 99 (+36 hold), 105 (+6 ease out)
    expect(scaleKeys(plan)).toEqual([
      [0, 100, "linear"],
      [2, 100, "bezier"],
      [2.1, 112, "linear"],
      [3.3, 112, "bezier"],
      [3.5, 100, "linear"],
    ]);
  });

  it("emits Position keyframes that mirror Scale keyframes using the anchor formula", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [2] });
    const positions = plan.keyframes.filter((key) => key.property === "Position");
    expect(positions.map((key) => key.value)).toEqual([
      { x: 540, y: 960 },
      { x: 540, y: 960 },
      { x: 540, y: 983.04 },
      { x: 540, y: 983.04 },
      { x: 540, y: 960 },
    ]);
    expect(plan.anchor).toMatchObject({ center_px: { x: 540, y: 960 }, subject_px: { x: 540, y: 768 }, zoomed_position_px: { x: 540, y: 983.04 } });
    expect(plan.anchor.formula).toContain("center + (center - subject_px)");
  });

  it("honours custom frame and subject point", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [1], frame: { width: 1920, height: 1080 }, subject_point: { x: 0.25, y: 0.5 }, zoom_scale: 150 });
    expect(plan.anchor.zoomed_position_px).toEqual({ x: 1200, y: 540 });
  });

  it("drops triggers inside the cooldown window and warns", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [1, 2, 3, 10] });
    expect(plan.events.map((event) => event.trigger_time_seconds)).toEqual([1, 10]);
    expect(plan.counts).toMatchObject({ candidate_triggers: 4, accepted: 2, dropped_by_cooldown: 2, dropped_by_cap: 0 });
    expect(plan.warnings.some((warning) => warning.includes("2 trigger(s) dropped") && warning.includes("2, 3"))).toBe(true);
  });

  it("drops triggers that would overlap the previous event even with zero cooldown", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [1, 1.5, 2.5], cooldown_seconds: 0 });
    // event 0 spans 1.0 -> 2.5 (0.1 ease in + 1.2 hold + 0.2 ease out); 1.5 overlaps, 2.5 touches and is allowed
    expect(plan.events.map((event) => event.trigger_time_seconds)).toEqual([1, 2.5]);
  });

  it("dedupes and sorts supplied triggers", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [9, 3, 3, 6], cooldown_seconds: 0 });
    expect(plan.events.map((event) => event.trigger_time_seconds)).toEqual([3, 6, 9]);
    expect(plan.evidence).toMatchObject({ source: "trigger_seconds", trigger_count: 3 });
  });

  it("caps accepted events at max_zooms", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [0, 5, 10, 15, 20], max_zooms: 2 });
    expect(plan.events).toHaveLength(2);
    expect(plan.counts.dropped_by_cap).toBe(3);
    expect(plan.warnings.some((warning) => warning.includes("max_zooms=2"))).toBe(true);
  });

  it("uses hold interpolation before an instant cut zoom and omits the base keyframe at the trigger", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [2], ease_in_frames: 0, ease_out_frames: 0, hold_seconds: 1 });
    expect(scaleKeys(plan)).toEqual([
      [0, 100, "hold"],
      [2, 112, "hold"],
      [3, 100, "hold"],
    ]);
  });

  it("alternates punch_in and punch_out events that stay zoomed in between", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [0, 5, 10, 15], alternate: true, cooldown_seconds: 0 });
    expect(plan.events.map((event) => event.kind)).toEqual(["punch_in", "punch_out", "punch_in", "punch_out"]);
    expect(scaleKeys(plan)).toEqual([
      [0, 100, "bezier"],
      [0.1, 112, "linear"],
      [5, 112, "bezier"],
      [5.2, 100, "linear"],
      [10, 100, "bezier"],
      [10.1, 112, "linear"],
      [15, 112, "bezier"],
      [15.2, 100, "linear"],
    ]);
    expect(plan.warnings.some((warning) => warning.includes("remains zoomed"))).toBe(false);
    const odd = planEmphasisZoomKeyframes({ trigger_seconds: [0, 5, 10], alternate: true, cooldown_seconds: 0 });
    expect(odd.warnings.some((warning) => warning.includes("remains zoomed"))).toBe(true);
  });

  it("offsets timeline_seconds and automation payloads by clip_start_seconds", () => {
    const plan = planEmphasisZoomKeyframes({ trigger_seconds: [1], clip_start_seconds: 10 });
    expect(plan.keyframes.every((key) => key.timeline_seconds === key.time_seconds + 10)).toBe(true);
    const scale = plan.automation.uxp.find((entry) => entry.parameter === "Scale");
    expect(scale).toMatchObject({ component: "Motion" });
    expect(scale?.keyframes[1]).toEqual({ seconds: 11, value: 100, interpolation: "bezier" });
    expect(plan.automation.legacy.every((entry) => entry.route === "add_keyframe" && entry.effect_name === "Motion" && entry.property_name === "Scale" && typeof entry.value === "number")).toBe(true);
    expect(plan.automation.legacy[1].time_seconds).toBe(1);
  });

  it("is deterministic and sensitive to inputs", () => {
    const a = planEmphasisZoomKeyframes({ trigger_seconds: [1, 5] });
    const b = planEmphasisZoomKeyframes({ trigger_seconds: [5, 1] });
    const c = planEmphasisZoomKeyframes({ trigger_seconds: [1, 5], zoom_scale: 120 });
    expect(a.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(a.plan_revision).toBe(b.plan_revision);
    expect(a.plan_revision).not.toBe(c.plan_revision);
    expect(a.routes).toContain("automate_effect_parameters_uxp");
    expect(a.routes).toContain("add_keyframe");
    expect(a.next_steps.length).toBeGreaterThan(0);
  });
});

describe("planEmphasisZoomKeyframes with a word timeline", () => {
  it("defaults to sentence_start triggers", () => {
    const plan = planEmphasisZoomKeyframes({ word_timeline: timeline("Hello world. This is great! Really", 2), cooldown_seconds: 0 });
    expect(plan.trigger).toBe("sentence_start");
    expect(plan.events.map((event) => [event.trigger_time_seconds, event.reason])).toEqual([[0, "sentence_start"], [4, "sentence_start"], [10, "sentence_start"]]);
    expect(plan.evidence).toMatchObject({ source: "word_timeline", source_project_item_id: "item-1", transcript_revision: REVISION, word_count: 6 });
  });

  it("matches emphasis words and phrases case-insensitively", () => {
    const plan = planEmphasisZoomKeyframes({ word_timeline: timeline("this is HUGE, and game changing stuff", 2), trigger: "emphasis_words", emphasis_words: ["huge", "Game changing"], cooldown_seconds: 0 });
    expect(plan.events.map((event) => [event.trigger_time_seconds, event.reason])).toEqual([[4, "emphasis_word:huge"], [8, "emphasis_word:game changing"]]);
  });

  it("generates every_n_seconds triggers across the timeline duration", () => {
    const plan = planEmphasisZoomKeyframes({ word_timeline: timeline("a b c d e f g h i j k l m n o p q r s t u"), trigger: "every_n_seconds", every_n_seconds: 4, cooldown_seconds: 0 });
    // 21 words * 0.5s = 10.5s duration -> 0, 4, 8
    expect(plan.events.map((event) => event.trigger_time_seconds)).toEqual([0, 4, 8]);
    expect(plan.events.every((event) => event.reason === "every_n_seconds")).toBe(true);
  });

  it("exposes candidate derivation for direct use", () => {
    const validated = validateWordTimeline(timeline("One. Two."));
    const options = normalizeEmphasisZoomOptions({}, true);
    expect(deriveTriggerCandidates(validated, options)).toEqual([{ seconds: 0, reason: "sentence_start" }, { seconds: 0.5, reason: "sentence_start" }]);
  });

  it("warns when no events are produced", () => {
    const plan = planEmphasisZoomKeyframes({ word_timeline: timeline("nothing to see"), trigger: "emphasis_words", emphasis_words: ["absent"] });
    expect(plan.events).toEqual([]);
    expect(plan.warnings.some((warning) => warning.includes("No zoom events"))).toBe(true);
  });
});

describe("planEmphasisZoomKeyframes validation", () => {
  it.each([
    [{}, "exactly one of word_timeline or trigger_seconds"],
    [{ word_timeline: timeline("a"), trigger_seconds: [1] }, "exactly one of word_timeline or trigger_seconds"],
    [{ word_timeline: timeline("a"), trigger: "supplied" }, "requires trigger_seconds"],
    [{ trigger_seconds: [1], trigger: "sentence_start" }, "requires word_timeline"],
    [{ trigger_seconds: [1], trigger: "bogus" }, "trigger must be one of"],
    [{ word_timeline: timeline("a"), trigger: "emphasis_words" }, "emphasis_words must list at least one word"],
    [{ word_timeline: timeline("a"), trigger: "every_n_seconds" }, "every_n_seconds is required"],
    [{ trigger_seconds: [1], zoom_scale: 110, base_scale: 120 }, "zoom_scale must be greater than base_scale"],
    [{ trigger_seconds: [1], ease_in_frames: 0, ease_out_frames: 0, hold_seconds: 0 }, "at least one frame"],
    [{ trigger_seconds: [] }, "trigger_seconds must contain"],
    [{ trigger_seconds: [1, "2"] }, "trigger_seconds[1] must be a finite number"],
    [{ trigger_seconds: [-1] }, "trigger_seconds[0] must be between"],
    [{ trigger_seconds: [1], frame: { width: 1080, height: 1920, depth: 1 } }, "frame has an unknown field"],
    [{ trigger_seconds: [1], subject_point: { x: 2, y: 0 } }, "subject_point.x must be between"],
    [{ trigger_seconds: [1], ease_in_frames: 1.5 }, "ease_in_frames must be an integer"],
    [{ trigger_seconds: [1], alternate: "yes" }, "alternate must be a boolean"],
    [{ trigger_seconds: [1], max_zooms: 0 }, "max_zooms must be between"],
    [{ word_timeline: { source_project_item_id: "x", transcript_revision: "nope", words: [] } }, "transcript_revision"],
  ])("rejects %j", (args, message) => {
    expect(() => planEmphasisZoomKeyframes(args as Record<string, unknown>)).toThrow(message);
  });

  it("rejects too many triggers", () => {
    expect(() => planEmphasisZoomKeyframes({ trigger_seconds: Array.from({ length: 2001 }, (_, index) => index) })).toThrow("between 1 and 2000");
  });
});
