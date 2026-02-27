import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getInspectionTools(bridgeOptions: BridgeOptions) {
  return {
    get_full_project_overview: {
      description: "Get a comprehensive overview of the entire project: all bins (recursive tree), all sequences, media stats, offline items, and project settings. This is the best first call to fully understand a project.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");

          function walkBin(bin, depth) {
            var items = [];
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              var entry = {
                nodeId: item.nodeId,
                name: item.name,
                treePath: item.treePath,
                type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 3 ? "root" : item.type === 4 ? "file" : "unknown"
              };
              try { entry.mediaPath = item.getMediaPath(); } catch(e) {}
              try { entry.offline = item.isOffline(); } catch(e) {}
              try { entry.colorLabel = item.getColorLabel(); } catch(e) {}
              if (item.type === 2 && depth < 10) {
                entry.children = walkBin(item, depth + 1);
                entry.childCount = entry.children.length;
              }
              items.push(entry);
            }
            return items;
          }

          var binTree = walkBin(project.rootItem, 0);

          var sequences = [];
          for (var i = 0; i < project.sequences.numSequences; i++) {
            var seq = project.sequences[i];
            var clipCount = 0;
            for (var t = 0; t < seq.videoTracks.numTracks; t++) clipCount += seq.videoTracks[t].clips.numItems;
            for (var t = 0; t < seq.audioTracks.numTracks; t++) clipCount += seq.audioTracks[t].clips.numItems;
            sequences.push({
              name: seq.name,
              id: seq.sequenceID,
              width: seq.frameSizeHorizontal,
              height: seq.frameSizeVertical,
              durationSeconds: __ticksToSeconds(seq.end),
              videoTracks: seq.videoTracks.numTracks,
              audioTracks: seq.audioTracks.numTracks,
              totalClips: clipCount
            });
          }

          var totalItems = 0;
          var offlineCount = 0;
          var mediaTypes = {};
          function countItems(bin) {
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              totalItems++;
              try { if (item.isOffline()) offlineCount++; } catch(e) {}
              try {
                var mp = item.getMediaPath();
                if (mp) {
                  var ext = mp.split(".").pop().toLowerCase();
                  if (!mediaTypes[ext]) mediaTypes[ext] = 0;
                  mediaTypes[ext]++;
                }
              } catch(e) {}
              if (item.type === 2) countItems(item);
            }
          }
          countItems(project.rootItem);

          var activeSeqInfo = null;
          var active = project.activeSequence;
          if (active) {
            activeSeqInfo = { name: active.name, id: active.sequenceID };
          }

          return __result({
            projectName: project.name,
            projectPath: project.path,
            totalItems: totalItems,
            offlineItems: offlineCount,
            sequenceCount: sequences.length,
            mediaFileTypes: mediaTypes,
            activeSequence: activeSeqInfo,
            sequences: sequences,
            binTree: binTree
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_bin_contents: {
      description: "Get detailed contents of a specific bin (folder) including all nested items, media paths, offline status, color labels, and metadata. Searches by bin name or node ID.",
      parameters: {
        type: "object" as const,
        properties: {
          bin_id: {
            type: "string",
            description: "Bin name, node ID, or path (e.g., 'Footage', 'Footage/Raw')",
          },
          recursive: {
            type: "boolean",
            description: "Include items from sub-bins recursively (default: true)",
          },
        },
        required: ["bin_id"],
      },
      handler: async (args: { bin_id: string; recursive?: boolean }) => {
        const recursive = args.recursive !== false;
        const script = buildToolScript(`
          var root = app.project.rootItem;
          var target = null;

          // Try by node ID first
          function findById(parent, id) {
            for (var i = 0; i < parent.children.numItems; i++) {
              var item = parent.children[i];
              if (item.nodeId === id) return item;
              if (item.type === 2) {
                var found = findById(item, id);
                if (found) return found;
              }
            }
            return null;
          }

          target = findById(root, "${escapeForExtendScript(args.bin_id)}");

          // Try by path
          if (!target) {
            var parts = "${escapeForExtendScript(args.bin_id)}".split("/");
            var current = root;
            for (var p = 0; p < parts.length; p++) {
              var found = false;
              for (var i = 0; i < current.children.numItems; i++) {
                if (current.children[i].name === parts[p] && current.children[i].type === 2) {
                  current = current.children[i];
                  found = true;
                  break;
                }
              }
              if (!found) { current = null; break; }
            }
            if (current && current !== root) target = current;
          }

          // Try by name
          if (!target) {
            function findByName(parent, name) {
              for (var i = 0; i < parent.children.numItems; i++) {
                var item = parent.children[i];
                if (item.name === name && item.type === 2) return item;
                if (item.type === 2) {
                  var found = findByName(item, name);
                  if (found) return found;
                }
              }
              return null;
            }
            target = findByName(root, "${escapeForExtendScript(args.bin_id)}");
          }

          if (!target) return __error("Bin not found: ${escapeForExtendScript(args.bin_id)}");

          function getItemDetails(item) {
            var info = {
              nodeId: item.nodeId,
              name: item.name,
              type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 4 ? "file" : "unknown",
              treePath: item.treePath
            };
            try { info.mediaPath = item.getMediaPath(); } catch(e) {}
            try { info.offline = item.isOffline(); } catch(e) {}
            try { info.colorLabel = item.getColorLabel(); } catch(e) {}
            try {
              var interp = item.getFootageInterpretation();
              if (interp) {
                info.frameRate = interp.frameRate;
                info.pixelAspectRatio = interp.pixelAspectRatio;
              }
            } catch(e) {}
            try {
              info.inPoint = __ticksToSeconds(item.getInPoint().ticks);
              info.outPoint = __ticksToSeconds(item.getOutPoint().ticks);
            } catch(e) {}
            return info;
          }

          function walkItems(bin, recurse) {
            var items = [];
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              var info = getItemDetails(item);
              if (item.type === 2 && recurse) {
                info.children = walkItems(item, true);
                info.childCount = info.children.length;
              }
              items.push(info);
            }
            return items;
          }

          var contents = walkItems(target, ${recursive});
          return __result({
            binName: target.name,
            binNodeId: target.nodeId,
            binPath: target.treePath,
            itemCount: contents.length,
            items: contents
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_full_sequence_info: {
      description: "Get exhaustive information about a sequence: settings, all tracks with lock/mute/target state, all clips with positions/effects/speed/enabled state, all markers, transitions, in/out points, and work area.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}

          // Settings
          var info = {
            name: seq.name,
            id: seq.sequenceID,
            width: seq.frameSizeHorizontal,
            height: seq.frameSizeVertical,
            durationSeconds: __ticksToSeconds(seq.end)
          };

          try {
            var s = seq.getSettings();
            if (s) {
              info.frameRate = s.videoFrameRate;
              info.audioSampleRate = s.audioSampleRate;
              info.audioChannelType = s.audioChannelType;
              info.audioChannelCount = s.audioChannelCount;
              info.videoFieldType = s.videoFieldType;
              info.videoDisplayFormat = s.videoDisplayFormat;
              info.audioDisplayFormat = s.audioDisplayFormat;
            }
          } catch(e) {}

          // Playhead
          try { info.playheadSeconds = __ticksToSeconds(seq.getPlayerPosition().ticks); } catch(e) {}

          // In/Out points
          try { info.inPointSeconds = __ticksToSeconds(seq.getInPoint()); } catch(e) {}
          try { info.outPointSeconds = __ticksToSeconds(seq.getOutPoint()); } catch(e) {}

          // Work area
          try { info.workAreaIn = __ticksToSeconds(seq.getWorkAreaInPoint()); } catch(e) {}
          try { info.workAreaOut = __ticksToSeconds(seq.getWorkAreaOutPoint()); } catch(e) {}

          // Zero point
          try { info.zeroPoint = __ticksToSeconds(seq.zeroPoint); } catch(e) {}

          // Markers
          var markers = [];
          try {
            var m = seq.markers.getFirstMarker();
            while (m) {
              var mInfo = {
                name: m.name,
                comments: m.comments,
                startSeconds: __ticksToSeconds(m.start.ticks),
                endSeconds: __ticksToSeconds(m.end.ticks),
                type: m.type
              };
              try { mInfo.colorIndex = m.getColorByIndex(); } catch(e) {}
              markers.push(mInfo);
              m = seq.markers.getNextMarker(m);
            }
          } catch(e) {}
          info.markers = markers;
          info.markerCount = markers.length;

          // Video tracks
          info.videoTracks = [];
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            var trackInfo = {
              index: t,
              name: track.name,
              isMuted: track.isMuted(),
              isLocked: track.isLocked()
            };
            try { trackInfo.isTargeted = track.isTargeted(); } catch(e) {}

            // Clips
            trackInfo.clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var ci = {
                index: c,
                nodeId: clip.nodeId,
                name: clip.name,
                startSeconds: __ticksToSeconds(clip.start.ticks),
                endSeconds: __ticksToSeconds(clip.end.ticks),
                durationSeconds: __ticksToSeconds(clip.duration.ticks),
                inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
                outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
                mediaType: clip.mediaType
              };
              try { ci.enabled = !clip.isDisabled(); } catch(e) { ci.enabled = true; }
              try { ci.speed = clip.getSpeed(); } catch(e) {}
              try { ci.reversed = clip.isSpeedReversed(); } catch(e) {}
              try { ci.isAdjustmentLayer = clip.isAdjustmentLayer(); } catch(e) {}
              try { ci.isSelected = clip.isSelected(); } catch(e) {}

              // Source media info
              try {
                if (clip.projectItem) {
                  ci.sourceNodeId = clip.projectItem.nodeId;
                  ci.sourceName = clip.projectItem.name;
                  try { ci.sourceMediaPath = clip.projectItem.getMediaPath(); } catch(e) {}
                  try { ci.sourceOffline = clip.projectItem.isOffline(); } catch(e) {}
                }
              } catch(e) {}

              // Effect count
              try {
                ci.effectCount = clip.components.numItems;
                ci.effects = [];
                for (var e = 0; e < clip.components.numItems; e++) {
                  ci.effects.push(clip.components[e].displayName);
                }
              } catch(e) {}

              trackInfo.clips.push(ci);
            }

            // Transitions
            trackInfo.transitions = [];
            try {
              for (var tr = 0; tr < track.transitions.numItems; tr++) {
                var trans = track.transitions[tr];
                trackInfo.transitions.push({
                  index: tr,
                  startSeconds: __ticksToSeconds(trans.start.ticks),
                  endSeconds: __ticksToSeconds(trans.end.ticks),
                  type: trans.type
                });
              }
            } catch(e) {}

            trackInfo.clipCount = trackInfo.clips.length;
            trackInfo.transitionCount = trackInfo.transitions.length;
            info.videoTracks.push(trackInfo);
          }

          // Audio tracks
          info.audioTracks = [];
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            var trackInfo = {
              index: t,
              name: track.name,
              isMuted: track.isMuted(),
              isLocked: track.isLocked()
            };
            try { trackInfo.isTargeted = track.isTargeted(); } catch(e) {}

            trackInfo.clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var ci = {
                index: c,
                nodeId: clip.nodeId,
                name: clip.name,
                startSeconds: __ticksToSeconds(clip.start.ticks),
                endSeconds: __ticksToSeconds(clip.end.ticks),
                durationSeconds: __ticksToSeconds(clip.duration.ticks),
                inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
                outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
                mediaType: clip.mediaType
              };
              try { ci.enabled = !clip.isDisabled(); } catch(e) { ci.enabled = true; }
              try { ci.speed = clip.getSpeed(); } catch(e) {}
              try {
                if (clip.projectItem) {
                  ci.sourceNodeId = clip.projectItem.nodeId;
                  ci.sourceName = clip.projectItem.name;
                  try { ci.sourceMediaPath = clip.projectItem.getMediaPath(); } catch(e) {}
                }
              } catch(e) {}
              try {
                ci.effectCount = clip.components.numItems;
                ci.effects = [];
                for (var e = 0; e < clip.components.numItems; e++) {
                  ci.effects.push(clip.components[e].displayName);
                }
              } catch(e) {}
              trackInfo.clips.push(ci);
            }

            trackInfo.transitions = [];
            try {
              for (var tr = 0; tr < track.transitions.numItems; tr++) {
                var trans = track.transitions[tr];
                trackInfo.transitions.push({
                  index: tr,
                  startSeconds: __ticksToSeconds(trans.start.ticks),
                  endSeconds: __ticksToSeconds(trans.end.ticks)
                });
              }
            } catch(e) {}

            trackInfo.clipCount = trackInfo.clips.length;
            trackInfo.transitionCount = trackInfo.transitions.length;
            info.audioTracks.push(trackInfo);
          }

          info.videoTrackCount = info.videoTracks.length;
          info.audioTrackCount = info.audioTracks.length;

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_full_clip_info: {
      description: "Get exhaustive information about a specific clip: all effects with every property value, source media details, footage interpretation, metadata, markers, speed, enabled state, color label, linked clips, and proxy status.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip on the timeline",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var found = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!found) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");

          var clip = found.clip;
          var info = {
            nodeId: clip.nodeId,
            name: clip.name,
            trackType: found.trackType,
            trackIndex: found.trackIndex,
            clipIndex: found.clipIndex,
            startSeconds: __ticksToSeconds(clip.start.ticks),
            endSeconds: __ticksToSeconds(clip.end.ticks),
            durationSeconds: __ticksToSeconds(clip.duration.ticks),
            inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
            outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
            mediaType: clip.mediaType
          };

          try { info.enabled = !clip.isDisabled(); } catch(e) { info.enabled = true; }
          try { info.speed = clip.getSpeed(); } catch(e) {}
          try { info.reversed = clip.isSpeedReversed(); } catch(e) {}
          try { info.isSelected = clip.isSelected(); } catch(e) {}
          try { info.isAdjustmentLayer = clip.isAdjustmentLayer(); } catch(e) {}

          // Source project item details
          try {
            var src = clip.projectItem;
            if (src) {
              info.source = {
                nodeId: src.nodeId,
                name: src.name,
                treePath: src.treePath
              };
              try { info.source.mediaPath = src.getMediaPath(); } catch(e) {}
              try { info.source.offline = src.isOffline(); } catch(e) {}
              try { info.source.colorLabel = src.getColorLabel(); } catch(e) {}
              try {
                var interp = src.getFootageInterpretation();
                if (interp) {
                  info.source.frameRate = interp.frameRate;
                  info.source.pixelAspectRatio = interp.pixelAspectRatio;
                  info.source.fieldType = interp.fieldType;
                  info.source.alphaUsage = interp.alphaUsage;
                }
              } catch(e) {}
              // XMP metadata
              try {
                var xmp = src.getProjectMetadata();
                if (xmp && xmp.length < 5000) info.source.projectMetadata = xmp;
              } catch(e) {}
              // Proxy info
              try { info.source.hasProxy = src.hasProxy(); } catch(e) {}
              try { info.source.canChangeMediaPath = src.canChangeMediaPath(); } catch(e) {}
            }
          } catch(e) {}

          // All effects/components with full property details
          info.components = [];
          try {
            for (var i = 0; i < clip.components.numItems; i++) {
              var comp = clip.components[i];
              var compInfo = {
                index: i,
                displayName: comp.displayName,
                matchName: comp.matchName,
                properties: []
              };
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var propInfo = {
                  index: p,
                  displayName: prop.displayName
                };
                try { propInfo.matchName = prop.matchName; } catch(e) {}
                try { propInfo.value = prop.getValue(0, 0); } catch(e) {}
                try { propInfo.isTimeVarying = prop.isTimeVarying(); } catch(e) {}
                try { propInfo.keyframesSupported = prop.areKeyframesSupported(); } catch(e) {}
                try {
                  if (prop.isTimeVarying()) {
                    var keys = prop.getKeys();
                    if (keys && keys.length > 0) {
                      propInfo.keyframeCount = keys.length;
                      propInfo.keyframeTimes = [];
                      for (var k = 0; k < Math.min(keys.length, 20); k++) {
                        propInfo.keyframeTimes.push(__ticksToSeconds(keys[k].ticks));
                      }
                      if (keys.length > 20) propInfo.keyframesTruncated = true;
                    }
                  }
                } catch(e) {}
                compInfo.properties.push(propInfo);
              }
              info.components.push(compInfo);
            }
          } catch(e) {}
          info.componentCount = info.components.length;

          // Clip markers
          info.markers = [];
          try {
            var m = clip.markers.getFirstMarker();
            while (m) {
              info.markers.push({
                name: m.name,
                comments: m.comments,
                startSeconds: __ticksToSeconds(m.start.ticks),
                endSeconds: __ticksToSeconds(m.end.ticks)
              });
              m = clip.markers.getNextMarker(m);
            }
          } catch(e) {}

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_project_item_info: {
      description: "Get detailed information about a project item (media file in the project panel): media path, resolution, duration, frame rate, codec info, metadata, color label, offline status, in/out points, and proxy status.",
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
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");

          var info = {
            nodeId: item.nodeId,
            name: item.name,
            type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 3 ? "root" : item.type === 4 ? "file" : "unknown",
            treePath: item.treePath
          };

          try { info.mediaPath = item.getMediaPath(); } catch(e) {}
          try { info.offline = item.isOffline(); } catch(e) {}
          try { info.colorLabel = item.getColorLabel(); } catch(e) {}
          try { info.canChangeMediaPath = item.canChangeMediaPath(); } catch(e) {}

          // Footage interpretation
          try {
            var interp = item.getFootageInterpretation();
            if (interp) {
              info.frameRate = interp.frameRate;
              info.pixelAspectRatio = interp.pixelAspectRatio;
              info.fieldType = interp.fieldType;
              info.alphaUsage = interp.alphaUsage;
              info.ignoreAlpha = interp.ignoreAlpha;
              info.invertAlpha = interp.invertAlpha;
            }
          } catch(e) {}

          // In/Out points
          try { info.inPoint = __ticksToSeconds(item.getInPoint().ticks); } catch(e) {}
          try { info.outPoint = __ticksToSeconds(item.getOutPoint().ticks); } catch(e) {}

          // Proxy
          try { info.hasProxy = item.hasProxy(); } catch(e) {}

          // Project metadata (XMP)
          try {
            var xmp = item.getProjectMetadata();
            if (xmp && xmp.length < 10000) info.projectMetadata = xmp;
            else if (xmp) info.projectMetadataLength = xmp.length;
          } catch(e) {}

          // XMP metadata
          try {
            var xmp2 = item.getXMPMetadata();
            if (xmp2 && xmp2.length < 10000) info.xmpMetadata = xmp2;
            else if (xmp2) info.xmpMetadataLength = xmp2.length;
          } catch(e) {}

          // Item markers
          info.markers = [];
          try {
            var m = item.getMarkers();
            if (m) {
              var marker = m.getFirstMarker();
              while (marker) {
                info.markers.push({
                  name: marker.name,
                  comments: marker.comments,
                  startSeconds: __ticksToSeconds(marker.start.ticks)
                });
                marker = m.getNextMarker(marker);
              }
            }
          } catch(e) {}

          // Child count for bins
          if (item.type === 2) {
            info.childCount = item.children.numItems;
          }

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    search_project_items: {
      description: "Search for project items by name, media file extension, offline status, or color label. Returns matching items with full details.",
      parameters: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (matched against item name, case-insensitive substring match)",
          },
          extension: {
            type: "string",
            description: "Filter by file extension (e.g., 'mp4', 'wav', 'png'). Without dot.",
          },
          offline_only: {
            type: "boolean",
            description: "If true, only return offline/missing items",
          },
          color_label: {
            type: "number",
            description: "Filter by color label index (0-15)",
          },
          item_type: {
            type: "string",
            enum: ["clip", "bin", "all"],
            description: "Filter by item type (default: all)",
          },
          max_results: {
            type: "number",
            description: "Maximum results to return (default: 100)",
          },
        },
      },
      handler: async (args: {
        query?: string;
        extension?: string;
        offline_only?: boolean;
        color_label?: number;
        item_type?: string;
        max_results?: number;
      }) => {
        const maxResults = args.max_results ?? 100;
        const script = buildToolScript(`
          var results = [];
          var maxR = ${maxResults};
          var query = ${args.query ? `"${escapeForExtendScript(args.query)}".toLowerCase()` : "null"};
          var ext = ${args.extension ? `"${escapeForExtendScript(args.extension)}".toLowerCase()` : "null"};
          var offlineOnly = ${args.offline_only ? "true" : "false"};
          var colorFilter = ${args.color_label !== undefined ? args.color_label : "-1"};
          var typeFilter = "${args.item_type || "all"}";

          function searchBin(bin) {
            if (results.length >= maxR) return;
            for (var i = 0; i < bin.children.numItems; i++) {
              if (results.length >= maxR) return;
              var item = bin.children[i];

              // Type filter
              if (typeFilter === "clip" && item.type === 2) {
                searchBin(item);
                continue;
              }
              if (typeFilter === "bin" && item.type !== 2) continue;

              var match = true;

              // Name filter
              if (query && item.name.toLowerCase().indexOf(query) === -1) match = false;

              // Extension filter
              if (match && ext) {
                try {
                  var mp = item.getMediaPath();
                  if (!mp || mp.split(".").pop().toLowerCase() !== ext) match = false;
                } catch(e) { match = false; }
              }

              // Offline filter
              if (match && offlineOnly) {
                try { if (!item.isOffline()) match = false; } catch(e) { match = false; }
              }

              // Color label filter
              if (match && colorFilter >= 0) {
                try { if (item.getColorLabel() !== colorFilter) match = false; } catch(e) { match = false; }
              }

              if (match) {
                var entry = {
                  nodeId: item.nodeId,
                  name: item.name,
                  type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 4 ? "file" : "unknown",
                  treePath: item.treePath
                };
                try { entry.mediaPath = item.getMediaPath(); } catch(e) {}
                try { entry.offline = item.isOffline(); } catch(e) {}
                try { entry.colorLabel = item.getColorLabel(); } catch(e) {}
                results.push(entry);
              }

              if (item.type === 2) searchBin(item);
            }
          }

          searchBin(app.project.rootItem);
          return __result({ resultCount: results.length, maxResults: maxR, items: results });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_timeline_gaps: {
      description: "Find all gaps (empty spaces) on the timeline between clips. Useful for identifying where content is missing or where clips can be tightened.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which track type to analyze (default: both)",
          },
          min_gap_seconds: {
            type: "number",
            description: "Minimum gap duration in seconds to report (default: 0.04 = ~1 frame at 24fps)",
          },
        },
      },
      handler: async (args: { sequence_id?: string; track_type?: string; min_gap_seconds?: number }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
        const minGap = args.min_gap_seconds ?? 0.04;
        const trackType = args.track_type || "both";

        const script = buildToolScript(`
          ${seqLookup}

          var gaps = [];
          var minGapTicks = __secondsToTicks(${minGap});

          function findGaps(tracks, type) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              if (track.clips.numItems === 0) continue;
              var prevEnd = 0;
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var startTicks = parseFloat(clip.start.ticks);
                var endTicks = parseFloat(clip.end.ticks);
                var gapTicks = startTicks - prevEnd;
                if (gapTicks > minGapTicks) {
                  gaps.push({
                    trackType: type,
                    trackIndex: t,
                    trackName: track.name,
                    gapStartSeconds: __ticksToSeconds("" + prevEnd),
                    gapEndSeconds: __ticksToSeconds("" + startTicks),
                    gapDurationSeconds: __ticksToSeconds("" + gapTicks),
                    beforeClip: c > 0 ? track.clips[c - 1].name : null,
                    afterClip: clip.name
                  });
                }
                prevEnd = endTicks;
              }
            }
          }

          if ("${trackType}" !== "audio") findGaps(seq.videoTracks, "video");
          if ("${trackType}" !== "video") findGaps(seq.audioTracks, "audio");

          return __result({
            sequenceName: seq.name,
            gapCount: gaps.length,
            minGapSeconds: ${minGap},
            gaps: gaps
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_timeline_summary: {
      description: "Get a human-readable summary of the timeline: total duration, clip count per track, total gaps, coverage percentage, used media files, effect usage, and marker overview. Great for a quick understanding of sequence state.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}

          var summary = {
            name: seq.name,
            id: seq.sequenceID,
            resolution: seq.frameSizeHorizontal + "x" + seq.frameSizeVertical,
            durationSeconds: __ticksToSeconds(seq.end)
          };

          try {
            var s = seq.getSettings();
            if (s) summary.frameRate = s.videoFrameRate;
          } catch(e) {}

          // Playhead
          try { summary.playheadSeconds = __ticksToSeconds(seq.getPlayerPosition().ticks); } catch(e) {}

          var totalVideoClips = 0;
          var totalAudioClips = 0;
          var usedMedia = {};
          var effectUsage = {};
          var disabledClips = 0;
          var totalVideoFilled = 0;
          var seqEndTicks = parseFloat(seq.end);

          // Video tracks
          var videoTrackSummary = [];
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            var trackFilled = 0;
            for (var c = 0; c < track.clips.numItems; c++) {
              totalVideoClips++;
              var clip = track.clips[c];
              trackFilled += parseFloat(clip.end.ticks) - parseFloat(clip.start.ticks);
              try { if (clip.isDisabled()) disabledClips++; } catch(e) {}
              try {
                if (clip.projectItem) {
                  var srcName = clip.projectItem.name;
                  if (!usedMedia[srcName]) usedMedia[srcName] = 0;
                  usedMedia[srcName]++;
                }
              } catch(e) {}
              try {
                for (var e = 0; e < clip.components.numItems; e++) {
                  var eName = clip.components[e].displayName;
                  if (!effectUsage[eName]) effectUsage[eName] = 0;
                  effectUsage[eName]++;
                }
              } catch(e) {}
            }
            if (t === 0) totalVideoFilled = trackFilled;
            videoTrackSummary.push({
              index: t,
              name: track.name,
              clipCount: track.clips.numItems,
              muted: track.isMuted(),
              locked: track.isLocked()
            });
          }

          // Audio tracks
          var audioTrackSummary = [];
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              totalAudioClips++;
              try {
                if (clip.projectItem) {
                  var srcName = clip.projectItem.name;
                  if (!usedMedia[srcName]) usedMedia[srcName] = 0;
                  usedMedia[srcName]++;
                }
              } catch(e) {}
            }
            audioTrackSummary.push({
              index: t,
              name: track.name,
              clipCount: track.clips.numItems,
              muted: track.isMuted(),
              locked: track.isLocked()
            });
          }

          summary.totalVideoClips = totalVideoClips;
          summary.totalAudioClips = totalAudioClips;
          summary.totalClips = totalVideoClips + totalAudioClips;
          summary.disabledClips = disabledClips;
          summary.videoTrackCount = seq.videoTracks.numTracks;
          summary.audioTrackCount = seq.audioTracks.numTracks;
          summary.videoTracks = videoTrackSummary;
          summary.audioTracks = audioTrackSummary;

          // V1 coverage
          if (seqEndTicks > 0) {
            summary.v1CoveragePercent = Math.round((totalVideoFilled / seqEndTicks) * 10000) / 100;
          }

          // Used media
          var mediaList = [];
          for (var name in usedMedia) {
            if (usedMedia.hasOwnProperty(name)) {
              mediaList.push({ name: name, useCount: usedMedia[name] });
            }
          }
          summary.usedMedia = mediaList;
          summary.uniqueMediaCount = mediaList.length;

          // Effect usage
          var effectList = [];
          for (var name in effectUsage) {
            if (effectUsage.hasOwnProperty(name)) {
              effectList.push({ name: name, count: effectUsage[name] });
            }
          }
          summary.effectUsage = effectList;

          // Markers
          var markerCount = 0;
          try {
            var m = seq.markers.getFirstMarker();
            while (m) { markerCount++; m = seq.markers.getNextMarker(m); }
          } catch(e) {}
          summary.markerCount = markerCount;

          return __result(summary);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_offline_media: {
      description: "Find all offline/missing media in the project with their expected file paths. Essential for diagnosing broken links.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var offline = [];
          function scan(bin) {
            for (var i = 0; i < bin.children.numItems; i++) {
              var item = bin.children[i];
              try {
                if (item.isOffline()) {
                  var entry = {
                    nodeId: item.nodeId,
                    name: item.name,
                    treePath: item.treePath
                  };
                  try { entry.mediaPath = item.getMediaPath(); } catch(e) {}
                  try { entry.colorLabel = item.getColorLabel(); } catch(e) {}
                  offline.push(entry);
                }
              } catch(e) {}
              if (item.type === 2) scan(item);
            }
          }
          scan(app.project.rootItem);
          return __result({ offlineCount: offline.length, items: offline });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_used_media_report: {
      description: "Get a report of all media files used in a sequence: which source files are used, how many times each appears, on which tracks, and whether any sources are offline.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}

          var mediaMap = {};

          function scanTracks(tracks, trackType) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                try {
                  var src = clip.projectItem;
                  if (!src) continue;
                  var key = src.nodeId;
                  if (!mediaMap[key]) {
                    mediaMap[key] = {
                      nodeId: src.nodeId,
                      name: src.name,
                      mediaPath: "",
                      offline: false,
                      useCount: 0,
                      tracks: []
                    };
                    try { mediaMap[key].mediaPath = src.getMediaPath(); } catch(e) {}
                    try { mediaMap[key].offline = src.isOffline(); } catch(e) {}
                  }
                  mediaMap[key].useCount++;
                  mediaMap[key].tracks.push(trackType + " " + t);
                } catch(e) {}
              }
            }
          }

          scanTracks(seq.videoTracks, "V");
          scanTracks(seq.audioTracks, "A");

          var report = [];
          var offlineUsed = 0;
          for (var key in mediaMap) {
            if (mediaMap.hasOwnProperty(key)) {
              // Deduplicate track list
              var unique = {};
              for (var i = 0; i < mediaMap[key].tracks.length; i++) {
                unique[mediaMap[key].tracks[i]] = true;
              }
              var trackList = [];
              for (var k in unique) { if (unique.hasOwnProperty(k)) trackList.push(k); }
              mediaMap[key].tracks = trackList;
              if (mediaMap[key].offline) offlineUsed++;
              report.push(mediaMap[key]);
            }
          }

          return __result({
            sequenceName: seq.name,
            uniqueMediaCount: report.length,
            offlineUsedCount: offlineUsed,
            media: report
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
