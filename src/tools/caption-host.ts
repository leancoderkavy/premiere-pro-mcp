/**
 * Host-side helpers shared by the caption tools that touch Premiere: one read-only sequence probe
 * (frame rate, frame size, duration, track count, edit points for cut snapping), the import of a
 * written caption file, and the plan summary every receipt carries.
 *
 * Nothing here is proof of what Premiere shows: tests mock the bridge or run the scripts against
 * a fake DOM. Verify the look with playback or a short export.
 */
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { frameRateFromTimebaseTicks, PREMIERE_TICKS_PER_SECOND, type CaptionPlan } from "../ai/caption-plan.js";

export const CAPTION_CUT_SOURCES = ["none", "edit_points"] as const;
export type CaptionCutSource = (typeof CAPTION_CUT_SOURCES)[number];

/** Most edit points the host collects; more are cut off and flagged. */
export const MAX_EDIT_POINTS = 50_000;

/** JSON Schema for the cut_source parameter, shared by the caption tools that read the sequence. */
export const CAPTION_CUT_SOURCE_PROPERTY = {
  type: "string",
  enum: [...CAPTION_CUT_SOURCES],
  description: "none (default): no shot-change snapping from the timeline. edit_points: read the clip start and end times of the video tracks (all of them, except the caption graphics track) and snap captions to those cuts; merged with any cut_times you pass (for example from detect_scene_edits). Ignored for a saved plan_path, whose shot-change rules are already applied.",
} as const;

export function normalizeCutSource(value: unknown): CaptionCutSource {
  if (value === undefined || value === null) return "none";
  if (typeof value !== "string" || !(CAPTION_CUT_SOURCES as readonly string[]).includes(value)) {
    throw new Error(`cut_source must be one of: ${CAPTION_CUT_SOURCES.join(", ")}`);
  }
  return value as CaptionCutSource;
}

export interface CaptionSequenceReadOptions {
  /** Sequence ID or name; the active sequence when omitted. */
  sequence_id?: string;
  /** Also collect clip start/end times of the video tracks. */
  include_edit_points?: boolean;
  /** Video track index left out of the edit points (the caption graphics track). */
  exclude_video_track?: number;
}

export interface CaptionSequenceInfo {
  sequence_id: string;
  name: string;
  timebase_ticks: number;
  /** Frame rate derived from the timebase (snapped to a common rate within 0.01). */
  fps: number;
  /** The exact rate: ticks per second over ticks per frame. */
  exact_fps: number;
  frame_width: number;
  frame_height: number;
  duration_seconds: number | null;
  video_track_count: number;
  /** Sorted unique clip start/end times in seconds, 0 and the sequence end excluded. Present when asked for. */
  edit_points?: number[];
  edit_points_truncated?: boolean;
}

/** Pre-write refusal so a dispatched sequence inspect does not lock later Premiere edits. */
export function captionNotApplied(error: string, extra: Record<string, unknown> = {}) {
  return { success: false as const, error, data: { ...extra, mutationOutcome: "not_applied" as const, timelineChanged: false as const } };
}

/** One read-only CEP script that describes the target sequence. */
export function buildCaptionSequenceReadScript(opts: CaptionSequenceReadOptions = {}): string {
  const lookup = opts.sequence_id
    ? `var seq = __findSequence("${escapeForExtendScript(opts.sequence_id)}"); if (!seq) return __refuse("Sequence not found: ${escapeForExtendScript(opts.sequence_id)}");`
    : "var seq = app.project.activeSequence; if (!seq) return __refuse(\"No active sequence\");";
  const excluded = opts.exclude_video_track === undefined ? "-1" : String(Math.trunc(opts.exclude_video_track));
  return buildToolScript(`
    ${lookup}
    var frame = __sequenceFrameSize(seq);
    var timebase = "";
    try { timebase = String(seq.timebase); } catch (timebaseError) {}
    var endTicks = null;
    try { var endRead = parseFloat(seq.end); if (isFinite(endRead) && endRead >= 0) endTicks = endRead; } catch (endError) {}
    var videoTrackCount = 0;
    try { videoTrackCount = Number(seq.videoTracks.numTracks); } catch (trackError) {}
    var editPoints = null;
    var truncated = false;
    if (${opts.include_edit_points ? "true" : "false"}) {
      editPoints = [];
      for (var t = 0; t < videoTrackCount && !truncated; t++) {
        if (t === ${excluded}) continue;
        var clips = seq.videoTracks[t].clips;
        for (var c = 0; c < clips.numItems; c++) {
          if (editPoints.length >= ${MAX_EDIT_POINTS}) { truncated = true; break; }
          var startTicks = NaN, clipEndTicks = NaN;
          try { startTicks = parseFloat(clips[c].start.ticks); clipEndTicks = parseFloat(clips[c].end.ticks); } catch (clipError) {}
          if (isFinite(startTicks)) editPoints.push(__ticksToSeconds(startTicks));
          if (isFinite(clipEndTicks)) editPoints.push(__ticksToSeconds(clipEndTicks));
        }
      }
    }
    return __result({
      sequenceId: String(seq.sequenceID),
      sequenceName: String(seq.name),
      timebase: timebase,
      endTicks: endTicks,
      frameWidth: frame.width,
      frameHeight: frame.height,
      videoTrackCount: videoTrackCount,
      editPoints: editPoints,
      editPointsTruncated: truncated
    });
  `);
}

function fail(message: string): never {
  throw new Error(message);
}

/** Reads the sequence through the bridge. Throws Error with the host's or a clear message. */
export async function readCaptionSequence(bridgeOptions: BridgeOptions, opts: CaptionSequenceReadOptions = {}): Promise<CaptionSequenceInfo> {
  const response = await sendCommand(buildCaptionSequenceReadScript(opts), bridgeOptions);
  if (!response.success) fail(`Could not read the sequence: ${response.error ?? "unknown error"}`);
  const data = (response.data ?? {}) as Record<string, unknown>;
  const ticks = Number(data.timebase);
  if (!Number.isFinite(ticks) || ticks <= 0) fail("The sequence frame rate (timebase) could not be read, so captions cannot be timed to its frames. Nothing was changed.");
  const width = Number(data.frameWidth);
  const height = Number(data.frameHeight);
  if (!(width > 0) || !(height > 0)) fail("The sequence frame size could not be read. Nothing was changed.");
  const endTicks = typeof data.endTicks === "number" && Number.isFinite(data.endTicks) ? data.endTicks : null;
  const duration = endTicks === null ? null : endTicks / PREMIERE_TICKS_PER_SECOND;
  const trackCount = Number(data.videoTrackCount);
  const info: CaptionSequenceInfo = {
    sequence_id: String(data.sequenceId ?? ""),
    name: String(data.sequenceName ?? ""),
    timebase_ticks: ticks,
    fps: frameRateFromTimebaseTicks(ticks),
    exact_fps: PREMIERE_TICKS_PER_SECOND / ticks,
    frame_width: width,
    frame_height: height,
    duration_seconds: duration,
    video_track_count: Number.isInteger(trackCount) && trackCount >= 0 ? trackCount : 0,
  };
  if (Array.isArray(data.editPoints)) {
    const seen = new Set<number>();
    for (const value of data.editPoints) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const t = Math.round(value * 1e6) / 1e6;
      if (t <= 0.0005) continue;
      if (duration !== null && t >= duration - 0.0005) continue;
      seen.add(t);
    }
    info.edit_points = [...seen].sort((a, b) => a - b);
    if (data.editPointsTruncated === true) info.edit_points_truncated = true;
  }
  return info;
}

/** Counts and the first entries of a plan, for receipts. */
export function summarizeCaptionPlan(plan: CaptionPlan) {
  const captions = plan.captions;
  return {
    caption_count: captions.length,
    first_start: captions.length ? captions[0].start : null,
    last_end: captions.length ? captions[captions.length - 1].end : null,
    frame_rate: plan.settings.frame_rate,
    standard: plan.settings.standard ?? null,
    change_count: plan.changes.length,
    violation_count: plan.violations.length,
    changes: plan.changes.slice(0, 20),
    sequence_end: plan.settings.end_s ?? null,
    sequence_end_changes: plan.changes.filter((c) => c.rule === "sequence_end"),
    violations: plan.violations.slice(0, 20),
    warnings: plan.warnings,
    estimated_word_times: plan.estimated_word_times,
  };
}

/** A file-name-safe version of a sequence name. */
export function safeFileStem(name: string, fallback = "sequence"): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80).trim();
  return cleaned || fallback;
}

/**
 * Imports one caption file into the root bin and finds the new project item by its media path
 * (normalised fsName; case-insensitive on Windows). The caller creates the caption track in a
 * separate command.
 */
export function buildImportCaptionFileScript(filePath: string): string {
  return buildToolScript(`
    var filePath = "${escapeForExtendScript(filePath)}";
    var wanted = new File(filePath);
    if (!wanted.exists) return __refuse("The caption file does not exist: " + filePath + ". Nothing was imported.");
    var root = app.project.rootItem;
    function __rootIds() {
      var ids = {};
      var total = __childCount(root);
      for (var r = 0; r < total; r++) { var child = __childAt(root, r); if (child) ids[String(child.nodeId)] = true; }
      return ids;
    }
    function __normPath(value) {
      var text = String(new File(String(value)).fsName);
      if (String($.os).toLowerCase().indexOf("windows") !== -1) text = text.toLowerCase();
      return text;
    }
    var before = __rootIds();
    var importReturned = false, hostError = null;
    try { importReturned = app.project.importFiles([filePath], true, root, false); }
    catch (importError) { hostError = importError.toString(); }
    var wantedPath = __normPath(filePath);
    var added = [];
    var matches = [];
    var total = __childCount(root);
    for (var i = 0; i < total; i++) {
      var item = __childAt(root, i);
      if (!item || before[String(item.nodeId)]) continue;
      var mediaPath = "";
      try { mediaPath = String(item.getMediaPath()); } catch (pathError) {}
      added.push({ nodeId: String(item.nodeId), name: String(item.name), mediaPath: mediaPath });
      if (mediaPath && __normPath(mediaPath) === wantedPath) matches.push({ nodeId: String(item.nodeId), name: String(item.name), mediaPath: mediaPath });
    }
    var receipt = { importReturned: !!importReturned, hostError: hostError, newRootItems: added, filePath: filePath };
    if (!matches.length) {
      receipt.outcome = "failed";
      return __error("Premiere produced no project item with the media path of the caption file. Inspect the project bin before retrying; the file is on disk and can be imported by hand.", receipt);
    }
    receipt.imported = true;
    receipt.verified = true;
    receipt.outcome = "verified";
    receipt.item = matches[0];
    receipt.matchCount = matches.length;
    return __result(receipt);
  `);
}
