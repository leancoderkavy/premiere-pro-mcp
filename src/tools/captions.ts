import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getCaptionTools(bridgeOptions: BridgeOptions) {
  return {
    create_caption_track: {
      description:
        "Create a caption/subtitle track in the active sequence from an imported caption file (e.g., .srt, .vtt)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description:
              "Node ID or name of the imported caption project item (e.g., an .srt file)",
          },
          start_seconds: {
            type: "number",
            description:
              "Offset in seconds from the start of the sequence (default: 0)",
          },
          caption_format: {
            type: "string",
            description:
              "Caption format: 'subtitle' (default), '608', '708', 'teletext', 'ebu', 'op42', 'op47'",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        start_seconds?: number;
        caption_format?: string;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const formatMap: Record<string, string> = {
          subtitle: "Sequence.CAPTION_FORMAT_SUBTITLE",
          "608": "Sequence.CAPTION_FORMAT_608",
          "708": "Sequence.CAPTION_FORMAT_708",
          teletext: "Sequence.CAPTION_FORMAT_TELETEXT",
          ebu: "Sequence.CAPTION_FORMAT_OPEN_EBU",
          op42: "Sequence.CAPTION_FORMAT_OP42",
          op47: "Sequence.CAPTION_FORMAT_OP47",
        };
        const format =
          formatMap[args.caption_format || "subtitle"] ||
          "Sequence.CAPTION_FORMAT_SUBTITLE";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Caption item not found: ${escapeForExtendScript(args.item_id)}");
          
          var result = seq.createCaptionTrack(item, ${startSeconds}, ${format});
          if (!result) return __error("Failed to create caption track");
          return __result({ created: true, item: item.name, startSeconds: ${startSeconds}, format: "${args.caption_format || "subtitle"}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
