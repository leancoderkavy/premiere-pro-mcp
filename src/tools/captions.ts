import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAPTION_PLAN_OPTION_PROPERTIES } from "../ai/caption-plan.js";
import { parseSubtitles, planToExportCues, writeCaptions } from "../ai/caption-export.js";
import { CAPTION_PLAN_INPUT_PROPERTIES, CAPTION_TRANSCRIPT_INPUT_PROPERTIES, resolveCaptionPlan } from "./caption-inputs.js";
import { resolveContainedOutputPath } from "./caption-authoring.js";
import {
  buildImportCaptionFileScript,
  CAPTION_CUT_SOURCE_PROPERTY,
  normalizeCutSource,
  readCaptionSequence,
  safeFileStem,
  summarizeCaptionPlan,
} from "./caption-host.js";
import {
  buildCaptionTimingPlan,
  MAX_CAPTION_ARTIFACT_CHARACTERS,
} from "../ai/caption-timing.js";

const CAPTION_FORMATS: Record<string, string> = {
  subtitle: "Sequence.CAPTION_FORMAT_SUBTITLE",
  "608": "Sequence.CAPTION_FORMAT_608",
  "708": "Sequence.CAPTION_FORMAT_708",
  teletext: "Sequence.CAPTION_FORMAT_TELETEXT",
  ebu: "Sequence.CAPTION_FORMAT_OPEN_EBU",
  op42: "Sequence.CAPTION_FORMAT_OP42",
  op47: "Sequence.CAPTION_FORMAT_OP47",
};

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

function captionReversal(data: Record<string, unknown>) {
  const steps = typeof data.undoSteps === "number" && Number.isSafeInteger(data.undoSteps) && data.undoSteps >= 0 ? data.undoSteps : null;
  const index = typeof data.undoStackIndex === "number" && Number.isSafeInteger(data.undoStackIndex) && data.undoStackIndex >= 0 ? data.undoStackIndex : null;
  const uncertain = data.recoveryRequired === true || data.stateUnknown === true || data.outcome === "unknown" || data.outcome === "unknown_outcome" || data.outcome === "not_applied" || data.mutationOutcome === "unknown" || data.mutationOutcome === "unknown_outcome" || data.mutationOutcome === "not_applied";
  const canUndo = !uncertain && steps !== null && steps > 0 && steps <= 100 && index !== null && index >= steps;
  return {
    undoSteps: steps,
    exportWarning: "Caption tracks render in export_sequence by default. CEP cannot remove or hide them; deleting the source caption item does not remove its track.",
    reversal: {
      cepRemovalAvailable: false,
      undo: {
        tool: "multiple_undo", available: canUndo,
        arguments: canUndo ? { count: steps, expected_undo_stack_index: index } : null,
        evidence: "Experimental QE project-wide undo-stack delta only; matching stack position does not prove action identity or caption removal.",
        instruction: canUndo
          ? "If reversing this call, inspect its result and use these exact undo arguments immediately, before other edits. Verify the caption track afterwards."
          : "No usable guarded undo count is available. Do not guess an undo count: it may reverse earlier edits. Inspect the track and use Premiere's UI or the guarded UXP mute route.",
      },
      hide: {
        tool: "manage_track_state_uxp", requires: "A connected UXP panel and supported caption-track mute capability.",
        instruction: "Identify the new caption track, inspect that exact track with media_type caption and track_indices, then set_mute with muted true, a fresh operation_id and the expected_sequence_id/expected_muted returned by inspect unchanged. Read back the mute state. Muting hides the track; it does not delete it.",
      },
    },
  };
}

/**
 * Styling notes attached to a successful import receipt. Premiere imports SRT/VTT
 * with its default caption look; no documented API styles caption tracks, colours
 * words, or runs Graphics and Titles > Upgrade Caption to Graphic.
 */
export const CAPTION_IMPORT_STYLING_NOTES = [
  "The track uses Premiere's default caption style; this import does not apply fonts, colours, background, or position.",
  "Call get_caption_style_guidance for Track Style steps, keyword_highlight per-word steps, and Graphics and Titles > Upgrade Caption to Graphic (manual menu command; the MCP cannot run it).",
  "Still-frame exports can omit caption tracks. Verify with playback or a short export_sequence burn-in export (see get_caption_style_guidance render_verification).",
] as const;

function withStylingNotes(result: CommandResult): CommandResult {
  if (!result.success || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return result;
  return { ...result, data: { ...(result.data as Record<string, unknown>), styleApplied: false, styling: [...CAPTION_IMPORT_STYLING_NOTES] } };
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
        instruction: "Import the reviewed artifact into the Premiere project, then call create_caption_track with action import, the imported item_id, and an intentional start_seconds value. The track renders in exports by default; review the import result reversal guidance before continuing.",
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
        route: "export_sequence",
        instruction: "Play the plan's beginning, middle, and end samples in Premiere. For a rendered check, export a short range around them with export_sequence and a preset that burns captions into video; still-frame exports can omit caption tracks.",
        verification: "Playback and a burn-in export establish different evidence levels; still frames are not caption evidence, and full rendered output remains a separate delivery check.",
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

/** The CEP script that creates a caption track from a project item, with before/after track-count readback. */
export function buildCreateCaptionTrackScript(itemId: string, startSeconds: number, captionFormat: string): string {
  const format = CAPTION_FORMATS[captionFormat];
  return buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __refuse("No active sequence");
          
          var item = __findProjectItem("${escapeForExtendScript(itemId)}");
          if (!item) return __refuse("Caption item not found: ${escapeForExtendScript(itemId)}");

          function __captionTrackCount(sequence) {
            var tracks = null;
            try {
              if (typeof sequence.getCaptionTracks === "function") tracks = sequence.getCaptionTracks();
              else if (sequence.captionTracks) tracks = sequence.captionTracks;
            } catch (readError) { tracks = null; }
            if (!tracks) return null;
            try {
              var count = tracks.numTracks !== undefined ? tracks.numTracks : tracks.length;
              return typeof count === "number" && isFinite(count) && count >= 0 && count <= 9007199254740991 && Math.floor(count) === count ? count : null;
            }
            catch (countError) { return null; }
          }
          var beforeCount = __captionTrackCount(seq);
          var result = false, hostError = null;
          try { result = seq.createCaptionTrack(item, ${startSeconds}, ${format}); }
          catch (createError) { hostError = createError.toString(); }
          var afterCount = __captionTrackCount(seq);
          var receipt = {
            accepted: !!result,
            verified: false,
            outcome: "committed_unverified",
            timelineChanged: beforeCount !== null && afterCount !== null && afterCount !== beforeCount ? true : null,
            renderVerified: false,
            item: item.name,
            startSeconds: ${startSeconds},
            format: "${escapeForExtendScript(captionFormat)}",
            beforeTrackCount: beforeCount,
            afterTrackCount: afterCount,
            hostError: hostError
          };
          if (beforeCount !== null && afterCount !== null) {
            if (afterCount !== beforeCount + 1) {
              return __error("Caption-track creation was attempted but readback did not show exactly one new track. Inspect the sequence before retrying.", receipt);
            }
            receipt.created = true;
            receipt.verified = true;
            receipt.outcome = "verified";
            receipt.verificationScope = "Caption-track count readback only; verify playback or exported frames before delivery.";
            return __result(receipt);
          }
          receipt.verificationScope = "Caption-track readback is unavailable or invalid. No structural creation is claimed; verify playback or exported frames before delivery.";
          if (hostError || !result) return __error("Caption-track creation did not confirm acceptance and its mutation outcome is unknown. Inspect the sequence before retrying.", receipt);
          return __result(receipt);
        `);
}

/** Creates the caption track in one CEP call and attaches styling notes and reversal guidance. */
export async function createCaptionTrackOnHost(bridgeOptions: BridgeOptions, itemId: string, startSeconds: number, captionFormat: string): Promise<CommandResult> {
  const response = await sendCommand(buildCreateCaptionTrackScript(itemId, startSeconds, captionFormat), bridgeOptions);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return response;
  const data = response.data as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(data, "beforeTrackCount")) return withStylingNotes(response);
  return withStylingNotes({ ...response, data: { ...data, ...captionReversal(data) } });
}

/**
 * Writes the SRT with flag "wx" to the first free '<stem> captions.srt', '<stem> captions 2.srt', ...
 * in the workspace; a taken name (EEXIST, also a race) moves on to the next number. The returned path is
 * under the workspace's realpath, the same form resolveContainedOutputPath returns for an explicit output_path.
 */
function writeDefaultSrt(workspace: string, stem: string, text: string): string {
  let root = "";
  try {
    root = realpathSync(workspace);
    if (!statSync(root).isDirectory()) root = "";
  } catch {
    // reported below
  }
  if (!root) throw new Error("approved_workspace_path must be an existing directory");
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(root, n === 1 ? `${stem} captions.srt` : `${stem} captions ${n}.srt`);
    try {
      writeFileSync(candidate, text, { encoding: "utf8", flag: "wx" });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("Could not find a free captions file name in approved_workspace_path; pass output_path.");
}

/**
 * import_plan: read the sequence, plan at its frame rate, write and read back an SRT, import it
 * (one CEP call) and create the caption track (a separate CEP call).
 */
async function importCaptionPlan(args: Record<string, unknown>, bridgeOptions: BridgeOptions) {
  if (typeof args.approved_workspace_path !== "string" || !args.approved_workspace_path.trim()) {
    return { success: false, error: "approved_workspace_path is required for action import_plan (the SRT is written there)." };
  }
  const workspace = args.approved_workspace_path.trim();
  const startSeconds = finiteNonNegativeSeconds(args.start_seconds as number | undefined, "start_seconds");
  const captionFormat = args.caption_format === undefined ? "subtitle" : args.caption_format;
  if (typeof captionFormat !== "string" || !Object.prototype.hasOwnProperty.call(CAPTION_FORMATS, captionFormat)) {
    return { success: false, error: `caption_format must be one of: ${Object.keys(CAPTION_FORMATS).join(", ")}` };
  }
  const cutSource = normalizeCutSource(args.cut_source);
  if (args.output_path !== undefined) {
    const explicit = resolveContainedOutputPath(workspace, args.output_path);
    if (path.extname(explicit).toLocaleLowerCase() !== ".srt") return { success: false, error: "output_path must end in .srt" };
  }

  // 1. The sequence: frame rate (the plan is built at it) and, optionally, edit points.
  const sequence = await readCaptionSequence(bridgeOptions, { include_edit_points: cutSource === "edit_points" });

  // 2. The plan, at the sequence's frame rate.
  // The caption track starts at start_seconds, so the plan may run until the sequence end minus that.
  const planEnd = sequence.duration_seconds === null ? undefined : sequence.duration_seconds - startSeconds;
  if (planEnd !== undefined && !(planEnd > 0)) {
    return { success: false, error: `start_seconds ${startSeconds} is at or after the end of the sequence (${sequence.duration_seconds} s), so no caption could be shown. Nothing was written or imported.` };
  }
  const resolved = resolveCaptionPlan(args, {
    frame_rate: sequence.fps,
    ...(planEnd !== undefined ? { end_s: planEnd } : {}),
    ...(cutSource === "edit_points" && sequence.edit_points ? { cut_times: sequence.edit_points } : {}),
  });
  const plan = resolved.plan;
  if (plan.captions.length === 0) {
    return { success: false, error: "The plan has no captions, so nothing was written or imported.", data: { plan: summarizeCaptionPlan(plan) } };
  }
  const warnings = [...plan.warnings];
  if (sequence.edit_points_truncated) warnings.push("The sequence has more edit points than the host collected; later cuts were not used for snapping.");
  if (plan.captions.some((c) => c.color)) {
    warnings.push("The plan asks for speaker colours, but a native Premiere caption track has no scripting style API, so the colours are not applied. Use speaker_style label or hyphen for the native track, or add_caption_graphics with a colour field for burned-in colour.");
  }
  if (plan.captions.some((c) => c.italic || c.kind === "lyric")) {
    warnings.push("Italics are not written to the SRT (Premiere may show the tags as text); lyric and italic captions import as plain text.");
  }

  // 3. The SRT, written once (flag wx) and parsed back.
  const cues = planToExportCues(plan, { include_speaker: false, use_color: false }).map((cue) => ({ ...cue, italic: undefined }));
  const written = writeCaptions("srt", cues);
  let target: string;
  if (args.output_path !== undefined) {
    target = resolveContainedOutputPath(workspace, args.output_path);
    writeFileSync(target, written.text, { encoding: "utf8", flag: "wx" });
  } else {
    target = writeDefaultSrt(workspace, safeFileStem(sequence.name), written.text);
  }
  const readBack = parseSubtitles(readFileSync(target, "utf8"), "srt");
  if (readBack.cues.length !== plan.captions.length) {
    return {
      success: false,
      error: `The SRT was written to ${target} but reads back ${readBack.cues.length} cues instead of ${plan.captions.length}; nothing was imported.`,
      data: { srt_path: target, cue_count: plan.captions.length, cue_count_readback: readBack.cues.length, plan: summarizeCaptionPlan(plan) },
    };
  }
  const srt = { path: target, cue_count: plan.captions.length, cue_count_readback: readBack.cues.length, warnings: written.warnings };

  // 4. Import the file (one CEP call).
  const imported = await sendCommand(buildImportCaptionFileScript(target), bridgeOptions);
  const importData = (imported.data ?? {}) as Record<string, unknown>;
  const item = importData.item as { nodeId?: string } | undefined;
  if (!imported.success || !item?.nodeId) {
    return {
      success: false,
      error: `The SRT was written but Premiere did not confirm importing it: ${imported.error ?? "no project item found"}. No caption track was created.`,
      data: { srt, import: importData, plan: summarizeCaptionPlan(plan) },
    };
  }

  // 5. Create the caption track in a separate CEP call (before/after track-count readback).
  const track = await createCaptionTrackOnHost(bridgeOptions, item.nodeId, startSeconds, captionFormat);
  const trackData = (track.data ?? {}) as Record<string, unknown>;
  return {
    success: track.success,
    ...(track.success ? {} : { error: track.error }),
    data: {
      action: "import_plan",
      outcome: track.success ? (trackData.outcome ?? "committed_unverified") : (trackData.outcome ?? "failed"),
      sequence: { id: sequence.sequence_id, name: sequence.name, fps: sequence.fps, frame_width: sequence.frame_width, frame_height: sequence.frame_height, cut_source: cutSource, edit_point_count: sequence.edit_points?.length ?? null },
      plan: summarizeCaptionPlan(plan),
      srt,
      imported_item: importData.item,
      track: trackData,
      warnings,
      notes: [
        "Re-running import_plan creates another caption track: CEP cannot delete or hide caption tracks (see track.reversal for guarded undo or UXP mute).",
        "The cues are timed to the sequence's frames; Premiere may still show them with its default caption style.",
      ],
    },
  };
}

export function getCaptionTools(bridgeOptions: BridgeOptions) {
  return {
    create_caption_track: {
      description:
        "Import an already reviewed caption artifact into the active sequence, create a local lecture-caption timing and review workflow plan, or (action import_plan) plan captions from a transcript or saved plan at the sequence's own frame rate, write an SRT inside approved_workspace_path (never overwriting), import it and create the native caption track, each host step in its own CEP call. import_plan clamps every caption to the sequence end (minus start_seconds): an out-time past it is shortened and a caption that would start at or after it is dropped, listed in plan.sequence_end_changes. It reports the plan summary, SRT cue-count readback, the imported item and the track-count receipt (verified or committed_unverified); speaker colours cannot be applied to a native caption track (use speaker_style label or hyphen, or add_caption_graphics), and a re-run creates another caption track. Import rejects unsupported formats before host dispatch and reports structural success only when valid count readback shows exactly one new caption track. Unreadable or unexpected results preserve committed_unverified diagnostics; inspect before retrying. Captions import with Premiere's default style; styling, per-word colour, and Upgrade Caption to Graphic stay manual (get_caption_style_guidance). The planning action never contacts Premiere or changes an artifact. Caption tracks render in export_sequence by default; CEP cannot remove or hide them. Import results include observed undoSteps (null when unavailable) and reversal guidance for guarded experimental QE multiple_undo or caption mute through a capable UXP panel.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          ...CAPTION_TRANSCRIPT_INPUT_PROPERTIES,
          ...CAPTION_PLAN_INPUT_PROPERTIES,
          ...CAPTION_PLAN_OPTION_PROPERTIES,
          output_path: {
            type: "string",
            maxLength: 4096,
            description: "For action import_plan, absolute path of the .srt to write inside approved_workspace_path. Default: '<sequence name> captions.srt' in the workspace, numbered ' 2', ' 3' when it exists. An existing file is never overwritten.",
          },
          cut_source: CAPTION_CUT_SOURCE_PROPERTY,
          action: {
            type: "string",
            enum: ["import", "plan_lecture_workflow", "import_plan"],
            default: "import",
            description: "Use import (the default) to create a Premiere caption track from an item already in the project, plan_lecture_workflow for a read-only SRT/VTT timing and review plan, or import_plan to plan captions from a transcript or saved plan at the sequence's frame rate, write an SRT, import it and create the caption track.",
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
            enum: Object.keys(CAPTION_FORMATS),
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
      handler: async (args: Record<string, unknown> & {
        action?: "import" | "plan_lecture_workflow" | "import_plan";
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
          if (action === "import_plan") return await importCaptionPlan(args, bridgeOptions);
          if (action !== "import") return { success: false, error: "action must be import, plan_lecture_workflow or import_plan" };
          const itemId = requiredItemId(args.item_id);
          const startSeconds = finiteNonNegativeSeconds(args.start_seconds, "start_seconds");
        const captionFormat = args.caption_format === undefined ? "subtitle" : args.caption_format;
        if (typeof captionFormat !== "string" || !Object.prototype.hasOwnProperty.call(CAPTION_FORMATS, captionFormat)) {
          return { success: false, error: `caption_format must be one of: ${Object.keys(CAPTION_FORMATS).join(", ")}` };
        }
          return await createCaptionTrackOnHost(bridgeOptions, itemId, startSeconds, captionFormat);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
