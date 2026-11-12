import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";

// Adapted from the audio-aware QE clip transition path in
// hetpatel-11/Adobe_Premiere_Pro_MCP (MIT). This uses the same frame-grid,
// exact-target and readback safeguards as this project's video transitions.
// A QE write is experimental and cannot prove how the crossfade sounds.
const AUDIO_TRANSITION_HELPERS = [
  "function __audioTransitionResolve(name) {",
  "  var resolved = null;",
  "  try { if (qe.project.getAudioTransitionByName) resolved = qe.project.getAudioTransitionByName(name); } catch (byNameError) {}",
  "  if (!resolved) {",
  "    try {",
  "      var catalog = __qeCatalogFrom(qe.project.getAudioTransitionList());",
  "      for (var ci = 0; ci < catalog.numItems; ci++) {",
  "        if (String(catalog[ci].name) === name) { resolved = __qeTransitionObject('audio', catalog[ci]); break; }",
  "      }",
  "    } catch (catalogError) {}",
  "  }",
  "  return resolved;",
  "}",
  "function __audioTransitionTimecode(frames, frameTicks) {",
  "  var fps = Math.round(TICKS_PER_SECOND / frameTicks);",
  "  if (!isFinite(fps) || fps < 1 || fps > 240) throw new Error('Unreadable sequence frame rate');",
  "  function pad(v) { return v < 10 ? '0' + v : String(v); }",
  "  return pad(Math.floor(frames / (fps * 3600))) + ':' + pad(Math.floor(frames / (fps * 60)) % 60) + ':' + pad(Math.floor(frames / fps) % 60) + ':' + pad(frames % fps);",
  "}",
  "function __audioTransitionResult(track, before, edgeTicks, frameTicks, name, requestedSeconds, writeError) {",
  "  var after;",
  "  try { after = __transitionSnapshot(track); } catch (readError) {",
  "    return __error('Audio transition may have been changed but post-write readback failed. Inspect the track before retrying.', { outcome: 'committed_unverified', verified: false, mutationAttempted: true, timelineChanged: null });",
  "  }",
  "  var added = after.length - before.length;",
  "  if (added !== 1) {",
  "    return __error('Audio transition write was not verified. Inspect the track before retrying.' + (writeError ? ' ' + writeError : ''), { outcome: added > 0 ? 'committed_unverified' : (writeError ? 'committed_unverified' : 'not_applied'), verified: false, mutationAttempted: true, timelineChanged: added > 0 ? true : (writeError ? null : false), transitionsAdded: added });",
  "  }",
  "  var beforeKeys = {};",
  "  for (var bi = 0; bi < before.length; bi++) beforeKeys[before[bi].startTicks + '-' + before[bi].endTicks] = true;",
  "  var candidate = null, tolerance = frameTicks / 2 + 1;",
  "  for (var ai = 0; ai < after.length; ai++) {",
  "    var tr = after[ai], key = tr.startTicks + '-' + tr.endTicks;",
  "    if (beforeKeys[key]) continue;",
  "    if (Number(tr.startTicks) - tolerance <= edgeTicks && Number(tr.endTicks) + tolerance >= edgeTicks) candidate = tr;",
  "  }",
  "  if (!candidate || writeError) {",
  "    return __error('Premiere changed the audio-transition track but the requested transition was not fully verified. Inspect before retrying.' + (writeError ? ' ' + writeError : ''), { outcome: 'committed_unverified', verified: false, mutationAttempted: true, timelineChanged: true, transitionsAdded: added });",
  "  }",
  "  var actualSeconds = (Number(candidate.endTicks) - Number(candidate.startTicks)) / TICKS_PER_SECOND;",
  "  var durationMatched = Math.abs(actualSeconds - requestedSeconds) <= frameTicks / TICKS_PER_SECOND / 2;",
  "  return __result({ outcome: durationMatched ? 'verified' : 'verified_with_deviation', verified: true, mutationAttempted: true, transitionsAdded: 1, transition: name, actualDurationSeconds: actualSeconds, requestedDurationSeconds: requestedSeconds, durationMatched: durationMatched, placement: candidate, verificationScope: 'Stored audio transition placement/duration only; audition or render is required to validate the crossfade sound.' });",
  "}",
].join("\n");

function validate(duration: number, trackIndex?: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
    return "duration_seconds must be finite, greater than zero and no more than 60.";
  }
  if (trackIndex !== undefined && (!Number.isInteger(trackIndex) || trackIndex < 0)) {
    return "track_index must be a non-negative integer.";
  }
  return null;
}

function audioTransitionScript(
  args: { node_id?: string; track_index?: number; cut_point_seconds?: number; position?: "start" | "end"; duration_seconds?: number; transition_name?: string },
): string {
  const name = args.transition_name ?? "Constant Power";
  const duration = args.duration_seconds ?? 1;
  const target = args.node_id !== undefined
    ? [
        "var info = __findClip(" + '"' + escapeForExtendScript(args.node_id) + '"' + ");",
        "if (!info || info.trackType !== 'audio') return __refuse('Target must be an audio timeline clip; nothing was changed.');",
        "var trackIndex = info.trackIndex;",
        "var targetClip = info.clip;",
        "var atStart = " + (args.position === "start" ? "true" : "false") + ";",
      ]
    : [
        "var trackIndex = " + args.track_index + ";",
        "var targetClip = null;",
        "var atStart = true;",
      ];

  const lines = [
    AUDIO_TRANSITION_HELPERS,
    "app.enableQE();",
    "var seq = app.project && app.project.activeSequence;",
    "var qeSeq = qe.project.getActiveSequence();",
    "if (!seq || !qeSeq) return __refuse('No active sequence; no audio transition was attempted.');",
    ...target,
    "var track = seq.audioTracks[trackIndex];",
    "var qeTrack = qeSeq.getAudioTrackAt(trackIndex);",
    "if (!track || !qeTrack) return __refuse('Audio track not found; nothing was changed.');",
    "var frameTicks = Number(seq.timebase);",
    "if (!isFinite(frameTicks) || frameTicks <= 0 || frameTicks > TICKS_PER_SECOND) return __refuse('Invalid sequence frame grid; nothing was changed.');",
  ];

  if (args.node_id === undefined) {
    lines.push(
      "var requestedCutTicks = __secondsToTicks(" + args.cut_point_seconds + ");",
      "if (!isFinite(requestedCutTicks)) return __refuse('Invalid cut time.');",
      "var tolerance = frameTicks / 2 + 1, found = 0;",
      "for (var ci = 0; ci < track.clips.numItems; ci++) {",
      "  var incoming = track.clips[ci];",
      "  if (Math.abs(Number(incoming.start.ticks) - requestedCutTicks) > tolerance) continue;",
      "  for (var oi = 0; oi < track.clips.numItems; oi++) {",
      "    if (oi === ci) continue;",
      "    var outgoing = track.clips[oi];",
      "    if (Math.abs(Number(outgoing.end.ticks) - Number(incoming.start.ticks)) <= tolerance) { targetClip = incoming; found++; }",
      "  }",
      "}",
      "if (found !== 1 || !targetClip) return __refuse('The cut must identify exactly one pair of adjacent audio clips on the selected track; nothing changed.');",
    );
  }

  lines.push(
    "var edgeTicks = Number(atStart ? targetClip.start.ticks : targetClip.end.ticks);",
    "var before;",
    "try { before = __transitionSnapshot(track); } catch (beforeError) { return __refuse('Cannot inspect audio transitions before editing; nothing changed. ' + String(beforeError)); }",
    "for (var ex = 0; ex < before.length; ex++) {",
    "  if (Number(before[ex].startTicks) - frameTicks / 2 - 1 <= edgeTicks && Number(before[ex].endTicks) + frameTicks / 2 + 1 >= edgeTicks) return __refuse('A transition already covers the requested audio clip edge; nothing changed.');",
    "}",
    "var transitionName = '" + escapeForExtendScript(name) + "';",
    "var transition = __audioTransitionResolve(transitionName);",
    "if (!transition) return __refuse('Audio transition is unavailable in the QE host: ' + transitionName + '. Check list_available_audio_transitions or try a supported name. Nothing changed.');",
    "var qeClip = __findQeClipByDomClip(qeTrack, targetClip);",
    "if (!qeClip || typeof qeClip.addTransition !== 'function') return __refuse('Target audio QE clip cannot add transitions; nothing changed.');",
    "var durationFrames = Math.max(1, Math.round(__secondsToTicks(" + duration + ") / frameTicks));",
    "var writeError = null;",
    "try { qeClip.addTransition(transition, atStart, __audioTransitionTimecode(durationFrames, frameTicks), '0', 0.5, false, true); }",
    "catch (err) { writeError = String(err); }",
    "return __audioTransitionResult(track, before, edgeTicks, frameTicks, transitionName, " + duration + ", writeError);",
  );
  return buildToolScript(lines.join("\n"));
}

export function getAudioTransitionTools(bridgeOptions: BridgeOptions) {
  return {
    add_audio_transition: {
      description: "EXPERIMENTAL (undocumented QE DOM): Add a native audio crossfade at the cut between two adjacent clips on one audio track. Defaults to Constant Power. Verifies timeline placement and duration, not playback. This tool cannot bridge clips on different tracks.",
      parameters: {
        type: "object",
        properties: {
          track_index: { type: "integer", minimum: 0, description: "Zero-based audio track index containing both clips." },
          cut_point_seconds: { type: "number", minimum: 0, description: "Sequence time of the adjacent audio clip cut in seconds." },
          duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 60, description: "Transition duration in seconds (default 1)." },
          transition_name: { type: "string", minLength: 1, maxLength: 128, description: "Exact installed audio transition name (default Constant Power)." },
        },
        required: ["track_index", "cut_point_seconds"],
      },
      handler: async (args: { track_index: number; cut_point_seconds: number; duration_seconds?: number; transition_name?: string }) => {
        const error = validate(args.duration_seconds ?? 1, args.track_index);
        if (error) return { success: false, error };
        if (!Number.isFinite(args.cut_point_seconds) || args.cut_point_seconds < 0) {
          return { success: false, error: "cut_point_seconds must be a finite, non-negative time." };
        }
        if (args.transition_name !== undefined && (args.transition_name.trim().length === 0 || args.transition_name.length > 128)) {
          return { success: false, error: "transition_name must contain 1–128 characters." };
        }
        return sendCommand(audioTransitionScript(args), bridgeOptions);
      },
    },
    add_audio_transition_to_clip: {
      description: "EXPERIMENTAL (undocumented QE DOM): Add a native audio transition to the start (fade-in) or end (fade-out) of a particular audio clip. Defaults to Constant Power. An edge shared with an adjacent audio clip can form a crossfade; requires host readback and listening to verify.",
      parameters: {
        type: "object",
        properties: {
          node_id: { type: "string", minLength: 1, description: "Premiere node ID of the target timeline audio clip." },
          position: { type: "string", enum: ["start", "end"], description: "Apply to the start or end edge of the audio clip." },
          duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 60, description: "Transition duration in seconds (default 1)." },
          transition_name: { type: "string", minLength: 1, maxLength: 128, description: "Exact audio transition name (default Constant Power)." },
        },
        required: ["node_id", "position"],
      },
      handler: async (args: { node_id: string; position: "start" | "end"; duration_seconds?: number; transition_name?: string }) => {
        const error = validate(args.duration_seconds ?? 1);
        if (error) return { success: false, error };
        if (!args.node_id || !["start", "end"].includes(args.position)) {
          return { success: false, error: "Provide a valid node_id and position (start or end)." };
        }
        if (args.transition_name !== undefined && (args.transition_name.trim().length === 0 || args.transition_name.length > 128)) {
          return { success: false, error: "transition_name must contain 1–128 characters." };
        }
        return sendCommand(audioTransitionScript(args), bridgeOptions);
      },
    },
  };
}
