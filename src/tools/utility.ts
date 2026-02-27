import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getUtilityTools(bridgeOptions: BridgeOptions) {
  return {
    delete_project_item: {
      description: "Delete a project item (clip, bin, etc.) from the project panel. This removes it from the project but does not affect timeline instances.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to delete",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");

          var name = item.name;
          app.project.deleteProjectItem(item);
          return __result({ deleted: true, name: name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_multiple_project_items: {
      description: "Delete multiple project items at once from the project panel.",
      parameters: {
        type: "object" as const,
        properties: {
          item_ids: {
            type: "array",
            description: "Array of node IDs or names of items to delete",
          },
        },
        required: ["item_ids"],
      },
      handler: async (args: { item_ids: string[] }) => {
        const idsJson = JSON.stringify(args.item_ids);
        const script = buildToolScript(`
          var ids = ${idsJson};
          var deleted = 0;
          var names = [];
          for (var i = 0; i < ids.length; i++) {
            var item = __findProjectItem(ids[i]);
            if (item) {
              names.push(item.name);
              try { app.project.deleteProjectItem(item); deleted++; } catch(e) {}
            }
          }
          return __result({ deleted: deleted, total: ids.length, names: names });
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
          item.name = "${escapeForExtendScript(args.new_name)}";
          return __result({ oldName: oldName, newName: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_adjustment_layer: {
      description: "Add an adjustment layer to the timeline at the specified position and track.",
      parameters: {
        type: "object" as const,
        properties: {
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5)",
          },
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
        },
        required: ["start_seconds"],
      },
      handler: async (args: { start_seconds: number; duration_seconds?: number; track_index?: number }) => {
        const duration = args.duration_seconds ?? 5;
        const track = args.track_index ?? 0;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Create an adjustment layer via QE
          app.enableQE();
          try {
            var qeSeq = qe.project.getActiveSequence();
            qeSeq.addAdjustmentLayer(${track});

            // The adjustment layer gets added at the end of the track or at playhead
            // We may need to move it
            return __result({
              added: true,
              startSeconds: ${args.start_seconds},
              durationSeconds: ${duration},
              trackIndex: ${track},
              note: "Adjustment layer added. You may need to move/trim it to the desired position."
            });
          } catch(e) {
            return __error("Failed to add adjustment layer: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    freeze_frame: {
      description: "Create a freeze frame from a clip at a specific time. Exports the frame and imports it back as a still image.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time in the sequence to freeze (in seconds). Uses playhead if omitted.",
          },
          output_path: {
            type: "string",
            description: "Full path for the exported frame (e.g., /path/to/freeze.png)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the freeze frame on the timeline (default: 2)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { time_seconds?: number; output_path: string; duration_seconds?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${args.time_seconds !== undefined
            ? `var timeTicks = __secondsToTicks(${args.time_seconds}).toString();`
            : `var timeTicks = seq.getPlayerPosition().ticks;`}

          // Export frame
          seq.exportFramePNG(timeTicks, "${escapeForExtendScript(args.output_path)}");

          // Import back
          app.project.importFiles(["${escapeForExtendScript(args.output_path)}"], false, app.project.rootItem, false);

          return __result({
            exported: true,
            path: "${escapeForExtendScript(args.output_path)}",
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
            description: "New frame rate (e.g., 23.976, 24, 25, 29.97, 30, 50, 59.94, 60)",
          },
        },
        required: ["frame_rate"],
      },
      handler: async (args: { frame_rate: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoFrameRate = ${args.frame_rate};
          seq.setSettings(settings);

          return __result({ frameRate: ${args.frame_rate}, sequence: seq.name });
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoFrameWidth = ${args.width};
          settings.videoFrameHeight = ${args.height};
          seq.setSettings(settings);

          return __result({ width: ${args.width}, height: ${args.height}, sequence: seq.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_audio_settings: {
      description: "Change audio settings of the active sequence (sample rate, channel type).",
      parameters: {
        type: "object" as const,
        properties: {
          sample_rate: {
            type: "number",
            description: "Audio sample rate (e.g., 44100, 48000, 96000)",
          },
          channel_type: {
            type: "number",
            description: "Channel type: 0=Mono, 1=Stereo, 2=5.1, 3=Multichannel",
          },
        },
      },
      handler: async (args: { sample_rate?: number; channel_type?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          ${args.sample_rate !== undefined ? `settings.audioSampleRate = ${args.sample_rate};` : ""}
          ${args.channel_type !== undefined ? `settings.audioChannelType = ${args.channel_type};` : ""}
          seq.setSettings(settings);

          return __result({ sequence: seq.name, sampleRate: settings.audioSampleRate, channelType: settings.audioChannelType });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_pixel_aspect_ratio: {
      description: "Change the pixel aspect ratio of the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          ratio: {
            type: "number",
            description: "Pixel aspect ratio (1.0 for square pixels, 1.4222 for 16:9 DV, etc.)",
          },
        },
        required: ["ratio"],
      },
      handler: async (args: { ratio: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoPixelAspectRatio = ${args.ratio};
          seq.setSettings(settings);

          return __result({ ratio: ${args.ratio}, sequence: seq.name });
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
            description: "0=No Fields (Progressive), 1=Upper Field First, 2=Lower Field First",
          },
        },
        required: ["field_type"],
      },
      handler: async (args: { field_type: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          settings.videoFieldType = ${args.field_type};
          seq.setSettings(settings);

          return __result({ fieldType: ${args.field_type}, sequence: seq.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_all_project_paths: {
      description: "Get all unique media file paths used in the project. Useful for asset management and archiving.",
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
      description: "Find all project items that are NOT used in any sequence. Useful for cleaning up projects.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          // First, collect all project item nodeIds used in any sequence
          var usedIds = {};
          for (var s = 0; s < app.project.sequences.numSequences; s++) {
            var seq = app.project.sequences[s];
            function scanTracks(tracks) {
              for (var t = 0; t < tracks.numTracks; t++) {
                for (var c = 0; c < tracks[t].clips.numItems; c++) {
                  try {
                    var src = tracks[t].clips[c].projectItem;
                    if (src) usedIds[src.nodeId] = true;
                  } catch(e) {}
                }
              }
            }
            scanTracks(seq.videoTracks);
            scanTracks(seq.audioTracks);
          }

          // Then find items not in usedIds
          var unused = [];
          function findUnused(bin) {
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              if (item.type === 1 || item.type === 4) { // clips and files
                if (!usedIds[item.nodeId]) {
                  var entry = {
                    nodeId: item.nodeId,
                    name: item.name,
                    treePath: item.treePath
                  };
                  try { entry.mediaPath = item.getMediaPath(); } catch(e) {}
                  unused.push(entry);
                }
              }
              if (item.type === 2) findUnused(item);
            }
          }
          findUnused(app.project.rootItem);

          return __result({ unusedCount: unused.length, items: unused });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_duplicate_media: {
      description: "Find project items that reference the same source media file. Useful for consolidation.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var pathMap = {};
          function scan(bin) {
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              try {
                var mp = item.getMediaPath();
                if (mp) {
                  if (!pathMap[mp]) pathMap[mp] = [];
                  pathMap[mp].push({ nodeId: item.nodeId, name: item.name, treePath: item.treePath });
                }
              } catch(e) {}
              if (item.type === 2) scan(item);
            }
          }
          scan(app.project.rootItem);

          var duplicates = [];
          for (var path in pathMap) {
            if (pathMap.hasOwnProperty(path) && pathMap[path].length > 1) {
              duplicates.push({ mediaPath: path, count: pathMap[path].length, items: pathMap[path] });
            }
          }

          return __result({ duplicateGroupCount: duplicates.length, duplicates: duplicates });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lift_selection: {
      description: "Lift (remove without closing gap) the content between sequence in/out points or selected clips.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var qeSeq = qe.project.getActiveSequence();
            qeSeq.lift();
            return __result({ lifted: true });
          } catch(e) {
            return __error("Lift failed: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    extract_selection: {
      description: "Extract (remove and close gap) the content between sequence in/out points.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var qeSeq = qe.project.getActiveSequence();
            qeSeq.extract();
            return __result({ extracted: true });
          } catch(e) {
            return __error("Extract failed: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_links: {
      description: "Get information about linked clips (audio/video linked together) for a given clip.",
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
      description: "Get all markers of a specific type (comment, chapter, web link, etc.) from a sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          marker_type: {
            type: "string",
            enum: ["Comment", "Chapter", "Segmentation", "WebLink", "FlashCuePoint"],
            description: "Type of marker to filter",
          },
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
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

          var markers = [];
          var m = seq.markers.getFirstMarker();
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
            m = seq.markers.getNextMarker(m);
          }

          return __result({ type: "${escapeForExtendScript(args.marker_type)}", count: markers.length, markers: markers });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_markers: {
      description: "Get all markers on a specific project item (source clip markers, not sequence markers).",
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
            description: "Duration of the marker in seconds (0 for point marker)",
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
          var marker = markers.createMarker(${args.time_seconds});

          ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
          ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
          ${args.type ? `marker.type = "${escapeForExtendScript(args.type)}";` : ""}
          ${args.duration_seconds !== undefined ? `
          var endTime = new Time();
          endTime.seconds = ${args.time_seconds + args.duration_seconds};
          marker.end = endTime;
          ` : ""}
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
            description: "Video: 0=24 Timecode, 1=25 Timecode, 2=29.97 Drop-frame, 3=29.97 Non-drop-frame, 4=30 Timecode, 5=50 Timecode, 6=59.94 Drop-frame, 7=59.94 Non-drop-frame, 8=60 Timecode, 9=Frames, 10=Feet+Frames 16mm, 11=Feet+Frames 35mm",
          },
          audio_display_format: {
            type: "number",
            description: "Audio: 0=Audio Samples, 1=Milliseconds",
          },
        },
      },
      handler: async (args: { video_display_format?: number; audio_display_format?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          ${args.video_display_format !== undefined ? `settings.videoDisplayFormat = ${args.video_display_format};` : ""}
          ${args.audio_display_format !== undefined ? `settings.audioDisplayFormat = ${args.audio_display_format};` : ""}
          seq.setSettings(settings);

          return __result({ sequence: seq.name, videoDisplayFormat: settings.videoDisplayFormat, audioDisplayFormat: settings.audioDisplayFormat });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_at_playhead: {
      description: "Get all clips at the current playhead position across all tracks.",
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
                  try { ci.enabled = !clip.isDisabled(); } catch(e) { ci.enabled = true; }
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
      description: "Find the next or previous edit point (clip boundary) from the playhead position.",
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
      description: "Set the project's scratch disk paths for captured video, audio, and previews.",
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
        },
      },
      handler: async (args: { captured_video?: string; captured_audio?: string; video_previews?: string; audio_previews?: string }) => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project open");

          var set = {};
          ${args.captured_video ? `
          try { project.setScratchDiskPath("${escapeForExtendScript(args.captured_video)}", 0); set.capturedVideo = "${escapeForExtendScript(args.captured_video)}"; } catch(e) {}` : ""}
          ${args.captured_audio ? `
          try { project.setScratchDiskPath("${escapeForExtendScript(args.captured_audio)}", 1); set.capturedAudio = "${escapeForExtendScript(args.captured_audio)}"; } catch(e) {}` : ""}
          ${args.video_previews ? `
          try { project.setScratchDiskPath("${escapeForExtendScript(args.video_previews)}", 2); set.videoPreviews = "${escapeForExtendScript(args.video_previews)}"; } catch(e) {}` : ""}
          ${args.audio_previews ? `
          try { project.setScratchDiskPath("${escapeForExtendScript(args.audio_previews)}", 3); set.audioPreviews = "${escapeForExtendScript(args.audio_previews)}"; } catch(e) {}` : ""}

          return __result(set);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_project_scratch_disks: {
      description: "Get the current scratch disk paths for the project.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project open");

          var disks = {};
          try { disks.capturedVideo = project.getScratchDiskPath(0); } catch(e) {}
          try { disks.capturedAudio = project.getScratchDiskPath(1); } catch(e) {}
          try { disks.videoPreviews = project.getScratchDiskPath(2); } catch(e) {}
          try { disks.audioPreviews = project.getScratchDiskPath(3); } catch(e) {}

          return __result(disks);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    nest_clips: {
      description: "Nest selected clips into a nested sequence. Select the clips first, then call this tool.",
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
      handler: async (args: { name: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // Get selected clips
          var selected = [];
          function getSelected(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                if (tracks[t].clips[c].isSelected()) selected.push(tracks[t].clips[c]);
              }
            }
          }
          getSelected(seq.videoTracks);
          getSelected(seq.audioTracks);

          if (selected.length === 0) return __error("No clips selected. Select clips first.");

          try {
            seq.createSubsequence(true);
            return __result({ nested: true, name: "${escapeForExtendScript(args.name)}", clipCount: selected.length });
          } catch(e) {
            return __error("Nesting failed: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
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
      description: "Get the total number of clips across all tracks in the active sequence.",
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
      description: "Get source media info for the frame at the current playhead on a specific track. Useful for match frame operations.",
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
