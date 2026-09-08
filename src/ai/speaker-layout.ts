import { digestWordTimeline, secondsToFrame, validateWordTimeline, type TranscriptWord, type WordTimeline } from "./word-timeline.js";

/**
 * Speaker-driven layout planning (local-only).
 *
 * Two plan shapes are produced from a caller-supplied word timeline:
 *  - a speaker checkerboard (each speaker's turns on their own video/audio
 *    track, DaVinci IntelliCut style), and
 *  - an active-speaker vertical reframe (Opus/Klap style) expressed as
 *    Motion Scale/Position keyframes, or a static stacked/split layout.
 *
 * Everything here is deterministic arithmetic on the transcript. Nothing
 * contacts Premiere, a model, or the network; plans are applied later by the
 * caller through existing tools named in `routes`.
 */

export const UNKNOWN_SPEAKER = "unknown";
export const MAX_SPEAKER_REGIONS = 8;
export const MAX_FRAME_DIMENSION = 16_384;
const MIN_FRAME_DIMENSION = 16;
const EPSILON = 1e-6;

export type SpeakerTurn = {
  speaker_label: string;
  start_seconds: number;
  end_seconds: number;
  word_count: number;
  /** Words that belonged to a shorter interjection folded into this turn. */
  absorbed_word_count: number;
};

export type SpeakerTurnOptions = {
  min_turn_seconds?: number;
  merge_gap_seconds?: number;
};

export type SpeakerTurnResult = {
  turns: SpeakerTurn[];
  /** Labelled speakers in first-appearance order; `unknown` last when present. */
  speakers: string[];
  absorbed_count: number;
  unknown_word_count: number;
  warnings: string[];
};

export type SpeakerRegion = { speaker_label: string; x: number; y: number; width: number; height: number };
export type FrameSize = { width: number; height: number };
export type ReframeLayout = "active_speaker" | "stacked" | "split_left_right" | "auto";

export type MotionKeyframe = {
  time_seconds: number;
  frame: number;
  property: "Scale" | "Position";
  value: number | { x: number; y: number };
  interpolation: "hold" | "bezier";
};

export type SpeakerFraming = {
  speaker_label: string;
  /** Crop window in source pixels (target aspect, region + headroom, clamped to the frame). */
  crop_source_px: { left: number; top: number; width: number; height: number };
  /** Crop effect percentages (left/top/right/bottom) for crop_clip. */
  crop_percent: { left: number; top: number; right: number; bottom: number };
  scale_percent: number;
  position: { x: number; y: number };
  region_fits: boolean;
};

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${label} has an unknown field: ${key}`);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} must be a finite number from ${minimum} through ${maximum}`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function frameRate(value: unknown): number {
  return boundedNumber(value, "frame_rate", 1, 240, 30);
}

function snap(seconds: number, fps: number, mode: "floor" | "ceil" | "round" = "round"): { frame: number; seconds: number } {
  const frame = Math.max(0, secondsToFrame(seconds, fps, mode));
  return { frame, seconds: round(frame / fps) };
}

/**
 * Merges consecutive words into speaker turns.
 *
 * - Consecutive words with the same speaker (gap <= merge_gap_seconds) form one turn.
 * - An interior turn shorter than min_turn_seconds is an interjection: its
 *   words are folded into the preceding turn, and if that leaves two adjacent
 *   turns of the same speaker within merge_gap_seconds they merge. Turns at
 *   the first/last position are never absorbed.
 * - Words without speaker_label belong to the `unknown` speaker.
 */
export function speakerTurns(words: readonly TranscriptWord[], options: SpeakerTurnOptions = {}): SpeakerTurnResult {
  const minTurn = boundedNumber(options.min_turn_seconds, "min_turn_seconds", 0.2, 10, 0.8);
  const mergeGap = boundedNumber(options.merge_gap_seconds, "merge_gap_seconds", 0, 30, 0.5);
  if (!Array.isArray(words) || words.length === 0) fail("words must contain at least one word");

  const turns: SpeakerTurn[] = [];
  const firstAppearance: string[] = [];
  let labelled = 0;
  let unknownWords = 0;
  for (const word of words) {
    const label = word.speaker_label ?? UNKNOWN_SPEAKER;
    if (word.speaker_label) labelled += 1; else unknownWords += 1;
    if (!firstAppearance.includes(label)) firstAppearance.push(label);
    const last = turns[turns.length - 1];
    if (last && last.speaker_label === label && word.start_seconds - last.end_seconds <= mergeGap + EPSILON) {
      last.end_seconds = Math.max(last.end_seconds, word.end_seconds);
      last.word_count += 1;
    } else {
      turns.push({ speaker_label: label, start_seconds: word.start_seconds, end_seconds: word.end_seconds, word_count: 1, absorbed_word_count: 0 });
    }
  }
  if (labelled === 0) fail("word_timeline must label at least one word with speaker_label");

  let absorbed = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < turns.length - 1; index += 1) {
      const turn = turns[index];
      if (turn.end_seconds - turn.start_seconds >= minTurn - EPSILON) continue;
      const previous = turns[index - 1];
      previous.end_seconds = Math.max(previous.end_seconds, turn.end_seconds);
      previous.word_count += turn.word_count;
      previous.absorbed_word_count += turn.word_count;
      turns.splice(index, 1);
      absorbed += 1;
      const next = turns[index];
      if (next && next.speaker_label === previous.speaker_label && next.start_seconds - previous.end_seconds <= mergeGap + EPSILON) {
        previous.end_seconds = Math.max(previous.end_seconds, next.end_seconds);
        previous.word_count += next.word_count;
        previous.absorbed_word_count += next.absorbed_word_count;
        turns.splice(index, 1);
      }
      changed = true;
      break;
    }
  }

  const speakers = firstAppearance.filter((label) => label !== UNKNOWN_SPEAKER);
  if (unknownWords > 0) speakers.push(UNKNOWN_SPEAKER);
  const warnings: string[] = [];
  if (unknownWords > 0) warnings.push(`${unknownWords} word(s) have no speaker_label and were assigned to speaker "${UNKNOWN_SPEAKER}".`);
  if (absorbed > 0) warnings.push(`${absorbed} interjection turn(s) shorter than ${minTurn}s were absorbed into the surrounding speaker.`);
  return {
    turns: turns.map((turn) => ({ ...turn, start_seconds: round(turn.start_seconds), end_seconds: round(turn.end_seconds) })),
    speakers,
    absorbed_count: absorbed,
    unknown_word_count: unknownWords,
    warnings,
  };
}

function evidenceFor(timeline: WordTimeline) {
  return {
    source_project_item_id: timeline.source_project_item_id,
    transcript_revision: timeline.transcript_revision,
    word_count: timeline.words.length,
    duration_seconds: round(timeline.duration_seconds),
    speakers: timeline.speakers,
  };
}

// ---------------------------------------------------------------------------
// Checkerboard
// ---------------------------------------------------------------------------

const CHECKERBOARD_KEYS = ["word_timeline", "frame_rate", "min_turn_seconds", "merge_gap_seconds", "handle_frames", "base_video_track_index", "base_audio_track_index", "track_per_speaker", "speaker_order"] as const;

function speakerOrder(value: unknown, appearing: readonly string[], warnings: string[]): string[] {
  if (value === undefined) return [...appearing];
  if (!Array.isArray(value) || value.length > 64) fail("speaker_order must be an array of at most 64 labels");
  const ordered = value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 128) fail(`speaker_order[${index}] must be a non-empty string of at most 128 characters`);
    return entry.trim();
  });
  if (new Set(ordered).size !== ordered.length) fail("speaker_order contains duplicate labels");
  const unused = ordered.filter((label) => !appearing.includes(label));
  if (unused.length) warnings.push(`speaker_order lists speaker(s) not present in the transcript; they keep a reserved track slot: ${unused.join(", ")}.`);
  const missing = appearing.filter((label) => !ordered.includes(label));
  if (missing.length) warnings.push(`speaker_order omits speaker(s) present in the transcript; they were appended in first-appearance order: ${missing.join(", ")}.`);
  return [...ordered, ...missing];
}

export function planSpeakerCheckerboard(args: Record<string, unknown>) {
  if (!isRecord(args)) fail("arguments must be an object");
  rejectUnknownKeys(args, CHECKERBOARD_KEYS, "arguments");
  const timeline = validateWordTimeline(args.word_timeline);
  const fps = frameRate(args.frame_rate);
  const minTurn = boundedNumber(args.min_turn_seconds, "min_turn_seconds", 0.2, 10, 0.8);
  const mergeGap = boundedNumber(args.merge_gap_seconds, "merge_gap_seconds", 0, 30, 0.5);
  const handleFrames = boundedNumber(args.handle_frames, "handle_frames", 0, 24, 2, true);
  const baseVideo = boundedNumber(args.base_video_track_index, "base_video_track_index", 0, 99, 0, true);
  const baseAudio = boundedNumber(args.base_audio_track_index, "base_audio_track_index", 0, 99, 0, true);
  const trackPerSpeaker = optionalBoolean(args.track_per_speaker, "track_per_speaker", true);

  const analysis = speakerTurns(timeline.words, { min_turn_seconds: minTurn, merge_gap_seconds: mergeGap });
  const warnings = [...analysis.warnings];
  const labelledOrder = speakerOrder(args.speaker_order, analysis.speakers.filter((label) => label !== UNKNOWN_SPEAKER), warnings);
  const order = analysis.unknown_word_count > 0 ? [...labelledOrder.filter((label) => label !== UNKNOWN_SPEAKER), UNKNOWN_SPEAKER] : labelledOrder;
  const trackFor = (label: string) => order.indexOf(label);

  const handle = handleFrames / fps;
  const segments: Array<{
    index: number;
    speaker_label: string;
    start_seconds: number;
    end_seconds: number;
    start_frame: number;
    end_frame: number;
    video_track_index: number;
    audio_track_index: number;
    requires_move: boolean;
  }> = [];
  let dropped = 0;
  analysis.turns.forEach((turn, index) => {
    const previous = analysis.turns[index - 1];
    const next = analysis.turns[index + 1];
    // Pad outward by the handle, but never past the midpoint of the gap to a
    // neighbouring turn so adjacent segments can never overlap.
    const lower = previous ? Math.max(turn.start_seconds - handle, (previous.end_seconds + turn.start_seconds) / 2) : Math.max(0, turn.start_seconds - handle);
    const upper = next ? Math.min(turn.end_seconds + handle, (turn.end_seconds + next.start_seconds) / 2) : turn.end_seconds + handle;
    const start = snap(lower, fps);
    const end = snap(upper, fps);
    if (end.frame <= start.frame) {
      dropped += 1;
      return;
    }
    const slot = trackPerSpeaker ? trackFor(turn.speaker_label) : segments.length % 2;
    segments.push({
      index: segments.length,
      speaker_label: turn.speaker_label,
      start_seconds: start.seconds,
      end_seconds: end.seconds,
      start_frame: start.frame,
      end_frame: end.frame,
      video_track_index: baseVideo + slot,
      audio_track_index: baseAudio + slot,
      requires_move: slot !== 0,
    });
  });
  if (dropped > 0) warnings.push(`${dropped} turn(s) shorter than one frame at ${fps} fps were dropped from the segment list.`);

  const speakers = order.map((label, slot) => {
    const own = analysis.turns.filter((turn) => turn.speaker_label === label);
    return {
      label,
      track_index: trackPerSpeaker ? baseVideo + slot : null,
      audio_track_index: trackPerSpeaker ? baseAudio + slot : null,
      turn_count: own.length,
      total_seconds: round(own.reduce((sum, turn) => sum + (turn.end_seconds - turn.start_seconds), 0)),
    };
  });
  const extraTracks = trackPerSpeaker ? Math.max(0, order.length - 1) : (segments.length > 1 ? 1 : 0);
  const splitPoints = [...new Set(segments.flatMap((segment) => [segment.start_seconds, segment.end_seconds]))].filter((value) => value > 0).sort((a, b) => a - b);
  const moves = segments.filter((segment) => segment.requires_move);
  const options = { frame_rate: fps, min_turn_seconds: minTurn, merge_gap_seconds: mergeGap, handle_frames: handleFrames, base_video_track_index: baseVideo, base_audio_track_index: baseAudio, track_per_speaker: trackPerSpeaker, speaker_order: order };

  return {
    plan: "speaker_checkerboard" as const,
    applied: false as const,
    plan_revision: digestWordTimeline(timeline, { plan: "speaker_checkerboard", options }),
    evidence: evidenceFor(timeline),
    layout_mode: trackPerSpeaker ? "track_per_speaker" : "alternating",
    frame_rate: fps,
    speakers,
    segments,
    split_points_seconds: splitPoints,
    tracks_to_add: { video: extraTracks, audio: extraTracks },
    statistics: {
      turn_count: analysis.turns.length,
      segment_count: segments.length,
      move_count: moves.length,
      absorbed_interjections: analysis.absorbed_count,
      covered_seconds: round(segments.reduce((sum, segment) => sum + (segment.end_seconds - segment.start_seconds), 0)),
    },
    routes: [
      { order: 1, tool: "get_sequence_structure", purpose: "Confirm the base clip sits on the expected video/audio tracks before cutting." },
      { order: 2, tool: "add_track", purpose: `Add ${extraTracks} video and ${extraTracks} audio track(s) above the base tracks (skip if they already exist).` },
      { order: 3, tool: "razor_all_tracks", purpose: `Razor at each of the ${splitPoints.length} split_points_seconds (track_type: both).` },
      { order: 4, tool: "move_clip_to_track", purpose: `Move the ${moves.length} segment(s) with requires_move to their video_track_index / audio_track_index.` },
    ],
    alternative_routes: [
      { tool: "edit_timeline_uxp", purpose: "Rebuild the checkerboard by inserting each segment's source range onto its track via the UXP SequenceEditor." },
      { tool: "transform_track_item_uxp", purpose: "Move or trim individual track items atomically with stale-position guards." },
      { tool: "create_sequence_from_clips", purpose: "Alternatively build a fresh sequence, then apply this plan to that sequence's base clip." },
    ],
    warnings,
    assumptions: [
      "Segment times are source-clip seconds measured from the clip's first frame; offset them by the clip's sequence in-point before razoring.",
      "Track counts assume the tracks above the base tracks do not exist yet; add_track counts are upper bounds.",
      "Gaps between turns that exceed the handle padding stay on the base track untouched.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Active-speaker reframe
// ---------------------------------------------------------------------------

const REFRAME_KEYS = ["word_timeline", "source_frame", "target_frame", "speaker_regions", "layout", "min_hold_seconds", "switch_lead_seconds", "ease_frames", "frame_rate", "headroom", "base_video_track_index"] as const;
const LAYOUTS: readonly ReframeLayout[] = ["active_speaker", "stacked", "split_left_right", "auto"];

function frameSize(value: unknown, label: string, fallback?: FrameSize): FrameSize {
  if (value === undefined) {
    if (fallback) return fallback;
    fail(`${label} is required`);
  }
  if (!isRecord(value)) fail(`${label} must be an object with width and height`);
  rejectUnknownKeys(value, ["width", "height"], label);
  if (value.width === undefined || value.height === undefined) fail(`${label} requires both width and height`);
  return {
    width: boundedNumber(value.width, `${label}.width`, MIN_FRAME_DIMENSION, MAX_FRAME_DIMENSION, Number.NaN, true),
    height: boundedNumber(value.height, `${label}.height`, MIN_FRAME_DIMENSION, MAX_FRAME_DIMENSION, Number.NaN, true),
  };
}

function speakerRegions(value: unknown): SpeakerRegion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SPEAKER_REGIONS) fail(`speaker_regions must contain between 1 and ${MAX_SPEAKER_REGIONS} regions`);
  const labels = new Set<string>();
  return value.map((entry, index) => {
    const label = `speaker_regions[${index}]`;
    if (!isRecord(entry)) fail(`${label} must be an object`);
    rejectUnknownKeys(entry, ["speaker_label", "x", "y", "width", "height"], label);
    if (typeof entry.speaker_label !== "string" || !entry.speaker_label.trim() || entry.speaker_label.length > 128) fail(`${label}.speaker_label must be a non-empty string of at most 128 characters`);
    const speaker = entry.speaker_label.trim();
    if (labels.has(speaker)) fail(`speaker_regions contains duplicate speaker_label: ${speaker}`);
    labels.add(speaker);
    const region = {
      speaker_label: speaker,
      x: boundedNumber(entry.x, `${label}.x`, 0, 1, Number.NaN),
      y: boundedNumber(entry.y, `${label}.y`, 0, 1, Number.NaN),
      width: boundedNumber(entry.width, `${label}.width`, 0, 1, Number.NaN),
      height: boundedNumber(entry.height, `${label}.height`, 0, 1, Number.NaN),
    };
    if (region.width <= 0 || region.height <= 0) fail(`${label} width and height must be greater than 0`);
    if (region.x + region.width > 1 + EPSILON || region.y + region.height > 1 + EPSILON) fail(`${label} must lie inside the normalized source frame`);
    return region;
  });
}

/**
 * Computes the crop window and Motion values that frame `region` inside a
 * window of `aspect` (= window width / window height) whose scaled height
 * lands on `windowTargetHeight` pixels centred at `windowCenter` in the
 * target sequence.
 *
 *   region px:   rx = x*W, ry = y*H, rw = width*W, rh = height*H
 *   crop height: ch = max(rh / (1 - headroom), rw / aspect), clamped to H and W/aspect
 *   crop width:  cw = ch * aspect
 *   crop top:    ry - headroom*ch   (headroom fraction of ch above the region top)
 *   crop left:   region centre x - cw/2, both clamped inside the frame
 *   scale %:     windowTargetHeight / ch * 100          (uniform)
 *   position:    Premiere Motion position is the sequence-space location of the
 *                clip's anchor (the source frame centre), so
 *                pos = windowCenter - (cropCenter - sourceCenter) * scale/100
 */
export function framingForRegion(region: SpeakerRegion, source: FrameSize, aspect: number, headroom: number, windowTargetHeight: number, windowCenter: { x: number; y: number }): SpeakerFraming {
  const W = source.width;
  const H = source.height;
  const rx = region.x * W;
  const ry = region.y * H;
  const rw = region.width * W;
  const rh = region.height * H;
  const needed = Math.max(rh / (1 - headroom), rw / aspect);
  const ch = Math.min(needed, H, W / aspect);
  const cw = ch * aspect;
  const top = Math.min(Math.max(0, ry - headroom * ch), H - ch);
  const left = Math.min(Math.max(0, rx + rw / 2 - cw / 2), W - cw);
  const scale = (windowTargetHeight / ch) * 100;
  const cropCx = left + cw / 2;
  const cropCy = top + ch / 2;
  const fits = needed <= ch + EPSILON;
  return {
    speaker_label: region.speaker_label,
    crop_source_px: { left: round(left, 3), top: round(top, 3), width: round(cw, 3), height: round(ch, 3) },
    crop_percent: {
      left: round((left / W) * 100, 4),
      top: round((top / H) * 100, 4),
      right: round(((W - left - cw) / W) * 100, 4),
      bottom: round(((H - top - ch) / H) * 100, 4),
    },
    scale_percent: round(scale, 4),
    position: {
      x: round(windowCenter.x - (cropCx - W / 2) * (scale / 100), 3),
      y: round(windowCenter.y - (cropCy - H / 2) * (scale / 100), 3),
    },
    region_fits: fits,
  };
}

export function planActiveSpeakerReframe(args: Record<string, unknown>) {
  if (!isRecord(args)) fail("arguments must be an object");
  rejectUnknownKeys(args, REFRAME_KEYS, "arguments");
  const timeline = validateWordTimeline(args.word_timeline);
  const source = frameSize(args.source_frame, "source_frame");
  const target = frameSize(args.target_frame, "target_frame", { width: 1080, height: 1920 });
  const regions = speakerRegions(args.speaker_regions);
  const layoutInput = args.layout === undefined ? "auto" : args.layout;
  if (typeof layoutInput !== "string" || !LAYOUTS.includes(layoutInput as ReframeLayout)) fail(`layout must be one of ${LAYOUTS.join(", ")}`);
  const minHold = boundedNumber(args.min_hold_seconds, "min_hold_seconds", 0.5, 10, 1.5);
  const lead = boundedNumber(args.switch_lead_seconds, "switch_lead_seconds", 0, 1, 0.15);
  const easeFrames = boundedNumber(args.ease_frames, "ease_frames", 0, 30, 0, true);
  const fps = frameRate(args.frame_rate);
  const headroom = boundedNumber(args.headroom, "headroom", 0, 0.5, 0.12);
  const baseVideo = boundedNumber(args.base_video_track_index, "base_video_track_index", 0, 99, 0, true);

  const analysis = speakerTurns(timeline.words, { min_turn_seconds: minHold, merge_gap_seconds: 0.5 });
  const warnings = [...analysis.warnings];
  const regionFor = new Map(regions.map((region) => [region.speaker_label, region]));
  const appearing = analysis.speakers.filter((label) => label !== UNKNOWN_SPEAKER);
  const missing = appearing.filter((label) => !regionFor.has(label));
  if (missing.length) fail(`speaker_regions is missing a region for speaker(s): ${missing.join(", ")}`);
  const unusedRegions = regions.filter((region) => !appearing.includes(region.speaker_label)).map((region) => region.speaker_label);
  if (unusedRegions.length) warnings.push(`speaker_regions includes speaker(s) that never speak in this transcript: ${unusedRegions.join(", ")}.`);
  if (analysis.unknown_word_count > 0 && !regionFor.has(UNKNOWN_SPEAKER)) warnings.push(`Turns by "${UNKNOWN_SPEAKER}" have no region and keep the previous speaker's framing.`);

  let layout: Exclude<ReframeLayout, "auto">;
  if (layoutInput === "auto") {
    const wide = regions.some((region) => region.width > 0.6);
    layout = regions.length >= 3 || wide ? "active_speaker" : regions.length === 2 ? "stacked" : "active_speaker";
  } else layout = layoutInput as Exclude<ReframeLayout, "auto">;
  if (layout !== "active_speaker" && regions.length !== 2) fail(`layout ${layout} requires exactly 2 speaker_regions; use active_speaker`);

  const options = { source_frame: source, target_frame: target, speaker_regions: regions, layout, min_hold_seconds: minHold, switch_lead_seconds: lead, ease_frames: easeFrames, frame_rate: fps, headroom, base_video_track_index: baseVideo };
  const base = {
    plan: "active_speaker_reframe" as const,
    applied: false as const,
    plan_revision: digestWordTimeline(timeline, { plan: "active_speaker_reframe", options }),
    evidence: evidenceFor(timeline),
    layout,
    layout_requested: layoutInput,
    source_frame: source,
    target_frame: target,
    frame_rate: fps,
  };
  const assumptions = [
    "Speaker regions are static for the whole clip; no face tracking or motion analysis is performed.",
    "The source clip is placed unmodified in a sequence with target_frame dimensions before Motion values are applied.",
    "Position values are in sequence pixels with the clip anchor at the source frame centre (Premiere Motion default).",
  ];

  if (layout === "active_speaker") {
    const aspect = target.width / target.height;
    const center = { x: target.width / 2, y: target.height / 2 };
    const framings = regions.map((region) => framingForRegion(region, source, aspect, headroom, target.height, center));
    const framingFor = new Map(framings.map((framing) => [framing.speaker_label, framing]));
    for (const framing of framings) if (!framing.region_fits) warnings.push(`Region for "${framing.speaker_label}" is larger than the source frame allows at the target aspect; the crop was clamped.`);

    const switches: Array<{ time_seconds: number; frame: number; speaker_label: string; reason: "initial" | "turn_start" | "delayed_for_min_hold" }> = [];
    let absorbed = analysis.absorbed_count;
    for (const turn of analysis.turns) {
      if (!framingFor.has(turn.speaker_label)) { absorbed += 1; continue; }
      const previous = switches[switches.length - 1];
      if (!previous) { switches.push({ time_seconds: 0, frame: 0, speaker_label: turn.speaker_label, reason: "initial" }); continue; }
      if (previous.speaker_label === turn.speaker_label) continue;
      let candidate = snap(Math.max(0, turn.start_seconds - lead), fps);
      let reason: "turn_start" | "delayed_for_min_hold" = "turn_start";
      if (candidate.seconds - previous.time_seconds < minHold - EPSILON) {
        candidate = snap(previous.time_seconds + minHold, fps, "ceil");
        reason = "delayed_for_min_hold";
      }
      // A switch must itself be holdable for min_hold_seconds; otherwise the
      // turn (a trailing interjection or a delayed sliver) keeps the prior shot.
      if (turn.end_seconds - candidate.seconds < minHold - EPSILON) { absorbed += 1; continue; }
      switches.push({ time_seconds: candidate.seconds, frame: candidate.frame, speaker_label: turn.speaker_label, reason });
    }

    const ease = easeFrames / fps;
    const keyframes: MotionKeyframe[] = [];
    const interpolation: MotionKeyframe["interpolation"] = easeFrames > 0 ? "bezier" : "hold";
    switches.forEach((sw, index) => {
      const framing = framingFor.get(sw.speaker_label)!;
      if (index > 0 && easeFrames > 0) {
        const prior = framingFor.get(switches[index - 1].speaker_label)!;
        const from = snap(Math.max(switches[index - 1].time_seconds, sw.time_seconds - ease), fps);
        if (from.frame < sw.frame) {
          keyframes.push({ time_seconds: from.seconds, frame: from.frame, property: "Scale", value: prior.scale_percent, interpolation });
          keyframes.push({ time_seconds: from.seconds, frame: from.frame, property: "Position", value: prior.position, interpolation });
        }
      }
      keyframes.push({ time_seconds: sw.time_seconds, frame: sw.frame, property: "Scale", value: framing.scale_percent, interpolation });
      keyframes.push({ time_seconds: sw.time_seconds, frame: sw.frame, property: "Position", value: framing.position, interpolation });
    });

    const coverage: Record<string, number> = {};
    switches.forEach((sw, index) => {
      const end = index + 1 < switches.length ? switches[index + 1].time_seconds : Math.max(timeline.duration_seconds, sw.time_seconds);
      coverage[sw.speaker_label] = round((coverage[sw.speaker_label] ?? 0) + (end - sw.time_seconds));
    });

    return {
      ...base,
      framings,
      switches,
      keyframes,
      absorbed_turns: absorbed,
      coverage: { seconds_by_speaker: coverage, duration_seconds: round(timeline.duration_seconds) },
      routes: [
        { order: 1, tool: "create_sequence_from_preset", purpose: `Create (or set_sequence_settings on) a ${target.width}x${target.height} sequence and place the source clip on video track ${baseVideo}.` },
        { order: 2, tool: "set_clip_scale", purpose: "Set the initial Scale from keyframes[0] (uniform scale)." },
        { order: 3, tool: "set_clip_position", purpose: "Set the initial Position from keyframes[1]." },
        { order: 4, tool: "add_keyframe", purpose: `Add each of the ${keyframes.length} Motion keyframes (property Scale or Position) at time_seconds with the listed interpolation.` },
      ],
      alternative_routes: [
        { tool: "automate_effect_parameters_uxp", purpose: "Add the same Scale/Position keyframes through the UXP effect-parameter API (add_keyframe / set_point_value)." },
        { tool: "auto_reframe_sequence", purpose: "Fallback when speaker regions are unreliable: let Premiere's motion-tracking reframe drive the crop instead." },
      ],
      warnings,
      assumptions,
    };
  }

  const stacked = layout === "stacked";
  const windowWidth = stacked ? target.width : target.width / 2;
  const windowHeight = stacked ? target.height / 2 : target.height;
  const aspect = windowWidth / windowHeight;
  const layers = regions.map((region, index) => {
    const center = stacked ? { x: target.width / 2, y: windowHeight * (index + 0.5) } : { x: windowWidth * (index + 0.5), y: target.height / 2 };
    const framing = framingForRegion(region, source, aspect, headroom, windowHeight, center);
    if (!framing.region_fits) warnings.push(`Region for "${region.speaker_label}" is larger than the source frame allows at the ${layout} window aspect; the crop was clamped.`);
    return {
      speaker_label: region.speaker_label,
      video_track_index: baseVideo + index,
      crop: framing.crop_percent,
      crop_source_px: framing.crop_source_px,
      scale_percent: framing.scale_percent,
      position: framing.position,
      target_rect: stacked
        ? { x: 0, y: round(windowHeight * index, 3), width: target.width, height: round(windowHeight, 3) }
        : { x: round(windowWidth * index, 3), y: 0, width: round(windowWidth, 3), height: target.height },
    };
  });
  const coverage: Record<string, number> = {};
  for (const turn of analysis.turns) coverage[turn.speaker_label] = round((coverage[turn.speaker_label] ?? 0) + (turn.end_seconds - turn.start_seconds));

  return {
    ...base,
    layers,
    switches: [] as Array<never>,
    keyframes: [] as MotionKeyframe[],
    absorbed_turns: analysis.absorbed_count,
    coverage: { seconds_by_speaker: coverage, duration_seconds: round(timeline.duration_seconds) },
    routes: [
      { order: 1, tool: "create_sequence_from_preset", purpose: `Create (or set_sequence_settings on) a ${target.width}x${target.height} sequence and place the source clip on video track ${baseVideo}.` },
      { order: 2, tool: "duplicate_clip", purpose: "Duplicate the same source clip once per additional layer so both layers share one source (or add_to_timeline the item again)." },
      { order: 3, tool: "crop_clip", purpose: "Apply each layer's crop (left/top/right/bottom percents) on its video_track_index." },
      { order: 4, tool: "set_clip_scale", purpose: "Set each layer's uniform scale_percent." },
      { order: 5, tool: "set_clip_position", purpose: "Set each layer's position so its crop window fills target_rect." },
    ],
    alternative_routes: [
      { tool: "transform_track_item_uxp", purpose: "Place/trim the duplicated layers atomically with readback." },
      { tool: "auto_reframe_sequence", purpose: "Fallback single-layer reframe when a static split is not wanted." },
    ],
    warnings,
    assumptions: [...assumptions, "Both layers reference the same source clip; crop_clip only masks pixels so the Motion anchor stays at the source centre."],
  };
}
