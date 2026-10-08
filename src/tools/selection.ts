import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";


function selectionArgumentError(args: { track_type?: string; track_index?: number }): string | null {
  if (args.track_type !== undefined && !["video", "audio", "both"].includes(args.track_type)) return "track_type must be video, audio or both.";
  if (args.track_index !== undefined && (!Number.isInteger(args.track_index) || args.track_index < 0)) return "track_index must be a non-negative integer.";
  return null;
}

const SELECTION_READBACK = `
          var selectionTargets = [];
          function selectionWrite(clip, wanted) {
            var found = -1;
            for (var i = 0; i < selectionTargets.length; i++) {
              var prior = selectionTargets[i].clip;
              if (clip === prior || (clip.nodeId && prior.nodeId && String(clip.nodeId) === String(prior.nodeId))) { found = i; break; }
            }
            if (found < 0) selectionTargets.push({ clip: clip, wanted: wanted });
            else selectionTargets[found].wanted = wanted;
            clip.setSelected(wanted, true);
          }
          function selectionReceipt(payload) {
            var requestedSelected = 0, requestedDeselected = 0, appliedSelected = 0, appliedDeselected = 0;
            var unreadable = 0, mismatches = 0;
            for (var i = 0; i < selectionTargets.length; i++) {
              var target = selectionTargets[i], observed = null;
              if (target.wanted) requestedSelected++; else requestedDeselected++;
              try { observed = target.clip.isSelected(); } catch (selectionReadError) {}
              if (observed !== true && observed !== false && observed !== 0 && observed !== 1) { unreadable++; continue; }
              observed = observed === true || observed === 1;
              if (observed !== target.wanted) mismatches++;
              else if (observed) appliedSelected++; else appliedDeselected++;
            }
            payload.requestedSelected = requestedSelected;
            payload.requestedDeselected = requestedDeselected;
            payload.appliedSelected = appliedSelected;
            payload.appliedDeselected = appliedDeselected;
            payload.unverifiedClips = unreadable;
            payload.verified = mismatches === 0 && unreadable === 0;
            payload.outcome = mismatches ? "failed" : (unreadable ? "committed_unverified" : "verified");
            if (payload.selected !== undefined) payload.selected = unreadable ? null : appliedSelected;
            if (payload.deselected !== undefined) payload.deselected = unreadable ? null : appliedDeselected;
            if (payload.nowSelected !== undefined) payload.nowSelected = unreadable ? null : appliedSelected;
            if (payload.nowDeselected !== undefined) payload.nowDeselected = unreadable ? null : appliedDeselected;
            if (mismatches) return __jsonStringify({ success: false, error: "Premiere did not apply the requested selection to " + mismatches + " clip(s).", data: payload });
            return __result(payload);
          }
`;

export function getSelectionTools(bridgeOptions: BridgeOptions) {
  return {
    select_clips_by_name: {
      description: "Select all clips in the active sequence that match a name (substring match). Optionally filter by track type and index.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Clip name to search for (case-insensitive substring match)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Track type to search (default: both)",
          },
          track_index: {
            type: "number",
            description: "Specific track index to search (optional, searches all if omitted)",
          },
          add_to_selection: {
            type: "boolean",
            description: "If true, add to existing selection instead of replacing it (default: false)",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; track_type?: string; track_index?: number; add_to_selection?: boolean }) => {
        const invalid = selectionArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        if (typeof args.name !== "string" || !args.name.length) return { success: false, error: "name must be a non-empty string." };
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var query = "${escapeForExtendScript(args.name)}".toLowerCase();
          var addToSel = ${args.add_to_selection ? "true" : "false"};
          var count = 0;

          function selectInTracks(tracks, type) {
            for (var t = 0; t < tracks.numTracks; t++) {
              ${args.track_index !== undefined ? `if (t !== ${args.track_index}) continue;` : ""}
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.name.toLowerCase().indexOf(query) !== -1) {
                  selectionWrite(clip, true);
                  count++;
                } else if (!addToSel) {
                  selectionWrite(clip, false);
                }
              }
            }
          }

          if (!addToSel) {
            // Deselect all first
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              var track = seq.videoTracks[t];
              for (var c = 0; c < track.clips.numItems; c++) selectionWrite(track.clips[c], false);
            }
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              var track = seq.audioTracks[t];
              for (var c = 0; c < track.clips.numItems; c++) selectionWrite(track.clips[c], false);
            }
          }

          if ("${trackType}" !== "audio") selectInTracks(seq.videoTracks, "video");
          if ("${trackType}" !== "video") selectInTracks(seq.audioTracks, "audio");

          return selectionReceipt({ selected: count, query: "${escapeForExtendScript(args.name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_all_clips: {
      description: "Select all clips in the active sequence, or all clips on a specific track.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Track type (default: both)",
          },
          track_index: {
            type: "number",
            description: "Specific track index (optional, selects all tracks if omitted)",
          },
        },
      },
      handler: async (args: { track_type?: string; track_index?: number }) => {
        const invalid = selectionArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          function selectAll(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              ${args.track_index !== undefined ? `if (t !== ${args.track_index}) continue;` : ""}
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                selectionWrite(track.clips[c], true);
                count++;
              }
            }
          }

          if ("${trackType}" !== "audio") selectAll(seq.videoTracks);
          if ("${trackType}" !== "video") selectAll(seq.audioTracks);

          return selectionReceipt({ selected: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    deselect_all_clips: {
      description: "Deselect all clips in the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              selectionWrite(track.clips[c], false);
              count++;
            }
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              selectionWrite(track.clips[c], false);
              count++;
            }
          }
          return selectionReceipt({ deselected: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_clips_in_range: {
      description: "Select all clips that overlap a time range in the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          start_seconds: {
            type: "number",
            description: "Start of selection range in seconds",
          },
          end_seconds: {
            type: "number",
            description: "End of selection range in seconds",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Track type (default: both)",
          },
          track_index: {
            type: "number",
            description: "Specific track index (optional)",
          },
        },
        required: ["start_seconds", "end_seconds"],
      },
      handler: async (args: { start_seconds: number; end_seconds: number; track_type?: string; track_index?: number }) => {
        if (!Number.isFinite(args.start_seconds) || args.start_seconds < 0 || !Number.isFinite(args.end_seconds) || args.end_seconds <= args.start_seconds) return { success: false, error: "Selection range must have finite non-negative start_seconds and a later end_seconds." };
        const invalid = selectionArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var startTicks = __secondsToTicks(${args.start_seconds});
          var endTicks = __secondsToTicks(${args.end_seconds});
          var count = 0;

          // Deselect all first
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) selectionWrite(seq.videoTracks[t].clips[c], false);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) selectionWrite(seq.audioTracks[t].clips[c], false);
          }

          function selectInRange(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              ${args.track_index !== undefined ? `if (t !== ${args.track_index}) continue;` : ""}
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var cs = parseFloat(clip.start.ticks);
                var ce = parseFloat(clip.end.ticks);
                if (cs < endTicks && ce > startTicks) {
                  selectionWrite(clip, true);
                  count++;
                }
              }
            }
          }

          if ("${trackType}" !== "audio") selectInRange(seq.videoTracks);
          if ("${trackType}" !== "video") selectInRange(seq.audioTracks);

          return selectionReceipt({ selected: count, rangeStart: ${args.start_seconds}, rangeEnd: ${args.end_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_clips_by_color: {
      description: "Select clips by their source project item color label. CEP exposes no timeline track-item label getter, so timeline-specific labels cannot be matched.",
      parameters: {
        type: "object" as const,
        properties: {
          color_index: {
            type: "number",
            description: "Label color index (0=Violet, 1=Iris, 2=Caribbean, 3=Lavender, 4=Cerulean, 5=Forest, 6=Rose, 7=Mango, 8=Purple, 9=Blue, 10=Teal, 11=Magenta, 12=Tan, 13=Green, 14=Brown, 15=Yellow)",
          },
        },
        required: ["color_index"],
      },
      handler: async (args: { color_index: number }) => {
        if (!Number.isInteger(args.color_index) || args.color_index < 0 || args.color_index > 15) return { success: false, error: "color_index must be an integer from 0 to 15." };
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Deselect all
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) selectionWrite(seq.videoTracks[t].clips[c], false);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) selectionWrite(seq.audioTracks[t].clips[c], false);
          }

          var count = 0;
          function scan(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                try {
                  if (clip.projectItem && clip.projectItem.getColorLabel() === ${args.color_index}) {
                    selectionWrite(clip, true);
                    count++;
                  }
                } catch(e) {}
              }
            }
          }
          scan(seq.videoTracks);
          scan(seq.audioTracks);

          return selectionReceipt({ selected: count, colorIndex: ${args.color_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    invert_selection: {
      description: "Invert the current clip selection in the active sequence (selected become deselected and vice versa).",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var selected = 0;
          var deselected = 0;
          var invertTracks = [seq.videoTracks, seq.audioTracks];
          for (var k = 0; k < invertTracks.length; k++) {
            for (var t = 0; t < invertTracks[k].numTracks; t++) {
              for (var c = 0; c < invertTracks[k][t].clips.numItems; c++) {
                var before = null;
                try { before = invertTracks[k][t].clips[c].isSelected(); } catch (invertReadError) {}
                if (before !== true && before !== false && before !== 0 && before !== 1) return __error("Current selection could not be read; nothing was changed.");
              }
            }
          }
          function invert(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.isSelected()) {
                  selectionWrite(clip, false);
                  deselected++;
                } else {
                  selectionWrite(clip, true);
                  selected++;
                }
              }
            }
          }
          invert(seq.videoTracks);
          invert(seq.audioTracks);

          return selectionReceipt({ nowSelected: selected, nowDeselected: deselected });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_disabled_clips: {
      description: "Select all disabled clips in the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${SELECTION_READBACK}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Deselect all
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) selectionWrite(seq.videoTracks[t].clips[c], false);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) selectionWrite(seq.audioTracks[t].clips[c], false);
          }

          var count = 0;
          function scan(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                try {
                  if (__isClipDisabled(track.clips[c])) {
                    selectionWrite(track.clips[c], true);
                    count++;
                  }
                } catch(e) {}
              }
            }
          }
          scan(seq.videoTracks);
          scan(seq.audioTracks);

          return selectionReceipt({ selected: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
