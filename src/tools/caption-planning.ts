import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAPTION_PLAN_OPTION_PROPERTIES, frameRateFromTimebaseTicks } from "../ai/caption-plan.js";
import {
  CAPTION_EXPORT_FORMATS,
  countTtmlCues,
  detectSubtitleFormat,
  parseSubtitles,
  planToExportCues,
  writeCaptions,
  type CaptionExportFormat,
  type CuePosition,
} from "../ai/caption-export.js";
import {
  CAPTION_SAFE_AREAS,
  DEFAULT_CHAR_WIDTH_RATIO,
  defaultSafeArea,
  estimateTextBox,
  safeBoxPx,
  type CaptionSafeArea,
} from "../ai/caption-fit.js";
import { lintCaptions, type QaCue } from "../ai/caption-qa.js";
import { CAPTION_STANDARD_IDS, describeCaptionStandards, type CaptionStandardId } from "../ai/caption-standards.js";
import { MAX_INLINE_ARTIFACT_BYTES, resolveContainedInputPath, resolveContainedOutputPath } from "./caption-authoring.js";
import {
  CAPTION_TRANSCRIPT_INPUT_PROPERTIES,
  assertSavablePlanDocument,
  hasTranscriptInput,
  resolveCaptionPlan,
  writeCaptionPlanDocument,
} from "./caption-inputs.js";

/** Largest plan returned inline (captions). A bigger plan needs a file. */
export const MAX_INLINE_PLAN_CAPTIONS = 500;
/** Largest plan returned inline (bytes of captions JSON). */
export const MAX_INLINE_PLAN_BYTES = 256 * 1024;
/** Largest .srt/.vtt file or text that check_captions reads (bytes). */
export const MAX_CHECK_CAPTIONS_BYTES = 5 * 1024 * 1024;
/** Most cues check_captions lints in one call. */
export const MAX_CHECK_CUES = 20_000;
/** Changes and violations returned inline at most; the counts are always complete. */
const MAX_REPORTED_ITEMS = 200;
const MAX_PATH_LENGTH = 4096;
const EDGE_CAPTIONS = 3;

const PLAN_OUTPUT_KEYS = ["sequence_timebase_ticks", "plan_output_path", "export", "approved_workspace_path"];

const TICKS_PROPERTY = {
  type: "number",
  exclusiveMinimum: 0,
  description: "Premiere ticks per frame of the sequence (the timebase from get_sequence_settings; 254016000000 ticks make a second). Converted to a frame rate with the common rates snapped (23.976, 25, 29.97 ...). An error when frame_rate is also given and differs.",
} as const;

const EXPORT_PROPERTY = {
  type: "object",
  additionalProperties: false,
  description: "Also write the captions as a sidecar file: SRT, WebVTT or TTML (IMSC text profile). Omit output_path to get the text back inline (up to 512 KiB). The written file is read back to confirm the cue count.",
  properties: {
    format: { type: "string", enum: [...CAPTION_EXPORT_FORMATS], description: "File format: srt, vtt or ttml." },
    output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute path of a new file inside approved_workspace_path. Never overwrites. Extension must match: .srt, .vtt, or .ttml / .xml." },
    speaker_voice: { type: "boolean", description: "vtt only: write speakers as <v Name> voice spans (default true when the plan has speakers)." },
    line_pct: { type: "number", minimum: 0, maximum: 100, description: "vtt and ttml: where the top of the text sits, percent of the frame height." },
    align: { type: "string", enum: ["start", "center", "end"], description: "vtt and ttml: text alignment." },
    region_width_pct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "vtt and ttml: width of the text box, percent of the frame width." },
    lang: { type: "string", minLength: 2, maxLength: 35, description: "ttml only: language tag of the document, for example en or en-GB." },
  },
  required: ["format"],
} as const;

const CUES_PROPERTY = {
  type: "array",
  minItems: 1,
  maxItems: MAX_CHECK_CUES,
  description: `Cues to check, for example the captions read back by read_sequence_captions or a plan's captions. At most ${MAX_CHECK_CUES}. Provide exactly one of file_path, text, plan_path or cues.`,
  items: {
    type: "object",
    additionalProperties: false,
    description: "One caption.",
    properties: {
      start_seconds: { type: "number", minimum: 0, description: "In-time in sequence seconds." },
      end_seconds: { type: "number", minimum: 0, description: "Out-time in sequence seconds; must be after the in-time." },
      text: { type: "string", maxLength: 2000, description: "Displayed text; separate the lines with a newline." },
    },
    required: ["start_seconds", "end_seconds", "text"],
  },
} as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const given = (value: unknown) => value !== undefined && value !== null;
const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function requireArgs(args: unknown): Record<string, unknown> {
  if (!isObject(args)) throw new Error("arguments must be an object");
  return args;
}

/** Frame rate from frame_rate and/or sequence_timebase_ticks; an error when both are given and disagree. */
function frameRateFromArgs(args: Record<string, unknown>): number | undefined {
  const fps = given(args.frame_rate) ? args.frame_rate : undefined;
  if (fps !== undefined && (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0)) throw new Error("frame_rate must be a positive number");
  if (!given(args.sequence_timebase_ticks)) return fps as number | undefined;
  const fromTicks = frameRateFromTimebaseTicks(args.sequence_timebase_ticks as number | string);
  if (fps !== undefined && Math.abs((fps as number) - fromTicks) > 0.01) {
    throw new Error(`frame_rate ${fps} and sequence_timebase_ticks ${args.sequence_timebase_ticks} (${round3(fromTicks)} fps) disagree; give one of them, or make them match`);
  }
  return fromTicks;
}

type ExportRequest = { format: CaptionExportFormat; output_path?: string; speaker_voice?: boolean; position?: CuePosition; lang?: string; has_position: boolean };

const EXPORT_KEYS = ["format", "output_path", "speaker_voice", "line_pct", "align", "region_width_pct", "lang"];

function parseExportRequest(value: unknown): ExportRequest {
  if (!isObject(value)) throw new Error("export must be an object");
  const unknown = Object.keys(value).find((key) => !EXPORT_KEYS.includes(key));
  if (unknown) throw new Error(`export has an unknown field: ${unknown}`);
  const format = value.format;
  if (typeof format !== "string" || !(CAPTION_EXPORT_FORMATS as readonly string[]).includes(format)) throw new Error(`export.format must be one of: ${CAPTION_EXPORT_FORMATS.join(", ")}`);
  const out: ExportRequest = { format: format as CaptionExportFormat, has_position: false };
  if (given(value.output_path)) {
    if (typeof value.output_path !== "string") throw new Error("export.output_path must be a string");
    out.output_path = value.output_path;
  }
  if (given(value.speaker_voice)) {
    if (typeof value.speaker_voice !== "boolean") throw new Error("export.speaker_voice must be true or false");
    out.speaker_voice = value.speaker_voice;
  }
  const position: CuePosition = {};
  if (given(value.line_pct)) {
    if (typeof value.line_pct !== "number" || !Number.isFinite(value.line_pct) || value.line_pct < 0 || value.line_pct > 100) throw new Error("export.line_pct must be a number from 0 to 100");
    position.line_pct = value.line_pct;
  }
  if (given(value.align)) {
    if (value.align !== "start" && value.align !== "center" && value.align !== "end") throw new Error("export.align must be start, center or end");
    position.align = value.align;
  }
  if (given(value.region_width_pct)) {
    if (typeof value.region_width_pct !== "number" || !Number.isFinite(value.region_width_pct) || value.region_width_pct <= 0 || value.region_width_pct > 100) throw new Error("export.region_width_pct must be a number above 0 and up to 100");
    position.region_width_pct = value.region_width_pct;
  }
  if (Object.keys(position).length) {
    out.position = position;
    out.has_position = true;
  }
  if (given(value.lang)) {
    if (typeof value.lang !== "string" || value.lang.length < 2 || value.lang.length > 35) throw new Error("export.lang must be a language tag of 2 to 35 characters");
    out.lang = value.lang;
  }
  return out;
}

function checkExportExtension(target: string, format: CaptionExportFormat) {
  const extension = path.extname(target).toLocaleLowerCase();
  const allowed = format === "ttml" ? [".ttml", ".xml"] : [`.${format}`];
  if (!allowed.includes(extension)) throw new Error(`export.output_path extension "${extension || "(none)"}" does not match format ${format}; use ${allowed.join(" or ")}`);
}

function readBackCount(format: CaptionExportFormat, text: string): number {
  return format === "ttml" ? countTtmlCues(text) : parseSubtitles(text, format).cues.length;
}

function clip<T>(items: T[]): { items: T[]; truncated: boolean } {
  return items.length > MAX_REPORTED_ITEMS ? { items: items.slice(0, MAX_REPORTED_ITEMS), truncated: true } : { items, truncated: false };
}

export function getCaptionPlanningTools() {
  return {
    plan_captions: {
      description:
        "Plan captions to a published standard (netflix_adult, netflix_kids, bbc, dcmp, social_9x16) from a transcript (word_timeline, text or file; SRT, VTT, ElevenLabs Scribe or Premiere transcript JSON): chunking, line breaks, timing, gaps, speakers, SDH. Optionally writes the plan JSON and an SRT/VTT/TTML file. cut_times come from detect_scene_edits / scene_edit_detection or sequence edit points. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          ...CAPTION_TRANSCRIPT_INPUT_PROPERTIES,
          ...CAPTION_PLAN_OPTION_PROPERTIES,
          sequence_timebase_ticks: TICKS_PROPERTY,
          plan_output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute .json path of a new file inside approved_workspace_path to save the plan document to (never overwrites). Host tools (create_caption_track action import_plan, add_caption_graphics) take it as plan_path. Required when the plan is too big to return inline (above 500 captions or 256 KiB) unless export.output_path is set." },
          export: EXPORT_PROPERTY,
        },
        required: [],
      },
      handler: async (rawArgs: Record<string, unknown>) => {
        try {
          const args = requireArgs(rawArgs);
          if (given(args.plan_path)) throw new Error("plan_captions builds a plan from a transcript; plan_path is not accepted (use check_captions to lint a saved plan)");
          if (!hasTranscriptInput(args)) throw new Error("Provide exactly one of word_timeline, transcript_text or transcript_path");
          const fps = frameRateFromArgs(args);
          const exportRequest = given(args.export) ? parseExportRequest(args.export) : undefined;
          const usesFiles = given(args.plan_output_path) || exportRequest?.output_path !== undefined;
          const hasWorkspace = given(args.approved_workspace_path);
          if (usesFiles && !hasWorkspace) throw new Error("approved_workspace_path is required with plan_output_path or export.output_path");
          if (!usesFiles && !given(args.transcript_path) && hasWorkspace) throw new Error("approved_workspace_path is only accepted together with transcript_path, plan_output_path or export.output_path");

          // Resolve and validate every output before any work, so a bad path writes nothing.
          let planTarget: string | undefined;
          if (given(args.plan_output_path)) {
            planTarget = resolveContainedOutputPath(args.approved_workspace_path, args.plan_output_path);
            if (path.extname(planTarget).toLocaleLowerCase() !== ".json") throw new Error("plan_output_path must end in .json");
          }
          let exportTarget: string | undefined;
          if (exportRequest?.output_path !== undefined) {
            exportTarget = resolveContainedOutputPath(args.approved_workspace_path, exportRequest.output_path);
            checkExportExtension(exportTarget, exportRequest.format);
          }
          if (planTarget && exportTarget && planTarget === exportTarget) throw new Error("plan_output_path and export.output_path must be different files");

          const planArgs: Record<string, unknown> = { ...args };
          for (const key of PLAN_OUTPUT_KEYS) if (key !== "approved_workspace_path") delete planArgs[key];
          if (fps !== undefined) planArgs.frame_rate = fps;
          const { plan, document, warnings: planWarnings } = resolveCaptionPlan(planArgs);
          const warnings = [...planWarnings];
          // Nothing is written unless the saved plan could be loaded again.
          if (planTarget) assertSavablePlanDocument(document);

          const captionsBytes = Buffer.byteLength(JSON.stringify(plan.captions), "utf8");
          const large = plan.captions.length > MAX_INLINE_PLAN_CAPTIONS || captionsBytes > MAX_INLINE_PLAN_BYTES;
          if (large && !planTarget && !exportTarget) {
            throw new Error(`the plan has ${plan.captions.length} captions (${captionsBytes} bytes), above the inline limit of ${MAX_INLINE_PLAN_CAPTIONS} captions or ${MAX_INLINE_PLAN_BYTES} bytes; pass plan_output_path (and approved_workspace_path) to save it to a file`);
          }

          // Export first (nothing is written until the text is built and sized).
          let exportResult: Record<string, unknown> | undefined;
          let exportText: string | undefined;
          if (exportRequest) {
            const cues = planToExportCues(plan, {
              ...(exportRequest.position ? { position: exportRequest.position } : {}),
              ...(isObject(args.speaker_names) ? { speaker_names: args.speaker_names as Record<string, string> } : {}),
            });
            const written = writeCaptions(exportRequest.format, cues, {
              ...(exportRequest.speaker_voice !== undefined ? { speaker_voice: exportRequest.speaker_voice } : {}),
              ...(exportRequest.lang !== undefined ? { lang: exportRequest.lang } : {}),
            });
            exportText = written.text;
            warnings.push(...written.warnings);
            if (exportRequest.format === "srt" && exportRequest.has_position) warnings.push("export: line_pct, align and region_width_pct only apply to vtt and ttml; the SRT has no positions.");
            const bytes = Buffer.byteLength(exportText, "utf8");
            if (!exportTarget && bytes > MAX_INLINE_ARTIFACT_BYTES) throw new Error(`the ${exportRequest.format} export is ${bytes} bytes, above the ${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit; pass export.output_path and approved_workspace_path to write it to a file`);
            let readBackText = exportText;
            if (exportTarget) {
              writeFileSync(exportTarget, exportText, { encoding: "utf8", flag: "wx" });
              readBackText = readFileSync(exportTarget, "utf8");
            }
            const readback = readBackCount(exportRequest.format, readBackText);
            const matches = readback === plan.captions.length;
            if (!matches) warnings.push(`export: the ${exportRequest.format} was read back with ${readback} cues but the plan has ${plan.captions.length}; check the file before importing it.`);
            exportResult = {
              format: exportRequest.format,
              bytes,
              sha256: sha256Hex(exportText),
              cue_count_expected: plan.captions.length,
              cue_count_readback: readback,
              readback_matches: matches,
              read_back_from: exportTarget ? "file" : "text",
              ...(exportTarget ? { path: exportTarget, written: true } : { inline: exportText, written: false }),
            };
          }

          let planPath: string | undefined;
          if (planTarget) planPath = writeCaptionPlanDocument(document, args.approved_workspace_path, planTarget);

          const changes = clip(plan.changes);
          const violations = clip(plan.violations);
          const captions = plan.captions;
          const last = captions.slice(Math.max(EDGE_CAPTIONS, captions.length - EDGE_CAPTIONS));
          const inlineCaptions = !large;
          const planned = planPath ?? "plan_output_path";
          return {
            success: true,
            data: {
              settings: plan.settings,
              counts: {
                captions: captions.length,
                changes: plan.changes.length,
                violations: plan.violations.length,
                warnings: warnings.length,
                sound_captions: captions.filter((c) => c.kind === "sound").length,
                lyric_captions: captions.filter((c) => c.kind === "lyric").length,
              },
              plan_revision: document.plan_revision,
              source: document.source,
              estimated_word_times: plan.estimated_word_times,
              changes: changes.items,
              changes_truncated: changes.truncated,
              violations: violations.items,
              violations_truncated: violations.truncated,
              cleanup: plan.cleanup ?? null,
              warnings,
              ...(inlineCaptions
                ? { captions, captions_inline: true }
                : { captions_inline: false, captions_first: captions.slice(0, EDGE_CAPTIONS), captions_last: last, captions_omitted: Math.max(0, captions.length - EDGE_CAPTIONS - last.length) }),
              ...(planPath ? { plan_path: planPath } : {}),
              ...(exportResult ? { export: exportResult } : {}),
              applied: false,
              routes: ["create_caption_track", "add_caption_graphics", "check_captions", "read_sequence_captions"],
              next_steps: [
                planPath
                  ? `Premiere caption track: call create_caption_track with action import_plan and plan_path ${planPath}.`
                  : "Rerun with plan_output_path and approved_workspace_path to save the plan; then create_caption_track (action import_plan) and add_caption_graphics take it as plan_path.",
                `Burned-in styled captions: call add_caption_graphics with plan_path ${planned === "plan_output_path" ? "(after saving the plan)" : planned}.`,
                "Call check_captions with plan_path (or the exported file) to lint the result against the standard; add cut_times and, for 9:16, safe_area to include shot changes and the safe area.",
                ...(plan.violations.length ? [`${plan.violations.length} rule${plan.violations.length === 1 ? "" : "s"} still broken; see violations, then edit the transcript text or loosen the options.`] : []),
              ],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    check_captions: {
      description:
        "Read-only caption QA against a published standard (default netflix_adult): reading speed, line length and count, durations, gaps, overlaps, line-break grammar, shot changes (cut_times) and an estimated safe area for 9:16. Input: file_path (.srt/.vtt), text, plan_path or cues (e.g. from read_sequence_captions). Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          file_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute path of a .srt or .vtt file inside approved_workspace_path (realpath-checked, at most 5 MiB). Requires approved_workspace_path. Provide exactly one of file_path, text, plan_path or cues." },
          text: { type: "string", maxLength: MAX_CHECK_CAPTIONS_BYTES, description: "SRT or WebVTT text (at most 5 MiB). Provide exactly one of file_path, text, plan_path or cues." },
          format: { type: "string", enum: ["srt", "vtt"], description: "Format of text or file_path. Default: from the file extension, else WEBVTT header means vtt, else srt." },
          plan_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute path of a saved caption plan (.json written by plan_captions) inside approved_workspace_path. Requires approved_workspace_path. Without standard, the plan's own standard is used. Provide exactly one of file_path, text, plan_path or cues." },
          cues: CUES_PROPERTY,
          approved_workspace_path: CAPTION_TRANSCRIPT_INPUT_PROPERTIES.approved_workspace_path,
          standard: { type: "string", enum: [...CAPTION_STANDARD_IDS], description: "The standard to check against: netflix_adult (default), netflix_kids, bbc, dcmp or social_9x16." },
          frame_rate: { type: "number", exclusiveMinimum: 0, maximum: 240, description: "Frames per second of the sequence, for the gap checks. Without it (and without sequence_timebase_ticks) it is inferred from the cue times and the result says frame_rate_inferred." },
          sequence_timebase_ticks: TICKS_PROPERTY,
          cut_times: { type: "array", maxItems: 5000, items: { type: "number", minimum: 0, description: "A shot change in sequence seconds." }, description: "Shot changes in sequence seconds, from detect_scene_edits / scene_edit_detection or the sequence's edit points. Captions that straddle or sit close to one are flagged." },
          max_issues: { type: "integer", minimum: 1, maximum: 500, description: "Most issues listed (default 200); counts always cover all of them and truncated says whether the list was cut." },
          safe_area: { type: "string", enum: Object.keys(CAPTION_SAFE_AREAS), description: "Estimate each cue's text box and flag cues outside this safe area. Needs frame and font_size_px. Default when those are given: reels_9_16 for a portrait frame, landscape_16_9 otherwise. Estimates, not measurements." },
          frame: {
            type: "object",
            additionalProperties: false,
            description: "Output frame in pixels, for the safe-area estimate.",
            properties: {
              width: { type: "integer", minimum: 16, maximum: 16384, description: "Frame width in pixels." },
              height: { type: "integer", minimum: 16, maximum: 16384, description: "Frame height in pixels." },
            },
            required: ["width", "height"],
          },
          font_size_px: { type: "number", exclusiveMinimum: 0, maximum: 2000, description: "Caption font size in pixels at that frame, for the safe-area estimate." },
          char_width_ratio: { type: "number", exclusiveMinimum: 0, maximum: 2, description: `Average glyph width as a share of the font size (default ${DEFAULT_CHAR_WIDTH_RATIO}; about 0.45 for a condensed face, 0.65 for a wide one).` },
          baseline_y_pct: { type: "number", minimum: 0, maximum: 100, description: "Where the last line's baseline sits, percent of the frame height. Default: the bottom of the safe area's caption band." },
        },
        required: [],
      },
      handler: async (rawArgs: Record<string, unknown>) => {
        try {
          const args = requireArgs(rawArgs);
          const inputs = ["file_path", "text", "plan_path", "cues"].filter((key) => given(args[key]));
          if (inputs.length !== 1) throw new Error("Provide exactly one of file_path, text, plan_path or cues");
          const needsWorkspace = given(args.file_path) || given(args.plan_path);
          if (needsWorkspace && !given(args.approved_workspace_path)) throw new Error("approved_workspace_path is required with file_path or plan_path");
          if (!needsWorkspace && given(args.approved_workspace_path)) throw new Error("approved_workspace_path is only accepted together with file_path or plan_path");
          if (given(args.format) && args.format !== "srt" && args.format !== "vtt") throw new Error("format must be srt or vtt");
          if (given(args.format) && (given(args.plan_path) || given(args.cues))) throw new Error("format only applies to text or file_path");
          let standard: CaptionStandardId | undefined;
          if (given(args.standard)) {
            if (typeof args.standard !== "string" || !(CAPTION_STANDARD_IDS as readonly string[]).includes(args.standard)) throw new Error(`standard must be one of: ${CAPTION_STANDARD_IDS.join(", ")}`);
            standard = args.standard as CaptionStandardId;
          }
          let maxIssues: number | undefined;
          if (given(args.max_issues)) {
            if (typeof args.max_issues !== "number" || !Number.isInteger(args.max_issues) || args.max_issues < 1 || args.max_issues > 500) throw new Error("max_issues must be an integer from 1 to 500");
            maxIssues = args.max_issues;
          }
          let cutTimes: number[] | undefined;
          if (given(args.cut_times)) {
            if (!Array.isArray(args.cut_times) || args.cut_times.length > 5000) throw new Error("cut_times must be an array of at most 5000 numbers");
            args.cut_times.forEach((t, i) => {
              if (typeof t !== "number" || !Number.isFinite(t) || t < 0) throw new Error(`cut_times[${i}] must be a number of seconds, 0 or more`);
            });
            cutTimes = args.cut_times as number[];
          }
          let fps = frameRateFromArgs(args);

          const warnings: string[] = [];
          let cues: QaCue[];
          let source: Record<string, unknown>;
          if (given(args.cues)) {
            if (!Array.isArray(args.cues) || args.cues.length < 1 || args.cues.length > MAX_CHECK_CUES) throw new Error(`cues must hold between 1 and ${MAX_CHECK_CUES} entries`);
            cues = args.cues.map((raw, i) => {
              if (!isObject(raw)) throw new Error(`cues[${i}] must be an object`);
              const { start_seconds: start, end_seconds: end, text } = raw;
              if (typeof start !== "number" || !Number.isFinite(start) || start < 0) throw new Error(`cues[${i}].start_seconds must be a number of seconds, 0 or more`);
              if (typeof end !== "number" || !Number.isFinite(end) || end < 0) throw new Error(`cues[${i}].end_seconds must be a number of seconds, 0 or more`);
              if (typeof text !== "string" || text.length > 2000) throw new Error(`cues[${i}].text must be a string of at most 2000 characters`);
              return { n: i + 1, start, end, lines: text.split(/\r?\n/) };
            });
            source = { kind: "cues", cue_count: cues.length };
          } else if (given(args.plan_path)) {
            const resolved = resolveCaptionPlan({ plan_path: args.plan_path, approved_workspace_path: args.approved_workspace_path });
            warnings.push(...resolved.warnings);
            cues = resolved.plan.captions.map((c) => ({ n: c.n, start: c.start, end: c.end, lines: c.lines.slice() }));
            if (!cues.length) throw new Error("the plan has no captions to check");
            if (fps === undefined && !resolved.plan.settings.frame_rate_assumed) fps = resolved.plan.settings.frame_rate;
            standard ??= resolved.plan.settings.standard;
            source = { kind: "plan", plan_revision: resolved.document.plan_revision, cue_count: cues.length };
          } else {
            let text: string;
            let format = args.format as "srt" | "vtt" | undefined;
            if (given(args.file_path)) {
              const resolved = resolveContainedInputPath(args.approved_workspace_path, args.file_path, MAX_CHECK_CAPTIONS_BYTES);
              const extension = path.extname(resolved).toLocaleLowerCase();
              if (extension !== ".srt" && extension !== ".vtt") throw new Error("file_path must end in .srt or .vtt");
              format ??= extension === ".srt" ? "srt" : "vtt";
              text = readFileSync(resolved, "utf8");
              source = { kind: "file", path: resolved };
            } else {
              if (typeof args.text !== "string" || !args.text.trim()) throw new Error("text must be a non-empty string");
              if (Buffer.byteLength(args.text, "utf8") > MAX_CHECK_CAPTIONS_BYTES) throw new Error(`text is above the ${MAX_CHECK_CAPTIONS_BYTES}-byte limit`);
              text = args.text;
              source = { kind: "text" };
            }
            format ??= detectSubtitleFormat(text.replace(/^﻿/, ""));
            const parsed = parseSubtitles(text, format);
            if (!parsed.cues.length) throw new Error("no readable cues were found in the caption text");
            if (parsed.cues.length > MAX_CHECK_CUES) throw new Error(`the file has ${parsed.cues.length} cues, above the limit of ${MAX_CHECK_CUES}`);
            warnings.push(...parsed.warnings);
            cues = parsed.cues.map((c) => ({ n: c.n, start: c.start, end: c.end, lines: c.lines }));
            source = { ...source, format: parsed.format, cue_count: cues.length };
          }

          // Safe-zone estimate: needs a frame and a font size.
          const wantsSafeZone = given(args.safe_area) || given(args.frame) || given(args.font_size_px) || given(args.char_width_ratio) || given(args.baseline_y_pct);
          let safeZone: Record<string, unknown> | undefined;
          let safeBox: ReturnType<typeof safeBoxPx> | undefined;
          if (wantsSafeZone) {
            const frame = args.frame;
            if (!isObject(frame)) throw new Error("frame {width, height} is required for the safe-area estimate");
            const width = frame.width;
            const height = frame.height;
            if (typeof width !== "number" || !Number.isInteger(width) || width < 16 || width > 16384) throw new Error("frame.width must be an integer from 16 to 16384");
            if (typeof height !== "number" || !Number.isInteger(height) || height < 16 || height > 16384) throw new Error("frame.height must be an integer from 16 to 16384");
            const fontSize = args.font_size_px;
            if (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 2000) throw new Error("font_size_px is required for the safe-area estimate (a number above 0, at most 2000)");
            let ratio = DEFAULT_CHAR_WIDTH_RATIO;
            if (given(args.char_width_ratio)) {
              if (typeof args.char_width_ratio !== "number" || !Number.isFinite(args.char_width_ratio) || args.char_width_ratio <= 0 || args.char_width_ratio > 2) throw new Error("char_width_ratio must be a number above 0, at most 2");
              ratio = args.char_width_ratio;
            }
            let area: CaptionSafeArea;
            if (given(args.safe_area)) {
              if (typeof args.safe_area !== "string" || !Object.prototype.hasOwnProperty.call(CAPTION_SAFE_AREAS, args.safe_area)) throw new Error(`safe_area must be one of: ${Object.keys(CAPTION_SAFE_AREAS).join(", ")}`);
              area = CAPTION_SAFE_AREAS[args.safe_area as keyof typeof CAPTION_SAFE_AREAS];
            } else {
              area = defaultSafeArea(width, height);
            }
            let baseline = (area.caption_band?.bottom ?? area.bottom) * height;
            if (given(args.baseline_y_pct)) {
              if (typeof args.baseline_y_pct !== "number" || !Number.isFinite(args.baseline_y_pct) || args.baseline_y_pct < 0 || args.baseline_y_pct > 100) throw new Error("baseline_y_pct must be a number from 0 to 100");
              baseline = (args.baseline_y_pct / 100) * height;
            }
            safeBox = safeBoxPx(area, width, height);
            const metrics = { font_size_px: fontSize, char_width_ratio: ratio };
            for (const cue of cues) {
              const box = estimateTextBox(cue.lines.filter((l) => l.trim().length > 0), { x: width / 2, baseline_y: baseline }, metrics, "center");
              cue.text_box = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
            }
            safeZone = {
              method: "estimated",
              safe_area: area.id,
              label: area.label,
              approximate: area.approximate,
              box_px: { left: round3(safeBox.left), top: round3(safeBox.top), right: round3(safeBox.right), bottom: round3(safeBox.bottom) },
              frame: { width, height },
              font_size_px: fontSize,
              char_width_ratio: ratio,
              baseline_y_px: round3(baseline),
              note: "Text boxes are estimated from character counts, centred on the frame; descenders may hang below the bottom edge. Verify with a burn-in export or playback.",
            };
          }

          const report = lintCaptions(cues, {
            ...(standard ? { standard } : {}),
            ...(fps !== undefined ? { frame_rate: fps } : {}),
            ...(cutTimes ? { cut_times: cutTimes } : {}),
            ...(maxIssues !== undefined ? { max_issues: maxIssues } : {}),
            ...(safeBox ? { safe_area: safeBox } : {}),
          });
          const standardSummary = describeCaptionStandards().find((entry) => entry.id === report.standard);
          return {
            success: true,
            data: {
              ...report,
              warnings: [...warnings, ...report.warnings],
              standard_summary: standardSummary,
              source,
              ...(safeZone ? { safe_zone: safeZone } : {}),
              applied: false,
              routes: ["plan_captions", "read_sequence_captions", "detect_scene_edits", "check_caption_safe_zone"],
              next_steps: report.pass
                ? ["No errors. Warnings (grammar, shot changes, short gaps) are guidance; fix the ones you agree with."]
                : [
                    "Rebuild with plan_captions and the same standard (it fixes timing, gaps and breaks), or edit the cues named in issues.",
                    "Pass cut_times from detect_scene_edits to include shot changes, and frame_rate or sequence_timebase_ticks for exact gap checks.",
                  ],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
