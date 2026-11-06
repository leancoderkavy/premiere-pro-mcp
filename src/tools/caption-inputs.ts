import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCaptionPlan,
  captionPlanDocument,
  clampPlanToEnd,
  CAPTION_PLAN_OPTION_KEYS,
  normalizeCaptionPlanOptions,
  parseCaptionPlanDocument,
  planFromDocument,
  type CaptionPlan,
  type CaptionPlanDocument,
  type CaptionPlanSource,
} from "../ai/caption-plan.js";
import type { CaptionTranscriptFormat, CaptionTranscriptSegment } from "../ai/caption-plan-types.js";
import { exactFrameRate } from "../ai/caption-rules.js";
import { detectFormat, parseCaptionTranscript, segmentsFromWordTimeline, transcriptDurationSeconds } from "../ai/caption-transcript.js";
import { digestWordTimeline, validateWordTimeline, WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";
import { resolveContainedInputPath, resolveContainedOutputPath } from "./caption-authoring.js";

/** Largest transcript text or file accepted (bytes). Transcript JSON with word times is much bigger than an SRT. */
export const MAX_CAPTION_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
/** Largest saved caption plan file accepted (bytes). */
export const MAX_CAPTION_PLAN_BYTES = 32 * 1024 * 1024;

const MAX_PATH_LENGTH = 4096;
const TRANSCRIPT_EXTENSIONS = [".srt", ".vtt", ".json"];

/** JSON Schema properties for a tool that takes a transcript. Exactly one of word_timeline, transcript_text, transcript_path. */
export const CAPTION_TRANSCRIPT_INPUT_PROPERTIES = {
  word_timeline: WORD_TIMELINE_PARAMETER,
  transcript_text: {
    type: "string",
    maxLength: MAX_CAPTION_TRANSCRIPT_BYTES,
    description: "The transcript itself (SRT, WebVTT, or JSON: ElevenLabs Scribe, Whisper-style segments, a plain array of {text,start,end}, or Premiere's exported transcript JSON), instead of word_timeline or transcript_path. At most 16 MiB.",
  },
  transcript_path: {
    type: "string",
    maxLength: MAX_PATH_LENGTH,
    description: "Absolute path of a .srt, .vtt or .json transcript inside approved_workspace_path (realpath-checked, at most 16 MiB). Requires approved_workspace_path.",
  },
  transcript_format: {
    type: "string",
    enum: ["srt", "vtt", "json"],
    description: "Format of transcript_text or transcript_path. Default: from the file extension, else from the content.",
  },
  approved_workspace_path: {
    type: "string",
    maxLength: MAX_PATH_LENGTH,
    description: "Absolute path of an existing directory the caller approved for file access. transcript_path, plan_path and output paths must be inside it.",
  },
} as const;

/** JSON Schema properties for a tool that can take a saved caption plan instead of a transcript. */
export const CAPTION_PLAN_INPUT_PROPERTIES = {
  plan_path: {
    type: "string",
    maxLength: MAX_PATH_LENGTH,
    description: "Absolute path of a saved caption plan (.json written by a caption planning tool) inside approved_workspace_path (realpath-checked, at most 32 MiB). Use it instead of a transcript. Requires approved_workspace_path.",
  },
  approved_workspace_path: CAPTION_TRANSCRIPT_INPUT_PROPERTIES.approved_workspace_path,
} as const;

export type CaptionTranscriptSource = {
  kind: "word_timeline" | "text" | "path";
  path?: string;
  sha256: string;
  format: string;
};

export type ResolvedCaptionTranscript = {
  segments: CaptionTranscriptSegment[];
  source: CaptionTranscriptSource;
  /** Media duration (transcript seconds) a JSON transcript states, when it does. */
  duration_s?: number;
};

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function formatArg(value: unknown): CaptionTranscriptFormat | undefined {
  if (!isGiven(value)) return undefined;
  if (value !== "srt" && value !== "vtt" && value !== "json") throw new Error("transcript_format must be srt, vtt or json");
  return value;
}

/** True when the arguments carry any transcript input. */
export function hasTranscriptInput(args: Record<string, unknown>): boolean {
  return isGiven(args.word_timeline) || isGiven(args.transcript_text) || isGiven(args.transcript_path);
}

/**
 * Reads the transcript of a tool call into segments. Exactly one of word_timeline, transcript_text,
 * transcript_path is required. Throws Error with a clear message otherwise, or when the transcript
 * cannot be parsed.
 */
export function resolveCaptionTranscript(args: Record<string, unknown>): ResolvedCaptionTranscript {
  const given = [isGiven(args.word_timeline), isGiven(args.transcript_text), isGiven(args.transcript_path)].filter(Boolean).length;
  if (given !== 1) throw new Error("Provide exactly one of word_timeline, transcript_text or transcript_path");
  const explicit = formatArg(args.transcript_format);

  if (isGiven(args.word_timeline)) {
    if (explicit) throw new Error("transcript_format does not apply to word_timeline");
    const timeline = validateWordTimeline(args.word_timeline);
    return {
      segments: segmentsFromWordTimeline(timeline),
      source: { kind: "word_timeline", sha256: digestWordTimeline(timeline).replace(/^sha256:/, ""), format: "word_timeline" },
    };
  }

  if (isGiven(args.transcript_text)) {
    const text = args.transcript_text;
    if (typeof text !== "string" || !text.trim()) throw new Error("transcript_text must be a non-empty string");
    if (Buffer.byteLength(text, "utf8") > MAX_CAPTION_TRANSCRIPT_BYTES) throw new Error(`transcript_text is above the ${MAX_CAPTION_TRANSCRIPT_BYTES}-byte limit`);
    const clean = text.replace(/^﻿/, "");
    const format = explicit ?? detectFormat(clean);
    const duration = transcriptDurationSeconds(clean, format);
    return { segments: parseCaptionTranscript(clean, format), source: { kind: "text", sha256: sha256Hex(text), format }, ...(duration !== undefined ? { duration_s: duration } : {}) };
  }

  const resolved = resolveContainedInputPath(args.approved_workspace_path, args.transcript_path, MAX_CAPTION_TRANSCRIPT_BYTES);
  const extension = path.extname(resolved).toLocaleLowerCase();
  if (!TRANSCRIPT_EXTENSIONS.includes(extension)) throw new Error("transcript_path must end in .srt, .vtt or .json");
  const raw = readFileSync(resolved);
  const text = raw.toString("utf8").replace(/^﻿/, "");
  const format = explicit ?? (extension === ".srt" ? "srt" : extension === ".vtt" ? "vtt" : "json");
  const duration = transcriptDurationSeconds(text, format);
  return { segments: parseCaptionTranscript(text, format), source: { kind: "path", path: resolved, sha256: sha256Hex(raw), format }, ...(duration !== undefined ? { duration_s: duration } : {}) };
}

export type ResolvedCaptionPlan = {
  plan: CaptionPlan;
  document: CaptionPlanDocument;
  warnings: string[];
};

export type CaptionPlanOverrides = {
  frame_rate?: number;
  cut_times?: number[];
  /** The end of the sequence (on the plan's timeline, seconds): no caption ends past it; one starting at or after it is dropped. */
  end_s?: number;
};

const roundTo = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;
/** A frame rate as people write it: 29.97, not 29.97002997. */
const shown = (fps: number) => Math.round(fps * 1000) / 1000;

/**
 * Re-rounds a plan's times to the frames of another rate. Rounding can bring two captions closer than the
 * plan's minimum gap (at least 1 frame, so they never touch or overlap): the earlier out-time is pulled back,
 * never past its in-time plus one frame. `adjusted` counts those captions.
 */
function retimeToFrameRate(plan: CaptionPlan, fps: number): { plan: CaptionPlan; adjusted: number } {
  const frame = 1 / fps;
  const captions = plan.captions.map((c) => {
    const start = roundTo(c.start, fps);
    let end = roundTo(c.end, fps);
    if (end <= start) end = start + frame;
    return {
      ...c,
      start,
      end,
      words: c.words.map((w) => {
        const ws = roundTo(w.start, fps);
        return { text: w.text, start: ws, end: Math.max(ws, roundTo(w.end, fps)) };
      }),
      ...(c.highlight ? { highlight: c.highlight.map((h) => roundTo(h, fps)) } : {}),
    };
  });
  const gap = Math.max(1, plan.settings.min_gap_frames) * frame;
  let adjusted = 0;
  for (let i = 0; i + 1 < captions.length; i++) {
    const c = captions[i];
    const next = captions[i + 1];
    if (next.start - c.end >= gap - 1e-6) continue;
    const end = Math.max(roundTo(next.start - gap, fps), c.start + frame);
    if (end < c.end - 1e-9) {
      c.end = end;
      adjusted++;
    }
  }
  return { plan: { ...plan, captions, settings: { ...plan.settings, frame_rate: fps, frame_rate_assumed: false } }, adjusted };
}

/**
 * The caption plan of a tool call: either a saved plan (plan_path) or a plan built from a transcript input
 * (word_timeline / transcript_text / transcript_path) with the planner options in the same arguments.
 * Exactly one of plan_path or a transcript input. `overrides.frame_rate` (the sequence's own rate) replaces
 * args.frame_rate for a transcript, with a warning when both are given and differ; for a saved plan it
 * re-rounds every time to the new frames when it differs from the plan's by more than 0.01. `overrides.cut_times`
 * are merged with args.cut_times (sorted, deduped).
 */
export function resolveCaptionPlan(args: Record<string, unknown>, overrides: CaptionPlanOverrides = {}): ResolvedCaptionPlan {
  const hasPlan = isGiven(args.plan_path);
  const hasTranscript = hasTranscriptInput(args);
  if (hasPlan === hasTranscript) throw new Error("Provide exactly one of plan_path or a transcript (word_timeline, transcript_text or transcript_path)");
  const extraWarnings: string[] = [];

  if (hasPlan) {
    const resolved = resolveContainedInputPath(args.approved_workspace_path, args.plan_path, MAX_CAPTION_PLAN_BYTES);
    if (path.extname(resolved).toLocaleLowerCase() !== ".json") throw new Error("plan_path must end in .json");
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(resolved, "utf8").replace(/^﻿/, ""));
    } catch (error) {
      throw new Error(`plan_path is not valid JSON: ${(error as Error).message}`);
    }
    const document = parseCaptionPlanDocument(value);
    let plan = planFromDocument(document);
    if (overrides.frame_rate !== undefined) {
      if (!(overrides.frame_rate > 0) || !Number.isFinite(overrides.frame_rate)) throw new Error("frame_rate override must be a positive number");
      const target = exactFrameRate(overrides.frame_rate);
      if (Math.abs(target - document.settings.frame_rate) > 0.01) {
        const retimed = retimeToFrameRate(plan, target);
        plan = retimed.plan;
        extraWarnings.push(`The saved plan was made at ${shown(document.settings.frame_rate)} fps; every time was re-rounded to ${shown(overrides.frame_rate)} fps frames.`);
        if (retimed.adjusted) extraWarnings.push(`${retimed.adjusted} caption${retimed.adjusted === 1 ? "" : "s"} ended too close to the next after re-rounding, so the out-time was pulled back to keep the plan's minimum gap.`);
      }
    }
    if (overrides.cut_times && overrides.cut_times.length) extraWarnings.push("cut_times were ignored: a saved plan has its shot-change rules already applied.");
    plan = { ...plan, warnings: [...plan.warnings, ...extraWarnings] };
    if (overrides.end_s !== undefined) {
      if (!(overrides.end_s > 0) || !Number.isFinite(overrides.end_s)) throw new Error("end_s override must be a positive number");
      const own = plan.settings.end_s;
      plan = clampPlanToEnd(plan, own === undefined ? overrides.end_s : Math.min(own, overrides.end_s), "the sequence end");
    }
    const next = captionPlanDocument(plan, document.source);
    return { plan, document: next, warnings: plan.warnings };
  }

  const transcript = resolveCaptionTranscript(args);
  const options = normalizeCaptionPlanOptions(args);
  if (overrides.frame_rate !== undefined) {
    if (!(overrides.frame_rate > 0) || !Number.isFinite(overrides.frame_rate)) throw new Error("frame_rate override must be a positive number");
    if (options.frame_rate !== undefined && Math.abs(exactFrameRate(options.frame_rate) - exactFrameRate(overrides.frame_rate)) > 0.01) {
      extraWarnings.push(`frame_rate ${options.frame_rate} differs from the sequence's ${overrides.frame_rate}; the sequence's rate was used.`);
    }
    options.frame_rate = exactFrameRate(overrides.frame_rate);
  }
  if (overrides.cut_times && overrides.cut_times.length) {
    const merged = [...(options.cut_times ?? []), ...overrides.cut_times];
    for (const t of merged) if (typeof t !== "number" || !Number.isFinite(t) || t < 0) throw new Error("cut_times must be seconds, 0 or more");
    options.cut_times = [...new Set(merged)].sort((a, b) => a - b);
  }
  if (overrides.end_s !== undefined) {
    if (!(overrides.end_s > 0) || !Number.isFinite(overrides.end_s)) throw new Error("end_s override must be a positive number");
    options.end_s = options.end_s === undefined ? overrides.end_s : Math.min(options.end_s, overrides.end_s);
  }
  if (transcript.duration_s !== undefined) options.transcript_duration_s = transcript.duration_s;
  const built = buildCaptionPlan(transcript.segments, options);
  const plan: CaptionPlan = { ...built, warnings: [...extraWarnings, ...built.warnings] };
  const source: CaptionPlanSource = { kind: transcript.source.kind, sha256: transcript.source.sha256, format: transcript.source.format, ...(transcript.source.path !== undefined ? { path: transcript.source.path } : {}) };
  return { plan, document: captionPlanDocument(plan, source), warnings: plan.warnings };
}

/**
 * Checks that a plan document, as it would be saved, is one parseCaptionPlanDocument accepts (times 0 or more,
 * ordered, a matching plan_revision ...). Throws Error with the validator's message, so a plan that could never be
 * loaded again is not written.
 */
export function assertSavablePlanDocument(document: CaptionPlanDocument): void {
  try {
    parseCaptionPlanDocument(JSON.parse(JSON.stringify(document)));
  } catch (error) {
    throw new Error(`the caption plan is not valid and was not saved: ${(error as Error).message}`);
  }
}

/**
 * Writes a plan document as JSON to a new file inside the approved workspace. The file must not exist
 * (flag "wx"); the document is validated first; returns the resolved path.
 */
export function writeCaptionPlanDocument(document: CaptionPlanDocument, workspace: unknown, outputPath: unknown): string {
  assertSavablePlanDocument(document);
  const target = resolveContainedOutputPath(workspace, outputPath);
  if (path.extname(target).toLocaleLowerCase() !== ".json") throw new Error("output_path must end in .json");
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return target;
}

/** The planner option keys, re-exported so tools can pick them out of their arguments. */
export { CAPTION_PLAN_OPTION_KEYS };
