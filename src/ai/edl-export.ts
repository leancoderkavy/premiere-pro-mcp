import { createHash } from "node:crypto";
import { parseCmx3600Edl, validateCmx3600Edl, type CmxFrameRate, type CmxValidation } from "../tools/interchange-analysis.js";

/**
 * CMX 3600 EDL writer (local-only).
 *
 * Premiere's scripting surfaces do not expose EDL export, yet colorists,
 * online editors, and conform tools still ask for one. This module builds a
 * CMX 3600 list from a sequence snapshot that the CEP bridge already reads
 * back (clip names, source in/out, record in/out, enabled state, speed). The
 * result is parsed and validated with the repository's own CMX 3600 reader
 * before it is returned, so a malformed list can never be reported as ready.
 *
 * Boundaries: one track per list (CMX 3600 is single-track), cuts only
 * (Premiere's DOM does not expose transition timing reliably through CEP),
 * retimed clips are flagged with an M2 motion-memory line, and source
 * timecode is taken from the readback's media start when present, otherwise
 * from zero. Nothing here contacts Premiere or writes a file.
 */

export const CMX_TIMECODE_RATES: readonly CmxFrameRate[] = [24, 25, 29.97, 30, 50, 59.94, 60];
export const MAX_EDL_EVENTS = 2_000;
export const MAX_EDL_TITLE_LENGTH = 70;
export const MAX_REEL_LENGTH = 8;
export const REEL_MODES = ["clip_name", "tape_name", "numbered"] as const;
export type ReelMode = (typeof REEL_MODES)[number];
export const EDL_TRACK_TYPES = ["video", "audio"] as const;
export type EdlTrackType = (typeof EDL_TRACK_TYPES)[number];

const EPSILON = 1e-6;
const RATE_TOLERANCE = 0.02;

export type EdlSnapshotClip = {
  nodeId?: unknown;
  name?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  inPointSeconds?: unknown;
  outPointSeconds?: unknown;
  enabled?: unknown;
  speed?: unknown;
  projectItemName?: unknown;
  mediaStartSeconds?: unknown;
  tapeName?: unknown;
};

export type EdlSnapshotTrack = { type?: unknown; index?: unknown; name?: unknown; clips?: unknown };

export type EdlSnapshot = {
  name?: unknown;
  id?: unknown;
  frameRate?: unknown;
  zeroPointSeconds?: unknown;
  dropFrame?: unknown;
  tracks?: unknown;
};

export type EdlExportOptions = {
  track_type?: unknown;
  track_index?: unknown;
  frame_rate?: unknown;
  drop_frame?: unknown;
  title?: unknown;
  reel_mode?: unknown;
  include_disabled?: unknown;
  record_start_seconds?: unknown;
  include_clip_name_comments?: unknown;
};

export type EdlEvent = {
  event_number: number;
  reel: string;
  clip_name: string;
  node_id: string | null;
  track: string;
  transition: "C";
  source_in: string;
  source_out: string;
  record_in: string;
  record_out: string;
  source_in_seconds: number;
  source_out_seconds: number;
  record_in_seconds: number;
  record_out_seconds: number;
  speed_percent: number;
  motion_line: string | null;
  disabled: boolean;
};

export type EdlExport = {
  edl: string;
  title: string;
  sequence_name: string | null;
  sequence_id: string | null;
  track_type: EdlTrackType;
  track_index: number;
  actual_frame_rate: number;
  timecode_rate: CmxFrameRate;
  drop_frame: boolean;
  record_start_seconds: number;
  event_count: number;
  skipped_disabled: number;
  retimed_events: number;
  reels: Array<{ reel: string; clip_name: string; source: "clip_name" | "tape_name" | "numbered" }>;
  events: EdlEvent[];
  validation: CmxValidation;
  edl_sha256: string;
  plan_revision: string;
  warnings: string[];
  assumptions: string[];
};

type Clip = {
  nodeId: string | null;
  name: string;
  tapeName: string | null;
  start: number;
  end: number;
  inPoint: number;
  outPoint: number;
  mediaStart: number;
  enabled: boolean;
  speed: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, label: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback === undefined) fail(`${label} is required`);
    return fallback;
  }
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) fail(`${label} must be a finite number`);
  return number;
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function optionalEnum<T extends string>(value: unknown, label: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

/** Chooses the CMX timecode rate for a measured sequence frame rate. */
export function resolveTimecodeRate(actualFps: number, override?: unknown): { rate: CmxFrameRate; note: string | null } {
  if (override !== undefined) {
    if (typeof override !== "number" || !CMX_TIMECODE_RATES.includes(override as CmxFrameRate)) fail(`frame_rate must be one of: ${CMX_TIMECODE_RATES.join(", ")}`);
    return { rate: override as CmxFrameRate, note: Math.abs(override - actualFps) > RATE_TOLERANCE ? `frame_rate ${override} overrides the sequence rate ${actualFps.toFixed(3)}` : null };
  }
  for (const rate of CMX_TIMECODE_RATES) if (Math.abs(rate - actualFps) <= RATE_TOLERANCE) return { rate, note: null };
  if (Math.abs(actualFps - 23.976) <= RATE_TOLERANCE) return { rate: 24, note: "23.976 fps sequence written with 24 fps timecode (CMX 3600 convention)" };
  if (Math.abs(actualFps - 47.952) <= RATE_TOLERANCE) return { rate: 50, note: "47.952 fps sequence written with 50 fps timecode; verify the conform target accepts it" };
  fail(`Sequence frame rate ${actualFps.toFixed(3)} has no CMX 3600 timecode rate; pass frame_rate to choose one of ${CMX_TIMECODE_RATES.join(", ")}`);
}

function nominalRate(rate: CmxFrameRate): number {
  return rate === 29.97 ? 30 : rate === 59.94 ? 60 : rate;
}

/** Formats a frame count as CMX timecode, drop-frame when requested (29.97/59.94 only). */
export function framesToTimecode(frameCount: number, rate: CmxFrameRate, dropFrame: boolean): string {
  const nominal = nominalRate(rate);
  const pad = (value: number) => String(value).padStart(2, "0");
  let frames = Math.max(0, Math.round(frameCount));
  if (dropFrame) {
    if (rate !== 29.97 && rate !== 59.94) fail("Drop-frame timecode is only defined at 29.97 or 59.94 fps");
    const dropped = rate === 29.97 ? 2 : 4;
    const framesPerTenMinutes = nominal * 600 - dropped * 9;
    const framesPerMinute = nominal * 60 - dropped;
    const tens = Math.floor(frames / framesPerTenMinutes);
    const remainder = frames % framesPerTenMinutes;
    frames += dropped * 9 * tens;
    if (remainder > dropped) frames += dropped * Math.floor((remainder - dropped) / framesPerMinute);
  }
  const ff = frames % nominal;
  const totalSeconds = Math.floor(frames / nominal);
  const hh = Math.floor(totalSeconds / 3600) % 24;
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${dropFrame ? ";" : ":"}${pad(ff)}`;
}

function secondsToFrames(seconds: number, rate: CmxFrameRate): number {
  return Math.round(seconds * rate);
}

function sanitizeReel(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, MAX_REEL_LENGTH);
  return cleaned || "AX";
}

function parseClips(track: Record<string, unknown>, label: string): Clip[] {
  const clips = track.clips;
  if (!Array.isArray(clips)) fail(`${label}.clips must be an array`);
  if (clips.length > MAX_EDL_EVENTS) fail(`${label} has more than ${MAX_EDL_EVENTS} clips`);
  return clips.map((entry, index) => {
    if (!isRecord(entry)) fail(`${label}.clips[${index}] must be an object`);
    const start = finite(entry.startSeconds ?? entry.start_seconds, `${label}.clips[${index}].startSeconds`);
    const end = finite(entry.endSeconds ?? entry.end_seconds, `${label}.clips[${index}].endSeconds`);
    if (end <= start) fail(`${label}.clips[${index}] must end after it starts`);
    const inPoint = finite(entry.inPointSeconds ?? entry.in_seconds, `${label}.clips[${index}].inPointSeconds`, 0);
    const outPoint = finite(entry.outPointSeconds ?? entry.out_seconds, `${label}.clips[${index}].outPointSeconds`, inPoint + (end - start));
    const mediaStart = finite(entry.mediaStartSeconds, `${label}.clips[${index}].mediaStartSeconds`, 0);
    let speed = finite(entry.speed_percent ?? entry.speed, `${label}.clips[${index}].speed`, 100);
    // get_sequence_structure reports getSpeed() as a multiplier (1 = 100%); the
    // export readback already scales to percent. Treat |x| <= 10 as a multiplier.
    if (entry.speed_percent === undefined && Math.abs(speed) <= 10) speed *= 100;
    const enabled = entry.enabled === undefined ? entry.disabled !== true : entry.enabled !== false;
    const rawName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : typeof entry.projectItemName === "string" && entry.projectItemName.trim() ? entry.projectItemName.trim() : `CLIP ${index + 1}`;
    const tapeName = typeof entry.tapeName === "string" && entry.tapeName.trim() ? entry.tapeName.trim() : null;
    const nodeId = typeof entry.nodeId === "string" ? entry.nodeId : typeof entry.id === "string" ? entry.id : null;
    return { nodeId, name: rawName.slice(0, 255), tapeName, start, end, inPoint, outPoint, mediaStart, enabled, speed };
  }).sort((left, right) => left.start - right.start);
}

function selectTrack(snapshot: Record<string, unknown>, type: EdlTrackType, index: number): Record<string, unknown> {
  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : null;
  if (tracks) {
    const match = tracks.find((track) => isRecord(track) && (track.type ?? track.mediaType) === type && Number(track.index ?? track.trackIndex) === index);
    if (!isRecord(match)) fail(`No ${type} track with index ${index} exists in the snapshot`);
    return match;
  }
  const raw = type === "video" ? snapshot.videoTracks : snapshot.audioTracks;
  if (!Array.isArray(raw)) fail("snapshot must include tracks, videoTracks, or audioTracks");
  const match = raw.find((track) => isRecord(track) && Number(track.index) === index) ?? raw[index];
  if (!isRecord(match)) fail(`No ${type} track with index ${index} exists in the snapshot`);
  return match;
}

/** Builds and self-validates a CMX 3600 EDL for one track of a sequence snapshot. */
export function buildCmx3600Edl(snapshotInput: unknown, options: EdlExportOptions = {}): EdlExport {
  if (!isRecord(snapshotInput)) fail("snapshot must be an object");
  const snapshot = snapshotInput;
  const trackType = optionalEnum(options.track_type, "track_type", EDL_TRACK_TYPES, "video");
  const trackIndex = finite(options.track_index, "track_index", 0);
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex > 255) fail("track_index must be an integer from 0 through 255");
  const actualFps = finite(snapshot.frameRate ?? snapshot.frame_rate, "snapshot.frameRate", 30);
  if (actualFps <= 0 || actualFps > 240) fail("snapshot.frameRate must be between 0 and 240");
  const { rate, note } = resolveTimecodeRate(actualFps, options.frame_rate);
  const dropDefault = snapshot.dropFrame === true && (rate === 29.97 || rate === 59.94);
  const dropFrame = optionalBoolean(options.drop_frame, "drop_frame", dropDefault);
  if (dropFrame && rate !== 29.97 && rate !== 59.94) fail("drop_frame is only valid at 29.97 or 59.94 fps");
  const reelMode = optionalEnum(options.reel_mode, "reel_mode", REEL_MODES, "clip_name");
  const includeDisabled = optionalBoolean(options.include_disabled, "include_disabled", false);
  const includeComments = optionalBoolean(options.include_clip_name_comments, "include_clip_name_comments", true);
  const zeroPoint = finite(snapshot.zeroPointSeconds, "snapshot.zeroPointSeconds", 0);
  const recordStart = finite(options.record_start_seconds, "record_start_seconds", zeroPoint);
  if (recordStart < 0 || recordStart > 86_400) fail("record_start_seconds must be from 0 through 86400");
  const sequenceName = typeof snapshot.name === "string" && snapshot.name.trim() ? snapshot.name.trim() : null;
  const sequenceId = typeof snapshot.id === "string" || typeof snapshot.id === "number" ? String(snapshot.id) : null;
  const titleSource = options.title === undefined ? sequenceName ?? "PREMIERE SEQUENCE" : options.title;
  if (typeof titleSource !== "string" || !titleSource.trim() || titleSource.length > MAX_EDL_TITLE_LENGTH) fail(`title must be a non-empty string of at most ${MAX_EDL_TITLE_LENGTH} characters`);
  const title = titleSource.trim().replace(/[\r\n]+/g, " ");

  const track = selectTrack(snapshot, trackType, trackIndex);
  const clips = parseClips(track, `${trackType}Tracks[${trackIndex}]`);
  const warnings: string[] = [];
  const assumptions: string[] = [
    "CMX 3600 is a single-track format; this list covers exactly one Premiere track and writes cuts only.",
    "Source timecode starts at mediaStartSeconds when the readback provides it, otherwise at 00:00:00:00 plus the clip in point.",
    "Record timecode starts at the sequence zero point (or record_start_seconds) plus the clip position.",
  ];
  if (note) warnings.push(note);
  if (clips.length === 0) fail(`${trackType} track ${trackIndex} has no clips to export`);

  const reels: EdlExport["reels"] = [];
  const reelByName = new Map<string, string>();
  const usedReels = new Set<string>();
  const reelFor = (clip: Clip, ordinal: number): { reel: string; source: "clip_name" | "tape_name" | "numbered" } => {
    if (reelMode === "numbered") {
      const reel = String(ordinal).padStart(3, "0");
      reels.push({ reel, clip_name: clip.name, source: "numbered" });
      return { reel, source: "numbered" };
    }
    const preferred = reelMode === "tape_name" && clip.tapeName ? clip.tapeName : clip.name;
    const source: "clip_name" | "tape_name" = reelMode === "tape_name" && clip.tapeName ? "tape_name" : "clip_name";
    const existing = reelByName.get(preferred);
    if (existing) return { reel: existing, source };
    let reel = sanitizeReel(preferred);
    let suffix = 1;
    while (usedReels.has(reel)) {
      const digits = String(++suffix);
      reel = `${sanitizeReel(preferred).slice(0, MAX_REEL_LENGTH - digits.length)}${digits}`;
    }
    usedReels.add(reel);
    reelByName.set(preferred, reel);
    reels.push({ reel, clip_name: preferred, source });
    return { reel, source };
  };

  const events: EdlEvent[] = [];
  const lines: string[] = [`TITLE: ${title}`, `FCM: ${dropFrame ? "DROP FRAME" : "NON-DROP FRAME"}`, ""];
  let skippedDisabled = 0;
  let retimed = 0;
  let previousRecordOut: number | null = null;
  const trackCode = trackType === "video" ? "V" : trackIndex === 0 ? "A" : `A${trackIndex + 1}`;

  for (const clip of clips) {
    if (!clip.enabled && !includeDisabled) {
      skippedDisabled++;
      continue;
    }
    if (events.length >= MAX_EDL_EVENTS) fail(`The EDL exceeds the ${MAX_EDL_EVENTS}-event limit`);
    const eventNumber = events.length + 1;
    const recordInSeconds = recordStart + clip.start;
    const recordOutSeconds = recordStart + clip.end;
    const sourceInSeconds = clip.mediaStart + clip.inPoint;
    const speedFactor = Math.abs(clip.speed) > EPSILON ? Math.abs(clip.speed) / 100 : 1;
    // For an untouched clip the source span equals the record span; a retimed
    // clip keeps the host's own out point and gets an M2 motion-memory line.
    const sourceOutSeconds = Math.abs(clip.speed - 100) <= EPSILON ? sourceInSeconds + (clip.end - clip.start) : clip.mediaStart + clip.outPoint;
    const recordIn = secondsToFrames(recordInSeconds, rate);
    const recordOut = secondsToFrames(recordOutSeconds, rate);
    const sourceIn = secondsToFrames(sourceInSeconds, rate);
    let sourceOut = secondsToFrames(sourceOutSeconds, rate);
    if (recordOut <= recordIn) fail(`Clip '${clip.name}' collapses to zero frames at ${rate} fps`);
    if (sourceOut <= sourceIn) sourceOut = sourceIn + (recordOut - recordIn);
    if (previousRecordOut !== null && recordIn < previousRecordOut) {
      fail(`Clip '${clip.name}' overlaps the previous event on ${trackType} track ${trackIndex}; export one track at a time from a flattened sequence`);
    }
    if (previousRecordOut !== null && recordIn > previousRecordOut) warnings.push(`Gap of ${recordIn - previousRecordOut} frame(s) before event ${eventNumber} ('${clip.name}')`);
    previousRecordOut = recordOut;
    const { reel } = reelFor(clip, eventNumber);
    const event: EdlEvent = {
      event_number: eventNumber,
      reel,
      clip_name: clip.name,
      node_id: clip.nodeId,
      track: trackCode,
      transition: "C",
      source_in: framesToTimecode(sourceIn, rate, dropFrame),
      source_out: framesToTimecode(sourceOut, rate, dropFrame),
      record_in: framesToTimecode(recordIn, rate, dropFrame),
      record_out: framesToTimecode(recordOut, rate, dropFrame),
      source_in_seconds: Number(sourceInSeconds.toFixed(6)),
      source_out_seconds: Number(sourceOutSeconds.toFixed(6)),
      record_in_seconds: Number(recordInSeconds.toFixed(6)),
      record_out_seconds: Number(recordOutSeconds.toFixed(6)),
      speed_percent: clip.speed,
      motion_line: null,
      disabled: !clip.enabled,
    };
    if (Math.abs(clip.speed - 100) > EPSILON) {
      retimed++;
      // CMX motion memory: signed play speed in frames per second, e.g. "050.0" or "-025.0".
      const motionFps = `${clip.speed < 0 ? "-" : ""}${(rate * speedFactor).toFixed(1).padStart(5, "0")}`;
      event.motion_line = `M2   ${reel.padEnd(MAX_REEL_LENGTH)} ${motionFps.padStart(6)} ${event.source_in}`;
    }
    events.push(event);
    lines.push(`${String(eventNumber).padStart(3, "0")}  ${reel.padEnd(MAX_REEL_LENGTH)} ${trackCode.padEnd(5)} ${event.transition}        ${event.source_in} ${event.source_out} ${event.record_in} ${event.record_out}`);
    if (event.motion_line) lines.push(event.motion_line);
    if (includeComments) lines.push(`* FROM CLIP NAME: ${clip.name.replace(/[\r\n]+/g, " ").slice(0, 200)}`);
    if (!clip.enabled) lines.push("* DISABLED IN PREMIERE");
    lines.push("");
  }
  if (events.length === 0) fail(`${trackType} track ${trackIndex} has no enabled clips; pass include_disabled to export disabled clips`);
  if (skippedDisabled > 0) warnings.push(`${skippedDisabled} disabled clip(s) were skipped; pass include_disabled to keep them.`);
  if (retimed > 0) warnings.push(`${retimed} retimed clip(s) carry M2 motion lines; confirm the conform target honours them.`);

  const edl = `${lines.join("\r\n").replace(/(\r\n)+$/, "")}\r\n`;
  const validation = validateCmx3600Edl(parseCmx3600Edl(edl), rate);
  if (!validation.valid) fail(`Generated EDL failed self-validation: ${validation.errors.join("; ")}`);
  const digest = createHash("sha256").update(edl).digest("hex");

  return {
    edl,
    title,
    sequence_name: sequenceName,
    sequence_id: sequenceId,
    track_type: trackType,
    track_index: trackIndex,
    actual_frame_rate: Number(actualFps.toFixed(3)),
    timecode_rate: rate,
    drop_frame: dropFrame,
    record_start_seconds: Number(recordStart.toFixed(6)),
    event_count: events.length,
    skipped_disabled: skippedDisabled,
    retimed_events: retimed,
    reels,
    events,
    validation,
    edl_sha256: digest,
    plan_revision: `sha256:${createHash("sha256").update(JSON.stringify({ digest, trackType, trackIndex, rate, dropFrame, reelMode, includeDisabled, recordStart, title })).digest("hex")}`,
    warnings,
    assumptions,
  };
}
