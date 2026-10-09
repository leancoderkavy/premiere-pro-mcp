import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, win32 } from "node:path";
import { describePresetFolder } from "./encoder-formats.js";

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
        // QE's newSequence silently ignores forward-slash preset paths on Windows
        // (#714, same root cause as #691): resolve to native separators, and give
        // a missing file its own precise error instead of the bare QE failure.
        const resolvedPresetPath = resolve(presetPath);
        if (!existsSync(resolvedPresetPath)) {
          return { success: false as const, error: `Preset file not found: ${resolvedPresetPath}` };
        }

        const script = buildToolScript(`
          var beforeSequenceIds = {};
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            beforeSequenceIds[String(app.project.sequences[i].sequenceID)] = true;
          }
          app.enableQE();
          qe.project.newSequence("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(resolvedPresetPath)}");
          var seq = app.project.activeSequence;
          if (!seq || seq.name !== "${escapeForExtendScript(args.name)}") {
            return __error("Failed to create sequence from preset: ${escapeForExtendScript(presetPath)}");
          }
          var sequenceId = String(seq.sequenceID);
          if (beforeSequenceIds[sequenceId]) {
            return __error("Premiere did not create a new sequence; the active sequence already existed before the preset request.");
          }
          var created = __findSequence(sequenceId);
          if (!created || String(created.sequenceID) !== sequenceId) {
            return __error("Premiere did not add the new sequence to the project collection; no creation success is reported.");
          }
          return __result({ created: true, verified: true, name: created.name, id: sequenceId, presetUsed: "${escapeForExtendScript(presetPath)}" });
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
          
          // Report the copy itself: Premiere names every copy "<name> Copy", so a caller
          // looking it up by name can land on an older copy (live: a rerun edited the
          // previous run's copy). Diff the sequence IDs to find the new one.
          var existingIds = {};
          for (var before = 0; before < app.project.sequences.numSequences; before++) existingIds[String(app.project.sequences[before].sequenceID)] = true;
          seq.clone();
          var copy = null;
          for (var after = 0; after < app.project.sequences.numSequences; after++) {
            var candidate = app.project.sequences[after];
            if (!existingIds[String(candidate.sequenceID)]) { copy = candidate; break; }
          }
          if (!copy) return __error("Premiere did not create a copy of " + seq.name);
          return __result({ duplicated: true, verified: true, originalName: seq.name, originalId: seq.sequenceID, name: copy.name, id: copy.sequenceID });
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

          var before = {};
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            before[String(app.project.sequences[i].sequenceID)] = true;
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
          if (!exists || before[newId] === true) {
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
      description: "Auto-reframe a sequence into a new sequence of target_width x target_height. Premiere derives the new sequence from the source height (a 1080p source at 9:16 comes out 607x1080), so the tool then sets the requested frame size and verifies it; the Auto Reframe effect refits to the new size.",
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
          // Premiere keeps the source height (1920x1080 at 9:16 gives 607x1080). Resize to the
          // requested frame; the Auto Reframe effect refits to the new frame size by itself.
          var targetWidth = ${args.target_width};
          var targetHeight = ${args.target_height};
          var premiereWidth = Number(reframed.frameSizeHorizontal);
          var premiereHeight = Number(reframed.frameSizeVertical);
          var resized = false;
          if (premiereWidth !== targetWidth || premiereHeight !== targetHeight) {
            var sizeError = null;
            try {
              var reframedSettings = reframed.getSettings();
              reframedSettings.videoFrameWidth = targetWidth;
              reframedSettings.videoFrameHeight = targetHeight;
              reframed.setSettings(reframedSettings);
            } catch (eResize) {
              sizeError = eResize.toString();
            }
            var appliedSettings = null;
            try { appliedSettings = reframed.getSettings(); } catch (eRead) {}
            if (sizeError || !appliedSettings || Number(appliedSettings.videoFrameWidth) !== targetWidth || Number(appliedSettings.videoFrameHeight) !== targetHeight) {
              return __jsonStringify({ success: false,
                error: "Premiere created the auto-reframed sequence at " + premiereWidth + "x" + premiereHeight + " but did not accept the requested " + targetWidth + "x" + targetHeight + " frame size" + (sizeError ? " (" + sizeError + ")" : "") + ".",
                data: { name: reframed.name, id: reframed.sequenceID, width: premiereWidth, height: premiereHeight } });
            }
            resized = true;
          }
          return __result({
            reframed: true,
            sourceName: seq.name,
            name: reframed.name,
            id: reframed.sequenceID,
            requestedAspectRatio: "${numerator}:${denominator}",
            width: targetWidth,
            height: targetHeight,
            premiereFrameSize: premiereWidth + "x" + premiereHeight,
            resizedToRequest: resized,
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unnest_sequence: {
      description:
        "Unnest a nested sequence clip, replacing it with the nested sequence's clips at their exact source in/out and timeline positions. " +
        "Refuses without changing anything when the nest is trimmed, retimed, linked to a partner clip, contains items that also carry the other media type (Premiere's Track.overwriteClip would place that media on the matching track and overwrite the clips there), or when the destination range is occupied or locked. " +
        "Re-reads every placed clip and reports failure with Undo guidance if any start or source range differs. Nested clips are re-placed from their project items, so effects, keyframes, and transitions inside the nest are not carried over.",
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
          for (var si = 0; si < app.project.sequences.numSequences && !nestedSeq; si++) {
            var byItem = app.project.sequences[si];
            try {
              if (byItem.projectItem && String(byItem.projectItem.nodeId) === String(projectItem.nodeId)) nestedSeq = byItem;
            } catch (eSeqItem) {}
          }
          for (var i = 0; i < app.project.sequences.numSequences && !nestedSeq; i++) {
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
          var mediaType = reference.mediaType === "video" ? 1 : 2;
          var tracks = reference.mediaType === "video" ? nestedSeq.videoTracks : nestedSeq.audioTracks;
          var targetTracks = reference.mediaType === "video" ? seq.videoTracks : seq.audioTracks;
          var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var refStart = parseFloat(startTicks);
          var refIn = parseFloat(reference.clip.inPoint.ticks);
          var refOut = parseFloat(reference.clip.outPoint.ticks);
          var refNodeId = String(reference.clip.nodeId);

          function isRetimed(trackItem) {
            try {
              if (typeof trackItem.getSpeed === "function" && Math.abs(trackItem.getSpeed() - 1) > 0.0001) return true;
              if (typeof trackItem.isSpeedReversed === "function" && trackItem.isSpeedReversed()) return true;
            } catch (eSpeed) {}
            return false;
          }
          function secondsLabel(ticks) {
            return String(Math.round(__ticksToSeconds(ticks) * 1000) / 1000) + "s";
          }

          if (isRetimed(reference.clip)) {
            return __error("Unnest refused; nothing was changed. The nested clip has a speed change or is reversed, so placing its contents at normal speed would change what plays.");
          }
          if (__isTrackLocked(targetTracks[reference.trackIndex])) {
            return __error("Unnest refused; nothing was changed. The nested clip's " + reference.mediaType + " track " + reference.trackIndex + " is locked.");
          }

          // Preflight: plan every placement and prove it is safe before touching
          // the timeline. Every refusal below returns before any mutation.
          var planned = [];
          var expectedByTrack = [];
          var contentStart = null;
          var contentEnd = null;
          for (var t = 0; t < tracks.numTracks; t++) {
            var targetTrackIndex = reference.trackIndex + t;
            expectedByTrack[t] = 0;
            for (var c = 0; c < tracks[t].clips.numItems; c++) {
              var nestedClip = tracks[t].clips[c];
              if (targetTrackIndex >= targetTracks.numTracks) {
                return __error("Cannot unnest safely because the destination " + reference.mediaType + " track " + targetTrackIndex + " does not exist. No clips were changed.");
              }
              if (!nestedClip.projectItem) {
                return __error("Cannot unnest safely because a nested " + reference.mediaType + " clip has no project item. No clips were changed.");
              }
              if (isRetimed(nestedClip)) {
                return __error("Unnest refused; nothing was changed. Nested clip " + nestedClip.name + " has a speed change or is reversed, so it cannot be re-placed with the same timing.");
              }
              var nestedStart = parseFloat(nestedClip.start.ticks);
              var nestedEnd = parseFloat(nestedClip.end.ticks);
              if (contentStart === null || nestedStart < contentStart) contentStart = nestedStart;
              if (contentEnd === null || nestedEnd > contentEnd) contentEnd = nestedEnd;
              planned.push({
                projectItem: nestedClip.projectItem,
                name: nestedClip.name,
                targetTrackIndex: targetTrackIndex,
                expectedStart: refStart + (nestedStart - refIn),
                expectedEnd: refStart + (nestedEnd - refIn),
                inTicks: parseFloat(nestedClip.inPoint.ticks),
                outTicks: parseFloat(nestedClip.outPoint.ticks)
              });
              expectedByTrack[t]++;
            }
          }
          if (planned.length === 0) return __error("Nested sequence has no " + reference.mediaType + " clips to unnest. No clips were changed.");

          // A trimmed nest plays only part of the nested content; unnesting would
          // bring back the hidden head or tail and change what plays.
          var trimTol = frameTicks / 2;
          if (refIn > contentStart + trimTol || refOut < contentEnd - trimTol) {
            return __error(
              "Unnest refused; nothing was changed. The nested clip is trimmed: it plays " + secondsLabel(refIn) + "-" + secondsLabel(refOut) +
              " of " + nestedSeq.name + ", whose " + reference.mediaType + " content spans " + secondsLabel(contentStart) + "-" + secondsLabel(contentEnd) +
              ". Unnesting would change what plays. Extend the nested clip to its full content first, or unnest it manually in Premiere."
            );
          }

          for (var q = 0; q < planned.length; q++) {
            var pre = planned[q];
            var destTrack = targetTracks[pre.targetTrackIndex];
            if (__isTrackLocked(destTrack)) {
              return __error("Unnest refused; nothing was changed. Destination " + reference.mediaType + " track " + pre.targetTrackIndex + " is locked.");
            }
            for (var d = 0; d < destTrack.clips.numItems; d++) {
              var occupant = destTrack.clips[d];
              if (String(occupant.nodeId) === refNodeId) continue;
              var occupantStart = parseFloat(occupant.start.ticks);
              var occupantEnd = parseFloat(occupant.end.ticks);
              if (occupantStart < pre.expectedEnd - __TICK_MATCH_TOL && occupantEnd > pre.expectedStart + __TICK_MATCH_TOL) {
                return __error(
                  "Unnest refused; nothing was changed. The destination range " + secondsLabel(pre.expectedStart) + "-" + secondsLabel(pre.expectedEnd) +
                  " on " + reference.mediaType + " track " + pre.targetTrackIndex + " is already occupied by " + occupant.name +
                  ". Clear that range or move the nested clip, then retry."
                );
              }
            }
          }

          function trackCounts(list) {
            var counts = [];
            for (var ti = 0; ti < list.numTracks; ti++) counts[ti] = list[ti].clips.numItems;
            return counts;
          }
          var beforeVideoCounts = trackCounts(seq.videoTracks);
          var beforeAudioCounts = trackCounts(seq.audioTracks);
          var beforeIds = {};
          for (var bt = 0; bt < targetTracks.numTracks; bt++) {
            for (var bc = 0; bc < targetTracks[bt].clips.numItems; bc++) beforeIds[String(targetTracks[bt].clips[bc].nodeId)] = true;
          }

          var markWarnings = [];
          function markNote() {
            return markWarnings.length ? " Project item In/Out marks could not be restored on: " + markWarnings.join(", ") + "." : "";
          }

          // Check every source range is accepted before removing the nested clip.
          // Live 26.5.2: Track.overwriteClip with an item that also has the other
          // media type places that media too, on the matching track (or a new
          // one if it is locked), overwriting whatever is there.
          for (var pf = 0; pf < planned.length; pf++) {
            var otherType = mediaType === 1 ? 2 : 1;
            var otherSpan = 0;
            try { otherSpan = parseFloat(planned[pf].projectItem.getOutPoint(otherType).ticks) - parseFloat(planned[pf].projectItem.getInPoint(otherType).ticks); } catch (eOther) {}
            if (otherSpan > __TICK_MATCH_TOL) {
              var otherLabel = otherType === 2 ? "audio" : "video";
              return __error("Unnest refused; nothing was changed. " + planned[pf].name + " also has " + otherLabel + ", and Premiere's Track.overwriteClip would place that " + otherLabel + " on the matching " + otherLabel + " track too, overwriting the clips there. Unnest a nest of " + reference.mediaType + "-only items, or use Premiere's Unnest command.");
            }
            var check = __itemAcceptsRange(planned[pf].projectItem, planned[pf].inTicks, planned[pf].outTicks, mediaType);
            if (!check.marksRestored) markWarnings.push(planned[pf].projectItem.name);
            if (!check.ok) return __error("Unnest refused; nothing was changed. " + check.error + "." + markNote());
          }

          // Mutation. Track.overwriteClip places each nested clip's exact source
          // range on one track without rippling neighbours (the range is empty).
          try {
            reference.clip.remove(false, false);
          } catch (removeErr) {
            return __error("Premiere rejected removing the nested clip (" + removeErr.toString() + "). The timeline may have changed; inspect it and use Undo if it did.");
          }
          var addedClips = [];
          for (var p = 0; p < planned.length; p++) {
            var placement = planned[p];
            var placed = __overwriteRangeOnTrack(
              targetTracks[placement.targetTrackIndex], placement.projectItem,
              placement.expectedStart, placement.inTicks, placement.outTicks, mediaType
            );
            if (!placed.marksRestored) markWarnings.push(placement.projectItem.name);
            if (!placed.ok) {
              return __error(
                "The timeline changed: the nested clip was removed and " + addedClips.length + " of " + planned.length +
                " clip(s) were placed before Premiere failed on " + placement.name + " (" + placed.error + "). " +
                "Use Undo to restore the nested clip; this unnest did not succeed." + markNote()
              );
            }
            addedClips.push(placement.name);
          }

          // Readback: every placed clip must sit at its planned start with the
          // nested clip's exact source in/out, and no other track may change.
          var problems = [];
          var claimed = {};
          for (var r = 0; r < planned.length; r++) {
            var want = planned[r];
            var readTrack = targetTracks[want.targetTrackIndex];
            var match = null;
            for (var k = 0; k < readTrack.clips.numItems && !match; k++) {
              var cand = readTrack.clips[k];
              var candId = String(cand.nodeId);
              if (beforeIds[candId] || claimed[candId]) continue;
              var candSource = "";
              try { candSource = cand.projectItem ? String(cand.projectItem.nodeId) : ""; } catch (eSource) {}
              if (candSource !== String(want.projectItem.nodeId)) continue;
              if (Math.abs(parseFloat(cand.start.ticks) - want.expectedStart) > __TICK_MATCH_TOL) continue;
              match = cand;
            }
            if (!match) {
              problems.push(want.name + " is not at " + secondsLabel(want.expectedStart) + " on " + reference.mediaType + " track " + want.targetTrackIndex);
              continue;
            }
            claimed[String(match.nodeId)] = true;
            var gotEnd = parseFloat(match.end.ticks);
            if (Math.abs(gotEnd - want.expectedEnd) > __TICK_MATCH_TOL) {
              problems.push(want.name + " ends at " + secondsLabel(gotEnd) + " instead of " + secondsLabel(want.expectedEnd));
            }
            var gotIn = parseFloat(match.inPoint.ticks);
            var gotOut = parseFloat(match.outPoint.ticks);
            if (Math.abs(gotIn - want.inTicks) > __TICK_MATCH_TOL || Math.abs(gotOut - want.outTicks) > __TICK_MATCH_TOL) {
              problems.push(want.name + " uses source " + secondsLabel(gotIn) + "-" + secondsLabel(gotOut) + " instead of " + secondsLabel(want.inTicks) + "-" + secondsLabel(want.outTicks));
            }
          }
          if (__findClip(refNodeId)) problems.push("the nested clip is still on the timeline");
          function checkCounts(list, before, isTargetType, label) {
            for (var ci = 0; ci < list.numTracks; ci++) {
              var expected = before[ci];
              if (isTargetType) {
                if (ci === reference.trackIndex) expected -= 1;
                var offset = ci - reference.trackIndex;
                if (offset >= 0 && offset < expectedByTrack.length) expected += expectedByTrack[offset];
              }
              var actual = list[ci].clips.numItems;
              if (actual !== expected) problems.push(label + " track " + ci + " has " + actual + " clip(s), expected " + expected);
            }
          }
          checkCounts(seq.videoTracks, beforeVideoCounts, reference.mediaType === "video", "video");
          checkCounts(seq.audioTracks, beforeAudioCounts, reference.mediaType === "audio", "audio");
          if (problems.length) {
            return __error(
              "The timeline changed but the unnest did not verify: " + problems.join("; ") +
              ". Use Undo to restore the nested clip before retrying; this is not reported as success." + markNote()
            );
          }

          var unnestResult = {
            unnested: true,
            verified: true,
            outcome: "verified",
            nestedSequence: clipName,
            mediaType: reference.mediaType,
            clipsAdded: addedClips.length,
            clips: addedClips
          };
          if (markWarnings.length) unnestResult.warning = "Project item In/Out marks could not be restored on: " + markWarnings.join(", ") + ".";
          return __result(unnestResult);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_preset: {
      description:
        "EXPERIMENTAL (undocumented QE DOM): create a new sequence from a specific preset file (.sqpreset) using qe.project.newSequence. Reports success only after a new sequence ID appears in the project collection; a same-name sequence that was already active is not treated as created.",
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
        // QE's newSequence silently ignores forward-slash preset paths on Windows
        // (#691): the call does not throw but the previous sequence stays active,
        // so the name check below would report a bare "Failed to create" error.
        // resolve() normalizes to native separators; a missing file gets its own
        // precise error instead of leaking into the generic one.
        const presetPath = resolve(args.preset_path);
        if (!existsSync(presetPath)) {
          return { success: false as const, error: `Preset file not found: ${presetPath}` };
        }
        const script = buildToolScript(`
          var beforeSequenceIds = {};
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            beforeSequenceIds[String(app.project.sequences[i].sequenceID)] = true;
          }
          app.enableQE();
          qe.project.newSequence("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(presetPath)}");
          var seq = app.project.activeSequence;
          if (!seq || seq.name !== "${escapeForExtendScript(args.name)}") {
            return __error("Failed to create sequence from preset: ${escapeForExtendScript(presetPath)}");
          }
          var sequenceId = String(seq.sequenceID);
          if (beforeSequenceIds[sequenceId]) {
            return __error("Premiere did not create a new sequence; the active sequence already existed before the preset request.");
          }
          var created = __findSequence(sequenceId);
          if (!created || String(created.sequenceID) !== sequenceId) {
            return __error("Premiere did not add the new sequence to the project collection; no creation success is reported.");
          }
          return __result({ created: true, verified: true, name: created.name, id: sequenceId, presetUsed: "${escapeForExtendScript(presetPath)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    attach_custom_property: {
      description:
        "Attach a custom property (key/value pair) to the active sequence and confirm it against the sequence project item's XMP packet. Reports failure when the property never lands in XMP.",
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
        if (typeof args.property_id !== "string" || !args.property_id.trim()) {
          return { success: false, error: "property_id must be a non-empty string" };
        }
        if (typeof args.property_value !== "string" || !args.property_value.length) {
          return { success: false, error: "property_value must be a non-empty string" };
        }
        const propertyId = escapeForExtendScript(args.property_id);
        const propertyValue = escapeForExtendScript(args.property_value);
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (typeof seq.attachCustomProperty !== "function") {
            return __error("This Premiere build does not expose sequence.attachCustomProperty; no custom property was attached.");
          }

          // A custom property is only real once it is in the sequence project
          // item's XMP packet, so read that packet on both sides of the write.
          var sequenceItem = null;
          try { sequenceItem = seq.projectItem; } catch (itemError) { sequenceItem = null; }
          if (!sequenceItem || typeof sequenceItem.getXMPMetadata !== "function") {
            return __error("The active sequence exposes no readable project item XMP packet, so an attached custom property cannot be verified. No property was attached.");
          }

          var beforePacket = "";
          try { beforePacket = String(sequenceItem.getXMPMetadata() || ""); } catch (beforeError) { beforePacket = ""; }
          if (!beforePacket) {
            return __error("Premiere returned no readable XMP packet for the active sequence, so an attached custom property cannot be verified. No property was attached.");
          }

          try {
            seq.attachCustomProperty("${propertyId}", "${propertyValue}");
          } catch (attachError) {
            return __error("Premiere could not attach the custom property: " + attachError.toString());
          }

          var afterPacket = "";
          try { afterPacket = String(sequenceItem.getXMPMetadata() || ""); } catch (afterError) { afterPacket = ""; }
          if (!afterPacket) {
            return __error("Premiere returned no readable XMP packet after attachCustomProperty, so the custom property is not verified.");
          }
          if (afterPacket === beforePacket || afterPacket.indexOf("${propertyValue}") === -1) {
            return __error("Premiere accepted attachCustomProperty without an error, but the sequence XMP packet does not contain the property value, so the property was not persisted. No success is reported.");
          }

          return __result({
            attached: true,
            verified: true,
            propertyId: "${propertyId}",
            value: "${propertyValue}",
            verification: "sequence_project_item_xmp_readback"
          });
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
          var enabled = __workAreaEnabled(seq);
          if (enabled === null) return __error("Work-area enabled state could not be read from this host.", { outcome: "failed" });
          return __result({ sequenceName: seq.name, workAreaEnabled: enabled });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_export_file_extension: {
      description: "Get the export file extension from Premiere. If Premiere returns none, infer it only for an existing .epr in a recognized Adobe Media Encoder format folder; that fallback is marked unconfirmed and should be checked before delivery.",
      operationalCapability: {
        backend: "local + CEP/ExtendScript" as const,
        backends: ["local" as const, "cep" as const, "extendscript" as const],
        authority: "filesystem" as const,
        verificationBoundary: "local_and_host_response" as const,
        hostVerificationRequired: true,
        notes: ["Requires inspect and filesystem authority. The preset-folder fallback reads the local .epr file's existence and size; it does not verify an export."],
      },
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
          var ext = null;
          try { ext = seq.getExportFileExtension("${escapeForExtendScript(args.preset_path)}"); }
          catch (extensionError) { return __error("Premiere could not determine the export extension for this preset: " + extensionError.toString()); }
          return __result({ sequenceName: seq.name, presetPath: "${escapeForExtendScript(args.preset_path)}", extension: ext === null || ext === undefined ? null : String(ext) });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        const data = result.data as { sequenceName?: string; presetPath?: string; extension?: string | null };
        const hostExtension = typeof data?.extension === "string" ? data.extension.trim() : "";
        if (hostExtension) {
          return { success: true, data: { ...data, extensionSource: "premiere", hostConfirmed: true } };
        }

        const presetPath = args.preset_path;
        const pathApi = presetPath.includes("\\") ? win32 : { basename, dirname, extname };
        let usablePreset = false;
        try {
          const presetStats = statSync(presetPath);
          usablePreset = pathApi.extname(presetPath).toLowerCase() === ".epr" && presetStats.isFile() && presetStats.size > 0;
        } catch { /* unavailable */ }
        const format = usablePreset ? describePresetFolder(pathApi.basename(pathApi.dirname(presetPath))) : null;
        if (!format?.extension) {
          return { success: false, error: "Premiere did not provide an export extension for this preset on this host, and its .epr format folder cannot establish one. Inspect the preset or choose an output path explicitly before exporting." };
        }
        return { success: true, data: {
          ...data,
          extension: `.${format.extension}`,
          extensionSource: "preset_folder",
          hostConfirmed: false,
          formatCode: format.formatCode,
          warning: "Premiere did not report an extension. This is inferred from the Adobe Media Encoder preset folder, not confirmed by an export. Check the output path before delivery.",
        } };
      },
    },
  };
}
