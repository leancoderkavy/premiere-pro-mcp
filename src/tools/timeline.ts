import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTimelineTools(bridgeOptions: BridgeOptions) {
  return {
    add_to_timeline: {
      description: "Add a project item (clip) to the timeline at a specific position",
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

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          seq.insertClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});
          
          return __result({
            added: true,
            item: item.name,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds}
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
      description: "Trim a clip's in or out point",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to trim",
          },
          new_in_seconds: {
            type: "number",
            description: "New in-point in seconds (relative to clip's source media)",
          },
          new_out_seconds: {
            type: "number",
            description: "New out-point in seconds (relative to clip's source media)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; new_in_seconds?: number; new_out_seconds?: number }) => {
        // Both edit points are optional in the schema, so a call carrying only
        // node_id would previously set nothing and still report trimmed: true.
        if (args.new_in_seconds === undefined && args.new_out_seconds === undefined) {
          return {
            success: false,
            error:
              "trim_clip requires new_in_seconds, new_out_seconds, or both — a call with neither would report success without changing the clip.",
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

          ${args.new_in_seconds !== undefined ? `clip.inPoint = __secondsToTicks(${args.new_in_seconds}).toString();` : ""}
          ${args.new_out_seconds !== undefined ? `clip.outPoint = __secondsToTicks(${args.new_out_seconds}).toString();` : ""}

          var actualIn = __ticksToSeconds(clip.inPoint.ticks);
          var actualOut = __ticksToSeconds(clip.outPoint.ticks);

          var drift = [];
          ${args.new_in_seconds !== undefined ? `
          if (Math.abs(actualIn - ${args.new_in_seconds}) > tolerance) {
            drift.push("inPoint requested ${args.new_in_seconds}s, read back " + actualIn + "s");
          }` : ""}
          ${args.new_out_seconds !== undefined ? `
          if (Math.abs(actualOut - ${args.new_out_seconds}) > tolerance) {
            drift.push("outPoint requested ${args.new_out_seconds}s, read back " + actualOut + "s");
          }` : ""}

          if (drift.length) {
            return __error("Premiere did not apply the requested trim: " + drift.join("; ") + ". Structural clip edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }

          return __result({
            trimmed: true,
            verified: true,
            clipName: clip.name,
            inPoint: actualIn,
            outPoint: actualOut
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    split_clip: {
      description: "Split (razor) a clip at a specific time position. Requires QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds where to split",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
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
        const trackType = args.track_type || "video";
        const trackIndex = args.track_index ?? 0;

        const script = buildToolScript(`
          app.enableQE();
          var seq = qe.project.getActiveSequence();
          if (!seq) return __error("No active sequence (QE)");
          
          var track = ${trackType === "video" ? `seq.getVideoTrackAt(${trackIndex})` : `seq.getAudioTrackAt(${trackIndex})`};
          if (!track) return __error("Track not found");

          var domTrack = ${trackType === "video" ? `app.project.activeSequence.videoTracks[${trackIndex}]` : `app.project.activeSequence.audioTracks[${trackIndex}]`};
          var clipCountBefore = domTrack.clips.numItems;
          var timeTicks = __secondsToTicks(${args.time_seconds}).toString();
          track.razor(timeTicks);

          var clipCountAfter = domTrack.clips.numItems;
          if (clipCountAfter <= clipCountBefore) {
            return __error("Premiere reported razor but the track clip count did not change. Structural QE edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }
          return __result({ split: true, verified: true, atSeconds: ${args.time_seconds}, trackIndex: ${trackIndex}, trackType: "${trackType}" });
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
      description: "Set properties on a clip (opacity, speed, etc.)",
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
            description: "Playback speed multiplier (1.0 = normal, 2.0 = double speed)",
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
          
          ${args.speed !== undefined ? `
          clip.setSpeed(${args.speed * 100});
          changes.speed = ${args.speed};
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
      description: "Change the playback speed of a clip",
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
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var speed = "${args.speed_percent}";
          ${args.reverse ? 'speed = "-" + speed;' : ""}
          
          clip.setSpeed(speed);
          return __result({ speedChanged: true, clipName: clip.name, speed: ${args.speed_percent}, reverse: ${!!args.reverse} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
