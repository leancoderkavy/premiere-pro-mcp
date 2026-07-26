import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";

const BLOCKED_REASON =
  "No documented ExtendScript or Premiere UXP API exposes this operation. Use Premiere Pro's UI; MCP will not invoke QE or guess private component parameters.";

export function getAvSettingsTools(bridgeOptions: BridgeOptions) {
  return {
    get_av_feature_support: {
      description:
        "Report the documented automation boundary for advanced audio and modern color management, including actionable reasons for UI-only features.",
      parameters: {},
      handler: async () => ({
        success: true,
        data: {
          schemaVersion: 1,
          supported: {
            sequenceAvInspection: {
              status: "supported",
              backend: "cep",
              fields: [
                "audioChannelCount",
                "audioChannelType",
                "audioSampleRate",
                "audioDisplayFormat",
                "autoToneMapEnabled",
                "compositeLinearColor",
                "maximumBitDepth",
                "maximumRenderQuality",
              ],
              note: "Field availability varies by Premiere version and sequence preset.",
            },
            projectItemColorInspection: {
              status: "supported",
              backend: "cep",
              fields: [
                "effectiveColorSpace",
                "originalColorSpace",
                "overrideColorSpaceOptions",
                "embeddedLutId",
                "inputLutId",
              ],
            },
            projectItemAudioChannelInspection: {
              status: "supported",
              backend: "cep",
              fields: ["audioChannelsType", "audioClipsNumber"],
            },
            projectItemAudioChannelMapping: {
              status: "supported_with_limitations",
              backend: "cep",
              note: "The documented mapping object can set one output-to-source channel mapping and reports whether Premiere accepted it; the API does not expose a per-channel mapping getter for post-write comparison.",
            },
            projectGraphicsWhiteLuminance: {
              status: "uxp_only",
              minPremiereVersion: "25.6",
              note: "Documented UXP inspection exists, but the current MCP UXP transport does not yet route this command.",
            },
          },
          blocked: {
            sequenceWorkingColorSpace: { status: "unsupported", reason: BLOCKED_REASON },
            sequenceOutputColorSpace: { status: "unsupported", reason: BLOCKED_REASON },
            projectItemColorSpaceOverrideMutation: { status: "unsupported", reason: BLOCKED_REASON },
            loudnessMeasurementAndNormalization: { status: "unsupported", reason: BLOCKED_REASON },
            audioTrackMixerRoutingAndSubmixes: { status: "unsupported", reason: BLOCKED_REASON },
            enhanceSpeech: { status: "ui_only", reason: BLOCKED_REASON },
            remix: { status: "ui_only", reason: BLOCKED_REASON },
          },
        },
      }),
    },

    inspect_sequence_av_settings: {
      description:
        "Inspect documented audio, tone-mapping, linear-compositing, bit-depth, render-quality, and display settings for the active sequence.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var settings = seq.getSettings();
          if (!settings) return __error("Could not get sequence settings");

          function valueOfTime(value) {
            if (value === undefined || value === null) return null;
            var result = {};
            try { if (value.seconds !== undefined) result.seconds = value.seconds; } catch (_) {}
            try { if (value.ticks !== undefined) result.ticks = value.ticks.toString(); } catch (_) {}
            return result;
          }
          function optional(name) {
            try { return settings[name] === undefined ? null : settings[name]; } catch (_) { return null; }
          }

          return __result({
            sequence: seq.name,
            audio: {
              channelCount: optional("audioChannelCount"),
              channelType: optional("audioChannelType"),
              channelTypeLabels: { "0": "mono", "1": "stereo", "2": "5.1", "3": "multichannel", "4": "4-channel", "5": "8-channel" },
              sampleRate: valueOfTime(optional("audioSampleRate")),
              displayFormat: optional("audioDisplayFormat")
            },
            colorAndRender: {
              autoToneMapEnabled: optional("autoToneMapEnabled"),
              compositeLinearColor: optional("compositeLinearColor"),
              maximumBitDepth: optional("maximumBitDepth"),
              maximumRenderQuality: optional("maximumRenderQuality")
            },
            unavailableThroughDocumentedApi: ["sequenceWorkingColorSpace", "sequenceOutputColorSpace"],
            note: "null means the current Premiere build or sequence preset did not expose that documented field."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    inspect_project_item_av_metadata: {
      description:
        "Inspect a project item's documented effective/original color space, LUT IDs, available color-space overrides, and audio channel shape.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Project item node ID or exact name",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          function optionalCall(name) {
            try { return typeof item[name] === "function" ? item[name]() : null; } catch (_) { return null; }
          }
          function optionalProperty(name) {
            try { return item[name] === undefined ? null : item[name]; } catch (_) { return null; }
          }
          var mapping = optionalProperty("getAudioChannelMapping");
          if (typeof mapping === "function" || !mapping) mapping = optionalCall("getAudioChannelMapping");
          var overrideList = optionalProperty("getOverrideColorSpaceList");
          if (typeof overrideList === "function" || !overrideList) overrideList = optionalCall("getOverrideColorSpaceList");
          return __result({
            item: item.name,
            nodeId: item.nodeId,
            color: {
              effective: optionalCall("getColorSpace"),
              original: optionalCall("getOriginalColorSpace"),
              overrideOptions: overrideList,
              embeddedLutId: optionalCall("getEmbeddedLUTID"),
              inputLutId: optionalCall("getInputLUTID")
            },
            audio: mapping ? {
              channelType: mapping.audioChannelsType,
              clipCount: mapping.audioClipsNumber
            } : null
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_project_item_audio_channel_mapping: {
      description:
        "Map one output audio channel of a project item to a source channel using Premiere's documented AudioChannelMapping API.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Project item node ID or exact name",
          },
          channel_index: {
            type: "number",
            description: "Zero-based output channel index to configure",
          },
          source_channel_index: {
            type: "number",
            description: "Zero-based source channel index to map",
          },
        },
        required: ["item_id", "channel_index", "source_channel_index"],
      },
      handler: async (args: {
        item_id: string;
        channel_index: number;
        source_channel_index: number;
      }) => {
        if (!Number.isInteger(args.channel_index) || args.channel_index < 0) {
          return { success: false, error: "channel_index must be a non-negative integer" };
        }
        if (!Number.isInteger(args.source_channel_index) || args.source_channel_index < 0) {
          return { success: false, error: "source_channel_index must be a non-negative integer" };
        }
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          var mapping = null;
          try { mapping = item.getAudioChannelMapping; } catch (_) {}
          if (typeof mapping === "function" || !mapping) {
            try { if (typeof item.getAudioChannelMapping === "function") mapping = item.getAudioChannelMapping(); } catch (_) {}
          }
          if (!mapping || typeof mapping.setMappingForChannel !== "function") {
            return __error("This item or Premiere build does not expose AudioChannelMapping.setMappingForChannel");
          }
          var accepted = mapping.setMappingForChannel(${args.channel_index}, ${args.source_channel_index});
          if (accepted !== true) return __error("Premiere rejected this channel mapping");
          return __result({
            item: item.name,
            channelIndex: ${args.channel_index},
            sourceChannelIndex: ${args.source_channel_index},
            accepted: true,
            verification: "api-return",
            limitation: "The documented API does not expose a per-channel mapping getter for post-write comparison."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
