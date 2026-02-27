import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getDiscoveryTools(bridgeOptions: BridgeOptions) {
  return {
    get_project_info: {
      description: "Get information about the currently open Premiere Pro project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          
          var info = {
            name: project.name,
            path: project.path,
            numSequences: project.sequences.numSequences,
            numItems: project.rootItem.children.numItems,
            activeSequence: null
          };
          
          var activeSeq = project.activeSequence;
          if (activeSeq) {
            info.activeSequence = {
              name: activeSeq.name,
              id: activeSeq.sequenceID,
              videoTracks: activeSeq.videoTracks.numTracks,
              audioTracks: activeSeq.audioTracks.numTracks
            };
          }
          
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_project_items: {
      description: "List all items in the project panel (clips, bins, sequences)",
      parameters: {
        type: "object" as const,
        properties: {
          bin_path: {
            type: "string",
            description: "Optional bin path to list items from (e.g., 'Footage/Raw'). Lists root items if omitted.",
          },
        },
      },
      handler: async (args: { bin_path?: string }) => {
        const binPath = args.bin_path ? `"${escapeForExtendScript(args.bin_path)}"` : "null";
        const script = buildToolScript(`
          var rootItem = app.project.rootItem;
          var targetItem = rootItem;
          
          var binPath = ${binPath};
          if (binPath) {
            var parts = binPath.split("/");
            for (var p = 0; p < parts.length; p++) {
              var found = false;
              for (var i = 0; i < targetItem.children.numItems; i++) {
                if (targetItem.children[i].name === parts[p] && targetItem.children[i].type === 2) {
                  targetItem = targetItem.children[i];
                  found = true;
                  break;
                }
              }
              if (!found) return __error("Bin not found: " + binPath);
            }
          }
          
          var items = [];
          for (var i = 0; i < targetItem.children.numItems; i++) {
            var item = targetItem.children[i];
            var entry = {
              nodeId: item.nodeId,
              name: item.name,
              type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 3 ? "sequence" : "unknown",
              mediaPath: ""
            };
            try {
              if (item.getMediaPath) entry.mediaPath = item.getMediaPath();
            } catch(e) {}
            items.push(entry);
          }
          
          return __result(items);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_sequences: {
      description: "List all sequences in the project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          
          var sequences = [];
          for (var i = 0; i < project.sequences.numSequences; i++) {
            var seq = project.sequences[i];
            sequences.push({
              name: seq.name,
              id: seq.sequenceID,
              videoTracks: seq.videoTracks.numTracks,
              audioTracks: seq.audioTracks.numTracks,
              inPoint: __ticksToSeconds(seq.zeroPoint.ticks),
              end: __ticksToSeconds(seq.end)
            });
          }
          
          return __result(sequences);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_active_sequence: {
      description: "Get detailed information about the currently active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var videoTracks = [];
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              clips.push({
                nodeId: clip.nodeId,
                name: clip.name,
                start: __ticksToSeconds(clip.start.ticks),
                end: __ticksToSeconds(clip.end.ticks),
                inPoint: __ticksToSeconds(clip.inPoint.ticks),
                outPoint: __ticksToSeconds(clip.outPoint.ticks),
                duration: __ticksToSeconds(clip.duration.ticks)
              });
            }
            videoTracks.push({
              index: t,
              name: track.name,
              numClips: track.clips.numItems,
              clips: clips
            });
          }
          
          var audioTracks = [];
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              clips.push({
                nodeId: clip.nodeId,
                name: clip.name,
                start: __ticksToSeconds(clip.start.ticks),
                end: __ticksToSeconds(clip.end.ticks),
                duration: __ticksToSeconds(clip.duration.ticks)
              });
            }
            audioTracks.push({
              index: t,
              name: track.name,
              numClips: track.clips.numItems,
              clips: clips
            });
          }
          
          return __result({
            name: seq.name,
            id: seq.sequenceID,
            frameSizeHorizontal: seq.frameSizeHorizontal,
            frameSizeVertical: seq.frameSizeVertical,
            end: __ticksToSeconds(seq.end),
            videoTracks: videoTracks,
            audioTracks: audioTracks
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_sequence_tracks: {
      description: "List all tracks (video and audio) in a sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID or name. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          
          var tracks = [];
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            tracks.push({
              index: t,
              type: "video",
              name: track.name,
              numClips: track.clips.numItems,
              isMuted: track.isMuted(),
              isLocked: track.isLocked()
            });
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            tracks.push({
              index: t,
              type: "audio",
              name: track.name,
              numClips: track.clips.numItems,
              isMuted: track.isMuted()
            });
          }
          
          return __result(tracks);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_properties: {
      description: "Get detailed properties of a specific clip by its node ID",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "The node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var props = {
            nodeId: clip.nodeId,
            name: clip.name,
            trackIndex: result.trackIndex,
            trackType: result.trackType,
            clipIndex: result.clipIndex,
            start: __ticksToSeconds(clip.start.ticks),
            end: __ticksToSeconds(clip.end.ticks),
            inPoint: __ticksToSeconds(clip.inPoint.ticks),
            outPoint: __ticksToSeconds(clip.outPoint.ticks),
            duration: __ticksToSeconds(clip.duration.ticks),
            mediaType: clip.mediaType,
            isSelected: clip.isSelected(),
            isSpeedReversed: clip.isSpeedReversed ? clip.isSpeedReversed() : false
          };
          
          try {
            if (clip.components) {
              var effects = [];
              for (var i = 0; i < clip.components.numItems; i++) {
                effects.push({
                  displayName: clip.components[i].displayName,
                  matchName: clip.components[i].matchName
                });
              }
              props.effects = effects;
            }
          } catch(e) {}
          
          return __result(props);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    find_project_item_by_name: {
      description: "Find a project item by name (searches recursively through bins)",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name of the project item to find",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.name)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.name)}");
          
          var info = {
            nodeId: item.nodeId,
            name: item.name,
            type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 3 ? "sequence" : "unknown",
            mediaPath: ""
          };
          try {
            if (item.getMediaPath) info.mediaPath = item.getMediaPath();
          } catch(e) {}
          
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_sequence_settings: {
      description: "Get the settings (resolution, frame rate, etc.) of a sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID or name. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          
          var settings = {
            name: seq.name,
            id: seq.sequenceID,
            frameSizeHorizontal: seq.frameSizeHorizontal,
            frameSizeVertical: seq.frameSizeVertical,
            timebase: seq.timebase,
            end: __ticksToSeconds(seq.end),
            videoTracks: seq.videoTracks.numTracks,
            audioTracks: seq.audioTracks.numTracks
          };
          
          try {
            var seqSettings = seq.getSettings();
            if (seqSettings) {
              settings.audioChannelCount = seqSettings.audioChannelCount;
              settings.audioChannelType = seqSettings.audioChannelType;
              settings.audioDisplayFormat = seqSettings.audioDisplayFormat;
              settings.audioSampleRate = seqSettings.audioSampleRate;
              settings.videoDisplayFormat = seqSettings.videoDisplayFormat;
              settings.videoFieldType = seqSettings.videoFieldType;
              settings.videoFrameRate = seqSettings.videoFrameRate;
            }
          } catch(e) {}
          
          return __result(settings);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_selected_clips: {
      description: "Get the currently selected clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var selection = seq.getSelection();
          var clips = [];
          for (var i = 0; i < selection.length; i++) {
            var clip = selection[i];
            clips.push({
              nodeId: clip.nodeId,
              name: clip.name,
              start: __ticksToSeconds(clip.start.ticks),
              end: __ticksToSeconds(clip.end.ticks),
              duration: __ticksToSeconds(clip.duration.ticks),
              mediaType: clip.mediaType
            });
          }
          
          return __result(clips);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_at_position: {
      description: "Get the clip at a specific time position on a track",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
        },
        required: ["time_seconds", "track_index", "track_type"],
      },
      handler: async (args: { time_seconds: number; track_index: number; track_type: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");
          
          var track = tracks[${args.track_index}];
          var targetTicks = __secondsToTicks(${args.time_seconds});
          
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var startTicks = parseFloat(clip.start.ticks);
            var endTicks = parseFloat(clip.end.ticks);
            if (targetTicks >= startTicks && targetTicks < endTicks) {
              return __result({
                nodeId: clip.nodeId,
                name: clip.name,
                trackIndex: ${args.track_index},
                trackType: "${args.track_type}",
                start: __ticksToSeconds(clip.start.ticks),
                end: __ticksToSeconds(clip.end.ticks),
                duration: __ticksToSeconds(clip.duration.ticks)
              });
            }
          }
          
          return __error("No clip found at position " + ${args.time_seconds} + "s on ${args.track_type} track " + ${args.track_index});
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
