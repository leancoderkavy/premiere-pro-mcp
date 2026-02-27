import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getMarkerTools(bridgeOptions: BridgeOptions) {
  return {
    add_marker: {
      description: "Add a marker to the active sequence or a clip",
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
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          
          var timeTicks = __secondsToTicks(${args.time_seconds}).toString();
          var marker = markers.createMarker(parseFloat(timeTicks));
          
          ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
          ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
          ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
          ${args.duration_seconds ? `marker.end = __secondsToTicks(${args.time_seconds + args.duration_seconds}).toString();` : ""}
          
          return __result({
            added: true,
            timeSeconds: ${args.time_seconds},
            name: marker.name,
            comments: marker.comments
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_marker: {
      description: "Delete a marker at a specific time position",
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
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var marker = markers.getFirstMarker();
          var deleted = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              markers.deleteMarker(marker);
              deleted = true;
              break;
            }
            marker = markers.getNextMarker(marker);
          }
          
          if (!deleted) return __error("No marker found at " + ${args.time_seconds} + "s");
          return __result({ deleted: true, timeSeconds: ${args.time_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    update_marker: {
      description: "Update an existing marker's properties",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to update",
          },
          name: { type: "string", description: "New name" },
          comments: { type: "string", description: "New comments" },
          color: { type: "number", description: "New color index" },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; name?: string; comments?: string; color?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var marker = seq.markers.getFirstMarker();
          var found = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
              ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
              ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
              found = true;
              break;
            }
            marker = seq.markers.getNextMarker(marker);
          }
          
          if (!found) return __error("No marker found at " + ${args.time_seconds} + "s");
          return __result({ updated: true, timeSeconds: ${args.time_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_markers: {
      description: "List all markers on the active sequence or a specific clip",
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
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          
          var list = [];
          var marker = markers.getFirstMarker();
          while (marker) {
            list.push({
              name: marker.name,
              comments: marker.comments,
              startSeconds: __ticksToSeconds(marker.start.ticks),
              endSeconds: __ticksToSeconds(marker.end.ticks),
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
