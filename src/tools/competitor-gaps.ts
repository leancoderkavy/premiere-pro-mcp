import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type BatchTimelineClip = {
  item_id: string;
  track_index?: number;
  start_seconds?: number;
  audio_track_index?: number;
};

type DuckingWindow = {
  start_seconds: number;
  end_seconds: number;
  ducked_db: number;
};

type ClipPropertyBatchItem = {
  node_id: string;
  opacity?: number;
  scale?: number;
  position_x?: number;
  position_y?: number;
  rotation?: number;
  speed?: number;
};

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function finiteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resultFromUxp(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown>,
) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

/**
 * Tools that close concrete interoperability gaps without pretending CEP can
 * safely automate Premiere APIs which open modal UI or block the panel.
 */
export function getCompetitorGapTools(
  bridgeOptions: BridgeOptions,
  uxpBridge?: UxpWebSocketBridge,
) {
  return {
    import_edl: {
      description:
        "Unavailable by design: CMX 3600 EDL import opens Premiere UI that can block the CEP bridge. No import is attempted; convert the EDL to FCP7 XML and use import_fcp_xml for unattended interchange.",
      parameters: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the CMX 3600 .edl file that was requested for import.",
          },
        },
        required: ["file_path"],
      },
      handler: async (args: { file_path: string }) => ({
        success: false,
        error:
          "CMX 3600 EDL import is not run through the unattended CEP bridge because Premiere can open an interactive sequence/source-media dialog and block the panel. No mutation was attempted. Convert '" +
          args.file_path +
          "' to FCP7 XML, then call import_fcp_xml.",
      }),
    },

    add_to_timeline_batch: {
      description:
        "Insert up to 32 project items in one validated CEP request. All items and target tracks are preflighted before the first insertion; every requested placement is read back, and the tool fails closed if Premiere cannot verify one.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          clips: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            description:
              "Ordered placements. They use the same insert-edit semantics as add_to_timeline; later placements must not share a target video-track start time.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                item_id: { type: "string", minLength: 1, maxLength: 512, description: "Project item node ID or unique name." },
                track_index: { type: "integer", minimum: 0, description: "Video track index (defaults to 0)." },
                start_seconds: { type: "number", minimum: 0, description: "Timeline insertion time in seconds (defaults to 0)." },
                audio_track_index: { type: "integer", minimum: 0, description: "Audio target for linked source audio (defaults to 0)." },
              },
              required: ["item_id"],
            },
          },
        },
        required: ["clips"],
      },
      handler: async (args: { clips: BatchTimelineClip[] }) => {
        if (!Array.isArray(args.clips) || args.clips.length < 1 || args.clips.length > 32) {
          return { success: false, error: "clips must contain between 1 and 32 placements." };
        }

        const starts = new Set<string>();
        const clips: Array<Required<BatchTimelineClip>> = [];
        for (let index = 0; index < args.clips.length; index++) {
          const item = args.clips[index];
          const trackIndex = item.track_index ?? 0;
          const startSeconds = item.start_seconds ?? 0;
          const audioTrackIndex = item.audio_track_index ?? 0;
          if (!item || typeof item.item_id !== "string" || item.item_id.length < 1 || item.item_id.length > 512) {
            return { success: false, error: `clips[${index}].item_id must be a non-empty string no longer than 512 characters.` };
          }
          if (!finiteNonNegativeInteger(trackIndex) || !finiteNonNegativeInteger(audioTrackIndex) || !finiteNonNegativeNumber(startSeconds)) {
            return {
              success: false,
              error: `clips[${index}] requires non-negative integer track indexes and a finite non-negative start_seconds.`,
            };
          }
          // Equal-time insertions on the same video track are order-dependent.
          // Refuse them rather than silently producing a different edit.
          const startKey = `${trackIndex}:${startSeconds}`;
          if (starts.has(startKey)) {
            return {
              success: false,
              error: `clips[${index}] shares video track ${trackIndex} and start_seconds ${startSeconds} with another placement; split this into explicit sequential edits.`,
            };
          }
          starts.add(startKey);
          clips.push({ item_id: item.item_id, track_index: trackIndex, start_seconds: startSeconds, audio_track_index: audioTrackIndex });
        }

        // Ascending positions preserve the requested locations under insert-edit
        // semantics: a later insert does not shift an earlier one.
        clips.sort((left, right) => left.start_seconds - right.start_seconds);
        const emittedClips = clips.map((item) => `
          {
            itemId: "${escapeForExtendScript(item.item_id)}",
            trackIndex: ${item.track_index},
            startSeconds: ${item.start_seconds},
            audioTrackIndex: ${item.audio_track_index}
          }`).join(",");

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var placements = [${emittedClips}];
          var i;

          // Preflight every mutable dependency before the first insert. This
          // avoids the common partial batch caused by a typo late in the list.
          for (i = 0; i < placements.length; i++) {
            var preflight = placements[i];
            if (!seq.videoTracks[preflight.trackIndex]) {
              return __error("Video track index " + preflight.trackIndex + " is out of range for placement " + i + ". No placement was attempted.");
            }
            if (!seq.audioTracks[preflight.audioTrackIndex]) {
              return __error("Audio track index " + preflight.audioTrackIndex + " is out of range for placement " + i + ". No placement was attempted.");
            }
            preflight.item = __findProjectItem(preflight.itemId);
            if (!preflight.item) {
              return __error("Project item not found for placement " + i + ": " + preflight.itemId + ". No placement was attempted.");
            }
          }

          var results = [];
          for (i = 0; i < placements.length; i++) {
            var placement = placements[i];
            var videoTrack = seq.videoTracks[placement.trackIndex];
            var audioTrack = seq.audioTracks.numTracks > 0 ? seq.audioTracks[placement.audioTrackIndex] : null;
            var beforeVideoIds = {};
            var beforeAudioIds = {};
            var c;
            for (c = 0; c < videoTrack.clips.numItems; c++) beforeVideoIds[videoTrack.clips[c].nodeId] = true;
            if (audioTrack) {
              for (c = 0; c < audioTrack.clips.numItems; c++) beforeAudioIds[audioTrack.clips[c].nodeId] = true;
            }

            try {
              seq.insertClip(placement.item, __secondsToTicks(placement.startSeconds).toString(), placement.trackIndex, placement.audioTrackIndex);
            } catch (insertError) {
              return __error("Batch insertion " + i + " threw after " + results.length + " verified placement(s): " + insertError.toString());
            }

            var matched = null;
            var addedCount = 0;
            for (c = 0; c < videoTrack.clips.numItems; c++) {
              var videoClip = videoTrack.clips[c];
              if (!beforeVideoIds[videoClip.nodeId]) {
                addedCount++;
                if (videoClip.projectItem && videoClip.projectItem.nodeId === placement.item.nodeId) matched = videoClip;
              }
            }
            if (audioTrack) {
              for (c = 0; c < audioTrack.clips.numItems; c++) {
                var audioClip = audioTrack.clips[c];
                if (!beforeAudioIds[audioClip.nodeId]) {
                  addedCount++;
                  if (!matched && audioClip.projectItem && audioClip.projectItem.nodeId === placement.item.nodeId) matched = audioClip;
                }
              }
            }
            if (!matched) {
              return __error("Batch insertion " + i + " did not produce the requested project item after " + results.length + " verified placement(s). The batch is not reported as verified.");
            }
            var frameTicks = parseFloat(seq.timebase);
            if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
            var tolerance = __ticksToSeconds(frameTicks);
            var actualStart = __ticksToSeconds(matched.start.ticks);
            if (Math.abs(actualStart - placement.startSeconds) > tolerance) {
              return __error("Batch insertion " + i + " landed at " + actualStart + "s instead of " + placement.startSeconds + "s after " + results.length + " verified placement(s). The batch is not reported as verified.");
            }
            results.push({
              item: placement.item.name,
              itemId: placement.item.nodeId,
              videoTrackIndex: placement.trackIndex,
              requestedStartSeconds: placement.startSeconds,
              actualStartSeconds: actualStart,
              insertedTrackItems: addedCount
            });
          }
          return __result({ inserted: true, verified: true, placementCount: results.length, placements: results });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    crop_clip: {
      description:
        "Apply or update Premiere's Crop effect on one video clip and read back every requested value. Adding Crop uses the legacy QE catalog only when the clip does not already contain it.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", minLength: 1, maxLength: 512, description: "Timeline video-clip node ID." },
          left: { type: "number", minimum: 0, maximum: 100, description: "Percent cropped from the left edge." },
          right: { type: "number", minimum: 0, maximum: 100, description: "Percent cropped from the right edge." },
          top: { type: "number", minimum: 0, maximum: 100, description: "Percent cropped from the top edge." },
          bottom: { type: "number", minimum: 0, maximum: 100, description: "Percent cropped from the bottom edge." },
          edge_feather: { type: "number", minimum: 0, maximum: 100, description: "Crop edge feather percentage." },
          zoom: { type: "boolean", description: "Whether Crop should scale the remaining image to fill the frame." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
        edge_feather?: number;
        zoom?: boolean;
      }) => {
        const numeric = [args.left, args.right, args.top, args.bottom, args.edge_feather];
        if (!args.node_id || numeric.some((value) => value !== undefined && (!finiteNumber(value) || value < 0 || value > 100))) {
          return { success: false, error: "node_id is required and crop percentages must be finite numbers from 0 through 100." };
        }
        if (numeric.every((value) => value === undefined) && args.zoom === undefined) {
          return { success: false, error: "crop_clip requires at least one crop value or zoom setting; no effect was added." };
        }

        const changes: Array<{ name: string; value: string }> = [];
        if (args.left !== undefined) changes.push({ name: "Left", value: String(args.left) });
        if (args.right !== undefined) changes.push({ name: "Right", value: String(args.right) });
        if (args.top !== undefined) changes.push({ name: "Top", value: String(args.top) });
        if (args.bottom !== undefined) changes.push({ name: "Bottom", value: String(args.bottom) });
        if (args.edge_feather !== undefined) changes.push({ name: "Edge Feather", value: String(args.edge_feather) });
        if (args.zoom !== undefined) changes.push({ name: "Zoom", value: args.zoom ? "1" : "0" });
        const emittedChanges = changes.map((change) => `{ name: "${change.name}", value: ${change.value} }`).join(", ");

        const script = buildToolScript(`
          var found = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!found) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          if (found.trackType !== "video") return __error("crop_clip only supports video timeline clips.");
          var clip = found.clip;
          var crop = null;
          var componentIndex = -1;
          var i;
          for (i = 0; i < clip.components.numItems; i++) {
            var component = clip.components[i];
            if (component && (component.displayName === "Crop" || component.matchName === "AE.ADBE AECrop")) {
              crop = component;
              componentIndex = i;
              break;
            }
          }

          var effectAdded = false;
          if (!crop) {
            var catalog = __getQeEffectCatalog("video");
            if (!catalog.ok) return __error(catalog.error + " Crop was not added.");
            var cropEffect = null;
            for (i = 0; i < catalog.effects.numItems; i++) {
              if (catalog.effects[i].name === "Crop") { cropEffect = catalog.effects[i]; break; }
            }
            if (!cropEffect) return __error("The legacy QE video-effect catalog does not contain Crop. No effect was added.");
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return __error("No active sequence is available through QE. Crop was not added.");
            var qeTrack = qeSeq.getVideoTrackAt(found.trackIndex);
            if (!qeTrack) return __error("QE video track was not found. Crop was not added.");
            // QE item indexes include gaps, so use the DOM clip start rather
            // than assuming its DOM array index addresses the QE item.
            var qeClip = null;
            var expectedStart = parseFloat(clip.start.ticks);
            for (i = 0; i < qeTrack.numItems; i++) {
              var candidate = qeTrack.getItemAt(i);
              if (!candidate || String(candidate.type) !== "Clip") continue;
              if (candidate.start && Math.abs(parseFloat(candidate.start.ticks) - expectedStart) < 1) { qeClip = candidate; break; }
            }
            if (!qeClip || typeof qeClip.addVideoEffect !== "function") return __error("QE could not address the target video clip for Crop. Crop was not added.");
            try { qeClip.addVideoEffect(cropEffect); } catch (addError) { return __error("Premiere rejected the Crop effect addition: " + addError.toString()); }
            for (i = 0; i < clip.components.numItems; i++) {
              component = clip.components[i];
              if (component && (component.displayName === "Crop" || component.matchName === "AE.ADBE AECrop")) {
                crop = component;
                componentIndex = i;
                break;
              }
            }
            if (!crop) return __error("Premiere accepted the Crop addition but the component did not appear on the target clip.");
            effectAdded = true;
          }

          var requests = [${emittedChanges}];
          var resolved = [];
          for (i = 0; i < requests.length; i++) {
            var request = requests[i];
            var property = null;
            for (var p = 0; p < crop.properties.numItems; p++) {
              if (String(crop.properties[p].displayName) === request.name) { property = crop.properties[p]; break; }
            }
            if (!property) return __error("Crop does not expose the '" + request.name + "' property on this host. No requested crop value was written.");
            resolved.push({ name: request.name, requested: request.value, property: property });
          }
          var written = [];
          for (i = 0; i < resolved.length; i++) {
            var target = resolved[i];
            try { target.property.setValue(target.requested, true); } catch (writeError) {
              return __error("Premiere rejected Crop " + target.name + ": " + writeError.toString());
            }
            var actual;
            try { actual = target.property.getValue(); } catch (readError) {
              return __error("Premiere did not provide Crop " + target.name + " after writing it; the crop is not reported as verified.");
            }
            if (Math.abs(Number(actual) - Number(target.requested)) > 0.0001) {
              return __error("Premiere read back Crop " + target.name + " as " + actual + " instead of " + target.requested + "; the crop is not reported as verified.");
            }
            written.push({ name: target.name, value: actual });
          }
          return __result({
            updated: true,
            verified: true,
            renderVerified: false,
            verificationScope: "Premiere component readback only; verify playback or an exported frame before delivery.",
            clipName: clip.name,
            effectAdded: effectAdded,
            componentIndex: componentIndex,
            values: written
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    setup_ducking: {
      description:
        "Build a verified Volume > Level keyframe curve for one audio clip. Ducking-window times are relative to that clip's start; overlapping or out-of-range windows are rejected before any keyframe write.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", minLength: 1, maxLength: 512, description: "Timeline audio-clip node ID." },
          base_db: { type: "number", description: "Normal clip level in dB (defaults to 0)." },
          ducking_windows: {
            type: "array",
            minItems: 0,
            maxItems: 32,
            description: "Non-overlapping windows during which this clip should be quieter.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                start_seconds: { type: "number", minimum: 0, description: "Window start, relative to clip start." },
                end_seconds: { type: "number", minimum: 0, description: "Window end, relative to clip start." },
                ducked_db: { type: "number", description: "Level during the window, in dB." },
              },
              required: ["start_seconds", "end_seconds", "ducked_db"],
            },
          },
          fade_seconds: { type: "number", exclusiveMinimum: 0, description: "Fade length on each side of a window in seconds (defaults to 0.2)." },
        },
        required: ["node_id", "ducking_windows"],
      },
      handler: async (args: { node_id: string; base_db?: number; ducking_windows: DuckingWindow[]; fade_seconds?: number }) => {
        const baseDb = args.base_db ?? 0;
        const fadeSeconds = args.fade_seconds ?? 0.2;
        if (!args.node_id || !finiteNumber(baseDb) || !finiteNumber(fadeSeconds) || fadeSeconds <= 0 || !Array.isArray(args.ducking_windows) || args.ducking_windows.length > 32) {
          return { success: false, error: "node_id, a finite base_db, 0–32 ducking windows, and a finite positive fade_seconds are required." };
        }
        const windows = args.ducking_windows.map((window, index) => ({ ...window, index })).sort((left, right) => left.start_seconds - right.start_seconds);
        for (let index = 0; index < windows.length; index++) {
          const window = windows[index];
          if (!finiteNonNegativeNumber(window.start_seconds) || !finiteNonNegativeNumber(window.end_seconds) || !finiteNumber(window.ducked_db) || window.end_seconds <= window.start_seconds) {
            return { success: false, error: `ducking_windows[${window.index}] needs finite non-negative bounds with end_seconds greater than start_seconds, plus a finite ducked_db.` };
          }
          if (index > 0 && window.start_seconds < windows[index - 1].end_seconds) {
            return { success: false, error: "ducking_windows must not overlap; merge intersecting windows before applying automation." };
          }
        }
        const emittedWindows = windows.map((window) => `{ startSeconds: ${window.start_seconds}, endSeconds: ${window.end_seconds}, duckedDb: ${window.ducked_db} }`).join(", ");

        const script = buildToolScript(`
          var found = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!found) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          if (found.trackType !== "audio") return __error("setup_ducking only supports audio timeline clips. Target the music or SFX audio clip, not its linked video clip.");
          var clip = found.clip;
          var duration = __ticksToSeconds(clip.duration.ticks);
          if (!isFinite(duration) || duration <= 0) return __error("The audio clip has no readable positive duration; no automation was written.");
          var windows = [${emittedWindows}];
          var i;
          for (i = 0; i < windows.length; i++) {
            if (windows[i].endSeconds > duration + 0.0001) {
              return __error("Ducking window " + i + " ends at " + windows[i].endSeconds + "s but the clip duration is " + duration + "s. No automation was written.");
            }
          }
          var level = null;
          for (i = 0; i < clip.components.numItems; i++) {
            var component = clip.components[i];
            if (component.displayName === "Volume" || component.matchName === "audioVolume") {
              for (var p = 0; p < component.properties.numItems; p++) {
                if (component.properties[p].displayName === "Level") { level = component.properties[p]; break; }
              }
            }
            if (level) break;
          }
          if (!level) return __error("Could not find the audio Volume > Level property. No automation was written.");

          var keyMap = {};
          function putKey(seconds, db) {
            var bounded = Math.max(0, Math.min(duration, seconds));
            var key = String(Math.round(bounded * 1000) / 1000);
            keyMap[key] = { seconds: Number(key), db: db };
          }
          putKey(0, ${baseDb});
          for (i = 0; i < windows.length; i++) {
            var window = windows[i];
            putKey(window.startSeconds - ${fadeSeconds}, ${baseDb});
            putKey(window.startSeconds, window.duckedDb);
            putKey(window.endSeconds, window.duckedDb);
            putKey(window.endSeconds + ${fadeSeconds}, ${baseDb});
          }
          putKey(duration, ${baseDb});
          var keys = [];
          for (var rawKey in keyMap) if (keyMap.hasOwnProperty(rawKey)) keys.push(keyMap[rawKey]);
          keys.sort(function(left, right) { return left.seconds - right.seconds; });
          try { level.setTimeVarying(true); } catch (varyingError) {
            return __error("Premiere could not enable Level keyframes: " + varyingError.toString());
          }
          var verified = [];
          for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            var time = new Time();
            time.ticks = __secondsToTicks(key.seconds).toString();
            var amplitude = Math.max(Math.pow(10, key.db / 20), 0.0000001);
            try { level.addKey(time); } catch (addKeyError) {}
            var wrote = false;
            try { level.setValueAtKey(time, amplitude, 1); wrote = true; } catch (atKeyError) {
              try { level.setValueAtTime(time, amplitude, 1); wrote = true; } catch (atTimeError) {}
            }
            var actual = NaN;
            try { actual = Number(level.getValueAtTime(time)); } catch (readError) {}
            if (!wrote || isNaN(actual) || Math.abs(actual - amplitude) > 0.0001) {
              return __error("Premiere did not verify audio keyframe " + i + " at " + key.seconds + "s. Earlier keyframes may exist; inspect Volume > Level before retrying.");
            }
            verified.push({ timeSeconds: key.seconds, levelDb: key.db, amplitude: actual });
          }
          return __result({
            updated: true,
            verified: true,
            renderVerified: false,
            verificationScope: "Premiere keyframe storage readback only; verify playback or an exported mix before delivery.",
            clipName: clip.name,
            clipDurationSeconds: duration,
            duckingWindowCount: windows.length,
            fadeSeconds: ${fadeSeconds},
            keyframes: verified
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    validate_project_for_export: {
      description:
        "Run a non-mutating export readiness audit for an active or named sequence. It reports blocking offline media, empty timelines, inaccessible preset/output paths, duration, and optional timeline gaps without queuing an export.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Sequence ID or name. Defaults to the active sequence." },
          output_path: { type: "string", minLength: 1, maxLength: 4096, description: "Optional intended delivery path; its parent folder is checked." },
          preset_path: { type: "string", minLength: 1, maxLength: 4096, description: "Optional .epr preset path to check." },
          require_non_empty_timeline: { type: "boolean", description: "Treat an empty sequence as a blocking error (defaults to true)." },
          check_gaps: { type: "boolean", description: "Report gaps on populated tracks as warnings (defaults to true)." },
        },
      },
      handler: async (args: {
        sequence_id?: string;
        output_path?: string;
        preset_path?: string;
        require_non_empty_timeline?: boolean;
        check_gaps?: boolean;
      }) => {
        const requireNonEmpty = args.require_non_empty_timeline !== false;
        const checkGaps = args.check_gaps !== false;
        const sequenceLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");`
          : "var seq = app.project.activeSequence; if (!seq) return __error(\"No active sequence\");";
        const outputPath = args.output_path ? `"${escapeForExtendScript(args.output_path)}"` : "";
        const presetPath = args.preset_path ? `"${escapeForExtendScript(args.preset_path)}"` : "";
        const script = buildToolScript(`
          ${sequenceLookup}
          var errors = [];
          var warnings = [];
          var usedSources = {};
          var offlineMedia = [];
          var gaps = [];
          var totalVideoClips = 0;
          var totalAudioClips = 0;
          function secondsOf(value) {
            if (value === undefined || value === null) return NaN;
            if (typeof value === "number") return value;
            if (typeof value === "string") return __ticksToSeconds(value);
            try {
              if (value.seconds !== undefined) return Number(value.seconds);
              if (value.ticks !== undefined) return __ticksToSeconds(value.ticks);
            } catch (timeError) {}
            return NaN;
          }
          function inspectTracks(tracks, trackType) {
            for (var t = 0; t < tracks.numTracks; t++) {
              var track = tracks[t];
              var cursor = 0;
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var start = __ticksToSeconds(clip.start.ticks);
                var end = __ticksToSeconds(clip.end.ticks);
                if (${checkGaps ? "true" : "false"} && start - cursor > 0.05) {
                  gaps.push({ trackType: trackType, trackIndex: t, startSeconds: cursor, endSeconds: start, durationSeconds: start - cursor });
                }
                if (end > cursor) cursor = end;
                if (trackType === "video") totalVideoClips++; else totalAudioClips++;
                try {
                  var source = clip.projectItem;
                  if (source && !usedSources[source.nodeId]) {
                    usedSources[source.nodeId] = true;
                    var offline = false;
                    var mediaPath = "";
                    try { offline = Boolean(source.isOffline()); } catch (offlineError) {}
                    try { mediaPath = String(source.getMediaPath() || ""); } catch (pathError) {}
                    if (offline) offlineMedia.push({ nodeId: source.nodeId, name: source.name, mediaPath: mediaPath, offline: true });
                  }
                } catch (sourceError) {}
              }
            }
          }
          inspectTracks(seq.videoTracks, "video");
          inspectTracks(seq.audioTracks, "audio");
          var totalClips = totalVideoClips + totalAudioClips;
          if (${requireNonEmpty ? "true" : "false"} && totalClips === 0) {
            errors.push({ code: "EMPTY_TIMELINE", message: "The sequence has no video or audio clips." });
          }
          if (totalVideoClips === 0) warnings.push({ code: "NO_VIDEO_CLIPS", message: "The sequence has no video clips." });
          if (totalAudioClips === 0) warnings.push({ code: "NO_AUDIO_CLIPS", message: "The sequence has no audio clips." });
          if (offlineMedia.length) errors.push({ code: "OFFLINE_MEDIA", message: "One or more media items used by this sequence are offline.", items: offlineMedia });
          if (${checkGaps ? "true" : "false"} && gaps.length) warnings.push({ code: "TIMELINE_GAPS", message: "Gaps were found on populated tracks; verify that they are intentional.", gaps: gaps });
          var duration = secondsOf(seq.end);
          if (!isFinite(duration) || duration <= 0) errors.push({ code: "ZERO_DURATION", message: "The sequence has no readable positive duration." });
          var presetPath = ${presetPath ? presetPath : "null"};
          if (presetPath) {
            var preset = new File(presetPath);
            if (!preset.exists) errors.push({ code: "PRESET_NOT_FOUND", message: "The requested export preset does not exist.", path: presetPath });
            else if (!/\\.epr$/i.test(presetPath)) warnings.push({ code: "PRESET_EXTENSION", message: "The preset exists but does not use the expected .epr extension.", path: presetPath });
          } else {
            warnings.push({ code: "PRESET_NOT_PROVIDED", message: "No preset_path was provided, so preset readiness was not checked." });
          }
          var outputPath = ${outputPath ? outputPath : "null"};
          if (outputPath) {
            var destination = new File(outputPath).parent;
            if (!destination || !destination.exists) errors.push({ code: "OUTPUT_FOLDER_NOT_FOUND", message: "The requested output folder does not exist.", path: outputPath });
          } else {
            warnings.push({ code: "OUTPUT_PATH_NOT_PROVIDED", message: "No output_path was provided, so destination readiness was not checked." });
          }
          return __result({
            readyForExport: errors.length === 0,
            errors: errors,
            warnings: warnings,
            summary: {
              sequenceId: seq.sequenceID,
              sequenceName: seq.name,
              durationSeconds: duration,
              videoTrackCount: seq.videoTracks.numTracks,
              audioTrackCount: seq.audioTracks.numTracks,
              videoClipCount: totalVideoClips,
              audioClipCount: totalAudioClips,
              offlineMediaCount: offlineMedia.length,
              gapCount: gaps.length
            },
            checked: {
              requireNonEmptyTimeline: ${requireNonEmpty ? "true" : "false"},
              checkGaps: ${checkGaps ? "true" : "false"},
              presetPath: presetPath,
              outputPath: outputPath
            }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    read_sequence_captions: {
      description:
        "Diagnose whether the active Premiere scripting host can enumerate caption tracks. It never treats an empty result as proof that the sequence has no captions, because most CEP builds expose caption creation but not caption reads.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Sequence ID or name. Defaults to the active sequence." },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const sequenceLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");`
          : "var seq = app.project.activeSequence; if (!seq) return __error(\"No active sequence\");";
        const script = buildToolScript(`
          ${sequenceLookup}
          var tracks = null;
          var probe = "none";
          try {
            if (typeof seq.getCaptionTracks === "function") { tracks = seq.getCaptionTracks(); probe = "getCaptionTracks"; }
            else if (seq.captionTracks) { tracks = seq.captionTracks; probe = "captionTracks"; }
          } catch (probeError) { tracks = null; probe = "error"; }
          var trackCount = 0;
          var captions = [];
          if (tracks) {
            try { trackCount = tracks.numTracks !== undefined ? tracks.numTracks : tracks.length; } catch (countError) { trackCount = 0; }
            for (var t = 0; t < trackCount; t++) {
              var track = tracks[t];
              var clips = track && (track.clips || track.captions);
              var clipCount = clips ? (clips.numItems !== undefined ? clips.numItems : clips.length) : 0;
              for (var c = 0; c < clipCount; c++) {
                var caption = clips[c];
                var start = null;
                var end = null;
                var text = null;
                try { start = caption.start && caption.start.ticks !== undefined ? __ticksToSeconds(caption.start.ticks) : null; } catch (startError) {}
                try { end = caption.end && caption.end.ticks !== undefined ? __ticksToSeconds(caption.end.ticks) : null; } catch (endError) {}
                try { text = typeof caption.text === "string" ? caption.text : (typeof caption.captionText === "string" ? caption.captionText : null); } catch (textError) {}
                captions.push({ trackIndex: t, startSeconds: start, endSeconds: end, text: text });
              }
            }
          }
          var supported = probe !== "none" && probe !== "error";
          return __result({
            sequenceId: seq.sequenceID,
            sequenceName: seq.name,
            captionReadSupported: supported,
            hostProbe: probe,
            trackCount: trackCount,
            captionCount: captions.length,
            captions: captions,
            note: supported
              ? "Caption tracks were exposed by this host. Text and timing are script readback only; verify rendered subtitles before delivery."
              : "Premiere CEP normally exposes createCaptionTrack but not a caption-track read API. trackCount:0 and captions:[] do not prove this sequence has no captions. Read the source SRT/VTT outside Premiere when cue text and timing are required."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_properties_batch: {
      description:
        "Apply Motion/Opacity values to up to 16 clips after preflighting every target property. The handler reads each requested value back and never reports a partial batch as verified.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            description: "Each item changes one or more supported opacity, Motion scale, position, or rotation values.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                node_id: { type: "string", minLength: 1, maxLength: 512, description: "Timeline clip node ID." },
                opacity: { type: "number", minimum: 0, maximum: 100, description: "Opacity percentage." },
                scale: { type: "number", exclusiveMinimum: 0, description: "Motion scale percentage." },
                position_x: { type: "number", description: "Motion horizontal position in sequence pixels." },
                position_y: { type: "number", description: "Motion vertical position in sequence pixels." },
                rotation: { type: "number", description: "Motion rotation in degrees." },
                speed: { type: "number", description: "Unsupported; supplying it fails before any clip is changed." },
              },
              required: ["node_id"],
            },
          },
        },
        required: ["items"],
      },
      handler: async (args: { items: ClipPropertyBatchItem[] }) => {
        if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 16) {
          return { success: false, error: "items must contain between 1 and 16 clip updates." };
        }
        const seen = new Set<string>();
        for (let index = 0; index < args.items.length; index++) {
          const item = args.items[index];
          if (!item || typeof item.node_id !== "string" || item.node_id.length < 1 || item.node_id.length > 512) {
            return { success: false, error: `items[${index}].node_id must be a non-empty string no longer than 512 characters.` };
          }
          if (seen.has(item.node_id)) return { success: false, error: `items contains duplicate node_id '${item.node_id}'; combine changes for each clip into one item.` };
          seen.add(item.node_id);
          if (item.speed !== undefined) {
            return { success: false, error: "Changing timeline speed is not exposed by Premiere's supported scripting APIs. No batch mutation was attempted." };
          }
          if ((item.opacity !== undefined && (!finiteNumber(item.opacity) || item.opacity < 0 || item.opacity > 100)) ||
            (item.scale !== undefined && (!finiteNumber(item.scale) || item.scale <= 0)) ||
            (item.position_x !== undefined && !finiteNumber(item.position_x)) ||
            (item.position_y !== undefined && !finiteNumber(item.position_y)) ||
            (item.rotation !== undefined && !finiteNumber(item.rotation))) {
            return { success: false, error: `items[${index}] has an invalid property value.` };
          }
          if (item.opacity === undefined && item.scale === undefined && item.position_x === undefined && item.position_y === undefined && item.rotation === undefined) {
            return { success: false, error: `items[${index}] must specify at least one supported property.` };
          }
        }
        const emittedItems = args.items.map((item) => `{
          nodeId: "${escapeForExtendScript(item.node_id)}",
          opacity: ${item.opacity === undefined ? "null" : item.opacity},
          scale: ${item.scale === undefined ? "null" : item.scale},
          positionX: ${item.position_x === undefined ? "null" : item.position_x},
          positionY: ${item.position_y === undefined ? "null" : item.position_y},
          rotation: ${item.rotation === undefined ? "null" : item.rotation}
        }`).join(",");
        const script = buildToolScript(`
          var specs = [${emittedItems}];
          var prepared = [];
          var i;
          function findProperty(clip, componentName, matchName, propertyName) {
            for (var ci = 0; ci < clip.components.numItems; ci++) {
              var component = clip.components[ci];
              if (!component || (component.displayName !== componentName && component.matchName !== matchName)) continue;
              for (var pi = 0; pi < component.properties.numItems; pi++) {
                if (component.properties[pi].displayName === propertyName) return component.properties[pi];
              }
            }
            return null;
          }
          // Resolve all required property handles and old values before writing
          // any clip. A missing component on a later clip therefore cannot cause
          // a partial batch.
          for (i = 0; i < specs.length; i++) {
            var spec = specs[i];
            var found = __findClip(spec.nodeId);
            if (!found) return __error("Clip not found for batch item " + i + ": " + spec.nodeId + ". No batch mutation was attempted.");
            var resolved = { spec: spec, clip: found.clip, opacity: null, scale: null, position: null, rotation: null, old: {} };
            if (spec.opacity !== null) {
              resolved.opacity = findProperty(found.clip, "Opacity", "AE.ADBE Opacity", "Opacity");
              if (!resolved.opacity) return __error("Opacity is unavailable on batch item " + i + ". No batch mutation was attempted.");
              try { resolved.old.opacity = resolved.opacity.getValue(); } catch (opacityReadError) { return __error("Opacity could not be read on batch item " + i + ". No batch mutation was attempted."); }
            }
            if (spec.scale !== null || spec.positionX !== null || spec.positionY !== null || spec.rotation !== null) {
              if (spec.scale !== null) {
                resolved.scale = findProperty(found.clip, "Motion", "AE.ADBE Motion", "Scale");
                if (!resolved.scale) return __error("Motion Scale is unavailable on batch item " + i + ". No batch mutation was attempted.");
                try { resolved.old.scale = resolved.scale.getValue(); } catch (scaleReadError) { return __error("Scale could not be read on batch item " + i + ". No batch mutation was attempted."); }
              }
              if (spec.positionX !== null || spec.positionY !== null) {
                resolved.position = findProperty(found.clip, "Motion", "AE.ADBE Motion", "Position");
                if (!resolved.position) return __error("Motion Position is unavailable on batch item " + i + ". No batch mutation was attempted.");
                try {
                  resolved.old.position = resolved.position.getValue();
                  if (!resolved.old.position || resolved.old.position.length < 2) return __error("Motion Position was unreadable on batch item " + i + ". No batch mutation was attempted.");
                } catch (positionReadError) { return __error("Position could not be read on batch item " + i + ". No batch mutation was attempted."); }
              }
              if (spec.rotation !== null) {
                resolved.rotation = findProperty(found.clip, "Motion", "AE.ADBE Motion", "Rotation");
                if (!resolved.rotation) return __error("Motion Rotation is unavailable on batch item " + i + ". No batch mutation was attempted.");
                try { resolved.old.rotation = resolved.rotation.getValue(); } catch (rotationReadError) { return __error("Rotation could not be read on batch item " + i + ". No batch mutation was attempted."); }
              }
            }
            prepared.push(resolved);
          }
          var applied = [];
          function restoreAll() {
            for (var ri = 0; ri < prepared.length; ri++) {
              var prior = prepared[ri];
              try { if (prior.opacity) prior.opacity.setValue(prior.old.opacity, true); } catch (restoreOpacityError) {}
              try { if (prior.scale) prior.scale.setValue(prior.old.scale, true); } catch (restoreScaleError) {}
              try { if (prior.position) prior.position.setValue(prior.old.position, true); } catch (restorePositionError) {}
              try { if (prior.rotation) prior.rotation.setValue(prior.old.rotation, true); } catch (restoreRotationError) {}
            }
          }
          for (i = 0; i < prepared.length; i++) {
            var update = prepared[i];
            var spec = update.spec;
            try {
              if (update.opacity) update.opacity.setValue(spec.opacity, true);
              if (update.scale) update.scale.setValue(spec.scale, true);
              if (update.position) update.position.setValue([
                spec.positionX === null ? update.old.position[0] : spec.positionX,
                spec.positionY === null ? update.old.position[1] : spec.positionY
              ], true);
              if (update.rotation) update.rotation.setValue(spec.rotation, true);
            } catch (writeError) {
              restoreAll();
              return __error("Premiere rejected batch item " + i + "; a best-effort restore was attempted: " + writeError.toString());
            }
            var mismatch = false;
            try { if (update.opacity && Math.abs(Number(update.opacity.getValue()) - Number(spec.opacity)) > 0.0001) mismatch = true; } catch (readOpacityError) { mismatch = true; }
            try { if (update.scale && Math.abs(Number(update.scale.getValue()) - Number(spec.scale)) > 0.0001) mismatch = true; } catch (readScaleError) { mismatch = true; }
            try {
              if (update.position) {
                var actualPosition = update.position.getValue();
                var expectedX = spec.positionX === null ? update.old.position[0] : spec.positionX;
                var expectedY = spec.positionY === null ? update.old.position[1] : spec.positionY;
                if (!actualPosition || Math.abs(Number(actualPosition[0]) - Number(expectedX)) > 0.0001 || Math.abs(Number(actualPosition[1]) - Number(expectedY)) > 0.0001) mismatch = true;
              }
            } catch (readPositionError) { mismatch = true; }
            try { if (update.rotation && Math.abs(Number(update.rotation.getValue()) - Number(spec.rotation)) > 0.0001) mismatch = true; } catch (readRotationError) { mismatch = true; }
            if (mismatch) {
              restoreAll();
              return __error("Premiere did not verify batch item " + i + "; a best-effort restore was attempted. No partial batch is reported as verified.");
            }
            applied.push({ nodeId: spec.nodeId, clipName: update.clip.name });
          }
          return __result({ updated: true, verified: true, renderVerified: false, verificationScope: "Premiere parameter readback only; verify playback or exported frames before delivery.", items: applied });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    detect_scene_edits: {
      description:
        "Safe scene-edit facade. It uses the authenticated Premiere UXP bridge when connected and explicitly confirmed; CEP fallback is intentionally withheld because synchronous scene detection can block the panel.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["apply_cuts", "create_markers", "create_subclips"], description: "How Premiere should materialize detected edits on the current native selection." },
          confirm_non_undoable: { type: "boolean", description: "Must be true because the host operation mutates the project and is not claimed undoable." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Optional idempotency key sent to the UXP bridge." },
        },
        required: ["mode", "confirm_non_undoable"],
      },
      handler: async (args: { mode: "apply_cuts" | "create_markers" | "create_subclips"; confirm_non_undoable: boolean; operation_id?: string }) => {
        if (args.confirm_non_undoable !== true) {
          return { success: false, error: "detect_scene_edits requires confirm_non_undoable:true. No scene detection was started." };
        }
        if (!uxpBridge) {
          return {
            success: false,
            error:
              "detect_scene_edits requires an authenticated Premiere UXP bridge. The CEP fallback is intentionally unavailable because Premiere's synchronous scene detection can block the panel. Connect UXP, then retry this confirmed request or call detect_scene_edits_uxp directly.",
          };
        }
        const modes: Record<string, string> = {
          apply_cuts: "applyCuts",
          create_markers: "createMarkers",
          create_subclips: "createSubclips",
        };
        const mode = modes[args.mode];
        if (!mode) return { success: false, error: `Unsupported scene-edit mode: ${String(args.mode)}` };
        return resultFromUxp(uxpBridge, "sceneEdit.detect", {
          mode,
          ...(args.operation_id ? { operationId: args.operation_id } : {}),
        });
      },
    },
  };
}
