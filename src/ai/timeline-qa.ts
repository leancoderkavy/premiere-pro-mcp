import { createHash } from "node:crypto";
import { secondsToFrame } from "./word-timeline.js";

/**
 * Local-only timeline QA: sequence snapshot normalization, snapshot diffing,
 * and a deterministic health audit. Nothing here contacts Premiere, a bridge,
 * or a model; every result is a plan/preview for a caller to act on later.
 */

export type SnapshotTrackType = "video" | "audio";

export type SnapshotClip = {
  id: string;
  name?: string;
  start_seconds: number;
  end_seconds: number;
  in_seconds?: number;
  out_seconds?: number;
  /** Basename only; the full path is never retained. */
  media_basename?: string;
  /** sha256 hex digest of the full media path supplied by the caller. */
  media_path_sha256?: string;
  project_item_id?: string;
  disabled: boolean;
  speed_percent?: number;
  linked_ids?: string[];
};

export type SnapshotTrack = {
  type: SnapshotTrackType;
  index: number;
  name?: string;
  clips: SnapshotClip[];
};

export type SequenceSnapshot = {
  sequence_id?: string;
  name?: string;
  frame_rate: number;
  duration_seconds?: number;
  tracks: SnapshotTrack[];
  /** True when at least one clip id had to be synthesized from its position. */
  synthetic_ids: boolean;
  frame_rate_source: "snapshot" | "override" | "default";
};

export type NormalizeOptions = { frameRateOverride?: unknown; defaultFrameRate?: number; label?: string };

export const MAX_SNAPSHOT_TRACKS = 64;
export const MAX_CLIPS_PER_TRACK = 5000;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_FINDINGS = 2000;
export const MAX_CHANGES = 20_000;
const MAX_ABS_SECONDS = 1_000_000;
const DEFAULT_FRAME_RATE = 30;

export const HEALTH_WEIGHTS = { error: 15, warning: 5, info: 1 } as const;
export const HEALTH_PER_CODE_CAP = 30;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.length > max) fail(`${label} must be at most ${max} characters`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalSeconds(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number of seconds`);
  if (Math.abs(value) > MAX_ABS_SECONDS) fail(`${label} must be within ±${MAX_ABS_SECONDS} seconds`);
  return round6(value);
}

export function validateFrameRate(value: unknown, label = "frame_rate"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 240) fail(`${label} must be a number between 1 and 240`);
  return value;
}

/** Basename of a POSIX or Windows path. */
export function mediaBasename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** Non-drop HH:MM:SS:FF at the nominal (rounded) frame rate. */
export function formatTimecode(seconds: number, frameRate: number): string {
  const nominal = Math.max(1, Math.round(frameRate));
  const negative = seconds < 0;
  const totalFrames = Math.round(Math.abs(seconds) * frameRate);
  const ff = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${negative ? "-" : ""}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function trackLabel(track: { type: SnapshotTrackType; index: number }): string {
  return `${track.type === "video" ? "V" : "A"}${track.index + 1}`;
}

function normalizeClip(raw: unknown, type: SnapshotTrackType, trackIndex: number, clipIndex: number, label: string, state: { synthetic: boolean }): SnapshotClip {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const explicitId = optionalText(pick(raw, ["id", "nodeId", "node_id", "clip_id", "clipId"]), `${label}.id`, 128);
  let id = explicitId;
  if (!id) {
    id = `~${type === "video" ? "v" : "a"}${trackIndex}:${clipIndex}`;
    state.synthetic = true;
  }
  const start = optionalSeconds(pick(raw, ["start_seconds", "startSeconds", "start"]), `${label}.start_seconds`);
  const end = optionalSeconds(pick(raw, ["end_seconds", "endSeconds", "end"]), `${label}.end_seconds`);
  if (start === undefined) fail(`${label}.start_seconds is required`);
  if (end === undefined) fail(`${label}.end_seconds is required`);
  const inPoint = optionalSeconds(pick(raw, ["in_seconds", "inSeconds", "inPointSeconds", "inPoint"]), `${label}.in_seconds`);
  const outPoint = optionalSeconds(pick(raw, ["out_seconds", "outSeconds", "outPointSeconds", "outPoint"]), `${label}.out_seconds`);
  const mediaPath = optionalText(pick(raw, ["media_path", "mediaPath", "filePath", "file_path", "path"]), `${label}.media_path`, 4096);
  const projectItemId = optionalText(pick(raw, ["project_item_id", "projectItemId", "sourceProjectItemId", "source_project_item_id", "projectItem"]), `${label}.project_item_id`, 512);
  const disabledRaw = raw.disabled !== undefined && raw.disabled !== null ? raw.disabled : raw.enabled !== undefined && raw.enabled !== null ? !raw.enabled : false;
  if (typeof disabledRaw !== "boolean") fail(`${label}.disabled must be a boolean`);
  let speed: number | undefined;
  const speedRaw = pick(raw, ["speed_percent", "speedPercent"]);
  if (speedRaw !== undefined) {
    if (typeof speedRaw !== "number" || !Number.isFinite(speedRaw) || Math.abs(speedRaw) > 100_000) fail(`${label}.speed_percent must be a finite number`);
    speed = round6(speedRaw);
  } else if (typeof raw.speed === "number" && Number.isFinite(raw.speed)) {
    // Premiere reports speed as a multiplier (1 = 100%) or a percentage; treat |x| <= 10 as a multiplier.
    speed = round6(Math.abs(raw.speed) <= 10 ? raw.speed * 100 : raw.speed);
  }
  let linked: string[] | undefined;
  const linkedRaw = pick(raw, ["linked_ids", "linkedIds"]);
  if (linkedRaw !== undefined) {
    if (!Array.isArray(linkedRaw) || linkedRaw.length > 16) fail(`${label}.linked_ids must be an array of at most 16 ids`);
    linked = linkedRaw.map((item, index) => optionalText(item, `${label}.linked_ids[${index}]`, 128) ?? fail(`${label}.linked_ids[${index}] must be a non-empty string`)).sort();
  }
  const clip: SnapshotClip = { id, start_seconds: start, end_seconds: end, disabled: disabledRaw };
  const name = optionalText(raw.name, `${label}.name`, 255);
  if (name) clip.name = name;
  if (inPoint !== undefined) clip.in_seconds = inPoint;
  if (outPoint !== undefined) clip.out_seconds = outPoint;
  if (mediaPath) {
    clip.media_basename = mediaBasename(mediaPath);
    clip.media_path_sha256 = createHash("sha256").update(mediaPath).digest("hex");
  }
  if (projectItemId) clip.project_item_id = projectItemId;
  if (speed !== undefined) clip.speed_percent = speed;
  if (linked) clip.linked_ids = linked;
  return clip;
}

function normalizeTrack(raw: unknown, forcedType: SnapshotTrackType | undefined, position: number, label: string, state: { synthetic: boolean }): SnapshotTrack {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const typeRaw = forcedType ?? pick(raw, ["type", "mediaType", "media_type"]);
  const typeText = typeof typeRaw === "string" ? typeRaw.toLowerCase() : "";
  const type: SnapshotTrackType = typeText === "video" ? "video" : typeText === "audio" ? "audio" : fail(`${label}.type must be "video" or "audio"`);
  const indexRaw = pick(raw, ["index", "trackIndex", "track_index"]);
  const index = indexRaw === undefined ? position : indexRaw;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 1023) fail(`${label}.index must be an integer between 0 and 1023`);
  const clipsRaw = pick(raw, ["clips", "items"]) ?? [];
  if (!Array.isArray(clipsRaw) || clipsRaw.length > MAX_CLIPS_PER_TRACK) fail(`${label}.clips must be an array of at most ${MAX_CLIPS_PER_TRACK} clips`);
  const clips = clipsRaw.map((clip, clipIndex) => normalizeClip(clip, type, index, clipIndex, `${label}.clips[${clipIndex}]`, state));
  clips.sort((a, b) => a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds || a.id.localeCompare(b.id));
  const track: SnapshotTrack = { type, index, clips };
  const name = optionalText(raw.name, `${label}.name`, 255);
  if (name) track.name = name;
  return track;
}

/**
 * Accepts the normalized snapshot shape, the `get_sequence_structure` shape
 * (`videoTracks`/`audioTracks` with `nodeId`/`startSeconds`...), or the
 * `inspect_sequence_structure_uxp` shape (`tracks[].items[]` with `mediaType`).
 */
export function normalizeSequenceSnapshot(raw: unknown, options: NormalizeOptions = {}): SequenceSnapshot {
  const label = options.label ?? "snapshot";
  if (!isRecord(raw)) fail(`${label} must be an object`);
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_SNAPSHOT_BYTES) fail(`${label} exceeds the ${MAX_SNAPSHOT_BYTES / (1024 * 1024)} MiB input limit`);
  const state = { synthetic: false };
  const tracks: SnapshotTrack[] = [];
  const hasTracks = Array.isArray(raw.tracks);
  const hasSplit = Array.isArray(raw.videoTracks) || Array.isArray(raw.audioTracks) || Array.isArray(raw.video_tracks) || Array.isArray(raw.audio_tracks);
  if (hasTracks) {
    const list = raw.tracks as unknown[];
    if (list.length > MAX_SNAPSHOT_TRACKS) fail(`${label}.tracks must contain at most ${MAX_SNAPSHOT_TRACKS} tracks`);
    list.forEach((track, position) => tracks.push(normalizeTrack(track, undefined, position, `${label}.tracks[${position}]`, state)));
  } else if (hasSplit) {
    const video = (pick(raw, ["videoTracks", "video_tracks"]) ?? []) as unknown;
    const audio = (pick(raw, ["audioTracks", "audio_tracks"]) ?? []) as unknown;
    if (!Array.isArray(video) || !Array.isArray(audio)) fail(`${label}.videoTracks and audioTracks must be arrays`);
    if (video.length + audio.length > MAX_SNAPSHOT_TRACKS) fail(`${label} must contain at most ${MAX_SNAPSHOT_TRACKS} tracks`);
    video.forEach((track, position) => tracks.push(normalizeTrack(track, "video", position, `${label}.videoTracks[${position}]`, state)));
    audio.forEach((track, position) => tracks.push(normalizeTrack(track, "audio", position, `${label}.audioTracks[${position}]`, state)));
  } else {
    fail(`${label} must contain a tracks array or videoTracks/audioTracks arrays`);
  }
  const seen = new Set<string>();
  for (const track of tracks) {
    const key = `${track.type}:${track.index}`;
    if (seen.has(key)) fail(`${label} contains duplicate track ${trackLabel(track)}`);
    seen.add(key);
  }
  const ids = new Set<string>();
  for (const track of tracks) for (const clip of track.clips) {
    if (ids.has(clip.id)) fail(`${label} contains duplicate clip id: ${clip.id}`);
    ids.add(clip.id);
  }
  tracks.sort((a, b) => (a.type === b.type ? a.index - b.index : a.type === "video" ? -1 : 1));

  let frameRate: number;
  let frameRateSource: SequenceSnapshot["frame_rate_source"];
  const rawRate = pick(raw, ["frame_rate", "frameRate", "fps", "timebase"]);
  if (options.frameRateOverride !== undefined) {
    frameRate = validateFrameRate(options.frameRateOverride, "frame_rate");
    frameRateSource = "override";
  } else if (rawRate !== undefined) {
    frameRate = validateFrameRate(rawRate, `${label}.frame_rate`);
    frameRateSource = "snapshot";
  } else {
    frameRate = options.defaultFrameRate ?? DEFAULT_FRAME_RATE;
    frameRateSource = "default";
  }

  const sequenceRecord = isRecord(raw.sequence) ? raw.sequence : undefined;
  const snapshot: SequenceSnapshot = { frame_rate: frameRate, tracks, synthetic_ids: state.synthetic, frame_rate_source: frameRateSource };
  const sequenceId = optionalText(pick(raw, ["sequence_id", "sequenceId", "id"]) ?? (sequenceRecord ? pick(sequenceRecord, ["id", "sequenceId"]) : undefined), `${label}.sequence_id`, 128);
  if (sequenceId) snapshot.sequence_id = sequenceId;
  const name = optionalText(raw.name ?? (sequenceRecord ? sequenceRecord.name : undefined), `${label}.name`, 255);
  if (name) snapshot.name = name;
  const duration = optionalSeconds(pick(raw, ["duration_seconds", "durationSeconds", "duration"]), `${label}.duration_seconds`);
  if (duration !== undefined) snapshot.duration_seconds = duration;
  return snapshot;
}

/** Digest of a normalized snapshot, excluding normalization bookkeeping. */
export function snapshotRevision(snapshot: SequenceSnapshot): string {
  const { synthetic_ids: _synthetic, frame_rate_source: _source, ...rest } = snapshot;
  return digest(rest);
}

export function snapshotDuration(snapshot: SequenceSnapshot): number {
  if (snapshot.duration_seconds !== undefined) return snapshot.duration_seconds;
  let max = 0;
  for (const track of snapshot.tracks) for (const clip of track.clips) max = Math.max(max, clip.end_seconds);
  return round6(max);
}

function privateClipView(clip: SnapshotClip) {
  return {
    id: clip.id,
    ...(clip.name ? { name: clip.name } : {}),
    ...(clip.media_basename ? { media_basename: clip.media_basename, media_path_sha256: clip.media_path_sha256 } : {}),
    ...(clip.project_item_id ? { project_item_id: clip.project_item_id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DiffKind = "added" | "removed" | "moved" | "trimmed" | "retimed" | "enabled_changed" | "renamed";

export type ClipTiming = { start: number; end: number; in?: number; out?: number };

export type SnapshotChange = {
  kind: DiffKind;
  kinds: DiffKind[];
  clip_id: string;
  clip_id_after?: string;
  name?: string;
  track_before?: string;
  track_after?: string;
  before?: ClipTiming;
  after?: ClipTiming;
  delta_frames?: { start: number; end: number; in: number; out: number };
  details?: Record<string, unknown>;
};

export type DiffOptions = { frameRate?: unknown; toleranceFrames?: unknown };

type Located = { clip: SnapshotClip; track: SnapshotTrack };

function locate(snapshot: SequenceSnapshot): Located[] {
  const out: Located[] = [];
  for (const track of snapshot.tracks) for (const clip of track.clips) out.push({ clip, track });
  return out;
}

function timing(clip: SnapshotClip): ClipTiming {
  return { start: clip.start_seconds, end: clip.end_seconds, ...(clip.in_seconds !== undefined ? { in: clip.in_seconds } : {}), ...(clip.out_seconds !== undefined ? { out: clip.out_seconds } : {}) };
}

function contentKey(item: Located): string | undefined {
  const identity = item.clip.project_item_id ?? item.clip.media_path_sha256 ?? item.clip.name;
  if (!identity) return undefined;
  return `${item.track.type}|${identity}|${item.clip.in_seconds ?? ""}|${item.clip.out_seconds ?? ""}`;
}

function compareLocated(a: Located, b: Located): number {
  if (a.track.type !== b.track.type) return a.track.type === "video" ? -1 : 1;
  return a.track.index - b.track.index || a.clip.start_seconds - b.clip.start_seconds || a.clip.id.localeCompare(b.clip.id);
}

export function diffSequenceSnapshots(before: SequenceSnapshot, after: SequenceSnapshot, options: DiffOptions = {}) {
  const frameRate = options.frameRate === undefined ? before.frame_rate : validateFrameRate(options.frameRate);
  const tolerance = options.toleranceFrames === undefined ? 0 : options.toleranceFrames;
  if (typeof tolerance !== "number" || !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10) fail("tolerance_frames must be an integer between 0 and 10");
  const frames = (delta: number) => {
    const value = secondsToFrame(delta, frameRate);
    return Math.abs(value) <= tolerance ? 0 : value;
  };

  const warnings: string[] = [];
  const assumptions: string[] = [];
  if (before.frame_rate_source === "default" && options.frameRate === undefined) assumptions.push(`No frame rate was supplied; assumed ${frameRate} fps for frame deltas and timecodes.`);
  if (Math.abs(before.frame_rate - after.frame_rate) > 1e-6) warnings.push(`Frame rates differ between snapshots (${before.frame_rate} vs ${after.frame_rate}); deltas use ${frameRate} fps.`);
  const useIds = !before.synthetic_ids && !after.synthetic_ids;
  if (!useIds) assumptions.push("At least one snapshot lacked stable clip ids; clips were matched by track type, source identity, and in/out points instead of id.");

  const beforeTracks = new Map(before.tracks.map((track) => [trackLabel(track), track]));
  const afterTracks = new Map(after.tracks.map((track) => [trackLabel(track), track]));
  const tracksAdded = [...afterTracks.keys()].filter((key) => !beforeTracks.has(key));
  const tracksRemoved = [...beforeTracks.keys()].filter((key) => !afterTracks.has(key));

  const beforeItems = locate(before).sort(compareLocated);
  const afterItems = locate(after).sort(compareLocated);
  const pairs: Array<{ before: Located; after: Located; by: "id" | "content" }> = [];
  const matchedBefore = new Set<Located>();
  const matchedAfter = new Set<Located>();

  if (useIds) {
    const afterById = new Map(afterItems.map((item) => [item.clip.id, item]));
    for (const item of beforeItems) {
      const match = afterById.get(item.clip.id);
      if (match && item.track.type === match.track.type) {
        pairs.push({ before: item, after: match, by: "id" });
        matchedBefore.add(item);
        matchedAfter.add(match);
      }
    }
  }
  const pool = new Map<string, Located[]>();
  for (const item of afterItems) {
    if (matchedAfter.has(item)) continue;
    const key = contentKey(item);
    if (!key) continue;
    const list = pool.get(key) ?? [];
    list.push(item);
    pool.set(key, list);
  }
  for (const item of beforeItems) {
    if (matchedBefore.has(item)) continue;
    const key = contentKey(item);
    const list = key ? pool.get(key) : undefined;
    if (!list || !list.length) continue;
    const match = list.shift() as Located;
    pairs.push({ before: item, after: match, by: "content" });
    matchedBefore.add(item);
    matchedAfter.add(match);
  }

  const changes: SnapshotChange[] = [];
  const summary = { added: 0, removed: 0, moved: 0, trimmed: 0, retimed: 0, enabled_changed: 0, renamed: 0, unchanged: 0, changed_clips: 0, tracks_added: tracksAdded.length, tracks_removed: tracksRemoved.length };
  const trackStats = new Map<string, Record<string, number>>();
  const stat = (label: string, key: string) => {
    const record = trackStats.get(label) ?? { added: 0, removed: 0, moved_in: 0, moved_out: 0, trimmed: 0, retimed: 0, enabled_changed: 0, renamed: 0, unchanged: 0 };
    record[key] = (record[key] ?? 0) + 1;
    trackStats.set(label, record);
  };
  const edl: Array<{ sort: Located; line: string }> = [];
  const tc = (seconds: number) => formatTimecode(seconds, frameRate);
  const clipName = (clip: SnapshotClip) => `'${clip.name ?? clip.id}'`;

  for (const item of beforeItems) {
    if (matchedBefore.has(item)) continue;
    summary.removed += 1;
    stat(trackLabel(item.track), "removed");
    changes.push({ kind: "removed", kinds: ["removed"], clip_id: item.clip.id, ...(item.clip.name ? { name: item.clip.name } : {}), track_before: trackLabel(item.track), before: timing(item.clip), details: privateClipView(item.clip) });
    edl.push({ sort: item, line: `${trackLabel(item.track)} clip ${clipName(item.clip)} removed ${tc(item.clip.start_seconds)} → ${tc(item.clip.end_seconds)}` });
  }
  for (const item of afterItems) {
    if (matchedAfter.has(item)) continue;
    summary.added += 1;
    stat(trackLabel(item.track), "added");
    changes.push({ kind: "added", kinds: ["added"], clip_id: item.clip.id, ...(item.clip.name ? { name: item.clip.name } : {}), track_after: trackLabel(item.track), after: timing(item.clip), details: privateClipView(item.clip) });
    edl.push({ sort: item, line: `${trackLabel(item.track)} clip ${clipName(item.clip)} added ${tc(item.clip.start_seconds)} → ${tc(item.clip.end_seconds)}` });
  }
  for (const pair of pairs) {
    const b = pair.before.clip, a = pair.after.clip;
    const trackBefore = trackLabel(pair.before.track), trackAfter = trackLabel(pair.after.track);
    const delta = {
      start: frames(a.start_seconds - b.start_seconds),
      end: frames(a.end_seconds - b.end_seconds),
      in: b.in_seconds !== undefined && a.in_seconds !== undefined ? frames(a.in_seconds - b.in_seconds) : 0,
      out: b.out_seconds !== undefined && a.out_seconds !== undefined ? frames(a.out_seconds - b.out_seconds) : 0,
    };
    const kinds: DiffKind[] = [];
    const durationDelta = delta.end - delta.start;
    if (trackBefore !== trackAfter || (delta.start !== 0 && durationDelta === 0)) kinds.push("moved");
    if (durationDelta !== 0 || delta.in !== 0 || delta.out !== 0) kinds.push("trimmed");
    const speedBefore = b.speed_percent ?? 100, speedAfter = a.speed_percent ?? 100;
    if (Math.abs(speedBefore - speedAfter) > 1e-6) kinds.push("retimed");
    if (b.disabled !== a.disabled) kinds.push("enabled_changed");
    if (b.name !== undefined && a.name !== undefined && b.name !== a.name) kinds.push("renamed");
    if (!kinds.length) {
      summary.unchanged += 1;
      stat(trackAfter, "unchanged");
      continue;
    }
    summary.changed_clips += 1;
    for (const kind of kinds) {
      summary[kind] += 1;
      if (kind === "moved" && trackBefore !== trackAfter) { stat(trackBefore, "moved_out"); stat(trackAfter, "moved_in"); }
      else if (kind === "moved") stat(trackAfter, "moved_in");
      else stat(trackAfter, kind);
    }
    const details: Record<string, unknown> = { matched_by: pair.by, ...privateClipView(a) };
    if (kinds.includes("retimed")) Object.assign(details, { speed_percent_before: speedBefore, speed_percent_after: speedAfter });
    if (kinds.includes("enabled_changed")) Object.assign(details, { disabled_before: b.disabled, disabled_after: a.disabled });
    if (kinds.includes("renamed")) Object.assign(details, { name_before: b.name, name_after: a.name });
    changes.push({
      kind: kinds[0], kinds, clip_id: b.id,
      ...(a.id !== b.id ? { clip_id_after: a.id } : {}),
      ...(a.name ? { name: a.name } : {}),
      track_before: trackBefore, track_after: trackAfter, before: timing(b), after: timing(a), delta_frames: delta, details,
    });
    const parts: string[] = [];
    if (kinds.includes("moved")) parts.push(trackBefore !== trackAfter ? `moved ${trackBefore}→${trackAfter} ${tc(b.start_seconds)} → ${tc(a.start_seconds)}` : `moved ${tc(b.start_seconds)} → ${tc(a.start_seconds)}`);
    if (kinds.includes("trimmed")) parts.push(`trimmed ${tc(b.start_seconds)}-${tc(b.end_seconds)} → ${tc(a.start_seconds)}-${tc(a.end_seconds)}${delta.in || delta.out ? ` (in ${delta.in >= 0 ? "+" : ""}${delta.in}f, out ${delta.out >= 0 ? "+" : ""}${delta.out}f)` : ""}`);
    if (kinds.includes("retimed")) parts.push(`retimed ${speedBefore}% → ${speedAfter}%`);
    if (kinds.includes("enabled_changed")) parts.push(a.disabled ? "disabled" : "enabled");
    if (kinds.includes("renamed")) parts.push(`renamed '${b.name}' → '${a.name}'`);
    edl.push({ sort: pair.after, line: `${trackAfter} clip ${clipName(a)} ${parts.join("; ")}` });
  }

  const order = (change: SnapshotChange) => {
    const label = change.track_after ?? change.track_before ?? "";
    const t = change.after ?? change.before ?? { start: 0, end: 0 };
    return { type: label.startsWith("V") ? 0 : 1, index: Number(label.slice(1)) || 0, start: t.start, id: change.clip_id };
  };
  changes.sort((x, y) => {
    const a = order(x), b = order(y);
    return a.type - b.type || a.index - b.index || a.start - b.start || a.id.localeCompare(b.id);
  });
  edl.sort((x, y) => compareLocated(x.sort, y.sort));
  const truncated = changes.length > MAX_CHANGES;
  const byTrack = [...trackStats.entries()].sort((a, b) => (a[0][0] === b[0][0] ? Number(a[0].slice(1)) - Number(b[0].slice(1)) : a[0][0] === "V" ? -1 : 1)).map(([track, counts]) => ({ track, ...counts }));
  const beforeRevision = snapshotRevision(before), afterRevision = snapshotRevision(after);

  return {
    summary,
    changes: truncated ? changes.slice(0, MAX_CHANGES) : changes,
    truncated,
    by_track: byTrack,
    tracks_added: tracksAdded,
    tracks_removed: tracksRemoved,
    duration_before_seconds: snapshotDuration(before),
    duration_after_seconds: snapshotDuration(after),
    duration_delta_seconds: round6(snapshotDuration(after) - snapshotDuration(before)),
    frame_rate: frameRate,
    tolerance_frames: tolerance,
    snapshot_revisions: { before: beforeRevision, after: afterRevision },
    identical: beforeRevision === afterRevision,
    edl_like_lines: edl.map((entry) => entry.line).slice(0, MAX_CHANGES),
    plan_revision: digest({ before: beforeRevision, after: afterRevision, frameRate, tolerance }),
    evidence: { before_revision: beforeRevision, after_revision: afterRevision, matched_by_id: pairs.filter((pair) => pair.by === "id").length, matched_by_content: pairs.filter((pair) => pair.by === "content").length },
    warnings,
    assumptions,
    applied: false,
  };
}

// ---------------------------------------------------------------------------
// Health audit
// ---------------------------------------------------------------------------

export type FindingSeverity = "error" | "warning" | "info";

export type HealthFinding = {
  code: string;
  severity: FindingSeverity;
  track?: string;
  clip_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  timecode?: string;
  message: string;
};

export type AuditOptions = {
  frameRate?: unknown;
  flashFrameMaxFrames?: unknown;
  gapMinFrames?: unknown;
  maxSpeedPercent?: unknown;
  expectedDurationSeconds?: unknown;
  expectedFrameRate?: unknown;
};

export const HEALTH_CHECKS = [
  "frame_rate_mismatch", "invalid_time_range", "flash_frame", "gap", "overlap", "disabled_clip", "repeated_shot",
  "video_without_audio", "audio_without_video", "beyond_expected_duration", "extreme_speed", "empty_track", "unnamed_clip",
  "leading_black", "trailing_gap",
] as const;

export type HealthCheck = (typeof HEALTH_CHECKS)[number];

const FIX_ROUTES: Record<HealthCheck, string[]> = {
  frame_rate_mismatch: ["set_sequence_settings", "create_sequence_from_preset"],
  invalid_time_range: ["get_sequence_structure", "transform_track_item_uxp"],
  flash_frame: ["ripple_delete", "trim_clip", "export_sequence_review_frames"],
  gap: ["get_timeline_gaps", "ripple_delete"],
  overlap: ["get_sequence_structure", "move_clip_to_track", "trim_clip"],
  disabled_clip: ["enable_disable_clip"],
  repeated_shot: ["inspect_sequence_review_report", "export_sequence_review_frames"],
  video_without_audio: ["add_to_timeline", "get_sequence_structure"],
  audio_without_video: ["add_to_timeline", "get_sequence_structure"],
  beyond_expected_duration: ["trim_clip", "ripple_delete"],
  extreme_speed: ["speed_change"],
  empty_track: ["get_sequence_structure"],
  unnamed_clip: ["transform_track_item_uxp"],
  leading_black: ["ripple_delete", "get_timeline_gaps"],
  trailing_gap: ["get_timeline_gaps", "trim_clip"],
};

function optionalNumber(value: unknown, label: string, min: number, max: number, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${label} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  return value;
}

export function auditTimelineHealth(snapshot: SequenceSnapshot, options: AuditOptions = {}) {
  const frameRate = options.frameRate === undefined ? snapshot.frame_rate : validateFrameRate(options.frameRate);
  const flashMax = optionalNumber(options.flashFrameMaxFrames, "flash_frame_max_frames", 1, 12, 3, true);
  const gapMin = optionalNumber(options.gapMinFrames, "gap_min_frames", 1, 10_000, 1, true);
  const maxSpeed = optionalNumber(options.maxSpeedPercent, "max_speed_percent", 1, 100_000, 400);
  const expectedDuration = options.expectedDurationSeconds === undefined ? undefined : optionalNumber(options.expectedDurationSeconds, "expected_duration_seconds", 0, 86_400, 0);
  const expectedFrameRate = options.expectedFrameRate === undefined ? undefined : validateFrameRate(options.expectedFrameRate, "expected_frame_rate");
  const frameSeconds = 1 / frameRate;
  const half = frameSeconds / 2;
  const tc = (seconds: number) => formatTimecode(seconds, frameRate);

  const findings: HealthFinding[] = [];
  const add = (finding: HealthFinding) => { findings.push(finding); };
  const checked: HealthCheck[] = [];
  const skipped: Array<{ check: HealthCheck; reason: string }> = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  if (snapshot.frame_rate_source === "default" && options.frameRate === undefined) assumptions.push(`No frame rate was supplied; assumed ${frameRate} fps.`);

  checked.push("frame_rate_mismatch");
  if (expectedFrameRate !== undefined && Math.abs(expectedFrameRate - frameRate) > 1e-3) {
    add({ code: "frame_rate_mismatch", severity: "error", start_seconds: 0, end_seconds: 0, timecode: tc(0), message: `Sequence frame rate ${frameRate} does not match expected ${expectedFrameRate}.` });
  }

  const videoTracks = snapshot.tracks.filter((track) => track.type === "video");
  const audioTracks = snapshot.tracks.filter((track) => track.type === "audio");
  const enabledAudio = audioTracks.flatMap((track) => track.clips.filter((clip) => !clip.disabled && clip.end_seconds > clip.start_seconds));
  const enabledVideo = videoTracks.flatMap((track) => track.clips.filter((clip) => !clip.disabled && clip.end_seconds > clip.start_seconds));

  checked.push("invalid_time_range", "flash_frame", "gap", "overlap", "disabled_clip", "extreme_speed", "empty_track", "unnamed_clip", "beyond_expected_duration");
  for (const track of snapshot.tracks) {
    const label = trackLabel(track);
    if (!track.clips.length) {
      add({ code: "empty_track", severity: "info", track: label, message: `${label}${track.name ? ` (${track.name})` : ""} has no clips.` });
      continue;
    }
    let previous: SnapshotClip | undefined;
    for (const clip of track.clips) {
      const base = { track: label, clip_id: clip.id, start_seconds: clip.start_seconds, end_seconds: clip.end_seconds, timecode: tc(clip.start_seconds) };
      const name = clip.name ?? clip.id;
      const valid = clip.end_seconds > clip.start_seconds && clip.start_seconds >= 0;
      if (!valid) {
        add({ ...base, code: "invalid_time_range", severity: "error", message: clip.start_seconds < 0 ? `${label} clip '${name}' starts at a negative time (${clip.start_seconds}s).` : `${label} clip '${name}' has end ${clip.end_seconds}s not after start ${clip.start_seconds}s.` });
      } else {
        const durationFrames = secondsToFrame(clip.end_seconds - clip.start_seconds, frameRate);
        if (durationFrames <= flashMax) add({ ...base, code: "flash_frame", severity: "warning", message: `${label} clip '${name}' lasts ${durationFrames} frame${durationFrames === 1 ? "" : "s"} (≤ ${flashMax}).` });
      }
      if (clip.disabled) add({ ...base, code: "disabled_clip", severity: "info", message: `${label} clip '${name}' is disabled.` });
      if (clip.speed_percent !== undefined && Math.abs(clip.speed_percent) > maxSpeed) add({ ...base, code: "extreme_speed", severity: "warning", message: `${label} clip '${name}' runs at ${clip.speed_percent}% (limit ${maxSpeed}%).` });
      if (!clip.name) add({ ...base, code: "unnamed_clip", severity: "info", message: `${label} clip ${clip.id} has no name.` });
      if (expectedDuration !== undefined && clip.end_seconds > expectedDuration + half) add({ ...base, code: "beyond_expected_duration", severity: "error", message: `${label} clip '${name}' ends at ${tc(clip.end_seconds)}, past the expected duration ${tc(expectedDuration)}.` });
      if (previous && valid) {
        const gap = clip.start_seconds - previous.end_seconds;
        if (gap < -half) {
          add({ code: "overlap", severity: "error", track: label, clip_id: clip.id, start_seconds: clip.start_seconds, end_seconds: Math.min(previous.end_seconds, clip.end_seconds), timecode: tc(clip.start_seconds), message: `${label} clip '${name}' overlaps '${previous.name ?? previous.id}' by ${secondsToFrame(-gap, frameRate)} frame(s) at ${tc(clip.start_seconds)}.` });
        } else if (secondsToFrame(gap, frameRate) >= gapMin && gap > half) {
          add({ code: "gap", severity: track.type === "video" ? "warning" : "info", track: label, clip_id: clip.id, start_seconds: previous.end_seconds, end_seconds: clip.start_seconds, timecode: tc(previous.end_seconds), message: `${label} has a ${secondsToFrame(gap, frameRate)}-frame gap ${tc(previous.end_seconds)} → ${tc(clip.start_seconds)} before '${name}'.` });
        }
      }
      if (!previous || clip.end_seconds > previous.end_seconds) previous = clip;
    }
  }

  checked.push("repeated_shot");
  const bySource = new Map<string, Array<{ clip: SnapshotClip; track: SnapshotTrack }>>();
  for (const track of snapshot.tracks) for (const clip of track.clips) {
    const identity = clip.project_item_id ?? clip.media_path_sha256;
    if (!identity || clip.in_seconds === undefined || clip.out_seconds === undefined) continue;
    const key = `${track.type}|${identity}`;
    const list = bySource.get(key) ?? [];
    list.push({ clip, track });
    bySource.set(key, list);
  }
  for (const list of bySource.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.clip.start_seconds - b.clip.start_seconds || a.clip.id.localeCompare(b.clip.id));
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      const overlapStart = Math.max(a.clip.in_seconds as number, b.clip.in_seconds as number);
      const overlapEnd = Math.min(a.clip.out_seconds as number, b.clip.out_seconds as number);
      if (overlapEnd - overlapStart > half) {
        add({ code: "repeated_shot", severity: "warning", track: trackLabel(b.track), clip_id: b.clip.id, start_seconds: b.clip.start_seconds, end_seconds: b.clip.end_seconds, timecode: tc(b.clip.start_seconds), message: `${trackLabel(b.track)} clip '${b.clip.name ?? b.clip.id}' reuses ${round6(overlapEnd - overlapStart)}s of source already used by ${trackLabel(a.track)} clip '${a.clip.name ?? a.clip.id}' at ${tc(a.clip.start_seconds)}.` });
      }
    }
  }

  if (!audioTracks.length) skipped.push({ check: "video_without_audio", reason: "snapshot contains no audio tracks" });
  else {
    checked.push("video_without_audio");
    for (const track of videoTracks) for (const clip of track.clips) {
      if (clip.disabled || clip.end_seconds <= clip.start_seconds) continue;
      const covered = enabledAudio.some((audio) => audio.start_seconds < clip.end_seconds - half && audio.end_seconds > clip.start_seconds + half);
      if (!covered) add({ code: "video_without_audio", severity: "warning", track: trackLabel(track), clip_id: clip.id, start_seconds: clip.start_seconds, end_seconds: clip.end_seconds, timecode: tc(clip.start_seconds), message: `${trackLabel(track)} clip '${clip.name ?? clip.id}' has no enabled audio underneath ${tc(clip.start_seconds)} → ${tc(clip.end_seconds)}.` });
    }
  }
  if (!videoTracks.length) skipped.push({ check: "audio_without_video", reason: "snapshot contains no video tracks" });
  else {
    checked.push("audio_without_video");
    for (const track of audioTracks) for (const clip of track.clips) {
      if (clip.disabled || clip.end_seconds <= clip.start_seconds) continue;
      const covered = enabledVideo.some((video) => video.start_seconds < clip.end_seconds - half && video.end_seconds > clip.start_seconds + half);
      if (!covered) add({ code: "audio_without_video", severity: "info", track: trackLabel(track), clip_id: clip.id, start_seconds: clip.start_seconds, end_seconds: clip.end_seconds, timecode: tc(clip.start_seconds), message: `${trackLabel(track)} clip '${clip.name ?? clip.id}' has no enabled video above ${tc(clip.start_seconds)} → ${tc(clip.end_seconds)}.` });
    }
  }

  if (!enabledVideo.length) skipped.push({ check: "leading_black", reason: "no enabled video clips" });
  else {
    checked.push("leading_black");
    const first = enabledVideo.reduce((min, clip) => (clip.start_seconds < min.start_seconds ? clip : min));
    if (first.start_seconds > half && secondsToFrame(first.start_seconds, frameRate) >= gapMin) {
      add({ code: "leading_black", severity: "warning", clip_id: first.id, start_seconds: 0, end_seconds: first.start_seconds, timecode: tc(0), message: `First enabled video starts at ${tc(first.start_seconds)}; the sequence opens with ${secondsToFrame(first.start_seconds, frameRate)} frames of black.` });
    }
  }

  const targetDuration = expectedDuration ?? snapshot.duration_seconds;
  if (targetDuration === undefined) skipped.push({ check: "trailing_gap", reason: "no expected_duration_seconds or snapshot duration" });
  else {
    checked.push("trailing_gap");
    const lastEnd = snapshot.tracks.flatMap((track) => track.clips).filter((clip) => !clip.disabled).reduce((max, clip) => Math.max(max, clip.end_seconds), 0);
    const trailing = targetDuration - lastEnd;
    if (trailing > half && secondsToFrame(trailing, frameRate) >= gapMin) {
      add({ code: "trailing_gap", severity: "warning", start_seconds: lastEnd, end_seconds: targetDuration, timecode: tc(lastEnd), message: `Last enabled clip ends at ${tc(lastEnd)}, leaving ${secondsToFrame(trailing, frameRate)} frames before ${tc(targetDuration)}.` });
    }
  }

  const severityRank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]
    || (a.start_seconds ?? -1) - (b.start_seconds ?? -1)
    || (a.track ?? "").localeCompare(b.track ?? "")
    || a.code.localeCompare(b.code)
    || (a.clip_id ?? "").localeCompare(b.clip_id ?? ""));
  const truncated = findings.length > MAX_FINDINGS;
  if (truncated) warnings.push(`Findings were truncated to ${MAX_FINDINGS}; counts and score reflect all ${findings.length}.`);

  const counts: Record<string, number> = {};
  const penaltyByCode: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.code] = (counts[finding.code] ?? 0) + 1;
    penaltyByCode[finding.code] = Math.min(HEALTH_PER_CODE_CAP, (penaltyByCode[finding.code] ?? 0) + HEALTH_WEIGHTS[finding.severity]);
  }
  const penalty = Object.values(penaltyByCode).reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, 100 - penalty);
  const severityCounts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) severityCounts[finding.severity] += 1;

  const reviewFrames = [...new Set(findings.filter((finding) => finding.severity === "error" && finding.start_seconds !== undefined).map((finding) => round6(Math.max(0, finding.start_seconds as number))))].sort((a, b) => a - b).slice(0, 32);
  const codesPresent = Object.keys(counts).sort() as HealthCheck[];
  const routes: Record<string, string[]> = {};
  for (const code of codesPresent) routes[code] = [...FIX_ROUTES[code]];
  const revision = snapshotRevision(snapshot);

  return {
    score,
    grade: score >= 90 ? "pass" : score >= 60 ? "review" : "fail",
    weights: { ...HEALTH_WEIGHTS, per_code_cap: HEALTH_PER_CODE_CAP },
    penalty,
    findings: truncated ? findings.slice(0, MAX_FINDINGS) : findings,
    truncated,
    counts,
    severity_counts: severityCounts,
    checked,
    skipped_checks: skipped,
    thresholds: { frame_rate: frameRate, flash_frame_max_frames: flashMax, gap_min_frames: gapMin, max_speed_percent: maxSpeed, ...(expectedDuration !== undefined ? { expected_duration_seconds: expectedDuration } : {}), ...(expectedFrameRate !== undefined ? { expected_frame_rate: expectedFrameRate } : {}) },
    track_count: snapshot.tracks.length,
    clip_count: snapshot.tracks.reduce((sum, track) => sum + track.clips.length, 0),
    duration_seconds: snapshotDuration(snapshot),
    snapshot_revision: revision,
    plan_revision: digest({ revision, frameRate, flashMax, gapMin, maxSpeed, expectedDuration: expectedDuration ?? null, expectedFrameRate: expectedFrameRate ?? null }),
    evidence: { snapshot_revision: revision, ...(snapshot.sequence_id ? { sequence_id: snapshot.sequence_id } : {}), ...(snapshot.name ? { sequence_name: snapshot.name } : {}) },
    routes,
    review_frame_seconds: reviewFrames,
    next_steps: [
      ...(reviewFrames.length ? ["export_sequence_review_frames"] : []),
      ...(counts.gap || counts.leading_black || counts.trailing_gap ? ["get_timeline_gaps", "ripple_delete"] : []),
      ...(counts.disabled_clip ? ["enable_disable_clip"] : []),
      ...(counts.flash_frame || counts.beyond_expected_duration ? ["trim_clip"] : []),
      "inspect_sequence_review_report",
    ].filter((value, index, list) => list.indexOf(value) === index),
    warnings,
    assumptions,
    applied: false,
  };
}
