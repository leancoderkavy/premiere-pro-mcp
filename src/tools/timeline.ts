import { probeMediaDurationTicks } from "./media-evidence.js";
import { rippleDeleteScriptBody } from "./ripple-delete-script.js";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

/**
 * Clip speed is deliberately unavailable (#295, #299, #593). Premiere's documented
 * ExtendScript and UXP (through 26.3) APIs expose only speed getters
 * (getSpeed / isSpeedReversed), and the reflected QE setSpeed is not used.
 * Every speed surface shares this wording so clients get one consistent answer.
 */
export const SPEED_UNAVAILABLE_DESCRIPTION =
  "Unavailable: Premiere's documented ExtendScript and UXP APIs have no setter for a timeline clip's speed (only getters), and the undocumented QE setSpeed is deliberately not used. Always fails before mutation. To change how long a clip runs on the timeline, use set_clip_duration.";

export const SPEED_UNAVAILABLE_ERROR =
  "Changing a timeline clip's speed is not exposed by Premiere's documented ExtendScript or UXP APIs, and the undocumented QE setSpeed is deliberately not used. No mutation was attempted. To change how long the clip runs on the timeline, use set_clip_duration; to retime footage, use Premiere's Speed/Duration dialog or pre-render retimed media before import.";

/** Upper bound for set_clip_duration targets (24 hours), to reject runaway input. */
const MAX_CLIP_DURATION_SECONDS = 86400;

/**
 * ES3 helpers shared by trim_clip and set_clip_duration. They read clip-relative
 * effect keyframe times and flag any that would sit beyond a visible duration.
 * The generated code expects a `tolerance` (seconds) variable in scope.
 */
const KEYFRAME_SCAN_HELPERS = `
          function __trimSeconds(timeValue) {
            try { return __ticksToSeconds(timeValue.ticks); } catch(e) { return NaN; }
          }

          // ComponentParam keyframe times are relative to the clip start in
          // this CEP interface. A bounded scan lets the default reject a trim
          // before it creates keyframes that remain beyond the visible range.
          function __findOutOfRangeKeyframes(item, visibleDuration) {
            var scan = { outside: [], errors: [], inspected: 0 };
            var limit = 10000;
            try {
              for (var ci = 0; ci < item.components.numItems; ci++) {
                var component = item.components[ci];
                for (var pi = 0; pi < component.properties.numItems; pi++) {
                  var property = component.properties[pi];
                  var isTimeVarying = false;
                  try { isTimeVarying = property.isTimeVarying(); } catch(varyingError) {
                    scan.errors.push("component " + ci + " property " + pi + " time-varying state: " + varyingError.toString());
                    continue;
                  }
                  if (!isTimeVarying) continue;
                  var keys;
                  try { keys = property.getKeys(); } catch(keyError) {
                    scan.errors.push("component " + ci + " property " + pi + " keys: " + keyError.toString());
                    continue;
                  }
                  if (!keys) continue;
                  for (var ki = 0; ki < keys.length; ki++) {
                    scan.inspected++;
                    if (scan.inspected > limit) {
                      scan.errors.push("more than " + limit + " keyframes; refusing an unbounded inspection");
                      return scan;
                    }
                    var keySeconds = __trimSeconds(keys[ki]);
                    if (!isFinite(keySeconds)) {
                      scan.errors.push("component " + ci + " property " + pi + " key " + ki + " has no readable time");
                      continue;
                    }
                    if (keySeconds > visibleDuration + tolerance) {
                      scan.outside.push({ component: ci, property: pi, seconds: keySeconds });
                    }
                  }
                }
              }
            } catch(scanError) {
              scan.errors.push(scanError.toString());
            }
            return scan;
          }
`;

export function getTimelineTools(
  bridgeOptions: BridgeOptions,
  dependencies: { probeMediaDurationSeconds?: (path: string) => Promise<number | null>; probeMediaDurationTicks?: (path: string) => Promise<number | null> } = {},
) {
  // SEC FORK (#712): injectable for tests; defaults to real ffprobe evidence.
  const probeMediaEndTicks = dependencies.probeMediaDurationTicks ?? (dependencies.probeMediaDurationSeconds
    ? async (path: string) => {
      const seconds = await dependencies.probeMediaDurationSeconds!(path);
      return seconds === null ? null : Math.floor(seconds * 254016000000);
    }
    : probeMediaDurationTicks);
  return {
    add_to_timeline: {
      description:
        "Insert a project item at a timeline position. Experimental: if a target clip spans that point, QE razors it before insertion to attempt to preserve its tail; both target and sync-locked track changes are read back. A host may still displace a tail, in which case the edit is reported as committed_unverified. Pass scope 'target_tracks' to ripple only the named pair (this will desync other tracks).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to add",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline (default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index for the audio portion (default: 0)",
          },
          scope: {
            type: "string",
            enum: ["sync_locked", "target_tracks"],
            description:
              "Which tracks shift: 'sync_locked' (default) matches Premiere's insert; 'target_tracks' ripples only the named pair and WILL desync other tracks.",
          },
      },
      required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        track_index?: number;
        start_seconds?: number;
        audio_track_index?: number;
        scope?: "sync_locked" | "target_tracks";
      }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;
        const scope = args.scope === "target_tracks" ? "target_tracks" : "sync_locked";
        if (!Number.isInteger(trackIndex) || trackIndex < 0 ||
            !Number.isInteger(audioTrackIndex) || audioTrackIndex < 0 ||
            !Number.isFinite(startSeconds) || startSeconds < 0) {
          return {
            success: false,
            error: "track_index and audio_track_index must be non-negative integers, and start_seconds must be a finite non-negative number.",
          };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var outcome = __insertClipHonoringSyncLock(seq, item, startTicks, ${trackIndex}, ${audioTrackIndex}, "${scope}");
          if (!outcome.ok) return __error(outcome.error, outcome.changed ? { timelineChanged: true, outcome: "committed_unverified", verified: false, displacedTails: outcome.displacedTails, placedOn: outcome.placedOn } : null);
          var payload = {
            added: true,
            verified: outcome.data.verified,
            syncLockHonored: outcome.data.syncLockHonored,
            item: outcome.data.item,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            insertedTrackItems: outcome.data.insertedTrackItems
          };
          if (outcome.data.warning) payload.warning = outcome.data.warning;
          return __result(payload);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_from_timeline: {
      description:
        "Remove a clip from the timeline. By default its linked audio/video partners go with it, as with Premiere's Clear on a linked clip. With ripple: true the gap is closed through the same explicit, verified ripple delete as ripple_delete (Premiere's own ripple flag does nothing on current builds), shifting sync-locked tracks so audio stays in sync.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to remove",
          },
          ripple: {
            type: "boolean",
            description: "Whether to ripple delete (close the gap). Default: false",
          },
          include_linked: {
            type: "boolean",
            description:
              "Also remove the clip's linked audio/video partners (default: true). A ripple removal always includes them, since closing the gap on one side only would desync the timeline.",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; ripple?: boolean; include_linked?: boolean }) => {
        const nodeId = escapeForExtendScript(args.node_id);
        if (args.ripple === true) {
          if (args.include_linked === false) {
            return {
              success: false,
              error: "A ripple removal always includes linked partners; use ripple_delete with scope 'own_track' to close the gap on one track only (this desyncs other tracks).",
            };
          }
          return sendCommand(
            buildToolScript(rippleDeleteScriptBody({ nodeId, scope: "sync_locked", rangeDelete: false, dryRun: false })),
            bridgeOptions,
          );
        }
        const script = buildToolScript(`
          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");
          var outcome = __removeClipAndPartners(result, ${args.include_linked !== false});
          if (!outcome.ok) return __error(outcome.error);
          outcome.data.verified = true;
          return __result(outcome.data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_clip: {
      description: "Move a clip to a new position on the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to move",
          },
          new_start_seconds: {
            type: "number",
            description: "New start time in seconds",
          },
          new_track_index: {
            type: "number",
            description: "Optional new track index to move the clip to",
          },
        },
        required: ["node_id", "new_start_seconds"],
      },
      handler: async (args: { node_id: string; new_start_seconds: number; new_track_index?: number }) => {
        const nodeId = escapeForExtendScript(args.node_id);
        const script = buildToolScript(`
          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");

          var clip = result.clip;
          var clipName = clip.name;

          // Premiere snaps clip positions to frame boundaries, so verification
          // allows one frame of drift. seq.timebase is ticks-per-frame; fall
          // back to 24fps if it cannot be read so we never compare against NaN.
          var seq = app.project.activeSequence;
          var frameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var tolerance = __ticksToSeconds(frameTicks);

          // Capture the visible span and source range as tick strings before any
          // write. Premiere can mutate the same Time instance on write, so never
          // keep the object references. A move must preserve both the duration
          // and the source in/out points; anything else is a trim or a stretch.
          var originalStartTicks = String(clip.start.ticks);
          var originalEndTicks = String(clip.end.ticks);
          var originalInPointTicks = String(clip.inPoint.ticks);
          var originalOutPointTicks = String(clip.outPoint.ticks);
          var spanTicks = parseFloat(originalEndTicks) - parseFloat(originalStartTicks);
          if (!(spanTicks > 0)) return __error("Clip has an empty or inverted timeline range; move was not attempted.");

          ${args.new_track_index !== undefined ? `
          // The track change is attempted before the start time is written, so
          // a failure here leaves the clip completely untouched rather than
          // repositioned-but-not-moved.
          var targetTracks = result.trackType === "video" ? seq.videoTracks : seq.audioTracks;
          if (${args.new_track_index} >= targetTracks.numTracks) {
            return __error("Track index ${args.new_track_index} is out of range: the sequence has " + targetTracks.numTracks + " " + result.trackType + " track(s).");
          }

          // TrackItem has no DOM moveToTrack; only the QE clip exposes one.
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE); cannot change track.");
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found; cannot change track.");

          // QE item indices count gaps ("Empty" items) alongside clips, so the
          // DOM clip index does not map onto getItemAt. Match on start time.
          var qeClip = null;
          var wantStart = parseFloat(clip.start.ticks);
          for (var qi = 0; qi < qeTrack.numItems; qi++) {
            var cand = qeTrack.getItemAt(qi);
            if (!cand || String(cand.type) !== "Clip") continue;
            if (Math.abs(parseFloat(cand.start.ticks) - wantStart) < 1) { qeClip = cand; break; }
          }
          if (!qeClip) return __error("Could not locate the clip among the QE track's items; cannot change track.");

          // QE moveToTrack takes track *deltas*, not an absolute index.
          var videoDelta = result.trackType === "video" ? (${args.new_track_index} - result.trackIndex) : 0;
          var audioDelta = result.trackType === "audio" ? (${args.new_track_index} - result.trackIndex) : 0;
          try {
            qeClip.moveToTrack(videoDelta, audioDelta, "0", false);
          } catch (moveErr) {
            return __error("Could not move the clip to track ${args.new_track_index}: the QE moveToTrack API rejected the call (" + moveErr.toString() + "). This is a known QE limitation on Premiere Pro 26.x (confirmed on 26.2.2). The clip was left untouched — call move_clip without new_track_index to reposition it in time.");
          }
          var afterMove = __findClip("${nodeId}");
          if (!afterMove) return __error("Clip ${nodeId} could not be found after the track move; the timeline may be in an unexpected state.");
          if (afterMove.trackIndex !== ${args.new_track_index}) {
            return __error("Premiere did not move the clip to track ${args.new_track_index}; it is still on track " + afterMove.trackIndex + ", so the start time was not written. Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }
          // moveToTrack can rewrite end independently of start (#550). Re-assert
          // the original span before verifying, then fail closed if it did not hold.
          if (String(afterMove.clip.start.ticks) !== originalStartTicks || String(afterMove.clip.end.ticks) !== originalEndTicks) {
            try {
              __writeClipSpan(afterMove.clip, originalStartTicks, originalEndTicks);
            } catch (spanErr) {
              return __error("Premiere changed the clip's timeline range during the track move and it could not be restored (" + spanErr.toString() + "). Use Undo and retry in the Premiere UI.");
            }
            afterMove = __findClip("${nodeId}");
            if (!afterMove) return __error("Clip ${nodeId} could not be found after restoring its timeline range; the timeline may be in an unexpected state.");
          }
          var afterMoveStartTicks = String(afterMove.clip.start.ticks);
          var afterMoveEndTicks = String(afterMove.clip.end.ticks);
          if (parseFloat(afterMoveStartTicks) >= parseFloat(afterMoveEndTicks)) {
            return __error("Premiere left clip ${nodeId} with an inverted or empty timeline range after the track move. Use Undo and retry in the Premiere UI.");
          }
          if (Math.abs((parseFloat(afterMoveEndTicks) - parseFloat(afterMoveStartTicks)) - spanTicks) > 1) {
            return __error("Premiere changed the clip duration during the track move. Use Undo and retry in the Premiere UI.");
          }
          clip = afterMove.clip;
          ` : ""}

          // Writing start alone leaves end in place on Premiere Pro 26.x, which
          // stretches (earlier move) or trims (later move) the clip instead of
          // moving it. Write both edges in the order that keeps start < end.
          var newStartTicks = __secondsToTicks(${args.new_start_seconds});
          var newEndTicks = newStartTicks + spanTicks;
          try {
            __writeClipSpan(clip, newStartTicks, newEndTicks);
          } catch (moveWriteErr) {
            return __error("Premiere rejected the timeline move (" + moveWriteErr.toString() + "). Inspect the clip; if only one edge moved, use Undo to restore it.");
          }

          // Re-find the clip rather than trusting the original reference, which
          // can go stale once the clip changes track.
          var after = __findClip("${nodeId}");
          if (!after) return __error("Clip ${nodeId} could not be found after the move; the timeline may be in an unexpected state.");

          var actualStart = __ticksToSeconds(after.clip.start.ticks);
          var actualEnd = __ticksToSeconds(after.clip.end.ticks);
          var moveDrift = [];
          if (Math.abs(actualStart - ${args.new_start_seconds}) > tolerance) {
            moveDrift.push("requested start ${args.new_start_seconds}s, read back " + actualStart + "s");
          }
          if (Math.abs((actualEnd - actualStart) - __ticksToSeconds(spanTicks)) > tolerance) {
            moveDrift.push("visible duration changed from " + __ticksToSeconds(spanTicks) + "s to " + (actualEnd - actualStart) + "s");
          }
          if (String(after.clip.inPoint.ticks) !== originalInPointTicks || String(after.clip.outPoint.ticks) !== originalOutPointTicks) {
            moveDrift.push("source in/out points changed, so the clip was trimmed or slipped rather than moved");
          }
          if (moveDrift.length) {
            ${args.new_track_index === undefined ? `
            // Best-effort rollback: the original range on this track was vacated
            // by this very clip, so writing it back cannot land on a neighbour.
            var rolledBack = false;
            try {
              __writeClipSpan(after.clip, originalStartTicks, originalEndTicks);
              var restored = __findClip("${nodeId}");
              rolledBack = !!restored &&
                String(restored.clip.start.ticks) === originalStartTicks && String(restored.clip.end.ticks) === originalEndTicks &&
                String(restored.clip.inPoint.ticks) === originalInPointTicks && String(restored.clip.outPoint.ticks) === originalOutPointTicks;
            } catch (rollbackErr) {}
            return __error("Premiere did not apply a verified move: " + moveDrift.join("; ") + ". " + (rolledBack ? "The clip was restored to its original timeline range." : "The clip may be in an inconsistent state; use Undo to restore it.") + " Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
            ` : `
            return __error("Premiere did not apply a verified move: " + moveDrift.join("; ") + ". The clip changed track, so its original range is not rewritten automatically; use Undo to restore it. Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
            `}
          }
          ${args.new_track_index !== undefined ? `
          if (after.trackIndex !== ${args.new_track_index}) {
            return __error("Premiere did not move the clip to track ${args.new_track_index}; it is still on track " + after.trackIndex + ". Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }
          ` : ""}

          return __result({
            moved: true,
            verified: true,
            clipName: clipName,
            newStart: actualStart,
            newEnd: actualEnd,
            durationSeconds: actualEnd - actualStart,
            trackIndex: after.trackIndex
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    trim_clip: {
      description:
        "Trim exactly one source in/out point and verify the corresponding visible timeline edge. Requires accessible physical media duration from ffprobe; unknown duration or linked partners using different source files refuse before mutation. Refuses retimed clips, extensions that would overlap the neighbouring clip on the same track, and, by default, trims that would leave effect keyframes outside the visible clip. Linked audio/video partners get the same trim by default (include_linked), applied as the same offset from each partner's own source point so a J/L cut or slipped audio stays in sync; every clip is checked before any is changed. To set a clip's timeline length or extend a still image, use set_clip_duration.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to trim",
          },
          new_in_seconds: {
            type: "number",
            minimum: 0,
            description:
              "New source in-point in seconds (relative to the clip's source media). Specify exactly one edit point.",
          },
          new_out_seconds: {
            type: "number",
            minimum: 0,
            description:
              "New source out-point in seconds (relative to the clip's source media). Specify exactly one edit point.",
          },
          keyframe_policy: {
            type: "string",
            enum: ["reject", "preserve"],
            description:
              "How to handle effect keyframes beyond the trimmed visible range: reject (default) leaves the timeline unchanged; preserve explicitly keeps them and reports their count.",
          },
          include_linked: {
            type: "boolean",
            description: "Also apply the edit to the clip's linked audio/video partners, as Premiere does with linked selection (default: true).",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        new_in_seconds?: number;
        new_out_seconds?: number;
        keyframe_policy?: "reject" | "preserve";
        include_linked?: boolean;
      }) => {
        // The schema permits both optional edit points. Applying both requires
        // two CEP writes and can leave a partially altered timeline when the
        // second write silently fails, so this tool intentionally supports one
        // verified edge per request.
        if ((args.new_in_seconds === undefined) === (args.new_out_seconds === undefined)) {
          return {
            success: false,
            error:
              "trim_clip requires exactly one of new_in_seconds or new_out_seconds so its visible timeline edge can be verified without a partial multi-write.",
          };
        }

        const requestedSeconds = args.new_in_seconds ?? args.new_out_seconds;
        if (requestedSeconds === undefined || !Number.isFinite(requestedSeconds) || requestedSeconds < 0) {
          return {
            success: false,
            error: "trim_clip edit points must be finite, non-negative seconds.",
          };
        }

        const keyframePolicy = args.keyframe_policy ?? "reject";
        if (keyframePolicy !== "reject" && keyframePolicy !== "preserve") {
          return {
            success: false,
            error: "keyframe_policy must be reject or preserve.",
          };
        }

        // SEC FORK (#712 review): the media-duration bound uses REAL evidence —
        // ffprobe on the clip's media file — not ProjectItem.getOutPoint(),
        // which is an editable source Out mark. Two phases: read the media
        // path, probe duration Node-side, then embed an exact bound. No
        // missing duration evidence refuses before any mutation.
        const evidenceScript = buildToolScript(`
          var projectId; var sequenceId;
          try { projectId = app.project.documentID; sequenceId = app.project.activeSequence.sequenceID; } catch (contextError) {}
          if (typeof projectId !== "string" || !projectId.length || typeof sequenceId !== "string" || !sequenceId.length) return __error("Project and sequence identities could not be read; no edit was attempted.");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var mp = "";
          try { mp = String(result.clip.projectItem.getMediaPath() || ""); } catch (eMediaPath) {}
          return __result({ mediaPath: mp, projectId: projectId, sequenceId: sequenceId });
        `);
        let mediaDurationTicks: number | null = null;
        let mediaPath = "";
        let projectId = "";
        let sequenceId = "";
        try {
          const evidence = await sendCommand(evidenceScript, bridgeOptions);
          if (evidence && evidence.success === false) return evidence;
          const evidenceData = (evidence as { data?: { mediaPath?: unknown; projectId?: unknown; sequenceId?: unknown } } | undefined)?.data;
          mediaPath = typeof evidenceData?.mediaPath === "string" ? evidenceData.mediaPath : "";
          projectId = typeof evidenceData?.projectId === "string" ? evidenceData.projectId : "";
          sequenceId = typeof evidenceData?.sequenceId === "string" ? evidenceData.sequenceId : "";
          if (!projectId || !sequenceId) return { success: false, error: "Project and sequence identities could not be read; no edit was attempted." };
          mediaDurationTicks = mediaPath ? await probeMediaEndTicks(mediaPath) : null;
        } catch {
          mediaDurationTicks = null;
        }
        if (mediaDurationTicks === null || !Number.isSafeInteger(mediaDurationTicks) || mediaDurationTicks <= 0) {
          return { success: false, error: "Physical media duration could not be verified in the exact tick range. No edit was attempted. ffprobe must be available and source media must expose readable integer timestamp clocks; editable project In/Out marks are not media boundaries." };
        }
        const mediaDurationSeconds = mediaDurationTicks / 254016000000;
        // SEC FORK (#712): the whole bound line is resolved Node-side (numbers
        // embedded) so the generated script never references Node variables.
        const trimMediaBound = `
            if (__secondsToTicks(targetOut) > ${mediaDurationTicks}) {
              return __editFail("The requested source out point " + targetOut + "s exceeds this clip's real media duration of ${mediaDurationSeconds.toFixed(3)}s (ffprobe); trim was not attempted. Premiere would otherwise extend the clip past its available media.");
            }`;

        const script = buildToolScript(`
          var currentProjectId; var currentSequenceId;
          try { currentProjectId = app.project.documentID; currentSequenceId = app.project.activeSequence.sequenceID; } catch (contextError) {}
          if (currentProjectId !== "${escapeForExtendScript(projectId)}" || currentSequenceId !== "${escapeForExtendScript(sequenceId)}") return __error("Project or active sequence changed after media preflight; no edit was attempted.");
          function __editOne(result, nodeId, checkOnly) {
            var currentMediaPath = "";
            try { currentMediaPath = String(result.clip.projectItem.getMediaPath() || ""); } catch (eBoundPath) {}
            if (currentMediaPath !== "${escapeForExtendScript(mediaPath)}") return __editFail("This clip or linked partner uses media without the preflight duration evidence; no edit was attempted.");


            var clip = result.clip;

            // Premiere snaps in/out points to frame boundaries, so verification
            // allows one frame of drift from the requested value. seq.timebase is
            // ticks-per-frame; fall back to 24fps if it cannot be read so we never
            // compare against NaN.
            var seq = app.project.activeSequence;
            var frameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
            if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
            var tolerance = __ticksToSeconds(frameTicks);

  ${KEYFRAME_SCAN_HELPERS}
            function __snapshotTrimGeometry(item) {
              return {
                inPoint: __trimSeconds(item.inPoint),
                outPoint: __trimSeconds(item.outPoint),
                start: __trimSeconds(item.start),
                end: __trimSeconds(item.end),
                duration: __trimSeconds(item.duration)
              };
            }

            var before = __snapshotTrimGeometry(clip);
            if (!isFinite(before.inPoint) || !isFinite(before.outPoint) || !isFinite(before.start) || !isFinite(before.end) || !isFinite(before.duration)) {
              return __editFail("Premiere did not provide readable source and timeline times for this clip; trim was not attempted.");
            }
            if (before.outPoint - before.inPoint < tolerance || before.end - before.start < tolerance) {
              return __editFail("Clip has an empty or unreadable duration; trim was not attempted.");
            }

            // A source-point trim can only have an exact CEP postcondition when
            // the source and visible durations agree. Retimed/reversed clips need
            // host-specific semantics, so refusing them is safer than guessing.
            var durationMismatch = Math.abs((before.end - before.start) - (before.outPoint - before.inPoint));
            if (durationMismatch > tolerance) {
              // Check if this looks like a partial write (source metadata changed but timeline didn't)
              // by seeing if the clip appears to be at 100% speed but has mismatched durations.
              // A truly retimed clip would show consistent metadata; a corrupted one won't.
              try {
                var playbackSpeed = clip.getSpeed ? clip.getSpeed() : null;
                // If speed is exactly 100 or unreadable, this is likely a partial-write corruption, not a retime.
                // getSpeed() reports 1 for normal speed on Premiere 25.2 and 100 on older builds.
                if (playbackSpeed === null || Math.abs(playbackSpeed - 1) < 0.0001 || Math.abs(playbackSpeed - 100) < 0.01) {
                  return __editFail("Clip has inconsistent source/timeline durations (source: " + (before.outPoint - before.inPoint).toFixed(3) + "s, timeline: " + (before.end - before.start).toFixed(3) + "s) at 100% speed. This can happen after a partial trim write. Undo the previous edit or use the host UI to restore consistency before retrying trim_clip.");
                }
              } catch(speedError) {
                // clip.getSpeed() might not be available on all Premiere versions; fall through to generic check
              }
              return __editFail("trim_clip does not support retimed or otherwise non-1x clips because CEP cannot prove the requested source trim maps to the correct timeline edge. Use a host-verified workflow instead.");
            }

            // The requested point applies to the clip itself; linked partners get
            // the same change as a delta from their own source point, so a J/L cut
            // or slipped audio keeps its offset instead of jumping to the value.
            var requestedIn = ${args.new_in_seconds !== undefined ? "(parseFloat(clip.inPoint.ticks) + __trimDeltaTicks) / TICKS_PER_SECOND" : "null"};
            var requestedOut = ${args.new_out_seconds !== undefined ? "(parseFloat(clip.outPoint.ticks) + __trimDeltaTicks) / TICKS_PER_SECOND" : "null"};
            var targetIn = requestedIn === null ? before.inPoint : requestedIn;
            var targetOut = requestedOut === null ? before.outPoint : requestedOut;
            if (!isFinite(targetIn) || !isFinite(targetOut)) {
              return __editFail("The requested source trim could not be computed for this clip; trim was not attempted.");
            }
            if (targetIn < 0) {
              return __editFail("The trim would move this clip's source in point to " + targetIn + "s, before the start of its media; trim was not attempted.");
            }
            // SEC FORK (#712): upper bound from REAL media duration (ffprobe,
            // probed Node-side and embedded exactly), never from the editable
            // source Out mark. Unknown evidence already refused before mutation.${trimMediaBound}
            if (targetOut - targetIn < tolerance) {
              return __editFail("The requested source trim must leave at least one frame between in and out; trim was not attempted.");
            }

            var prospectiveDuration = targetOut - targetIn;
            var beforeKeyframes = __findOutOfRangeKeyframes(clip, prospectiveDuration);
            if (beforeKeyframes.errors.length && "${keyframePolicy}" === "reject") {
              return __editFail("Could not inspect every time-varying effect property before trim (" + beforeKeyframes.errors.join("; ") + "); trim was not attempted so keyframe behavior is not guessed.");
            }
            if (beforeKeyframes.outside.length && "${keyframePolicy}" === "reject") {
              return __editFail("Refusing trim before mutation: " + beforeKeyframes.outside.length + " effect keyframe(s) would remain outside the visible clip. Use keyframe_policy: preserve only if retaining those keyframes is intentional, or adjust them explicitly with the keyframe tools.");
            }

            // Moving an edge outwards must not run into a neighbour on the same
            // track (Premiere's start/end setters would overlap or overwrite it).
            var trimStartTicks = parseFloat(clip.start.ticks);
            var trimEndTicks = parseFloat(clip.end.ticks);
            var newStartTicks = trimStartTicks + ${args.new_in_seconds !== undefined ? "(__secondsToTicks(targetIn) - parseFloat(clip.inPoint.ticks))" : "0"};
            var newEndTicks = trimEndTicks + ${args.new_out_seconds !== undefined ? "(__secondsToTicks(targetOut) - parseFloat(clip.outPoint.ticks))" : "0"};
            if (newStartTicks < -1) return __editFail("The requested in point would move the clip start before the beginning of the sequence; trim was not attempted.");
            var trimSequence = app.project.activeSequence;
            var trimTrack = trimSequence ? (result.trackType === "video" ? trimSequence.videoTracks : trimSequence.audioTracks)[result.trackIndex] : null;
            for (var ni = 0; trimTrack && ni < trimTrack.clips.numItems; ni++) {
              var neighbour = trimTrack.clips[ni];
              if (String(neighbour.nodeId) === String(clip.nodeId)) continue;
              var neighbourStart = parseFloat(neighbour.start.ticks);
              var neighbourEnd = parseFloat(neighbour.end.ticks);
              if (neighbourEnd <= trimStartTicks + 1 && newStartTicks < neighbourEnd - 1) {
                return __editFail("Refusing to extend the head: the new start (" + __ticksToSeconds(newStartTicks) + "s) would overlap the previous clip '" + neighbour.name + "' on " + result.trackType + " track " + (result.trackIndex + 1) + ", which ends at " + __ticksToSeconds(neighbourEnd) + "s. Trim was not attempted.");
              }
              if (neighbourStart >= trimEndTicks - 1 && newEndTicks > neighbourStart + 1) {
                return __editFail("Refusing to extend the tail: the new end (" + __ticksToSeconds(newEndTicks) + "s) would overlap the next clip '" + neighbour.name + "' on " + result.trackType + " track " + (result.trackIndex + 1) + ", which starts at " + __ticksToSeconds(neighbourStart) + "s. Trim was not attempted.");
              }
            }
            if (checkOnly) return __editOk({ checked: true });

            // Capture original ticks as strings. Do not keep the Time object
            // references — Premiere can mutate the same instance on write.
            var originalInPointTicks = String(clip.inPoint.ticks);
            var originalOutPointTicks = String(clip.outPoint.ticks);
            var originalStartTicks = String(clip.start.ticks);
            var originalEndTicks = String(clip.end.ticks);

            // Write the visible edge together with its source point, as roll_edit
            // does. On Premiere 25.2 a source-point write alone leaves the
            // timeline edge where it was (the head trim never moved the clip).
            ${args.new_in_seconds !== undefined ? `
            var trimInTicks = parseFloat(originalInPointTicks) + __trimDeltaTicks;
            var trimStart = new Time();
            trimStart.ticks = String(Math.round(parseFloat(originalStartTicks) + (trimInTicks - parseFloat(originalInPointTicks))));
            clip.start = trimStart;
            clip.inPoint = String(Math.round(trimInTicks));` : `
            var trimOutTicks = parseFloat(originalOutPointTicks) + __trimDeltaTicks;
            var trimEnd = new Time();
            trimEnd.ticks = String(Math.round(parseFloat(originalEndTicks) + (trimOutTicks - parseFloat(originalOutPointTicks))));
            clip.end = trimEnd;
            clip.outPoint = String(Math.round(trimOutTicks));`}

            // Re-find the TrackItem after the write. Premiere can replace stale
            // DOM references during an edit, especially for audio clips.
            var afterResult = __findClip(nodeId);
            if (!afterResult) return __editFail("Clip could not be found after the trim attempt; the timeline may have changed and the result is not verified.");
            if (afterResult.trackType !== result.trackType || afterResult.trackIndex !== result.trackIndex) {
              return __editFail("Clip moved tracks during the trim attempt; the result is not verified.");
            }
            var after = __snapshotTrimGeometry(afterResult.clip);
            if (!isFinite(after.inPoint) || !isFinite(after.outPoint) || !isFinite(after.start) || !isFinite(after.end) || !isFinite(after.duration)) {
              return __editFail("Premiere did not provide readable source and timeline times after trim; the result is not verified.");
            }

            var actualIn = after.inPoint;
            var actualOut = after.outPoint;

            var drift = [];
            ${args.new_in_seconds !== undefined ? `
            if (Math.abs(actualIn - requestedIn) > tolerance) {
              drift.push("inPoint requested " + requestedIn + "s, read back " + actualIn + "s");
            }` : ""}
            ${args.new_out_seconds !== undefined ? `
            if (Math.abs(actualOut - requestedOut) > tolerance) {
              drift.push("outPoint requested " + requestedOut + "s, read back " + actualOut + "s");
            }` : ""}

            var expectedStart = ${args.new_in_seconds !== undefined
              ? "before.start + (actualIn - before.inPoint)"
              : "before.start"};
            var expectedEnd = ${args.new_in_seconds !== undefined
              ? "before.end"
              : "before.end + (actualOut - before.outPoint)"};
            if (Math.abs(after.start - expectedStart) > tolerance) {
              drift.push("timeline start expected " + expectedStart + "s, read back " + after.start + "s");
            }
            if (Math.abs(after.end - expectedEnd) > tolerance) {
              drift.push("timeline end expected " + expectedEnd + "s, read back " + after.end + "s");
            }
            if (Math.abs(after.duration - (after.end - after.start)) > tolerance) {
              drift.push("timeline duration " + after.duration + "s does not match visible span " + (after.end - after.start) + "s");
            }
            if (Math.abs((after.end - after.start) - (actualOut - actualIn)) > tolerance) {
              drift.push("visible timeline duration does not match the applied source range");
            }

            var afterInTicks = String(afterResult.clip.inPoint.ticks);
            var afterOutTicks = String(afterResult.clip.outPoint.ticks);
            var afterStartTicks = String(afterResult.clip.start.ticks);
            var afterEndTicks = String(afterResult.clip.end.ticks);
            var sourceMetadataChanged = afterInTicks !== originalInPointTicks || afterOutTicks !== originalOutPointTicks;
            var timelineMoved = afterStartTicks !== originalStartTicks || afterEndTicks !== originalEndTicks;
            if (!timelineMoved) {
              drift.push("visible timeline start/end ticks did not move");
            }

            if (drift.length) {
              if (timelineMoved) {
                var restoredStart = new Time();
                restoredStart.ticks = originalStartTicks;
                var restoredEnd = new Time();
                restoredEnd.ticks = originalEndTicks;
                try { afterResult.clip.start = restoredStart; afterResult.clip.end = restoredEnd; } catch (edgeRestoreError) {}
              }
              if (sourceMetadataChanged || timelineMoved) {
                // Partial write: source in/out changed without a verified timeline edge.
                var restoredIn = new Time();
                restoredIn.ticks = originalInPointTicks;
                var restoredOut = new Time();
                restoredOut.ticks = originalOutPointTicks;
                afterResult.clip.inPoint = restoredIn;
                afterResult.clip.outPoint = restoredOut;

                var rolledBack = __findClip(nodeId);
                if (rolledBack) {
                  var rollbackSucceeded = String(rolledBack.clip.inPoint.ticks) === originalInPointTicks &&
                                          String(rolledBack.clip.outPoint.ticks) === originalOutPointTicks &&
                                          String(rolledBack.clip.start.ticks) === originalStartTicks &&
                                          String(rolledBack.clip.end.ticks) === originalEndTicks;

                  if (rollbackSucceeded) {
                    return __editFail("Premiere did not apply a verified timeline trim: " + drift.join("; ") + ". The write partially changed source metadata without moving the timeline edge, which would poison the clip for future trims. The source metadata was rolled back to its original state. Structural clip edits are known to no-op on some Premiere Pro 26.x installations. Use the workaround (set in/out on Source Monitor before placing via create_sequence_from_clips) or undo and retry in the Premiere UI.");
                  } else {
                    return __editFail("Premiere did not apply a verified timeline trim: " + drift.join("; ") + ". A partial write occurred and rollback of source metadata could not be verified. The clip may be in an inconsistent state. Use Undo to restore it.");
                  }
                } else {
                  return __editFail("Premiere did not apply a verified timeline trim: " + drift.join("; ") + ". A partial write occurred but the clip could not be re-found for rollback. The clip may be in an inconsistent state. Use Undo to restore it.");
                }
              } else {
                return __editFail("Premiere did not apply a verified timeline trim: " + drift.join("; ") + ". The source metadata was unchanged, so the clip remains consistent. Structural clip edits are known to no-op on some Premiere Pro 26.x installations.");
              }
            }

            var afterKeyframes = __findOutOfRangeKeyframes(afterResult.clip, after.end - after.start);
            if (afterKeyframes.errors.length && "${keyframePolicy}" === "reject") {
              return __editFail("The timeline trim may have applied, but keyframes could not be fully read back (" + afterKeyframes.errors.join("; ") + "). It is not reported as verified; inspect the clip or use Undo.");
            }
            if (afterKeyframes.outside.length && "${keyframePolicy}" === "reject") {
              return __editFail("The timeline trim may have applied, but " + afterKeyframes.outside.length + " effect keyframe(s) remain outside its visible range. It is not reported as verified; inspect the clip or use Undo.");
            }

            return __editOk({
              trimmed: true,
              verified: true,
              clipName: afterResult.clip.name,
              inPoint: actualIn,
              outPoint: actualOut,
              timelineStart: after.start,
              timelineEnd: after.end,
              timelineDuration: after.duration,
              keyframePolicy: "${keyframePolicy}",
              keyframesOutsideVisibleRange: afterKeyframes.outside.length,
              keyframesVerified: afterKeyframes.errors.length === 0 && afterKeyframes.outside.length === 0
            });
          }
          var target = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!target) return __error("Clip not found: " + "${escapeForExtendScript(args.node_id)}");
          var __trimDeltaTicks = ${args.new_in_seconds !== undefined
            ? `__secondsToTicks(${args.new_in_seconds}) - parseFloat(target.clip.inPoint.ticks)`
            : `__secondsToTicks(${args.new_out_seconds}) - parseFloat(target.clip.outPoint.ticks)`};
          return __runLinkedEdit(target, "${escapeForExtendScript(args.node_id)}", ${args.include_linked === false ? "false" : "true"}, __editOne, "trim");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_duration: {
      description:
        "Set one timeline clip's visible duration by moving only its timeline end (TrackItem.end) while keeping its start fixed. Pass exactly one of duration_seconds or end_seconds. Works for extending still images past their import length. Refuses to overlap the next clip on the same track, rejects shortening that would strand effect keyframes unless keyframe_policy is preserve, reads start/end back, and restores the original end if Premiere clamps or ignores the write (for example when video media has no handle left). Linked audio/video partners get the same change by default (include_linked), applied as the same end offset so partners with a J/L cut keep their offset; every clip is checked before any is changed. Use this instead of speed changes, which Premiere does not expose to scripting.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the timeline clip (track item) to resize",
          },
          duration_seconds: {
            type: "number",
            exclusiveMinimum: 0,
            description:
              "Target visible duration in seconds, measured from the clip's current timeline start. Specify exactly one of duration_seconds or end_seconds.",
          },
          end_seconds: {
            type: "number",
            exclusiveMinimum: 0,
            description:
              "Target absolute timeline end (out-point) in seconds. Must be at least one frame after the clip's start. Specify exactly one of duration_seconds or end_seconds.",
          },
          keyframe_policy: {
            type: "string",
            enum: ["reject", "preserve"],
            description:
              "When shortening, how to handle effect keyframes beyond the new visible length: reject (default) leaves the timeline unchanged; preserve keeps them and reports their count.",
          },
          include_linked: {
            type: "boolean",
            description: "Also apply the edit to the clip's linked audio/video partners, as Premiere does with linked selection (default: true).",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        duration_seconds?: number;
        end_seconds?: number;
        keyframe_policy?: "reject" | "preserve";
        include_linked?: boolean;
      }) => {
        if (typeof args.node_id !== "string" || args.node_id.trim() === "") {
          return { success: false, error: "set_clip_duration requires a non-empty node_id." };
        }
        if ((args.duration_seconds === undefined) === (args.end_seconds === undefined)) {
          return {
            success: false,
            error: "set_clip_duration requires exactly one of duration_seconds or end_seconds.",
          };
        }
        const requested = args.duration_seconds ?? args.end_seconds;
        if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0 || requested > MAX_CLIP_DURATION_SECONDS) {
          return {
            success: false,
            error: `set_clip_duration target must be a finite number of seconds greater than 0 and at most ${MAX_CLIP_DURATION_SECONDS}.`,
          };
        }
        const keyframePolicy = args.keyframe_policy ?? "reject";
        if (keyframePolicy !== "reject" && keyframePolicy !== "preserve") {
          return { success: false, error: "keyframe_policy must be reject or preserve." };
        }
        const mode = args.duration_seconds !== undefined ? "duration" : "end";
        const nodeId = escapeForExtendScript(args.node_id);

        const script = buildToolScript(`
          function __editOne(result, nodeId, checkOnly) {
            var clip = result.clip;
            var seq = app.project.activeSequence;
            if (!seq) return __editFail("No active sequence");

            // Premiere snaps edits to frame boundaries; allow one frame of drift.
            var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
            if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
            var tolerance = __ticksToSeconds(frameTicks);
            ${KEYFRAME_SCAN_HELPERS}

            // Capture tick strings, never Time references: Premiere can mutate the
            // same Time instance on write.
            var originalStartTicks = String(clip.start.ticks);
            var originalEndTicks = String(clip.end.ticks);
            var startTicks = parseFloat(originalStartTicks);
            var endTicks = parseFloat(originalEndTicks);
            if (!isFinite(startTicks) || !isFinite(endTicks) || !(endTicks > startTicks)) {
              return __editFail("Premiere did not provide a readable, non-empty timeline range for this clip; no change was attempted.");
            }

            // The clip gets the requested end; linked partners move their end by
            // the same amount, so partners that start or end elsewhere keep sync.
            var targetEndTicks = endTicks + __durationDeltaTicks;
            if (targetEndTicks - startTicks < frameTicks) {
              return __editFail("The requested end must be at least one frame after the clip start (" + __ticksToSeconds(startTicks) + "s); no change was attempted.");
            }

            var trackCollection = result.trackType === "video" ? seq.videoTracks : seq.audioTracks;
            var track = trackCollection[result.trackIndex];
            if (!track) return __editFail("Could not resolve the clip's " + result.trackType + " track; no change was attempted.");

            // The next clip on the same track bounds any extension. Premiere's end
            // setter would otherwise overwrite or collide with it.
            var nextClip = null;
            for (var ni = 0; ni < track.clips.numItems; ni++) {
              var candidate = track.clips[ni];
              if (String(candidate.nodeId) === String(clip.nodeId)) continue;
              var candidateStart = parseFloat(candidate.start.ticks);
              if (!isFinite(candidateStart) || candidateStart <= startTicks) continue;
              if (!nextClip || candidateStart < nextClip.start) {
                nextClip = { nodeId: String(candidate.nodeId), name: candidate.name, start: candidateStart, endTicks: String(candidate.end.ticks) };
              }
            }
            if (nextClip && targetEndTicks > nextClip.start + 1) {
              return __editFail("Refusing to extend: the requested end (" + __ticksToSeconds(targetEndTicks) + "s) would overlap the next clip '" + nextClip.name + "' on " + result.trackType + " track " + result.trackIndex + ", which starts at " + __ticksToSeconds(nextClip.start) + "s. Move or trim that clip first. No change was attempted.");
            }
            var clipCountBefore = track.clips.numItems;

            var mediaPath = "";
            try { if (clip.projectItem) mediaPath = String(clip.projectItem.getMediaPath()); } catch (mediaPathError) {}
            var isStillImage = /\\.(png|jpe?g|tiff?|psd|gif|bmp|tga|webp|heic|heif|exr|dpx|ai|eps)$/i.test(mediaPath);
            var speed = null;
            var reversed = null;
            try { speed = clip.getSpeed(); } catch (speedError) {}
            try { reversed = !!clip.isSpeedReversed(); } catch (reverseError) {}

            var newDurationSeconds = __ticksToSeconds(targetEndTicks - startTicks);
            var shortening = targetEndTicks < endTicks;
            if (shortening && "${keyframePolicy}" === "reject") {
              var beforeKeys = __findOutOfRangeKeyframes(clip, newDurationSeconds);
              if (beforeKeys.errors.length) {
                return __editFail("Could not inspect every time-varying effect property before shortening (" + beforeKeys.errors.join("; ") + "); no change was attempted.");
              }
              if (beforeKeys.outside.length) {
                return __editFail("Refusing to shorten: " + beforeKeys.outside.length + " effect keyframe(s) would sit beyond the new visible length. Use keyframe_policy: preserve to keep them intentionally, or move them with the keyframe tools. No change was attempted.");
              }
            }

            if (checkOnly) return __editOk({ checked: true });
            if (Math.abs(targetEndTicks - endTicks) < 1) {
              return __editOk({
                outcome: "verified",
                verified: true,
                changed: false,
                clipName: clip.name,
                trackType: result.trackType,
                trackIndex: result.trackIndex,
                timelineStart: __ticksToSeconds(startTicks),
                timelineEnd: __ticksToSeconds(endTicks),
                durationSeconds: __ticksToSeconds(endTicks - startTicks),
                isStillImage: isStillImage
              });
            }

            // Documented TrackItem.end is a read/write Time. Write a Time built from
            // ticks; fall back to a tick string on hosts that reject the object.
            var writeErrors = [];
            try {
              var newEnd = new Time();
              newEnd.ticks = String(targetEndTicks);
              clip.end = newEnd;
            } catch (timeWriteError) {
              writeErrors.push(timeWriteError.toString());
              try { clip.end = String(targetEndTicks); } catch (tickWriteError) { writeErrors.push(tickWriteError.toString()); }
            }
            // Keep the source out point consistent with the new visible end. Premiere
            // 25.2 leaves outPoint stale after an end write, which later made
            // trim_clip refuse the clip as "inconsistent". Stills have no source
            // range to follow.
            if (!isStillImage) {
              try {
                var inTicksNow = parseFloat(clip.inPoint.ticks);
                if (isFinite(inTicksNow)) clip.outPoint = String(Math.round(inTicksNow + (targetEndTicks - startTicks)));
              } catch (outPointWriteError) { writeErrors.push("outPoint: " + outPointWriteError.toString()); }
            }

            var after = __findClip(nodeId);
            if (!after) return __editFail("The clip could not be found after the end write; the result is not verified. Inspect the timeline or use Undo.");
            if (after.trackType !== result.trackType || after.trackIndex !== result.trackIndex) {
              return __editFail("The clip changed track during the end write; the result is not verified. Use Undo to restore it.");
            }
            var afterStart = parseFloat(after.clip.start.ticks);
            var afterEnd = parseFloat(after.clip.end.ticks);
            var drift = [];
            if (!isFinite(afterStart) || !isFinite(afterEnd)) drift.push("start/end could not be read back");
            if (Math.abs(afterStart - startTicks) > frameTicks) drift.push("start moved from " + __ticksToSeconds(startTicks) + "s to " + __ticksToSeconds(afterStart) + "s");
            if (Math.abs(afterEnd - targetEndTicks) > frameTicks) drift.push("end requested " + __ticksToSeconds(targetEndTicks) + "s, read back " + __ticksToSeconds(afterEnd) + "s");
            if (track.clips.numItems !== clipCountBefore) drift.push("track clip count changed from " + clipCountBefore + " to " + track.clips.numItems);
            if (nextClip) {
              var nextAfter = null;
              for (var na = 0; na < track.clips.numItems; na++) {
                if (String(track.clips[na].nodeId) === nextClip.nodeId) { nextAfter = track.clips[na]; break; }
              }
              if (!nextAfter || Math.abs(parseFloat(nextAfter.start.ticks) - nextClip.start) > 1 || String(nextAfter.end.ticks) !== nextClip.endTicks) {
                drift.push("the next clip '" + nextClip.name + "' changed");
              }
            }

            if (drift.length) {
              var mutated = String(after.clip.start.ticks) !== originalStartTicks || String(after.clip.end.ticks) !== originalEndTicks;
              var clamped = targetEndTicks > endTicks && isFinite(afterEnd) && afterEnd < targetEndTicks - frameTicks;
              var hint = clamped
                ? (isStillImage
                  ? " Premiere clamped the still image's end, which usually means its project item has in/out points limiting the usable range. Clear them with clear_item_in_out on the project item, then retry."
                  : " Premiere clamped the end, most likely because the source media has no more frames after the current out point.")
                : "";
              if (writeErrors.length) hint += " Write errors: " + writeErrors.join("; ") + ".";
              if (!mutated) {
                return __editFail("Premiere did not apply the duration change: " + drift.join("; ") + ". The clip is unchanged." + hint);
              }
              var restored = false;
              try {
                __writeClipSpan(after.clip, originalStartTicks, originalEndTicks);
                var check = __findClip(nodeId);
                restored = !!check && String(check.clip.start.ticks) === originalStartTicks && String(check.clip.end.ticks) === originalEndTicks;
              } catch (restoreError) {}
              return __editFail("Premiere did not apply a verified duration change: " + drift.join("; ") + ". " + (restored ? "The original start and end were restored." : "The original range could not be restored; use Undo.") + hint);
            }

            var payload = {
              outcome: "verified",
              verified: true,
              changed: true,
              clipName: after.clip.name,
              trackType: after.trackType,
              trackIndex: after.trackIndex,
              timelineStart: __ticksToSeconds(afterStart),
              timelineEnd: __ticksToSeconds(afterEnd),
              durationSeconds: __ticksToSeconds(afterEnd - afterStart),
              previousEnd: __ticksToSeconds(endTicks),
              previousDurationSeconds: __ticksToSeconds(endTicks - startTicks),
              inPoint: __trimSeconds(after.clip.inPoint),
              outPoint: __trimSeconds(after.clip.outPoint),
              isStillImage: isStillImage,
              speed: speed,
              reversed: reversed,
              keyframePolicy: "${keyframePolicy}"
            };
            if (shortening) {
              var afterKeys = __findOutOfRangeKeyframes(after.clip, __ticksToSeconds(afterEnd - afterStart));
              payload.keyframesOutsideVisibleRange = afterKeys.outside.length;
              if (afterKeys.errors.length || (afterKeys.outside.length && "${keyframePolicy}" === "reject")) {
                payload.outcome = "committed_unverified";
                payload.verified = false;
                payload.warning = "The timeline end was read back, but effect keyframes could not be fully verified after the change. Inspect the clip or use Undo.";
              }
            }
            return __editOk(payload);
          }
          var target = __findClip("${nodeId}");
          if (!target) return __error("Clip not found: " + "${nodeId}");
          var __durationDeltaTicks = ${mode === "duration"
            ? `parseFloat(target.clip.start.ticks) + __secondsToTicks(${requested})`
            : `__secondsToTicks(${requested})`} - parseFloat(target.clip.end.ticks);
          return __runLinkedEdit(target, "${nodeId}", ${args.include_linked === false ? "false" : "true"}, __editOne, "duration change");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    split_clip: {
      description:
        "Split every clip on one track that spans a timeline time, then verify both resulting boundaries. Requires QE DOM; effect-keyframe redistribution remains unverified.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            minimum: 0,
            description: "Timeline time in seconds where clips on the selected track will split",
          },
          track_index: {
            type: "number",
            minimum: 0,
            description: "Track index (0-based, default: 0)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (default: video)",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; track_index?: number; track_type?: string }) => {
        if (!Number.isFinite(args.time_seconds) || args.time_seconds < 0) {
          return { success: false, error: "time_seconds must be finite, non-negative seconds." };
        }
        if (args.track_index !== undefined && (!Number.isInteger(args.track_index) || args.track_index < 0)) {
          return { success: false, error: "track_index must be a non-negative integer." };
        }
        const trackType = args.track_type ?? "video";
        if (trackType !== "video" && trackType !== "audio") {
          return { success: false, error: "track_type must be video or audio." };
        }
        const trackIndex = args.track_index ?? 0;

        const script = buildToolScript(`
          app.enableQE();
          var domSequence = app.project.activeSequence;
          if (!domSequence) return __error("No active sequence");
          var seq = qe.project.getActiveSequence();
          if (!seq) return __error("No active sequence (QE)");
          
          var track = ${trackType === "video" ? `seq.getVideoTrackAt(${trackIndex})` : `seq.getAudioTrackAt(${trackIndex})`};
          if (!track) return __error("QE track not found");

          var domTrack = ${trackType === "video" ? `domSequence.videoTracks[${trackIndex}]` : `domSequence.audioTracks[${trackIndex}]`};
          if (!domTrack) return __error("DOM track not found");
          var frameTicks = domSequence.timebase ? parseFloat(domSequence.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var boundaryTolerance = frameTicks;
          var clipCountBefore = domTrack.clips.numItems;
          var cutTicks = __secondsToTicks(${args.time_seconds});

          function __eligibleClips(track, cut) {
            var clips = [];
            for (var i = 0; i < track.clips.numItems; i++) {
              var item = track.clips[i];
              var start = parseFloat(item.start.ticks);
              var end = parseFloat(item.end.ticks);
              if (!isFinite(start) || !isFinite(end)) continue;
              if (cut > start && cut < end) {
                clips.push({ start: start, end: end, nodeId: item.nodeId, name: item.name });
              }
            }
            return clips;
          }

          function __hasSegment(track, wantedStart, wantedEnd) {
            for (var i = 0; i < track.clips.numItems; i++) {
              var item = track.clips[i];
              var actualStart = parseFloat(item.start.ticks);
              var actualEnd = parseFloat(item.end.ticks);
              if (Math.abs(actualStart - wantedStart) <= boundaryTolerance && Math.abs(actualEnd - wantedEnd) <= boundaryTolerance) return true;
            }
            return false;
          }

          var eligibleBefore = __eligibleClips(domTrack, cutTicks);
          if (!eligibleBefore.length) {
            return __error("No clip on the requested ${trackType} track strictly spans ${args.time_seconds}s; no razor was attempted.");
          }

          // QE razor() parses its argument as a timecode string. Handing it a
          // tick count makes the call succeed and do nothing, which is the
          // silent no-op reported in #21, #127, #263 and #264. frameTicks is
          // ticks-per-frame for this sequence, so frames = ticks / frameTicks.
          var __razorFps = Math.round(TICKS_PER_SECOND / frameTicks);
          if (!__razorFps || !isFinite(__razorFps) || __razorFps < 1) __razorFps = 30;
          var __razorFrames = Math.round(cutTicks / frameTicks);
          function __pad2(n) { return n < 10 ? "0" + n : "" + n; }
          var __razorTc = __pad2(Math.floor(__razorFrames / (__razorFps * 3600))) + ":" +
                          __pad2(Math.floor((__razorFrames % (__razorFps * 3600)) / (__razorFps * 60))) + ":" +
                          __pad2(Math.floor((__razorFrames % (__razorFps * 60)) / __razorFps)) + ":" +
                          __pad2(__razorFrames % __razorFps);

          try {
            track.razor(__razorTc);
          } catch(razorError) {
            return __error("QE razor rejected the request: " + razorError.toString() + ". No verified split was produced.");
          }

          var clipCountAfter = domTrack.clips.numItems;
          var expectedClipCount = clipCountBefore + eligibleBefore.length;
          if (clipCountAfter !== expectedClipCount) {
            return __error("Premiere razor changed the track clip count from " + clipCountBefore + " to " + clipCountAfter + ", expected " + expectedClipCount + " for " + eligibleBefore.length + " spanning clip(s). The timeline may be partially changed, but the split is not reported as verified. Structural QE edits are known to no-op on some Premiere Pro 26.x installations.");
          }

          var missingSegments = [];
          for (var ei = 0; ei < eligibleBefore.length; ei++) {
            var before = eligibleBefore[ei];
            if (!__hasSegment(domTrack, before.start, cutTicks)) missingSegments.push(before.name + " left segment");
            if (!__hasSegment(domTrack, cutTicks, before.end)) missingSegments.push(before.name + " right segment");
          }
          if (missingSegments.length) {
            return __error("Premiere razor changed the clip count but did not create the requested cut boundary for " + missingSegments.join(", ") + ". The timeline may be partially changed, but the split is not reported as verified.");
          }
          return __result({
            split: true,
            verified: true,
            timelineVerified: true,
            atSeconds: __ticksToSeconds(cutTicks),
            requestedSeconds: ${args.time_seconds},
            trackIndex: ${trackIndex},
            trackType: "${trackType}",
            splitClipCount: eligibleBefore.length,
            keyframeSemantics: "unverified"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    duplicate_clip: {
      description:
        "Duplicate a timeline clip, with its linked audio/video partner, onto the first tracks above it that are empty for the clip's time range. The copy keeps the clip's source in point and visible duration, is placed with an overwrite edit (nothing ripples), and is read back. Fails without changes when no free track is available; add one with add_tracks.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to duplicate",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const nodeId = escapeForExtendScript(args.node_id);
        const script = buildToolScript(`
          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");
          var clip = result.clip;
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var item = clip.projectItem;
          if (!item) return __error("Cannot find source project item for clip");
          var frameTicks = seq.timebase ? parseFloat(seq.timebase) : TICKS_PER_SECOND / 24;
          var startTicks = parseFloat(clip.start.ticks);
          var endTicks = parseFloat(clip.end.ticks);
          var inTicks = parseFloat(clip.inPoint.ticks);
          if (!isFinite(startTicks) || !isFinite(endTicks) || !isFinite(inTicks) || !(endTicks > startTicks)) {
            return __error("Premiere did not report a readable range for this clip; nothing was changed.");
          }
          // outPoint can read back stale after a timeline end edit, so the copy's
          // source range is the in point plus the visible duration.
          var copyIn = __ticksToSeconds(inTicks);
          var copyOut = __ticksToSeconds(inTicks + (endTicks - startTicks));

          var isVideo = result.trackType === "video";
          var partner = null;
          try {
            var linked = clip.getLinkedItems();
            for (var li = 0; linked && li < linked.numItems; li++) {
              var candidate = linked[li];
              if (String(candidate.nodeId) === String(clip.nodeId)) continue;
              var located = __findClip(String(candidate.nodeId));
              if (located && located.trackType !== result.trackType) { partner = located; break; }
            }
          } catch (linkError) {}

          function mediaSpan(mediaType) {
            try { return parseFloat(item.getOutPoint(mediaType).ticks) - parseFloat(item.getInPoint(mediaType).ticks); } catch (spanError) { return null; }
          }
          var videoSpan = mediaSpan(1);
          var audioSpan = mediaSpan(2);
          var hasVideo = !(videoSpan !== null && !isNaN(videoSpan) && !(videoSpan > 0));
          var hasAudio = !(audioSpan !== null && !isNaN(audioSpan) && !(audioSpan > 0));

          function freeTrack(tracks, fromIndex) {
            for (var t = Math.max(0, fromIndex); t < tracks.numTracks; t++) {
              var busy = false;
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var other = tracks[t].clips[c];
                if (parseFloat(other.start.ticks) < endTicks - 1 && parseFloat(other.end.ticks) > startTicks + 1) { busy = true; break; }
              }
              if (!busy) return t;
            }
            return -1;
          }
          var videoFrom = isVideo ? result.trackIndex + 1 : (partner ? partner.trackIndex + 1 : 0);
          var audioFrom = !isVideo ? result.trackIndex + 1 : (partner ? partner.trackIndex + 1 : 0);
          var videoTarget = hasVideo ? freeTrack(seq.videoTracks, videoFrom) : -1;
          var audioTarget = hasAudio ? freeTrack(seq.audioTracks, audioFrom) : -1;
          if (hasVideo && videoTarget < 0) return __error("No video track above V" + (videoFrom) + " is free for " + __ticksToSeconds(startTicks) + "-" + __ticksToSeconds(endTicks) + "s. Add one with add_tracks and retry; nothing was changed.");
          if (hasAudio && audioTarget < 0) return __error("No audio track above A" + (audioFrom) + " is free for " + __ticksToSeconds(startTicks) + "-" + __ticksToSeconds(endTicks) + "s. Add one with add_tracks and retry; nothing was changed.");

          function idsOn(track) {
            var ids = {};
            for (var c = 0; c < track.clips.numItems; c++) ids[String(track.clips[c].nodeId)] = true;
            return ids;
          }
          function newClipOn(track, before) {
            for (var c = 0; c < track.clips.numItems; c++) {
              if (!before[String(track.clips[c].nodeId)]) return track.clips[c];
            }
            return null;
          }
          var beforeVideo = videoTarget >= 0 ? idsOn(seq.videoTracks[videoTarget]) : {};
          var beforeAudio = audioTarget >= 0 ? idsOn(seq.audioTracks[audioTarget]) : {};

          var originalIn = item.getInPoint(4);
          var originalOut = item.getOutPoint(4);
          var originalInSeconds = originalIn ? Number(originalIn.seconds) : 0;
          var originalOutSeconds = originalOut ? Number(originalOut.seconds) : 0;
          var placeError = null;
          try {
            item.setInPoint(copyIn, 4);
            item.setOutPoint(copyOut, 4);
            seq.overwriteClip(item, String(startTicks), Math.max(videoTarget, 0), Math.max(audioTarget, 0));
          } catch (overwriteError) {
            placeError = overwriteError.toString();
          }
          try { item.setInPoint(originalInSeconds, 4); item.setOutPoint(originalOutSeconds, 4); } catch (restoreError) {}
          if (placeError) return __error("Premiere rejected the duplicate: " + placeError);

          var newVideo = videoTarget >= 0 ? newClipOn(seq.videoTracks[videoTarget], beforeVideo) : null;
          var newAudio = audioTarget >= 0 ? newClipOn(seq.audioTracks[audioTarget], beforeAudio) : null;
          // Keep only what the original clip had: drop the other media kind when it had no linked partner.
          if (isVideo && !partner && newAudio) { try { newAudio.remove(false, false); } catch (dropAudio) {} newAudio = null; }
          if (!isVideo && !partner && newVideo) { try { newVideo.remove(false, false); } catch (dropVideo) {} newVideo = null; }

          var primary = isVideo ? newVideo : newAudio;
          if (!primary) return __error("Premiere did not place the duplicate on the expected track; inspect the timeline or use Undo.");
          var drift = Math.abs(parseFloat(primary.start.ticks) - startTicks) + Math.abs(parseFloat(primary.end.ticks) - endTicks);
          var inDrift = Math.abs(parseFloat(primary.inPoint.ticks) - inTicks);
          function describe(c, type, index) {
            return c ? { nodeId: String(c.nodeId), trackType: type, trackIndex: index, startSeconds: __ticksToSeconds(c.start.ticks), endSeconds: __ticksToSeconds(c.end.ticks), inSeconds: __ticksToSeconds(c.inPoint.ticks) } : null;
          }
          return __result({
            duplicated: true,
            verified: drift <= 2 * frameTicks && inDrift <= frameTicks,
            clipName: clip.name,
            copy: describe(primary, result.trackType, isVideo ? videoTarget : audioTarget),
            linkedCopy: isVideo ? describe(newAudio, "audio", audioTarget) : describe(newVideo, "video", videoTarget)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    enable_disable_clip: {
      description: "Enable or disable a clip on the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "Set to true to enable, false to disable",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var wantDisabled = ${args.enabled ? "false" : "true"};
          result.clip.disabled = wantDisabled;
          var verified = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!verified) return __error("Clip state changed, but the clip could not be re-resolved for verification.");
          if (!!verified.clip.disabled !== wantDisabled) return __error("Premiere did not persist the requested clip enabled state.");
          return __result({ clipName: verified.clip.name, enabled: !verified.clip.disabled, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_properties: {
      description:
        "Set supported clip properties (opacity, scale, position, rotation). Clip speed is unsupported and fails before mutation; use set_clip_duration to change a clip's timeline length.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          opacity: {
            type: "number",
            description: "Opacity value (0-100)",
          },
          speed: {
            type: "number",
            description: "Unsupported by Premiere's documented scripting APIs. Supplying this returns an actionable error without mutating the clip; use set_clip_duration to change timeline length.",
          },
          scale: {
            type: "number",
            description: "Scale percentage (100 = original size)",
          },
          position_x: {
            type: "number",
            description: "Horizontal position in sequence pixels",
          },
          position_y: {
            type: "number",
            description: "Vertical position in sequence pixels",
          },
          rotation: {
            type: "number",
            description: "Rotation in degrees",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        opacity?: number;
        speed?: number;
        scale?: number;
        position_x?: number;
        position_y?: number;
        rotation?: number;
      }) => {
        if (args.speed !== undefined) {
          return {
            success: false,
            error:
              SPEED_UNAVAILABLE_ERROR,
          };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var changes = {};
          
          ${args.opacity !== undefined ? `
          // Set opacity via Motion component
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Opacity" || comp.displayName === "Opacity") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Opacity") {
                  comp.properties[p].setValue(${args.opacity}, true);
                  changes.opacity = ${args.opacity};
                }
              }
            }
          }
          ` : ""}
          
          ${args.scale !== undefined ? `
          // Even scaling reads Uniform Scale first: with it off, "Scale" is the height alone.
          var scaleMotion = null;
          for (var sm = 0; sm < clip.components.numItems; sm++) {
            if (clip.components[sm].matchName === "AE.ADBE Motion" || clip.components[sm].displayName === "Motion") { scaleMotion = clip.components[sm]; break; }
          }
          if (!scaleMotion) return __error("The clip has no Motion component, so scale was not set.");
          var scaledClip = __setMotionScale(scaleMotion, ${args.scale});
          if (!scaledClip.ok) return __error(scaledClip.error);
          changes.scale = ${args.scale};` : ""}

          ${args.scale !== undefined || args.position_x !== undefined || args.position_y !== undefined || args.rotation !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Motion" || comp.displayName === "Motion") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.scale !== undefined ? `
` : ""}
                ${args.position_x !== undefined || args.position_y !== undefined ? `
                if (prop.displayName === "Position") {
                  var posVal = prop.getValue();
                  var px = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[0] : 0;
                  var py = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[1] : 0;
                  // position_x/y are sequence pixels; Premiere 25.2 stores Position normalized.
                  var posScale = __motionPointScale(prop, __sequenceFrameSize(app.project.activeSequence));
                  if (!posScale) return __error("The sequence frame size is unreadable, so position pixels cannot be converted; nothing was changed.");
                  ${args.position_x !== undefined ? `px = ${args.position_x} * posScale.x; changes.position_x = ${args.position_x};` : ""}
                  ${args.position_y !== undefined ? `py = ${args.position_y} * posScale.y; changes.position_y = ${args.position_y};` : ""}
                  prop.setValue([px, py], true);
                }` : ""}
                ${args.rotation !== undefined ? `
                if (prop.displayName === "Rotation") {
                  prop.setValue(${args.rotation}, true);
                  changes.rotation = ${args.rotation};
                }` : ""}
              }
            }
          }
          ` : ""}
          
          return __result({ updated: true, clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    replace_clip: {
      description:
        "Replace one timeline clip with a different project item on the same track, keeping the exact timeline start and end. " +
        "The replacement plays from its own In mark for the original clip's duration; neighbouring clips do not ripple, and a linked partner clip on another track is left in place. " +
        "Refuses without changing anything when the track is locked. Reads the track back: verified when the new clip covers the same span, committed_unverified when the span holds but the source In point cannot be confirmed, otherwise failure with Undo guidance.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to replace",
          },
          new_item_id: {
            type: "string",
            description: "Node ID or name of the new project item to replace with",
          },
        },
        required: ["node_id", "new_item_id"],
      },
      handler: async (args: { node_id: string; new_item_id: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var newItem = __findProjectItem("${escapeForExtendScript(args.new_item_id)}");
          if (!newItem) return __error("Replacement project item not found: ${escapeForExtendScript(args.new_item_id)}");
          
          if (__isBinItem(newItem)) return __error("Replace refused; nothing was changed. " + newItem.name + " is a bin, not a clip.");

          var clip = result.clip;
          var oldName = clip.name;
          var oldNodeId = String(clip.nodeId);
          var trackIndex = result.trackIndex;
          var trackType = result.trackType;
          var mediaType = trackType === "video" ? 1 : 2;
          var trackList = trackType === "video" ? seq.videoTracks : seq.audioTracks;
          var track = trackList[trackIndex];
          var oldStart = parseFloat(clip.start.ticks);
          var oldEnd = parseFloat(clip.end.ticks);
          var span = oldEnd - oldStart;
          if (!(span > 0)) return __error("Replace refused; nothing was changed. The clip has an empty or inverted timeline range.");
          if (__isTrackLocked(track)) {
            return __error("Replace refused; nothing was changed. " + trackType + " track " + trackIndex + " is locked.");
          }
          if (typeof track.overwriteClip !== "function" || typeof newItem.setInPoint !== "function" || typeof newItem.setOutPoint !== "function") {
            return __error("Replace refused; nothing was changed. This Premiere build does not expose Track.overwriteClip or project item In/Out marks, so the clip span could not be preserved.");
          }
          var newIn = NaN;
          try { newIn = parseFloat(newItem.getInPoint(mediaType).ticks); } catch (eNewIn) {}
          if (isNaN(newIn)) return __error("Replace refused; nothing was changed. Could not read the In point of " + newItem.name + ".");
          var newOut = newIn + span;

          function countClips(list) {
            var counts = [];
            for (var ti = 0; ti < list.numTracks; ti++) counts[ti] = list[ti].clips.numItems;
            return counts;
          }
          var beforeVideoCounts = countClips(seq.videoTracks);
          var beforeAudioCounts = countClips(seq.audioTracks);
          var beforeIds = {};
          for (var bi = 0; bi < track.clips.numItems; bi++) beforeIds[String(track.clips[bi].nodeId)] = true;

          // Lift the old clip and overwrite exactly its span on the same track.
          // Sequence.insertClip would ripple later clips and use the new item's
          // full length, which is what changed the span before (#642).
          try {
            clip.remove(false, false);
          } catch (removeErr) {
            return __error("Premiere rejected removing the original clip (" + removeErr.toString() + "). The timeline may have changed; inspect it and use Undo if it did.");
          }
          var placed = __overwriteRangeOnTrack(track, newItem, oldStart, newIn, newOut, mediaType);
          var markNote = placed.marksRestored ? "" : " The In/Out marks of " + newItem.name + " could not be restored.";
          if (!placed.ok) {
            return __error("The timeline changed: the original clip was removed but Premiere could not place " + newItem.name + " (" + placed.error + "). Use Undo to restore it; this replace did not succeed." + markNote);
          }

          var replacement = null;
          for (var ri = 0; ri < track.clips.numItems && !replacement; ri++) {
            var cand = track.clips[ri];
            if (beforeIds[String(cand.nodeId)]) continue;
            var candSource = "";
            try { candSource = cand.projectItem ? String(cand.projectItem.nodeId) : ""; } catch (eSource) {}
            if (candSource !== String(newItem.nodeId)) continue;
            if (Math.abs(parseFloat(cand.start.ticks) - oldStart) > __TICK_MATCH_TOL) continue;
            replacement = cand;
          }
          var problems = [];
          if (!replacement) {
            problems.push(newItem.name + " was not found at " + __ticksToSeconds(oldStart) + "s on " + trackType + " track " + trackIndex);
          } else if (Math.abs(parseFloat(replacement.end.ticks) - oldEnd) > __TICK_MATCH_TOL) {
            problems.push("the replacement spans " + __ticksToSeconds(replacement.start.ticks) + "s-" + __ticksToSeconds(replacement.end.ticks) + "s instead of " + __ticksToSeconds(oldStart) + "s-" + __ticksToSeconds(oldEnd) + "s");
          }
          if (__findClip(oldNodeId)) problems.push("the original clip is still on the timeline");
          var afterVideoCounts = countClips(seq.videoTracks);
          var afterAudioCounts = countClips(seq.audioTracks);
          for (var vc = 0; vc < afterVideoCounts.length; vc++) {
            if (afterVideoCounts[vc] !== beforeVideoCounts[vc]) problems.push("video track " + vc + " changed from " + beforeVideoCounts[vc] + " to " + afterVideoCounts[vc] + " clip(s)");
          }
          for (var ac = 0; ac < afterAudioCounts.length; ac++) {
            if (afterAudioCounts[ac] !== beforeAudioCounts[ac]) problems.push("audio track " + ac + " changed from " + beforeAudioCounts[ac] + " to " + afterAudioCounts[ac] + " clip(s)");
          }
          if (problems.length) {
            return __error("The timeline changed but the replace did not verify: " + problems.join("; ") + ". Use Undo to restore the original clip; this is not reported as success." + markNote);
          }

          var sourceMatches = false;
          try { sourceMatches = Math.abs(parseFloat(replacement.inPoint.ticks) - newIn) <= __TICK_MATCH_TOL; } catch (eSourceRead) {}
          var replaceResult = {
            replaced: true,
            verified: sourceMatches,
            outcome: sourceMatches ? "verified" : "committed_unverified",
            oldClip: oldName,
            newClip: newItem.name,
            trackIndex: trackIndex,
            trackType: trackType,
            startSeconds: __ticksToSeconds(oldStart),
            endSeconds: __ticksToSeconds(oldEnd)
          };
          var warnings = [];
          if (!sourceMatches) warnings.push("The replacement keeps the original span, but its source In point could not be confirmed to match the In mark of " + newItem.name + ".");
          if (!placed.marksRestored) warnings.push("The In/Out marks of " + newItem.name + " could not be restored.");
          if (warnings.length) replaceResult.warning = warnings.join(" ");
          return __result(replaceResult);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    speed_change: {
      description:
        SPEED_UNAVAILABLE_DESCRIPTION,
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          speed_percent: {
            type: "number",
            description: "Speed as percentage (100 = normal, 200 = double, 50 = half)",
          },
          reverse: {
            type: "boolean",
            description: "Reverse playback direction (default: false)",
          },
        },
        required: ["node_id", "speed_percent"],
      },
      handler: async (args: { node_id: string; speed_percent: number; reverse?: boolean }) => {
        void args;
        return {
          success: false,
          error:
            SPEED_UNAVAILABLE_ERROR,
        };
      },
    },
  };
}
