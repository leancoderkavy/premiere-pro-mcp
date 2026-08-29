import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Find a default .sqpreset on this machine for create_sequence without preset_path.
 *
 * Every sequence-creation route that lets Premiere pick settings interactively is
 * unusable from scripting: app.project.createNewSequence(name, id) opens the modal
 * New Sequence dialog in Premiere 26 (verified on 26.2.2 — even with a UUID id),
 * which freezes the shared ExtendScript engine until a human dismisses it. So the
 * no-preset path must still resolve to a concrete preset file.
 */
let cachedDefaultPreset: string | null | undefined;
export function findDefaultSequencePreset(): string | null {
  if (cachedDefaultPreset !== undefined) return cachedDefaultPreset;

  if (process.env.PREMIERE_DEFAULT_SEQUENCE_PRESET && existsSync(process.env.PREMIERE_DEFAULT_SEQUENCE_PRESET)) {
    return (cachedDefaultPreset = process.env.PREMIERE_DEFAULT_SEQUENCE_PRESET);
  }

  const roots: string[] = [];
  const appDirs =
    process.platform === "darwin"
      ? { base: "/Applications", match: /^Adobe Premiere Pro/ }
      : { base: "C:\\Program Files\\Adobe", match: /^Adobe Premiere Pro/ };
  try {
    for (const dir of readdirSync(appDirs.base)) {
      if (!appDirs.match.test(dir)) continue;
      const appRoot = join(appDirs.base, dir);
      if (process.platform === "darwin") {
        for (const inner of readdirSync(appRoot)) {
          if (inner.endsWith(".app")) roots.push(join(appRoot, inner, "Contents", "Settings", "SequencePresets"));
        }
      } else {
        roots.push(join(appRoot, "Settings", "SequencePresets"));
      }
    }
  } catch {
    /* fall through */
  }

  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
        else if (entry.endsWith(".sqpreset")) found.push(p);
      } catch {
        /* skip unreadable */
      }
    }
  };
  for (const root of roots.sort().reverse()) walk(root, 0); // newest app version first

  // Prefer a plain HD/UHD progressive preset; otherwise take anything.
  const preferred =
    found.find((p) => /UHD \(4K\) 2160p 25 fps\.sqpreset$/.test(p)) ||
    found.find((p) => /2160p 25|1080p 25/.test(p)) ||
    found.find((p) => /2160p|1080p/.test(p)) ||
    found[0] ||
    null;
  return (cachedDefaultPreset = preferred);
}

export function getSequenceTools(bridgeOptions: BridgeOptions) {
  return {
    create_sequence: {
      description: "Create a new sequence in the project",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          preset_path: {
            type: "string",
            description:
              "Optional path to a sequence preset file (.sqpreset). If omitted, a default preset is discovered from the Premiere installation (override with PREMIERE_DEFAULT_SEQUENCE_PRESET).",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; preset_path?: string }) => {
        // app.project.createNewSequenceFromPreset does not exist in Premiere Pro
        // (verified missing in 26.x), and createNewSequence(name, id) opens the
        // modal New Sequence dialog there — every creation goes through the QE DOM
        // with an explicit preset. See findDefaultSequencePreset().
        const presetPath = args.preset_path || findDefaultSequencePreset();
        if (!presetPath) {
          return {
            success: false,
            error:
              "No sequence preset found. Pass preset_path (an .sqpreset file) or set PREMIERE_DEFAULT_SEQUENCE_PRESET — " +
              "creating a sequence without a preset opens a modal dialog in Premiere 26+, which would freeze scripting.",
          };
        }

        const script = buildToolScript(`
          app.enableQE();
          qe.project.newSequence("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(presetPath)}");
          var seq = app.project.activeSequence;
          if (!seq || seq.name !== "${escapeForExtendScript(args.name)}") {
            return __error("Failed to create sequence from preset: ${escapeForExtendScript(presetPath)}");
          }
          return __result({ created: true, name: seq.name, id: seq.sequenceID, presetUsed: "${escapeForExtendScript(presetPath)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    duplicate_sequence: {
      description: "Duplicate an existing sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to duplicate",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");
          
          seq.clone();
          return __result({ duplicated: true, originalName: seq.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_sequence: {
      description: "Delete a sequence from the project",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to delete",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var project = app.project;
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");
          var sequenceId = String(seq.sequenceID);
          var name = seq.name;
          var accepted = project.deleteSequence(seq);
          if (accepted === false) return __error("Premiere rejected deletion of sequence: " + name);
          if (__findSequence(sequenceId)) {
            return __error("Premiere did not remove sequence: " + name + ". The deletion is not reported as successful.");
          }
          return __result({ deleted: true, verified: true, name: name, id: sequenceId });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_settings: {
      description: "Modify and read back sequence frame-size settings.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
          width: {
            type: "number",
            description: "Frame width in pixels",
          },
          height: {
            type: "number",
            description: "Frame height in pixels",
          },
        },
      },
      handler: async (args: { sequence_id?: string; width?: number; height?: number }) => {
        if (args.width === undefined && args.height === undefined) {
          return { success: false, error: "Pass width, height, or both" };
        }
        for (const [name, value] of Object.entries({ width: args.width, height: args.height })) {
          if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 16384)) {
            return { success: false, error: `${name} must be an integer from 1 through 16384` };
          }
        }
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");
          ${args.width === undefined ? "" : `settings.videoFrameWidth = ${args.width};`}
          ${args.height === undefined ? "" : `settings.videoFrameHeight = ${args.height};`}
          var accepted = seq.setSettings(settings);
          if (accepted === false) return __error("Premiere rejected the requested sequence settings");
          var applied = seq.getSettings();
          if (!applied) return __error("Premiere did not return sequence settings after the update");
          var appliedWidth = Number(applied.videoFrameWidth);
          var appliedHeight = Number(applied.videoFrameHeight);
          ${args.width === undefined ? "" : `if (appliedWidth !== ${args.width}) return __error("Premiere did not apply the requested frame width: expected ${args.width}, got " + appliedWidth);`}
          ${args.height === undefined ? "" : `if (appliedHeight !== ${args.height}) return __error("Premiere did not apply the requested frame height: expected ${args.height}, got " + appliedHeight);`}
          return __result({ updated: true, verified: true, name: seq.name, width: appliedWidth, height: appliedHeight });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_subsequence: {
      description:
        "Create a separate subsequence from selected clips or a time range. This Premiere API does not replace the original timeline clips with a nested-sequence reference.",
      parameters: {
        type: "object" as const,
        properties: {
          ignore_track_targeting: {
            type: "boolean",
            description: "Whether to ignore track targeting (default: false)",
          },
        },
      },
      handler: async (args: { ignore_track_targeting?: boolean }) => {
        const script = buildToolScript(`
          var seq = __getCurrentActiveSequence();
          if (!seq) return __error("No active sequence");

          var before = [];
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            before.push(String(app.project.sequences[i].sequenceID));
          }
          var newSeq = seq.createSubsequence(${args.ignore_track_targeting ? "true" : "false"});
          if (!newSeq) return __error("Failed to create subsequence");
          var newId = String(newSeq.sequenceID);
          var exists = false;
          for (var j = 0; j < app.project.sequences.numSequences; j++) {
            if (String(app.project.sequences[j].sequenceID) === newId) {
              exists = true;
              break;
            }
          }
          if (!exists || before.indexOf(newId) !== -1) {
            return __error("Premiere did not expose a newly created subsequence in the current project");
          }
          return __result({
            created: true,
            verified: true,
            nested: false,
            name: newSeq.name,
            id: newSeq.sequenceID,
            note: "The source timeline selection is intentionally unchanged; use Premiere's Nest command for replacement behavior."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    auto_reframe_sequence: {
      description: "Auto-reframe a sequence for a different aspect ratio",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to reframe. Uses active sequence if omitted.",
          },
          target_width: {
            type: "number",
            description: "Target frame width in pixels",
          },
          target_height: {
            type: "number",
            description: "Target frame height in pixels",
          },
          motion_preset: {
            type: "string",
            enum: ["slower", "default", "faster"],
            description: "Premiere Auto Reframe motion preset (default: default)",
          },
          new_name: {
            type: "string",
            description: "Name for the newly created auto-reframed sequence",
          },
          use_nested_sequences: {
            type: "boolean",
            description: "Whether Auto Reframe should honor nested sequences (default: false)",
          },
        },
        required: ["target_width", "target_height"],
      },
      handler: async (args: {
        sequence_id?: string;
        target_width: number;
        target_height: number;
        motion_preset?: "slower" | "default" | "faster";
        new_name?: string;
        use_nested_sequences?: boolean;
      }) => {
        if (!Number.isInteger(args.target_width) || !Number.isInteger(args.target_height)
          || args.target_width < 1 || args.target_height < 1) {
          return { success: false, error: "target_width and target_height must be positive integers" };
        }
        let a = args.target_width;
        let b = args.target_height;
        while (b !== 0) [a, b] = [b, a % b];
        const numerator = args.target_width / a;
        const denominator = args.target_height / a;
        const motionPreset = args.motion_preset ?? "default";
        const requestedName = args.new_name?.trim();
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var newName = "${escapeForExtendScript(requestedName || "")}" || (seq.name + " - Auto Reframe ${numerator}x${denominator}");
          var reframed = seq.autoReframeSequence(${numerator}, ${denominator}, "${motionPreset}", newName, ${args.use_nested_sequences === true});
          if (!reframed) return __error("Premiere did not create an auto-reframed sequence");
          return __result({
            reframed: true,
            sourceName: seq.name,
            name: reframed.name,
            id: reframed.sequenceID,
            requestedAspectRatio: "${numerator}:${denominator}",
            observedWidth: reframed.frameSizeHorizontal,
            observedHeight: reframed.frameSizeVertical
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unnest_sequence: {
      description: "Unnest a nested sequence on the timeline, replacing it with the contents of the nested sequence",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the nested sequence clip on the timeline to unnest",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var seq = __getCurrentActiveSequence();
          if (!seq) return __error("No active sequence");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var clipName = clip.name;
          var projectItem = clip.projectItem;
          
          if (!projectItem) return __error("Cannot find project item for this clip");
          
          // Check if the project item is a sequence (type 3 = sequence)
          // For nested sequences, the projectItem should reference another sequence
          var nestedSeq = null;
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            var s = app.project.sequences[i];
            if (s.name === projectItem.name || s.sequenceID === projectItem.nodeId) {
              nestedSeq = s;
              break;
            }
          }
          
          if (!nestedSeq) return __error("Clip is not a nested sequence: " + clipName);
          
          var startTicks = String(clip.start.ticks);
          var endTicks = String(clip.end.ticks);
          var nestedProjectItemId = String(projectItem.nodeId);
          var linkedReferences = [];
          function collectLinkedReferences(tracks, mediaType) {
            for (var trackIndex = 0; trackIndex < tracks.numTracks; trackIndex++) {
              var track = tracks[trackIndex];
              for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
                var candidate = track.clips[clipIndex];
                try {
                  if (candidate.projectItem &&
                      String(candidate.projectItem.nodeId) === nestedProjectItemId &&
                      String(candidate.start.ticks) === startTicks &&
                      String(candidate.end.ticks) === endTicks) {
                    linkedReferences.push({ clip: candidate, trackIndex: trackIndex, mediaType: mediaType });
                  }
                } catch (e) {}
              }
            }
          }
          collectLinkedReferences(seq.videoTracks, "video");
          collectLinkedReferences(seq.audioTracks, "audio");
          if (linkedReferences.length !== 1) {
            return __error(
              "Legacy CEP cannot atomically unnest linked video and audio references. " +
              "No clips were changed; use Premiere's Unnest command to preserve linked tracks."
            );
          }

          var reference = linkedReferences[0];
          var tracks = reference.mediaType === "video" ? nestedSeq.videoTracks : nestedSeq.audioTracks;
          var targetTracks = reference.mediaType === "video" ? seq.videoTracks : seq.audioTracks;
          var planned = [];
          var expectedByTrack = [];
          for (var t = 0; t < tracks.numTracks; t++) {
            var targetTrackIndex = reference.trackIndex + t;
            if (targetTrackIndex >= targetTracks.numTracks) {
              return __error("Cannot unnest safely because the destination " + reference.mediaType + " track " + targetTrackIndex + " does not exist. No clips were changed.");
            }
            expectedByTrack[t] = 0;
            for (var c = 0; c < tracks[t].clips.numItems; c++) {
              var nestedClip = tracks[t].clips[c];
              if (!nestedClip.projectItem) {
                return __error("Cannot unnest safely because a nested " + reference.mediaType + " clip has no project item. No clips were changed.");
              }
              planned.push({
                projectItem: nestedClip.projectItem,
                insertTime: (parseFloat(startTicks) + parseFloat(nestedClip.start.ticks)).toString(),
                sourceTrackIndex: t,
                name: nestedClip.name
              });
              expectedByTrack[t]++;
            }
          }
          if (planned.length === 0) return __error("Nested sequence has no " + reference.mediaType + " clips to unnest. No clips were changed.");

          var beforeCounts = [];
          for (var b = 0; b < tracks.numTracks; b++) {
            beforeCounts[b] = targetTracks[reference.trackIndex + b].clips.numItems;
          }

          // The existing implementation only changed one lane of a linked clip.
          // This route runs only when preflight has proven there is exactly one
          // unlinked reference, so it cannot report a partial A/V unnest as success.
          reference.clip.remove(false, false);
          var addedClips = [];
          for (var p = 0; p < planned.length; p++) {
            var placement = planned[p];
            var targetTrack = targetTracks[reference.trackIndex + placement.sourceTrackIndex];
            targetTrack.insertClip(placement.projectItem, placement.insertTime);
            addedClips.push(placement.name);
          }
          for (var a = 0; a < tracks.numTracks; a++) {
            var actualCount = targetTracks[reference.trackIndex + a].clips.numItems;
            if (actualCount !== beforeCounts[a] - (a === 0 ? 1 : 0) + expectedByTrack[a]) {
              return __error("Premiere did not place every nested " + reference.mediaType + " clip. Inspect the timeline before retrying.");
            }
          }
          
          return __result({
            unnested: true,
            verified: true,
            nestedSequence: clipName,
            mediaType: reference.mediaType,
            clipsAdded: addedClips.length,
            clips: addedClips
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_preset: {
      description: "Create a new sequence from a specific preset file (.sqpreset)",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          preset_path: {
            type: "string",
            description: "Full path to the .sqpreset file",
          },
        },
        required: ["name", "preset_path"],
      },
      handler: async (args: { name: string; preset_path: string }) => {
        // createNewSequenceFromPreset is not a real API (missing in 26.x) — use QE.
        const script = buildToolScript(`
          app.enableQE();
          qe.project.newSequence("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(args.preset_path)}");
          var seq = app.project.activeSequence;
          if (!seq || seq.name !== "${escapeForExtendScript(args.name)}") {
            return __error("Failed to create sequence from preset: ${escapeForExtendScript(args.preset_path)}");
          }
          return __result({ created: true, name: seq.name, id: seq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    attach_custom_property: {
      description: "Attach a custom property (key/value pair) to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          property_id: {
            type: "string",
            description: "Unique identifier for the custom property",
          },
          property_value: {
            type: "string",
            description: "Value for the custom property",
          },
        },
        required: ["property_id", "property_value"],
      },
      handler: async (args: { property_id: string; property_value: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.attachCustomProperty("${escapeForExtendScript(args.property_id)}", "${escapeForExtendScript(args.property_value)}");
          return __result({ attached: true, propertyId: "${escapeForExtendScript(args.property_id)}", value: "${escapeForExtendScript(args.property_value)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    is_work_area_enabled: {
      description: "Check whether the work area bar is enabled on the active sequence",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var enabled = seq.isWorkAreaEnabled();
          return __result({ sequenceName: seq.name, workAreaEnabled: enabled });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_export_file_extension: {
      description: "Get the file extension that would be used when exporting the active sequence with a given preset",
      parameters: {
        type: "object" as const,
        properties: {
          preset_path: {
            type: "string",
            description: "Full path to the export preset file (.epr)",
          },
        },
        required: ["preset_path"],
      },
      handler: async (args: { preset_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var ext = seq.getExportFileExtension("${escapeForExtendScript(args.preset_path)}");
          return __result({ sequenceName: seq.name, presetPath: "${escapeForExtendScript(args.preset_path)}", extension: ext });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
