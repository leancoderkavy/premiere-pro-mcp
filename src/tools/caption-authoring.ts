import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCaptionArtifact,
  CAPTION_AUTHORING_ROUTES,
  CAPTION_STYLE_PRESETS,
  checkCaptionSafeZone,
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

export const MAX_INLINE_ARTIFACT_BYTES = 512 * 1024;
const MAX_PATH_LENGTH = 4096;

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
  };
}
