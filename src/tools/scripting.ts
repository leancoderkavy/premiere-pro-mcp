import { buildToolScript, buildScript } from "../bridge/script-builder.js";
import { sendCommand, sendRawCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getScriptingTools(bridgeOptions: BridgeOptions) {
  return {
    execute_extendscript: {
      description: `Execute custom ExtendScript code in Premiere Pro. The code runs inside an IIFE with helper functions available.

IMPORTANT: You MUST write ES3 syntax (var instead of let/const, no arrow functions, no template literals, no destructuring).

Available helpers (auto-prepended):
- __ticksToSeconds(ticks) / __secondsToTicks(seconds) — time conversion
- __ticksToTimecode(ticks, fps) — timecode string
- __findSequence(idOrName) — find sequence by name or ID
- __findProjectItem(nodeIdOrName) — find project item recursively
- __findClip(nodeId) — find clip in active sequence, returns {clip, trackIndex, clipIndex, trackType}
- __getAllClips(seq) — get all clips in a sequence
- __result(data) — return success with data (MUST call this or __error)
- __error(msg) — return error message
- TICKS_PER_SECOND — constant 254016000000
- app.enableQE() — enable QE DOM access

Your code MUST end with: return __result({...}) or return __error("message")

Example: Set opacity to 50% on all video clips
  var seq = app.project.activeSequence;
  if (!seq) return __error("No active sequence");
  var count = 0;
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      for (var i = 0; i < clip.components.numItems; i++) {
        var comp = clip.components[i];
        if (comp.displayName === "Opacity") {
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "Opacity") {
              comp.properties[p].setValue(50, true);
              count++;
            }
          }
        }
      }
    }
  }
  return __result({updated: count});`,
      parameters: {
        type: "object" as const,
        properties: {
          code: {
            type: "string",
            description: "ExtendScript code to execute (ES3 syntax). Must use return __result({...}) or return __error('...'). Helpers are auto-prepended.",
          },
          timeout_ms: {
            type: "number",
            description: "Custom timeout in milliseconds (default: 30000). Increase for long operations.",
          },
        },
        required: ["code"],
      },
      handler: async (args: { code: string; timeout_ms?: number }) => {
        const script = buildToolScript(args.code);
        const opts = { ...bridgeOptions };
        if (args.timeout_ms) {
          opts.timeoutMs = args.timeout_ms;
        }
        return sendRawCommand(script, opts);
      },
    },

    evaluate_expression: {
      description: `Evaluate a simple ExtendScript expression and return its value. Use for quick queries like checking a property, getting a count, or reading state. The expression should be a single value/call — NOT a full script.

Examples:
- "app.project.name" → project name
- "app.project.activeSequence.name" → active sequence name
- "app.project.rootItem.children.numItems" → number of root items
- "app.project.activeSequence.videoTracks.numTracks" → number of video tracks
- "app.version" → Premiere Pro version`,
      parameters: {
        type: "object" as const,
        properties: {
          expression: {
            type: "string",
            description: "ExtendScript expression to evaluate (e.g., 'app.project.name')",
          },
        },
        required: ["expression"],
      },
      handler: async (args: { expression: string }) => {
        const script = buildToolScript(`
          try {
            var val = ${args.expression};
            return __result({ value: val, type: typeof val });
          } catch(e) {
            return __error("Expression error: " + e.toString());
          }
        `);
        return sendRawCommand(script, bridgeOptions);
      },
    },

    inspect_dom_object: {
      description: `Inspect a Premiere Pro DOM object and list its properties, methods, and values. Useful for exploring the API and debugging.

Examples:
- "app.project" → project properties
- "app.project.activeSequence" → sequence properties
- "app.project.activeSequence.videoTracks[0].clips[0]" → first clip on V1
- "app.project.activeSequence.videoTracks[0].clips[0].components[0]" → first component of a clip`,
      parameters: {
        type: "object" as const,
        properties: {
          object_path: {
            type: "string",
            description: "Dot-path to the DOM object to inspect (e.g., 'app.project.activeSequence')",
          },
          max_depth: {
            type: "number",
            description: "Max depth for nested inspection (default: 1, max: 3)",
          },
        },
        required: ["object_path"],
      },
      handler: async (args: { object_path: string; max_depth?: number }) => {
        const maxDepth = Math.min(args.max_depth ?? 1, 3);
        const script = buildToolScript(`
          function inspectObj(obj, depth, maxD) {
            if (depth > maxD) return "<max depth>";
            if (obj === null) return null;
            if (obj === undefined) return undefined;
            var t = typeof obj;
            if (t === "string" || t === "number" || t === "boolean") return obj;
            
            var result = {};
            var propCount = 0;
            try {
              for (var key in obj) {
                if (propCount > 50) {
                  result["__truncated"] = true;
                  break;
                }
                try {
                  var val = obj[key];
                  var vt = typeof val;
                  if (vt === "function") {
                    result[key] = "[function]";
                  } else if (vt === "object" && val !== null) {
                    if (depth < maxD) {
                      result[key] = inspectObj(val, depth + 1, maxD);
                    } else {
                      result[key] = "[object]";
                    }
                  } else {
                    result[key] = val;
                  }
                } catch(e) {
                  result[key] = "[error: " + e.toString() + "]";
                }
                propCount++;
              }
            } catch(e) {
              return { __error: e.toString() };
            }
            
            // Also try common collection properties
            try { if (obj.numItems !== undefined) result["numItems"] = obj.numItems; } catch(e) {}
            try { if (obj.numTracks !== undefined) result["numTracks"] = obj.numTracks; } catch(e) {}
            try { if (obj.numSequences !== undefined) result["numSequences"] = obj.numSequences; } catch(e) {}
            try { if (obj.length !== undefined) result["length"] = obj.length; } catch(e) {}
            try { if (obj.name !== undefined) result["name"] = obj.name; } catch(e) {}
            try { if (obj.displayName !== undefined) result["displayName"] = obj.displayName; } catch(e) {}
            try { if (obj.matchName !== undefined) result["matchName"] = obj.matchName; } catch(e) {}
            try { if (obj.nodeId !== undefined) result["nodeId"] = obj.nodeId; } catch(e) {}
            
            return result;
          }
          
          try {
            var obj = ${args.object_path};
            if (obj === null || obj === undefined) return __error("Object is null or undefined: ${args.object_path}");
            var inspection = inspectObj(obj, 0, ${maxDepth});
            return __result({
              path: "${args.object_path}",
              type: typeof obj,
              inspection: inspection
            });
          } catch(e) {
            return __error("Cannot access: ${args.object_path} — " + e.toString());
          }
        `);
        return sendRawCommand(script, bridgeOptions);
      },
    },

    list_clip_effects: {
      description: "List all effects/components on a clip with their properties and current values. Essential for debugging effect issues.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to inspect",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${args.node_id}");
          if (!result) return __error("Clip not found: ${args.node_id}");
          
          var clip = result.clip;
          var components = [];
          
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            var props = [];
            for (var p = 0; p < comp.properties.numItems; p++) {
              var prop = comp.properties[p];
              var info = {
                index: p,
                displayName: prop.displayName,
                matchName: ""
              };
              try { info.matchName = prop.matchName; } catch(e) {}
              try { info.value = prop.getValue(0, 0); } catch(e) {}
              try { info.isTimeVarying = prop.isTimeVarying(); } catch(e) {}
              try { info.keyframesSupported = prop.areKeyframesSupported(); } catch(e) {}
              props.push(info);
            }
            components.push({
              index: i,
              displayName: comp.displayName,
              matchName: comp.matchName,
              properties: props
            });
          }
          
          return __result({
            clipName: clip.name,
            nodeId: clip.nodeId,
            trackType: result.trackType,
            trackIndex: result.trackIndex,
            componentCount: components.length,
            components: components
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_sequence_structure: {
      description: "Get a complete structural overview of the active sequence: all tracks, all clips with positions, gaps, and clip metadata. Essential for understanding timeline state before making edits.",
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
          ? `var seq = __findSequence("${args.sequence_id}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          
          var videoTracks = [];
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var clipInfo = {
                index: c,
                nodeId: clip.nodeId,
                name: clip.name,
                startSeconds: __ticksToSeconds(clip.start.ticks),
                endSeconds: __ticksToSeconds(clip.end.ticks),
                durationSeconds: __ticksToSeconds(clip.duration.ticks),
                inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
                outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
                mediaType: clip.mediaType,
                enabled: true
              };
              try { clipInfo.enabled = !clip.isDisabled(); } catch(e) {}
              try { clipInfo.speed = clip.getSpeed(); } catch(e) {}
              clips.push(clipInfo);
            }
            videoTracks.push({
              index: t,
              name: track.name,
              clipCount: clips.length,
              clips: clips,
              isMuted: track.isMuted(),
              isLocked: track.isLocked()
            });
          }
          
          var audioTracks = [];
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              clips.push({
                index: c,
                nodeId: clip.nodeId,
                name: clip.name,
                startSeconds: __ticksToSeconds(clip.start.ticks),
                endSeconds: __ticksToSeconds(clip.end.ticks),
                durationSeconds: __ticksToSeconds(clip.duration.ticks),
                inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
                outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
                mediaType: clip.mediaType
              });
            }
            audioTracks.push({
              index: t,
              name: track.name,
              clipCount: clips.length,
              clips: clips,
              isMuted: track.isMuted(),
              isLocked: track.isLocked()
            });
          }
          
          return __result({
            name: seq.name,
            id: seq.sequenceID,
            durationSeconds: __ticksToSeconds(seq.end),
            videoTrackCount: videoTracks.length,
            audioTrackCount: audioTracks.length,
            videoTracks: videoTracks,
            audioTracks: audioTracks
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_premiere_state: {
      description: "Get a comprehensive snapshot of the current Premiere Pro state: project info, active sequence, playhead position, selected clips, and available sequences. The best first call to understand the current context.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var state = {};
          
          // Project info
          var project = app.project;
          if (!project) return __error("No project is open");
          state.project = {
            name: project.name,
            path: project.path,
            rootItemCount: project.rootItem.children.numItems,
            sequenceCount: project.sequences.numSequences
          };
          
          // List all sequences
          state.sequences = [];
          for (var i = 0; i < project.sequences.numSequences; i++) {
            var seq = project.sequences[i];
            state.sequences.push({
              name: seq.name,
              id: seq.sequenceID,
              duration: __ticksToSeconds(seq.end)
            });
          }
          
          // Active sequence
          var active = project.activeSequence;
          if (active) {
            state.activeSequence = {
              name: active.name,
              id: active.sequenceID,
              durationSeconds: __ticksToSeconds(active.end),
              videoTrackCount: active.videoTracks.numTracks,
              audioTrackCount: active.audioTracks.numTracks
            };
            
            // Playhead
            try {
              var playerPos = active.getPlayerPosition();
              state.playheadSeconds = __ticksToSeconds(playerPos.ticks);
            } catch(e) {}
            
            // Selected clips
            try {
              var sel = active.getSelection();
              state.selectedClips = [];
              for (var i = 0; i < sel.length; i++) {
                state.selectedClips.push({
                  nodeId: sel[i].nodeId,
                  name: sel[i].name
                });
              }
            } catch(e) {
              state.selectedClips = [];
            }
            
            // Quick clip count
            var totalClips = 0;
            for (var t = 0; t < active.videoTracks.numTracks; t++) {
              totalClips += active.videoTracks[t].clips.numItems;
            }
            for (var t = 0; t < active.audioTracks.numTracks; t++) {
              totalClips += active.audioTracks[t].clips.numItems;
            }
            state.activeSequence.totalClipCount = totalClips;
          } else {
            state.activeSequence = null;
          }
          
          // Premiere version
          try { state.version = app.version; } catch(e) {}
          try { state.buildNumber = app.build; } catch(e) {}
          
          return __result(state);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
