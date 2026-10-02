import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { applyScratchDisks } from "./scratch-disks.js";
import { readScratchDisks } from "./project-file.js";

// Shared set-up for lift/extract: resolve the sequence in/out range, refuse a
// range that spans the whole sequence (Premiere reports cleared marks as
// 0..end), and record what each targeted, unlocked track holds in the range.
// Lift and Extract act only on targeted tracks, so only those are verified.
const IN_OUT_EDIT_PREAMBLE = `
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("QE could not resolve the active sequence");
          var inSeconds = __sequencePointSeconds(seq.getInPoint());
          var outSeconds = __sequencePointSeconds(seq.getOutPoint());
          var seqEndTicks = parseFloat(seq.end);
          var halfFrame = (seq.timebase ? parseFloat(seq.timebase) : TICKS_PER_SECOND / 24) / 2;
          if (inSeconds === null) inSeconds = 0;
          if (outSeconds === null) outSeconds = seqEndTicks / TICKS_PER_SECOND;
          var inTicks = inSeconds * TICKS_PER_SECOND;
          var outTicks = outSeconds * TICKS_PER_SECOND;
          if (outTicks - inTicks < halfFrame) return __error("Set sequence in/out points around the range first (set_sequence_in_out_points). No clips were changed.");
          if (inTicks <= halfFrame && outTicks >= seqEndTicks - halfFrame) {
            return __error("The sequence in/out range spans the whole sequence (no marks set). Set in/out points around the range first; no clips were changed.");
          }
          // Every clip's ID and span, to tell whether a failed edit changed anything.
          var timelineSignature = function () {
            var parts = [];
            var groups = [["V", seq.videoTracks], ["A", seq.audioTracks]];
            for (var g = 0; g < groups.length; g++) {
              for (var t = 0; t < groups[g][1].numTracks; t++) {
                var clips = groups[g][1][t].clips;
                for (var c = 0; c < clips.numItems; c++) parts.push(groups[g][0] + t + ":" + clips[c].nodeId + "@" + clips[c].start.ticks + "-" + clips[c].end.ticks);
              }
            }
            return parts.join(";");
          };
          var measure = function (track) {
            var covered = 0, overlap = 0;
            for (var c = 0; c < track.clips.numItems; c++) {
              var cs = parseFloat(track.clips[c].start.ticks), ce = parseFloat(track.clips[c].end.ticks);
              covered += ce - cs;
              overlap += Math.max(0, Math.min(ce, outTicks) - Math.max(cs, inTicks));
            }
            return { covered: covered, overlap: overlap };
          };
          var targeted = [];
          var anyLocked = false;
          var unreadable = [];
          var survey = function (tracks, kind) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var locked = false;
              try { locked = !!tracks[t].isLocked(); } catch (eLock) {}
              if (locked) { anyLocked = true; continue; }
              var isTarget = null;
              try { isTarget = tracks[t].isTargeted() === true; } catch (eTarget) { isTarget = null; }
              if (isTarget === null) { unreadable.push(kind + (t + 1)); continue; }
              if (!isTarget) continue;
              var m = measure(tracks[t]);
              var after = [];
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var clip = tracks[t].clips[c];
                if (parseFloat(clip.start.ticks) >= outTicks - halfFrame) after.push({ nodeId: String(clip.nodeId), start: parseFloat(clip.start.ticks) });
              }
              targeted.push({ label: kind + (t + 1), track: tracks[t], covered: m.covered, overlap: m.overlap, after: after });
            }
          };
          survey(seq.videoTracks, "V");
          survey(seq.audioTracks, "A");
          if (unreadable.length) return __error("Could not read whether " + unreadable.join(", ") + " are targeted, so the tracks Premiere will edit are unknown. No clips were changed.");
          var rangeHadClips = false;
          for (var tt = 0; tt < targeted.length; tt++) if (targeted[tt].overlap > halfFrame) rangeHadClips = true;
          if (!rangeHadClips) return __error("Nothing to remove: no clips on targeted, unlocked tracks overlap the in/out range (Lift and Extract only edit targeted tracks; see set_target_track). No clips were changed.");
          var signatureBefore = timelineSignature();
          // Per-track signatures, to report tracks Premiere changed besides the
          // targeted ones (live 25.2.3: Extract also closed the range on an
          // untargeted audio track holding the targeted video's linked audio).
          var trackSignatures = function () {
            var out = {};
            var groups = [["V", seq.videoTracks], ["A", seq.audioTracks]];
            for (var g = 0; g < groups.length; g++) {
              for (var t = 0; t < groups[g][1].numTracks; t++) {
                var clips = groups[g][1][t].clips;
                var parts = [];
                for (var c = 0; c < clips.numItems; c++) parts.push(clips[c].nodeId + "@" + clips[c].start.ticks + "-" + clips[c].end.ticks);
                out[groups[g][0] + (t + 1)] = parts.join(";");
              }
            }
            return out;
          };
          var tracksBefore = trackSignatures();
          var otherTracksChanged = function () {
            var now = trackSignatures();
            var changed = [];
            var edited = {};
            for (var e = 0; e < targeted.length; e++) edited[targeted[e].label] = true;
            for (var key in now) if (now.hasOwnProperty(key) && !edited[key] && now[key] !== tracksBefore[key]) changed.push(key);
            return changed;
          };
          // After the edit, each targeted track must hold exactly the range's content less.
          var coverageProblems = function () {
            var problems = [];
            for (var p = 0; p < targeted.length; p++) {
              var now = measure(targeted[p].track).covered;
              var expectedCovered = targeted[p].covered - targeted[p].overlap;
              if (Math.abs(now - expectedCovered) > halfFrame * 2) problems.push(targeted[p].label + " holds " + __ticksToSeconds(String(now)) + "s of clips, expected " + __ticksToSeconds(String(expectedCovered)) + "s");
            }
            return problems;
          };
          var failAfterEdit = function (message, data) {
            var changed = timelineSignature() !== signatureBefore;
            data.timelineChanged = changed;
            return __jsonStringify({ success: false, error: (changed ? "The timeline changed, but " : "Nothing was changed: ") + message, data: data });
          };
`;

const MEDIA_REPORT_DEFAULT_LIMIT = 100;
const MEDIA_REPORT_MAX_LIMIT = 500;
const MEDIA_REPORT_MAX_CONTAINS = 256;

type MediaReportPagingArgs = { offset?: number; limit?: number; contains?: string };
type MediaReportPaging = { offset: number; limit: number; contains: string };

function mediaReportPagingProperties(subject: string) {
  return {
    offset: {
      type: "integer",
      minimum: 0,
      description: `Zero-based index of the first ${subject} entry to return (default 0). Pass the previous response's nextOffset to read the next page.`,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MEDIA_REPORT_MAX_LIMIT,
      description: `Maximum ${subject} entries to return (1-${MEDIA_REPORT_MAX_LIMIT}, default ${MEDIA_REPORT_DEFAULT_LIMIT}).`,
    },
    contains: {
      type: "string",
      maxLength: MEDIA_REPORT_MAX_CONTAINS,
      description: `Optional case-insensitive substring matched against project item names before paging. Omit or pass an empty string to include every entry.`,
    },
  };
}

function parseMediaReportPaging(args: MediaReportPagingArgs | undefined): MediaReportPaging | { error: string } {
  const input = args ?? {};
  const offset = input.offset ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    return { error: "offset must be an integer greater than or equal to 0" };
  }
  const limit = input.limit ?? MEDIA_REPORT_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MEDIA_REPORT_MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MEDIA_REPORT_MAX_LIMIT}` };
  }
  const contains = input.contains ?? "";
  if (typeof contains !== "string" || contains.length > MEDIA_REPORT_MAX_CONTAINS) {
    return { error: `contains must be a string of at most ${MEDIA_REPORT_MAX_CONTAINS} characters` };
  }
  return { offset, limit, contains };
}

export function getUtilityTools(bridgeOptions: BridgeOptions) {
  return {
    delete_project_item: {
      description:
        "Delete a project item (bin, sequence, clip or file) from the project panel and read back that it is gone. " +
        "organize_project_items_uxp with action 'remove' (authenticated UXP bridge) is the preferred, documented route. This CEP fallback deletes a clip or file by moving it into a temporary bin and deleting that bin, which cannot be undone here. " +
        "Deleting media also removes its clips from every sequence, so an item (or a bin whose contents are) used on a timeline is refused unless confirm_remove_from_sequences is true.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to delete",
          },
          confirm_remove_from_sequences: {
            type: "boolean",
            description: "Delete even when the item (or something inside the bin) is used in a sequence, which also removes those timeline clips (default: false).",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; confirm_remove_from_sequences?: boolean }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          if (item === app.project.rootItem) return __error("The project root cannot be deleted");

          var nodeId = String(item.nodeId);
          var name = item.name;
          var sequence = null;
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            var candidate = app.project.sequences[i];
            try {
              if (candidate.projectItem && String(candidate.projectItem.nodeId) === nodeId) {
                sequence = candidate;
                break;
              }
            } catch (e) {}
          }

          var usage = { clips: 0, sequences: [] };
          if (!sequence && (item.type === 1 || item.type === 2 || item.type === 4)) {
            usage = __projectItemUsage(item);
            if (usage.clips > 0 && ${args.confirm_remove_from_sequences === true ? "false" : "true"}) {
              return __error(name + (item.type === 2 ? " holds media used by " : " is used by ") + usage.clips + " timeline clip(s) in " + usage.sequences.join(", ") + ". Deleting it would remove those clips too, and this cannot be undone here, so nothing was deleted. Remove the clips first, or pass confirm_remove_from_sequences: true.");
            }
          }
          if (item.type === 2) {
            item.deleteBin();
          } else if (sequence) {
            var accepted = app.project.deleteSequence(sequence);
            if (accepted === false) return __error("Premiere rejected deletion of sequence: " + name);
          } else if (item.type === 1 || item.type === 4) {
            var removal = __deleteProjectItemViaBin(item);
            if (!removal.ok) return __error(removal.error + (removal.changed ? "" : " Nothing is reported as deleted."));
          } else {
            return __error(
              "Legacy CEP cannot safely delete this project item type through a documented API. " +
              "No deletion was attempted; use organize_project_items_uxp with action 'remove' when the authenticated UXP bridge is connected, or remove it in Premiere's Project panel."
            );
          }

          if (__findProjectItemByNodeId(nodeId)) {
            return __error("Premiere did not remove project item: " + name + ". The deletion is not reported as successful.");
          }
          return __result({ deleted: true, verified: true, name: name, nodeId: nodeId, timelineClipsRemoved: usage.clips, sequencesChanged: usage.sequences });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_multiple_project_items: {
      description:
        "Delete several project items (bins, sequences, clips or files) and read back that each is gone. Every item is checked before any is deleted. " +
        "organize_project_items_uxp with action 'remove' (authenticated UXP bridge) is the preferred, documented route; this CEP fallback deletes clips and files through a temporary bin, which cannot be undone here. " +
        "Items (or bins whose contents are) used on a timeline are refused unless confirm_remove_from_sequences is true.",
      parameters: {
        type: "object" as const,
        properties: {
          item_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of node IDs or names of items to delete",
          },
          confirm_remove_from_sequences: {
            type: "boolean",
            description: "Delete even when an item (or something inside a bin) is used in a sequence, which also removes those timeline clips (default: false).",
          },
        },
        required: ["item_ids"],
      },
      handler: async (args: { item_ids: string[]; confirm_remove_from_sequences?: boolean }) => {
        const idsJson = JSON.stringify(args.item_ids);
        const script = buildToolScript(`
          var ids = ${idsJson};
          var planned = [];
          for (var i = 0; i < ids.length; i++) {
            var item = __findProjectItem(ids[i]);
            if (!item) return __error("Item not found: " + ids[i] + ". No project items were deleted.");
            if (item === app.project.rootItem) return __error("The project root cannot be deleted. No project items were deleted.");
            var sequence = null;
            for (var s = 0; s < app.project.sequences.numSequences; s++) {
              var candidate = app.project.sequences[s];
              try {
                if (candidate.projectItem && String(candidate.projectItem.nodeId) === String(item.nodeId)) {
                  sequence = candidate;
                  break;
                }
              } catch (e) {}
            }
            if (item.type !== 2 && !sequence && item.type !== 1 && item.type !== 4) {
              return __error(
                "Legacy CEP cannot safely delete project item: " + item.name + ". " +
                "No project items were deleted; use organize_project_items_uxp with action 'remove' for generic project-item deletion."
              );
            }
            if (!sequence) {
              var itemUsage = __projectItemUsage(item);
              if (itemUsage.clips > 0 && ${args.confirm_remove_from_sequences === true ? "false" : "true"}) {
                return __error(item.name + (item.type === 2 ? " holds media used by " : " is used by ") + itemUsage.clips + " timeline clip(s) in " + itemUsage.sequences.join(", ") + ". Deleting it would remove those clips too, and this cannot be undone here. No project items were deleted; pass confirm_remove_from_sequences: true to delete anyway.");
              }
            }
            planned.push({ nodeId: String(item.nodeId), name: item.name, item: item, sequence: sequence });
          }
          for (var p = 0; p < planned.length; p++) {
            var target = planned[p];
            // A selected child can already be gone after its selected parent bin is
            // deleted; that still satisfies the requested postcondition.
            if (!__findProjectItem(target.nodeId)) continue;
            if (target.item.type === 2) {
              target.item.deleteBin();
            } else if (target.sequence) {
              var accepted = app.project.deleteSequence(target.sequence);
              if (accepted === false) return __error("Premiere rejected deletion of sequence: " + target.name);
            } else {
              var viaBin = __deleteProjectItemViaBin(target.item);
              if (!viaBin.ok) return __error(viaBin.error + (p || viaBin.changed ? " The project changed: " + p + " item(s) before this one were deleted." : " No project items were deleted."));
            }
          }
          var deleted = [];
          for (var q = 0; q < planned.length; q++) {
            if (__findProjectItem(planned[q].nodeId)) {
              return __error("Premiere did not remove project item: " + planned[q].name + ". The batch is not reported as successful.");
            }
            deleted.push({ nodeId: planned[q].nodeId, name: planned[q].name });
          }
          return __result({ deleted: deleted.length, total: ids.length, items: deleted, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_project_item: {
      description: "Rename a project item in the project panel.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          new_name: {
            type: "string",
            description: "New name for the item",
          },
        },
        required: ["item_id", "new_name"],
      },
      handler: async (args: { item_id: string; new_name: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var oldName = item.name;
          var sequence = null;
          try {
            if (item.isSequence && item.isSequence()) {
              for (var i = 0; i < app.project.sequences.numSequences; i++) {
                var candidate = app.project.sequences[i];
                if (candidate.projectItem && candidate.projectItem.nodeId === item.nodeId) {
                  sequence = candidate;
                  break;
                }
              }
              if (!sequence) return __error("The sequence project item could not be matched to a live sequence; no rename was attempted");
            }
          } catch (e) {
            return __error("Could not inspect the project item before rename: " + e.toString());
          }
          item.name = "${escapeForExtendScript(args.new_name)}";
          if (sequence) sequence.name = "${escapeForExtendScript(args.new_name)}";
          if (item.name !== "${escapeForExtendScript(args.new_name)}" ||
              (sequence && sequence.name !== "${escapeForExtendScript(args.new_name)}")) {
            return __error("Premiere did not apply the requested name to every sequence representation");
          }
          return __result({ oldName: oldName, newName: item.name, sequenceVerified: sequence ? true : undefined });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_adjustment_layer: {
      description:
        "Add an adjustment layer to the active sequence via QE DOM. The layer is added at the playhead position on the specified track.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
        },
      },
      handler: async (args: { track_index?: number }) => {
        const track = args.track_index ?? 0;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active QE sequence");

          // Path 1 (legacy, removed in PPro 2026): qeSeq.addAdjustmentLayer(track)
          try {
            if (qeSeq.addAdjustmentLayer) {
              qeSeq.addAdjustmentLayer(${track});
              return __result({ added: true, trackIndex: ${track}, method: "qeSeq.addAdjustmentLayer" });
            }
          } catch(eLegacy) {}

          // Path 2 (PPro 2026): create a project-level adjustment layer matching
          // the active sequence, then insert into the requested track at the
          // playhead. qe.project.newAdjustmentLayer() returns a QE project item.
          try {
            var adjQE = qe.project.newAdjustmentLayer ? qe.project.newAdjustmentLayer() : null;
            if (adjQE) {
              // Find the matching public ProjectItem to insert.
              var rootChildren = app.project.rootItem.children;
              var adjItem = null;
              for (var c = rootChildren.numItems - 1; c >= 0; c--) {
                var it = rootChildren[c];
                if (it && it.name && it.name.toLowerCase().indexOf("adjustment") !== -1) {
                  adjItem = it;
                  break;
                }
              }
              if (!adjItem) return __error("Adjustment layer item not found in project after creation");

              var qeTrack = qeSeq.getVideoTrackAt(${track});
              if (!qeTrack) return __error("Video track " + ${track} + " not found");

              var playerTicks;
              try { playerTicks = seq.getPlayerPosition().ticks.toString(); }
              catch(eP) { playerTicks = "0"; }

              try {
                qeTrack.insert(adjItem, playerTicks);
              } catch(eIns1) {
                // Older signature: qeTrack.insertClip(item, ticks)
                try { qeTrack.insertClip(adjItem, playerTicks); }
                catch(eIns2) { return __error("Failed to insert adjustment layer: " + eIns2.toString()); }
              }
              return __result({ added: true, trackIndex: ${track}, method: "qe.project.newAdjustmentLayer + insert" });
            }
          } catch(eNew) {
            return __error("Failed to create adjustment layer: " + eNew.toString());
          }

          return __error("No supported adjustment-layer API found in this Premiere version");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    freeze_frame: {
      description:
        "Create a freeze frame from a clip at a specific time. Exports the frame and imports it back as a still image.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description:
              "Time in the sequence to freeze (in seconds). Uses playhead if omitted.",
          },
          output_path: {
            type: "string",
            description:
              "Full path for the exported frame (e.g., /path/to/freeze.png)",
          },
          duration_seconds: {
            type: "number",
            description:
              "Duration of the freeze frame on the timeline (default: 2)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        time_seconds?: number;
        output_path: string;
        duration_seconds?: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${
            args.time_seconds !== undefined
              ? `var timeTicks = __secondsToTicks(${args.time_seconds}).toString();`
              : `var timeTicks = seq.getPlayerPosition().ticks;`
          }

          var res = __exportStillFrame("${escapeForExtendScript(args.output_path)}", timeTicks);
          if (!res.ok) return __error(res.error + " [" + res.notes.join("; ") + "]");

          // Import back
          app.project.importFiles([res.path], false, app.project.rootItem, false);

          return __result({
            exported: true,
            path: res.path,
            method: res.method,
            atSeconds: __ticksToSeconds(timeTicks),
            note: "Frame exported and imported. Add to timeline with add_to_timeline."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_frame_rate: {
      description: "Change the frame rate of the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          frame_rate: {
            type: "number",
            minimum: 1,
            maximum: 240,
            description:
              "New frame rate (e.g., 23.976, 24, 25, 29.97, 30, 50, 59.94, 60)",
          },
        },
        required: ["frame_rate"],
      },
      handler: async (args: { frame_rate: number }) => {
        if (!Number.isFinite(args.frame_rate) || args.frame_rate < 1 || args.frame_rate > 240) {
          return {
            success: false,
            error: "frame_rate must be a finite value between 1 and 240 fps",
          };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          var requestedFps = ${args.frame_rate};
          var requestedTicks = Math.round(TICKS_PER_SECOND / requestedFps);
          var frameDuration = new Time();
          frameDuration.ticks = requestedTicks.toString();
          settings.videoFrameRate = frameDuration;
          seq.setSettings(settings);

          var applied = seq.getSettings();
          if (!applied || !applied.videoFrameRate) {
            return __error("Premiere did not return the updated sequence frame rate");
          }
          var appliedTicks = parseFloat(applied.videoFrameRate.ticks);
          if (!isFinite(appliedTicks) || Math.abs(appliedTicks - requestedTicks) > 1) {
            return __error(
              "Premiere did not apply the requested frame rate: expected " +
              requestedTicks + " ticks/frame, got " + appliedTicks
            );
          }

          return __result({
            frameRate: requestedFps,
            ticksPerFrame: requestedTicks.toString(),
            sequence: seq.name
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_resolution: {
      description: "Change the resolution (frame size) of the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          width: {
            type: "number",
            description: "Width in pixels",
          },
          height: {
            type: "number",
            description: "Height in pixels",
          },
        },
        required: ["width", "height"],
      },
      handler: async (args: { width: number; height: number }) => {
        if (![args.width, args.height].every((v) => Number.isInteger(v) && v >= 16 && v <= 16384)) {
          return { success: false, error: "width and height must be integers from 16 to 16384 pixels" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoFrameWidth = ${args.width};
          settings.videoFrameHeight = ${args.height};
          seq.setSettings(settings);

          var applied = seq.getSettings();
          if (!applied || Number(applied.videoFrameWidth) !== ${args.width} || Number(applied.videoFrameHeight) !== ${args.height}) {
            return __error("Premiere did not apply the requested frame size: got " +
              (applied ? applied.videoFrameWidth + "x" + applied.videoFrameHeight : "no settings"));
          }
          return __result({ width: ${args.width}, height: ${args.height}, sequence: seq.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_audio_settings: {
      description:
        "Change audio settings of the active sequence (sample rate, channel type).",
      parameters: {
        type: "object" as const,
        properties: {
          sample_rate: {
            type: "number",
            description: "Audio sample rate (e.g., 44100, 48000, 96000)",
          },
          channel_type: {
            type: "number",
            description:
              "Channel type: 0=Mono, 1=Stereo, 2=5.1, 3=Multichannel",
          },
        },
      },
      handler: async (args: {
        sample_rate?: number;
        channel_type?: number;
      }) => {
        if (args.sample_rate !== undefined &&
          (!Number.isFinite(args.sample_rate) || args.sample_rate < 1 || args.sample_rate > 768000)) {
          return {
            success: false,
            error: "sample_rate must be a finite value between 1 and 768000 Hz",
          };
        }
        if (args.channel_type !== undefined &&
          (!Number.isInteger(args.channel_type) || args.channel_type < 0 || args.channel_type > 5)) {
          return {
            success: false,
            error: "channel_type must be an integer from 0 to 5",
          };
        }
        if (args.sample_rate === undefined && args.channel_type === undefined) {
          return {
            success: false,
            error: "Provide sample_rate and/or channel_type.",
          };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          ${args.sample_rate !== undefined ? `
          var requestedSampleRate = ${args.sample_rate};
          var requestedTicksPerSample = Math.round(TICKS_PER_SECOND / requestedSampleRate);
          var sampleDuration = new Time();
          sampleDuration.ticks = requestedTicksPerSample.toString();
          settings.audioSampleRate = sampleDuration;` : ""}
          ${args.channel_type !== undefined ? `settings.audioChannelType = ${args.channel_type};` : ""}
          seq.setSettings(settings);

          var applied = seq.getSettings();
          if (!applied) return __error("Premiere did not return updated sequence settings");
          ${args.sample_rate !== undefined ? `
          if (!applied.audioSampleRate) return __error("Premiere did not return the updated audio sample rate");
          var appliedTicksPerSample = parseFloat(applied.audioSampleRate.ticks);
          if (!isFinite(appliedTicksPerSample) || Math.abs(appliedTicksPerSample - requestedTicksPerSample) > 1) {
            return __error(
              "Premiere did not apply the requested audio sample rate: expected " +
              requestedTicksPerSample + " ticks/sample, got " + appliedTicksPerSample
            );
          }` : ""}
          ${args.channel_type !== undefined ? `
          if (applied.audioChannelType !== ${args.channel_type}) {
            return __error("Premiere did not apply the requested audio channel type");
          }` : ""}
          return __result({
            sequence: seq.name,
            ${args.sample_rate !== undefined ? `sampleRate: requestedSampleRate, ticksPerSample: requestedTicksPerSample.toString(),` : ""}
            ${args.channel_type !== undefined ? `channelType: applied.audioChannelType,` : ""}
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_pixel_aspect_ratio: {
      description:
        "Change the pixel aspect ratio of the active sequence, or return a capability error when the legacy host does not expose a writable setting.",
      parameters: {
        type: "object" as const,
        properties: {
          ratio: {
            type: "string",
            description:
              "Pixel aspect ratio string (for example '1.0' for square pixels or '1.4222' for 16:9 DV).",
          },
        },
        required: ["ratio"],
      },
      handler: async (args: { ratio: string }) => {
        if (typeof args.ratio !== "string") {
          return { success: false, error: "ratio must be a positive decimal string such as '1.0' or '1.4222'." };
        }
        const ratio = args.ratio.trim();
        if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(ratio) || Number(ratio) <= 0) {
          return { success: false, error: "ratio must be a positive decimal string such as '1.0' or '1.4222'." };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          var requestedRatio = "${ratio}";
          var currentRatio;
          try {
            currentRatio = settings.videoPixelAspectRatio;
          } catch (eRead) {
            return __error("This Premiere host does not expose a readable sequence pixel-aspect-ratio setting: " + eRead.toString());
          }
          if (typeof currentRatio === "undefined") {
            return __error("This Premiere host does not expose a writable sequence pixel-aspect-ratio setting. No sequence settings were changed.");
          }

          // Hosts format the ratio differently ("1", "1.0", "1:1", "1.42222"), so
          // compare the numeric value instead of the string (#642).
          var parseRatio = function (value) {
            var text = String(value);
            var pair = /^\\s*([0-9]+(?:\\.[0-9]+)?)\\s*[:\\/]\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$/.exec(text);
            if (pair) return Number(pair[2]) > 0 ? Number(pair[1]) / Number(pair[2]) : NaN;
            return parseFloat(text);
          };
          // A request that already matches succeeds even where the setting is read-only.
          var currentText = String(currentRatio);
          var currentValue = parseRatio(currentText);
          if (isFinite(currentValue) && Math.abs(currentValue - parseRatio(requestedRatio)) <= 0.001) {
            return __result({ ratio: requestedRatio, hostRatio: currentText, sequence: seq.name, alreadySet: true, verified: true });
          }

          try {
            settings.videoPixelAspectRatio = requestedRatio;
          } catch (eAssign) {
            return __error("This Premiere host rejected the sequence pixel-aspect-ratio update. No sequence settings were changed: " + eAssign.toString());
          }
          var settingsApplied;
          try {
            settingsApplied = seq.setSettings(settings);
          } catch (eSet) {
            return __error("Premiere could not apply the sequence pixel-aspect-ratio update: " + eSet.toString());
          }
          if (settingsApplied === false) {
            return __error("Premiere rejected the sequence pixel-aspect-ratio update. No sequence settings were changed.");
          }

          var observed;
          try {
            observed = seq.getSettings();
          } catch (eVerify) {
            return __error("Premiere could not read back the sequence pixel-aspect-ratio update: " + eVerify.toString());
          }
          if (!observed) return __error("Premiere did not return sequence settings after the pixel-aspect-ratio update");

          var observedRatio;
          try {
            observedRatio = String(observed.videoPixelAspectRatio);
          } catch (eObserved) {
            return __error("Premiere did not expose the applied sequence pixel-aspect ratio for verification: " + eObserved.toString());
          }
          var requestedValue = parseRatio(requestedRatio);
          var observedValue = parseRatio(observedRatio);
          if (!isFinite(observedValue) || Math.abs(observedValue - requestedValue) > 0.001) {
            return __error("Premiere did not apply the requested sequence pixel aspect ratio " + requestedRatio + "; it reads back as " + observedRatio + ".");
          }

          return __result({ ratio: requestedRatio, observedRatio: observedRatio, sequence: seq.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_field_type: {
      description: "Set the field order of the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          field_type: {
            type: "number",
            description:
              "0=No Fields (Progressive), 1=Upper Field First, 2=Lower Field First",
          },
        },
        required: ["field_type"],
      },
      handler: async (args: { field_type: number }) => {
        if (![0, 1, 2].includes(args.field_type)) {
          return { success: false, error: "field_type must be 0 (progressive), 1 (upper field first) or 2 (lower field first)" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoFieldType = ${args.field_type};
          seq.setSettings(settings);

          var applied = seq.getSettings();
          if (!applied || Number(applied.videoFieldType) !== ${args.field_type}) {
            return __error("Premiere did not apply the requested field type: got " + (applied ? applied.videoFieldType : "no settings"));
          }
          return __result({ fieldType: ${args.field_type}, sequence: seq.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_all_project_paths: {
      description:
        "Get all unique media file paths used in the project. Useful for asset management and archiving.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var paths = {};
          function scan(bin) {
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              try {
                var mp = item.getMediaPath();
                if (mp && !paths[mp]) {
                  paths[mp] = {
                    path: mp,
                    name: item.name,
                    nodeId: item.nodeId,
                    offline: false
                  };
                  try { paths[mp].offline = item.isOffline(); } catch(e) {}
                }
              } catch(e) {}
              if (item.type === 2) scan(item);
            }
          }
          scan(app.project.rootItem);

          var result = [];
          for (var key in paths) {
            if (paths.hasOwnProperty(key)) result.push(paths[key]);
          }
          return __result({ pathCount: result.length, paths: result });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_unused_media: {
      description:
        "Find project items that are NOT used in any sequence. Useful for cleaning up projects. Results are paged (default 100 items) and can be filtered by a case-insensitive name substring; follow nextOffset while truncated is true.",
      parameters: {
        type: "object" as const,
        properties: mediaReportPagingProperties("unused project items"),
      },
      handler: async (args: MediaReportPagingArgs = {}) => {
        const paging = parseMediaReportPaging(args);
        if ("error" in paging) return { success: false, error: paging.error };
        const script = buildToolScript(`
          // First, collect all project item nodeIds used in any sequence
          var usedIds = {};
          function scanTracks(tracks) {
            var trackCount = 0;
            try { trackCount = tracks.numTracks; } catch(e) {}
            for (var t = 0; t < trackCount; t++) {
              var clipCount = 0;
              try { clipCount = tracks[t].clips.numItems; } catch(e) {}
              for (var c = 0; c < clipCount; c++) {
                try {
                  var src = tracks[t].clips[c].projectItem;
                  var srcId = __nodeIdOf(src);
                  if (src && srcId) usedIds[srcId] = true;
                } catch(e) {}
              }
            }
          }
          for (var s = 0; s < app.project.sequences.numSequences; s++) {
            var seq = app.project.sequences[s];
            scanTracks(seq.videoTracks);
            scanTracks(seq.audioTracks);
          }

          var needle = "${escapeForExtendScript(paging.contains)}".toLowerCase();
          var offset = ${paging.offset};
          var limit = ${paging.limit};
          function nameMatches(name) {
            if (!needle) return true;
            var text = name === undefined || name === null ? "" : String(name);
            return text.toLowerCase().indexOf(needle) >= 0;
          }

          // Then find items not in usedIds. Only items inside the requested page
          // are materialized so large projects stay bounded.
          var total = 0;
          var unused = [];
          function findUnused(bin) {
            var count = __childCount(bin);
            for (var i = 0; i < count; i++) {
              var item = __childAt(bin, i);
              if (!item) continue;
              var itemType = null;
              try { itemType = item.type; } catch(e) {}
              if ((itemType === 1 || itemType === 4) && !usedIds[__nodeIdOf(item)]) { // clips and files
                var itemName = "";
                try { itemName = item.name; } catch(e) {}
                if (nameMatches(itemName)) {
                  if (total >= offset && unused.length < limit) {
                    var entry = {
                      nodeId: item.nodeId,
                      name: itemName,
                      treePath: item.treePath
                    };
                    try { entry.mediaPath = item.getMediaPath(); } catch(e) {}
                    unused.push(entry);
                  }
                  total++;
                }
              }
              if (__isBinItem(item)) findUnused(item);
            }
          }
          findUnused(app.project.rootItem);

          var nextOffset = offset + unused.length < total ? offset + unused.length : null;
          return __result({
            unusedCount: total,
            total: total,
            offset: offset,
            limit: limit,
            returned: unused.length,
            truncated: nextOffset !== null,
            nextOffset: nextOffset,
            contains: needle || null,
            items: unused
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_duplicate_media: {
      description:
        "Find project items that reference the same source media file. Useful for consolidation. After Effects compositions imported from the same .aep/.aepx are only grouped when their comp names also match. Groups are paged (default 100) and can be filtered by a case-insensitive item-name substring; follow nextOffset while truncated is true.",
      parameters: {
        type: "object" as const,
        properties: mediaReportPagingProperties("duplicate media groups (a group matches contains when any item name matches)"),
      },
      handler: async (args: MediaReportPagingArgs = {}) => {
        const paging = parseMediaReportPaging(args);
        if ("error" in paging) return { success: false, error: paging.error };
        const script = buildToolScript(`
          var pathMap = {};
          var groupKeys = [];
          function scan(bin) {
            var count = __childCount(bin);
            for (var i = 0; i < count; i++) {
              var item = __childAt(bin, i);
              if (!item) continue;
              try {
                var mp = item.getMediaPath();
                var nodeId = String(item.nodeId || "");
                var itemName = "";
                try { itemName = String(item.name); } catch(nameError) {}
                // After Effects comps imported from one project share the .aep
                // media path. They are distinct media unless the comp names match.
                var aeCompName = mp && /\\.aepx?$/i.test(String(mp)) ? itemName : null;
                var key = aeCompName === null ? "path:" + mp : "aecomp:" + mp + "|" + aeCompName;
                // A project item can be exposed more than once while Premiere walks
                // bins. Only distinct, stable node IDs can establish a duplicate.
                if (mp && nodeId) {
                  if (!pathMap.hasOwnProperty(key)) {
                    pathMap[key] = { mediaPath: String(mp), aeCompName: aeCompName, items: [], nodeIds: {} };
                    groupKeys.push(key);
                  }
                  if (!pathMap[key].nodeIds[nodeId]) {
                    pathMap[key].nodeIds[nodeId] = true;
                    pathMap[key].items.push({ nodeId: nodeId, name: itemName, treePath: item.treePath });
                  }
                }
              } catch(e) {}
              if (__isBinItem(item)) scan(item);
            }
          }
          scan(app.project.rootItem);

          var needle = "${escapeForExtendScript(paging.contains)}".toLowerCase();
          var offset = ${paging.offset};
          var limit = ${paging.limit};
          function groupMatches(group) {
            if (!needle) return true;
            for (var m = 0; m < group.items.length; m++) {
              if (String(group.items[m].name).toLowerCase().indexOf(needle) >= 0) return true;
            }
            return false;
          }

          var total = 0;
          var duplicates = [];
          for (var g = 0; g < groupKeys.length; g++) {
            var group = pathMap[groupKeys[g]];
            if (group.items.length > 1 && groupMatches(group)) {
              if (total >= offset && duplicates.length < limit) {
                var entry = { mediaPath: group.mediaPath, count: group.items.length, items: group.items };
                if (group.aeCompName !== null) entry.aeCompName = group.aeCompName;
                duplicates.push(entry);
              }
              total++;
            }
          }

          var nextOffset = offset + duplicates.length < total ? offset + duplicates.length : null;
          return __result({
            duplicateGroupCount: total,
            total: total,
            offset: offset,
            limit: limit,
            returned: duplicates.length,
            truncated: nextOffset !== null,
            nextOffset: nextOffset,
            contains: needle || null,
            duplicates: duplicates
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lift_selection: {
      description:
        "EXPERIMENTAL (undocumented QE DOM: the sequence lift command, exposed as left() on 25.2). Lift (remove without closing the gap) the content between the sequence in/out points on every targeted, unlocked track, then verify the range is empty on those tracks and nothing else on them moved. Requires sequence in/out marks that do not span the whole sequence. Untargeted tracks are not verified; any that changed are listed in otherTracksChanged.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${IN_OUT_EDIT_PREAMBLE}
          var liftName = qeSeq.lift ? "lift" : (qeSeq.left ? "left" : null);
          if (!liftName) return __error("This Premiere host exposes no QE lift command. No clips were changed.");
          try {
            qeSeq[liftName]();
          } catch (eLift) {
            return failAfterEdit("Premiere's lift failed: " + eLift.toString(), {});
          }
          var leftovers = [];
          for (var p = 0; p < targeted.length; p++) {
            var track = targeted[p].track;
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var cs = parseFloat(clip.start.ticks), ce = parseFloat(clip.end.ticks);
              if (cs < outTicks - halfFrame && ce > inTicks + halfFrame) {
                leftovers.push({ track: targeted[p].label, name: clip.name, startSeconds: __ticksToSeconds(String(cs)), endSeconds: __ticksToSeconds(String(ce)) });
              }
            }
          }
          if (leftovers.length) return failAfterEdit("Premiere's lift left clips inside the in/out range on targeted tracks.", { leftovers: leftovers });
          var problems = coverageProblems();
          if (problems.length) return failAfterEdit("Premiere's lift removed more or less than the in/out range: " + problems.join("; ") + ".", { problems: problems });
          var edited = [];
          for (var e = 0; e < targeted.length; e++) edited.push(targeted[e].label);
          return __result({
            lifted: true,
            inSeconds: inSeconds,
            outSeconds: outSeconds,
            gapSeconds: Math.round((outSeconds - inSeconds) * 1000) / 1000,
            tracksEdited: edited,
            otherTracksChanged: otherTracksChanged(),
            sequenceEndSeconds: __ticksToSeconds(seq.end),
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    extract_selection: {
      description:
        "EXPERIMENTAL (undocumented QE DOM: extract()). Extract (remove and close the gap) the content between the sequence in/out points on every targeted, unlocked track, then verify each targeted track lost exactly the range and its later clips moved up by the range. Requires sequence in/out marks that do not span the whole sequence. Premiere can also change untargeted tracks (for example the linked audio of targeted video, or sync-locked tracks); those are not verified but are listed in otherTracksChanged.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${IN_OUT_EDIT_PREAMBLE}
          var endBefore = parseFloat(seq.end);
          try {
            qeSeq.extract();
          } catch (eExtract) {
            return failAfterEdit("Premiere's extract failed: " + eExtract.toString(), {});
          }
          var shift = outTicks - inTicks;
          var problems = coverageProblems();
          for (var p = 0; p < targeted.length; p++) {
            var track = targeted[p].track;
            for (var m = 0; m < targeted[p].after.length; m++) {
              var want = targeted[p].after[m];
              var found = null;
              for (var c = 0; c < track.clips.numItems; c++) if (String(track.clips[c].nodeId) === want.nodeId) { found = track.clips[c]; break; }
              if (!found) { problems.push(targeted[p].label + ": a clip after the range is missing"); continue; }
              var moved = want.start - parseFloat(found.start.ticks);
              if (Math.abs(moved - shift) > halfFrame * 2) problems.push(targeted[p].label + ": '" + found.name + "' moved " + __ticksToSeconds(String(moved)) + "s, expected " + __ticksToSeconds(String(shift)) + "s");
            }
          }
          if (problems.length) return failAfterEdit("Premiere's extract did not close the in/out range as expected: " + problems.join("; ") + ".", { problems: problems });
          var endAfter = parseFloat(seq.end);
          var edited = [];
          for (var e = 0; e < targeted.length; e++) edited.push(targeted[e].label);
          return __result({
            extracted: true,
            inSeconds: inSeconds,
            outSeconds: outSeconds,
            removedSeconds: Math.round((outSeconds - inSeconds) * 1000) / 1000,
            tracksEdited: edited,
            otherTracksChanged: otherTracksChanged(),
            sequenceEndBeforeSeconds: __ticksToSeconds(String(endBefore)),
            sequenceEndSeconds: __ticksToSeconds(String(endAfter)),
            lockedTracksKept: anyLocked,
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_links: {
      description:
        "Get information about linked clips (audio/video linked together) for a given clip.",
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
          var info = {
            nodeId: clip.nodeId,
            name: clip.name,
            trackType: result.trackType,
            trackIndex: result.trackIndex
          };

          // Find linked clips by matching projectItem and overlapping time
          var linked = [];
          var seq = app.project.activeSequence;
          var clipStart = clip.start.ticks;
          var clipEnd = clip.end.ticks;
          var srcId = null;
          try { srcId = clip.projectItem ? clip.projectItem.nodeId : null; } catch(e) {}

          function findLinked(tracks, type) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var other = tracks[t].clips[c];
                if (other.nodeId === clip.nodeId) continue;
                // Check same source and overlapping time
                try {
                  var otherSrcId = other.projectItem ? other.projectItem.nodeId : null;
                  if (srcId && otherSrcId === srcId && other.start.ticks === clipStart) {
                    linked.push({
                      nodeId: other.nodeId,
                      name: other.name,
                      trackType: type,
                      trackIndex: t,
                      startSeconds: __ticksToSeconds(other.start.ticks),
                      endSeconds: __ticksToSeconds(other.end.ticks)
                    });
                  }
                } catch(e) {}
              }
            }
          }

          findLinked(seq.videoTracks, "video");
          findLinked(seq.audioTracks, "audio");

          info.linkedClips = linked;
          info.linkedCount = linked.length;

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_sequence_markers_by_type: {
      description:
        "Get all markers of a specific type (comment, chapter, web link, etc.) from a sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          marker_type: {
            type: "string",
            enum: [
              "Comment",
              "Chapter",
              "Segmentation",
              "WebLink",
              "FlashCuePoint",
            ],
            description: "Type of marker to filter",
          },
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
        required: ["marker_type"],
      },
      handler: async (args: { marker_type: string; sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}

          var selectedSequence = { id: String(seq.sequenceID), name: String(seq.name || "") };
          var markerCollection = seq.markers;
          if (!markerCollection || typeof markerCollection.getFirstMarker !== "function" || typeof markerCollection.getNextMarker !== "function") {
            return __error("The requested sequence does not expose a readable marker collection");
          }
          var markers = [];
          var m = markerCollection.getFirstMarker();
          while (m) {
            if (m.type === "${escapeForExtendScript(args.marker_type)}") {
              markers.push({
                name: m.name,
                comments: m.comments,
                startSeconds: __ticksToSeconds(m.start.ticks),
                endSeconds: __ticksToSeconds(m.end.ticks),
                type: m.type
              });
            }
            m = markerCollection.getNextMarker(m);
          }

          return __result({ sequence: selectedSequence, type: "${escapeForExtendScript(args.marker_type)}", count: markers.length, markers: markers });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_markers: {
      description:
        "Get all markers on a specific project item (source clip markers, not sequence markers).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var markers = [];
          try {
            var m = item.getMarkers().getFirstMarker();
            while (m) {
              var mi = {
                name: m.name,
                comments: m.comments,
                startSeconds: __ticksToSeconds(m.start.ticks),
                type: m.type
              };
              try { mi.endSeconds = __ticksToSeconds(m.end.ticks); } catch(e) {}
              try { mi.colorIndex = m.getColorByIndex(); } catch(e) {}
              markers.push(mi);
              m = item.getMarkers().getNextMarker(m);
            }
          } catch(e) {}

          return __result({ item: item.name, markerCount: markers.length, markers: markers });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_marker_to_project_item: {
      description: "Add a marker to a project item (source clip marker).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds for the marker",
          },
          name: {
            type: "string",
            description: "Marker name",
          },
          comments: {
            type: "string",
            description: "Marker comments",
          },
          duration_seconds: {
            type: "number",
            description:
              "Duration of the marker in seconds (0 for point marker)",
          },
          type: {
            type: "string",
            enum: ["Comment", "Chapter", "Segmentation", "WebLink"],
            description: "Marker type (default: Comment)",
          },
          color_index: {
            type: "number",
            description: "Color label index (0-7)",
          },
        },
        required: ["item_id", "time_seconds"],
      },
      handler: async (args: {
        item_id: string;
        time_seconds: number;
        name?: string;
        comments?: string;
        duration_seconds?: number;
        type?: string;
        color_index?: number;
      }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var markers = item.getMarkers();
          var markerBarrier = __rememberMarkerUndoBarrier(__readUndoIndex());
          if (!markerBarrier.ok) return __error(markerBarrier.error);
          var marker = markers.createMarker(${args.time_seconds});

          ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
          ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
          ${args.type ? `marker.type = "${escapeForExtendScript(args.type)}";` : ""}
          ${
            args.duration_seconds !== undefined
              ? `
          var endTime = new Time();
          endTime.seconds = ${args.time_seconds + args.duration_seconds};
          marker.end = endTime;
          `
              : ""
          }
          ${args.color_index !== undefined ? `marker.setColorByIndex(${args.color_index});` : ""}

          return __result({ added: true, item: item.name, timeSeconds: ${args.time_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_display_format: {
      description: "Set the timecode display format for the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          video_display_format: {
            type: "number",
            description:
              "Video: 0=24 Timecode, 1=25 Timecode, 2=29.97 Drop-frame, 3=29.97 Non-drop-frame, 4=30 Timecode, 5=50 Timecode, 6=59.94 Drop-frame, 7=59.94 Non-drop-frame, 8=60 Timecode, 9=Frames, 10=Feet+Frames 16mm, 11=Feet+Frames 35mm",
          },
          audio_display_format: {
            type: "number",
            description: "Audio: 0=Audio Samples, 1=Milliseconds",
          },
        },
      },
      handler: async (args: {
        video_display_format?: number;
        audio_display_format?: number;
      }) => {
        if (args.video_display_format === undefined && args.audio_display_format === undefined) {
          return { success: false, error: "Provide video_display_format and/or audio_display_format." };
        }
        if (args.video_display_format !== undefined && !(Number.isInteger(args.video_display_format) && args.video_display_format >= 0 && args.video_display_format <= 11)) {
          return { success: false, error: "video_display_format must be an integer from 0 to 11" };
        }
        if (args.audio_display_format !== undefined && ![0, 1].includes(args.audio_display_format)) {
          return { success: false, error: "audio_display_format must be 0 (audio samples) or 1 (milliseconds)" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          ${args.video_display_format !== undefined ? `settings.videoDisplayFormat = ${args.video_display_format};` : ""}
          ${args.audio_display_format !== undefined ? `settings.audioDisplayFormat = ${args.audio_display_format};` : ""}
          seq.setSettings(settings);

          var applied = seq.getSettings();
          if (!applied) return __error("Premiere did not return sequence settings after the display-format update");
          ${args.video_display_format !== undefined ? `if (Number(applied.videoDisplayFormat) !== ${args.video_display_format}) return __error("Premiere did not apply the requested video display format: got " + applied.videoDisplayFormat);` : ""}
          ${args.audio_display_format !== undefined ? `if (Number(applied.audioDisplayFormat) !== ${args.audio_display_format}) return __error("Premiere did not apply the requested audio display format: got " + applied.audioDisplayFormat);` : ""}
          return __result({ sequence: seq.name, videoDisplayFormat: applied.videoDisplayFormat, audioDisplayFormat: applied.audioDisplayFormat, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_at_playhead: {
      description:
        "Get all clips at the current playhead position across all tracks.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Track type to check (default: both)",
          },
        },
      },
      handler: async (args: { track_type?: string }) => {
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var posTicks = parseFloat(seq.getPlayerPosition().ticks);
          var clips = [];

          function findAtPlayhead(tracks, type) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var clip = tracks[t].clips[c];
                var cs = parseFloat(clip.start.ticks);
                var ce = parseFloat(clip.end.ticks);
                if (cs <= posTicks && ce > posTicks) {
                  var ci = {
                    nodeId: clip.nodeId,
                    name: clip.name,
                    trackType: type,
                    trackIndex: t,
                    trackName: tracks[t].name,
                    clipIndex: c,
                    startSeconds: __ticksToSeconds(clip.start.ticks),
                    endSeconds: __ticksToSeconds(clip.end.ticks)
                  };
                  try { ci.enabled = !__isClipDisabled(clip); } catch(e) { ci.enabled = true; }
                  clips.push(ci);
                }
              }
            }
          }

          if ("${trackType}" !== "audio") findAtPlayhead(seq.videoTracks, "video");
          if ("${trackType}" !== "video") findAtPlayhead(seq.audioTracks, "audio");

          return __result({
            playheadSeconds: __ticksToSeconds(seq.getPlayerPosition().ticks),
            clipCount: clips.length,
            clips: clips
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_next_edit_point: {
      description:
        "Find the next or previous edit point (clip boundary) from the playhead position.",
      parameters: {
        type: "object" as const,
        properties: {
          direction: {
            type: "string",
            enum: ["next", "previous"],
            description: "Direction to search (default: next)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Track type to check (default: both)",
          },
        },
      },
      handler: async (args: { direction?: string; track_type?: string }) => {
        const direction = args.direction || "next";
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var posTicks = parseFloat(seq.getPlayerPosition().ticks);
          var editPoints = [];

          function collectPoints(tracks, type) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var clip = tracks[t].clips[c];
                editPoints.push(parseFloat(clip.start.ticks));
                editPoints.push(parseFloat(clip.end.ticks));
              }
            }
          }

          if ("${trackType}" !== "audio") collectPoints(seq.videoTracks, "video");
          if ("${trackType}" !== "video") collectPoints(seq.audioTracks, "audio");

          // Sort and deduplicate
          editPoints.sort(function(a, b) { return a - b; });
          var unique = [];
          for (var i = 0; i < editPoints.length; i++) {
            if (unique.length === 0 || editPoints[i] !== unique[unique.length - 1]) {
              unique.push(editPoints[i]);
            }
          }

          var found = null;
          if ("${direction}" === "next") {
            for (var i = 0; i < unique.length; i++) {
              if (unique[i] > posTicks + 1) { found = unique[i]; break; }
            }
          } else {
            for (var i = unique.length - 1; i >= 0; i--) {
              if (unique[i] < posTicks - 1) { found = unique[i]; break; }
            }
          }

          if (found === null) return __result({ found: false, direction: "${direction}" });

          return __result({
            found: true,
            direction: "${direction}",
            editPointSeconds: __ticksToSeconds("" + found),
            playheadSeconds: __ticksToSeconds("" + posTicks)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_playhead_to_edit: {
      description: "Move the playhead to the next or previous edit point.",
      parameters: {
        type: "object" as const,
        properties: {
          direction: {
            type: "string",
            enum: ["next", "previous"],
            description: "Direction (default: next)",
          },
        },
      },
      handler: async (args: { direction?: string }) => {
        const direction = args.direction || "next";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var posTicks = parseFloat(seq.getPlayerPosition().ticks);
          var editPoints = [];

          function collectPoints(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                editPoints.push(parseFloat(tracks[t].clips[c].start.ticks));
                editPoints.push(parseFloat(tracks[t].clips[c].end.ticks));
              }
            }
          }

          collectPoints(seq.videoTracks);
          collectPoints(seq.audioTracks);

          editPoints.sort(function(a, b) { return a - b; });
          var unique = [];
          for (var i = 0; i < editPoints.length; i++) {
            if (unique.length === 0 || editPoints[i] !== unique[unique.length - 1]) unique.push(editPoints[i]);
          }

          var found = null;
          if ("${direction}" === "next") {
            for (var i = 0; i < unique.length; i++) {
              if (unique[i] > posTicks + 1) { found = unique[i]; break; }
            }
          } else {
            for (var i = unique.length - 1; i >= 0; i--) {
              if (unique[i] < posTicks - 1) { found = unique[i]; break; }
            }
          }

          if (found === null) return __error("No " + "${direction}" + " edit point found");

          seq.setPlayerPosition("" + found);

          return __result({ movedTo: __ticksToSeconds("" + found), direction: "${direction}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_project_scratch_disk: {
      description:
        "Set the project's scratch disks for captured video, captured audio, video previews and audio previews in one call. Each path must be an existing folder or \"SameAsProject\"; any rejected path fails the call.",
      parameters: {
        type: "object" as const,
        properties: {
          captured_video: {
            type: "string",
            description: "Path for captured video",
          },
          captured_audio: {
            type: "string",
            description: "Path for captured audio",
          },
          video_previews: {
            type: "string",
            description: "Path for video previews",
          },
          audio_previews: {
            type: "string",
            description: "Path for audio previews",
          },
          save_and_verify: {
            type: "boolean",
            description:
              "Save the project afterwards and confirm the saved scratch-disk settings (default: false). Premiere has no scratch-disk getter, so without this the result is unverified.",
          },
        },
      },
      handler: async (args: {
        captured_video?: string;
        captured_audio?: string;
        video_previews?: string;
        audio_previews?: string;
        save_and_verify?: boolean;
      }) => {
        const writes = ([
          ["capturedVideo", args.captured_video],
          ["capturedAudio", args.captured_audio],
          ["videoPreviews", args.video_previews],
          ["audioPreviews", args.audio_previews],
        ] as Array<[string, string | undefined]>)
          .filter(([, path]) => path !== undefined)
          .map(([key, path]) => ({ key, path: path as string }));
        return applyScratchDisks(bridgeOptions, writes, args.save_and_verify === true);
      },
    },

    get_project_scratch_disks: {
      description:
        "Get the project's scratch disk locations (captured media, previews, auto-save, Motion Graphics template media, and more). Premiere's scripting API has no scratch-disk getter, so the settings are read from the saved .prproj file; unsaved changes are not reflected. 'SameAsProject' resolves to the project's folder.",
      parameters: {},
      handler: async () => {
        // project.getScratchDiskPath does not exist (verified on Premiere 25.2;
        // only app.setScratchDiskPath is scriptable), so ask Premiere only for
        // the project path and read the saved settings from the file.
        const script = buildToolScript(`
          var project = app.project;
          if (!project || !project.path) return __error("No saved project is open");
          return __result({ projectPath: String(project.path) });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        const projectPath = String((result.data as { projectPath?: unknown } | undefined)?.projectPath ?? "");
        try {
          return {
            success: true,
            data: { source: "saved_project_file", projectPath, disks: await readScratchDisks(projectPath) },
          };
        } catch (error) {
          return {
            success: false,
            error: `Could not read scratch disk settings from the saved project: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },

    nest_clips: {
      description:
        "Unavailable on the legacy CEP backend: Premiere's documented createSubsequence API only creates a separate sequence and cannot safely replace the selected timeline clips with a nested-sequence reference.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the nested sequence",
          },
        },
        required: ["name"],
      },
      handler: async (_args: { name: string }) => ({
        success: false,
        error:
          "nest_clips is unavailable on the legacy CEP backend because Premiere's documented createSubsequence API only creates a separate sequence and does not replace the original clips. No sequence was created and no timeline clips were changed; use Premiere's Nest command instead.",
      }),
    },

    get_sequence_count: {
      description: "Get the total number of sequences in the project.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project open");
          return __result({ count: project.sequences.numSequences });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_total_clip_count: {
      description:
        "Get the total number of clips across all tracks in the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var video = 0, audio = 0;
          for (var t = 0; t < seq.videoTracks.numTracks; t++) video += seq.videoTracks[t].clips.numItems;
          for (var t = 0; t < seq.audioTracks.numTracks; t++) audio += seq.audioTracks[t].clips.numItems;

          return __result({ videoClips: video, audioClips: audio, total: video + audio });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    match_frame: {
      description:
        "Get source media info for the frame at the current playhead on a specific track. Useful for match frame operations.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (default: video)",
          },
          track_index: {
            type: "number",
            description: "Track index (default: 0)",
          },
        },
      },
      handler: async (args: { track_type?: string; track_index?: number }) => {
        const trackType = args.track_type || "video";
        const trackIndex = args.track_index ?? 0;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${trackType === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${trackIndex} >= tracks.numTracks) return __error("Track index out of range");

          var posTicks = parseFloat(seq.getPlayerPosition().ticks);
          var track = tracks[${trackIndex}];
          var found = null;

          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            if (parseFloat(clip.start.ticks) <= posTicks && parseFloat(clip.end.ticks) > posTicks) {
              found = clip;
              break;
            }
          }

          if (!found) return __error("No clip at playhead on ${trackType} track ${trackIndex}");

          var offsetTicks = posTicks - parseFloat(found.start.ticks) + parseFloat(found.inPoint.ticks);

          var result = {
            clipName: found.name,
            clipNodeId: found.nodeId,
            timelineSeconds: __ticksToSeconds("" + posTicks),
            sourceSeconds: __ticksToSeconds("" + offsetTicks)
          };

          try {
            var src = found.projectItem;
            if (src) {
              result.sourceNodeId = src.nodeId;
              result.sourceName = src.name;
              try { result.sourceMediaPath = src.getMediaPath(); } catch(e) {}
            }
          } catch(e) {}

          return __result(result);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
