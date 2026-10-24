import { createHash } from "node:crypto";
import { formatCaptionTimestamp } from "./caption-authoring.js";
import { MAX_CAPTION_ARTIFACT_CHARACTERS, MAX_CAPTION_CUES } from "./caption-timing.js";

/**
 * Local SRT/VTT ripple retimer. Premiere caption track items do not move with
 * ripple edits and no host API (ExtendScript, QE, or UXP) can retime them, so
 * the supported route is: retime the caption file here, then re-import it with
 * create_caption_track. Nothing in this module reaches Premiere.
 */

export const RETIME_OPERATIONS = ["shift", "ripple_remove_ranges", "ripple_insert", "edit_cue"] as const;
export type RetimeOperation = (typeof RETIME_OPERATIONS)[number];
export const RETIME_STRADDLE_POLICIES = ["split", "extend"] as const;
export type RetimeStraddlePolicy = (typeof RETIME_STRADDLE_POLICIES)[number];
export const MAX_RETIME_RANGES = 50;
export const MAX_RETIME_SECONDS = 604_800;
export const MAX_CUE_TEXT_CHARACTERS = 2_000;
export const MAX_REPORTED_CHANGES = 50;
export const MIN_RETIME_FPS = 1;
export const MAX_RETIME_FPS = 240;

export type CaptionFileFormat = "srt" | "vtt";

export interface RetimeCue {
  kind: "cue";
  /** SRT index or VTT cue identifier as written in the source, if any. */
  identifier?: string;
  startMs: number;
  endMs: number;
  /** VTT cue settings after the end timestamp (position, line, align...). */
  settings: string;
  lines: string[];
  sourceLine: number;
}

export interface RetimeRawBlock {
  kind: "raw";
  /** WEBVTT header, NOTE, STYLE, or REGION block, preserved verbatim. */
  blockType: "header" | "note" | "style" | "region";
  text: string;
}

export type RetimeBlock = RetimeCue | RetimeRawBlock;

export interface ParsedCaptionFile {
  format: CaptionFileFormat;
  blocks: RetimeBlock[];
  warnings: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

const TIMESTAMP = /^(?:(\d{1,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/;
const INLINE_TIMESTAMP = /<((?:\d{1,}:)?[0-5]\d:[0-5]\d\.\d{3})>/g;

function parseTimestamp(value: string, line: number, format: CaptionFileFormat): number {
  const match = TIMESTAMP.exec(value);
  if (!match) fail(`line ${line}: invalid ${format.toUpperCase()} timestamp "${value.slice(0, 32)}"`);
  if (format === "srt" && match[1] === undefined) fail(`line ${line}: SRT timestamps need hours (HH:MM:SS,mmm)`);
  return Number(match[1] ?? 0) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number(match[4]);
}

function parseTimingLine(line: string, lineNumber: number, format: CaptionFileFormat): { startMs: number; endMs: number; settings: string } {
  const match = /^\s*(\S+)\s+-->\s+(\S+)(.*)$/.exec(line);
  if (!match) fail(`line ${lineNumber}: invalid cue timing line`);
  const startMs = parseTimestamp(match[1], lineNumber, format);
  const endMs = parseTimestamp(match[2], lineNumber, format);
  if (endMs <= startMs) fail(`line ${lineNumber}: cue must end after it starts`);
  const settings = match[3].trim();
  if (format === "srt" && settings && !/^X1:\d+\s+X2:\d+\s+Y1:\d+\s+Y2:\d+$/i.test(settings)) {
    fail(`line ${lineNumber}: unexpected text after the SRT end timestamp`);
  }
  return { startMs, endMs, settings };
}

export function detectCaptionFormat(content: string, hint?: string): CaptionFileFormat {
  if (hint === "srt" || hint === "vtt") return hint;
  return /^﻿?WEBVTT(?:[ \t]|\r?\n|$)/.test(content) ? "vtt" : "srt";
}

/** Parses SRT or VTT, keeping cue text, VTT settings, and non-cue blocks. Errors cite 1-based line numbers. */
export function parseCaptionFile(content: unknown, formatHint?: string): ParsedCaptionFile {
  if (typeof content !== "string" || !content.trim()) fail("caption content is empty");
  if (content.length > MAX_CAPTION_ARTIFACT_CHARACTERS) fail(`caption content exceeds ${MAX_CAPTION_ARTIFACT_CHARACTERS} characters`);
  const format = detectCaptionFormat(content, formatHint);
  const lines = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const warnings: string[] = [];
  const blocks: RetimeBlock[] = [];
  let index = 0;
  let cueCount = 0;
  if (format === "vtt") {
    if (!/^WEBVTT(?:[ \t]|$)/.test(lines[0] ?? "")) fail("line 1: a VTT file must begin with WEBVTT");
    const header: string[] = [];
    while (index < lines.length && lines[index].trim() !== "") header.push(lines[index++].trimEnd());
    if (header.some((line) => line.includes("-->"))) fail("line 2: the WEBVTT header must be followed by a blank line before the first cue");
    blocks.push({ kind: "raw", blockType: "header", text: header.join("\n") });
  }
  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === "") index++;
    if (index >= lines.length) break;
    const start = index;
    const block: string[] = [];
    while (index < lines.length && lines[index].trim() !== "") block.push(lines[index++].trimEnd());
    const lineAt = (offset: number) => start + offset + 1;
    if (format === "vtt") {
      const raw = /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.exec(block[0]);
      if (raw) {
        if (raw[1] !== "NOTE" && cueCount > 0) fail(`line ${lineAt(0)}: ${raw[1]} blocks must appear before the first cue`);
        blocks.push({ kind: "raw", blockType: raw[1].toLowerCase() as "note" | "style" | "region", text: block.join("\n") });
        continue;
      }
    }
    const timingOffset = block.findIndex((line) => line.includes("-->"));
    if (timingOffset < 0) fail(`line ${lineAt(0)}: block has no "-->" timing line`);
    if (timingOffset > 1) fail(`line ${lineAt(timingOffset)}: timing line must be the first or second line of a cue`);
    let identifier: string | undefined;
    if (timingOffset === 1) {
      identifier = block[0].trim();
      if (format === "srt" && !/^\d+$/.test(identifier)) fail(`line ${lineAt(0)}: SRT cue number must be a positive integer`);
    }
    const timing = parseTimingLine(block[timingOffset], lineAt(timingOffset), format);
    const text = block.slice(timingOffset + 1);
    const nested = text.findIndex((line) => line.includes("-->"));
    if (nested >= 0) fail(`line ${lineAt(timingOffset + 1 + nested)}: cue text contains "-->"; separate cues with a blank line`);
    if (!text.length) warnings.push(`line ${lineAt(timingOffset)}: cue has no text`);
    blocks.push({ kind: "cue", identifier, ...timing, lines: text, sourceLine: lineAt(timingOffset) });
    cueCount++;
    if (cueCount > MAX_CAPTION_CUES) fail(`caption file exceeds ${MAX_CAPTION_CUES} cues`);
  }
  if (!cueCount) fail("caption file contains no timed cues");
  return { format, blocks, warnings };
}

export function cuesOf(blocks: readonly RetimeBlock[]): RetimeCue[] {
  return blocks.filter((block): block is RetimeCue => block.kind === "cue");
}

function stripVttMarkupForSrt(line: string): string {
  return line.replace(INLINE_TIMESTAMP, "").replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>/g, "$1: ").replace(/<\/v>/g, "");
}

/** Serializes blocks. SRT is always renumbered from 1; VTT keeps identifiers, settings, and NOTE/STYLE/REGION blocks. */
export function serializeCaptionFile(blocks: readonly RetimeBlock[], format: CaptionFileFormat, sourceFormat: CaptionFileFormat, warnings: string[]): string {
  const out: string[] = [];
  let number = 0;
  let droppedRaw = 0;
  let droppedSettings = 0;
  for (const block of blocks) {
    if (block.kind === "raw") {
      if (format === "vtt") out.push(block.text);
      else droppedRaw++;
      continue;
    }
    number++;
    const timing = `${formatCaptionTimestamp(block.startMs, format)} --> ${formatCaptionTimestamp(block.endMs, format)}`;
    if (format === "srt") {
      if (sourceFormat === "vtt" && block.settings) droppedSettings++;
      const settings = sourceFormat === "srt" && block.settings ? ` ${block.settings}` : "";
      const lines = sourceFormat === "vtt" ? block.lines.map(stripVttMarkupForSrt) : block.lines;
      out.push([String(number), `${timing}${settings}`, ...lines].join("\n"));
    } else {
      const settings = sourceFormat === "vtt" && block.settings ? ` ${block.settings}` : "";
      const head = sourceFormat === "vtt" && block.identifier ? [block.identifier] : [];
      out.push([...head, `${timing}${settings}`, ...block.lines].join("\n"));
    }
  }
  if (format === "vtt" && sourceFormat === "srt") out.unshift("WEBVTT");
  if (droppedRaw) warnings.push(`Converted to SRT: dropped the WEBVTT header and ${droppedRaw - 1} NOTE/STYLE/REGION block(s)`);
  if (droppedSettings) warnings.push(`Converted to SRT: dropped VTT cue settings on ${droppedSettings} cue(s)`);
  return `${out.join("\n\n")}\n`;
}

export interface TimelineRangeSeconds { start: number; end: number }

export interface RetimeRequest {
  operation: RetimeOperation;
  fps?: number;
  offset_seconds?: number;
  offset_frames?: number;
  from_seconds?: number;
  ranges?: TimelineRangeSeconds[];
  at_seconds?: number;
  duration_seconds?: number;
  duration_frames?: number;
  straddle_policy?: RetimeStraddlePolicy;
  cue_index?: number;
  text?: string;
  start_seconds?: number;
  end_seconds?: number;
}

export interface RetimeChange {
  cue_index: number;
  change: "removed" | "trimmed" | "shifted" | "split" | "edited";
  before: { start: string; end: string };
  after?: Array<{ start: string; end: string }>;
}

export interface RetimeResult {
  format: CaptionFileFormat;
  blocks: RetimeBlock[];
  summary: {
    operation: RetimeOperation;
    cues_in: number;
    cues_out: number;
    removed: number;
    trimmed: number;
    shifted: number;
    split: number;
    edited: number;
    unchanged: number;
    first_start: string | null;
    last_end: string | null;
    rounding: string;
    overlapping_cue_pairs: number;
  };
  changes: RetimeChange[];
  changes_truncated: boolean;
  range_adjustments: Array<{ range_index: number; requested: TimelineRangeSeconds; snapped: TimelineRangeSeconds }>;
  warnings: string[];
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be a finite number from ${min} through ${max}`);
  return value;
}

function optionalFinite(value: unknown, label: string, min: number, max: number): number | undefined {
  return value === undefined ? undefined : finite(value, label, min, max);
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} through ${max}`);
  return value;
}

function only(request: RetimeRequest, allowed: readonly (keyof RetimeRequest)[]): void {
  const permitted = new Set<keyof RetimeRequest>(["operation", "fps", ...allowed]);
  for (const key of Object.keys(request) as (keyof RetimeRequest)[]) {
    if (request[key] !== undefined && !permitted.has(key)) fail(`${key} is not accepted for operation ${request.operation}`);
  }
}

/** Seconds or frames → milliseconds (exact value; rounding happens on output). */
function amountMs(seconds: unknown, frames: unknown, fps: number | undefined, label: string, min: number): number {
  if ((seconds === undefined) === (frames === undefined)) fail(`provide exactly one of ${label}_seconds or ${label}_frames`);
  if (frames !== undefined) {
    if (fps === undefined) fail(`${label}_frames requires fps`);
    return (integer(frames, `${label}_frames`, Math.ceil(min * fps), Math.floor(MAX_RETIME_SECONDS * fps)) * 1000) / fps;
  }
  return finite(seconds, `${label}_seconds`, min, MAX_RETIME_SECONDS) * 1000;
}

function makeRounder(fps: number | undefined): (ms: number) => number {
  if (fps === undefined) return (ms) => Math.max(0, Math.round(ms));
  return (ms) => Math.max(0, Math.round((Math.round((ms * fps) / 1000) * 1000) / fps));
}

function snapRangesToFrames(ranges: TimelineRangeSeconds[], fps: number | undefined, adjustments: RetimeResult["range_adjustments"]): Array<{ startMs: number; endMs: number }> {
  return ranges.map((range, index) => {
    if (fps === undefined) return { startMs: range.start * 1000, endMs: range.end * 1000 };
    const start = Math.round(range.start * fps) / fps;
    const end = Math.round(range.end * fps) / fps;
    if (end <= start) fail(`ranges[${index}] is empty after snapping to ${fps} fps frames`);
    if (Math.abs(start - range.start) > 1e-6 || Math.abs(end - range.end) > 1e-6) {
      adjustments.push({ range_index: index, requested: { ...range }, snapped: { start: Number(start.toFixed(6)), end: Number(end.toFixed(6)) } });
    }
    return { startMs: start * 1000, endMs: end * 1000 };
  });
}

/** Same contract as ripple_remove_timeline_ranges: 1-50 sorted, non-overlapping {start,end} second intervals. */
export function validateRetimeRanges(value: unknown): TimelineRangeSeconds[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RETIME_RANGES) fail(`ranges must contain 1 to ${MAX_RETIME_RANGES} intervals`);
  let previousEnd = -Infinity;
  return value.map((range, index) => {
    if (!range || typeof range !== "object" || Array.isArray(range)) fail(`ranges[${index}] must be an object with start and end`);
    const { start, end } = range as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > MAX_RETIME_SECONDS) {
      fail(`ranges[${index}] must have finite non-negative start and end > start`);
    }
    if (start < previousEnd) fail("ranges must be sorted and non-overlapping (the same contract as ripple_remove_timeline_ranges)");
    previousEnd = end;
    return { start, end };
  });
}

function validateCueText(value: unknown): string[] {
  if (typeof value !== "string") fail("text must be a string");
  const normalized = value.replace(/\r\n?/g, "\n");
  if (normalized.length > MAX_CUE_TEXT_CHARACTERS) fail(`text must be at most ${MAX_CUE_TEXT_CHARACTERS} characters`);
  if (normalized.includes("-->")) fail('text must not contain "-->"');
  const lines = normalized.split("\n").map((line) => line.trimEnd());
  if (!lines.some((line) => line.trim())) fail("text must contain at least one non-blank line");
  if (lines.some((line) => !line.trim())) fail("text must not contain blank lines; a blank line ends a caption cue");
  return lines;
}

function ts(ms: number, format: CaptionFileFormat): string {
  return formatCaptionTimestamp(ms, format);
}

/** Maps VTT karaoke timestamps through the time map and clamps them inside the cue. */
function remapInline(lines: string[], map: (ms: number) => number, startMs: number, endMs: number): string[] {
  return lines.map((line) => line.replace(INLINE_TIMESTAMP, (_whole, stamp: string) => {
    const parsed = parseTimestamp(stamp, 0, "vtt");
    const mapped = Math.min(endMs, Math.max(startMs, map(parsed)));
    return `<${formatCaptionTimestamp(mapped, "vtt")}>`;
  }));
}

export function retimeCaptionBlocks(parsed: ParsedCaptionFile, rawRequest: RetimeRequest): RetimeResult {
  const request = rawRequest;
  if (!(RETIME_OPERATIONS as readonly string[]).includes(request.operation)) fail(`operation must be one of: ${RETIME_OPERATIONS.join(", ")}`);
  const fps = optionalFinite(request.fps, "fps", MIN_RETIME_FPS, MAX_RETIME_FPS);
  const round = makeRounder(fps);
  const format = parsed.format;
  const warnings = [...parsed.warnings];
  const adjustments: RetimeResult["range_adjustments"] = [];
  const cuesIn = cuesOf(parsed.blocks);
  const changes: RetimeChange[] = [];
  const counts = { removed: 0, trimmed: 0, shifted: 0, split: 0, edited: 0, unchanged: 0 };
  const out: RetimeBlock[] = [];
  let cueNumber = 0;
  const record = (change: RetimeChange) => {
    counts[change.change]++;
    if (changes.length < MAX_REPORTED_CHANGES) changes.push(change);
  };

  // Each operation yields, per source cue, zero or more output cue intervals plus a point map for inline timestamps.
  let transform: (cue: RetimeCue, number: number) => Array<{ startMs: number; endMs: number; map: (ms: number) => number; suffix?: string }> | "edited";

  switch (request.operation) {
    case "shift": {
      only(request, ["offset_seconds", "offset_frames", "from_seconds"]);
      const offset = amountMs(request.offset_seconds, request.offset_frames, fps, "offset", -MAX_RETIME_SECONDS);
      const from = request.from_seconds === undefined ? undefined : finite(request.from_seconds, "from_seconds", 0, MAX_RETIME_SECONDS) * 1000;
      const map = (ms: number) => ms + offset;
      transform = (cue) => (from !== undefined && cue.startMs < from ? [{ startMs: cue.startMs, endMs: cue.endMs, map: (ms) => ms }] : [{ startMs: map(cue.startMs), endMs: map(cue.endMs), map }]);
      break;
    }
    case "ripple_remove_ranges": {
      only(request, ["ranges"]);
      const ranges = snapRangesToFrames(validateRetimeRanges(request.ranges), fps, adjustments);
      const map = (ms: number) => {
        let removed = 0;
        for (const range of ranges) {
          if (ms >= range.endMs) removed += range.endMs - range.startMs;
          else if (ms > range.startMs) return range.startMs - removed;
          else break;
        }
        return ms - removed;
      };
      transform = (cue) => [{ startMs: map(cue.startMs), endMs: map(cue.endMs), map }];
      break;
    }
    case "ripple_insert": {
      only(request, ["at_seconds", "duration_seconds", "duration_frames", "straddle_policy"]);
      const at = finite(request.at_seconds, "at_seconds", 0, MAX_RETIME_SECONDS) * 1000;
      const duration = amountMs(request.duration_seconds, request.duration_frames, fps, "duration", 0);
      if (duration <= 0) fail("duration must be greater than 0");
      const policy = request.straddle_policy ?? "split";
      if (!(RETIME_STRADDLE_POLICIES as readonly string[]).includes(policy)) fail(`straddle_policy must be one of: ${RETIME_STRADDLE_POLICIES.join(", ")}`);
      const map = (ms: number) => (ms >= at ? ms + duration : ms);
      transform = (cue) => {
        if (cue.startMs >= at || cue.endMs <= at) return [{ startMs: map(cue.startMs), endMs: map(cue.endMs), map }];
        if (policy === "extend") return [{ startMs: cue.startMs, endMs: cue.endMs + duration, map }];
        return [
          { startMs: cue.startMs, endMs: at, map },
          { startMs: at + duration, endMs: cue.endMs + duration, map, suffix: "-2" },
        ];
      };
      break;
    }
    case "edit_cue": {
      only(request, ["cue_index", "text", "start_seconds", "end_seconds"]);
      const target = integer(request.cue_index, "cue_index", 1, cuesIn.length);
      if (request.text === undefined && request.start_seconds === undefined && request.end_seconds === undefined) fail("edit_cue needs at least one of text, start_seconds, or end_seconds");
      const lines = request.text === undefined ? undefined : validateCueText(request.text);
      const start = optionalFinite(request.start_seconds, "start_seconds", 0, MAX_RETIME_SECONDS);
      const end = optionalFinite(request.end_seconds, "end_seconds", 0, MAX_RETIME_SECONDS);
      const cue = cuesIn[target - 1];
      const startMs = start === undefined ? cue.startMs : round(start * 1000);
      const endMs = end === undefined ? cue.endMs : round(end * 1000);
      if (endMs <= startMs) fail(`cue ${target} must end after it starts (start ${ts(startMs, format)}, end ${ts(endMs, format)})`);
      transform = (candidate, number) => {
        if (number !== target) return [{ startMs: candidate.startMs, endMs: candidate.endMs, map: (ms) => ms }];
        const before = { start: ts(candidate.startMs, format), end: ts(candidate.endMs, format) };
        const lineSet = lines ?? remapInline(candidate.lines, (ms) => ms, startMs, endMs);
        out.push({ ...candidate, startMs, endMs, lines: lineSet });
        record({ cue_index: number, change: "edited", before, after: [{ start: ts(startMs, format), end: ts(endMs, format) }] });
        return "edited";
      };
      break;
    }
  }

  for (const block of parsed.blocks) {
    if (block.kind === "raw") {
      out.push(block);
      continue;
    }
    cueNumber++;
    const parts = transform!(block, cueNumber);
    if (parts === "edited") continue;
    const before = { start: ts(block.startMs, format), end: ts(block.endMs, format) };
    const kept = parts
      .map((part) => ({ ...part, startMs: round(Math.max(0, part.startMs)), endMs: round(part.endMs) }))
      .filter((part) => part.endMs > part.startMs);
    if (!kept.length) {
      record({ cue_index: cueNumber, change: "removed", before });
      continue;
    }
    for (const part of kept) {
      out.push({
        ...block,
        identifier: part.suffix && block.identifier ? `${block.identifier}${part.suffix}` : block.identifier,
        startMs: part.startMs,
        endMs: part.endMs,
        lines: remapInline(block.lines, part.map, part.startMs, part.endMs),
      });
    }
    const after = kept.map((part) => ({ start: ts(part.startMs, format), end: ts(part.endMs, format) }));
    const originalDuration = round(block.endMs) - round(block.startMs);
    if (kept.length > 1) record({ cue_index: cueNumber, change: "split", before, after });
    else if (kept[0].endMs - kept[0].startMs !== originalDuration) record({ cue_index: cueNumber, change: "trimmed", before, after });
    else if (kept[0].startMs !== block.startMs || kept[0].endMs !== block.endMs) record({ cue_index: cueNumber, change: "shifted", before, after });
    else counts.unchanged++;
  }

  const cuesOut = cuesOf(out);
  if (!cuesOut.length) fail("the operation removed every cue; nothing to write");
  // Keep output in time order (a shift with from_seconds or an edit can reorder cues).
  const sortedCues = [...cuesOut].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (sortedCues.some((cue, index) => cue !== cuesOut[index])) {
    let next = 0;
    for (let index = 0; index < out.length; index++) if (out[index].kind === "cue") out[index] = sortedCues[next++];
    warnings.push("Cues were reordered by start time after retiming");
  }
  let overlaps = 0;
  for (let index = 1; index < sortedCues.length; index++) if (sortedCues[index].startMs < sortedCues[index - 1].endMs) overlaps++;
  if (overlaps) warnings.push(`${overlaps} adjacent cue pair(s) overlap after retiming; review them before import`);
  if (request.operation === "shift" && cuesIn.length !== cuesOut.length) warnings.push("A negative shift moved some cues entirely before 0 and they were removed");

  return {
    format,
    blocks: out,
    summary: {
      operation: request.operation,
      cues_in: cuesIn.length,
      cues_out: cuesOut.length,
      ...counts,
      first_start: ts(sortedCues[0].startMs, format),
      last_end: ts(Math.max(...sortedCues.map((cue) => cue.endMs)), format),
      rounding: fps === undefined ? "milliseconds" : `frames at ${fps} fps`,
      overlapping_cue_pairs: overlaps,
    },
    changes,
    changes_truncated: counts.removed + counts.trimmed + counts.shifted + counts.split + counts.edited > changes.length,
    range_adjustments: adjustments,
    warnings,
  };
}

export function contentDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
