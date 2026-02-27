import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

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
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
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
                  clip.setSelected(true, true);
                  count++;
                } else if (!addToSel) {
                  clip.setSelected(false, true);
                }
              }
            }
          }

          if (!addToSel) {
            // Deselect all first
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              var track = seq.videoTracks[t];
              for (var c = 0; c < track.clips.numItems; c++) track.clips[c].setSelected(false, true);
            }
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              var track = seq.audioTracks[t];
              for (var c = 0; c < track.clips.numItems; c++) track.clips[c].setSelected(false, true);
            }
          }

          if ("${trackType}" !== "audio") selectInTracks(seq.videoTracks, "video");
          if ("${trackType}" !== "video") selectInTracks(seq.audioTracks, "audio");

          return __result({ selected: count, query: "${escapeForExtendScript(args.name)}" });
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
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          function selectAll(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              ${args.track_index !== undefined ? `if (t !== ${args.track_index}) continue;` : ""}
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                track.clips[c].setSelected(true, true);
                count++;
              }
            }
          }

          if ("${trackType}" !== "audio") selectAll(seq.videoTracks);
          if ("${trackType}" !== "video") selectAll(seq.audioTracks);

          return __result({ selected: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    deselect_all_clips: {
      description: "Deselect all clips in the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              track.clips[c].setSelected(false, true);
              count++;
            }
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              track.clips[c].setSelected(false, true);
              count++;
            }
          }
          return __result({ deselected: count });
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
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var startTicks = __secondsToTicks(${args.start_seconds});
          var endTicks = __secondsToTicks(${args.end_seconds});
          var count = 0;

          // Deselect all first
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) seq.videoTracks[t].clips[c].setSelected(false, true);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) seq.audioTracks[t].clips[c].setSelected(false, true);
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
                  clip.setSelected(true, true);
                  count++;
                }
              }
            }
          }

          if ("${trackType}" !== "audio") selectInRange(seq.videoTracks);
          if ("${trackType}" !== "video") selectInRange(seq.audioTracks);

          return __result({ selected: count, rangeStart: ${args.start_seconds}, rangeEnd: ${args.end_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_clips_by_color: {
      description: "Select all clips whose source project item has a specific color label.",
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Deselect all
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) seq.videoTracks[t].clips[c].setSelected(false, true);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) seq.audioTracks[t].clips[c].setSelected(false, true);
          }

          var count = 0;
          function scan(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                try {
                  if (clip.projectItem && clip.projectItem.getColorLabel() === ${args.color_index}) {
                    clip.setSelected(true, true);
                    count++;
                  }
                } catch(e) {}
              }
            }
          }
          scan(seq.videoTracks);
          scan(seq.audioTracks);

          return __result({ selected: count, colorIndex: ${args.color_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    invert_selection: {
      description: "Invert the current clip selection in the active sequence (selected become deselected and vice versa).",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var selected = 0;
          var deselected = 0;
          function invert(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (clip.isSelected()) {
                  clip.setSelected(false, true);
                  deselected++;
                } else {
                  clip.setSelected(true, true);
                  selected++;
                }
              }
            }
          }
          invert(seq.videoTracks);
          invert(seq.audioTracks);

          return __result({ nowSelected: selected, nowDeselected: deselected });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_disabled_clips: {
      description: "Select all disabled clips in the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Deselect all
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) seq.videoTracks[t].clips[c].setSelected(false, true);
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) seq.audioTracks[t].clips[c].setSelected(false, true);
          }

          var count = 0;
          function scan(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                try {
                  if (track.clips[c].isDisabled()) {
                    track.clips[c].setSelected(true, true);
                    count++;
                  }
                } catch(e) {}
              }
            }
          }
          scan(seq.videoTracks);
          scan(seq.audioTracks);

          return __result({ selected: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
