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
const MARKER_READBACK = `
          function __markerMismatches(marker, wanted) {
            var problems = [];
            if (wanted.name !== undefined && String(marker.name) !== wanted.name) problems.push("name reads back as " + marker.name);
            if (wanted.comments !== undefined && String(marker.comments) !== wanted.comments) problems.push("comments read back as " + marker.comments);
            if (wanted.color !== undefined) {
              var color = null;
              try { color = marker.getColorByIndex(); } catch (eColor) {}
              if (color !== null && Number(color) !== wanted.color) problems.push("color index reads back as " + color);
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
      description: "Add a marker to the active sequence or a clip and read its name, comments, color and duration back. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means Undo would reverse an earlier action.",
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
            description: "Optional clip node ID to add marker to clip instead of sequence",
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
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          ${MARKER_UNDO_RECEIPT}
          
          // createMarker() and the marker.end setter both take seconds, not ticks.
          var markerUndoBefore = __readUndoIndex();
          var markerBarrier = __rememberMarkerUndoBarrier(markerUndoBefore);
          if (!markerBarrier.ok) return __error(markerBarrier.error);
          var marker = markers.createMarker(${args.time_seconds});

          ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
          ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
          ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
          ${args.duration_seconds ? `marker.end = ${args.time_seconds + args.duration_seconds};` : ""}
          ${MARKER_READBACK}
          var problems = __markerMismatches(marker, ${wanted});
          if (problems.length) {
            return __jsonStringify({ success: false, error: "The marker was created at ${args.time_seconds}s, but " + problems.join("; ") + ".", data: __markerUndoReceipt(markerUndoBefore, { timelineChanged: true }) });
          }
          return __result(__markerUndoReceipt(markerUndoBefore, {
            added: true,
            verified: true,
            timeSeconds: ${args.time_seconds},
            endSeconds: parseFloat(marker.end.seconds),
            name: marker.name,
            comments: marker.comments
          }));
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_marker: {
      description: "Delete a marker at a specific time position. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means Undo would reverse an earlier action.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to delete",
          },
          node_id: {
            type: "string",
            description: "Optional clip node ID (deletes from sequence if omitted)",
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
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          ${MARKER_UNDO_RECEIPT}
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var markerUndoBefore = __readUndoIndex();
          var marker = markers.getFirstMarker();
          var deleted = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              var markerBarrier = __rememberMarkerUndoBarrier(markerUndoBefore);
              if (!markerBarrier.ok) return __error(markerBarrier.error);
              markers.deleteMarker(marker);
              deleted = true;
              break;
            }
            marker = markers.getNextMarker(marker);
          }
          
          if (!deleted) return __error("No marker found at " + ${args.time_seconds} + "s");
          return __result(__markerUndoReceipt(markerUndoBefore, { deleted: true, timeSeconds: ${args.time_seconds} }));
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    update_marker: {
      description: "Update the name, comments or color of the sequence marker at a time and read them back. EXPERIMENTAL (QE DOM): the receipt reports undoStackIndex movement, which does not prove QE can reverse the marker. Every marker attempt protects an engine undo boundary; undoTracked:false means Undo would reverse an earlier action.",
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
          return __result(__markerUndoReceipt(markerUndoBefore, { updated: true, verified: true, timeSeconds: ${args.time_seconds}, name: marker.name, comments: marker.comments }));
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_markers: {
      description: "List markers on the active sequence, or on a source project item that exposes a marker collection. A timeline-clip node_id returns a clean error instead of a raw TypeError.",
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
          
          var list = [];
          var marker = markers.getFirstMarker();
          while (marker) {
            list.push({
              name: marker.name,
              comments: marker.comments,
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
