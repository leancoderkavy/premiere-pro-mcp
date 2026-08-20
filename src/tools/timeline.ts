import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTimelineTools(bridgeOptions: BridgeOptions) {
  return {
    add_to_timeline: {
      description:
        "Insert a project item at a timeline position and verify Premiere added no unexpected same-track fragments.",
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
      },
      required: ["item_id"],
      },
      handler: async (args: { item_id: string; track_index?: number; start_seconds?: number; audio_track_index?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;
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
          var videoTrack = seq.videoTracks[${trackIndex}];
          if (!videoTrack) return __error("Video track index ${trackIndex} is out of range");
          var audioTrack = seq.audioTracks[${audioTrackIndex}];
          
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          
          var beforeVideoCount = videoTrack.clips.numItems;
          var beforeAudioCount = audioTrack ? audioTrack.clips.numItems : 0;
          var beforeVideoIds = {};
          var beforeAudioIds = {};
          var i;
          for (i = 0; i < beforeVideoCount; i++) beforeVideoIds[videoTrack.clips[i].nodeId] = true;
          if (audioTrack) {
            for (i = 0; i < beforeAudioCount; i++) beforeAudioIds[audioTrack.clips[i].nodeId] = true;
          }

          var startTicks = __secondsToTicks(${startSeconds}).toString();
          seq.insertClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});

          var afterVideoCount = videoTrack.clips.numItems;
          var afterAudioCount = audioTrack ? audioTrack.clips.numItems : 0;
          if (afterVideoCount > beforeVideoCount + 1 || (audioTrack && afterAudioCount > beforeAudioCount + 1)) {
            return __error("Premiere inserted more than one clip on a targeted track. This can leave a residual frame fragment at an exact boundary; the insertion may be partial, but is not reported as verified.");
          }

          var inserted = [];
          for (i = 0; i < afterVideoCount; i++) {
            var videoClip = videoTrack.clips[i];
            if (!beforeVideoIds[videoClip.nodeId]) inserted.push({ clip: videoClip, trackType: "video" });
          }
          if (audioTrack) {
            for (i = 0; i < afterAudioCount; i++) {
              var audioClip = audioTrack.clips[i];
              if (!beforeAudioIds[audioClip.nodeId]) inserted.push({ clip: audioClip, trackType: "audio" });
            }
          }
          if (!inserted.length) {
            return __error("Premiere did not add a new track item at the requested insertion point.");
          }

          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var tolerance = __ticksToSeconds(frameTicks);
          var matchedItem = false;
          for (i = 0; i < inserted.length; i++) {
            var insertedClip = inserted[i].clip;
            if (insertedClip.projectItem && insertedClip.projectItem.nodeId === item.nodeId) {
              matchedItem = true;
              if (Math.abs(__ticksToSeconds(insertedClip.start.ticks) - ${startSeconds}) > tolerance) {
                return __error("Premiere added the requested item but not at the requested timeline frame; the insertion is not reported as verified.");
              }
            }
          }
          if (!matchedItem) {
            return __error("Premiere changed the target track but the requested project item was not found after insertion.");
          }
          
          return __result({
            added: true,
            verified: true,
            item: item.name,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            insertedTrackItems: inserted.length
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_from_timeline: {
      description: "Remove a clip from the timeline",
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
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; ripple?: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          clip.remove(${args.ripple ? "true" : "false"}, ${args.ripple ? "true" : "false"});
          return __result({ removed: true, clipName: clip.name });
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

          try {
            qeClip.moveToTrack(${args.new_track_index});
          } catch (moveErr) {
            return __error("Could not move the clip to track ${args.new_track_index}: the QE moveToTrack API rejected the call (" + moveErr.toString() + "). This is a known QE limitation on Premiere Pro 26.x (confirmed on 26.2.2). The clip was left untouched — call move_clip without new_track_index to reposition it in time.");
          }
          ` : ""}

          clip.start = __secondsToTicks(${args.new_start_seconds}).toString();

          // Re-find the clip rather than trusting the original reference, which
          // can go stale once the clip changes track.
          var after = __findClip("${nodeId}");
          if (!after) return __error("Clip ${nodeId} could not be found after the move; the timeline may be in an unexpected state.");

          var actualStart = __ticksToSeconds(after.clip.start.ticks);
          if (Math.abs(actualStart - ${args.new_start_seconds}) > tolerance) {
            return __error("Premiere did not move the clip: requested start ${args.new_start_seconds}s, read back " + actualStart + "s. Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
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
            trackIndex: after.trackIndex
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    trim_clip: {
      description:
        "Trim exactly one source in/out point and verify the corresponding visible timeline edge. Refuses retimed clips and, by default, trims that would leave effect keyframes outside the visible clip.",
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
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        new_in_seconds?: number;
        new_out_seconds?: number;
        keyframe_policy?: "reject" | "preserve";
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

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");

          var clip = result.clip;

          // Premiere snaps in/out points to frame boundaries, so verification
          // allows one frame of drift from the requested value. seq.timebase is
          // ticks-per-frame; fall back to 24fps if it cannot be read so we never
          // compare against NaN.
          var seq = app.project.activeSequence;
          var frameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var tolerance = __ticksToSeconds(frameTicks);

          function __trimSeconds(timeValue) {
            try { return __ticksToSeconds(timeValue.ticks); } catch(e) { return NaN; }
          }

          function __snapshotTrimGeometry(item) {
            return {
              inPoint: __trimSeconds(item.inPoint),
              outPoint: __trimSeconds(item.outPoint),
              start: __trimSeconds(item.start),
              end: __trimSeconds(item.end),
              duration: __trimSeconds(item.duration)
            };
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

          var before = __snapshotTrimGeometry(clip);
          if (!isFinite(before.inPoint) || !isFinite(before.outPoint) || !isFinite(before.start) || !isFinite(before.end) || !isFinite(before.duration)) {
            return __error("Premiere did not provide readable source and timeline times for this clip; trim was not attempted.");
          }
          if (before.outPoint - before.inPoint < tolerance || before.end - before.start < tolerance) {
            return __error("Clip has an empty or unreadable duration; trim was not attempted.");
          }

          // A source-point trim can only have an exact CEP postcondition when
          // the source and visible durations agree. Retimed/reversed clips need
          // host-specific semantics, so refusing them is safer than guessing.
          if (Math.abs((before.end - before.start) - (before.outPoint - before.inPoint)) > tolerance) {
            return __error("trim_clip does not support retimed or otherwise non-1x clips because CEP cannot prove the requested source trim maps to the correct timeline edge. Use a host-verified workflow instead.");
          }

          var requestedIn = ${args.new_in_seconds !== undefined ? args.new_in_seconds : "null"};
          var requestedOut = ${args.new_out_seconds !== undefined ? args.new_out_seconds : "null"};
          var targetIn = requestedIn === null ? before.inPoint : requestedIn;
          var targetOut = requestedOut === null ? before.outPoint : requestedOut;
          if (!isFinite(targetIn) || !isFinite(targetOut) || targetIn < 0 || targetOut - targetIn < tolerance) {
            return __error("The requested source trim must leave at least one frame between in and out; trim was not attempted.");
          }

          var prospectiveDuration = targetOut - targetIn;
          var beforeKeyframes = __findOutOfRangeKeyframes(clip, prospectiveDuration);
          if (beforeKeyframes.errors.length && "${keyframePolicy}" === "reject") {
            return __error("Could not inspect every time-varying effect property before trim (" + beforeKeyframes.errors.join("; ") + "); trim was not attempted so keyframe behavior is not guessed.");
          }
          if (beforeKeyframes.outside.length && "${keyframePolicy}" === "reject") {
            return __error("Refusing trim before mutation: " + beforeKeyframes.outside.length + " effect keyframe(s) would remain outside the visible clip. Use keyframe_policy: preserve only if retaining those keyframes is intentional, or adjust them explicitly with the keyframe tools.");
          }

          ${args.new_in_seconds !== undefined ? `clip.inPoint = __secondsToTicks(${args.new_in_seconds}).toString();` : "clip.outPoint = __secondsToTicks(" + args.new_out_seconds + ").toString();"}

          // Re-find the TrackItem after the write. Premiere can replace stale
          // DOM references during an edit, especially for audio clips.
          var afterResult = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!afterResult) return __error("Clip could not be found after the trim attempt; the timeline may have changed and the result is not verified.");
          if (afterResult.trackType !== result.trackType || afterResult.trackIndex !== result.trackIndex) {
            return __error("Clip moved tracks during the trim attempt; the result is not verified.");
          }
          var after = __snapshotTrimGeometry(afterResult.clip);
          if (!isFinite(after.inPoint) || !isFinite(after.outPoint) || !isFinite(after.start) || !isFinite(after.end) || !isFinite(after.duration)) {
            return __error("Premiere did not provide readable source and timeline times after trim; the result is not verified.");
          }

          var actualIn = after.inPoint;
          var actualOut = after.outPoint;

          var drift = [];
          ${args.new_in_seconds !== undefined ? `
          if (Math.abs(actualIn - ${args.new_in_seconds}) > tolerance) {
            drift.push("inPoint requested ${args.new_in_seconds}s, read back " + actualIn + "s");
          }` : ""}
          ${args.new_out_seconds !== undefined ? `
          if (Math.abs(actualOut - ${args.new_out_seconds}) > tolerance) {
            drift.push("outPoint requested ${args.new_out_seconds}s, read back " + actualOut + "s");
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

          if (drift.length) {
            return __error("Premiere did not apply a verified timeline trim: " + drift.join("; ") + ". The source metadata may have changed, but this is not reported as success. Structural clip edits are known to no-op on some Premiere Pro 26.x installations.");
          }

          var afterKeyframes = __findOutOfRangeKeyframes(afterResult.clip, after.end - after.start);
          if (afterKeyframes.errors.length && "${keyframePolicy}" === "reject") {
            return __error("The timeline trim may have applied, but keyframes could not be fully read back (" + afterKeyframes.errors.join("; ") + "). It is not reported as verified; inspect the clip or use Undo.");
          }
          if (afterKeyframes.outside.length && "${keyframePolicy}" === "reject") {
            return __error("The timeline trim may have applied, but " + afterKeyframes.outside.length + " effect keyframe(s) remain outside its visible range. It is not reported as verified; inspect the clip or use Undo.");
          }

          return __result({
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

          try {
            track.razor(cutTicks.toString());
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
      description: "Duplicate a clip on the timeline (copy to same position on next available track)",
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
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var seq = app.project.activeSequence;
          var projectItem = clip.projectItem;
          
          if (!projectItem) return __error("Cannot find source project item for clip");
          
          var newTrackIndex = result.trackIndex + 1;
          var startTicks = clip.start.ticks;
          
          seq.insertClip(projectItem, startTicks, newTrackIndex, newTrackIndex);
          
          return __result({ duplicated: true, clipName: clip.name, newTrackIndex: newTrackIndex });
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
          
          result.clip.setDisabled(${args.enabled ? "false" : "true"});
          return __result({ clipName: result.clip.name, enabled: ${args.enabled} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_properties: {
      description:
        "Set supported clip properties (opacity, scale, position, rotation). Clip speed is unsupported and fails before mutation.",
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
            description: "Unsupported by Premiere's public scripting APIs. Supplying this returns an actionable error without mutating the clip.",
          },
          scale: {
            type: "number",
            description: "Scale percentage (100 = original size)",
          },
          position_x: {
            type: "number",
            description: "Horizontal position",
          },
          position_y: {
            type: "number",
            description: "Vertical position",
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
              "Changing a timeline clip's speed is not exposed by Premiere's supported ExtendScript or UXP APIs. No mutation was attempted. Use Premiere's Speed/Duration UI or pre-render retimed media before import.",
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
          
          ${args.scale !== undefined || args.position_x !== undefined || args.position_y !== undefined || args.rotation !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Motion" || comp.displayName === "Motion") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.scale !== undefined ? `
                if (prop.displayName === "Scale") {
                  prop.setValue(${args.scale}, true);
                  changes.scale = ${args.scale};
                }` : ""}
                ${args.position_x !== undefined || args.position_y !== undefined ? `
                if (prop.displayName === "Position") {
                  var posVal = prop.getValue();
                  var px = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[0] : 0;
                  var py = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[1] : 0;
                  ${args.position_x !== undefined ? `px = ${args.position_x}; changes.position_x = ${args.position_x};` : ""}
                  ${args.position_y !== undefined ? `py = ${args.position_y}; changes.position_y = ${args.position_y};` : ""}
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
      description: "Replace a clip on the timeline with a different project item, preserving position and duration",
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
          
          var clip = result.clip;
          var oldName = clip.name;
          var startTicks = clip.start.ticks;
          var trackIndex = result.trackIndex;
          var trackType = result.trackType;
          
          // Remove old clip
          clip.remove(false, false);
          
          // Insert new clip at same position
          if (trackType === "video") {
            seq.insertClip(newItem, startTicks, trackIndex, trackIndex);
          } else {
            seq.insertClip(newItem, startTicks, 0, trackIndex);
          }
          
          return __result({
            replaced: true,
            oldClip: oldName,
            newClip: newItem.name,
            trackIndex: trackIndex,
            trackType: trackType
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    speed_change: {
      description:
        "Unavailable: Premiere does not expose a supported scripting API for changing a timeline clip's speed.",
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
            "Changing a timeline clip's speed is not exposed by Premiere's supported ExtendScript or UXP APIs. No mutation was attempted. Use Premiere's Speed/Duration UI or pre-render retimed media before import.",
        };
      },
    },
  };
}
