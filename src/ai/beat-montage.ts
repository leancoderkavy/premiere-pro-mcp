import { createHash } from "node:crypto";
import { secondsToFrame } from "./word-timeline.js";

/**
 * Plan-only beat-synced montage assembly.
 *
 * Walks a caller-supplied beat grid (typically from detect_beats), carves it
 * into shots of `cut_every_n_beats`, and assigns source clips to those shots.
 * Pure local arithmetic: nothing here touches Premiere. The output is shaped
 * for add_to_timeline_batch, trim_clip / set_item_in_out, and
 * apply_beat_markers_uxp.
 */

export type MontageOrder = "as_given" | "priority" | "round_robin";

export type MontageClip = { item_id: string; duration_seconds: number; in_seconds: number; priority: number | null; index: number };

export type MontagePlacement = {
  index: number;
  item_id: string;
  clip_index: number;
  track_index: number;
  audio_track_index: number;
  start_seconds: number;
  end_seconds: number;
  in_seconds: number;
  out_seconds: number;
  duration_seconds: number;
  beat_index_start: number;
  beat_index_end: number;
  ends_on_beat: boolean;
};

export type BeatMontageOptions = {
  cut_every_n_beats: number;
  min_shot_seconds: number;
  max_shot_seconds: number;
  start_beat_index: number;
  order: MontageOrder;
  allow_reuse: boolean;
  video_track_index: number;
  audio_track_index: number;
  frame_rate: number;
  total_duration_seconds: number | null;
};

export type BeatMontagePlan = {
  applied: false;
  plan_revision: string;
  options: BeatMontageOptions;
  placements: MontagePlacement[];
  batches: Array<Array<{ item_id: string; track_index: number; start_seconds: number; audio_track_index: number }>>;
  trim_plan: Array<{ placement_index: number; item_id: string; in_seconds: number; out_seconds: number; set_item_in_out: { item_id: string; in_seconds: number; out_seconds: number }; trim_clip_after_insert: { new_in_seconds: number; new_out_seconds: number } }>;
  markers: { name_prefix: string; cut_times_seconds: number[]; batches: number[][] };
  coverage_seconds: number;
  montage_start_seconds: number;
  montage_end_seconds: number;
  shot_count: number;
  unused_clips: Array<{ clip_index: number; item_id: string; reason: string }>;
  counts: { beats: number; clips: number; shots: number; batches: number; reused_shots: number };
  evidence: Record<string, unknown>;
  routes: string[];
  next_steps: string[];
  warnings: string[];
  assumptions: string[];
};

export const MAX_BEATS = 5000;
export const MIN_BEATS = 2;
export const MAX_CLIPS = 256;
export const BATCH_LIMIT = 32;
export const MARKER_BATCH_LIMIT = 512;
const MAX_SECONDS = 86_400;
const ORDERS: readonly MontageOrder[] = ["as_given", "priority", "round_robin"];

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

export function normalizeBeatSeconds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < MIN_BEATS || value.length > MAX_BEATS) fail(`beat_seconds must contain between ${MIN_BEATS} and ${MAX_BEATS} numbers`);
  const beats = value.map((entry, index) => round6(numberIn(entry, `beat_seconds[${index}]`, 0, MAX_SECONDS, undefined)));
  for (let index = 1; index < beats.length; index += 1) if (beats[index] <= beats[index - 1]) fail(`beat_seconds must be strictly ascending (violation at index ${index})`);
  return beats;
}

export function normalizeMontageClips(value: unknown): MontageClip[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CLIPS) fail(`clips must contain between 1 and ${MAX_CLIPS} entries`);
  return value.map((raw, index) => {
    const label = `clips[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${label} must be an object`);
    const clip = raw as Record<string, unknown>;
    for (const key of Object.keys(clip)) if (!["item_id", "duration_seconds", "in_seconds", "priority"].includes(key)) fail(`${label} has an unknown field: ${key}`);
    if (typeof clip.item_id !== "string" || !clip.item_id.trim() || clip.item_id.length > 512) fail(`${label}.item_id must be a non-empty string of at most 512 characters`);
    const duration = numberIn(clip.duration_seconds, `${label}.duration_seconds`, 0, MAX_SECONDS, undefined);
    if (duration <= 0) fail(`${label}.duration_seconds must be greater than 0`);
    const inSeconds = numberIn(clip.in_seconds, `${label}.in_seconds`, 0, MAX_SECONDS, 0);
    if (inSeconds >= duration) fail(`${label}.in_seconds must be less than duration_seconds`);
    const priority = clip.priority === undefined ? null : numberIn(clip.priority, `${label}.priority`, -1_000_000, 1_000_000, undefined, true);
    return { item_id: clip.item_id.trim(), duration_seconds: round6(duration), in_seconds: round6(inSeconds), priority, index };
  });
}

export function normalizeBeatMontageOptions(args: Record<string, unknown>, beatCount: number): BeatMontageOptions {
  const minShot = numberIn(args.min_shot_seconds, "min_shot_seconds", 0.05, 60, 0.4);
  const maxShot = numberIn(args.max_shot_seconds, "max_shot_seconds", 0.05, 600, 6);
  if (maxShot < minShot) fail("max_shot_seconds must be at least min_shot_seconds");
  const order = args.order === undefined ? "as_given" : args.order;
  if (typeof order !== "string" || !ORDERS.includes(order as MontageOrder)) fail(`order must be one of ${ORDERS.join(", ")}`);
  if (args.allow_reuse !== undefined && typeof args.allow_reuse !== "boolean") fail("allow_reuse must be a boolean");
  return {
    cut_every_n_beats: numberIn(args.cut_every_n_beats, "cut_every_n_beats", 1, 16, 2, true),
    min_shot_seconds: minShot,
    max_shot_seconds: maxShot,
    start_beat_index: numberIn(args.start_beat_index, "start_beat_index", 0, Math.max(0, beatCount - 2), 0, true),
    order: order as MontageOrder,
    allow_reuse: args.allow_reuse === true,
    video_track_index: numberIn(args.video_track_index, "video_track_index", 0, 99, 0, true),
    audio_track_index: numberIn(args.audio_track_index, "audio_track_index", 0, 99, 0, true),
    frame_rate: numberIn(args.frame_rate, "frame_rate", 1, 240, 30),
    total_duration_seconds: args.total_duration_seconds === undefined ? null : (() => {
      const cap = numberIn(args.total_duration_seconds, "total_duration_seconds", 0, MAX_SECONDS, undefined);
      if (cap <= 0) fail("total_duration_seconds must be greater than 0");
      return cap;
    })(),
  };
}

/** Deterministic clip ordering for the requested strategy. */
export function orderMontageClips(clips: readonly MontageClip[], order: MontageOrder): MontageClip[] {
  if (order === "as_given") return [...clips];
  const priorityOf = (clip: MontageClip) => clip.priority ?? 0;
  if (order === "priority") return [...clips].sort((a, b) => priorityOf(b) - priorityOf(a) || a.index - b.index);
  // round_robin: interleave priority groups (highest first) so no group dominates a run of shots.
  const groups = new Map<number, MontageClip[]>();
  for (const clip of clips) groups.set(priorityOf(clip), [...(groups.get(priorityOf(clip)) ?? []), clip]);
  const queues = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, list]) => list);
  const out: MontageClip[] = [];
  let remaining = clips.length;
  while (remaining > 0) for (const queue of queues) { const next = queue.shift(); if (next) { out.push(next); remaining -= 1; } }
  return out;
}

export type BeatSlot = { beat_index_start: number; beat_index_end: number; start_frame: number; end_frame: number };

/**
 * Carves the beat grid into shot slots. Each slot nominally spans
 * `cut_every_n_beats` beats; slots shorter than `min_shot_seconds` absorb the
 * following beats, and slots longer than `max_shot_seconds` are split at the
 * last intermediate beat that still fits.
 */
type SlotStats = { merged: number; split: number; oversized: number; dropped_tail: string | null };

function emptyStats(): SlotStats {
  return { merged: 0, split: 0, oversized: 0, dropped_tail: null };
}

/** Next slot starting at beat `index`, or null when the grid is exhausted. */
export function nextBeatSlot(beats: readonly number[], frames: readonly number[], index: number, options: BeatMontageOptions, stats: SlotStats): BeatSlot | null {
  const last = beats.length - 1;
  while (index < last) {
    let end = Math.min(index + options.cut_every_n_beats, last);
    while (beats[end] - beats[index] < options.min_shot_seconds - 1e-9 && end < last) { end = Math.min(end + options.cut_every_n_beats, last); stats.merged += 1; }
    if (beats[end] - beats[index] < options.min_shot_seconds - 1e-9) {
      stats.dropped_tail = `Trailing span from beat ${index} to ${end} (${round6(beats[end] - beats[index])}s) is shorter than min_shot_seconds and was dropped.`;
      return null;
    }
    if (beats[end] - beats[index] > options.max_shot_seconds + 1e-9) {
      let fit = end;
      while (fit > index + 1 && beats[fit] - beats[index] > options.max_shot_seconds + 1e-9) fit -= 1;
      if (beats[fit] - beats[index] > options.max_shot_seconds + 1e-9) stats.oversized += 1;
      else stats.split += 1;
      end = fit;
    }
    if (frames[end] > frames[index]) return { beat_index_start: index, beat_index_end: end, start_frame: frames[index], end_frame: frames[end] };
    index = end;
  }
  return null;
}

function slotWarnings(stats: SlotStats, options: BeatMontageOptions, warnings: string[]) {
  if (stats.merged > 0) warnings.push(`${stats.merged} slot(s) were merged with following beats to satisfy min_shot_seconds=${options.min_shot_seconds}.`);
  if (stats.split > 0) warnings.push(`${stats.split} slot(s) were split at intermediate beats to satisfy max_shot_seconds=${options.max_shot_seconds}.`);
  if (stats.oversized > 0) warnings.push(`${stats.oversized} shot(s) exceed max_shot_seconds because adjacent beats are further apart than the limit.`);
  if (stats.dropped_tail) warnings.push(stats.dropped_tail);
}

export function buildBeatSlots(beats: readonly number[], options: BeatMontageOptions, warnings: string[]): BeatSlot[] {
  const frames = beats.map((beat) => secondsToFrame(beat, options.frame_rate));
  const stats = emptyStats();
  const slots: BeatSlot[] = [];
  let index = options.start_beat_index;
  for (let slot = nextBeatSlot(beats, frames, index, options, stats); slot; slot = nextBeatSlot(beats, frames, index, options, stats)) {
    slots.push(slot);
    index = slot.beat_index_end;
  }
  slotWarnings(stats, options, warnings);
  return slots;
}

export function planBeatMontage(args: Record<string, unknown>): BeatMontagePlan {
  const beats = normalizeBeatSeconds(args.beat_seconds);
  const clips = normalizeMontageClips(args.clips);
  const options = normalizeBeatMontageOptions(args, beats.length);
  const warnings: string[] = [];
  const fps = options.frame_rate;
  const secondsAt = (frame: number) => round6(frame / fps);
  const ordered = orderMontageClips(clips, options.order);
  const beatFrames = beats.map((beat) => secondsToFrame(beat, fps));
  const minShotFrames = Math.max(1, secondsToFrame(options.min_shot_seconds, fps));
  const montageStartFrame = beatFrames[options.start_beat_index];
  const capFrame = options.total_duration_seconds === null ? Number.POSITIVE_INFINITY : montageStartFrame + secondsToFrame(options.total_duration_seconds, fps, "floor");
  const stats = emptyStats();

  const placements: MontagePlacement[] = [];
  const consumed = new Map<number, number>(); // clip index -> next in point (frames) for progressive reuse
  const used = new Set<number>();
  const skipped = new Map<number, string>();
  let pointer = 0;
  let cycles = 0;
  let reusedShots = 0;
  let stoppedReason: string | null = null;
  let cursor = options.start_beat_index;
  let gapFrames = 0;

  for (let slot = nextBeatSlot(beats, beatFrames, cursor, options, stats); slot; slot = nextBeatSlot(beats, beatFrames, cursor, options, stats)) {
    const startFrame = slot.start_frame;
    let endFrame = slot.end_frame;
    cursor = slot.beat_index_end;
    if (startFrame >= capFrame) { stoppedReason = "total_duration_seconds reached"; break; }
    let truncatedByCap = false;
    if (endFrame > capFrame) { endFrame = capFrame; truncatedByCap = true; }
    if (endFrame - startFrame < 1) continue;

    let clip: MontageClip | null = null;
    let inFrame = 0;
    let availableFrames = 0;
    while (clip === null) {
      if (pointer >= ordered.length) {
        if (!options.allow_reuse) { stoppedReason = `clips exhausted after ${placements.length} shot(s); set allow_reuse to cycle`; break; }
        if (used.size === 0) { stoppedReason = "no clip is long enough for min_shot_seconds"; break; }
        pointer = 0;
        cycles += 1;
      }
      const candidate = ordered[pointer];
      pointer += 1;
      const originalIn = secondsToFrame(candidate.in_seconds, fps);
      const durationFrame = secondsToFrame(candidate.duration_seconds, fps, "floor");
      let nextIn = consumed.get(candidate.index) ?? originalIn;
      if (durationFrame - nextIn < minShotFrames) nextIn = originalIn;
      if (durationFrame - nextIn < minShotFrames) {
        if (!skipped.has(candidate.index)) skipped.set(candidate.index, "shorter than min_shot_seconds");
        continue;
      }
      clip = candidate;
      inFrame = nextIn;
      availableFrames = durationFrame - nextIn;
    }
    if (clip === null) break;

    let durationFrames = endFrame - startFrame;
    let endsOnBeat = !truncatedByCap;
    let beatIndexEnd = slot.beat_index_end;
    if (availableFrames < durationFrames) {
      durationFrames = availableFrames;
      endFrame = startFrame + durationFrames;
      endsOnBeat = false;
      // Resume on the next beat at or after the clip's end; any frames between are left as a gap.
      let next = slot.beat_index_start + 1;
      while (next < beatFrames.length && beatFrames[next] < endFrame) next += 1;
      beatIndexEnd = Math.min(next, beatFrames.length - 1);
      if (next < beatFrames.length) gapFrames += beatFrames[next] - endFrame;
      cursor = next;
      warnings.push(`Shot ${placements.length}: clip ${clip.item_id} is shorter than its slot; trimmed to ${secondsAt(durationFrames)}s and the next shot resumes at beat ${next}.`);
    }
    if (cycles > 0) reusedShots += 1;
    used.add(clip.index);
    consumed.set(clip.index, inFrame + durationFrames);
    placements.push({
      index: placements.length,
      item_id: clip.item_id,
      clip_index: clip.index,
      track_index: options.video_track_index,
      audio_track_index: options.audio_track_index,
      start_seconds: secondsAt(startFrame),
      end_seconds: secondsAt(endFrame),
      in_seconds: secondsAt(inFrame),
      out_seconds: secondsAt(inFrame + durationFrames),
      duration_seconds: secondsAt(durationFrames),
      beat_index_start: slot.beat_index_start,
      beat_index_end: beatIndexEnd,
      ends_on_beat: endsOnBeat,
    });
    if (truncatedByCap) { stoppedReason = "total_duration_seconds reached"; break; }
  }

  slotWarnings(stats, options, warnings);
  if (gapFrames > 0) warnings.push(`${gapFrames} frame(s) of timeline are left empty where short clips ended before the next beat.`);
  if (stoppedReason) warnings.push(`Montage stopped early: ${stoppedReason}.`);
  if (placements.length === 0) warnings.push("No shots were placed; check beat spacing, clip durations, and min_shot_seconds.");

  const unused = clips.filter((clip) => !used.has(clip.index)).map((clip) => ({ clip_index: clip.index, item_id: clip.item_id, reason: skipped.get(clip.index) ?? "not reached before the montage ended" }));
  const batches: BeatMontagePlan["batches"] = [];
  for (let start = 0; start < placements.length; start += BATCH_LIMIT) {
    batches.push(placements.slice(start, start + BATCH_LIMIT).map((placement) => ({ item_id: placement.item_id, track_index: placement.track_index, start_seconds: placement.start_seconds, audio_track_index: placement.audio_track_index })));
  }
  const cutTimes = placements.map((placement) => placement.start_seconds);
  const markerBatches: number[][] = [];
  for (let start = 0; start < cutTimes.length; start += MARKER_BATCH_LIMIT) markerBatches.push(cutTimes.slice(start, start + MARKER_BATCH_LIMIT));
  const coverage = round6(placements.reduce((total, placement) => total + placement.duration_seconds, 0));
  const repeatedItems = new Set(placements.map((placement) => placement.item_id)).size < placements.length;
  if (repeatedItems) warnings.push("Some placements reuse the same item_id with different in/out ranges; apply those one at a time (set_item_in_out then add_to_timeline) or trim after insertion with trim_clip.");

  const planRevision = digest({ beats, clips, options });
  return {
    applied: false,
    plan_revision: planRevision,
    options,
    placements,
    batches,
    trim_plan: placements.map((placement) => ({ placement_index: placement.index, item_id: placement.item_id, in_seconds: placement.in_seconds, out_seconds: placement.out_seconds, set_item_in_out: { item_id: placement.item_id, in_seconds: placement.in_seconds, out_seconds: placement.out_seconds }, trim_clip_after_insert: { new_in_seconds: placement.in_seconds, new_out_seconds: placement.out_seconds } })),
    markers: { name_prefix: "Cut", cut_times_seconds: cutTimes, batches: markerBatches },
    coverage_seconds: coverage,
    montage_start_seconds: placements.length ? placements[0].start_seconds : secondsAt(montageStartFrame),
    montage_end_seconds: placements.length ? placements[placements.length - 1].end_seconds : secondsAt(montageStartFrame),
    shot_count: placements.length,
    unused_clips: unused,
    counts: { beats: beats.length, clips: clips.length, shots: placements.length, batches: batches.length, reused_shots: reusedShots },
    evidence: { beat_count: beats.length, first_beat_seconds: beats[0], last_beat_seconds: beats[beats.length - 1], beat_digest: digest(beats), clip_count: clips.length, clip_digest: digest(clips), plan_revision: planRevision },
    routes: ["add_to_timeline_batch", "add_to_timeline", "set_item_in_out", "trim_clip", "apply_beat_markers_uxp", "get_sequence_structure"],
    next_steps: [
      "Optionally apply markers.batches with apply_beat_markers_uxp (beat_times_seconds, name_prefix) to visualise the cut grid before assembling.",
      "For each placement: set_item_in_out(item_id, in_seconds, out_seconds), then insert via add_to_timeline_batch using the matching batches[] chunk (max 32 per call) or add_to_timeline; alternatively insert first and apply trim_plan[*].trim_clip_after_insert with trim_clip on each inserted node_id.",
      "Verify with get_sequence_structure that each placement's start_seconds and duration_seconds landed on the expected beat.",
    ],
    warnings,
    assumptions: [
      "beat_seconds are sequence-time positions of the music already placed on the timeline (add any offset before calling).",
      "Shot boundaries and clip in/out points are snapped to whole frames at frame_rate.",
      "When allow_reuse is true, a reused clip continues from where it last stopped and restarts from in_seconds only when the remainder is shorter than min_shot_seconds.",
      "Video and audio track indices apply to every placement; add_to_timeline_batch performs insert edits, so apply in order onto an otherwise empty region.",
    ],
  };
}
