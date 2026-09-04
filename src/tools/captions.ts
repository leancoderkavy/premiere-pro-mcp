import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import {
  buildCaptionTimingPlan,
  MAX_CAPTION_ARTIFACT_CHARACTERS,
} from "../ai/caption-timing.js";

function finiteNonNegativeSeconds(value: unknown, field: string, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 604_800) {
    throw new Error(`${field} must be a finite number from 0 through 604800`);
  }
  return value;
}

function requiredItemId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 512) {
    throw new Error("item_id is required for action import and must be at most 512 characters");
  }
  return value.trim();
}

function lectureCaptionWorkflow(plan: ReturnType<typeof buildCaptionTimingPlan>) {
  return {
    id: "guided_lecture_caption_workflow",
    planId: plan.planId,
    appliesCaptionArtifact: false,
    steps: [
      {
        id: "prepare_test_sequence",
        mutatesProject: true,
        route: "manage_sequences_uxp",
        instruction: "Use a duplicate/test sequence before importing captions. When a compatible UXP bridge is available, clone with the documented sequence workflow; otherwise duplicate it in Premiere and re-query the stable sequence ID.",
        verification: "A cloned sequence must be independently identified before any caption import. This plan does not create or select a sequence.",
      },
      {
        id: "review_timing_preview",
        mutatesProject: false,
        route: "create_caption_track",
        instruction: "Review the beginning, middle, and end timing samples before changing the caller-owned SRT or VTT artifact. If the preview requires manual review, resolve that mismatch before import.",
        verification: "The timing preview is not a modified artifact and is not proof of subtitle readability.",
      },
      {
        id: "import_caption_track",
        mutatesProject: true,
        route: "create_caption_track",
        instruction: "Import the reviewed artifact into the Premiere project, then call create_caption_track with action import, the imported item_id, and an intentional start_seconds value.",
        verification: "CEP reports caption-track count readback when available; accepted requests without readback are not structural verification.",
      },
      {
        id: "read_back_caption_track",
        mutatesProject: false,
        route: "read_sequence_captions",
        instruction: "Read the caption-track structure from the intended duplicate/test sequence after import.",
        verification: "Caption-track structure does not prove playback synchronization, line breaks, safe area, or visual readability.",
      },
      {
        id: "review_beginning_middle_end",
        mutatesProject: false,
        route: "export_sequence_review_frames",
        instruction: "Review frames around the plan's beginning, middle, and end samples and play the same ranges in Premiere before delivery.",
        verification: "Review frames and playback establish different evidence levels; rendered output remains a separate delivery check.",
      },
    ],
    verification: {
      structuralReadback: "not_run",
      playbackReview: "not_run",
      renderedOutputReview: "not_run",
      boundary: "The workflow is a guide. It has not imported captions, modified a sequence, exported review frames, or established any host-side verification.",
    },
  };
}

export function getCaptionTools(bridgeOptions: BridgeOptions) {
  return {
    create_caption_track: {
      description:
        "Import an already reviewed caption artifact into the active sequence, or create a local lecture-caption timing and review workflow plan. Import reports structural success only when the host exposes a caption-track readback; the planning action never contacts Premiere or changes an artifact.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: ["import", "plan_lecture_workflow"],
            default: "import",
            description: "Use import (the default) to create a Premiere caption track, or plan_lecture_workflow for a read-only SRT/VTT timing and review plan.",
          },
          item_id: {
            type: "string",
            maxLength: 512,
            description:
              "For action import, the node ID or name of the imported caption project item (for example, an SRT file). Omit for plan_lecture_workflow.",
          },
          start_seconds: {
            type: "number",
            minimum: 0,
            maximum: 604800,
            description:
              "For action import, offset in seconds from the start of the sequence (default: 0).",
          },
          caption_format: {
            type: "string",
            description:
              "For action import, Premiere caption format: subtitle (default), 608, 708, teletext, ebu, op42, or op47.",
          },
          caption_content: {
            type: "string",
            minLength: 1,
            maxLength: MAX_CAPTION_ARTIFACT_CHARACTERS,
            description: "For plan_lecture_workflow, the caller-owned SRT or VTT content to parse locally. The returned plan contains no caption text and does not write this artifact.",
          },
          artifact_format: {
            type: "string",
            enum: ["srt", "vtt"],
            description: "For plan_lecture_workflow, the syntax of caption_content. VTT content must include its WEBVTT header.",
          },
          target_duration_seconds: {
            type: "number",
            minimum: 0.001,
            maximum: 604800,
            description: "For plan_lecture_workflow, optional intended sequence duration. A mismatch requires review unless proportional scaling is explicitly authorized.",
          },
          observed_offset_seconds: {
            type: "number",
            minimum: -86400,
            maximum: 86400,
            description: "For plan_lecture_workflow, an editor-observed constant offset in seconds. Positive means captions currently appear later than intended; the preview proposes the inverse shift when safe.",
          },
          allow_proportional_scaling: {
            type: "boolean",
            description: "For plan_lecture_workflow, explicitly permit a bounded timing-scale preview when the artifact end does not match target_duration_seconds. This still never rewrites a caption artifact.",
          },
          timing_tolerance_seconds: {
            type: "number",
            minimum: 0.001,
            maximum: 10,
            description: "For plan_lecture_workflow, tolerance used to classify an offset or duration mismatch (default: 0.25 seconds).",
          },
        },
      },
      handler: async (args: {
        action?: "import" | "plan_lecture_workflow";
        item_id?: string;
        start_seconds?: number;
        caption_format?: string;
        caption_content?: string;
        artifact_format?: "srt" | "vtt";
        target_duration_seconds?: number;
        observed_offset_seconds?: number;
        allow_proportional_scaling?: boolean;
        timing_tolerance_seconds?: number;
      }) => {
        try {
          const action = args.action ?? "import";
          if (action === "plan_lecture_workflow") {
            const plan = buildCaptionTimingPlan(args.caption_content, args.artifact_format, {
              targetDurationSeconds: args.target_duration_seconds,
              observedOffsetSeconds: args.observed_offset_seconds,
              allowProportionalScaling: args.allow_proportional_scaling,
              timingToleranceSeconds: args.timing_tolerance_seconds,
            });
            return {
              success: true,
              data: {
                ...plan,
                workflow: lectureCaptionWorkflow(plan),
              },
            };
          }
          if (action !== "import") return { success: false, error: "action must be either import or plan_lecture_workflow" };
          const itemId = requiredItemId(args.item_id);
          const startSeconds = finiteNonNegativeSeconds(args.start_seconds, "start_seconds");
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
          
          var item = __findProjectItem("${escapeForExtendScript(itemId)}");
          if (!item) return __error("Caption item not found: ${escapeForExtendScript(itemId)}");

          function __captionTrackCount(sequence) {
            var tracks = null;
            try {
              if (typeof sequence.getCaptionTracks === "function") tracks = sequence.getCaptionTracks();
              else if (sequence.captionTracks) tracks = sequence.captionTracks;
            } catch (readError) { tracks = null; }
            if (!tracks) return null;
            try { return tracks.numTracks !== undefined ? Number(tracks.numTracks) : Number(tracks.length); }
            catch (countError) { return null; }
          }
          var beforeCount = __captionTrackCount(seq);
          var result = seq.createCaptionTrack(item, ${startSeconds}, ${format});
          if (!result) return __error("Failed to create caption track");
          var afterCount = __captionTrackCount(seq);
          if (beforeCount !== null && afterCount !== null) {
            if (afterCount <= beforeCount) {
              return __error("Premiere accepted caption-track creation but no caption track appeared in host readback. No successful creation is reported.");
            }
            return __result({
              created: true,
              verified: true,
              renderVerified: false,
              verificationScope: "Caption-track count readback only; verify playback or exported frames before delivery.",
              item: item.name,
              startSeconds: ${startSeconds},
              format: "${args.caption_format || "subtitle"}",
              beforeTrackCount: beforeCount,
              afterTrackCount: afterCount
            });
          }
          return __result({
            accepted: true,
            verified: false,
            renderVerified: false,
            verificationScope: "Premiere accepted the caption-track request, but this CEP host exposes no caption-track readback. No structural creation is claimed; verify playback or exported frames before delivery.",
            item: item.name,
            startSeconds: ${startSeconds},
            format: "${args.caption_format || "subtitle"}"
          });
        `);
          return sendCommand(script, bridgeOptions);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
