import { createHash } from "node:crypto";
import { digestWordTimeline, normalizeToken, secondsToFrame, sentenceRanges, validateWordTimeline, type WordTimeline } from "./word-timeline.js";

/**
 * Plan-only "punch-in" zoom keyframes (CapCut / Submagic style).
 *
 * Everything here is deterministic local arithmetic over caller-supplied
 * triggers or a word-timed transcript. Nothing contacts Premiere; the result
 * is a keyframe plan a caller later applies through the routes it names.
 */

export type ZoomTrigger = "sentence_start" | "emphasis_words" | "every_n_seconds" | "supplied";
export type KeyframeInterpolation = "bezier" | "linear" | "hold";
export type MotionProperty = "Scale" | "Position";
export type Point = { x: number; y: number };

export type EmphasisZoomKeyframe = {
  time_seconds: number;
  timeline_seconds: number;
  frame: number;
  property: MotionProperty;
  value: number | Point;
  interpolation: KeyframeInterpolation;
  event_index: number | null;
};

export type EmphasisZoomEvent = {
  index: number;
  trigger_time_seconds: number;
  timeline_time_seconds: number;
  reason: string;
  kind: "punch" | "punch_in" | "punch_out";
  scale_peak: number;
  start_seconds: number;
  end_seconds: number;
};

export type EmphasisZoomOptions = {
  trigger: ZoomTrigger;
  emphasis_words: string[];
  every_n_seconds: number | null;
  frame_rate: number;
  base_scale: number;
  zoom_scale: number;
  ease_in_frames: number;
  hold_seconds: number;
  ease_out_frames: number;
  cooldown_seconds: number;
  alternate: boolean;
  subject_point: Point;
  frame: { width: number; height: number };
  max_zooms: number;
  clip_start_seconds: number;
};

export type EmphasisZoomPlan = {
  applied: false;
  plan_revision: string;
  trigger: ZoomTrigger;
  options: EmphasisZoomOptions;
  events: EmphasisZoomEvent[];
  keyframes: EmphasisZoomKeyframe[];
  anchor: { center_px: Point; subject_px: Point; zoomed_position_px: Point; formula: string };
  automation: {
    uxp: Array<{ component: "Motion"; parameter: MotionProperty; keyframes: Array<{ seconds: number; value: number | Point; interpolation: KeyframeInterpolation }> }>;
    legacy: Array<{ route: "add_keyframe"; effect_name: "Motion"; property_name: "Scale"; time_seconds: number; value: number }>;
  };
  counts: { candidate_triggers: number; accepted: number; dropped_by_cooldown: number; dropped_by_cap: number; keyframes: number };
  evidence: Record<string, unknown>;
  routes: string[];
  next_steps: string[];
  warnings: string[];
  assumptions: string[];
};

export const MAX_TRIGGER_SECONDS = 2000;
export const MAX_ZOOMS = 500;
export const MAX_EMPHASIS_WORDS = 256;
const MAX_SECONDS = 86_400;
const TRIGGERS: readonly ZoomTrigger[] = ["sentence_start", "emphasis_words", "every_n_seconds", "supplied"];

function fail(message: string): never {
  throw new Error(message);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function numberIn(value: unknown, label: string, min: number, max: number, fallback: number | undefined, integer = false): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  if (value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
  return value;
}

function pointIn(value: unknown, label: string, fallback: Point, min: number, max: number, integer = false): Point {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object with x and y`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key !== "x" && key !== "y") fail(`${label} has an unknown field: ${key}`);
  return { x: numberIn(raw.x, `${label}.x`, min, max, fallback.x, integer), y: numberIn(raw.y, `${label}.y`, min, max, fallback.y, integer) };
}

function frameIn(value: unknown): { width: number; height: number } {
  if (value === undefined) return { width: 1080, height: 1920 };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("frame must be an object with width and height");
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key !== "width" && key !== "height") fail(`frame has an unknown field: ${key}`);
  return { width: numberIn(raw.width, "frame.width", 16, 16_384, 1080, true), height: numberIn(raw.height, "frame.height", 16, 16_384, 1920, true) };
}

/**
 * Position that keeps `subject` fixed on screen while the clip scales.
 *
 * Premiere's Motion effect scales the clip about its Anchor Point, which by
 * default sits at the clip centre and is drawn at Motion > Position (pixels,
 * default = frame centre C = (width/2, height/2)). With scale factor
 * k = scale / base_scale, a source pixel p that was at screen position p when
 * unscaled moves to P + (p - C) * k, where P is the new Position. Requiring the
 * subject pixel S to stay put (P + (S - C) * k = S) gives
 *
 *   P = S - (S - C) * k = C + (C - S) * (k - 1)
 *
 * i.e. the clip slides away from the subject by the subject's offset from
 * centre times the extra magnification. For a talking head above centre the
 * clip therefore moves down so the face does not climb out of frame.
 */
export function anchoredPosition(subjectPx: Point, center: Point, scale: number, baseScale: number): Point {
  const k = scale / baseScale;
  return { x: round6(center.x + (center.x - subjectPx.x) * (k - 1)), y: round6(center.y + (center.y - subjectPx.y) * (k - 1)) };
}

function normalizeEmphasisWords(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EMPHASIS_WORDS) fail(`emphasis_words must be an array of at most ${MAX_EMPHASIS_WORDS} entries`);
  const words = value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 128) fail(`emphasis_words[${index}] must be a non-empty string of at most 128 characters`);
    return entry.trim().split(/\s+/).map(normalizeToken).filter(Boolean).join(" ");
  }).filter(Boolean);
  return [...new Set(words)].sort();
}

function normalizeTriggerSeconds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRIGGER_SECONDS) fail(`trigger_seconds must contain between 1 and ${MAX_TRIGGER_SECONDS} numbers`);
  const seconds = value.map((entry, index) => numberIn(entry, `trigger_seconds[${index}]`, 0, MAX_SECONDS, undefined));
  return [...new Set(seconds.map(round6))].sort((a, b) => a - b);
}

export function normalizeEmphasisZoomOptions(args: Record<string, unknown>, hasTimeline: boolean): EmphasisZoomOptions {
  const rawTrigger = args.trigger === undefined ? (hasTimeline ? "sentence_start" : "supplied") : args.trigger;
  if (typeof rawTrigger !== "string" || !TRIGGERS.includes(rawTrigger as ZoomTrigger)) fail(`trigger must be one of ${TRIGGERS.join(", ")}`);
  const trigger = rawTrigger as ZoomTrigger;
  if (hasTimeline && trigger === "supplied") fail("trigger 'supplied' requires trigger_seconds, not word_timeline");
  if (!hasTimeline && trigger !== "supplied") fail(`trigger '${trigger}' requires word_timeline`);
  const emphasisWords = normalizeEmphasisWords(args.emphasis_words);
  if (trigger === "emphasis_words" && emphasisWords.length === 0) fail("emphasis_words must list at least one word when trigger is emphasis_words");
  const everyN = args.every_n_seconds === undefined ? null : numberIn(args.every_n_seconds, "every_n_seconds", 0.5, 3600, undefined);
  if (trigger === "every_n_seconds" && everyN === null) fail("every_n_seconds is required when trigger is every_n_seconds");
  const baseScale = numberIn(args.base_scale, "base_scale", 1, 400, 100);
  const zoomScale = numberIn(args.zoom_scale, "zoom_scale", 101, 200, 112);
  if (zoomScale <= baseScale) fail("zoom_scale must be greater than base_scale");
  const frameRate = numberIn(args.frame_rate, "frame_rate", 1, 240, 30);
  const easeIn = numberIn(args.ease_in_frames, "ease_in_frames", 0, 30, 3, true);
  const hold = numberIn(args.hold_seconds, "hold_seconds", 0, 10, 1.2);
  const easeOut = numberIn(args.ease_out_frames, "ease_out_frames", 0, 30, 6, true);
  if (easeIn + easeOut + secondsToFrame(hold, frameRate) < 1) fail("ease_in_frames, hold_seconds and ease_out_frames must together span at least one frame");
  if (args.alternate !== undefined && typeof args.alternate !== "boolean") fail("alternate must be a boolean");
  return {
    trigger,
    emphasis_words: emphasisWords,
    every_n_seconds: everyN,
    frame_rate: frameRate,
    base_scale: baseScale,
    zoom_scale: zoomScale,
    ease_in_frames: easeIn,
    hold_seconds: hold,
    ease_out_frames: easeOut,
    cooldown_seconds: numberIn(args.cooldown_seconds, "cooldown_seconds", 0, 600, 2.5),
    alternate: args.alternate === true,
    subject_point: pointIn(args.subject_point, "subject_point", { x: 0.5, y: 0.4 }, 0, 1),
    frame: frameIn(args.frame),
    max_zooms: numberIn(args.max_zooms, "max_zooms", 1, MAX_ZOOMS, 120, true),
    clip_start_seconds: numberIn(args.clip_start_seconds, "clip_start_seconds", 0, MAX_SECONDS, 0),
  };
}

type Candidate = { seconds: number; reason: string };

/** Trigger candidates derived from a word timeline for the requested mode. */
export function deriveTriggerCandidates(timeline: WordTimeline, options: EmphasisZoomOptions): Candidate[] {
  const words = timeline.words;
  if (options.trigger === "sentence_start") {
    return sentenceRanges(words).map((range) => ({ seconds: round6(words[range.startIndex].start_seconds), reason: "sentence_start" }));
  }
  if (options.trigger === "every_n_seconds") {
    const step = options.every_n_seconds ?? 1;
    const out: Candidate[] = [];
    for (let t = 0; t <= timeline.duration_seconds + 1e-9 && out.length < MAX_TRIGGER_SECONDS; t += step) out.push({ seconds: round6(t), reason: "every_n_seconds" });
    return out;
  }
  const tokens = words.map((word) => normalizeToken(word.text));
  const phrases = options.emphasis_words.map((phrase) => phrase.split(" "));
  const out: Candidate[] = [];
  for (let index = 0; index < words.length; index += 1) {
    for (const phrase of phrases) {
      if (index + phrase.length > words.length) continue;
      let matched = true;
      for (let offset = 0; offset < phrase.length; offset += 1) if (tokens[index + offset] !== phrase[offset]) { matched = false; break; }
      if (matched) { out.push({ seconds: round6(words[index].start_seconds), reason: `emphasis_word:${phrase.join(" ")}` }); break; }
    }
  }
  return out;
}

export function planEmphasisZoomKeyframes(args: Record<string, unknown>): EmphasisZoomPlan {
  const hasTimeline = args.word_timeline !== undefined;
  const hasTriggers = args.trigger_seconds !== undefined;
  if (hasTimeline === hasTriggers) fail("provide exactly one of word_timeline or trigger_seconds");
  const options = normalizeEmphasisZoomOptions(args, hasTimeline);
  const warnings: string[] = [];
  let candidates: Candidate[];
  let evidence: Record<string, unknown>;
  let source: unknown;
  if (hasTimeline) {
    const timeline = validateWordTimeline(args.word_timeline);
    candidates = deriveTriggerCandidates(timeline, options);
    const timelineDigest = digestWordTimeline(timeline);
    evidence = { source: "word_timeline", source_project_item_id: timeline.source_project_item_id, transcript_revision: timeline.transcript_revision, word_count: timeline.words.length, duration_seconds: round6(timeline.duration_seconds), timeline_digest: timelineDigest, candidate_triggers: candidates.length };
    source = timelineDigest;
  } else {
    const seconds = normalizeTriggerSeconds(args.trigger_seconds);
    candidates = seconds.map((value) => ({ seconds: value, reason: "supplied" }));
    evidence = { source: "trigger_seconds", trigger_count: seconds.length, candidate_triggers: candidates.length };
    source = seconds;
  }
  candidates.sort((a, b) => a.seconds - b.seconds);

  const fps = options.frame_rate;
  const holdFrames = secondsToFrame(options.hold_seconds, fps);
  const cooldownFrames = secondsToFrame(options.cooldown_seconds, fps, "ceil");
  const center: Point = { x: options.frame.width / 2, y: options.frame.height / 2 };
  const subjectPx: Point = { x: round6(options.subject_point.x * options.frame.width), y: round6(options.subject_point.y * options.frame.height) };
  const zoomedPosition = anchoredPosition(subjectPx, center, options.zoom_scale, options.base_scale);
  const secondsAt = (frame: number) => round6(frame / fps);

  const events: EmphasisZoomEvent[] = [];
  const scaleKeys: Array<{ frame: number; value: number; interpolation: KeyframeInterpolation; event: number | null }> = [];
  const pushScale = (frame: number, value: number, interpolation: KeyframeInterpolation, event: number | null) => {
    const last = scaleKeys[scaleKeys.length - 1];
    if (last && last.frame === frame) { last.value = value; last.interpolation = interpolation; last.event = event; return; }
    scaleKeys.push({ frame, value, interpolation, event });
  };

  let lastTriggerFrame = Number.NEGATIVE_INFINITY;
  let lastEndFrame = Number.NEGATIVE_INFINITY;
  let droppedByCooldown = 0;
  let droppedByCap = 0;
  const droppedSamples: number[] = [];
  const snapIn: KeyframeInterpolation = options.ease_in_frames === 0 ? "hold" : "linear";
  pushScale(0, options.base_scale, snapIn, null);

  for (const candidate of candidates) {
    const frame0 = secondsToFrame(candidate.seconds, fps);
    if (frame0 - lastTriggerFrame < cooldownFrames || frame0 < lastEndFrame) {
      droppedByCooldown += 1;
      if (droppedSamples.length < 5) droppedSamples.push(candidate.seconds);
      continue;
    }
    if (events.length >= options.max_zooms) { droppedByCap += 1; continue; }
    const index = events.length;
    const kind: EmphasisZoomEvent["kind"] = options.alternate ? (index % 2 === 0 ? "punch_in" : "punch_out") : "punch";
    let endFrame: number;
    if (kind === "punch") {
      const frame1 = frame0 + options.ease_in_frames;
      const frame2 = frame1 + holdFrames;
      endFrame = frame2 + options.ease_out_frames;
      if (options.ease_in_frames > 0) pushScale(frame0, options.base_scale, "bezier", index);
      pushScale(frame1, options.zoom_scale, options.ease_out_frames === 0 ? "hold" : "linear", index);
      if (options.ease_out_frames > 0) pushScale(frame2, options.zoom_scale, "bezier", index);
      pushScale(endFrame, options.base_scale, snapIn, index);
    } else if (kind === "punch_in") {
      endFrame = frame0 + options.ease_in_frames;
      if (options.ease_in_frames > 0) pushScale(frame0, options.base_scale, "bezier", index);
      pushScale(endFrame, options.zoom_scale, options.ease_out_frames === 0 ? "hold" : "linear", index);
    } else {
      endFrame = frame0 + options.ease_out_frames;
      if (options.ease_out_frames > 0) pushScale(frame0, options.zoom_scale, "bezier", index);
      pushScale(endFrame, options.base_scale, snapIn, index);
    }
    events.push({ index, trigger_time_seconds: candidate.seconds, timeline_time_seconds: round6(candidate.seconds + options.clip_start_seconds), reason: candidate.reason, kind, scale_peak: options.zoom_scale, start_seconds: secondsAt(frame0), end_seconds: secondsAt(endFrame) });
    lastTriggerFrame = frame0;
    lastEndFrame = endFrame;
  }

  if (droppedByCooldown > 0) warnings.push(`${droppedByCooldown} trigger(s) dropped because they fell inside the ${options.cooldown_seconds}s cooldown or overlapped the previous zoom (first at ${droppedSamples.join(", ")}s).`);
  if (droppedByCap > 0) warnings.push(`${droppedByCap} trigger(s) dropped after reaching max_zooms=${options.max_zooms}.`);
  if (events.length === 0) warnings.push("No zoom events were produced; check the trigger mode and inputs.");
  if (options.alternate && events.length % 2 === 1) warnings.push("alternate mode ends on a punch_in, so the clip remains zoomed after the last event.");

  const keyframes: EmphasisZoomKeyframe[] = [];
  for (const key of scaleKeys) {
    const zoomed = key.value !== options.base_scale;
    const position = zoomed ? anchoredPosition(subjectPx, center, key.value, options.base_scale) : { x: center.x, y: center.y };
    const time = secondsAt(key.frame);
    const timeline = round6(time + options.clip_start_seconds);
    keyframes.push({ time_seconds: time, timeline_seconds: timeline, frame: key.frame, property: "Scale", value: key.value, interpolation: key.interpolation, event_index: key.event });
    keyframes.push({ time_seconds: time, timeline_seconds: timeline, frame: key.frame, property: "Position", value: position, interpolation: key.interpolation, event_index: key.event });
  }

  const uxp = (["Scale", "Position"] as const).map((parameter) => ({
    component: "Motion" as const,
    parameter,
    keyframes: keyframes.filter((key) => key.property === parameter).map((key) => ({ seconds: key.timeline_seconds, value: key.value, interpolation: key.interpolation })),
  }));
  const legacy = keyframes.filter((key) => key.property === "Scale").map((key) => ({ route: "add_keyframe" as const, effect_name: "Motion" as const, property_name: "Scale" as const, time_seconds: key.time_seconds, value: key.value as number }));

  const planRevision = digest({ source, options });
  return {
    applied: false,
    plan_revision: planRevision,
    trigger: options.trigger,
    options,
    events,
    keyframes,
    anchor: { center_px: center, subject_px: subjectPx, zoomed_position_px: zoomedPosition, formula: "position = center + (center - subject_px) * (scale / base_scale - 1)" },
    automation: { uxp, legacy },
    counts: { candidate_triggers: candidates.length, accepted: events.length, dropped_by_cooldown: droppedByCooldown, dropped_by_cap: droppedByCap, keyframes: keyframes.length },
    evidence: { ...evidence, plan_revision: planRevision },
    routes: ["automate_effect_parameters_uxp", "add_keyframe", "set_clip_scale", "set_clip_position", "transform_track_item_uxp"],
    next_steps: [
      "Confirm the target clip and its frame size with get_sequence_structure; time_seconds are clip-relative and timeline_seconds add clip_start_seconds.",
      "Apply automation.uxp Scale and Position keyframes with automate_effect_parameters_uxp (component Motion), or apply automation.legacy Scale keyframes one at a time with add_keyframe.",
      "Position keyframes assume the clip fills the frame with its anchor at centre; if the clip is already repositioned, offset every Position value by the existing delta.",
    ],
    warnings,
    assumptions: [
      "Motion Position is expressed in frame pixels with the default position at the frame centre and the clip anchor at its own centre.",
      "Keyframe interpolation describes the curve leaving that keyframe toward the next one.",
      options.alternate ? "In alternate mode each punch_in stays zoomed until the following punch_out trigger; hold_seconds is not used." : "Each event eases in, holds for hold_seconds, then eases back to base_scale.",
      "Trigger and keyframe times are snapped to whole frames at frame_rate.",
    ],
  };
}
