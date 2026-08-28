import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getAdvancedTools(bridgeOptions: BridgeOptions) {
  return {
    ripple_delete: {
      description:
        "Ripple delete a clip (removes clip and closes the gap). Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to ripple delete",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");
          
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");

          var deletedNodeId = result.clip.nodeId;
          var deletedName = result.clip.name;
          qeClip.rippleDelete();
          if (__findClip(deletedNodeId)) {
            return __error("Premiere reported rippleDelete but the clip is still present. Structural QE edits are known to no-op on some Premiere Pro 26.3 installations; rebuild the keep-segments into a new sequence as a workaround.");
          }
          return __result({ rippleDeleted: true, verified: true, clipName: deletedName });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    roll_edit: {
      description:
        "Perform a verified roll edit at the outgoing cut of a clip using the public timeline DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = roll right, negative = roll left)",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var track = result.trackType === "video"
            ? app.project.activeSequence.videoTracks[result.trackIndex]
            : app.project.activeSequence.audioTracks[result.trackIndex];
          var outgoing = track.clips[result.clipIndex + 1];
          if (!outgoing) return __error("A roll edit requires the selected clip to have an outgoing adjacent clip on the same track.");
          var beforeStart = String(result.clip.start.ticks);
          var beforeEnd = String(result.clip.end.ticks);
          if (String(outgoing.start.ticks) !== beforeEnd) return __error("A roll edit requires two contiguous clips with no gap at the outgoing cut.");
          var newCutTicks = parseFloat(beforeEnd) + __secondsToTicks(${args.offset_seconds});
          if (newCutTicks <= parseFloat(result.clip.start.ticks) || newCutTicks >= parseFloat(outgoing.end.ticks)) {
            return __error("The requested roll offset would create a zero- or negative-duration clip.");
          }
          var newCut = new Time();
          newCut.ticks = String(Math.round(newCutTicks));
          result.clip.end = newCut;
          outgoing.start = newCut;
          var after = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!after) return __error("Clip could not be found after the roll edit");
          if (String(after.clip.start.ticks) === beforeStart && String(after.clip.end.ticks) === beforeEnd) {
            return __error("The roll edit returned without an observable timeline change; no successful edit is reported.");
          }
          if (String(after.clip.end.ticks) !== String(outgoing.start.ticks)) return __error("The roll edit left a gap or overlap at the edited cut.");
          return __result({
            rolled: true,
            verified: true,
            clipName: after.clip.name,
            offsetSeconds: ${args.offset_seconds},
            before: { startTicks: beforeStart, endTicks: beforeEnd },
            after: { startTicks: String(after.clip.start.ticks), endTicks: String(after.clip.end.ticks) }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    slide_edit: {
      description:
        "Perform a verified slide edit on a clip using adjacent clips from the public timeline DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = slide right, negative = slide left)",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var track = result.trackType === "video"
            ? app.project.activeSequence.videoTracks[result.trackIndex]
            : app.project.activeSequence.audioTracks[result.trackIndex];
          var previous = track.clips[result.clipIndex - 1];
          var following = track.clips[result.clipIndex + 1];
          if (!previous || !following) return __error("A slide edit requires contiguous clips before and after the selected clip on the same track.");
          var beforeStart = String(result.clip.start.ticks);
          var beforeEnd = String(result.clip.end.ticks);
          if (String(previous.end.ticks) !== beforeStart || String(following.start.ticks) !== beforeEnd) {
            return __error("A slide edit requires no gaps at either adjacent cut.");
          }
          var deltaTicks = __secondsToTicks(${args.offset_seconds});
          var newStartTicks = parseFloat(beforeStart) + deltaTicks;
          var newEndTicks = parseFloat(beforeEnd) + deltaTicks;
          if (newStartTicks <= parseFloat(previous.start.ticks) || newEndTicks >= parseFloat(following.end.ticks)) {
            return __error("The requested slide offset would create a zero- or negative-duration adjacent clip.");
          }
          var newStart = new Time();
          newStart.ticks = String(Math.round(newStartTicks));
          var newEnd = new Time();
          newEnd.ticks = String(Math.round(newEndTicks));
          previous.end = newStart;
          result.clip.start = newStart;
          result.clip.end = newEnd;
          following.start = newEnd;
          var after = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!after) return __error("Clip could not be found after the slide edit");
          if (String(after.clip.start.ticks) === beforeStart && String(after.clip.end.ticks) === beforeEnd) {
            return __error("The slide edit returned without an observable timeline change; no successful edit is reported.");
          }
          if (String(previous.end.ticks) !== String(after.clip.start.ticks) || String(after.clip.end.ticks) !== String(following.start.ticks)) {
            return __error("The slide edit left a gap or overlap at an adjacent cut.");
          }
          return __result({
            slid: true,
            verified: true,
            clipName: after.clip.name,
            offsetSeconds: ${args.offset_seconds},
            before: { startTicks: beforeStart, endTicks: beforeEnd },
            after: { startTicks: String(after.clip.start.ticks), endTicks: String(after.clip.end.ticks) }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    slip_edit: {
      description:
        "Perform a verified slip edit on a clip using public source in/out properties.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = slip forward in source, negative = slip backward)",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var beforeStart = String(result.clip.start.ticks);
          var beforeEnd = String(result.clip.end.ticks);
          var beforeIn = String(result.clip.inPoint.ticks);
          var beforeOut = String(result.clip.outPoint.ticks);
          var deltaTicks = __secondsToTicks(${args.offset_seconds});
          var newInTicks = parseFloat(beforeIn) + deltaTicks;
          var newOutTicks = parseFloat(beforeOut) + deltaTicks;
          if (newInTicks < 0 || newOutTicks <= newInTicks) return __error("The requested slip offset would create an invalid source range.");
          var newIn = new Time();
          newIn.ticks = String(Math.round(newInTicks));
          var newOut = new Time();
          newOut.ticks = String(Math.round(newOutTicks));
          result.clip.inPoint = newIn;
          result.clip.outPoint = newOut;
          var after = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!after) return __error("Clip could not be found after the slip edit");
          if (String(after.clip.start.ticks) !== beforeStart || String(after.clip.end.ticks) !== beforeEnd) {
            return __error("The slip edit changed the timeline placement instead of only source in/out points.");
          }
          if (String(after.clip.inPoint.ticks) === beforeIn && String(after.clip.outPoint.ticks) === beforeOut) {
            return __error("The slip edit returned without an observable source in/out change; no successful edit is reported.");
          }
          return __result({
            slipped: true,
            verified: true,
            clipName: after.clip.name,
            offsetSeconds: ${args.offset_seconds},
            before: { inTicks: beforeIn, outTicks: beforeOut },
            after: { inTicks: String(after.clip.inPoint.ticks), outTicks: String(after.clip.outPoint.ticks) }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_clip_to_track: {
      description: "Move a clip to a different track. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          target_track_index: {
            type: "number",
            description: "Target track index (0-based)",
          },
        },
        required: ["node_id", "target_track_index"],
      },
      handler: async (args: {
        node_id: string;
        target_track_index: number;
      }) => {
        const nodeId = escapeForExtendScript(args.node_id);
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");

          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");

          var seq = app.project.activeSequence;
          var targetTracks = result.trackType === "video" ? seq.videoTracks : seq.audioTracks;
          if (${args.target_track_index} >= targetTracks.numTracks) {
            return __error("Target track index ${args.target_track_index} is out of range: the sequence has " + targetTracks.numTracks + " " + result.trackType + " track(s).");
          }
          if (result.trackIndex === ${args.target_track_index}) {
            return __result({ moved: false, verified: true, alreadyOnTrack: true, clipName: result.clip.name, trackIndex: result.trackIndex });
          }

          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");

          // QE item indices count gaps ("Empty" items) alongside clips, so the
          // DOM clip index does not map onto getItemAt -- on a track with a
          // leading gap it returns the gap, and calling moveToTrack on that
          // fails with a misleading parameter error. Match on start time.
          var qeClip = null;
          var wantStart = parseFloat(result.clip.start.ticks);
          for (var qi = 0; qi < qeTrack.numItems; qi++) {
            var cand = qeTrack.getItemAt(qi);
            if (!cand || String(cand.type) !== "Clip") continue;
            if (Math.abs(parseFloat(cand.start.ticks) - wantStart) < 1) { qeClip = cand; break; }
          }
          if (!qeClip) return __error("Could not locate the clip among the QE track's items; cannot change track.");

          try {
            qeClip.moveToTrack(${args.target_track_index});
          } catch (moveErr) {
            return __error("Could not move the clip to track ${args.target_track_index}: the QE moveToTrack API rejected the call (" + moveErr.toString() + "). It takes three parameters whose types are undocumented, and no combination tried was accepted on Premiere Pro 26.2.2. The clip was left untouched. Reconstructing the move with Track.overwriteClip would mint a new node ID and drop applied effects and keyframes, so it is not done automatically -- move the clip manually if you need it on another track.");
          }

          // QE reports nothing useful on success, so confirm against the DOM.
          var after = __findClip("${nodeId}");
          if (!after) return __error("Clip ${nodeId} could not be found after the track move; the timeline may be in an unexpected state.");
          if (after.trackIndex !== ${args.target_track_index}) {
            return __error("Premiere accepted the moveToTrack call but the clip is still on track " + after.trackIndex + " rather than ${args.target_track_index}. Structural QE edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }

          return __result({
            moved: true,
            verified: true,
            clipName: after.clip.name,
            newTrackIndex: after.trackIndex
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_all_effects: {
      description: "Remove ALL effects from a clip. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.removeEffects();
          return __result({ removed: true, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_speed_qe: {
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
            description:
              "Speed as percentage (100 = normal, 200 = 2x, 50 = half speed)",
          },
          reverse: {
            type: "boolean",
            description: "Reverse playback direction (default: false)",
          },
        },
        required: ["node_id", "speed_percent"],
      },
      handler: async (args: {
        node_id: string;
        speed_percent: number;
        reverse?: boolean;
      }) => {
        void args;
        return {
          success: false,
          error:
            "Changing a timeline clip's speed is not exposed by Premiere's supported ExtendScript or UXP APIs. No mutation was attempted. Use Premiere's Speed/Duration UI or pre-render retimed media before import.",
        };
      },
    },

    reverse_clip: {
      description:
        "Unavailable: Premiere does not expose a supported scripting API for reversing a timeline clip's playback direction.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          reverse: {
            type: "boolean",
            description: "True to reverse, false for normal (default: true)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; reverse?: boolean }) => {
        void args;
        return {
          success: false,
          error:
            "Reversing a timeline clip is not exposed by Premiere's supported ExtendScript or UXP APIs. No mutation was attempted. Use Premiere's Speed/Duration UI or pre-render retimed media before import.",
        };
      },
    },

    set_frame_blend: {
      description: "Enable or disable frame blending on a clip. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "True to enable frame blending, false to disable",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setFrameBlend(${args.enabled});
          return __result({ frameBlend: ${args.enabled}, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_time_interpolation: {
      description:
        "Set time interpolation type for a clip (Frame Sampling, Frame Blending, Optical Flow). Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          interpolation_type: {
            type: "number",
            description:
              "0 = Frame Sampling, 1 = Frame Blending, 2 = Optical Flow",
          },
        },
        required: ["node_id", "interpolation_type"],
      },
      handler: async (args: {
        node_id: string;
        interpolation_type: number;
      }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setTimeInterpolationType(${args.interpolation_type});
          var typeNames = ["Frame Sampling", "Frame Blending", "Optical Flow"];
          return __result({
            set: true,
            clipName: result.clip.name,
            interpolationType: typeNames[${args.interpolation_type}] || "Unknown"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_clip: {
      description: "Rename a clip on the timeline. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          new_name: {
            type: "string",
            description: "New name for the clip",
          },
        },
        required: ["node_id", "new_name"],
      },
      handler: async (args: { node_id: string; new_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          var oldName = result.clip.name;
          qeClip.setName("${escapeForExtendScript(args.new_name)}");
          return __result({ renamed: true, oldName: oldName, newName: "${escapeForExtendScript(args.new_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_speed: {
      description: "Get the playback speed and reverse state of a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var speed = 1;
          var reversed = false;
          try { speed = clip.getSpeed(); } catch(e) {}
          try { reversed = clip.isSpeedReversed() == 1; } catch(e) {}
          
          return __result({
            clipName: clip.name,
            speed: speed,
            reversed: reversed
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_selection: {
      description: "Select or deselect a clip in the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          selected: {
            type: "boolean",
            description: "True to select, false to deselect",
          },
        },
        required: ["node_id", "selected"],
      },
      handler: async (args: { node_id: string; selected: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          result.clip.setSelected(${args.selected ? 1 : 0}, true);
          return __result({ selected: ${args.selected}, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    link_selection: {
      description:
        "Link the currently selected video and audio clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.linkSelection();
          return __result({ linked: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unlink_selection: {
      description:
        "Unlink the currently selected video and audio clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.unlinkSelection();
          return __result({ unlinked: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    overwrite_clip: {
      description:
        "Overwrite a project item onto validated timeline tracks and verify a new source placement at the requested time",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to add",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline (default: 0)",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index (0-based, default: 0)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        start_seconds?: number;
        track_index?: number;
        audio_track_index?: number;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const trackIndex = args.track_index ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;
        if (!Number.isFinite(startSeconds) || startSeconds < 0) {
          return { success: false, error: "start_seconds must be a non-negative finite number" };
        }
        if (!Number.isSafeInteger(trackIndex) || trackIndex < 0) {
          return { success: false, error: "track_index must be a non-negative integer" };
        }
        if (!Number.isSafeInteger(audioTrackIndex) || audioTrackIndex < 0) {
          return { success: false, error: "audio_track_index must be a non-negative integer" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          if (${trackIndex} >= seq.videoTracks.numTracks) {
            return __error("Video track index ${trackIndex} is out of range: the sequence has " + seq.videoTracks.numTracks + " video track(s).");
          }
          if (${audioTrackIndex} >= seq.audioTracks.numTracks) {
            return __error("Audio track index ${audioTrackIndex} is out of range: the sequence has " + seq.audioTracks.numTracks + " audio track(s).");
          }
          if (typeof seq.overwriteClip !== "function") {
            return __error("Sequence.overwriteClip is unavailable on this Premiere build.");
          }

          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");

          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var wantedItemId = String(item.nodeId);
          var wantedStartTicks = parseFloat(startTicks);
          var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;

          function __isPlacedOn(track) {
            for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
              var clip = track.clips[clipIndex];
              var sourceId = "";
              try { sourceId = clip.projectItem ? String(clip.projectItem.nodeId) : ""; } catch (sourceError) {}
              if (sourceId !== wantedItemId) continue;
              var actualStartTicks = NaN;
              try { actualStartTicks = parseFloat(clip.start.ticks); } catch (startError) {}
              if (!isNaN(actualStartTicks) && Math.abs(actualStartTicks - wantedStartTicks) <= frameTicks) return true;
            }
            return false;
          }

          var videoWasPlaced = __isPlacedOn(seq.videoTracks[${trackIndex}]);
          var audioWasPlaced = __isPlacedOn(seq.audioTracks[${audioTrackIndex}]);
          try {
            seq.overwriteClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});
          } catch (overwriteError) {
            return __error("Sequence.overwriteClip failed: " + overwriteError.toString());
          }

          // The call can return without adding anything on Premiere 26.x. Read
          // the target tracks back by source node ID and frame-snapped position
          // instead of trusting the method's return value or a clip-count delta.
          var videoPlaced = __isPlacedOn(seq.videoTracks[${trackIndex}]);
          var audioPlaced = __isPlacedOn(seq.audioTracks[${audioTrackIndex}]);
          if (!videoPlaced && !audioPlaced) {
            return __error("overwrite_clip did not place project item " + item.name + " on either requested track at ${startSeconds}s. Premiere reported no verifiable timeline change.");
          }
          if ((videoPlaced && videoWasPlaced) && (audioPlaced && audioWasPlaced)) {
            return __error("overwrite_clip produced no verifiable new placement: project item " + item.name + " was already present at ${startSeconds}s on the requested track(s).");
          }

          return __result({
            overwritten: true,
            verified: true,
            item: item.name,
            trackIndex: ${trackIndex},
            audioTrackIndex: ${audioTrackIndex},
            startSeconds: ${startSeconds},
            placedOnVideoTrack: videoPlaced,
            placedOnAudioTrack: audioPlaced
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_clips: {
      description:
        "Create a new sequence by automatically placing project items in order",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          item_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of project item names or node IDs to include in order",
          },
        },
        required: ["name", "item_ids"],
      },
      handler: async (args: { name: string; item_ids: string[] }) => {
        const itemLookups = args.item_ids
          .map(
            (id, i) =>
              `var item${i} = __findProjectItem("${escapeForExtendScript(id)}"); if (!item${i}) return __error("Item not found: ${escapeForExtendScript(id)}"); items.push(item${i});`,
          )
          .join("\n          ");

        const script = buildToolScript(`
          var items = [];
          ${itemLookups}
          
          var seq = app.project.createNewSequenceFromClips("${escapeForExtendScript(args.name)}", items);
          if (!seq) return __error("Failed to create sequence from clips");
          return __result({ created: true, name: seq.name, id: seq.sequenceID, clipCount: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_sequence: {
      description: "Close a sequence tab in the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var name = seq.name;
          var sequenceId = String(seq.sequenceID);
          seq.close();
          return __result({
            timelineTabCloseRequested: true,
            sequenceRetainedInProject: !!__findSequence(sequenceId),
            name: name,
            sequenceId: sequenceId,
            note: "Closing a sequence closes its timeline tab; it does not delete the sequence from the project."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_as_project: {
      description:
        "Export a sequence as a standalone Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
          output_path: {
            type: "string",
            description: "Full path for the exported .prproj file",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { sequence_id?: string; output_path: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          seq.exportAsProject("${escapeForExtendScript(args.output_path)}");
          return __result({ exported: true, path: "${escapeForExtendScript(args.output_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_zero_point: {
      description: "Set the starting timecode (zero point) of a sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds for the timecode origin",
          },
        },
        required: ["start_seconds"],
      },
      handler: async (args: {
        sequence_id?: string;
        start_seconds: number;
      }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var ticks = __secondsToTicks(${args.start_seconds}).toString();
          seq.setZeroPoint(ticks);
          return __result({ set: true, startSeconds: ${args.start_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    scene_edit_detection: {
      description:
        "Perform scene edit detection on the selected clips in the active sequence. Defaults to creating markers rather than cutting.",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["CreateMarkers", "ApplyCuts"],
            description: "Create markers (default) or apply cuts to the selected clips",
          },
          apply_cuts_to_linked_audio: {
            type: "boolean",
            description: "When applying cuts, also cut linked audio (default: false)",
          },
          sensitivity: {
            type: "string",
            enum: ["LowSensitivity", "MediumSensitivity", "HighSensitivity"],
            description: "Scene-detection sensitivity (default: MediumSensitivity)",
          },
        },
      },
      handler: async (args: {
        action?: "CreateMarkers" | "ApplyCuts";
        apply_cuts_to_linked_audio?: boolean;
        sensitivity?: "LowSensitivity" | "MediumSensitivity" | "HighSensitivity";
      }) => {
        const action = args.action ?? "CreateMarkers";
        const applyCutsToLinkedAudio = args.apply_cuts_to_linked_audio === true;
        const sensitivity = args.sensitivity ?? "MediumSensitivity";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var selected = seq.getSelection();
          if (!selected || selected.length === 0) return __error("Select at least one clip before scene edit detection.");
          var detected = seq.performSceneEditDetectionOnSelection(
            "${action}",
            ${applyCutsToLinkedAudio},
            "${sensitivity}"
          );
          if (!detected) return __error("Premiere did not complete scene edit detection for the selected clips.");
          return __result({
            sceneDetection: true,
            selectedClipCount: selected.length,
            action: "${action}",
            applyCutsToLinkedAudio: ${applyCutsToLinkedAudio},
            sensitivity: "${sensitivity}"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_preview_files: {
      description:
        "Delete all preview/render cache files for the project. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          media_type: {
            type: "string",
            description:
              "Type of preview files to delete: 'video', 'audio', or 'all' (default: 'all')",
          },
        },
      },
      handler: async (args: { media_type?: string }) => {
        const typeMap: Record<string, string> = {
          video: '"228CDA18-3625-4d2d-951E-348879E4ED93"',
          audio: '"80B8E3D5-6DCA-4195-AEFB-CB5F407AB009"',
          all: '"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"',
        };
        const mediaType = typeMap[args.media_type || "all"] || typeMap.all;

        const script = buildToolScript(`
          app.enableQE();
          qe.project.deletePreviewFiles(${mediaType});
          return __result({ deleted: true, mediaType: "${args.media_type || "all"}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_tracks: {
      description:
        "Add video and/or audio tracks through QE and verify the active sequence gained the exact requested counts",
      parameters: {
        type: "object" as const,
        properties: {
          video_tracks: {
            type: "number",
            description: "Number of video tracks to add (default: 0)",
          },
          audio_tracks: {
            type: "number",
            description:
              "Number of standard stereo audio tracks to add (default: 0)",
          },
          audio_mono_tracks: {
            type: "number",
            description: "Number of mono audio tracks to add (default: 0)",
          },
          audio_51_tracks: {
            type: "number",
            description: "Number of 5.1 audio tracks to add (default: 0)",
          },
        },
      },
      handler: async (args: {
        video_tracks?: number;
        audio_tracks?: number;
        audio_mono_tracks?: number;
        audio_51_tracks?: number;
      }) => {
        const v = args.video_tracks ?? 0;
        const a = args.audio_tracks ?? 0;
        const aMono = args.audio_mono_tracks ?? 0;
        const a51 = args.audio_51_tracks ?? 0;
        const requested = [
          ["video_tracks", v],
          ["audio_tracks", a],
          ["audio_mono_tracks", aMono],
          ["audio_51_tracks", a51],
        ] as const;
        for (const [name, value] of requested) {
          if (!Number.isSafeInteger(value) || value < 0) {
            return { success: false, error: `${name} must be a non-negative integer` };
          }
        }
        if (v + a + aMono + a51 === 0) {
          return { success: false, error: "Request at least one video or audio track" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var beforeVideo = seq.videoTracks.numTracks;
          var beforeAudio = seq.audioTracks.numTracks;
          var expectedVideo = beforeVideo + ${v};
          var expectedAudio = beforeAudio + ${a + aMono + a51};

          if (typeof app.enableQE !== "function") return __error("QE is unavailable on this Premiere build; cannot add tracks.");
          app.enableQE();
          if (typeof qe === "undefined" || !qe.project || typeof qe.project.getActiveSequence !== "function") {
            return __error("QE active-sequence access is unavailable on this Premiere build; cannot add tracks.");
          }
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          if (typeof qeSeq.addTracks !== "function") return __error("QE addTracks is unavailable on this Premiere build.");

          try {
            qeSeq.addTracks(${v}, ${a}, ${aMono}, ${a51});
          } catch (addTracksError) {
            return __error("QE addTracks failed: " + addTracksError.toString());
          }

          var afterVideo = seq.videoTracks.numTracks;
          var afterAudio = seq.audioTracks.numTracks;
          if (afterVideo !== expectedVideo || afterAudio !== expectedAudio) {
            return __error("QE addTracks did not add the requested tracks: video " + beforeVideo + " -> " + afterVideo + " (expected " + expectedVideo + "), audio " + beforeAudio + " -> " + afterAudio + " (expected " + expectedAudio + ").");
          }

          return __result({
            added: true,
            verified: true,
            videoTracks: ${v},
            audioTracks: ${a},
            audioMonoTracks: ${aMono},
            audio51Tracks: ${a51},
            totalVideoTracks: afterVideo,
            totalAudioTracks: afterAudio
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_color_value: {
      description:
        "Set a color value on an effect property (e.g., tint color, fill color)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          component_name: {
            type: "string",
            description: "Name of the component/effect",
          },
          property_name: {
            type: "string",
            description: "Name of the color property",
          },
          alpha: {
            type: "number",
            description: "Alpha (0-255)",
          },
          red: {
            type: "number",
            description: "Red (0-255)",
          },
          green: {
            type: "number",
            description: "Green (0-255)",
          },
          blue: {
            type: "number",
            description: "Blue (0-255)",
          },
        },
        required: [
          "node_id",
          "component_name",
          "property_name",
          "alpha",
          "red",
          "green",
          "blue",
        ],
      },
      handler: async (args: {
        node_id: string;
        component_name: string;
        property_name: string;
        alpha: number;
        red: number;
        green: number;
        blue: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var components = clip.components;
          var targetComp = null;
          for (var i = 0; i < components.numItems; i++) {
            if (components[i].displayName === "${escapeForExtendScript(args.component_name)}") {
              targetComp = components[i];
              break;
            }
          }
          if (!targetComp) return __error("Component not found");
          
          var targetProp = null;
          for (var j = 0; j < targetComp.properties.numItems; j++) {
            if (targetComp.properties[j].displayName === "${escapeForExtendScript(args.property_name)}") {
              targetProp = targetComp.properties[j];
              break;
            }
          }
          if (!targetProp) return __error("Property not found");
          
          targetProp.setColorValue(${args.alpha}, ${args.red}, ${args.green}, ${args.blue}, true);
          return __result({
            set: true,
            color: { alpha: ${args.alpha}, red: ${args.red}, green: ${args.green}, blue: ${args.blue} }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_adjustment_layer: {
      description: "Check if a clip is an adjustment layer",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var isAdj = false;
          try { isAdj = clip.isAdjustmentLayer(); } catch(e) {}
          
          return __result({ clipName: clip.name, isAdjustmentLayer: isAdj });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_linked_items: {
      description:
        "Get all clips in the sequence that are linked to the same source as a given clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var linked = result.clip.getLinkedItems();
          var items = [];
          if (linked) {
            for (var i = 0; i < linked.numItems; i++) {
              items.push({
                name: linked[i].name,
                nodeId: linked[i].nodeId,
                startSeconds: __ticksToSeconds(linked[i].start.ticks)
              });
            }
          }
          
          return __result({ clipName: result.clip.name, linkedItems: items, count: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_mogrt_component: {
      description:
        "Get MOGRT (Motion Graphics Template) component parameters from a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the MOGRT clip on the timeline",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var mgtComp = result.clip.getMGTComponent();
          if (!mgtComp) return __error("Not a MOGRT clip or no MGT component found");
          
          var params = [];
          for (var i = 0; i < mgtComp.properties.numItems; i++) {
            var p = mgtComp.properties[i];
            params.push({
              displayName: p.displayName,
              value: p.getValue()
            });
          }
          
          return __result({ clipName: result.clip.name, parameters: params });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
