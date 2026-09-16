import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import { resolveContainedOutputPath, MAX_INLINE_ARTIFACT_BYTES } from "./caption-authoring.js";
import {
  buildCmx3600Edl,
  CMX_TIMECODE_RATES,
  EDL_TRACK_TYPES,
  MAX_EDL_TITLE_LENGTH,
  REEL_MODES,
} from "../ai/edl-export.js";

/**
 * Editor-request tools: the concrete asks that come up repeatedly in editor
 * communities and competing Premiere MCP servers, implemented on the
 * production CEP bridge with the same preflight-then-readback contract as the
 * rest of the catalog.
 *
 * - add_markers_batch: drop beat grids, chapters, silence reviews, and client
 *   notes onto a sequence in one verified call instead of one marker per call.
 * - select_clips_by_pattern: "select every other clip" and friends.
 * - navigate_playhead: start/end/in/out/edit/marker/frame stepping with readback.
 * - create_sequence_checkpoint / list_sequence_checkpoints: named sequence
 *   clones plus a diff-ready snapshot before a risky edit.
 * - export_sequence_edl: CMX 3600 EDL generated from timeline readback.
 */

export const MAX_BATCH_MARKERS = 200;
export const MAX_EVERY_NTH = 64;
export const MAX_STEP_FRAMES = 10_000;
export const CHECKPOINT_PREFIX = "[checkpoint]";
export const MAX_CHECKPOINT_LABEL_LENGTH = 64;
export const PLAYHEAD_ACTIONS = [
  "start",
  "end",
  "in_point",
  "out_point",
  "work_area_in",
  "work_area_out",
  "next_edit",
  "previous_edit",
  "next_marker",
  "previous_marker",
  "step_forward",
  "step_backward",
] as const;
export type PlayheadAction = (typeof PLAYHEAD_ACTIONS)[number];

const MAX_PATH_LENGTH = 4096;

type BatchMarker = {
  time_seconds: number;
  name?: string;
  comments?: string;
  color?: number;
  duration_seconds?: number;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function sequenceLookup(sequenceId: string | undefined): string {
  return sequenceId
    ? `var seq = __findSequence("${escapeForExtendScript(sequenceId)}"); if (!seq) return __error("Sequence not found: ${escapeForExtendScript(sequenceId)}");`
    : `var seq = __getCurrentActiveSequence(); if (!seq) return __error("No active sequence");`;
}

function jsString(value: string | undefined): string {
  return value === undefined ? "null" : `"${escapeForExtendScript(value)}"`;
}

function utcStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Shared ES3 snippet that serializes one sequence into a diff_sequence_snapshots-compatible structure. */
const SNAPSHOT_HELPER = `
  function __sequenceSnapshot(target) {
    function trackList(tracks, includeSpeed) {
      var out = [];
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        var clips = [];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var info = {
            index: c,
            nodeId: clip.nodeId,
            name: clip.name,
            startSeconds: __ticksToSeconds(clip.start.ticks),
            endSeconds: __ticksToSeconds(clip.end.ticks),
            durationSeconds: __ticksToSeconds(clip.duration.ticks),
            inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
            outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
            enabled: true
          };
          try { info.enabled = !clip.isDisabled(); } catch (disabledError) {}
          if (includeSpeed) { try { info.speed = clip.getSpeed(); } catch (speedError) {} }
          try { if (clip.projectItem) info.sourceProjectItemId = clip.projectItem.nodeId; } catch (sourceError) {}
          clips.push(info);
        }
        var entry = { index: t, name: track.name, clipCount: clips.length, clips: clips };
        try { entry.isMuted = track.isMuted(); } catch (muteError) {}
        try { entry.isLocked = track.isLocked(); } catch (lockError) {}
        out.push(entry);
      }
      return out;
    }
    var frameTicks = parseFloat(target.timebase);
    var snapshot = {
      name: target.name,
      id: String(target.sequenceID),
      durationSeconds: __ticksToSeconds(target.end),
      frameRate: frameTicks > 0 ? TICKS_PER_SECOND / frameTicks : null,
      videoTracks: trackList(target.videoTracks, true),
      audioTracks: trackList(target.audioTracks, false)
    };
    snapshot.videoTrackCount = snapshot.videoTracks.length;
    snapshot.audioTrackCount = snapshot.audioTracks.length;
    return snapshot;
  }
`;

export function getEditorRequestTools(bridgeOptions: BridgeOptions) {
  return {
    add_markers_batch: {
      description:
        "Add up to 200 sequence or clip markers in one verified CEP request (beat grids, chapters, silence reviews, client notes). Every marker is validated and range-checked before the first write; the tool reads back the marker count and each created marker's time and fails closed on any mismatch.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          markers: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BATCH_MARKERS,
            description: "Markers to create, in any order; they are sorted by time before writing.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                time_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Marker time in sequence (or clip-relative) seconds." },
                name: { type: "string", maxLength: 255, description: "Marker name." },
                comments: { type: "string", maxLength: 2000, description: "Marker comments." },
                color: { type: "integer", minimum: 0, maximum: 7, description: "Marker color index (0=Green, 1=Red, 2=Purple, 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan)." },
                duration_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Marker duration in seconds (0 or omitted for a point marker)." },
              },
              required: ["time_seconds"],
            },
          },
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Sequence ID or name. Defaults to the active sequence." },
          node_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional timeline clip node ID; markers are then created on that clip instead of the sequence (requires the active sequence)." },
          skip_existing_within_frames: { type: "integer", minimum: 0, maximum: 120, description: "When above 0, skip a marker if an existing marker already sits within this many frames of it (default 0 = never skip)." },
          allow_beyond_end: { type: "boolean", description: "Allow marker times past the sequence end instead of rejecting the whole batch (default false)." },
        },
        required: ["markers"],
      },
      handler: async (args: {
        markers: BatchMarker[];
        sequence_id?: string;
        node_id?: string;
        skip_existing_within_frames?: number;
        allow_beyond_end?: boolean;
      }): Promise<CommandResult> => {
        if (!Array.isArray(args.markers) || args.markers.length < 1 || args.markers.length > MAX_BATCH_MARKERS) {
          return { success: false, error: `markers must contain between 1 and ${MAX_BATCH_MARKERS} entries.` };
        }
        if (args.sequence_id && args.node_id) return { success: false, error: "sequence_id and node_id cannot be combined; clip markers always target the active sequence." };
        const skipWithin = args.skip_existing_within_frames ?? 0;
        if (!isInteger(skipWithin, 0, 120)) return { success: false, error: "skip_existing_within_frames must be an integer from 0 through 120." };
        const prepared: Array<Required<Pick<BatchMarker, "time_seconds" | "duration_seconds">> & { name: string | null; comments: string | null; color: number | null }> = [];
        const seen = new Set<string>();
        let duplicates = 0;
        for (let index = 0; index < args.markers.length; index++) {
          const marker = args.markers[index];
          if (!marker || !finiteNumber(marker.time_seconds) || marker.time_seconds < 0 || marker.time_seconds > 86_400) {
            return { success: false, error: `markers[${index}].time_seconds must be a finite number from 0 through 86400. No marker was written.` };
          }
          const duration = marker.duration_seconds ?? 0;
          if (!finiteNumber(duration) || duration < 0 || duration > 86_400) return { success: false, error: `markers[${index}].duration_seconds must be a finite number from 0 through 86400. No marker was written.` };
          if (marker.color !== undefined && !isInteger(marker.color, 0, 7)) return { success: false, error: `markers[${index}].color must be an integer from 0 through 7. No marker was written.` };
          if (marker.name !== undefined && (typeof marker.name !== "string" || marker.name.length > 255)) return { success: false, error: `markers[${index}].name must be a string of at most 255 characters.` };
          if (marker.comments !== undefined && (typeof marker.comments !== "string" || marker.comments.length > 2000)) return { success: false, error: `markers[${index}].comments must be a string of at most 2000 characters.` };
          const key = `${marker.time_seconds}|${marker.name ?? ""}|${duration}`;
          if (seen.has(key)) {
            duplicates++;
            continue;
          }
          seen.add(key);
          prepared.push({ time_seconds: marker.time_seconds, duration_seconds: duration, name: marker.name ?? null, comments: marker.comments ?? null, color: marker.color ?? null });
        }
        prepared.sort((left, right) => left.time_seconds - right.time_seconds);
        const emitted = prepared.map((marker) => `{ t: ${marker.time_seconds}, d: ${marker.duration_seconds}, n: ${jsString(marker.name ?? undefined)}, c: ${jsString(marker.comments ?? undefined)}, k: ${marker.color === null ? "null" : marker.color} }`).join(",\n");
        const target = args.node_id
          ? `var seq = __getCurrentActiveSequence(); if (!seq) return __error("No active sequence");
             var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
             var markers = clipResult.clip.markers;
             var limitSeconds = __ticksToSeconds(clipResult.clip.duration.ticks);
             var targetKind = "clip";`
          : `${sequenceLookup(args.sequence_id)}
             var markers = seq.markers;
             var limitSeconds = __ticksToSeconds(seq.end);
             var targetKind = "sequence";`;
        const script = buildToolScript(`
          ${target}
          var requested = [${emitted}];
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 30;
          var frameSeconds = frameTicks / TICKS_PER_SECOND;
          var allowBeyondEnd = ${args.allow_beyond_end ? "true" : "false"};
          var existing = [];
          var probe = markers.getFirstMarker();
          while (probe) {
            existing.push(__ticksToSeconds(probe.start.ticks));
            probe = markers.getNextMarker(probe);
          }
          var beforeCount = existing.length;
          var i;
          // Preflight range before any write so a bad late entry cannot leave a partial batch.
          for (i = 0; i < requested.length; i++) {
            if (!allowBeyondEnd && requested[i].t > limitSeconds + frameSeconds) {
              return __error("markers[" + i + "] at " + requested[i].t + "s is beyond the " + targetKind + " end (" + limitSeconds + "s). No marker was written; pass allow_beyond_end to override.");
            }
          }
          var skipWithinSeconds = ${skipWithin} * frameSeconds;
          var toWrite = [];
          var skipped = [];
          for (i = 0; i < requested.length; i++) {
            var near = false;
            if (skipWithinSeconds > 0) {
              for (var e = 0; e < existing.length; e++) {
                if (Math.abs(existing[e] - requested[i].t) <= skipWithinSeconds + 0.0001) { near = true; break; }
              }
            }
            if (near) skipped.push({ timeSeconds: requested[i].t, name: requested[i].n }); else toWrite.push(requested[i]);
          }
          var created = [];
          for (i = 0; i < toWrite.length; i++) {
            var spec = toWrite[i];
            var marker;
            try { marker = markers.createMarker(spec.t); } catch (createError) {
              return __error("Premiere rejected marker " + i + " at " + spec.t + "s after " + created.length + " verified marker(s): " + createError.toString());
            }
            if (!marker) return __error("Premiere returned no marker for entry " + i + " at " + spec.t + "s after " + created.length + " verified marker(s).");
            try {
              if (spec.n !== null) marker.name = spec.n;
              if (spec.c !== null) marker.comments = spec.c;
              if (spec.k !== null) marker.setColorByIndex(spec.k);
              if (spec.d > 0) marker.end = spec.t + spec.d;
            } catch (assignError) {
              return __error("Premiere created marker " + i + " but rejected its properties: " + assignError.toString());
            }
            var actualStart = __ticksToSeconds(marker.start.ticks);
            if (Math.abs(actualStart - spec.t) > frameSeconds) {
              return __error("Marker " + i + " landed at " + actualStart + "s instead of " + spec.t + "s; the batch is not reported as verified.");
            }
            created.push({ timeSeconds: actualStart, name: marker.name, comments: marker.comments, endSeconds: __ticksToSeconds(marker.end.ticks), requestedColor: spec.k });
          }
          var afterCount = 0;
          probe = markers.getFirstMarker();
          while (probe) { afterCount++; probe = markers.getNextMarker(probe); }
          if (afterCount !== beforeCount + created.length) {
            return __error("Marker count changed from " + beforeCount + " to " + afterCount + " but " + created.length + " marker(s) were requested; the batch is not reported as verified.");
          }
          return __result({
            added: created.length > 0,
            verified: true,
            target: targetKind,
            requestedCount: requested.length,
            createdCount: created.length,
            skippedExistingCount: skipped.length,
            skipped: skipped,
            markerCountBefore: beforeCount,
            markerCountAfter: afterCount,
            markers: created,
            verificationScope: "Marker collection readback only; colors are requested values and are not read back by Premiere's DOM."
          });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (result.success && duplicates > 0 && result.data && typeof result.data === "object") {
          return { ...result, data: { ...(result.data as Record<string, unknown>), duplicateRequestsIgnored: duplicates } };
        }
        return result;
      },
    },

    select_clips_by_pattern: {
      description:
        "Select every Nth clip (with an offset) among clips that match optional name, duration, time-range, track, and enabled filters, then read back the selection count. Covers 'select every other clip on V1' and similar repetitive selections without changing the timeline.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          every_nth: { type: "integer", minimum: 1, maximum: MAX_EVERY_NTH, description: "Select one clip out of every N candidates (default 1 = all candidates)." },
          offset: { type: "integer", minimum: 0, maximum: MAX_EVERY_NTH - 1, description: "Zero-based index of the first candidate to select (default 0). Must be below every_nth." },
          track_type: { type: "string", enum: ["video", "audio", "both"], description: "Track type to scan (default video)." },
          track_index: { type: "integer", minimum: 0, maximum: 255, description: "Restrict to one track index." },
          count_scope: { type: "string", enum: ["per_track", "across_tracks"], description: "Whether the Nth count restarts on each track (default) or runs across all scanned tracks in timeline order." },
          name_contains: { type: "string", maxLength: 255, description: "Case-insensitive substring the clip name must contain." },
          name_regex: { type: "string", maxLength: 255, description: "Case-insensitive ECMAScript 3 compatible regular expression the clip name must match." },
          min_duration_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Minimum clip duration." },
          max_duration_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Maximum clip duration." },
          start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Only clips overlapping at or after this sequence time." },
          end_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Only clips overlapping before this sequence time." },
          include_disabled: { type: "boolean", description: "Include disabled clips as candidates (default true)." },
          add_to_selection: { type: "boolean", description: "Keep the existing selection instead of replacing it (default false)." },
        },
      },
      handler: async (args: {
        every_nth?: number;
        offset?: number;
        track_type?: "video" | "audio" | "both";
        track_index?: number;
        count_scope?: "per_track" | "across_tracks";
        name_contains?: string;
        name_regex?: string;
        min_duration_seconds?: number;
        max_duration_seconds?: number;
        start_seconds?: number;
        end_seconds?: number;
        include_disabled?: boolean;
        add_to_selection?: boolean;
      }): Promise<CommandResult> => {
        const everyNth = args.every_nth ?? 1;
        const offset = args.offset ?? 0;
        if (!isInteger(everyNth, 1, MAX_EVERY_NTH) || !isInteger(offset, 0, MAX_EVERY_NTH - 1) || offset >= everyNth) {
          return { success: false, error: `every_nth must be an integer from 1 through ${MAX_EVERY_NTH} and offset must be an integer below every_nth.` };
        }
        if (args.track_index !== undefined && !isInteger(args.track_index, 0, 255)) return { success: false, error: "track_index must be an integer from 0 through 255." };
        for (const [label, value] of [["min_duration_seconds", args.min_duration_seconds], ["max_duration_seconds", args.max_duration_seconds], ["start_seconds", args.start_seconds], ["end_seconds", args.end_seconds]] as const) {
          if (value !== undefined && (!finiteNumber(value) || value < 0 || value > 86_400)) return { success: false, error: `${label} must be a finite number from 0 through 86400.` };
        }
        if (args.min_duration_seconds !== undefined && args.max_duration_seconds !== undefined && args.max_duration_seconds < args.min_duration_seconds) {
          return { success: false, error: "max_duration_seconds must not be below min_duration_seconds." };
        }
        if (args.start_seconds !== undefined && args.end_seconds !== undefined && args.end_seconds <= args.start_seconds) {
          return { success: false, error: "end_seconds must be greater than start_seconds." };
        }
        if (args.name_regex !== undefined) {
          if (typeof args.name_regex !== "string" || args.name_regex.length > 255) return { success: false, error: "name_regex must be a string of at most 255 characters." };
          try {
            new RegExp(args.name_regex, "i");
          } catch (error) {
            return { success: false, error: `name_regex is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}` };
          }
          if (/\(\?<|\\p\{|\(\?=|\(\?!/.test(args.name_regex)) return { success: false, error: "name_regex uses lookaround or Unicode property syntax that ExtendScript's ES3 engine does not support." };
        }
        const trackType = args.track_type ?? "video";
        const scope = args.count_scope ?? "per_track";
        const script = buildToolScript(`
          var seq = __getCurrentActiveSequence();
          if (!seq) return __error("No active sequence");
          var everyNth = ${everyNth};
          var offset = ${offset};
          var perTrack = ${scope === "per_track" ? "true" : "false"};
          var nameContains = ${args.name_contains === undefined ? "null" : `"${escapeForExtendScript(args.name_contains.toLowerCase())}"`};
          var nameRegex = ${args.name_regex === undefined ? "null" : `new RegExp("${escapeForExtendScript(args.name_regex)}", "i")`};
          var minDuration = ${args.min_duration_seconds === undefined ? "null" : args.min_duration_seconds};
          var maxDuration = ${args.max_duration_seconds === undefined ? "null" : args.max_duration_seconds};
          var rangeStart = ${args.start_seconds === undefined ? "null" : args.start_seconds};
          var rangeEnd = ${args.end_seconds === undefined ? "null" : args.end_seconds};
          var includeDisabled = ${args.include_disabled === false ? "false" : "true"};
          var addToSelection = ${args.add_to_selection ? "true" : "false"};
          var trackIndexFilter = ${args.track_index === undefined ? "null" : args.track_index};

          function candidatesFrom(tracks, trackType) {
            var out = [];
            for (var t = 0; t < tracks.numTracks; t++) {
              if (trackIndexFilter !== null && t !== trackIndexFilter) continue;
              var track = tracks[t];
              var perTrackList = [];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var start = __ticksToSeconds(clip.start.ticks);
                var end = __ticksToSeconds(clip.end.ticks);
                var duration = end - start;
                if (!includeDisabled) { try { if (clip.isDisabled()) continue; } catch (disabledError) {} }
                if (nameContains !== null && String(clip.name).toLowerCase().indexOf(nameContains) === -1) continue;
                if (nameRegex !== null && !nameRegex.test(String(clip.name))) continue;
                if (minDuration !== null && duration < minDuration - 0.0001) continue;
                if (maxDuration !== null && duration > maxDuration + 0.0001) continue;
                if (rangeStart !== null && end <= rangeStart) continue;
                if (rangeEnd !== null && start >= rangeEnd) continue;
                perTrackList.push({ clip: clip, trackType: trackType, trackIndex: t, start: start, end: end, name: clip.name, nodeId: clip.nodeId });
              }
              perTrackList.sort(function(left, right) { return left.start - right.start; });
              for (var k = 0; k < perTrackList.length; k++) out.push(perTrackList[k]);
            }
            return out;
          }

          var candidates = [];
          ${trackType !== "audio" ? 'candidates = candidates.concat(candidatesFrom(seq.videoTracks, "video"));' : ""}
          ${trackType !== "video" ? 'candidates = candidates.concat(candidatesFrom(seq.audioTracks, "audio"));' : ""}
          if (!perTrack) {
            candidates.sort(function(left, right) {
              if (left.start !== right.start) return left.start - right.start;
              if (left.trackType !== right.trackType) return left.trackType === "video" ? -1 : 1;
              return left.trackIndex - right.trackIndex;
            });
          }

          if (!addToSelection) {
            var tt, cc;
            for (tt = 0; tt < seq.videoTracks.numTracks; tt++) for (cc = 0; cc < seq.videoTracks[tt].clips.numItems; cc++) seq.videoTracks[tt].clips[cc].setSelected(false, true);
            for (tt = 0; tt < seq.audioTracks.numTracks; tt++) for (cc = 0; cc < seq.audioTracks[tt].clips.numItems; cc++) seq.audioTracks[tt].clips[cc].setSelected(false, true);
          }

          var chosen = [];
          var counter = 0;
          var lastTrackKey = null;
          for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            var trackKey = candidate.trackType + ":" + candidate.trackIndex;
            if (perTrack && trackKey !== lastTrackKey) { counter = 0; lastTrackKey = trackKey; }
            var ordinal = counter++;
            if (ordinal < offset || (ordinal - offset) % everyNth !== 0) continue;
            candidate.clip.setSelected(true, true);
            chosen.push(candidate);
          }

          var verifiedSelected = 0;
          var readback = [];
          for (var v = 0; v < chosen.length; v++) {
            var isSelected = false;
            try { isSelected = chosen[v].clip.isSelected(); } catch (selectedError) {}
            if (isSelected) verifiedSelected++;
            if (readback.length < 50) readback.push({ nodeId: chosen[v].nodeId, name: chosen[v].name, trackType: chosen[v].trackType, trackIndex: chosen[v].trackIndex, startSeconds: chosen[v].start, endSeconds: chosen[v].end, selected: isSelected });
          }
          if (verifiedSelected !== chosen.length) {
            return __error("Requested " + chosen.length + " selection(s) but Premiere reports " + verifiedSelected + " selected; the selection is not reported as verified.");
          }
          return __result({
            selected: chosen.length,
            verified: true,
            candidates: candidates.length,
            everyNth: everyNth,
            offset: offset,
            countScope: perTrack ? "per_track" : "across_tracks",
            clips: readback,
            truncated: chosen.length > readback.length
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    navigate_playhead: {
      description:
        "Move the active-sequence playhead to the start, end, in/out point, work-area bound, next/previous edit or marker, or step a number of frames, then read back the resulting position. Navigation only; it never changes clips.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: [...PLAYHEAD_ACTIONS], description: "Where to move the playhead." },
          frames: { type: "integer", minimum: 1, maximum: MAX_STEP_FRAMES, description: "Frames to step for step_forward/step_backward (default 1)." },
          track_type: { type: "string", enum: ["video", "audio", "both"], description: "Tracks whose clip edges count as edit points for next_edit/previous_edit (default both)." },
          track_index: { type: "integer", minimum: 0, maximum: 255, description: "Restrict edit points to one track index." },
        },
        required: ["action"],
      },
      handler: async (args: { action: PlayheadAction; frames?: number; track_type?: "video" | "audio" | "both"; track_index?: number }): Promise<CommandResult> => {
        if (!PLAYHEAD_ACTIONS.includes(args.action)) return { success: false, error: `action must be one of: ${PLAYHEAD_ACTIONS.join(", ")}` };
        const frames = args.frames ?? 1;
        if (!isInteger(frames, 1, MAX_STEP_FRAMES)) return { success: false, error: `frames must be an integer from 1 through ${MAX_STEP_FRAMES}.` };
        if (args.track_index !== undefined && !isInteger(args.track_index, 0, 255)) return { success: false, error: "track_index must be an integer from 0 through 255." };
        const trackType = args.track_type ?? "both";
        const script = buildToolScript(`
          var seq = __getCurrentActiveSequence();
          if (!seq) return __error("No active sequence");
          var action = "${args.action}";
          var frames = ${frames};
          var trackIndexFilter = ${args.track_index === undefined ? "null" : args.track_index};
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 30;
          var currentTicks = parseFloat(seq.getPlayerPosition().ticks);
          var endTicks = parseFloat(seq.end);
          var halfFrame = frameTicks / 2;
          var target = null;
          var detail = null;

          function collectEdits() {
            var edits = [];
            function scan(tracks) {
              for (var t = 0; t < tracks.numTracks; t++) {
                if (trackIndexFilter !== null && t !== trackIndexFilter) continue;
                var track = tracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                  edits.push(parseFloat(track.clips[c].start.ticks));
                  edits.push(parseFloat(track.clips[c].end.ticks));
                }
              }
            }
            ${trackType !== "audio" ? "scan(seq.videoTracks);" : ""}
            ${trackType !== "video" ? "scan(seq.audioTracks);" : ""}
            edits.sort(function(left, right) { return left - right; });
            return edits;
          }
          function collectMarkers() {
            var times = [];
            var marker = seq.markers.getFirstMarker();
            while (marker) { times.push(parseFloat(marker.start.ticks)); marker = seq.markers.getNextMarker(marker); }
            times.sort(function(left, right) { return left - right; });
            return times;
          }
          function nextAfter(list) { for (var i = 0; i < list.length; i++) if (list[i] > currentTicks + halfFrame) return list[i]; return null; }
          function previousBefore(list) { for (var i = list.length - 1; i >= 0; i--) if (list[i] < currentTicks - halfFrame) return list[i]; return null; }

          if (action === "start") target = 0;
          else if (action === "end") target = endTicks;
          else if (action === "in_point") { target = __secondsToTicks(Number(seq.getInPoint())); }
          else if (action === "out_point") { target = __secondsToTicks(Number(seq.getOutPoint())); }
          else if (action === "work_area_in") { target = parseFloat(seq.getWorkAreaInPoint()); }
          else if (action === "work_area_out") { target = parseFloat(seq.getWorkAreaOutPoint()); }
          else if (action === "next_edit") { target = nextAfter(collectEdits()); if (target === null) detail = "No edit point after the playhead"; }
          else if (action === "previous_edit") { target = previousBefore(collectEdits()); if (target === null) detail = "No edit point before the playhead"; }
          else if (action === "next_marker") { target = nextAfter(collectMarkers()); if (target === null) detail = "No marker after the playhead"; }
          else if (action === "previous_marker") { target = previousBefore(collectMarkers()); if (target === null) detail = "No marker before the playhead"; }
          else if (action === "step_forward") target = currentTicks + frames * frameTicks;
          else if (action === "step_backward") target = currentTicks - frames * frameTicks;
          if (target === null || isNaN(target)) return __error((detail || "Premiere did not provide a target position for " + action) + "; the playhead was not moved.");
          if (target < 0) target = 0;
          if (isFinite(endTicks) && endTicks > 0 && target > endTicks) target = endTicks;
          seq.setPlayerPosition(String(Math.round(target)));
          var observed = parseFloat(seq.getPlayerPosition().ticks);
          if (Math.abs(observed - target) > frameTicks) {
            return __error("Premiere reports the playhead at " + __ticksToSeconds(observed) + "s instead of " + __ticksToSeconds(target) + "s after " + action + ".");
          }
          var fps = TICKS_PER_SECOND / frameTicks;
          return __result({
            action: action,
            verified: true,
            fromSeconds: __ticksToSeconds(currentTicks),
            toSeconds: __ticksToSeconds(observed),
            deltaFrames: Math.round((observed - currentTicks) / frameTicks),
            timecode: __ticksToTimecode(observed, Math.round(fps)),
            clamped: target === 0 || target === endTicks
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_checkpoint: {
      description:
        "Clone a sequence into a named '[checkpoint]' copy before a risky edit and return a diff_sequence_snapshots-compatible snapshot of the original. Verifies the clone exists with matching track and clip counts, re-activates the original, and never deletes or overwrites anything.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          label: { type: "string", minLength: 1, maxLength: MAX_CHECKPOINT_LABEL_LENGTH, description: "Short label for the checkpoint (default 'checkpoint')." },
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Sequence ID or name to checkpoint. Defaults to the active sequence." },
          include_snapshot: { type: "boolean", description: "Return the original sequence's structural snapshot for later diff_sequence_snapshots calls (default true)." },
        },
      },
      handler: async (args: { label?: string; sequence_id?: string; include_snapshot?: boolean }): Promise<CommandResult> => {
        const label = (args.label ?? "checkpoint").trim();
        if (!label || label.length > MAX_CHECKPOINT_LABEL_LENGTH || /[\r\n]/.test(label)) return { success: false, error: `label must be a single line of 1 through ${MAX_CHECKPOINT_LABEL_LENGTH} characters.` };
        const stamp = utcStamp();
        const includeSnapshot = args.include_snapshot !== false;
        const script = buildToolScript(`
          ${SNAPSHOT_HELPER}
          ${sequenceLookup(args.sequence_id)}
          var project = app.project;
          var originalId = String(seq.sequenceID);
          var originalName = String(seq.name);
          var activeBefore = null;
          try { if (project.activeSequence) activeBefore = String(project.activeSequence.sequenceID); } catch (activeError) {}
          var checkpointName = "${CHECKPOINT_PREFIX} " + originalName + " - ${escapeForExtendScript(label)} - ${stamp}";
          if (checkpointName.length > 255) checkpointName = checkpointName.substring(0, 255);
          var before = {};
          var i;
          for (i = 0; i < project.sequences.numSequences; i++) before[String(project.sequences[i].sequenceID)] = true;
          var snapshot = __sequenceSnapshot(seq);
          var accepted;
          try { accepted = seq.clone(); } catch (cloneError) { return __error("Premiere rejected the sequence clone: " + cloneError.toString()); }
          if (accepted === false) return __error("Premiere refused to clone sequence '" + originalName + "'. No checkpoint was created.");
          var clone = null;
          for (i = 0; i < project.sequences.numSequences; i++) {
            var candidate = project.sequences[i];
            if (!before[String(candidate.sequenceID)]) { clone = candidate; break; }
          }
          if (!clone) return __error("Premiere accepted the clone but no new sequence appeared; the checkpoint is not reported as created.");
          try { clone.name = checkpointName; } catch (renameError) {
            return __error("The clone '" + clone.name + "' exists but could not be renamed: " + renameError.toString());
          }
          var cloneSnapshot = __sequenceSnapshot(clone);
          var mismatch = null;
          if (cloneSnapshot.videoTracks.length !== snapshot.videoTracks.length || cloneSnapshot.audioTracks.length !== snapshot.audioTracks.length) mismatch = "track counts differ";
          else {
            for (i = 0; i < snapshot.videoTracks.length && !mismatch; i++) if (snapshot.videoTracks[i].clipCount !== cloneSnapshot.videoTracks[i].clipCount) mismatch = "video track " + i + " clip counts differ";
            for (i = 0; i < snapshot.audioTracks.length && !mismatch; i++) if (snapshot.audioTracks[i].clipCount !== cloneSnapshot.audioTracks[i].clipCount) mismatch = "audio track " + i + " clip counts differ";
          }
          var reactivated = null;
          if (activeBefore !== null) {
            try { project.openSequence(activeBefore); } catch (openError) {}
            try { reactivated = project.activeSequence && String(project.activeSequence.sequenceID) === activeBefore; } catch (checkError) { reactivated = null; }
          }
          return __result({
            created: true,
            verified: mismatch === null,
            structureMismatch: mismatch,
            checkpoint: { id: String(clone.sequenceID), name: String(clone.name), label: "${escapeForExtendScript(label)}", createdUtc: "${stamp}" },
            original: { id: originalId, name: originalName },
            originalReactivated: reactivated,
            snapshot: ${includeSnapshot ? "snapshot" : "null"},
            restoreRoute: "Premiere exposes no API to replace a sequence's contents. To roll back, open the checkpoint sequence, duplicate it, or copy clips from it; delete_sequence removes a checkpoint you no longer need.",
            verificationScope: "Sequence enumeration and clip-count readback only; effects, markers, and rendered frames are not compared."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_sequence_checkpoints: {
      description:
        "List '[checkpoint]' sequences created by create_sequence_checkpoint, optionally only those cloned from one sequence, with their labels, timestamps, track and clip counts. Read-only.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Only list checkpoints of this sequence (ID or name)." },
        },
      },
      handler: async (args: { sequence_id?: string }): Promise<CommandResult> => {
        const script = buildToolScript(`
          var project = app.project;
          var originalName = null;
          ${args.sequence_id ? `var filterSeq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!filterSeq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}"); originalName = String(filterSeq.name);` : ""}
          var prefix = "${CHECKPOINT_PREFIX} ";
          var checkpoints = [];
          for (var i = 0; i < project.sequences.numSequences; i++) {
            var candidate = project.sequences[i];
            var name = String(candidate.name);
            if (name.indexOf(prefix) !== 0) continue;
            var rest = name.substring(prefix.length);
            var match = rest.match(/^(.*) - (.*) - (\\d{8}-\\d{6}Z)$/);
            var source = match ? match[1] : rest;
            if (originalName !== null && source !== originalName) continue;
            var clipCount = 0;
            var t;
            for (t = 0; t < candidate.videoTracks.numTracks; t++) clipCount += candidate.videoTracks[t].clips.numItems;
            for (t = 0; t < candidate.audioTracks.numTracks; t++) clipCount += candidate.audioTracks[t].clips.numItems;
            checkpoints.push({
              id: String(candidate.sequenceID),
              name: name,
              originalName: source,
              label: match ? match[2] : null,
              createdUtc: match ? match[3] : null,
              videoTrackCount: candidate.videoTracks.numTracks,
              audioTrackCount: candidate.audioTracks.numTracks,
              clipCount: clipCount,
              durationSeconds: __ticksToSeconds(candidate.end)
            });
          }
          checkpoints.sort(function(left, right) {
            var l = left.createdUtc || ""; var r = right.createdUtc || "";
            return l < r ? 1 : l > r ? -1 : 0;
          });
          return __result({ count: checkpoints.length, filteredTo: originalName, checkpoints: checkpoints });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_sequence_edl: {
      description:
        "Generate a CMX 3600 EDL for one video or audio track of a sequence from Premiere timeline readback (cuts, reels, source/record timecode, M2 lines for retimed clips), self-validate it, and return it inline or write it inside an approved workspace. Premiere is only read; this is not a Premiere-native export.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Sequence ID or name. Defaults to the active sequence." },
          track_type: { type: "string", enum: [...EDL_TRACK_TYPES], description: "Track type to export (default video)." },
          track_index: { type: "integer", minimum: 0, maximum: 255, description: "Track index to export (default 0)." },
          frame_rate: { type: "number", enum: [...CMX_TIMECODE_RATES], description: "Override the CMX timecode rate; defaults to the sequence rate (23.976 is written as 24)." },
          drop_frame: { type: "boolean", description: "Write drop-frame timecode (29.97/59.94 only). Defaults to the sequence display format." },
          title: { type: "string", minLength: 1, maxLength: MAX_EDL_TITLE_LENGTH, description: "TITLE line (default: the sequence name)." },
          reel_mode: { type: "string", enum: [...REEL_MODES], description: "How reel names are derived: clip_name (default), tape_name (XMP tapeName when present), or numbered." },
          include_disabled: { type: "boolean", description: "Include disabled clips as events (default false)." },
          record_start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Record timecode origin in seconds (default: the sequence zero point)." },
          include_clip_name_comments: { type: "boolean", description: "Emit '* FROM CLIP NAME:' comments (default true)." },
          output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Optional absolute .edl path to write. Requires approved_workspace_path; the file must not already exist. When omitted the EDL text is returned inline." },
          approved_workspace_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute existing directory that must contain output_path. Required with output_path." },
        },
      },
      handler: async (args: {
        sequence_id?: string;
        track_type?: "video" | "audio";
        track_index?: number;
        frame_rate?: number;
        drop_frame?: boolean;
        title?: string;
        reel_mode?: "clip_name" | "tape_name" | "numbered";
        include_disabled?: boolean;
        record_start_seconds?: number;
        include_clip_name_comments?: boolean;
        output_path?: string;
        approved_workspace_path?: string;
      }): Promise<CommandResult> => {
        const trackType = args.track_type ?? "video";
        const trackIndex = args.track_index ?? 0;
        if (!EDL_TRACK_TYPES.includes(trackType)) return { success: false, error: `track_type must be one of: ${EDL_TRACK_TYPES.join(", ")}` };
        if (!isInteger(trackIndex, 0, 255)) return { success: false, error: "track_index must be an integer from 0 through 255." };
        let target: string | null = null;
        try {
          const hasOutput = args.output_path !== undefined;
          if (hasOutput && args.approved_workspace_path === undefined) throw new Error("approved_workspace_path is required when output_path is provided");
          if (!hasOutput && args.approved_workspace_path !== undefined) throw new Error("approved_workspace_path is only accepted together with output_path");
          target = hasOutput ? resolveContainedOutputPath(args.approved_workspace_path, args.output_path) : null;
          if (target && path.extname(target).toLowerCase() !== ".edl") throw new Error("output_path must use the .edl extension");
        } catch (error) {
          return { success: false, error: `${error instanceof Error ? error.message : String(error)}. Premiere was not contacted.` };
        }
        const wantsTape = args.reel_mode === "tape_name";
        const script = buildToolScript(`
          ${sequenceLookup(args.sequence_id)}
          var tracks = ${trackType === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          var trackIndex = ${trackIndex};
          if (!tracks[trackIndex]) return __error("${trackType} track index " + trackIndex + " does not exist in sequence '" + seq.name + "'");
          var track = tracks[trackIndex];
          var frameTicks = parseFloat(seq.timebase);
          var frameRate = frameTicks > 0 ? TICKS_PER_SECOND / frameTicks : null;
          var zeroPoint = 0;
          try { zeroPoint = __ticksToSeconds(seq.zeroPoint); } catch (zeroError) {}
          var dropFrame = false;
          try {
            var displayFormat = Number(seq.videoDisplayFormat);
            dropFrame = displayFormat === 102 || displayFormat === 106;
          } catch (formatError) {}
          var clips = [];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var info = {
              nodeId: clip.nodeId,
              name: clip.name,
              startSeconds: __ticksToSeconds(clip.start.ticks),
              endSeconds: __ticksToSeconds(clip.end.ticks),
              inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
              outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
              enabled: true,
              speed: 100
            };
            try { info.enabled = !clip.isDisabled(); } catch (disabledError) {}
            try { info.speed = Number(clip.getSpeed()) * 100; } catch (speedError) {}
            try {
              var item = clip.projectItem;
              if (item) {
                info.projectItemName = item.name;
                try { var mediaStart = item.startTime(); if (mediaStart && mediaStart.ticks !== undefined) info.mediaStartSeconds = __ticksToSeconds(mediaStart.ticks); } catch (startError) {}
                ${wantsTape ? `try {
                  var xmp = String(item.getXMPMetadata() || "");
                  var tape = xmp.match(/<xmpDM:tapeName>([^<]{1,64})<\\/xmpDM:tapeName>/) || xmp.match(/xmpDM:tapeName="([^"]{1,64})"/);
                  if (tape) info.tapeName = tape[1];
                } catch (xmpError) {}` : ""}
              }
            } catch (itemError) {}
            clips.push(info);
          }
          return __result({
            name: seq.name,
            id: String(seq.sequenceID),
            frameRate: frameRate,
            zeroPointSeconds: zeroPoint,
            dropFrame: dropFrame,
            tracks: [{ type: "${trackType}", index: trackIndex, name: track.name, clips: clips }]
          });
        `);
        const readback = await sendCommand(script, bridgeOptions);
        if (!readback.success) return readback;
        try {
          const exported = buildCmx3600Edl(readback.data, {
            track_type: trackType,
            track_index: trackIndex,
            frame_rate: args.frame_rate,
            drop_frame: args.drop_frame,
            title: args.title,
            reel_mode: args.reel_mode,
            include_disabled: args.include_disabled,
            record_start_seconds: args.record_start_seconds,
            include_clip_name_comments: args.include_clip_name_comments,
          });
          const bytes = Buffer.byteLength(exported.edl, "utf8");
          const { edl, ...summary } = exported;
          if (target) {
            writeFileSync(target, edl, { encoding: "utf8", flag: "wx" });
            return {
              success: true,
              data: {
                ...summary,
                written: true,
                output_path: target,
                bytes,
                sha256: createHash("sha256").update(edl).digest("hex"),
                verificationScope: "Timeline readback plus local CMX 3600 self-validation; not a Premiere-native export and not proof that a conform target accepts the list.",
                routes: ["inspect_cmx3600_edl", "validate_cmx3600_edl", "compare_cmx3600_edls"],
              },
            };
          }
          if (bytes > MAX_INLINE_ARTIFACT_BYTES) {
            return { success: false, error: `The EDL is ${bytes} bytes, above the ${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit; pass output_path and approved_workspace_path to write it to a file.` };
          }
          return {
            success: true,
            data: {
              ...summary,
              written: false,
              bytes,
              edl,
              verificationScope: "Timeline readback plus local CMX 3600 self-validation; not a Premiere-native export and not proof that a conform target accepts the list.",
              routes: ["inspect_cmx3600_edl", "validate_cmx3600_edl", "compare_cmx3600_edls"],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
