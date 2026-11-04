import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCaptionArtifact,
  CAPTION_AUTHORING_ROUTES,
  CAPTION_GRAPHIC_UPGRADE_GUIDANCE,
  CAPTION_RENDER_VERIFICATION_GUIDANCE,
  CAPTION_SHADOW_DEFAULTS,
  CAPTION_STROKE_PLACEMENTS,
  CAPTION_STYLE_PRESETS,
  CAPTION_TRACK_STYLE_GUIDANCE,
  CAPTION_ZONES,
  buildCustomCaptionStyleSteps,
  buildKeywordHighlightSteps,
  buildPresetCaptionStyleSteps,
  captionSafeZoneRecommendation,
  checkCaptionSafeZone,
  CUSTOM_CAPTION_STYLE_LIMITS,
  customCaptionStyleWarnings,
  DEFAULT_TRACK_STYLE_NAME,
  describeCaptionStyle,
  MAX_CAPTION_STROKES,
  MAX_HIGHLIGHT_WORDS,
  validateCustomCaptionStyle,
  validateKeywordHighlight,
  type CaptionStylePreset,
  MAX_EMPHASIS_WORDS,
  MAX_FILLER_TOKENS,
  MAX_FRAME_DIMENSION,
  MAX_SAFE_ZONE_ELEMENTS,
  MIN_FRAME_DIMENSION,
  SAFE_ZONE_ELEMENT_KINDS,
  SAFE_ZONE_PLATFORMS,
  SAFE_ZONE_ROUTES,
} from "../ai/caption-authoring.js";
import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";
import {
  MAX_CUE_TEXT_CHARACTERS,
  MAX_RETIME_FPS,
  MAX_RETIME_RANGES,
  MAX_RETIME_SECONDS,
  MIN_RETIME_FPS,
  RETIME_OPERATIONS,
  RETIME_STRADDLE_POLICIES,
  contentDigest,
  parseCaptionFile,
  retimeCaptionBlocks,
  serializeCaptionFile,
  type CaptionFileFormat,
  type RetimeRequest,
} from "../ai/caption-retime.js";
import { MAX_CAPTION_ARTIFACT_CHARACTERS } from "../ai/caption-timing.js";

export const MAX_INLINE_ARTIFACT_BYTES = 512 * 1024;
const MAX_PATH_LENGTH = 4096;
// Burn-in check: save the marks, set a short range, export it, restore the marks.
const CAPTION_STYLE_VERIFY_ROUTES = ["get_sequence_in_out_points", "set_sequence_in_out_points", "export_sequence", "clear_sequence_in_out"] as const;
// Still-frame review exports omit caption tracks, so caption guidance never routes to them.
const CAPTION_STILL_FRAME_ROUTES: readonly string[] = ["export_sequence_review_frames"];

const HEX_COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";
const LIMITS = CUSTOM_CAPTION_STYLE_LIMITS;
const shadowNumber = (key: keyof typeof LIMITS.shadow, label: string) => ({
  type: "number",
  minimum: LIMITS.shadow[key].min,
  maximum: LIMITS.shadow[key].max,
  description: `${label} (default ${CAPTION_SHADOW_DEFAULTS[key]}).`,
});

const CUSTOM_STYLE_PARAMETER = {
  type: "object",
  additionalProperties: false,
  description: "Optional caption look to translate into concrete Premiere UI steps. Every field is optional; at least one is required. Values are documentation only and are never applied.",
  properties: {
    font_family: { type: "string", minLength: 1, maxLength: LIMITS.font_family_max_length, description: "Font family name as shown in Premiere, e.g. Source Han Sans TW." },
    font_weight: { type: "string", minLength: 1, maxLength: LIMITS.font_weight_max_length, description: "Font weight or style name, e.g. Heavy or Bold." },
    font_size_px: { type: "integer", minimum: LIMITS.font_size_px.min, maximum: LIMITS.font_size_px.max, description: "Font size in Premiere's caption units (pixels)." },
    fill_color: { type: "string", pattern: HEX_COLOR_PATTERN, description: "Text fill colour as #RRGGBB." },
    strokes: {
      type: "array",
      maxItems: MAX_CAPTION_STROKES,
      description: "Up to three strokes in Premiere's Stroke list order; each stroke after the first is added with + next to Stroke. Layered outer strokes need increasing widths.",
      items: {
        type: "object",
        additionalProperties: false,
        description: "One stroke.",
        properties: {
          color: { type: "string", pattern: HEX_COLOR_PATTERN, description: "Stroke colour as #RRGGBB." },
          width_px: { type: "number", minimum: LIMITS.stroke_width_px.min, maximum: LIMITS.stroke_width_px.max, description: "Stroke width." },
          placement: { type: "string", enum: [...CAPTION_STROKE_PLACEMENTS], description: "Stroke placement (default outer)." },
        },
        required: ["color", "width_px"],
      },
    },
    shadow: {
      type: "object",
      additionalProperties: false,
      description: "Drop shadow; omitted fields use the listed defaults.",
      properties: {
        color: { type: "string", pattern: HEX_COLOR_PATTERN, description: `Shadow colour as #RRGGBB (default ${CAPTION_SHADOW_DEFAULTS.color}).` },
        opacity: shadowNumber("opacity", "Shadow opacity percent"),
        angle: shadowNumber("angle", "Shadow angle in degrees"),
        distance: shadowNumber("distance", "Shadow distance"),
        size: shadowNumber("size", "Shadow size"),
        blur: shadowNumber("blur", "Shadow blur"),
      },
    },
    zone: { type: "string", enum: [...CAPTION_ZONES], description: "Caption region in Premiere's Align and Transform zone grid." },
    offset_x_px: { type: "integer", minimum: LIMITS.offset_px.min, maximum: LIMITS.offset_px.max, description: "Horizontal position offset from the zone in pixels." },
    offset_y_px: { type: "integer", minimum: LIMITS.offset_px.min, maximum: LIMITS.offset_px.max, description: "Vertical position offset from the zone in pixels; negative moves up." },
    track_style_name: { type: "string", minLength: 1, maxLength: LIMITS.track_style_name_max_length, description: `Name for the saved Track Style (default ${DEFAULT_TRACK_STYLE_NAME}).` },
  },
} as const;

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_PATH_LENGTH) throw new Error(`${label} must be a non-empty string of at most ${MAX_PATH_LENGTH} characters`);
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed)) throw new Error(`${label} must be an absolute path`);
  return trimmed;
}

/**
 * Resolves `output_path` to a writable location contained inside the approved
 * workspace. Containment is checked on the realpath of the parent directory so
 * symlinks cannot escape the workspace; the file itself must not exist yet.
 */
export function resolveContainedOutputPath(workspace: unknown, output: unknown): string {
  const workspacePath = absolutePath(workspace, "approved_workspace_path");
  const outputPath = absolutePath(output, "output_path");
  const base = path.basename(outputPath);
  if (!base || base === "." || base === "..") throw new Error("output_path must name a file");
  let root: string;
  try {
    root = realpathSync(workspacePath);
  } catch {
    throw new Error("approved_workspace_path must be an existing directory");
  }
  if (!statSync(root).isDirectory()) throw new Error("approved_workspace_path must be an existing directory");
  let parent: string;
  try {
    parent = realpathSync(path.dirname(outputPath));
  } catch {
    throw new Error("output_path parent directory must already exist inside approved_workspace_path");
  }
  if (!statSync(parent).isDirectory()) throw new Error("output_path parent must be a directory");
  const relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("output_path must be contained within approved_workspace_path");
  const resolved = path.join(parent, base);
  if (existsSync(resolved)) throw new Error(`output_path already exists and will not be overwritten: ${resolved}`);
  return resolved;
}

/** Largest caption file read from input_path (bytes). */
export const MAX_CAPTION_INPUT_BYTES = 2 * 1024 * 1024;

/**
 * Resolves an existing caption file contained inside the approved workspace.
 * Containment is checked on the realpath of the file itself, so a symlink that
 * points outside the workspace is refused.
 */
export function resolveContainedInputPath(workspace: unknown, input: unknown): string {
  const workspacePath = absolutePath(workspace, "approved_workspace_path");
  const inputPath = absolutePath(input, "input_path");
  let root: string;
  try {
    root = realpathSync(workspacePath);
  } catch {
    throw new Error("approved_workspace_path must be an existing directory");
  }
  if (!statSync(root).isDirectory()) throw new Error("approved_workspace_path must be an existing directory");
  let resolved: string;
  try {
    resolved = realpathSync(inputPath);
  } catch {
    throw new Error(`input_path does not exist: ${inputPath}`);
  }
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("input_path must be contained within approved_workspace_path");
  const stats = statSync(resolved);
  if (!stats.isFile()) throw new Error("input_path must be a regular file");
  if (stats.size > MAX_CAPTION_INPUT_BYTES) throw new Error(`input_path is ${stats.size} bytes, above the ${MAX_CAPTION_INPUT_BYTES}-byte caption file limit`);
  return resolved;
}

function captionExtension(file: string, label: string): CaptionFileFormat {
  const extension = path.extname(file).toLocaleLowerCase();
  if (extension === ".srt") return "srt";
  if (extension === ".vtt") return "vtt";
  throw new Error(`${label} must end in .srt or .vtt`);
}

const RETIME_REQUEST_KEYS = [
  "operation", "fps", "offset_seconds", "offset_frames", "from_seconds", "ranges", "at_seconds",
  "duration_seconds", "duration_frames", "straddle_policy", "cue_index", "text", "start_seconds", "end_seconds",
] as const;

export function getCaptionAuthoringTools() {
  return {
    build_caption_artifact: {
      description:
        "Build a CapCut/Submagic-style SRT or VTT caption artifact from a caller-supplied word timeline: balanced word groups, sentence-aware breaks, min/max cue durations, optional karaoke word timestamps (VTT), emphasis and speaker markup. Local-only; returns the artifact inline or writes it inside an approved workspace and never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          format: { type: "string", enum: ["srt", "vtt"], description: "Artifact format. SRT uses HH:MM:SS,mmm; VTT starts with WEBVTT and uses HH:MM:SS.mmm." },
          words_per_cue: { type: "integer", minimum: 1, maximum: 12, description: "Target words per cue (default 4); sentences are split into balanced groups of at most this many words." },
          max_chars_per_line: { type: "integer", minimum: 8, maximum: 80, description: "Maximum characters per line of plain caption text (default 32); words are never split. Wrapping counts unescaped words only, so VTT escaping, karaoke timestamps, emphasis tags, and speaker prefixes can make the rendered line longer." },
          max_lines: { type: "integer", minimum: 1, maximum: 3, description: "Maximum lines of plain caption text per cue (default 1); markup does not add lines." },
          min_cue_seconds: { type: "number", minimum: 0.2, maximum: 5, description: "Minimum cue duration (default 0.5); short cues are extended but never past the next cue start." },
          max_cue_seconds: { type: "number", minimum: 0.5, maximum: 15, description: "Maximum cue duration (default 5)." },
          merge_gap_seconds: { type: "number", minimum: 0, maximum: 5, description: "Extend a cue to the next cue start when the gap is smaller than this (default 0.3) so captions do not flicker." },
          karaoke: { type: "boolean", description: "VTT only: emit per-word <HH:MM:SS.mmm> timestamps inside each cue for word-highlight styles. Errors for SRT." },
          emphasis_words: { type: "array", maxItems: MAX_EMPHASIS_WORDS, items: { type: "string", minLength: 1, maxLength: 64, description: "Word to emphasize (case-insensitive, punctuation ignored)." }, description: "Words wrapped in <b> (SRT) or <c.emphasis> (VTT)." },
          speaker_prefix: { type: "boolean", description: "Prefix cues with the speaker label when present: 'Speaker: ' in SRT, <v Speaker> in VTT." },
          strip_fillers: { type: "array", maxItems: MAX_FILLER_TOKENS, items: { type: "string", minLength: 1, maxLength: 64, description: "Filler token to drop, e.g. um, uh." }, description: "Tokens removed from the caption text (case-insensitive, punctuation ignored)." },
          uppercase: { type: "boolean", description: "Render caption text in upper case." },
          style_preset: { type: "string", enum: [...CAPTION_STYLE_PRESETS], description: "Style descriptor to return with the artifact (default clean). Documentation only; not encoded in SRT/VTT." },
          output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Optional absolute file path to write the artifact to. Requires approved_workspace_path; the file must not already exist. When omitted the artifact text is returned inline (up to 512 KiB)." },
          approved_workspace_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute existing directory that must contain output_path (checked via realpath of the parent directory). Required with output_path." },
        },
        required: ["word_timeline", "format"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          const hasOutput = args.output_path !== undefined;
          if (hasOutput && args.approved_workspace_path === undefined) throw new Error("approved_workspace_path is required when output_path is provided");
          if (!hasOutput && args.approved_workspace_path !== undefined) throw new Error("approved_workspace_path is only accepted together with output_path");
          const target = hasOutput ? resolveContainedOutputPath(args.approved_workspace_path, args.output_path) : null;
          const { word_timeline, output_path: _output, approved_workspace_path: _workspace, ...rest } = args;
          const result = buildCaptionArtifact({ ...rest, word_timeline });
          const warnings = [...result.warnings];
          const bytes = Buffer.byteLength(result.artifact_text, "utf8");
          let artifact: string | { path: string; bytes: number; sha256: string };
          if (target) {
            const extension = path.extname(target).toLocaleLowerCase();
            if (extension !== `.${result.format}`) warnings.push(`output_path extension "${extension || "(none)"}" does not match format ${result.format}`);
            writeFileSync(target, result.artifact_text, { encoding: "utf8", flag: "wx" });
            artifact = { path: target, bytes, sha256: createHash("sha256").update(result.artifact_text, "utf8").digest("hex") };
          } else {
            if (bytes > MAX_INLINE_ARTIFACT_BYTES) throw new Error(`caption artifact is ${bytes} bytes, above the ${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit; pass output_path and approved_workspace_path to write it to a file`);
            artifact = result.artifact_text;
          }
          return {
            success: true,
            data: {
              format: result.format,
              cue_count: result.cue_count,
              artifact,
              artifact_bytes: bytes,
              cues: result.cues,
              style: result.style,
              options: result.options,
              warnings,
              assumptions: result.assumptions,
              applied: false,
              plan_revision: result.plan_revision,
              evidence: result.evidence,
              routes: [...CAPTION_AUTHORING_ROUTES],
              next_steps: [
                target ? `Import ${target} into the Premiere project, then call create_caption_track with action import and the imported item_id.` : "Save the inline artifact text to a .srt or .vtt file (or rerun with output_path), import it into the project, then call create_caption_track with action import.",
                "Call read_sequence_captions or inspect_caption_tracks_uxp to confirm the caption track structure after import.",
              ],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    check_caption_safe_zone: {
      description:
        "Check caption, title, logo, and graphic rectangles against approximate platform UI overlay zones (TikTok, Reels, Shorts, feed, YouTube, LinkedIn, X) and suggest the nearest clear position. Local-only geometry on caller-supplied normalized rects; it never reads or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          platform: { type: "string", enum: [...SAFE_ZONE_PLATFORMS], description: "Target platform whose UI overlays are checked." },
          frame: {
            type: "object",
            additionalProperties: false,
            description: "Output frame size in pixels; used for orientation checks and pixel readback.",
            properties: {
              width: { type: "integer", minimum: MIN_FRAME_DIMENSION, maximum: MAX_FRAME_DIMENSION, description: "Frame width in pixels." },
              height: { type: "integer", minimum: MIN_FRAME_DIMENSION, maximum: MAX_FRAME_DIMENSION, description: "Frame height in pixels." },
            },
            required: ["width", "height"],
          },
          elements: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SAFE_ZONE_ELEMENTS,
            description: "On-screen rectangles normalized to the frame (0..1), with x,y at the top-left corner.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", minLength: 1, maxLength: 128, description: "Caller-stable element ID." },
                x: { type: "number", minimum: 0, maximum: 1, description: "Left edge as a fraction of frame width." },
                y: { type: "number", minimum: 0, maximum: 1, description: "Top edge as a fraction of frame height." },
                width: { type: "number", exclusiveMinimum: 0, maximum: 1, description: "Width as a fraction of frame width." },
                height: { type: "number", exclusiveMinimum: 0, maximum: 1, description: "Height as a fraction of frame height." },
                kind: { type: "string", enum: [...SAFE_ZONE_ELEMENT_KINDS], description: "Element kind." },
              },
              required: ["id", "x", "y", "width", "height", "kind"],
            },
          },
        },
        required: ["platform", "frame", "elements"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          const report = checkCaptionSafeZone({ platform: args.platform, frame: args.frame, elements: args.elements });
          return {
            success: true,
            data: {
              ...report,
              applied: false,
              routes: [...SAFE_ZONE_ROUTES],
              next_steps: [
                "Move unsafe elements with set_clip_position or transform_track_item_uxp using the suggested_position values (normalized top-left).",
                "Export review frames with export_sequence_review_frames and compare against the current platform overlay guide before delivery.",
              ],
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    get_caption_style_guidance: {
      description:
        "Read-only caption style guidance: a preset and/or custom_style turned into Premiere 2024+ Properties-panel Track Style steps, plus keyword_highlight per-word steps, manual Upgrade Caption to Graphic steps, and render-verification routes. NEVER modifies captions: Premiere has no caption style, per-word, or upgrade API.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        required: [],
        properties: {
          preset: { type: "string", enum: [...CAPTION_STYLE_PRESETS], description: "Style preset to describe (default clean when custom_style is omitted)." },
          custom_style: CUSTOM_STYLE_PARAMETER,
          keyword_highlight: {
            type: "object",
            additionalProperties: false,
            description: "Optional words to colour inside captions. Returns manual Program Monitor steps; nothing is applied, because Premiere has no per-word caption styling API.",
            properties: {
              words: {
                type: "array",
                minItems: 1,
                maxItems: MAX_HIGHLIGHT_WORDS,
                items: { type: "string", minLength: 1, maxLength: 64, description: "Keyword exactly as it appears in the captions (case-insensitive duplicates are dropped)." },
                description: `Keywords to highlight, at most ${MAX_HIGHLIGHT_WORDS}.`,
              },
              color: { type: "string", pattern: HEX_COLOR_PATTERN, description: "Highlight fill colour as #RRGGBB." },
            },
            required: ["words", "color"],
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          if (args.preset !== undefined && (typeof args.preset !== "string" || !(CAPTION_STYLE_PRESETS as readonly string[]).includes(args.preset))) {
            throw new Error(`preset must be one of: ${CAPTION_STYLE_PRESETS.join(", ")}`);
          }
          const custom = args.custom_style === undefined ? undefined : validateCustomCaptionStyle(args.custom_style);
          const highlight = args.keyword_highlight === undefined ? undefined : validateKeywordHighlight(args.keyword_highlight);
          const preset = (args.preset ?? (custom ? undefined : "clean")) as CaptionStylePreset | undefined;
          const presetStyle = preset ? describeCaptionStyle(preset) : undefined;
          const style = custom
            ? { ...(presetStyle ?? { preset: null }), custom_style: custom, source: presetStyle ? "preset_with_custom_style" : "custom_style" }
            : presetStyle!;
          const premiereUiSteps = custom ? buildCustomCaptionStyleSteps(custom, preset) : buildPresetCaptionStyleSteps(presetStyle!);
          return {
            success: true,
            data: {
              style,
              workflow: [
                "Step 1: Generate caption SRT/VTT with build_caption_artifact (timing/text only)",
                "Step 2: Import the caption file into Premiere project",
                "Step 3: Call create_caption_track with action:import and the imported item_id",
                "Step 4: Inspect the track with read_sequence_captions or inspect_caption_tracks_uxp",
                "Step 5: Style one caption in Premiere's Properties panel and save it as a Track Style (premiere_ui_steps); it applies to the whole caption track",
                ...(highlight ? ["Step 6: Colour the keywords by hand in the Program Monitor (keyword_highlight_steps)"] : []),
                `Optional: for editable graphic clips, run ${CAPTION_GRAPHIC_UPGRADE_GUIDANCE.menu_path} in Premiere (graphic_upgrade); the MCP cannot run it`,
                "Verify with playback or a short burn-in export (render_verification); still-frame exports can omit caption tracks",
              ],
              premiere_ui_steps: premiereUiSteps,
              ...(highlight ? { keyword_highlight: highlight, keyword_highlight_steps: buildKeywordHighlightSteps(highlight) } : {}),
              track_style: {
                name: custom?.track_style_name ?? (custom ? DEFAULT_TRACK_STYLE_NAME : `${preset} captions`),
                scope: CAPTION_TRACK_STYLE_GUIDANCE.scope,
                reusable: CAPTION_TRACK_STYLE_GUIDANCE.reusable,
                project_item: CAPTION_TRACK_STYLE_GUIDANCE.project_item,
              },
              limitations: [...CAPTION_TRACK_STYLE_GUIDANCE.limitations],
              warnings: custom ? customCaptionStyleWarnings(custom) : [],
              graphic_upgrade: {
                menu_path: CAPTION_GRAPHIC_UPGRADE_GUIDANCE.menu_path,
                available_through_mcp: CAPTION_GRAPHIC_UPGRADE_GUIDANCE.available_through_mcp,
                steps: [...CAPTION_GRAPHIC_UPGRADE_GUIDANCE.steps],
                limitations: [...CAPTION_GRAPHIC_UPGRADE_GUIDANCE.limitations],
              },
              render_verification: { ...CAPTION_RENDER_VERIFICATION_GUIDANCE },
              applied: false,
              mutation_refused: "This tool provides guidance only. MCP for Adobe Premiere Pro does not expose a CaptionTrack style mutation API because Premiere does not expose one through documented ExtendScript, QE DOM, or UXP surfaces. Apply caption styles manually in Premiere's Properties panel (or Essential Graphics) and save them as a Track Style. Per-word colour and Upgrade Caption to Graphic are also manual.",
              safe_zones: presetStyle?.safe_zone_recommendation ?? captionSafeZoneRecommendation(),
              routes: [...new Set<string>([...CAPTION_AUTHORING_ROUTES, ...SAFE_ZONE_ROUTES, ...CAPTION_STYLE_VERIFY_ROUTES])].filter((route) => !CAPTION_STILL_FRAME_ROUTES.includes(route)),
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    retime_caption_file: {
      description:
        "Retime a local SRT/VTT file after ripple edits; Premiere captions do not follow ripple_remove_timeline_ranges or insert_from_source. Operations: shift, ripple_remove_ranges, ripple_insert, edit_cue. Keeps VTT header/NOTE/STYLE, cue settings, karaoke stamps; renumbers SRT. Local-only, never changes Premiere: re-import via create_caption_track, then reapply styling (get_caption_style_guidance).",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          operation: { type: "string", enum: [...RETIME_OPERATIONS], description: "shift, ripple_remove_ranges, ripple_insert, or edit_cue." },
          input_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: `Absolute path of an existing .srt or .vtt file inside approved_workspace_path (realpath-checked, at most ${MAX_CAPTION_INPUT_BYTES} bytes). Provide exactly one of input_path or content.` },
          content: { type: "string", minLength: 1, maxLength: MAX_CAPTION_ARTIFACT_CHARACTERS, description: "Inline SRT or VTT text. Provide exactly one of input_path or content. A UTF-8 BOM and CRLF line endings are accepted." },
          input_format: { type: "string", enum: ["srt", "vtt"], description: "Syntax of the input. Defaults to the input_path extension, else VTT when content starts with WEBVTT, else SRT." },
          output_format: { type: "string", enum: ["srt", "vtt"], description: "Format of the result (default: the output_path extension, else the input format). SRT output drops VTT header/NOTE/STYLE/REGION blocks, cue settings, identifiers, and karaoke timestamps, with warnings." },
          output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Optional absolute .srt/.vtt path to write the result to. Requires approved_workspace_path; the parent must exist inside it and the file must not already exist (never overwritten)." },
          approved_workspace_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute existing directory that must contain input_path and output_path. Required when either path is given." },
          return_content: { type: "boolean", description: "Also return the retimed text inline when output_path is set (default false). Inline text is always returned without output_path, up to 512 KiB." },
          fps: { type: "number", minimum: MIN_RETIME_FPS, maximum: MAX_RETIME_FPS, description: "Optional sequence frame rate (e.g. 23.976, 25, 29.97). When set, every output time and every removal range snaps to the nearest frame, matching ripple_remove_timeline_ranges; otherwise times round to milliseconds. Required for offset_frames and duration_frames." },
          offset_seconds: { type: "number", minimum: -MAX_RETIME_SECONDS, maximum: MAX_RETIME_SECONDS, description: "shift: seconds to add (negative moves earlier). Cues ending at or before 0 are removed; cues crossing 0 are trimmed. Use exactly one of offset_seconds or offset_frames." },
          offset_frames: { type: "integer", description: "shift: whole frames to add at fps (negative moves earlier)." },
          from_seconds: { type: "number", minimum: 0, maximum: MAX_RETIME_SECONDS, description: "shift: only shift cues whose start is at or after this time; earlier cues stay put." },
          ranges: {
            type: "array",
            minItems: 1,
            maxItems: MAX_RETIME_RANGES,
            description: "ripple_remove_ranges: removed timeline ranges in seconds, sorted and non-overlapping (the same ranges passed to ripple_remove_timeline_ranges; overlapping ranges are rejected, not merged).",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["start", "end"],
              properties: {
                start: { type: "number", minimum: 0, description: "Range start in seconds." },
                end: { type: "number", minimum: 0, description: "Range end in seconds; must be greater than start." },
              },
            },
          },
          at_seconds: { type: "number", minimum: 0, maximum: MAX_RETIME_SECONDS, description: "ripple_insert: timeline time of the insert; cues starting at or after it move right." },
          duration_seconds: { type: "number", minimum: 0, maximum: MAX_RETIME_SECONDS, description: "ripple_insert: inserted duration in seconds. Use exactly one of duration_seconds or duration_frames." },
          duration_frames: { type: "integer", minimum: 1, description: "ripple_insert: inserted duration in whole frames at fps." },
          straddle_policy: { type: "string", enum: [...RETIME_STRADDLE_POLICIES], description: "ripple_insert: a cue spanning at_seconds is split into two cues around the gap (split, default) or stretched across it (extend)." },
          cue_index: { type: "integer", minimum: 1, description: "edit_cue: 1-based cue position in file order (SRT numbers are ignored)." },
          text: { type: "string", minLength: 1, maxLength: MAX_CUE_TEXT_CHARACTERS, description: "edit_cue: replacement cue text; separate lines with a newline. Blank lines and \"-->\" are rejected." },
          start_seconds: { type: "number", minimum: 0, maximum: MAX_RETIME_SECONDS, description: "edit_cue: new cue start in seconds." },
          end_seconds: { type: "number", minimum: 0, maximum: MAX_RETIME_SECONDS, description: "edit_cue: new cue end in seconds; must be after the start." },
        },
        required: ["operation"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          if ((args.input_path === undefined) === (args.content === undefined)) throw new Error("provide exactly one of input_path or content");
          const usesPath = args.input_path !== undefined || args.output_path !== undefined;
          if (usesPath && args.approved_workspace_path === undefined) throw new Error("approved_workspace_path is required with input_path or output_path");
          if (!usesPath && args.approved_workspace_path !== undefined) throw new Error("approved_workspace_path is only accepted together with input_path or output_path");
          for (const key of ["input_format", "output_format"] as const) {
            if (args[key] !== undefined && args[key] !== "srt" && args[key] !== "vtt") throw new Error(`${key} must be srt or vtt`);
          }
          if (args.return_content !== undefined && typeof args.return_content !== "boolean") throw new Error("return_content must be a boolean");
          let source: string | null = null;
          let content: unknown = args.content;
          let hint = args.input_format as CaptionFileFormat | undefined;
          if (args.input_path !== undefined) {
            source = resolveContainedInputPath(args.approved_workspace_path, args.input_path);
            hint ??= captionExtension(source, "input_path");
            content = readFileSync(source, "utf8");
          }
          const target = args.output_path !== undefined ? resolveContainedOutputPath(args.approved_workspace_path, args.output_path) : null;
          const targetFormat = target ? captionExtension(target, "output_path") : undefined;
          const parsed = parseCaptionFile(content, hint);
          const outputFormat = (args.output_format as CaptionFileFormat | undefined) ?? targetFormat ?? parsed.format;
          if (targetFormat && targetFormat !== outputFormat) throw new Error(`output_path extension does not match output_format ${outputFormat}`);
          const request: Record<string, unknown> = {};
          for (const key of RETIME_REQUEST_KEYS) if (args[key] !== undefined) request[key] = args[key];
          const result = retimeCaptionBlocks(parsed, request as unknown as RetimeRequest);
          const warnings = [...result.warnings];
          const text = serializeCaptionFile(result.blocks, outputFormat, parsed.format, warnings);
          const bytes = Buffer.byteLength(text, "utf8");
          const wantInline = !target || args.return_content === true;
          if (wantInline && bytes > MAX_INLINE_ARTIFACT_BYTES) throw new Error(`retimed caption file is ${bytes} bytes, above the ${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit; ${target ? "omit return_content" : "pass output_path and approved_workspace_path"}`);
          if (target) writeFileSync(target, text, { encoding: "utf8", flag: "wx" });
          return {
            success: true,
            data: {
              operation: result.summary.operation,
              input: source ? { path: source, format: parsed.format } : { format: parsed.format, inline: true },
              output: { format: outputFormat, bytes, sha256: contentDigest(text), ...(target ? { path: target, written: true } : { written: false }) },
              ...(wantInline ? { content: text } : {}),
              summary: result.summary,
              changes: result.changes,
              changes_truncated: result.changes_truncated,
              range_adjustments: result.range_adjustments,
              warnings,
              applied_to_premiere: false,
              host_limitations: [
                "Premiere caption track items do not follow ripple edits, and no documented ExtendScript, QE DOM, or UXP API can move or retime them; this tool only rewrites the caption file.",
                "Re-importing creates a new caption track. Caption styling is host-locked and is not carried over, so reapply the saved Track Style in Premiere.",
              ],
              next_steps: [
                target ? `Import ${target} with import_media.` : "Save the content to a .srt or .vtt file (or rerun with output_path and approved_workspace_path), then import it with import_media.",
                "Call create_caption_track with action import, the imported item_id, and start_seconds 0 (cue times are already sequence-relative).",
                "Disable or delete the stale caption track in Premiere, then call read_sequence_captions to confirm the new track.",
                "Reapply caption styling by hand in Premiere; call get_caption_style_guidance for Track Style steps.",
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
