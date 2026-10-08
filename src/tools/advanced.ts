import { prepareAdjacentMediaBounds } from "./adjacent-media-bounds.js";
import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { compareMogrtText, extractMogrtText, summarizeMogrtText, validateMogrtTextMap } from "./mogrt-text.js";
import { SPEED_UNAVAILABLE_DESCRIPTION, SPEED_UNAVAILABLE_ERROR } from "./timeline.js";
import { probeMediaDurationTicks } from "./media-evidence.js";
import { rippleDeleteScriptBody } from "./ripple-delete-script.js";

// Selected clips plus link readers shared by link_selection and unlink_selection.
// getLinkedItems() returns null for an unlinked clip and includes the clip itself.
const SELECTION_LINK_PREAMBLE = `
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var selection = null;
          try { selection = seq.getSelection(); } catch (selectionError) {}
          if (!selection || !selection.length) return __error("No clips are selected. Select clips first (for example with set_clip_selection). Nothing was changed.");
          function linkedIds(clip) {
            var linked = null;
            try { linked = clip.getLinkedItems(); } catch (linkedError) { return null; }
            var ids = [];
            for (var li = 0; linked && li < linked.numItems; li++) ids.push(String(linked[li].nodeId));
            return ids;
          }
          function contains(list, value) {
            for (var ci = 0; ci < list.length; ci++) if (list[ci] === value) return true;
            return false;
          }
          function describeSelection() {
            var out = [];
            for (var di = 0; di < selection.length && di < 50; di++) out.push({ nodeId: String(selection[di].nodeId), name: selection[di].name });
            return out;
          }
`;

export function getAdvancedTools(
  bridgeOptions: BridgeOptions,
  dependencies: { probeMediaDurationSeconds?: (path: string) => Promise<number | null>; probeMediaDurationTicks?: (path: string) => Promise<number | null> } = {},
) {
  // SEC FORK (#712): injectable for tests; defaults to real ffprobe evidence.
  const probeMediaEndTicks = dependencies.probeMediaDurationTicks ?? (dependencies.probeMediaDurationSeconds
    ? async (path: string) => {
      const seconds = await dependencies.probeMediaDurationSeconds!(path);
      return seconds === null ? null : Math.floor(seconds * 254016000000);
    }
    : probeMediaDurationTicks);
  return {
    ripple_delete: {
      description:
        "Remove a clip and close the gap it leaves, shifting later clips earlier on the clip's own track and on every sync-locked track so audio stays in sync. With the default scope the clip's linked audio/video partners are removed with it and their tracks close up too, even when not sync-locked; with scope 'own_track' the partners stay in place (reported as linkedPartnersKept). Premiere's QE rippleDelete() and the DOM's rippleEdit flag are both non-functional on 26.x, so this is done explicitly and verified. Refuses without changing anything if a clip on a participating track straddles the ripple point or sits inside the range being closed.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to ripple delete",
          },
          scope: {
            type: "string",
            enum: ["sync_locked", "own_track"],
            description:
              "Which tracks shift: 'sync_locked' (default) shifts the clip's track plus every sync-locked track, matching Premiere's ripple behaviour; 'own_track' shifts only the clip's own track and WILL desync other tracks.",
          },
          range_content: {
            type: "string",
            enum: ["refuse", "delete"],
            description:
              "What to do about other clips on participating tracks that sit entirely inside the time range being closed (the usual case in a multicam-style sequence with aligned clips). With scope 'sync_locked' the clip's own linked audio/video partners are always removed with it, as in Premiere; with 'own_track' they are kept. 'refuse' (default) changes nothing and reports them; 'delete' also removes them, i.e. lifts that whole time segment out of every participating track and closes up. 'delete' is destructive across tracks -- the removed clips are listed in the result.",
          },
          dry_run: {
            type: "boolean",
            description:
              "Validate and report the shift plan without changing the timeline (default: false)",
          },
          allow_large_ripple: { type: "boolean", description: "Allow a ripple above large_ripple_threshold after its preflight estimate." },
          large_ripple_threshold: { type: "integer", minimum: 1, maximum: 5000, description: "Mover count above which ripple_delete refuses unless allow_large_ripple is true (default: 400)." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        scope?: "sync_locked" | "own_track";
        range_content?: "refuse" | "delete";
        dry_run?: boolean;
        allow_large_ripple?: boolean;
        large_ripple_threshold?: number;
      }) => {
        const nodeId = escapeForExtendScript(args.node_id);
        const scope = args.scope === "own_track" ? "own_track" : "sync_locked";
        const rangeDelete = args.range_content === "delete";
        const dryRun = args.dry_run === true;
        const threshold = args.large_ripple_threshold ?? 400;
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 5000) return { success: false, error: "large_ripple_threshold must be an integer from 1 to 5000." };
        const preflightScript = buildToolScript(rippleDeleteScriptBody({ nodeId, scope, rangeDelete, dryRun: true, allowLargeRipple: true, largeRippleThreshold: threshold }));
        const preflight = await sendCommand(preflightScript, bridgeOptions);
        if (!preflight.success || dryRun) return preflight;
        const counts = preflight.data as { totalMovers?: number; estimatedSeconds?: number } | undefined;
        const movers = counts?.totalMovers ?? 0;
        if (movers > threshold && args.allow_large_ripple !== true) return { success: false, error: `Large ripple refused before mutation: ${movers} clips would move (estimated ${counts?.estimatedSeconds ?? Math.ceil(movers * 0.15 + 0.5)} seconds). Pass allow_large_ripple: true to proceed.`, data: { movers, estimatedSeconds: counts?.estimatedSeconds, largeRippleThreshold: threshold, mutationOutcome: "not_applied", timelineChanged: false } };
        // Budget 400ms per mover plus 30s startup/readback headroom, capped at 15 minutes.
        const timeoutMs = Math.max(bridgeOptions.timeoutMs ?? 30000, Math.min(900000, 30000 + movers * 400));
        const script = buildToolScript(rippleDeleteScriptBody({ nodeId, scope, rangeDelete, dryRun: false, allowLargeRipple: args.allow_large_ripple === true, largeRippleThreshold: threshold }));
        return sendCommand(script, { ...bridgeOptions, timeoutMs, mutationOnTimeout: true, mutating: true });
      },
    },

    roll_edit: {
      description:
        "Perform a verified roll edit at the outgoing cut of a clip using the public timeline DOM, moving both visible edges and their source in/out points and verifying all four. Linked audio/video partners get the same edit by default (include_linked); every clip is checked before any is changed. Requires readable finite media and ffprobe duration evidence for every edited source; refuses unknown duration, stills, and nonunit/reversed speed before mutation.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = roll right, negative = roll left)",
          },
          include_linked: {
            type: "boolean",
            description: "Also apply the edit to the clip's linked audio/video partners so picture and sound stay in sync (default: true).",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number; include_linked?: boolean }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }

        const bounds = await prepareAdjacentMediaBounds(bridgeOptions, args.node_id, args.include_linked !== false, false);
        if (!bounds.success) return bounds;
        const script = buildToolScript(`
          ${bounds.script}
          function __editOne(result, nodeId, checkOnly) {
            var track = result.trackType === "video"
              ? app.project.activeSequence.videoTracks[result.trackIndex]
              : app.project.activeSequence.audioTracks[result.trackIndex];
            var outgoing = track.clips[result.clipIndex + 1];
            if (!outgoing) return __editFail("A roll edit requires the selected clip to have an outgoing adjacent clip on the same track.");
            var beforeStart = String(result.clip.start.ticks);
            var beforeEnd = String(result.clip.end.ticks);
            if (String(outgoing.start.ticks) !== beforeEnd) return __editFail("A roll edit requires two contiguous clips with no gap at the outgoing cut.");
            var frameTicks = __sequenceFrameTicks(app.project.activeSequence);
            if (!isFinite(frameTicks)) return __editFail("The active sequence frame grid could not be read; no roll was attempted.");
            var requestedOffsetTicks = __secondsToTicks(${args.offset_seconds});
            var offsetTicks = __snapSequenceTicks(app.project.activeSequence, requestedOffsetTicks);
            if (!offsetTicks) return __editFail("The requested offset is smaller than one frame after sequence-grid snapping; no roll was attempted.");
            var newCutTicks = parseFloat(beforeEnd) + offsetTicks;
            if (newCutTicks <= parseFloat(result.clip.start.ticks) || newCutTicks >= parseFloat(outgoing.end.ticks)) {
              return __editFail("The requested roll offset would create a zero- or negative-duration clip.");
            }
            // A roll moves the shared cut, so the source in/out points must move with
            // the visible edges. Writing only start/end leaves inPoint/outPoint stale
            // and inconsistent with what the timeline shows.
            var beforeOut = String(result.clip.outPoint.ticks);
            var beforeIncomingIn = String(outgoing.inPoint.ticks);
            var expectedOut = String(Math.round(parseFloat(beforeOut) + offsetTicks));
            var expectedIncomingIn = String(Math.round(parseFloat(beforeIncomingIn) + offsetTicks));
            if (!sourceEnds[String(result.clip.nodeId)] || !sourceEnds[String(outgoing.nodeId)]) return __editFail("Adjacent edit target changed after source inspection; nothing was changed.");
            if (parseFloat(expectedOut) > sourceEnds[String(result.clip.nodeId)] || parseFloat(expectedIncomingIn) < 0 || parseFloat(expectedIncomingIn) >= parseFloat(outgoing.outPoint.ticks) || parseFloat(expectedOut) <= parseFloat(result.clip.inPoint.ticks)) {
              return __editFail("The requested roll would exceed physical media duration or create an invalid source range. Nothing was changed.");
            }
            if (checkOnly) return __editOk({ checked: true, affectedNodeIds: [String(result.clip.nodeId), String(outgoing.nodeId)] });

            var newCut = new Time();
            newCut.ticks = String(Math.round(newCutTicks));
            result.clip.end = newCut;
            outgoing.start = newCut;
            try {
              result.clip.outPoint = expectedOut;
              outgoing.inPoint = expectedIncomingIn;
            } catch (sourceRangeError) {
              return __editFail("Premiere moved the visible cut but rejected the matching source in/out change, so the clips' in/out metadata no longer matches the timeline: " + sourceRangeError.toString());
            }

            var after = __findClip(nodeId);
            if (!after) return __editFail("Clip could not be found after the roll edit");
            if (String(after.clip.start.ticks) === beforeStart && String(after.clip.end.ticks) === beforeEnd) {
              return __editFail("The roll edit returned without an observable timeline change; no successful edit is reported.");
            }
            if (String(after.clip.end.ticks) !== String(outgoing.start.ticks)) return __editFail("The roll edit left a gap or overlap at the edited cut.");
            var afterOut = String(after.clip.outPoint.ticks);
            var afterIncomingIn = String(outgoing.inPoint.ticks);
            if (afterOut !== expectedOut || afterIncomingIn !== expectedIncomingIn) {
              return __editFail("Premiere moved the visible cut but the source in/out metadata did not follow: outgoing outPoint is " + afterOut + " (expected " + expectedOut + ") and the incoming clip's inPoint is " + afterIncomingIn + " (expected " + expectedIncomingIn + "). The timeline is now inconsistent with the clips' in/out points; undo this edit in Premiere before continuing.");
            }
            var rollPayload = {
              rolled: true,
              verified: true,
              clipName: after.clip.name,
              offsetSeconds: ${args.offset_seconds},
              before: { startTicks: beforeStart, endTicks: beforeEnd, outPointTicks: beforeOut, incomingInPointTicks: beforeIncomingIn },
              after: {
                startTicks: String(after.clip.start.ticks),
                endTicks: String(after.clip.end.ticks),
                outPointTicks: afterOut,
                incomingInPointTicks: afterIncomingIn
              },
              verification: "timeline_edge_and_source_in_out_readback"
            };
            if (Math.abs(offsetTicks - requestedOffsetTicks) > frameTicks / 1000) {
              rollPayload.requestedOffsetSeconds = __ticksToSeconds(requestedOffsetTicks);
              rollPayload.appliedOffsetFrames = Math.round(offsetTicks / frameTicks);
            }
            if (Math.abs(parseFloat(after.clip.end.ticks) / frameTicks - Math.round(parseFloat(after.clip.end.ticks) / frameTicks)) > 0.001) return __editFail("The roll edit read back off the active sequence frame grid; the edit is not verified.");
            return __editOk(rollPayload);
          }
          var target = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!target) return __error("Clip not found");
          return __runLinkedEdit(target, "${escapeForExtendScript(args.node_id)}", ${args.include_linked === false ? "false" : "true"}, __editOne, "roll", validatedPartners);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    slide_edit: {
      description:
        "Perform a verified slide edit on a clip using adjacent clips from the public timeline DOM. Linked audio/video partners get the same edit by default (include_linked); every clip is checked before any is changed. Requires readable finite media and ffprobe duration evidence for every edited source; refuses unknown duration, stills, and nonunit/reversed speed before mutation.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = slide right, negative = slide left)",
          },
          include_linked: {
            type: "boolean",
            description: "Also apply the edit to the clip's linked audio/video partners so picture and sound stay in sync (default: true).",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number; include_linked?: boolean }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }
        const bounds = await prepareAdjacentMediaBounds(bridgeOptions, args.node_id, args.include_linked !== false, true);
        if (!bounds.success) return bounds;
        const script = buildToolScript(`
          ${bounds.script}
          // Everything a slide needs, checked without changing the timeline, so the
          // clip and all its linked partners are validated before any of them move
          // (live: the video slid, then its audio partner was refused at a gap).
          function __slideCheck(result) {
            var track = result.trackType === "video"
              ? app.project.activeSequence.videoTracks[result.trackIndex]
              : app.project.activeSequence.audioTracks[result.trackIndex];
            var previous = track.clips[result.clipIndex - 1];
            var following = track.clips[result.clipIndex + 1];
            if (!previous || !following) return __editFail("A slide edit requires contiguous clips before and after the selected clip on the same track.");
            var beforeStart = String(result.clip.start.ticks);
            var beforeEnd = String(result.clip.end.ticks);
            if (String(previous.end.ticks) !== beforeStart || String(following.start.ticks) !== beforeEnd) {
              return __editFail("A slide edit requires no gaps at either adjacent cut.");
            }
            var frameTicks = __sequenceFrameTicks(app.project.activeSequence);
            if (!isFinite(frameTicks)) return __editFail("The active sequence frame grid could not be read; no slide was attempted.");
            var requestedOffsetTicks = __secondsToTicks(${args.offset_seconds});
            var deltaTicks = __snapSequenceTicks(app.project.activeSequence, requestedOffsetTicks);
            if (!deltaTicks) return __editFail("The requested offset is smaller than one frame after sequence-grid snapping; no slide was attempted.");
            var centerIn = String(result.clip.inPoint.ticks), centerOut = String(result.clip.outPoint.ticks);
            var previousIn = String(previous.inPoint.ticks), followingOut = String(following.outPoint.ticks);
            var expectedPreviousOut = Math.round(parseFloat(previous.outPoint.ticks) + deltaTicks);
            var expectedFollowingIn = Math.round(parseFloat(following.inPoint.ticks) + deltaTicks);
            if (!sourceEnds[String(previous.nodeId)] || !sourceEnds[String(following.nodeId)] || !sourceEnds[String(result.clip.nodeId)]) return __editFail("Adjacent edit target changed after source inspection; nothing was changed.");
            if (expectedPreviousOut > sourceEnds[String(previous.nodeId)]) return __editFail("The requested slide would exceed physical media duration; nothing was changed.");
            if (!isFinite(expectedPreviousOut) || !isFinite(expectedFollowingIn) || expectedFollowingIn < 0 ||
              expectedPreviousOut <= parseFloat(previousIn) || expectedFollowingIn >= parseFloat(followingOut)) {
              return __editFail("The requested slide would create an invalid adjacent source range. Nothing was changed.");
            }
            var newStartTicks = parseFloat(beforeStart) + deltaTicks;
            var newEndTicks = parseFloat(beforeEnd) + deltaTicks;
            if (newStartTicks <= parseFloat(previous.start.ticks) || newEndTicks >= parseFloat(following.end.ticks)) {
              return __editFail("The requested slide offset would create a zero- or negative-duration adjacent clip.");
            }
            return __editOk({ previous: previous, following: following, beforeStart: beforeStart, beforeEnd: beforeEnd, deltaTicks: deltaTicks, requestedOffsetTicks: requestedOffsetTicks, frameTicks: frameTicks, newStartTicks: newStartTicks, newEndTicks: newEndTicks,
              affectedNodeIds: [String(result.clip.nodeId), String(previous.nodeId), String(following.nodeId)],
              centerIn: centerIn, centerOut: centerOut, previousIn: previousIn, followingOut: followingOut,
              previousStart: String(previous.start.ticks), followingEnd: String(following.end.ticks) });
          }
          function __editOne(result, nodeId, checkOnly) {
            var checked = __slideCheck(result);
            if (!checked.ok || checkOnly) return checked;
            var previous = checked.data.previous;
            var following = checked.data.following;
            var beforeStart = checked.data.beforeStart;
            var beforeEnd = checked.data.beforeEnd;
            var deltaTicks = checked.data.deltaTicks;
            var newStartTicks = checked.data.newStartTicks;
            var newEndTicks = checked.data.newEndTicks;
            var newStart = new Time();
            newStart.ticks = String(Math.round(newStartTicks));
            var newEnd = new Time();
            newEnd.ticks = String(Math.round(newEndTicks));
            // A slide trims the neighbours: the previous clip's out point and the
            // following clip's in point move with their edges. Moving only the
            // edges kept the following clip's old in point, which shifted its
            // picture by the slide amount (a hidden slip; verified on 25.2).
            var slideTicks = Math.round(deltaTicks);
            var expectedPreviousOut = String(Math.round(parseFloat(previous.outPoint.ticks) + slideTicks));
            var expectedFollowingIn = String(Math.round(parseFloat(following.inPoint.ticks) + slideTicks));
            previous.end = newStart;
            __writeClipSpan(result.clip, newStart.ticks, newEnd.ticks);
            following.start = newEnd;
            try {
              previous.outPoint = expectedPreviousOut;
              following.inPoint = expectedFollowingIn;
            } catch (sourceRangeError) {
              return __editFail("Premiere moved the clip but rejected the neighbours' matching source change: " + sourceRangeError.toString() + ". Undo this edit before continuing.");
            }
            if (String(previous.outPoint.ticks) !== expectedPreviousOut || String(following.inPoint.ticks) !== expectedFollowingIn) {
              return __editFail("Premiere moved the clip but the neighbours' source points did not follow (previous out " + previous.outPoint.ticks + ", expected " + expectedPreviousOut + "; following in " + following.inPoint.ticks + ", expected " + expectedFollowingIn + "). Undo this edit before continuing.");
            }
            var after = __findClip(nodeId);
            if (!after) return __editFail("Clip could not be found after the slide edit");
            if (String(after.clip.start.ticks) !== String(Math.round(newStartTicks)) ||
                String(after.clip.end.ticks) !== String(Math.round(newEndTicks)) ||
                String(after.clip.inPoint.ticks) !== checked.data.centerIn || String(after.clip.outPoint.ticks) !== checked.data.centerOut ||
                String(previous.start.ticks) !== checked.data.previousStart || String(following.end.ticks) !== checked.data.followingEnd ||
                String(previous.inPoint.ticks) !== checked.data.previousIn || String(following.outPoint.ticks) !== checked.data.followingOut) {
              return __editFail("Premiere did not read back the requested slide placement and preserved source windows; the slide is unverified.");
            }
            if (String(after.clip.start.ticks) === beforeStart && String(after.clip.end.ticks) === beforeEnd) {
              return __editFail("The slide edit returned without an observable timeline change; no successful edit is reported.");
            }
            if (String(previous.end.ticks) !== String(after.clip.start.ticks) || String(after.clip.end.ticks) !== String(following.start.ticks)) {
              return __editFail("The slide edit left a gap or overlap at an adjacent cut.");
            }
            var slidePayload = {
              durationDrifts: sourceDurationDrifts,
              slid: true,
              verified: true,
              clipName: after.clip.name,
              offsetSeconds: ${args.offset_seconds},
              before: { startTicks: beforeStart, endTicks: beforeEnd },
              after: { startTicks: String(after.clip.start.ticks), endTicks: String(after.clip.end.ticks) }
            };
            if (Math.abs(checked.data.deltaTicks - checked.data.requestedOffsetTicks) > checked.data.frameTicks / 1000) {
              slidePayload.requestedOffsetSeconds = __ticksToSeconds(checked.data.requestedOffsetTicks);
              slidePayload.appliedOffsetFrames = Math.round(checked.data.deltaTicks / checked.data.frameTicks);
            }
            if (Math.abs(parseFloat(after.clip.start.ticks) / checked.data.frameTicks - Math.round(parseFloat(after.clip.start.ticks) / checked.data.frameTicks)) > 0.001 ||
                Math.abs(parseFloat(after.clip.end.ticks) / checked.data.frameTicks - Math.round(parseFloat(after.clip.end.ticks) / checked.data.frameTicks)) > 0.001) return __editFail("The slide edit read back off the active sequence frame grid; the edit is not verified.");
            return __editOk(slidePayload);
          }
          var target = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!target) return __error("Clip not found");
          return __runLinkedEdit(target, "${escapeForExtendScript(args.node_id)}", ${args.include_linked === false ? "false" : "true"}, __editOne, "slide", validatedPartners);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    slip_edit: {
      description:
        "Perform a verified slip edit on a clip using public source in/out properties. Requires accessible physical media duration from ffprobe; unknown duration or linked partners using different source files refuse before mutation. Linked audio/video partners get the same edit by default (include_linked); every clip is checked before any is changed.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          offset_seconds: {
            type: "number",
            description:
              "Offset in seconds (positive = slip forward in source, negative = slip backward)",
          },
          include_linked: {
            type: "boolean",
            description: "Also apply the edit to the clip's linked audio/video partners so picture and sound stay in sync (default: true).",
          },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (args: { node_id: string; offset_seconds: number; include_linked?: boolean }) => {
        if (!Number.isFinite(args.offset_seconds) || args.offset_seconds === 0) {
          return { success: false, error: "offset_seconds must be a finite, non-zero number" };
        }
        // SEC FORK (#712 review): slip bound uses REAL media duration (ffprobe
        // on the clip's media file), never the editable source Out mark. Two
        // phases like trim_clip; missing evidence refuses before mutation.
        const evidenceScript = buildToolScript(`
          var projectId; var sequenceId;
          try { projectId = app.project.documentID; sequenceId = app.project.activeSequence.sequenceID; } catch (contextError) {}
          if (typeof projectId !== "string" || !projectId.length || typeof sequenceId !== "string" || !sequenceId.length) return __error("Project and sequence identities could not be read; no edit was attempted.");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var mp = "";
          try { mp = String(result.clip.projectItem.getMediaPath() || ""); } catch (eMediaPath) {}
          return __result({ mediaPath: mp, projectId: projectId, sequenceId: sequenceId });
        `);
        let mediaDurationTicks: number | null = null;
        let mediaPath = "";
        let projectId = "";
        let sequenceId = "";
        try {
          const evidence = await sendCommand(evidenceScript, bridgeOptions);
          if (evidence && evidence.success === false) return evidence;
          const evidenceData = (evidence as { data?: { mediaPath?: unknown; projectId?: unknown; sequenceId?: unknown } } | undefined)?.data;
          mediaPath = typeof evidenceData?.mediaPath === "string" ? evidenceData.mediaPath : "";
          projectId = typeof evidenceData?.projectId === "string" ? evidenceData.projectId : "";
          sequenceId = typeof evidenceData?.sequenceId === "string" ? evidenceData.sequenceId : "";
          if (!projectId || !sequenceId) return { success: false, error: "Project and sequence identities could not be read; no edit was attempted." };
          mediaDurationTicks = mediaPath ? await probeMediaEndTicks(mediaPath) : null;
        } catch {
          mediaDurationTicks = null;
        }
        if (mediaDurationTicks === null || !Number.isSafeInteger(mediaDurationTicks) || mediaDurationTicks <= 0) {
          return { success: false, error: "Physical media duration could not be verified in the exact tick range. No edit was attempted. ffprobe must be available and source media must expose readable integer timestamp clocks; editable project In/Out marks are not media boundaries." };
        }
        // SEC FORK (#712): the whole bound line is resolved Node-side (numbers
        // embedded) so the generated script never references Node variables.
        const slipMediaBound = `
            if (newOutTicks > ${mediaDurationTicks}) {
              return __editFail("The requested slip offset would move the source out point to " + (newOutTicks / TICKS_PER_SECOND) + "s, past this clip's real media duration of ${(mediaDurationTicks / 254016000000).toFixed(3)}s (ffprobe); slip was not attempted.");
            }`;
        const script = buildToolScript(`
          var currentProjectId; var currentSequenceId;
          try { currentProjectId = app.project.documentID; currentSequenceId = app.project.activeSequence.sequenceID; } catch (contextError) {}
          if (currentProjectId !== "${escapeForExtendScript(projectId)}" || currentSequenceId !== "${escapeForExtendScript(sequenceId)}") return __error("Project or active sequence changed after media preflight; no edit was attempted.");
          function __editOne(result, nodeId, checkOnly) {
            var currentMediaPath = "";
            try { currentMediaPath = String(result.clip.projectItem.getMediaPath() || ""); } catch (eBoundPath) {}
            if (currentMediaPath !== "${escapeForExtendScript(mediaPath)}") return __editFail("This clip or linked partner uses media without the preflight duration evidence; no edit was attempted.");

            var beforeStart = String(result.clip.start.ticks);
            var beforeEnd = String(result.clip.end.ticks);
            var beforeIn = String(result.clip.inPoint.ticks);
            var beforeOut = String(result.clip.outPoint.ticks);
            var frameTicks = __sequenceFrameTicks(app.project.activeSequence);
            if (!isFinite(frameTicks)) return __editFail("The active sequence frame grid could not be read; no slip was attempted.");
            var requestedOffsetTicks = __secondsToTicks(${args.offset_seconds});
            var deltaTicks = __snapSequenceTicks(app.project.activeSequence, requestedOffsetTicks);
            if (!deltaTicks) return __editFail("The requested offset is smaller than one frame after sequence-grid snapping; no slip was attempted.");
            var speed = null, reversed = null;
            try { speed = result.clip.getSpeed(); } catch (speedError) {}
            try { reversed = result.clip.isSpeedReversed(); } catch (reverseError) {}
            if ((speed !== 1 && speed !== 100) || (reversed !== false && reversed !== 0)) return __editFail("Source-side slip snapping requires a forward 1x clip; this clip's speed could not be mapped to timeline frames. No change was attempted.");
            var newInTicks = parseFloat(beforeIn) + deltaTicks;
            var newOutTicks = parseFloat(beforeOut) + deltaTicks;
            if (newInTicks < 0 || newOutTicks <= newInTicks) return __editFail("The requested slip offset would create an invalid source range.");
            // SEC FORK (#712): upper bound from REAL media duration (ffprobe,
            // probed Node-side and embedded exactly), never the editable mark.${slipMediaBound}
            if (checkOnly) return __editOk({ checked: true });
            var newIn = new Time();
            newIn.ticks = String(Math.round(newInTicks));
            var newOut = new Time();
            newOut.ticks = String(Math.round(newOutTicks));
            result.clip.inPoint = newIn;
            result.clip.outPoint = newOut;
            var after = __findClip(nodeId);
            if (!after) return __editFail("Clip could not be found after the slip edit");
            if (String(after.clip.start.ticks) !== beforeStart || String(after.clip.end.ticks) !== beforeEnd) {
              return __editFail("The slip edit changed the timeline placement instead of only source in/out points.");
            }
            if (String(after.clip.inPoint.ticks) === beforeIn && String(after.clip.outPoint.ticks) === beforeOut) {
              return __editFail("The slip edit returned without an observable source in/out change; no successful edit is reported.");
            }
            var slipPayload = {
              slipped: true,
              verified: true,
              clipName: after.clip.name,
              offsetSeconds: ${args.offset_seconds},
              before: { inTicks: beforeIn, outTicks: beforeOut },
              after: { inTicks: String(after.clip.inPoint.ticks), outTicks: String(after.clip.outPoint.ticks) }
            };
            if (Math.abs(deltaTicks - requestedOffsetTicks) > frameTicks / 1000) {
              slipPayload.requestedOffsetSeconds = __ticksToSeconds(requestedOffsetTicks);
              slipPayload.appliedOffsetFrames = Math.round(deltaTicks / frameTicks);
            }
            return __editOk(slipPayload);
          }
          var target = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!target) return __error("Clip not found");
          return __runLinkedEdit(target, "${escapeForExtendScript(args.node_id)}", ${args.include_linked === false ? "false" : "true"}, __editOne, "slip");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_clip_to_track: {
      description:
        "Move a clip to a different track of the same type, keeping its start, duration, and source in/out. EXPERIMENTAL: uses the undocumented QE DOM moveToTrack. " +
        "Refuses without changing anything when the origin or destination track is locked or the destination range is occupied. " +
        "Reads the timeline back: verified only when the clip is on the destination track with the same span and source range and is gone from the origin track; committed_unverified when the source range cannot be read; otherwise failure with Undo guidance.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          target_track_index: {
            type: "number",
            description: "Target track index (0-based)",
          },
        },
        required: ["node_id", "target_track_index"],
      },
      handler: async (args: {
        node_id: string;
        target_track_index: number;
      }) => {
        if (!Number.isSafeInteger(args.target_track_index) || args.target_track_index < 0) {
          return { success: false, error: "target_track_index must be a non-negative integer" };
        }
        const nodeId = escapeForExtendScript(args.node_id);
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");

          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");

          var seq = app.project.activeSequence;
          var targetTracks = result.trackType === "video" ? seq.videoTracks : seq.audioTracks;
          if (${args.target_track_index} >= targetTracks.numTracks) {
            return __error("Target track index ${args.target_track_index} is out of range: the sequence has " + targetTracks.numTracks + " " + result.trackType + " track(s).");
          }
          if (result.trackIndex === ${args.target_track_index}) {
            return __result({ moved: false, verified: true, alreadyOnTrack: true, clipName: result.clip.name, trackIndex: result.trackIndex });
          }

          // Preflight: refuse before any QE call when either track is locked or
          // the destination range holds another clip (QE would overwrite it).
          var originTrack = targetTracks[result.trackIndex];
          var destTrack = targetTracks[${args.target_track_index}];
          if (__isTrackLocked(originTrack)) {
            return __error("Move refused; nothing was changed. Origin " + result.trackType + " track " + result.trackIndex + " is locked.");
          }
          if (__isTrackLocked(destTrack)) {
            return __error("Move refused; nothing was changed. Destination " + result.trackType + " track ${args.target_track_index} is locked.");
          }
          var moveStart = parseFloat(result.clip.start.ticks);
          var moveEnd = parseFloat(result.clip.end.ticks);
          for (var oi = 0; oi < destTrack.clips.numItems; oi++) {
            var occupant = destTrack.clips[oi];
            var occupantStart = parseFloat(occupant.start.ticks);
            var occupantEnd = parseFloat(occupant.end.ticks);
            if (occupantStart < moveEnd - __TICK_MATCH_TOL && occupantEnd > moveStart + __TICK_MATCH_TOL) {
              return __error("Move refused; nothing was changed. The destination range " + __ticksToSeconds(moveStart) + "s-" + __ticksToSeconds(moveEnd) + "s on " + result.trackType + " track ${args.target_track_index} is already occupied by " + occupant.name + ", and moving there would overwrite it.");
            }
          }
          var movedName = result.clip.name;
          var movedSourceId = "";
          try { movedSourceId = result.clip.projectItem ? String(result.clip.projectItem.nodeId) : ""; } catch (eMovedSource) {}

          // Premiere can mint a new node ID when a clip changes track, so fall
          // back to matching the same source item, name, and start on a track.
          function findMovedOn(trackIndex) {
            var track = targetTracks[trackIndex];
            for (var fi = 0; fi < track.clips.numItems; fi++) {
              var cand = track.clips[fi];
              if (String(cand.nodeId) === "${nodeId}") return { clip: cand, trackIndex: trackIndex, trackType: result.trackType };
              var candSource = "";
              try { candSource = cand.projectItem ? String(cand.projectItem.nodeId) : ""; } catch (eCandSource) {}
              if (movedSourceId && candSource === movedSourceId && cand.name === movedName &&
                  Math.abs(parseFloat(cand.start.ticks) - moveStart) <= __TICK_MATCH_TOL) {
                return { clip: cand, trackIndex: trackIndex, trackType: result.trackType };
              }
            }
            return null;
          }

          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");

          // QE item indices count gaps ("Empty" items) alongside clips, so the
          // DOM clip index does not map onto getItemAt -- on a track with a
          // leading gap it returns the gap, and calling moveToTrack on that
          // fails with a misleading parameter error. Match on start time.
          var qeClip = null;
          var wantStart = parseFloat(result.clip.start.ticks);
          for (var qi = 0; qi < qeTrack.numItems; qi++) {
            var cand = qeTrack.getItemAt(qi);
            if (!cand || String(cand.type) !== "Clip") continue;
            if (Math.abs(parseFloat(cand.start.ticks) - wantStart) < 1) { qeClip = cand; break; }
          }
          if (!qeClip) return __error("Could not locate the clip among the QE track's items; cannot change track.");

          // QE moveToTrack takes track *deltas*, not an absolute index.
          var videoDelta = result.trackType === "video" ? (${args.target_track_index} - result.trackIndex) : 0;
          var audioDelta = result.trackType === "audio" ? (${args.target_track_index} - result.trackIndex) : 0;
          // Capture the span and source range as tick strings; Premiere can
          // mutate the same Time instance on write, so never keep references.
          var beforeMoveStartTicks = String(result.clip.start.ticks);
          var beforeMoveEndTicks = String(result.clip.end.ticks);
          var beforeMoveInTicks = String(result.clip.inPoint.ticks);
          var beforeMoveOutTicks = String(result.clip.outPoint.ticks);
          var spanTicks = parseFloat(beforeMoveEndTicks) - parseFloat(beforeMoveStartTicks);
          if (!(spanTicks > 0)) return __error("Clip has an empty or inverted timeline range; track move was not attempted.");
          try {
            qeClip.moveToTrack(videoDelta, audioDelta, "0", false);
          } catch (moveErr) {
            return __error("Could not move the clip to track ${args.target_track_index}: the QE moveToTrack API rejected the call (" + moveErr.toString() + "). The clip was left untouched. Reconstructing the move with Track.overwriteClip would mint a new node ID and drop applied effects and keyframes, so it is not done automatically -- move the clip manually if you need it on another track.");
          }

          // QE reports nothing useful on success, so confirm against the DOM.
          var after = __findClip("${nodeId}");
          if (!after) after = findMovedOn(${args.target_track_index});
          if (!after) return __error("The timeline changed: clip " + movedName + " could not be found on its original or destination track after the track move. Use Undo and check the timeline.");
          if (after.trackIndex !== ${args.target_track_index}) {
            if (findMovedOn(${args.target_track_index})) {
              return __error("The timeline changed: Premiere placed a copy of " + movedName + " on track ${args.target_track_index} but the original is still on track " + after.trackIndex + ". Use Undo and move the clip in the Premiere UI.");
            }
            return __error("Premiere accepted the moveToTrack call but the clip is still on track " + after.trackIndex + " rather than ${args.target_track_index}. Structural QE edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }
          if (findMovedOn(result.trackIndex)) {
            return __error("The timeline changed: " + movedName + " now exists on both track " + result.trackIndex + " and track ${args.target_track_index}. Use Undo and move the clip in the Premiere UI.");
          }
          // moveToTrack can rewrite end independently of start (#550). Re-assert
          // the original span before verifying, then fail closed if it did not hold.
          if (String(after.clip.start.ticks) !== beforeMoveStartTicks || String(after.clip.end.ticks) !== beforeMoveEndTicks) {
            try {
              __writeClipSpan(after.clip, beforeMoveStartTicks, beforeMoveEndTicks);
            } catch (spanErr) {
              return __error("The timeline changed: Premiere changed the clip's timeline range during the track move and it could not be restored (" + spanErr.toString() + "). Use Undo and retry in the Premiere UI.");
            }
            var restored = __findClip("${nodeId}");
            after = restored || findMovedOn(${args.target_track_index});
            if (!after) return __error("The timeline changed: clip " + movedName + " could not be found after restoring its timeline range. Use Undo and check the timeline.");
          }
          var afterMoveStartTicks = String(after.clip.start.ticks);
          var afterMoveEndTicks = String(after.clip.end.ticks);
          if (parseFloat(afterMoveStartTicks) >= parseFloat(afterMoveEndTicks)) {
            return __error("The timeline changed: Premiere left clip " + movedName + " with an inverted or empty timeline range after the track move. Use Undo and retry in the Premiere UI.");
          }
          if (Math.abs(parseFloat(afterMoveStartTicks) - parseFloat(beforeMoveStartTicks)) > 1) {
            return __error("The timeline changed: Premiere moved the clip to " + __ticksToSeconds(afterMoveStartTicks) + "s instead of keeping its start at " + __ticksToSeconds(beforeMoveStartTicks) + "s. Use Undo and retry in the Premiere UI.");
          }
          if (Math.abs((parseFloat(afterMoveEndTicks) - parseFloat(afterMoveStartTicks)) - spanTicks) > 1) {
            return __error("The timeline changed: Premiere changed the clip duration during the track move. Use Undo and retry in the Premiere UI.");
          }
          var sourceReadable = true;
          var afterInTicks = "";
          var afterOutTicks = "";
          try {
            afterInTicks = String(after.clip.inPoint.ticks);
            afterOutTicks = String(after.clip.outPoint.ticks);
          } catch (eSourceRead) {
            sourceReadable = false;
          }
          if (sourceReadable && (afterInTicks !== beforeMoveInTicks || afterOutTicks !== beforeMoveOutTicks)) {
            return __error("The timeline changed: Premiere changed the clip's source in/out points during the track move. Use Undo and retry in the Premiere UI.");
          }

          var moveResult = {
            moved: true,
            verified: sourceReadable,
            outcome: sourceReadable ? "verified" : "committed_unverified",
            clipName: after.clip.name,
            newTrackIndex: after.trackIndex,
            startSeconds: __ticksToSeconds(afterMoveStartTicks),
            endSeconds: __ticksToSeconds(afterMoveEndTicks)
          };
          if (!sourceReadable) moveResult.warning = "The clip is on the destination track with the same start and duration, but its source in/out points could not be read back.";
          return __result(moveResult);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_all_effects: {
      description: "Remove every effect from a clip, keeping its built-in components (Opacity, Motion, Volume, Channel Volume, Panner), and verify the result. EXPERIMENTAL: when Premiere has no Component.remove() (25.2), it removes through the undocumented QE DOM's targeted qeClip.getComponentAt(i).remove(). Every matching component's removal path is checked before any is removed; it returns a capability error, with nothing changed, when neither path is available.",
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
          // qeClip.removeEffects() returned without removing anything on Premiere
          // 25.2 (Lumetri stayed while this tool reported removed: true), so
          // remove each effect individually and verify.
          var removal = __removeClipComponents(result, function () { return true; });
          if (removal.unsupported) return __error("Capability error: " + removal.unsupported + " Nothing was removed; remove effects in Effect Controls.");
          if (removal.failures.length && removal.nothingRemoved) return __error("Capability error: Premiere exposes neither Component.remove() nor a matching QE component for " + removal.failures.join(", ") + ". No effects were removed; remove them in Effect Controls.");
          if (removal.failures.length) return __error("The clip changed: Premiere removed " + removal.removed.join(", ") + " but not " + removal.failures.join(", ") + ". Inspect Effect Controls.");
          if (!removal.verified) return __error((removal.remaining.join("|") === removal.before.join("|") ? "Premiere's removal did not take effect: the clip still has " : "Premiere's removal did not take effect as expected: the clip's components read back as ") + removal.remaining.join(", ") + ". Inspect Effect Controls.");
          return __result({ removed: true, verified: true, clipName: result.clip.name, removedEffects: removal.removed, remaining: removal.remaining });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_speed_qe: {
      description:
        SPEED_UNAVAILABLE_DESCRIPTION,
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          speed_percent: {
            type: "number",
            description:
              "Speed as percentage (100 = normal, 200 = 2x, 50 = half speed)",
          },
          reverse: {
            type: "boolean",
            description: "Reverse playback direction (default: false)",
          },
        },
        required: ["node_id", "speed_percent"],
      },
      handler: async (args: {
        node_id: string;
        speed_percent: number;
        reverse?: boolean;
      }) => {
        void args;
        return {
          success: false,
          error:
            SPEED_UNAVAILABLE_ERROR,
        };
      },
    },

    reverse_clip: {
      description:
        "Unavailable: Premiere does not expose a supported scripting API for reversing a timeline clip's playback direction.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          reverse: {
            type: "boolean",
            description: "True to reverse, false for normal (default: true)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; reverse?: boolean }) => {
        void args;
        return {
          success: false,
          error:
            "Reversing a timeline clip is not exposed by Premiere's supported ExtendScript or UXP APIs. No mutation was attempted. Use Premiere's Speed/Duration UI or pre-render retimed media before import.",
        };
      },
    },

    set_frame_blend: {
      description: "Request frame blending on a clip through QE DOM. Premiere exposes no frame-blend readback, so the result is committed_unverified and must be checked in Effect Controls.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "True to enable frame blending, false to disable",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found; nothing was changed.");
          // QE track items include gaps, so the DOM clip index is not a QE index.
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("Could not match the QE clip for " + result.clip.name + " by timeline start; nothing was changed.");

          try { qeClip.setFrameBlend(${args.enabled}); }
          catch (writeError) {
            return __error("Premiere threw while requesting frame blending; the mutation outcome is unknown. Inspect Effect Controls before retrying: " + writeError.toString(), { outcome: "committed_unverified", mutationAttempted: true, mutationOutcome: "unknown", verified: false });
          }
          return __result({ frameBlend: ${args.enabled}, clipName: result.clip.name, outcome: "committed_unverified", verified: false, verificationScope: "Premiere exposes no frame-blend readback; check Effect Controls." });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_time_interpolation: {
      description:
        "Request time interpolation for a clip (Frame Sampling, Frame Blending, Optical Flow) through QE DOM. Premiere exposes no interpolation readback, so the result is committed_unverified and must be checked in Effect Controls.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          interpolation_type: {
            type: "number",
            description:
              "0 = Frame Sampling, 1 = Frame Blending, 2 = Optical Flow",
          },
        },
        required: ["node_id", "interpolation_type"],
      },
      handler: async (args: {
        node_id: string;
        interpolation_type: number;
      }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found; nothing was changed.");
          // QE track items include gaps, so the DOM clip index is not a QE index.
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("Could not match the QE clip for " + result.clip.name + " by timeline start; nothing was changed.");

          try { qeClip.setTimeInterpolationType(${args.interpolation_type}); }
          catch (writeError) {
            return __error("Premiere threw while requesting time interpolation; the mutation outcome is unknown. Inspect Effect Controls before retrying: " + writeError.toString(), { outcome: "committed_unverified", mutationAttempted: true, mutationOutcome: "unknown", verified: false });
          }
          var typeNames = ["Frame Sampling", "Frame Blending", "Optical Flow"];
          return __result({
            set: true,
            clipName: result.clip.name,
            interpolationType: typeNames[${args.interpolation_type}] || "Unknown",
            outcome: "committed_unverified",
            verified: false,
            verificationScope: "Premiere exposes no time-interpolation readback; check Effect Controls."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_clip: {
      description: "Rename a clip on the timeline and verify the new name.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          new_name: {
            type: "string",
            description: "New name for the clip",
          },
        },
        required: ["node_id", "new_name"],
      },
      handler: async (args: { node_id: string; new_name: string }) => {
        if (!args.new_name.trim()) {
          return { success: false as const, error: "new_name must not be empty or whitespace-only" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          // TrackItem.name is writable. The previous QE route looked the clip up by
          // index, but QE counts empty gaps as items, so after a gap it renamed the
          // gap and Premiere threw "Unknown error exception" (live 25.2).
          var oldName = String(result.clip.name);
          result.clip.name = "${escapeForExtendScript(args.new_name)}";
          if (String(result.clip.name) !== "${escapeForExtendScript(args.new_name)}") return __error("Premiere did not rename the clip");
          return __result({ renamed: true, verified: true, oldName: oldName, newName: String(result.clip.name) });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_speed: {
      description: "Get the playback speed and reverse state of a clip",
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
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var speed = 1;
          var reversed = false;
          try { speed = clip.getSpeed(); } catch(e) {}
          try { reversed = clip.isSpeedReversed() == 1; } catch(e) {}
          
          return __result({
            clipName: clip.name,
            speed: speed,
            reversed: reversed
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_selection: {
      description: "Select or deselect a clip in the active sequence and read its selection state back.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          selected: {
            type: "boolean",
            description: "True to select, false to deselect",
          },
        },
        required: ["node_id", "selected"],
      },
      handler: async (args: { node_id: string; selected: boolean }) => {
        if (typeof args.selected !== "boolean") return { success: false, error: "selected must be a boolean" };
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          result.clip.setSelected(${args.selected ? 1 : 0}, true);
          var applied = null;
          try { var observed = result.clip.isSelected(); if (typeof observed === "boolean" || observed === 0 || observed === 1) applied = !!observed; } catch (readError) {}
          var verified = applied === ${args.selected};
          var receipt = { selected: applied, requestedSelected: ${args.selected}, clipName: result.clip.name, verified: verified, outcome: applied === null ? "committed_unverified" : (verified ? "verified" : "failed") };
          if (applied !== null && !verified) return __jsonStringify({ success: false, error: "Premiere did not apply the requested clip selection.", data: receipt });
          return __result(receipt);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    link_selection: {
      description:
        "Link the currently selected video and audio clips in the active sequence, then read the links back. Needs at least two selected clips; verified only when every selected clip is linked to every other.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${SELECTION_LINK_PREAMBLE}
          if (selection.length < 2) return __error("Select at least two clips to link. Nothing was changed.");
          var hostResult = null;
          try { hostResult = seq.linkSelection(); } catch (linkError) { return __error("Premiere rejected linking the selection: " + linkError.toString()); }
          var notLinked = [];
          for (var n = 0; n < selection.length; n++) {
            var ids = linkedIds(selection[n]);
            var missing = !ids;
            for (var m = 0; !missing && m < selection.length; m++) if (!contains(ids, String(selection[m].nodeId))) missing = true;
            if (missing) notLinked.push(String(selection[n].nodeId));
          }
          if (notLinked.length) {
            return __jsonStringify({ success: false, error: "Premiere did not link the selected clips; " + notLinked.length + " of " + selection.length + " are not linked to all the others.", data: { outcome: "failed", verified: false, hostReturned: hostResult, notLinked: notLinked, clips: describeSelection() } });
          }
          return __result({ linked: true, verified: true, outcome: "verified", hostReturned: hostResult, clips: describeSelection() });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unlink_selection: {
      description:
        "Unlink the currently selected video and audio clips in the active sequence, then read the links back. Premiere only unlinks when every clip of a linked group is selected, so a selection missing a linked partner is refused before anything changes.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          ${SELECTION_LINK_PREAMBLE}
          var selectedIds = {};
          for (var s = 0; s < selection.length; s++) selectedIds[String(selection[s].nodeId)] = true;
          var anyLinked = false;
          var unselectedPartners = [];
          for (var p = 0; p < selection.length; p++) {
            var ids = linkedIds(selection[p]);
            if (!ids) return __error("Could not read the links of a selected clip. Nothing was changed.");
            for (var q = 0; q < ids.length; q++) {
              if (ids[q] === String(selection[p].nodeId)) continue;
              anyLinked = true;
              if (!selectedIds[ids[q]] && !contains(unselectedPartners, ids[q])) unselectedPartners.push(ids[q]);
            }
          }
          if (!anyLinked) return __result({ unlinked: false, alreadyUnlinked: true, verified: true, outcome: "verified", clips: describeSelection() });
          // Live 26.5.2: unlinkSelection() returns false and changes nothing
          // unless every clip of the linked group is selected.
          if (unselectedPartners.length) {
            return __jsonStringify({ success: false, error: "Premiere only unlinks when every linked clip is selected. Also select the linked partner clip(s) " + unselectedPartners.join(", ") + " (for example with set_clip_selection), then retry. Nothing was changed.", data: { unselectedPartners: unselectedPartners } });
          }
          var hostResult = null;
          try { hostResult = seq.unlinkSelection(); } catch (unlinkError) { return __error("Premiere rejected unlinking the selection: " + unlinkError.toString()); }
          var stillLinked = [];
          for (var r = 0; r < selection.length; r++) {
            var after = linkedIds(selection[r]);
            if (!after) { stillLinked.push(String(selection[r].nodeId)); continue; }
            for (var t = 0; t < after.length; t++) if (after[t] !== String(selection[r].nodeId)) { stillLinked.push(String(selection[r].nodeId)); break; }
          }
          if (stillLinked.length) {
            return __jsonStringify({ success: false, error: "Premiere did not unlink " + stillLinked.length + " of the " + selection.length + " selected clips.", data: { outcome: "failed", verified: false, hostReturned: hostResult, stillLinked: stillLinked, clips: describeSelection() } });
          }
          return __result({ unlinked: true, verified: true, outcome: "verified", hostReturned: hostResult, clips: describeSelection() });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    overwrite_clip: {
      description:
        "Overwrite a project item onto validated timeline tracks and verify a new source placement at the requested time",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to add",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline (default: 0)",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index (0-based, default: 0)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        start_seconds?: number;
        track_index?: number;
        audio_track_index?: number;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const trackIndex = args.track_index ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;
        if (!Number.isFinite(startSeconds) || startSeconds < 0) {
          return { success: false, error: "start_seconds must be a non-negative finite number" };
        }
        if (!Number.isSafeInteger(trackIndex) || trackIndex < 0) {
          return { success: false, error: "track_index must be a non-negative integer" };
        }
        if (!Number.isSafeInteger(audioTrackIndex) || audioTrackIndex < 0) {
          return { success: false, error: "audio_track_index must be a non-negative integer" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          if (${trackIndex} >= seq.videoTracks.numTracks) {
            return __error("Video track index ${trackIndex} is out of range: the sequence has " + seq.videoTracks.numTracks + " video track(s).");
          }
          if (${audioTrackIndex} >= seq.audioTracks.numTracks) {
            return __error("Audio track index ${audioTrackIndex} is out of range: the sequence has " + seq.audioTracks.numTracks + " audio track(s).");
          }
          if (typeof seq.overwriteClip !== "function") {
            return __error("Sequence.overwriteClip is unavailable on this Premiere build.");
          }

          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");

          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var wantedItemId = String(item.nodeId);
          var wantedStartTicks = parseFloat(startTicks);
          var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;

          function __isPlacedOn(track) {
            for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
              var clip = track.clips[clipIndex];
              var sourceId = "";
              try { sourceId = clip.projectItem ? String(clip.projectItem.nodeId) : ""; } catch (sourceError) {}
              if (sourceId !== wantedItemId) continue;
              var actualStartTicks = NaN;
              try { actualStartTicks = parseFloat(clip.start.ticks); } catch (startError) {}
              if (!isNaN(actualStartTicks) && Math.abs(actualStartTicks - wantedStartTicks) <= frameTicks) return true;
            }
            return false;
          }

          var videoWasPlaced = __isPlacedOn(seq.videoTracks[${trackIndex}]);
          var audioWasPlaced = __isPlacedOn(seq.audioTracks[${audioTrackIndex}]);
          try {
            seq.overwriteClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});
          } catch (overwriteError) {
            return __error("Sequence.overwriteClip failed: " + overwriteError.toString());
          }

          // The call can return without adding anything on Premiere 26.x. Read
          // the target tracks back by source node ID and frame-snapped position
          // instead of trusting the method's return value or a clip-count delta.
          var videoPlaced = __isPlacedOn(seq.videoTracks[${trackIndex}]);
          var audioPlaced = __isPlacedOn(seq.audioTracks[${audioTrackIndex}]);
          if (!videoPlaced && !audioPlaced) {
            return __error("overwrite_clip did not place project item " + item.name + " on either requested track at ${startSeconds}s. Premiere reported no verifiable timeline change.");
          }
          if ((videoPlaced && videoWasPlaced) && (audioPlaced && audioWasPlaced)) {
            return __error("overwrite_clip produced no verifiable new placement: project item " + item.name + " was already present at ${startSeconds}s on the requested track(s).");
          }

          return __result({
            overwritten: true,
            verified: true,
            item: item.name,
            trackIndex: ${trackIndex},
            audioTrackIndex: ${audioTrackIndex},
            startSeconds: ${startSeconds},
            placedOnVideoTrack: videoPlaced,
            placedOnAudioTrack: audioPlaced
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_clips: {
      description:
        "Create a new sequence from project items, then verify its registered identity, name and source-item placements. clipCount reports observed track items; requestedClipCount reports requested source items.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          item_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of project item names or node IDs to include in order",
          },
        },
        required: ["name", "item_ids"],
      },
      handler: async (args: { name: string; item_ids: string[] }) => {
        if (!args.name || !Array.isArray(args.item_ids) || !args.item_ids.length || args.item_ids.some((id) => typeof id !== "string" || !id)) return { success: false, error: "name and at least one non-empty item_id are required" };
        const itemLookups = args.item_ids
          .map(
            (id, i) =>
              `var item${i} = __findProjectItem("${escapeForExtendScript(id)}"); if (!item${i}) return __error("Item not found: ${escapeForExtendScript(id)}"); items.push(item${i});`,
          )
          .join("\n          ");

        const script = buildToolScript(`
          var items = [];
          ${itemLookups}
          
          var beforeIds = {};
          for (var b = 0; b < app.project.sequences.numSequences; b++) beforeIds[String(app.project.sequences[b].sequenceID)] = true;
          var seq = app.project.createNewSequenceFromClips("${escapeForExtendScript(args.name)}", items);
          if (!seq) return __error("Failed to create sequence from clips");
          var registered = null;
          for (var r = 0; r < app.project.sequences.numSequences; r++) if (String(app.project.sequences[r].sequenceID) === String(seq.sequenceID)) registered = app.project.sequences[r];
          var observedItems = [], appliedCount = 0, readable = true;
          try {
            if (!registered || !String(seq.sequenceID)) readable = false;
            else {
              var groups = [registered.videoTracks, registered.audioTracks];
              for (var g = 0; g < groups.length; g++) {
                var tracks = groups[g];
                if (!tracks || typeof tracks.numTracks !== "number") { readable = false; continue; }
                for (var t = 0; t < tracks.numTracks; t++) {
                  for (var c = 0; c < tracks[t].clips.numItems; c++) {
                    var clip = tracks[t].clips[c];
                    appliedCount++;
                    if (!clip.projectItem || !clip.projectItem.nodeId || !clip.start || !isFinite(Number(clip.start.ticks))) { readable = false; continue; }
                    observedItems.push({ id: String(clip.projectItem.nodeId), start: Number(clip.start.ticks), kind: g });
                  }
                }
              }
            }
          } catch (readError) { readable = false; }
          var placementVerified = readable;
          var lastStart = -1;
          var used = {};
          for (var i = 0; i < items.length && readable; i++) {
            var match = -1;
            for (var k = 0; k < observedItems.length; k++) {
              if (!used[k] && observedItems[k].id === String(items[i].nodeId) && observedItems[k].start >= lastStart && (match < 0 || observedItems[k].start < observedItems[match].start)) match = k;
            }
            if (match < 0) { placementVerified = false; break; }
            lastStart = observedItems[match].start;
            for (var u = 0; u < observedItems.length; u++) if (observedItems[u].id === observedItems[match].id && observedItems[u].start === lastStart) used[u] = true;
          }
          var identityVerified = !!registered && !!String(seq.sequenceID) && !beforeIds[String(seq.sequenceID)] && registered.name === "${escapeForExtendScript(args.name)}";
          var verified = identityVerified && placementVerified;
          var receipt = { created: !!registered, name: registered ? registered.name : null, id: seq.sequenceID, clipCount: readable ? appliedCount : null, requestedClipCount: items.length, verified: verified, outcome: !readable ? "committed_unverified" : (verified ? "verified" : "failed"), verification: "Sequence identity, name and ordered source placements only; playback and persistence remain unverified." };
          if (readable && !verified) return __jsonStringify({ success: false, error: "Created sequence did not match the requested identity, name or source placements.", data: receipt });
          return __result(receipt);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_sequence: {
      description: "Request closing a sequence timeline tab. Premiere exposes no open-tab enumeration, so dispatch is requested_unverified; the sequence stays in the project.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var name = seq.name;
          var sequenceId = String(seq.sequenceID);
          if (typeof seq.close !== "function") return __error("This Premiere build does not expose Sequence.close; no tab-close request was attempted.", { outcome: "failed", verified: false, mutationAttempted: false });
          try { seq.close(); }
          catch (closeError) {
            return __error("Premiere threw while requesting sequence-tab closure: " + closeError.toString(), { outcome: "failed", mutationOutcome: "unknown", verified: false, mutationAttempted: true, sequenceId: sequenceId, note: "The tab may have closed before the error. Inspect the timeline tabs before retrying." });
          }
          var sequenceRetained = null;
          try { sequenceRetained = !!__findSequence(sequenceId); } catch (retentionReadError) {}
          return __result({
            timelineTabCloseRequested: true,
            outcome: "requested_unverified",
            verified: false,
            verificationScope: "No supported open-timeline-tab enumeration is available; confirm the tab closed in Premiere.",
            sequenceRetainedInProject: sequenceRetained,
            name: name,
            sequenceId: sequenceId,
            note: "Closing a sequence closes its timeline tab; it does not delete the sequence from the project."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_as_project: {
      description:
        "Export a sequence as a standalone Premiere Pro project file. Fails when Premiere writes no file or leaves a pre-existing output unchanged.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
          output_path: {
            type: "string",
            description: "Full path for the exported .prproj file",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { sequence_id?: string; output_path: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var outputFile = new File("${escapeForExtendScript(args.output_path)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The project export directory does not exist: " + outputFile.parent);
          }
          var existedBefore = !!outputFile.exists;
          var lengthBefore = existedBefore ? Number(outputFile.length) : -1;
          var modifiedBefore = "";
          try { if (existedBefore) modifiedBefore = String(outputFile.modified); } catch (eSnap) {}
          seq.exportAsProject(outputFile.fsName);
          if (!outputFile.exists || !(outputFile.length > 0)) return __error("Premiere did not write the requested project file.");
          var modifiedAfter = "";
          try { modifiedAfter = String(outputFile.modified); } catch (eAfter) {}
          if (existedBefore && Number(outputFile.length) === lengthBefore && modifiedAfter === modifiedBefore) {
            return __error("Premiere did not write a new project file (the existing output was unchanged).");
          }
          return __result({ exported: true, verified: true, path: outputFile.fsName });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_zero_point: {
      description: "Set the starting timecode (zero point) of a sequence and read it back. The value is snapped to the sequence frame grid; for drop-frame 29.97, 01;00;00;00 is 3599.9964 s, and for non-drop 29.97 it is 3603.6 s.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description:
              "Sequence name or ID. Uses active sequence if omitted.",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds for the timecode origin (0 or more)",
          },
        },
        required: ["start_seconds"],
      },
      handler: async (args: {
        sequence_id?: string;
        start_seconds: number;
      }) => {
        if (!Number.isFinite(args.start_seconds) || args.start_seconds < 0) {
          return { success: false, error: "start_seconds must be a finite, non-negative number of seconds." };
        }
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          // Premiere keeps the zero point on the frame grid (live 26.5.2: 3600 s
          // at 29.97 is stored as 3599.9964 s, frame 107892), so write the
          // snapped value and verify it.
          var requestedTicks = __secondsToTicks(${args.start_seconds});
          var appliedTicks = __snapSequenceTicks(seq, requestedTicks);
          var previousTicks = String(seq.zeroPoint);
          try { seq.setZeroPoint(String(appliedTicks)); } catch (zeroError) {
            return __error("Premiere rejected the zero point: " + zeroError.toString());
          }
          var observedTicks = parseFloat(seq.zeroPoint);
          var zeroResult = {
            startSeconds: __ticksToSeconds(String(observedTicks)),
            requestedSeconds: ${args.start_seconds},
            appliedSeconds: __ticksToSeconds(String(appliedTicks)),
            previousSeconds: __ticksToSeconds(previousTicks)
          };
          if (!(Math.abs(observedTicks - appliedTicks) <= __TICK_MATCH_TOL)) {
            zeroResult.outcome = "failed";
            zeroResult.verified = false;
            return __error("Premiere did not apply the zero point; it reads " + zeroResult.startSeconds + " s.", zeroResult);
          }
          zeroResult.set = true;
          zeroResult.outcome = "verified";
          zeroResult.verified = true;
          return __result(zeroResult);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    scene_edit_detection: {
      description:
        "Perform Premiere's scene edit detection on the selected clips in the active sequence (it analyses the footage and can take minutes on long clips). CreateMarkers (default) puts Segmentation markers on the selected clips' source project items (shared by every sequence that uses them), removes duplicates this run created (markers that were already there are never deleted), and reports each detected cut in source and timeline seconds; it is verified only when at least one new marker was added. ApplyCuts razors the selected clips and verifies the clip count grew. EXPERIMENTAL QE: CreateMarkers records an observed marker boundary for guarded Undo/Redo; crossing it is refused by default, and unreadable history records unknown protection. This boundary does not verify native marker reversal.",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["CreateMarkers", "ApplyCuts"],
            description: "Create markers (default) or apply cuts to the selected clips",
          },
          apply_cuts_to_linked_audio: {
            type: "boolean",
            description: "When applying cuts, also cut linked audio (default: false)",
          },
          sensitivity: {
            type: "string",
            enum: ["LowSensitivity", "MediumSensitivity", "HighSensitivity"],
            description: "Scene-detection sensitivity (default: MediumSensitivity)",
          },
        },
      },
      handler: async (args: {
        action?: "CreateMarkers" | "ApplyCuts";
        apply_cuts_to_linked_audio?: boolean;
        sensitivity?: "LowSensitivity" | "MediumSensitivity" | "HighSensitivity";
      }) => {
        const action = args.action ?? "CreateMarkers";
        const applyCutsToLinkedAudio = args.apply_cuts_to_linked_audio === true;
        const sensitivity = args.sensitivity ?? "MediumSensitivity";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var selected = seq.getSelection();
          if (!selected || selected.length === 0) return __error("Select at least one clip before scene edit detection.");

          var round3 = function (v) { return Math.round(v * 1000) / 1000; };
          var countClips = function () {
            var n = 0;
            for (var v = 0; v < seq.videoTracks.numTracks; v++) n += seq.videoTracks[v].clips.numItems;
            for (var a = 0; a < seq.audioTracks.numTracks; a++) n += seq.audioTracks[a].clips.numItems;
            return n;
          };
          // Distinct source items behind the selected video clips, with the timeline
          // windows each one fills so detected source times can be mapped back.
          var items = [];
          var itemIndex = {};
          for (var i = 0; i < selected.length; i++) {
            var clip = selected[i];
            var isVideo = false;
            try { isVideo = clip.mediaType === "Video"; } catch (eType) {}
            var projectItem = null;
            try { projectItem = clip.projectItem; } catch (eItem) {}
            if (!isVideo || !projectItem) continue;
            var key = String(projectItem.nodeId);
            if (itemIndex[key] === undefined) {
              itemIndex[key] = items.length;
              items.push({ item: projectItem, windows: [] });
            }
            items[itemIndex[key]].windows.push({
              start: clip.start.seconds, inPoint: clip.inPoint.seconds, outPoint: clip.outPoint.seconds
            });
          }
          // Segmentation markers already on each item, by GUID where Premiere exposes
          // one, so this run's markers can be told apart from the user's own.
          var segmentationMarkers = function (projectItem) {
            var list = [];
            var markers = projectItem.getMarkers();
            if (!markers) return list;
            var m = markers.getFirstMarker();
            while (m) {
              if (String(m.type) === "Segmentation") {
                var guid = null;
                try { guid = m.guid ? String(m.guid) : null; } catch (eGuid) {}
                list.push({ marker: m, guid: guid, stamp: String(m.start.ticks), seconds: m.start.seconds });
              }
              m = markers.getNextMarker(m);
            }
            return list;
          };
          var before = [];
          for (var b = 0; b < items.length; b++) {
            var existing = segmentationMarkers(items[b].item);
            var guids = {};
            var stamps = {};
            var allGuids = true;
            for (var e = 0; e < existing.length; e++) {
              if (existing[e].guid) guids[existing[e].guid] = true; else allGuids = false;
              stamps[existing[e].stamp] = (stamps[existing[e].stamp] || 0) + 1;
            }
            before.push({ count: existing.length, guids: guids, stamps: stamps, allGuids: allGuids });
          }
          var clipsBefore = countClips();

          if ("${action}" === "CreateMarkers") {
            var markerBarrier = __rememberMarkerUndoBarrier(__readUndoIndex());
          if (!markerBarrier.ok) return __error(markerBarrier.error);
          }
          var detected = seq.performSceneEditDetectionOnSelection(
            "${action}",
            ${applyCutsToLinkedAudio},
            "${sensitivity}"
          );
          if (!detected) return __error("Premiere did not complete scene edit detection for the selected clips.");

          var summary = {
            sceneDetection: true,
            selectedClipCount: selected.length,
            action: "${action}",
            applyCutsToLinkedAudio: ${applyCutsToLinkedAudio},
            sensitivity: "${sensitivity}"
          };

          if ("${action}" === "ApplyCuts") {
            var clipsAfter = countClips();
            summary.clipsBefore = clipsBefore;
            summary.clipsAfter = clipsAfter;
            summary.cutsApplied = clipsAfter - clipsBefore;
            if (clipsAfter <= clipsBefore) {
              return __jsonStringify({ success: false, error: "Premiere reported scene detection but no cuts were applied to the selected clips.", data: summary });
            }
            summary.verified = true;
            return __result(summary);
          }

          var reports = [];
          var timelineCuts = [];
          var totalAdded = 0;
          for (var r = 0; r < items.length; r++) {
            var entry = items[r];
            var markers = entry.item.getMarkers();
            var now = segmentationMarkers(entry.item);
            // Markers this run created: new GUIDs, or (without GUIDs) the count
            // above what each time already had. Only this run's markers are
            // deduplicated; markers that were already there are never deleted.
            var taken = {};
            for (var st in before[r].stamps) if (before[r].stamps.hasOwnProperty(st)) taken[st] = true;
            var created = [];
            var duplicates = [];
            if (before[r].allGuids) {
              for (var n = 0; n < now.length; n++) {
                if (!now[n].guid) { before[r].allGuids = false; break; }
                if (before[r].guids[now[n].guid]) continue;
                if (taken[now[n].stamp]) duplicates.push(now[n]); else { taken[now[n].stamp] = true; created.push(now[n]); }
              }
            }
            var dedupedWithGuids = before[r].allGuids;
            if (!dedupedWithGuids) {
              created = [];
              duplicates = [];
              var newStamp = {};
              for (var q = 0; q < now.length; q++) {
                if (before[r].stamps[now[q].stamp] || newStamp[now[q].stamp]) continue;
                newStamp[now[q].stamp] = true;
                created.push(now[q]);
              }
            }
            for (var d = 0; d < duplicates.length; d++) markers.deleteMarker(duplicates[d].marker);
            var unique = [];
            var uniqueSeen = {};
            for (var k = 0; k < now.length; k++) {
              if (uniqueSeen[now[k].stamp]) continue;
              uniqueSeen[now[k].stamp] = true;
              unique.push(now[k].seconds);
            }
            unique.sort(function (x, y) { return x - y; });
            var newCuts = [];
            for (var c = 0; c < created.length; c++) newCuts.push(round3(created[c].seconds));
            newCuts.sort(function (x, y) { return x - y; });
            totalAdded += created.length;
            var sourceCuts = [];
            for (var u = 0; u < unique.length; u++) {
              sourceCuts.push(round3(unique[u]));
              for (var w = 0; w < entry.windows.length; w++) {
                var win = entry.windows[w];
                if (unique[u] > win.inPoint && unique[u] < win.outPoint) {
                  timelineCuts.push(round3(win.start + unique[u] - win.inPoint));
                }
              }
            }
            reports.push({
              itemId: String(entry.item.nodeId),
              item: entry.item.name,
              markersBefore: before[r].count,
              markersAdded: created.length,
              duplicatesRemoved: duplicates.length,
              duplicateCheck: dedupedWithGuids ? "marker_guid" : "not_possible_without_marker_guids",
              sourceCutSeconds: sourceCuts,
              newSourceCutSeconds: newCuts
            });
          }
          timelineCuts.sort(function (x, y) { return x - y; });
          summary.markerLocation = "Segmentation markers on the source project items (clip markers shared by every sequence that uses them), not sequence markers";
          summary.items = reports;
          summary.markersAdded = totalAdded;
          summary.timelineCutSeconds = timelineCuts;
          summary.verified = totalAdded > 0;
          if (totalAdded === 0) {
            summary.note = "No new Segmentation markers were added: Premiere found no cuts, or only cuts that already had markers. Existing markers were left as they were.";
          }
          return __result(summary);
        `);
        // Detection is a synchronous analysis that blocks Premiere (and its connector's
        // heartbeat) for minutes on long clips; live, a 121 s clip overran the default
        // 30 s wait. Allow up to 15 minutes.
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 900000 });
      },
    },

    delete_preview_files: {
      description:
        "Delete all preview/render cache files for the project. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          media_type: {
            type: "string",
            description:
              "Type of preview files to delete: 'video', 'audio', or 'all' (default: 'all')",
          },
        },
      },
      handler: async (args: { media_type?: string }) => {
        const typeMap: Record<string, string> = {
          video: '"228CDA18-3625-4d2d-951E-348879E4ED93"',
          audio: '"80B8E3D5-6DCA-4195-AEFB-CB5F407AB009"',
          all: '"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"',
        };
        const mediaType = typeMap[args.media_type || "all"] || typeMap.all;

        const script = buildToolScript(`
          app.enableQE();
          qe.project.deletePreviewFiles(${mediaType});
          return __result({ deleted: true, mediaType: "${args.media_type || "all"}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_tracks: {
      description:
        "Add video and/or audio tracks through QE, verify the active sequence gained the exact requested counts, and report explicitly when QE inserted the new tracks at index 0 and shifted every existing track up.",
      parameters: {
        type: "object" as const,
        properties: {
          video_tracks: {
            type: "number",
            description: "Number of video tracks to add (default: 0)",
          },
          audio_tracks: {
            type: "number",
            description:
              "Number of standard stereo audio tracks to add (default: 0)",
          },
          audio_mono_tracks: {
            type: "number",
            description: "Number of mono audio tracks to add (default: 0)",
          },
          audio_51_tracks: {
            type: "number",
            description: "Number of 5.1 audio tracks to add (default: 0)",
          },
        },
      },
      handler: async (args: {
        video_tracks?: number;
        audio_tracks?: number;
        audio_mono_tracks?: number;
        audio_51_tracks?: number;
      }) => {
        const v = args.video_tracks ?? 0;
        const a = args.audio_tracks ?? 0;
        const aMono = args.audio_mono_tracks ?? 0;
        const a51 = args.audio_51_tracks ?? 0;
        const requested = [
          ["video_tracks", v],
          ["audio_tracks", a],
          ["audio_mono_tracks", aMono],
          ["audio_51_tracks", a51],
        ] as const;
        for (const [name, value] of requested) {
          if (!Number.isSafeInteger(value) || value < 0) {
            return { success: false, error: `${name} must be a non-negative integer` };
          }
        }
        if (v + a + aMono + a51 === 0) {
          return { success: false, error: "Request at least one video or audio track" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          // A total-count check cannot tell "appended at the end" apart from
          // "inserted at index 0 and every existing track shifted up", so
          // fingerprint each existing track and locate those fingerprints again
          // after the call.
          function __trackFingerprints(collection) {
            var fingerprints = [];
            for (var t = 0; t < collection.numTracks; t++) {
              var track = collection[t];
              var clipCount = -1;
              var firstClipNodeId = "";
              try {
                clipCount = track.clips.numItems;
                if (clipCount > 0) firstClipNodeId = String(track.clips[0].nodeId || "");
              } catch (clipError) {}
              var trackId = "";
              try { trackId = String(track.id); } catch (idError) { trackId = ""; }
              fingerprints.push(trackId + "|" + String(track.name) + "|" + clipCount + "|" + firstClipNodeId);
            }
            return fingerprints;
          }
          function __offsetOfExistingTracks(before, after, added) {
            // Returns the index the pre-existing tracks start at afterwards, or
            // -1 when they cannot be located as a contiguous run.
            if (before.length === 0) return 0;
            for (var offset = 0; offset <= added; offset++) {
              var matches = true;
              for (var i = 0; i < before.length; i++) {
                if (after[offset + i] !== before[i]) { matches = false; break; }
              }
              if (matches) return offset;
            }
            return -1;
          }

          var beforeVideo = seq.videoTracks.numTracks;
          var beforeAudio = seq.audioTracks.numTracks;
          var beforeVideoFingerprints = __trackFingerprints(seq.videoTracks);
          var beforeAudioFingerprints = __trackFingerprints(seq.audioTracks);
          var expectedVideo = beforeVideo + ${v};
          var expectedAudio = beforeAudio + ${a + aMono + a51};

          if (typeof app.enableQE !== "function") return __error("QE is unavailable on this Premiere build; cannot add tracks.");
          app.enableQE();
          if (typeof qe === "undefined" || !qe.project || typeof qe.project.getActiveSequence !== "function") {
            return __error("QE active-sequence access is unavailable on this Premiere build; cannot add tracks.");
          }
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          if (typeof qeSeq.addTracks !== "function") return __error("QE addTracks is unavailable on this Premiere build.");

          // QE signature (verified on Premiere 25.2): addTracks(videoCount,
          // videoInsertIndex, audioCount, audioType, audioInsertIndex,
          // submixCount, submixType), audio types 0 mono / 1 stereo / 2 5.1.
          // The old 4-argument call passed the audio count as the video insert
          // index, so audio tracks were never added. Append after the existing
          // tracks, one call per audio type.
          try {
            if (${v} > 0 || ${a} > 0) qeSeq.addTracks(${v}, seq.videoTracks.numTracks, ${a}, 1, seq.audioTracks.numTracks, 0, 0);
            if (${aMono} > 0) qeSeq.addTracks(0, seq.videoTracks.numTracks, ${aMono}, 0, seq.audioTracks.numTracks, 0, 0);
            if (${a51} > 0) qeSeq.addTracks(0, seq.videoTracks.numTracks, ${a51}, 2, seq.audioTracks.numTracks, 0, 0);
          } catch (addTracksError) {
            return __error("QE addTracks failed: " + addTracksError.toString());
          }

          var afterVideo = seq.videoTracks.numTracks;
          var afterAudio = seq.audioTracks.numTracks;
          if (afterVideo !== expectedVideo || afterAudio !== expectedAudio) {
            return __error("QE addTracks did not add the requested tracks: video " + beforeVideo + " -> " + afterVideo + " (expected " + expectedVideo + "), audio " + beforeAudio + " -> " + afterAudio + " (expected " + expectedAudio + ").");
          }

          var videoOffset = __offsetOfExistingTracks(beforeVideoFingerprints, __trackFingerprints(seq.videoTracks), ${v});
          var audioOffset = __offsetOfExistingTracks(beforeAudioFingerprints, __trackFingerprints(seq.audioTracks), ${a + aMono + a51});
          var videoShifted = videoOffset > 0;
          var audioShifted = audioOffset > 0;
          var existingTracksUnlocatable = videoOffset === -1 || audioOffset === -1;

          return __result({
            added: true,
            verified: !existingTracksUnlocatable,
            videoTracks: ${v},
            audioTracks: ${a},
            audioMonoTracks: ${aMono},
            audio51Tracks: ${a51},
            totalVideoTracks: afterVideo,
            totalAudioTracks: afterAudio,
            newTracksInsertedAtStart: videoShifted || audioShifted,
            existingVideoTracksShiftedBy: videoOffset === -1 ? null : videoOffset,
            existingAudioTracksShiftedBy: audioOffset === -1 ? null : audioOffset,
            existingTracksUnlocatable: existingTracksUnlocatable,
            trackShiftWarning: existingTracksUnlocatable
              ? "The pre-existing tracks could not be matched by fingerprint after the call, so their new indices are unknown. Re-read the sequence structure before addressing any track by index."
              : (videoShifted || audioShifted
                ? "QE inserted the new tracks at index 0 and shifted every pre-existing track up (video +" + videoOffset + ", audio +" + audioOffset + "). Clips that were on Video 1 are now on Video " + (1 + videoOffset) + ". Re-read the sequence structure before addressing any track by index."
                : null)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_color_value: {
      description:
        "Set a color value on an effect property (e.g., tint color, fill color)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          component_name: {
            type: "string",
            description: "Name of the component/effect",
          },
          property_name: {
            type: "string",
            description: "Name of the color property; duplicate names require property_index from get_effect_properties.",
          },
          property_index: { type: "integer", minimum: 0, description: "Optional exact property index from get_effect_properties; required if the name is repeated." },
          alpha: {
            type: "number",
            description: "Alpha (0-255)",
          },
          red: {
            type: "number",
            description: "Red (0-255)",
          },
          green: {
            type: "number",
            description: "Green (0-255)",
          },
          blue: {
            type: "number",
            description: "Blue (0-255)",
          },
        },
        required: [
          "node_id",
          "component_name",
          "property_name",
          "alpha",
          "red",
          "green",
          "blue",
        ],
      },
      handler: async (args: {
        node_id: string;
        component_name: string;
        property_name: string;
        property_index?: number;
        alpha: number;
        red: number;
        green: number;
        blue: number;
      }) => {
        if (![args.alpha, args.red, args.green, args.blue].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
          return { success: false, error: "alpha, red, green and blue must be integers from 0 to 255" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var components = clip.components;
          var targetComp = null;
          for (var i = 0; i < components.numItems; i++) {
            if (components[i].displayName === "${escapeForExtendScript(args.component_name)}") {
              targetComp = components[i];
              break;
            }
          }
          if (!targetComp) return __error("Component not found");
          
          var resolvedProperty = __resolveProperty(targetComp, "${escapeForExtendScript(args.property_name)}", ${args.property_index === undefined ? "null" : args.property_index});
          if (resolvedProperty.error) return __error(resolvedProperty.error);
          var targetProp = resolvedProperty.property;
          if (!targetProp) return __error("Property not found");
          
          if (typeof targetProp.setColorValue !== "function") return __error("That property is not a colour parameter");
          var colorIsTimeVarying = false;
          try { colorIsTimeVarying = !!targetProp.isTimeVarying(); } catch (eColorTime) { return __error("Colour animation state could not be read; nothing was changed."); }
          if (colorIsTimeVarying) return __error("Keyframed colour writes are not supported because CEP has no lossless time-specific colour setter; nothing was changed.");
          targetProp.setColorValue(${args.alpha}, ${args.red}, ${args.green}, ${args.blue}, true);
          var applied = null;
          try { applied = targetProp.getColorValue(); } catch (eRead) {}
          if (!applied || applied.length !== 4) return __error("Premiere did not report the colour back");
          var want = [${args.alpha}, ${args.red}, ${args.green}, ${args.blue}];
          for (var c = 0; c < 4; c++) {
            if (Math.abs(Number(applied[c]) - want[c]) > 1) {
              return __error("Premiere applied ARGB " + applied.join(",") + " instead of " + want.join(","));
            }
          }
          return __result({
            set: true,
            verified: true,
            propertyIndex: resolvedProperty.index,
            color: { alpha: Number(applied[0]), red: Number(applied[1]), green: Number(applied[2]), blue: Number(applied[3]) }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_adjustment_layer: {
      description: "Check if a clip is an adjustment layer",
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
          var isAdj = false;
          try { isAdj = clip.isAdjustmentLayer(); } catch(e) {}
          
          return __result({ clipName: clip.name, isAdjustmentLayer: isAdj });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_linked_items: {
      description:
        "Get all clips in the sequence that are linked to the same source as a given clip",
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
          
          var linked = result.clip.getLinkedItems();
          var items = [];
          if (linked) {
            for (var i = 0; i < linked.numItems; i++) {
              items.push({
                name: linked[i].name,
                nodeId: linked[i].nodeId,
                startSeconds: __ticksToSeconds(linked[i].start.ticks)
              });
            }
          }
          
          return __result({ clipName: result.clip.name, linkedItems: items, count: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_mogrt_component: {
      description:
        "Get MOGRT (Motion Graphics Template) component parameters from a clip. Each parameter includes textValue (visible text extracted from textEditValue when present). Pass expected_values to audit text controls such as Headline; the result flags verified, mismatch, or missing_property per field. Reads the stored property, not the Essential Graphics panel display, which Premiere can show stale (host UI behavior this tool cannot refresh).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the MOGRT clip on the timeline",
          },
          expected_values: {
            type: "object",
            description:
              "Optional read-only audit map of MOGRT text parameter display names to the text each should contain (for example { \"Headline\": \"Chapter 3\" }). Result audit.status is verified, mismatch, or missing_property.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; expected_values?: Record<string, string> }) => {
        const expected = validateMogrtTextMap(args.expected_values, "expected_values");
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var mgtComp = result.clip.getMGTComponent();
          if (!mgtComp) {
            var isGraphic = false;
            try { isGraphic = typeof result.clip.isMGT === "function" && !!result.clip.isMGT(); } catch (eMgt) {}
            if (!isGraphic) return __error("Not a MOGRT clip or no MGT component found");
            // Premiere-authored graphics (e.g. Essential Graphics "Basic Lower Third")
            // report isMGT() but no MGT component, and their Source Text reads back as
            // a single opaque character (live 25.2), so the text cannot be read here.
            var graphicComponents = [];
            for (var gc = 0; gc < result.clip.components.numItems; gc++) {
              graphicComponents.push(result.clip.components[gc].displayName);
            }
            return __jsonStringify({ success: false,
              error: "This is a Premiere-authored graphic: it has no MOGRT parameter component, and Premiere does not expose its Source Text to scripts, so its text cannot be read. Edit it in the Essential Graphics panel, or use a template authored in After Effects.",
              data: { isGraphic: true, components: graphicComponents } });
          }
          
          var params = [];
          for (var i = 0; i < mgtComp.properties.numItems; i++) {
            var p = mgtComp.properties[i];
            var parameter = {
              index: i,
              displayName: p.displayName,
              value: null
            };
            var colorValue = __readColorValue(p);
            if (colorValue) {
              parameter.value = colorValue;
              parameter.valueType = "color_argb";
            } else {
              try { parameter.value = p.getValue(); } catch (eValue) { parameter.readError = String(eValue); }
            }
            params.push(parameter);
          }
          
          return __result({ clipName: result.clip.name, parameters: params });
        `);
        const response = await sendCommand(script, bridgeOptions);
        if (!response.success) return response;
        const data = (response.data ?? {}) as Record<string, unknown>;
        const rawParams = Array.isArray(data.parameters) ? (data.parameters as Array<Record<string, unknown>>) : [];
        const parameters: Array<Record<string, unknown>> = rawParams.map((p) => ({ ...p, textValue: extractMogrtText(p.value) }));
        if (!expected) return { ...response, data: { ...data, parameters } };
        const checks = compareMogrtText(expected, parameters);
        return {
          ...response,
          data: {
            ...data,
            parameters,
            audit: {
              status: summarizeMogrtText(checks),
              checks,
              scope: "Stored MOGRT property values only; the Essential Graphics panel display is not read.",
            },
          },
        };
      },
    },
  };
}
