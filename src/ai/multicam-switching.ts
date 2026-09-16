import { createHash } from "node:crypto";

/**
 * Active-speaker multicam switching plan (local-only).
 *
 * Podcast and interview editors stack one synced camera per video track and
 * then spend hours enabling/disabling clips so the on-air camera follows the
 * conversation. Given speaker segments (from a transcript, diarization, or a
 * speaker-turn plan) and a camera → speaker map, this planner produces an
 * angle cut list: it holds each angle for a minimum time, cuts to a cover or
 * two-shot on crosstalk, optionally leads the incoming speaker, and inserts
 * periodic cover cutaways during long monologues.
 *
 * Premiere exposes no scripting API for switching angles inside a multicam
 * source sequence, so the plan targets stacked camera tracks and is applied
 * with razor, selection, enable/disable, and marker tools. Nothing here
 * contacts Premiere, a model, or the network.
 */

export const MAX_SPEAKER_SEGMENTS = 5_000;
export const MAX_CAMERAS = 16;
export const MAX_SPEAKER_LABEL_LENGTH = 64;
export const MAX_CAMERA_ID_LENGTH = 64;
export const CAMERA_ROLES = ["single", "two_shot", "wide"] as const;
export type CameraRole = (typeof CAMERA_ROLES)[number];

export const CUT_REASONS = ["speaker", "overlap_cover", "cutaway", "silence_hold", "unmapped_speaker_fallback", "lead_in"] as const;
export type CutReason = (typeof CUT_REASONS)[number];

export const MULTICAM_ROUTES = Object.freeze([
  "create_sequence_checkpoint",
  "razor_all_tracks",
  "select_clips_in_range",
  "batch_enable_disable",
  "add_markers_batch",
  "get_sequence_structure",
]);

const EPSILON = 1e-6;

export type SpeakerSegmentInput = { speaker?: unknown; start_seconds?: unknown; end_seconds?: unknown };
export type CameraInput = { camera_id?: unknown; speakers?: unknown; role?: unknown; video_track_index?: unknown; label?: unknown };

export type MulticamOptions = {
  speaker_segments?: unknown;
  cameras?: unknown;
  frame_rate?: unknown;
  min_hold_seconds?: unknown;
  start_seconds?: unknown;
  total_duration_seconds?: unknown;
  cover_on_overlap?: unknown;
  overlap_min_seconds?: unknown;
  lead_switch_seconds?: unknown;
  cutaway_every_seconds?: unknown;
  cutaway_seconds?: unknown;
  marker_color?: unknown;
};

export type Camera = {
  camera_id: string;
  label: string;
  role: CameraRole;
  speakers: string[];
  video_track_index: number | null;
};

export type AngleCut = {
  index: number;
  camera_id: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  start_frame: number;
  end_frame: number;
  start_timecode: string;
  reason: CutReason;
  speakers: string[];
};

export type CameraUsage = Camera & {
  cut_count: number;
  on_air_seconds: number;
  on_air_percent: number;
};

export type EnableRange = { start_seconds: number; end_seconds: number };

export type MulticamPlan = {
  applied: boolean;
  plan_revision: string;
  frame_rate: number;
  start_seconds: number;
  duration_seconds: number;
  cameras: CameraUsage[];
  cuts: AngleCut[];
  switch_times_seconds: number[];
  razor_plan: { tool: "razor_all_tracks"; times_seconds: number[] };
  enable_plan: Array<{ camera_id: string; video_track_index: number | null; enabled_ranges: EnableRange[]; disabled_ranges: EnableRange[] }>;
  markers: Array<{ time_seconds: number; name: string; comments: string; color: number; duration_seconds: number }>;
  apply_steps: string[];
  stats: {
    cut_count: number;
    switch_count: number;
    switches_per_minute: number;
    average_hold_seconds: number;
    shortest_hold_seconds: number;
    longest_hold_seconds: number;
    overlap_cover_count: number;
    cutaway_count: number;
    unmapped_speakers: string[];
  };
  routes: readonly string[];
  next_steps: string[];
  warnings: string[];
  assumptions: string[];
};

type Segment = { speaker: string; start: number; end: number };
type Interval = { start: number; end: number; speakers: string[] };
type Draft = { camera: string; start: number; end: number; reason: CutReason; speakers: string[] };

function fail(message: string): never {
  throw new Error(message);
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function shortString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) fail(`${label} must be a non-empty string of at most ${maxLength} characters`);
  return value.trim();
}

function timecode(seconds: number, fps: number): string {
  const totalFrames = Math.round(seconds * fps);
  const nominal = Math.round(fps);
  const frames = totalFrames % nominal;
  const total = Math.floor(totalFrames / nominal);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}:${pad(frames)}`;
}

function parseSegments(value: unknown): Segment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SPEAKER_SEGMENTS) fail(`speaker_segments must contain 1 through ${MAX_SPEAKER_SEGMENTS} segments`);
  const segments = value.map((entry, index) => {
    if (!isRecord(entry)) fail(`speaker_segments[${index}] must be an object`);
    const speaker = shortString(entry.speaker, `speaker_segments[${index}].speaker`, MAX_SPEAKER_LABEL_LENGTH);
    const start = boundedNumber(entry.start_seconds, `speaker_segments[${index}].start_seconds`, 0, 86_400, Number.NaN);
    const end = boundedNumber(entry.end_seconds, `speaker_segments[${index}].end_seconds`, 0, 86_400, Number.NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end)) fail(`speaker_segments[${index}] requires start_seconds and end_seconds`);
    if (end <= start) fail(`speaker_segments[${index}].end_seconds must be greater than start_seconds`);
    return { speaker, start, end };
  });
  return segments.sort((left, right) => left.start - right.start || left.end - right.end);
}

function parseCameras(value: unknown): Camera[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CAMERAS) fail(`cameras must contain 1 through ${MAX_CAMERAS} cameras`);
  const seenIds = new Set<string>();
  const seenTracks = new Set<number>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`cameras[${index}] must be an object`);
    const id = shortString(entry.camera_id, `cameras[${index}].camera_id`, MAX_CAMERA_ID_LENGTH);
    if (seenIds.has(id)) fail(`cameras[${index}].camera_id '${id}' is duplicated`);
    seenIds.add(id);
    const role = entry.role === undefined ? undefined : entry.role;
    if (role !== undefined && (typeof role !== "string" || !CAMERA_ROLES.includes(role as CameraRole))) fail(`cameras[${index}].role must be one of: ${CAMERA_ROLES.join(", ")}`);
    const speakers = entry.speakers === undefined ? [] : entry.speakers;
    if (!Array.isArray(speakers) || speakers.length > 32) fail(`cameras[${index}].speakers must be an array of at most 32 labels`);
    const labels = speakers.map((speaker, speakerIndex) => shortString(speaker, `cameras[${index}].speakers[${speakerIndex}]`, MAX_SPEAKER_LABEL_LENGTH));
    const track = entry.video_track_index === undefined ? null : boundedNumber(entry.video_track_index, `cameras[${index}].video_track_index`, 0, 255, 0, true);
    if (track !== null) {
      if (seenTracks.has(track)) fail(`cameras[${index}].video_track_index ${track} is used by another camera`);
      seenTracks.add(track);
    }
    const inferredRole: CameraRole = role ? (role as CameraRole) : labels.length === 0 ? "wide" : labels.length === 1 ? "single" : "two_shot";
    const label = entry.label === undefined ? id : shortString(entry.label, `cameras[${index}].label`, 128);
    return { camera_id: id, label, role: inferredRole, speakers: labels, video_track_index: track };
  });
}

/** Sweep segment boundaries into elementary intervals annotated with the active speakers. */
function elementaryIntervals(segments: readonly Segment[], start: number, end: number): Interval[] {
  const points = new Set<number>([start, end]);
  for (const segment of segments) {
    if (segment.start > start && segment.start < end) points.add(segment.start);
    if (segment.end > start && segment.end < end) points.add(segment.end);
  }
  const sorted = [...points].sort((left, right) => left - right);
  const intervals: Interval[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (to - from <= EPSILON) continue;
    const mid = (from + to) / 2;
    const active = new Map<string, number>();
    for (const segment of segments) {
      if (segment.start <= mid && segment.end > mid) active.set(segment.speaker, Math.max(active.get(segment.speaker) ?? 0, segment.end - segment.start));
    }
    // Dominant speaker first (longest owning segment), stable by label for determinism.
    const speakers = [...active.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([speaker]) => speaker);
    intervals.push({ start: from, end: to, speakers });
  }
  return intervals;
}

/**
 * Cover choice: for crosstalk, a two-shot that frames everyone talking beats a
 * wide; for a general cover (no speakers), the wide comes first.
 */
function pickCoverCamera(cameras: readonly Camera[], speakers: readonly string[]): Camera | null {
  const wide = cameras.find((camera) => camera.role === "wide") ?? null;
  if (speakers.length === 0) return wide ?? cameras.find((camera) => camera.role === "two_shot") ?? null;
  const twoShot = cameras.find((camera) => camera.role === "two_shot" && speakers.every((speaker) => camera.speakers.includes(speaker)));
  return twoShot ?? wide ?? cameras.find((camera) => camera.role === "two_shot") ?? null;
}

function pickSpeakerCamera(cameras: readonly Camera[], speaker: string): Camera | null {
  return cameras.find((camera) => camera.role === "single" && camera.speakers.includes(speaker))
    ?? cameras.find((camera) => camera.speakers.includes(speaker))
    ?? null;
}

function mergeAdjacent(drafts: Draft[]): Draft[] {
  const merged: Draft[] = [];
  for (const draft of drafts) {
    const previous = merged[merged.length - 1];
    if (previous && previous.camera === draft.camera && Math.abs(previous.end - draft.start) <= EPSILON) {
      previous.end = draft.end;
      if (previous.reason === "silence_hold" && draft.reason !== "silence_hold") previous.reason = draft.reason;
      for (const speaker of draft.speakers) if (!previous.speakers.includes(speaker)) previous.speakers.push(speaker);
      continue;
    }
    merged.push({ ...draft, speakers: [...draft.speakers] });
  }
  return merged;
}

/** Absorb holds shorter than min_hold into a neighbour until the list is stable. */
function enforceMinimumHold(drafts: Draft[], minHold: number): { drafts: Draft[]; absorbed: number } {
  let list = mergeAdjacent(drafts);
  let absorbed = 0;
  // Every iteration removes one draft, so the loop is bounded by the list length.
  // The shortest offender is absorbed first so one flicker cannot cascade into
  // its neighbours before they are evaluated on their own merits.
  while (list.length > 1) {
    let shortIndex = -1;
    for (let index = 0; index < list.length; index++) {
      const hold = list[index].end - list[index].start;
      if (hold < minHold - EPSILON && (shortIndex === -1 || hold < list[shortIndex].end - list[shortIndex].start)) shortIndex = index;
    }
    if (shortIndex === -1) break;
    const short = list[shortIndex];
    if (shortIndex > 0) list[shortIndex - 1].end = short.end;
    else list[1].start = short.start;
    list.splice(shortIndex, 1);
    absorbed++;
    list = mergeAdjacent(list);
  }
  return { drafts: list, absorbed };
}

/** Plans active-speaker angle switches for stacked camera tracks. */
export function planMulticamAngleSwitches(options: MulticamOptions): MulticamPlan {
  const segments = parseSegments(options.speaker_segments);
  const cameras = parseCameras(options.cameras);
  const fps = boundedNumber(options.frame_rate, "frame_rate", 1, 240, 30);
  const minHold = boundedNumber(options.min_hold_seconds, "min_hold_seconds", 0.2, 60, 2);
  const start = boundedNumber(options.start_seconds, "start_seconds", 0, 86_400, 0);
  const inferredEnd = Math.max(...segments.map((segment) => segment.end));
  const end = boundedNumber(options.total_duration_seconds, "total_duration_seconds", 0.04, 86_400, inferredEnd);
  if (end <= start + EPSILON) fail("total_duration_seconds must be greater than start_seconds");
  const coverOnOverlap = optionalBoolean(options.cover_on_overlap, "cover_on_overlap", true);
  const overlapMin = boundedNumber(options.overlap_min_seconds, "overlap_min_seconds", 0, 30, 0.6);
  const lead = boundedNumber(options.lead_switch_seconds, "lead_switch_seconds", 0, 5, 0);
  const cutawayEvery = options.cutaway_every_seconds === undefined ? null : boundedNumber(options.cutaway_every_seconds, "cutaway_every_seconds", 4, 3_600, 0);
  const cutawayLength = boundedNumber(options.cutaway_seconds, "cutaway_seconds", 0.2, 60, 2.5);
  const markerColor = boundedNumber(options.marker_color, "marker_color", 0, 7, 6, true);
  if (cutawayEvery !== null && cutawayLength >= cutawayEvery) fail("cutaway_seconds must be shorter than cutaway_every_seconds");
  if (cutawayEvery !== null && cutawayLength < minHold) fail("cutaway_seconds must be at least min_hold_seconds so the cutaway itself is a legal hold");

  const warnings: string[] = [];
  const assumptions: string[] = [
    "Each camera is a synced clip (or clips) on its own video track; the plan enables one camera per range and disables the others. Premiere does not expose multicam angle switching to scripting.",
    "speaker_segments are sequence times. Where two or more speakers overlap, the longest overlapping segment is the dominant speaker.",
    `Angles hold for at least ${minHold}s; shorter holds are absorbed into the neighbouring angle.`,
  ];

  const unmapped = new Set<string>();
  const cover = pickCoverCamera(cameras, []);
  const fallback = cover ?? cameras[0];
  const intervals = elementaryIntervals(segments, start, end);
  const drafts: Draft[] = [];
  let previousCamera: string | null = null;
  let overlapCoverCount = 0;

  for (const interval of intervals) {
    const duration = interval.end - interval.start;
    let camera: Camera | null = null;
    let reason: CutReason = "speaker";
    if (interval.speakers.length === 0) {
      const previous: Camera | null = previousCamera ? cameras.find((entry) => entry.camera_id === previousCamera) ?? null : null;
      camera = previous ?? fallback;
      reason = "silence_hold";
    } else if (interval.speakers.length >= 2 && coverOnOverlap && duration >= overlapMin - EPSILON) {
      const overlapCover = pickCoverCamera(cameras, interval.speakers);
      if (overlapCover) {
        camera = overlapCover;
        reason = "overlap_cover";
        overlapCoverCount++;
      }
    }
    if (!camera) {
      const dominant = interval.speakers[0];
      camera = pickSpeakerCamera(cameras, dominant);
      if (!camera) {
        unmapped.add(dominant);
        camera = fallback;
        reason = "unmapped_speaker_fallback";
      }
    }
    drafts.push({ camera: camera.camera_id, start: interval.start, end: interval.end, reason, speakers: [...interval.speakers] });
    previousCamera = camera.camera_id;
  }

  let merged = mergeAdjacent(drafts);
  const held = enforceMinimumHold(merged, minHold);
  merged = held.drafts;
  if (held.absorbed > 0) warnings.push(`${held.absorbed} angle change(s) shorter than min_hold_seconds were absorbed into a neighbouring angle.`);

  if (lead > 0) {
    for (let index = 1; index < merged.length; index++) {
      const previous = merged[index - 1];
      const current = merged[index];
      if (current.reason !== "speaker") continue;
      const earliest = previous.start + minHold;
      const shifted = Math.max(earliest, current.start - lead);
      if (shifted < current.start - EPSILON) {
        previous.end = shifted;
        current.start = shifted;
        current.reason = "lead_in";
      }
    }
  }

  let cutawayCount = 0;
  if (cutawayEvery !== null) {
    if (!cover) warnings.push("cutaway_every_seconds was set but no wide or two_shot camera exists; no cutaways were planned.");
    else {
      const withCutaways: Draft[] = [];
      for (const draft of merged) {
        const length = draft.end - draft.start;
        const isSpeakerHold = draft.reason === "speaker" || draft.reason === "lead_in";
        if (draft.camera === cover.camera_id || !isSpeakerHold || length < cutawayEvery + cutawayLength + minHold) {
          withCutaways.push(draft);
          continue;
        }
        let cursor = draft.start;
        while (draft.end - cursor >= cutawayEvery + cutawayLength + minHold) {
          const cutawayStart = cursor + cutawayEvery;
          withCutaways.push({ ...draft, start: cursor, end: cutawayStart, speakers: [...draft.speakers] });
          withCutaways.push({ camera: cover.camera_id, start: cutawayStart, end: cutawayStart + cutawayLength, reason: "cutaway", speakers: [...draft.speakers] });
          cutawayCount++;
          cursor = cutawayStart + cutawayLength;
        }
        withCutaways.push({ ...draft, start: cursor, speakers: [...draft.speakers] });
      }
      merged = mergeAdjacent(withCutaways);
    }
  }

  // Snap to frames, then drop anything that collapsed to zero frames.
  const snapped: Draft[] = [];
  for (const draft of merged) {
    const startFrame = Math.round(draft.start * fps);
    const endFrame = Math.round(draft.end * fps);
    if (endFrame <= startFrame) continue;
    const previous = snapped[snapped.length - 1];
    const snappedStart = previous ? previous.end : startFrame / fps;
    const snappedEnd = endFrame / fps;
    if (snappedEnd <= snappedStart + EPSILON) continue;
    snapped.push({ ...draft, start: snappedStart, end: snappedEnd });
  }
  const finalDrafts = mergeAdjacent(snapped);
  if (finalDrafts.length === 0) fail("The plan produced no angle cuts; check speaker_segments against start_seconds and total_duration_seconds");

  const cuts: AngleCut[] = finalDrafts.map((draft, index) => ({
    index,
    camera_id: draft.camera,
    start_seconds: round3(draft.start),
    end_seconds: round3(draft.end),
    duration_seconds: round3(draft.end - draft.start),
    start_frame: Math.round(draft.start * fps),
    end_frame: Math.round(draft.end * fps),
    start_timecode: timecode(draft.start, fps),
    reason: draft.reason,
    speakers: draft.speakers,
  }));

  const switchTimes = cuts.slice(1).map((cut) => cut.start_seconds);
  const usage: CameraUsage[] = cameras.map((camera) => {
    const owned = cuts.filter((cut) => cut.camera_id === camera.camera_id);
    const onAir = owned.reduce((sum, cut) => sum + cut.duration_seconds, 0);
    return { ...camera, cut_count: owned.length, on_air_seconds: round3(onAir), on_air_percent: round3((onAir / (end - start)) * 100) };
  });
  for (const camera of usage) if (camera.cut_count === 0) warnings.push(`Camera '${camera.camera_id}' is never on air in this plan.`);
  if (unmapped.size > 0) warnings.push(`Speaker(s) without a mapped camera fell back to '${fallback.camera_id}': ${[...unmapped].join(", ")}.`);
  if (cameras.some((camera) => camera.video_track_index === null)) warnings.push("Some cameras have no video_track_index; enable_plan ranges for them must be mapped to tracks before applying.");

  const enablePlan = cameras.map((camera) => {
    const enabled = cuts.filter((cut) => cut.camera_id === camera.camera_id).map((cut) => ({ start_seconds: cut.start_seconds, end_seconds: cut.end_seconds }));
    const disabled = cuts.filter((cut) => cut.camera_id !== camera.camera_id).map((cut) => ({ start_seconds: cut.start_seconds, end_seconds: cut.end_seconds }));
    return { camera_id: camera.camera_id, video_track_index: camera.video_track_index, enabled_ranges: enabled, disabled_ranges: disabled };
  });

  const markers = cuts.map((cut) => {
    const camera = cameras.find((entry) => entry.camera_id === cut.camera_id)!;
    return {
      time_seconds: cut.start_seconds,
      name: `${camera.label}${cut.speakers.length ? ` · ${cut.speakers.join(" + ")}` : ""}`.slice(0, 60),
      comments: `${cut.reason} · ${cut.duration_seconds}s`,
      color: markerColor,
      duration_seconds: cut.duration_seconds,
    };
  });

  const holds = cuts.map((cut) => cut.duration_seconds);
  const durationMinutes = (end - start) / 60;
  const stats = {
    cut_count: cuts.length,
    switch_count: switchTimes.length,
    switches_per_minute: round3(durationMinutes > 0 ? switchTimes.length / durationMinutes : 0),
    average_hold_seconds: round3(holds.reduce((sum, value) => sum + value, 0) / holds.length),
    shortest_hold_seconds: round3(Math.min(...holds)),
    longest_hold_seconds: round3(Math.max(...holds)),
    overlap_cover_count: overlapCoverCount,
    cutaway_count: cutawayCount,
    unmapped_speakers: [...unmapped].sort(),
  };

  const applySteps = [
    "create_sequence_checkpoint: snapshot the synced multicam sequence before any structural change.",
    `razor_all_tracks at each of the ${switchTimes.length} switch_times_seconds so every camera track is cut at the same frames.`,
    "For each camera in enable_plan: select_clips_in_range on its video_track_index for every disabled range, then batch_enable_disable target=selected enabled=false; leave enabled_ranges untouched.",
    "add_markers_batch with markers to label the on-air camera at every cut for review.",
    "get_sequence_structure and diff_sequence_snapshots against the checkpoint to confirm only enable state and razor points changed.",
  ];

  const revision = `sha256:${createHash("sha256")
    .update(JSON.stringify({ segments, cameras, fps, minHold, start, end, coverOnOverlap, overlapMin, lead, cutawayEvery, cutawayLength, markerColor }))
    .digest("hex")}`;

  return {
    applied: false,
    plan_revision: revision,
    frame_rate: fps,
    start_seconds: round3(start),
    duration_seconds: round3(end - start),
    cameras: usage,
    cuts,
    switch_times_seconds: switchTimes,
    razor_plan: { tool: "razor_all_tracks", times_seconds: switchTimes },
    enable_plan: enablePlan,
    markers,
    apply_steps: applySteps,
    stats,
    routes: MULTICAM_ROUTES,
    next_steps: [
      "Review cuts and stats; adjust min_hold_seconds, lead_switch_seconds, or cutaway_every_seconds and re-plan before touching the timeline.",
      "Apply through apply_steps on a checkpointed sequence; every host mutation still uses its own verified tool.",
    ],
    warnings,
    assumptions,
  };
}
