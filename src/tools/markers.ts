import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

/** Reject values that would otherwise be written into the generated script unchecked. */
function markerArgumentError(args: { time_seconds?: unknown; color?: unknown; duration_seconds?: unknown }): string | null {
  if (typeof args.time_seconds !== "number" || !Number.isFinite(args.time_seconds) || args.time_seconds < 0) {
    return "time_seconds must be a finite, non-negative number of seconds.";
  }
  if (args.color !== undefined && (typeof args.color !== "number" || !Number.isInteger(args.color) || args.color < 0 || args.color > 7)) {
    return "color must be an integer marker color index from 0 to 7.";
  }
  if (args.duration_seconds !== undefined && (typeof args.duration_seconds !== "number" || !Number.isFinite(args.duration_seconds) || args.duration_seconds < 0)) {
    return "duration_seconds must be a finite, non-negative number of seconds.";
  }
  return null;
}

/** ExtendScript object literal of the requested marker fields; user text is escaped. */
function markerWanted(args: { name?: string; comments?: string; color?: number }, end?: number): string {
  const fields: string[] = [];
  if (args.name) fields.push(`name: "${escapeForExtendScript(args.name)}"`);
  if (args.comments) fields.push(`comments: "${escapeForExtendScript(args.comments)}"`);
  if (args.color !== undefined) fields.push(`color: ${args.color}`);
  if (end !== undefined) fields.push(`end: ${end}`);
  return `{ ${fields.join(", ")} }`;
}

// Read a marker's fields back and list what differs from the request.
// __markerUnverified collects fields Premiere would not let us read back.
const MARKER_READBACK = `
          var __markerUnverified = [];
          function __markerGuid(marker) {
            try { return marker.guid ? String(marker.guid) : null; } catch (eGuid) { return null; }
          }
          function __markerMismatches(marker, wanted) {
            var problems = [];
            if (wanted.name !== undefined && String(marker.name) !== wanted.name) problems.push("name reads back as " + marker.name);
            if (wanted.comments !== undefined && String(marker.comments) !== wanted.comments) problems.push("comments read back as " + marker.comments);
            if (wanted.color !== undefined) {
              var color = null;
              try { color = marker.getColorByIndex(); } catch (eColor) {}
              if (typeof color !== "number" || !isFinite(color)) __markerUnverified.push("color");
              else if (color !== wanted.color) problems.push("color index reads back as " + color);
            }
            if (wanted.end !== undefined) {
              var end = parseFloat(marker.end.seconds);
              if (!(Math.abs(end - wanted.end) < 0.01)) problems.push("end reads back as " + end + "s");
            }
            return problems;
          }
`;

const MARKER_UNDO_RECEIPT = `
          function __markerUndoReceipt(before, payload) {
            var after = __readUndoIndex();
            var barrier = __rememberMarkerUndoBarrier(after);
            payload.qeMarkerUndoVerified = false;
            payload.markerUndoBarrier = barrier.ok;
            payload.markerUndoWarning = "Marker reversal through QE is not verified. The undo tools refuse to cross this marker boundary unless you acknowledge prior non-marker QE actions.";
            if (!barrier.ok) payload.markerUndoWarning = "The marker may have changed, but the CEP engine could not update its undo barrier. Inspect marker state before using QE undo.";
            if (before === null || after === null || after < before) {
              payload.undoTracked = null;
              payload.undoWarning = "Premiere's undo stack could not be verified for this marker write. Do not assume Undo would reverse the marker.";
            } else if (after === before) {
              payload.undoTracked = false;
              payload.undoWarning = "Premiere did not record this marker write in its undo stack. Undo would reverse an earlier action, not this marker.";
            } else {
              payload.undoTracked = true;
              payload.undoSteps = after - before;
              payload.undoStackIndex = after;
            }
            return payload;
          }
`;

export function getMarkerTools(bridgeOptions: BridgeOptions) {
  return {
    add_marker: {
      description: "Add a marker to the active sequence or a clip and read its name, comments, color and duration back. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means the marker did not observably advance the QE index.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds for the marker",
          },
          name: {
            type: "string",
            description: "Name/label for the marker",
          },
          comments: {
            type: "string",
            description: "Comments for the marker",
          },
          color: {
            type: "number",
            description: "Marker color index (0=Green, 1=Red, 2=Purple, 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the marker in seconds (0 for point marker)",
          },
          node_id: {
            type: "string",
            description: "Optional clip node ID to add the marker to that clip instead of the sequence. Premiere 25.2.3 timeline clips have no marker collection, so this refuses there and names the source time to use with add_marker_to_project_item.",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: {
        time_seconds: number;
        name?: string;
        comments?: string;
        color?: number;
        duration_seconds?: number;
        node_id?: string;
      }) => {
        const invalid = markerArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        const wanted = markerWanted(args, args.duration_seconds ? args.time_seconds + args.duration_seconds : undefined);
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;
             if (!markers || typeof markers.createMarker !== "function") {
               var sourceIn = NaN, sourceSpeed = null, sourceReverse = null;
               try {
                 sourceIn = __ticksToSeconds(clipResult.clip.inPoint.ticks);
                 sourceSpeed = clipResult.clip.getSpeed();
                 sourceReverse = clipResult.clip.isSpeedReversed();
               } catch (eIn) {}
               if (!isFinite(sourceIn) || (sourceSpeed !== 1 && sourceSpeed !== 100) || (sourceReverse !== false && sourceReverse !== 0)) return __error("Timeline clips have no marker collection on this Premiere host. Nothing was changed. Use add_marker_to_project_item after inspecting the source clock; this clip's timing or speed cannot establish a simple clip-to-source time conversion.");
               return __error("Timeline clips have no marker collection on this Premiere host; clip markers belong to the source project item and appear on every use of that media. Nothing was changed. Use add_marker_to_project_item with the source time instead: this clip's in-point is " + sourceIn + "s, so clip time t is source time t + " + sourceIn + "s.");
             }`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          ${MARKER_UNDO_RECEIPT}
          var markerSeq = app.project.activeSequence;
          var requestedMarkerTicks = __secondsToTicks(${args.time_seconds});
          var requestedMarkerEndTicks = NaN;
          var appliedMarkerEndTicks = NaN;
          var markerFrameTicks = ${args.node_id ? "TICKS_PER_SECOND / 24" : "markerSeq ? __sequenceFrameTicks(markerSeq) : NaN"};
          if (!isFinite(markerFrameTicks)) return __error("The active sequence frame grid could not be read; no marker was created.");
          var appliedMarkerTicks = ${args.node_id ? "requestedMarkerTicks" : "__snapSequenceTicks(markerSeq, requestedMarkerTicks)"};
          var appliedMarkerSeconds = __ticksToSeconds(appliedMarkerTicks);
          // createMarker() and the marker.end setter both take seconds, not ticks.
          var markerUndoBefore = __readUndoIndex();
          var markerBarrier = __rememberMarkerUndoBarrier(markerUndoBefore);
          if (!markerBarrier.ok) return __error(markerBarrier.error);
          var marker = markers.createMarker(appliedMarkerSeconds);
          var observedMarkerTicks = NaN;
          try { observedMarkerTicks = parseFloat(marker.start.ticks); } catch (markerStartReadError) {}
          if (!isFinite(observedMarkerTicks) || Math.abs(observedMarkerTicks - appliedMarkerTicks) > markerFrameTicks / 1000 ||
              ${args.node_id ? "false" : "Math.abs(observedMarkerTicks / markerFrameTicks - Math.round(observedMarkerTicks / markerFrameTicks)) > 0.001"}) {
            return __jsonStringify({ success: false, error: "Premiere created the marker but its stored time is not verified on the active sequence frame grid.", data: __markerUndoReceipt(markerUndoBefore, { timelineChanged: true, outcome: "committed_unverified", verified: false, requestedSeconds: __ticksToSeconds(requestedMarkerTicks), appliedSeconds: appliedMarkerSeconds }) });
          }

          ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
          ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
          ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
          ${args.duration_seconds ? `requestedMarkerEndTicks = __secondsToTicks(${args.time_seconds + args.duration_seconds}); appliedMarkerEndTicks = ${args.node_id ? "requestedMarkerEndTicks" : "__snapSequenceTicks(markerSeq, requestedMarkerEndTicks)"}; marker.end = __ticksToSeconds(appliedMarkerEndTicks);` : ""}
          ${MARKER_READBACK}
          var problems = __markerMismatches(marker, ${args.duration_seconds ? `{ ${args.name ? `name: "${escapeForExtendScript(args.name)}",` : ""} ${args.comments ? `comments: "${escapeForExtendScript(args.comments)}",` : ""} ${args.color !== undefined ? `color: ${args.color},` : ""} end: __ticksToSeconds(appliedMarkerEndTicks) }` : wanted});
          ${args.duration_seconds ? `if (Math.abs(parseFloat(marker.end.seconds) - __ticksToSeconds(appliedMarkerEndTicks)) > __ticksToSeconds(markerFrameTicks) / 1000) problems.push("end is off the active sequence frame grid");` : ""}
          if (problems.length) {
            return __jsonStringify({ success: false, error: "The marker was created at ${args.time_seconds}s, but " + problems.join("; ") + ".", data: __markerUndoReceipt(markerUndoBefore, { timelineChanged: true }) });
          }
          return __result(__markerUndoReceipt(markerUndoBefore, {
            added: true,
            outcome: __markerUnverified.length ? "committed_unverified" : "verified",
            verified: __markerUnverified.length === 0,
            unverifiedFields: __markerUnverified,
            guid: __markerGuid(marker),
            timeSeconds: appliedMarkerSeconds,
            endSeconds: parseFloat(marker.end.seconds),
            name: marker.name,
            comments: marker.comments,
            requestedSeconds: Math.abs(appliedMarkerTicks - requestedMarkerTicks) > markerFrameTicks / 1000 ? __ticksToSeconds(requestedMarkerTicks) : undefined,
            appliedSeconds: Math.abs(appliedMarkerTicks - requestedMarkerTicks) > markerFrameTicks / 1000 ? appliedMarkerSeconds : undefined,
            requestedEndSeconds: isFinite(requestedMarkerEndTicks) && Math.abs(appliedMarkerEndTicks - requestedMarkerEndTicks) > markerFrameTicks / 1000 ? __ticksToSeconds(requestedMarkerEndTicks) : undefined,
            appliedEndSeconds: isFinite(appliedMarkerEndTicks) && Math.abs(appliedMarkerEndTicks - requestedMarkerEndTicks) > markerFrameTicks / 1000 ? __ticksToSeconds(appliedMarkerEndTicks) : undefined
          }));
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_marker: {
      description: "Delete a marker at a specific time position. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means the marker did not observably advance the QE index.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to delete",
          },
          node_id: {
            type: "string",
            description: "Optional clip node ID (deletes from sequence if omitted). Premiere 25.2.3 timeline clips have no marker collection, so this refuses there.",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; node_id?: string }) => {
        const invalid = markerArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;
             if (!markers || typeof markers.getFirstMarker !== "function") {
               var sourceIn = NaN, sourceSpeed = null, sourceReverse = null;
               try {
                 sourceIn = __ticksToSeconds(clipResult.clip.inPoint.ticks);
                 sourceSpeed = clipResult.clip.getSpeed();
                 sourceReverse = clipResult.clip.isSpeedReversed();
               } catch (eIn) {}
               if (!isFinite(sourceIn) || (sourceSpeed !== 1 && sourceSpeed !== 100) || (sourceReverse !== false && sourceReverse !== 0)) return __error("Timeline clips have no marker collection on this Premiere host. Nothing was changed. Use add_marker_to_project_item after inspecting the source clock; this clip's timing or speed cannot establish a simple clip-to-source time conversion.");
               return __error("Timeline clips have no marker collection on this Premiere host; clip markers belong to the source project item and appear on every use of that media. Nothing was changed. Use add_marker_to_project_item with the source time instead: this clip's in-point is " + sourceIn + "s, so clip time t is source time t + " + sourceIn + "s.");
             }`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          ${MARKER_UNDO_RECEIPT}
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var markerUndoBefore = __readUndoIndex();
          function deletionSnapshot() {
            var snapshot = [], marker = markers.getFirstMarker();
            while (marker) {
              var guid = null;
              try { guid = marker.guid ? String(marker.guid) : null; } catch (guidReadError) {}
              snapshot.push({ marker: marker, guid: guid, ticks: parseFloat(marker.start.ticks) });
              marker = markers.getNextMarker(marker);
            }
            return snapshot;
          }
          var before = deletionSnapshot(), target = -1;
          for (var i = 0; i < before.length; i++) {
            if (Math.abs(before[i].ticks - targetTicks) < TICKS_PER_SECOND * 0.01) { target = i; break; }
          }
          if (target < 0) return __error("No marker found at " + ${args.time_seconds} + "s");
          var markerBarrier = __rememberMarkerUndoBarrier(markerUndoBefore);
          if (!markerBarrier.ok) return __error(markerBarrier.error);
          markers.deleteMarker(before[target].marker);
          var after = null;
          try { after = deletionSnapshot(); } catch (deletionReadError) {}
          var verified = false, mismatch = false, identitiesReadable = true;
          if (after !== null) {
            mismatch = after.length !== before.length - 1;
            for (var i = 0; i < before.length; i++) {
              if (!before[i].guid) { identitiesReadable = false; continue; }
              var matches = 0;
              for (var j = 0; j < after.length; j++) {
                if (!after[j].guid) identitiesReadable = false;
                if (after[j].guid === before[i].guid) matches++;
              }
              if (matches !== (i === target ? 0 : 1)) mismatch = true;
            }
            verified = !mismatch && identitiesReadable;
          }
          var receipt = __markerUndoReceipt(markerUndoBefore, {
            deleted: verified ? true : (mismatch ? false : null),
            timeSeconds: ${args.time_seconds},
            requestedDeleted: 1,
            appliedDeleted: after === null ? null : before.length - after.length,
            verified: verified,
            outcome: mismatch ? "failed" : (verified ? "verified" : "committed_unverified"),
            timelineChanged: true
          });
          if (mismatch) return __jsonStringify({ success: false, error: "Premiere did not delete only the requested marker; inspect the marker collection before retrying.", data: receipt });
          return __result(receipt);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    update_marker: {
      description: "Update the name, comments or color of the sequence marker at a time and read them back. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means the marker did not observably advance the QE index.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to update",
          },
          name: { type: "string", description: "New name" },
          comments: { type: "string", description: "New comments" },
          color: { type: "number", description: "New color index (0=Green, 1=Red, 2=Purple, 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan)" },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; name?: string; comments?: string; color?: number }) => {
        const invalid = markerArgumentError(args);
        if (invalid) return { success: false, error: invalid };
        const wanted = markerWanted(args);
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          ${MARKER_UNDO_RECEIPT}
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var markerUndoBefore = __readUndoIndex();
          var marker = seq.markers.getFirstMarker();
          var found = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              var markerBarrier = __rememberMarkerUndoBarrier(markerUndoBefore);
              if (!markerBarrier.ok) return __error(markerBarrier.error);
              ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
              ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
              ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
              found = true;
              break;
            }
            marker = seq.markers.getNextMarker(marker);
          }
          
          if (!found) return __error("No marker found at " + ${args.time_seconds} + "s");
          ${MARKER_READBACK}
          var problems = __markerMismatches(marker, ${wanted});
          if (problems.length) {
            return __jsonStringify({ success: false, error: "The marker at ${args.time_seconds}s changed, but " + problems.join("; ") + ".", data: __markerUndoReceipt(markerUndoBefore, { timelineChanged: true }) });
          }
          return __result(__markerUndoReceipt(markerUndoBefore, {
            updated: true,
            outcome: __markerUnverified.length ? "committed_unverified" : "verified",
            verified: __markerUnverified.length === 0,
            unverifiedFields: __markerUnverified,
            guid: __markerGuid(marker),
            timeSeconds: __ticksToSeconds(marker.start.ticks),
            requestedSeconds: ${args.time_seconds},
            name: marker.name,
            comments: marker.comments
          }));
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_markers: {
      description: "List markers on the active sequence, or on a source project item that exposes a marker collection, including marker GUID and color when readable. A timeline-clip node_id returns a clean error instead of a raw TypeError.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Optional clip node ID to list clip markers instead of sequence markers",
          },
        },
      },
      handler: async (args: { node_id?: string }) => {
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip && clipResult.clip.markers;
             if (!markers && clipResult.clip && clipResult.clip.projectItem) {
               markers = clipResult.clip.projectItem.markers;
             }
             if (!markers || typeof markers.getFirstMarker !== "function") {
               return __error("This node_id resolved to a timeline clip that does not expose a marker collection. list_markers(node_id) only reads source project-item markers; omit node_id to list active-sequence markers, or use list_markers_uxp with scope project_item.");
             }`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;
             if (!markers || typeof markers.getFirstMarker !== "function") {
               return __error("The active sequence does not expose a marker collection.");
             }`;

        const script = buildToolScript(`
          ${markerTarget}
          function __markerGuid(marker) { try { return marker.guid ? String(marker.guid) : null; } catch (guidError) { return null; } }
          
          var list = [];
          var marker = markers.getFirstMarker();
          while (marker) {
            list.push({
              name: marker.name,
              comments: marker.comments,
              guid: __markerGuid(marker),
              color: (function () { try { return marker.getColorByIndex(); } catch (colorError) { return null; } })(),
              startSeconds: marker.start.seconds,
              endSeconds: marker.end.seconds,
              type: marker.type
            });
            marker = markers.getNextMarker(marker);
          }
          
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
