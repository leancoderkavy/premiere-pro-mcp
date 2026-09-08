import { CONTENT_FLAGS, PLATFORM_IDS, REFRAME_STRATEGIES, planPlatformDeliveryMatrix, validatePlatformPublishPackage } from "../ai/platform-specs.js";

const PLATFORM_ENUM = [...PLATFORM_IDS];

export function getPlatformDeliveryTools() {
  return {
    plan_platform_delivery_matrix: {
      description:
        "Plan multi-ratio delivery of one source sequence to TikTok, Reels, Shorts, YouTube, LinkedIn, X, and Facebook from a local spec table: sequence settings, reframe scale math, duration and file-size fit, caption safe zones, and ordered apply routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          source: {
            type: "object",
            additionalProperties: false,
            description: "Source sequence characteristics.",
            properties: {
              width: { type: "integer", minimum: 1, maximum: 16384, description: "Source frame width in pixels." },
              height: { type: "integer", minimum: 1, maximum: 16384, description: "Source frame height in pixels." },
              frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Source frame rate in frames per second." },
              duration_seconds: { type: "number", minimum: 0.001, maximum: 172800, description: "Source duration in seconds." },
              has_captions: { type: "boolean", description: "Whether the source already carries a caption track." },
              sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional Premiere sequence ID recorded in the plan evidence." },
            },
            required: ["width", "height", "frame_rate", "duration_seconds"],
          },
          targets: { type: "array", minItems: 1, maxItems: PLATFORM_IDS.length, uniqueItems: true, items: { type: "string", enum: PLATFORM_ENUM, description: "Platform id." }, description: "Unique platform ids to plan for." },
          strategy: { type: "string", enum: [...REFRAME_STRATEGIES], description: "Reframe strategy when the aspect ratio changes; defaults to auto_reframe." },
          export_preset_hint: { type: "string", minLength: 1, maxLength: 256, description: "Optional export preset name to echo into the export step." },
        },
        required: ["source", "targets"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          return { success: true, data: planPlatformDeliveryMatrix({ source: args.source, targets: args.targets, strategy: args.strategy, export_preset_hint: args.export_preset_hint }) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    validate_platform_publish_package: {
      description:
        "Validate a rendered file plus title, description, hashtags, and content flags against one platform's approximate 2026 publish limits. Returns hard violations, soft warnings, normalized hashtags, and character counts. Local-only; never uploads or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          platform: { type: "string", enum: PLATFORM_ENUM, description: "Target platform id." },
          title: { type: "string", maxLength: 1000, description: "Post or video title." },
          description: { type: "string", maxLength: 10000, description: "Post caption or description body." },
          hashtags: { type: "array", maxItems: 100, items: { type: "string", maxLength: 150, description: "One hashtag, ideally starting with '#'." }, description: "Hashtags to publish with the post." },
          duration_seconds: { type: "number", minimum: 0, maximum: 172800, description: "Rendered file duration in seconds." },
          width: { type: "integer", minimum: 1, maximum: 16384, description: "Rendered frame width in pixels." },
          height: { type: "integer", minimum: 1, maximum: 16384, description: "Rendered frame height in pixels." },
          frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Rendered frame rate in frames per second." },
          file_size_bytes: { type: "number", minimum: 0, maximum: 10000000000000, description: "Rendered file size in bytes." },
          container: { type: "string", maxLength: 32, description: "Container extension such as mp4 or mov." },
          video_codec: { type: "string", maxLength: 64, description: "Video codec name such as H.264." },
          audio_codec: { type: "string", maxLength: 64, description: "Audio codec name such as AAC." },
          has_captions: { type: "boolean", description: "Whether captions are burned in or attached." },
          content_flags: { type: "array", maxItems: CONTENT_FLAGS.length, uniqueItems: true, items: { type: "string", enum: [...CONTENT_FLAGS], description: "Content disclosure flag." }, description: "Disclosure flags that trigger platform label reminders." },
        },
        required: ["platform", "duration_seconds", "width", "height", "frame_rate"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          return { success: true, data: validatePlatformPublishPackage(args) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
