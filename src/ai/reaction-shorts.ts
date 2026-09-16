import { createHash } from "node:crypto";
import path from "node:path";
import { digestWordTimeline, secondsToFrame, validateWordTimeline, type TranscriptWord, type WordTimeline } from "./word-timeline.js";
import { PLATFORM_SAFE_ZONES, type SafeZonePlatform } from "./caption-authoring.js";

/**
 * Local reaction-Shorts planning: stacked speaker-colored captions, a mid-video
 * subscribe CTA, and a series-named export folder. Deterministic arithmetic on
 * caller-supplied evidence. Nothing here contacts Premiere, a model, or the
 * network, and colors are never invented for unknown speakers.
 */

export const UNKNOWN_SPEAKER = "unknown";
export const MAX_SPEAKER_PALETTE = 16;
export const MAX_SHOT_CHANGES = 256;
export const MAX_STACK_SLOTS = 3;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const SHORT_BRANDS = ["watch_club", "cafe", "other"] as const;
export type ShortBrand = (typeof SHORT_BRANDS)[number];

export const REACTION_SHORTS_ROUTES = [
  "build_caption_artifact",
  "create_caption_track",
  "import_mogrt",
  "check_caption_safe_zone",
  "export_sequence_review_frames",
] as const;

export const SHORT_EXPORT_ROUTES = ["export_sequence", "verify_delivery_file", "verify_delivery_conformance"] as const;
export const SUBSCRIBE_CTA_ROUTES = ["import_mogrt", "check_caption_safe_zone", "export_sequence_review_frames"] as const;

const EPSILON = 1e-6;
const MAIN_CAPTION_Y = 0.7;
const STACK_STEP = 0.08;
const CTA_Y = 0.74;
const CTA_HEIGHT = 0.06;
const CTA_WIDTH = 0.72;

export type SpeakerPaletteEntry = { speaker_label: string; color: string };
export type ShotChange = { time_seconds: number; speaker_label: string };

export type ReactionCaptionCue = {
  index: number;
  text: string;
  start_seconds: number;
  end_seconds: number;
  start_frame: number;
  end_frame: number;
  speaker_label: string;
  color: string | null;
  uncertain: boolean;
  stack_slot: number;
  position: { x: number; y: number };
  merged_cue_count: number;
  aligned_to_shot: boolean;
  review_stack: boolean;
};

export type ReactionCaptionPlan = {
  cues: ReactionCaptionCue[];
  cue_count: number;
  stacked_overlap_count: number;
  uncertain_speakers: string[];
  speakers: string[];
  palette: SpeakerPaletteEntry[];
  warnings: string[];
  assumptions: string[];
  applied: false;
  apply_boundary: string;
  routes: readonly string[];
  next_steps: string[];
  plan_revision: string;
  evidence: {
    source_project_item_id: string;
    transcript_revision: string;
    word_count: number;
    duration_seconds: number;
    frame_rate: number;
  };
};

export type ShortSubscribeCtaPlan = {
  start_seconds: number;
  end_seconds: number;
  start_frame: number;
  end_frame: number;
  hold_seconds: number;
  copy: string;
  platform: SafeZonePlatform;
  brand: ShortBrand;
  position: { x: number; y: number };
  size: { width: number; height: number };
  style: { fill: string; text: string; icon: string; note: string };
  warnings: string[];
  assumptions: string[];
  applied: false;
  apply_boundary: string;
  routes: readonly string[];
  next_steps: string[];
  plan_revision: string;
  evidence: { duration_seconds: number; at_ratio: number; frame_rate: number };
};

export type ShortExportFolderPlan = {
  export_root: string;
  series_name: string;
  title: string;
  brand: ShortBrand;
  recommended_directory: string;
  recommended_filename: string;
  recommended_path: string;
  create_directory_if_missing: true;
  brand_isolation: string;
  warnings: string[];
  assumptions: string[];
  applied: false;
  apply_boundary: string;
  routes: readonly string[];
  next_steps: string[];
  plan_revision: string;
};

type DraftCue = {
  speaker_label: string;
  words: TranscriptWord[];
  start_seconds: number;
  end_seconds: number;
  merged_cue_count: number;
  aligned_to_shot: boolean;
  stack_slot: number;
  review_stack: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${label} has an unknown field: ${key}`);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} must be a finite number from ${minimum} through ${maximum}`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label, max);
}

function brand(value: unknown, fallback: ShortBrand = "other"): ShortBrand {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(SHORT_BRANDS as readonly string[]).includes(value)) {
    fail(`brand must be one of: ${SHORT_BRANDS.join(", ")}`);
  }
  return value as ShortBrand;
}

function frameRate(value: unknown): number {
  return boundedNumber(value, "frame_rate", 1, 240, 30);
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - EPSILON && bStart < aEnd - EPSILON;
}

function sentenceCase(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
}

function joinCueText(words: readonly TranscriptWord[]): string {
  return sentenceCase(words.map((word) => word.text.trim()).filter(Boolean).join(" "));
}

function renderCueText(cue: DraftCue, mergeGap: number): string {
  if (cue.merged_cue_count <= 1) return joinCueText(cue.words);
  const parts: string[] = [];
  let current: TranscriptWord[] = [];
  for (const word of cue.words) {
    const last = current[current.length - 1];
    if (last && word.start_seconds - last.end_seconds > mergeGap + EPSILON) {
      parts.push(joinCueText(current));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) parts.push(joinCueText(current));
  return parts.slice(1).reduce((text, part) => mergeCueText(text, part), parts[0] ?? "");
}

function mergeCueText(left: string, right: string): string {
  const first = left.replace(/\s+/g, " ").trim();
  const second = right.replace(/\s+/g, " ").trim();
  if (!first) return sentenceCase(second);
  if (!second) return sentenceCase(first);
  const joiner = /[,:;—.!?~]$/.test(first) ? " " : ", ";
  return sentenceCase(`${first}${joiner}${second.charAt(0).toLocaleLowerCase()}${second.slice(1)}`);
}

export function parseSpeakerPalette(value: unknown): SpeakerPaletteEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SPEAKER_PALETTE) {
    fail(`speaker_palette must contain between 1 and ${MAX_SPEAKER_PALETTE} entries`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const label = `speaker_palette[${index}]`;
    if (!isRecord(entry)) fail(`${label} must be an object`);
    rejectUnknownKeys(entry, ["speaker_label", "color"], label);
    const speaker_label = requiredText(entry.speaker_label, `${label}.speaker_label`, 128);
    const color = requiredText(entry.color, `${label}.color`, 7);
    if (!HEX_COLOR_PATTERN.test(color)) fail(`${label}.color must be a #RRGGBB hex color`);
    const key = speaker_label.toLocaleLowerCase();
    if (seen.has(key)) fail(`speaker_palette contains a duplicate speaker_label: ${speaker_label}`);
    seen.add(key);
    return { speaker_label, color: color.toUpperCase() };
  });
}

export function parseShotChanges(value: unknown): ShotChange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SHOT_CHANGES) fail(`shot_changes must be an array with at most ${MAX_SHOT_CHANGES} entries`);
  let previous = -1;
  return value.map((entry, index) => {
    const label = `shot_changes[${index}]`;
    if (!isRecord(entry)) fail(`${label} must be an object`);
    rejectUnknownKeys(entry, ["time_seconds", "speaker_label"], label);
    const time_seconds = boundedNumber(entry.time_seconds, `${label}.time_seconds`, 0, 86_400, NaN);
    if (!(time_seconds >= previous)) fail(`${label}.time_seconds must be in non-decreasing order`);
    previous = time_seconds;
    return { time_seconds, speaker_label: requiredText(entry.speaker_label, `${label}.speaker_label`, 128) };
  });
}

function groupSpeakerCues(words: readonly TranscriptWord[], mergeGapSeconds: number): DraftCue[] {
  const cues: DraftCue[] = [];
  const lastBySpeaker = new Map<string, DraftCue>();
  for (const word of words) {
    const speaker = word.speaker_label?.trim() || UNKNOWN_SPEAKER;
    const previous = lastBySpeaker.get(speaker);
    if (previous && word.start_seconds - previous.end_seconds <= mergeGapSeconds + EPSILON) {
      previous.words.push(word);
      previous.end_seconds = Math.max(previous.end_seconds, word.end_seconds);
      continue;
    }
    const cue: DraftCue = {
      speaker_label: speaker,
      words: [word],
      start_seconds: word.start_seconds,
      end_seconds: word.end_seconds,
      merged_cue_count: 1,
      aligned_to_shot: false,
      stack_slot: 0,
      review_stack: false,
    };
    cues.push(cue);
    lastBySpeaker.set(speaker, cue);
  }
  return cues;
}

function lastSameSpeakerCue(cues: readonly DraftCue[], speaker: string): DraftCue | undefined {
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (cues[index].speaker_label === speaker) return cues[index];
  }
  return undefined;
}

function mergeMicroCues(cues: DraftCue[], minSoloSeconds: number, combineGapSeconds: number): DraftCue[] {
  const merged: DraftCue[] = [];
  for (const cue of cues) {
    const previous = lastSameSpeakerCue(merged, cue.speaker_label);
    const duration = cue.end_seconds - cue.start_seconds;
    const previousDuration = previous ? previous.end_seconds - previous.start_seconds : Number.POSITIVE_INFINITY;
    const gap = previous ? cue.start_seconds - previous.end_seconds : Number.POSITIVE_INFINITY;
    if (previous && gap <= combineGapSeconds + EPSILON && (previousDuration < minSoloSeconds || duration < minSoloSeconds)) {
      previous.words.push(...cue.words);
      previous.end_seconds = Math.max(previous.end_seconds, cue.end_seconds);
      previous.merged_cue_count += cue.merged_cue_count;
      continue;
    }
    merged.push({ ...cue, words: [...cue.words] });
  }
  return merged;
}

function assignStacks(cues: DraftCue[], warnings: string[]): number {
  const ordered = [...cues].sort((left, right) => left.start_seconds - right.start_seconds || left.end_seconds - right.end_seconds);
  let stacked = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    let slot = 0;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const other = ordered[earlier];
      if (other.speaker_label === ordered[index].speaker_label) continue;
      if (!overlaps(ordered[index].start_seconds, ordered[index].end_seconds, other.start_seconds, other.end_seconds)) continue;
      slot = Math.max(slot, other.stack_slot + 1);
    }
    if (slot > 0) stacked += 1;
    if (slot >= MAX_STACK_SLOTS) {
      warnings.push(`cue starting at ${round(ordered[index].start_seconds)}s overlaps ${MAX_STACK_SLOTS}+ speakers; extra lines share the top stack slot and need a visual review`);
      slot = MAX_STACK_SLOTS - 1;
    }
    ordered[index].stack_slot = slot;
    ordered[index].review_stack = slot > 0;
  }
  return stacked;
}

function alignCuesToShots(cues: DraftCue[], shots: readonly ShotChange[], minHoldSeconds: number, warnings: string[]): void {
  for (const cue of cues) {
    const cut = shots.find((shot) => (
      shot.speaker_label === cue.speaker_label
      && shot.time_seconds > cue.start_seconds + EPSILON
      && shot.time_seconds < cue.end_seconds - EPSILON
    ));
    if (!cut) continue;
    if (cue.end_seconds - cut.time_seconds + EPSILON >= minHoldSeconds) {
      cue.start_seconds = cut.time_seconds;
      cue.aligned_to_shot = true;
    } else {
      warnings.push(`"${joinCueText(cue.words)}" for ${cue.speaker_label} starts before the ${round(cut.time_seconds)}s shot change; clamping it would make the cue shorter than ${minHoldSeconds}s, so the original in-point was kept for review`);
    }
  }
}

function paletteColor(palette: readonly SpeakerPaletteEntry[], speaker: string): string | null {
  const match = palette.find((entry) => entry.speaker_label.toLocaleLowerCase() === speaker.toLocaleLowerCase());
  return match?.color ?? null;
}

function applyBoundary(): string {
  return "Premiere does not expose a supported API to create speaker-colored stacked graphic captions from raw text. This plan never changes Premiere. Import timing with create_caption_track only after review, then apply speaker colors and stack positions in Essential Graphics, or place a reviewed MOGRT per cue. Do not invent a color for an uncertain speaker.";
}

export function planReactionCaptions(input: Record<string, unknown>): ReactionCaptionPlan {
  if (!isRecord(input)) fail("arguments must be an object");
  rejectUnknownKeys(input, [
    "word_timeline", "speaker_palette", "shot_changes", "frame_rate",
    "merge_gap_seconds", "min_solo_cue_seconds", "combine_gap_seconds", "min_hold_seconds",
  ], "arguments");
  const timeline: WordTimeline = validateWordTimeline(input.word_timeline);
  const palette = parseSpeakerPalette(input.speaker_palette);
  const shots = parseShotChanges(input.shot_changes);
  const rate = frameRate(input.frame_rate);
  const mergeGap = boundedNumber(input.merge_gap_seconds, "merge_gap_seconds", 0, 5, 0.12);
  const minSolo = boundedNumber(input.min_solo_cue_seconds, "min_solo_cue_seconds", 0.15, 3, 0.45);
  const combineGap = boundedNumber(input.combine_gap_seconds, "combine_gap_seconds", 0, 5, 0.8);
  const minHold = boundedNumber(input.min_hold_seconds, "min_hold_seconds", 0.15, 3, 0.35);
  const warnings: string[] = [];

  const grouped = groupSpeakerCues(timeline.words, mergeGap);
  const combined = mergeMicroCues(grouped, minSolo, combineGap);
  alignCuesToShots(combined, shots, minHold, warnings);
  const stackedOverlapCount = assignStacks(combined, warnings);

  const uncertain = new Set<string>();
  const cues: ReactionCaptionCue[] = combined.map((cue, index) => {
    const color = paletteColor(palette, cue.speaker_label);
    const speakerUncertain = color === null;
    if (speakerUncertain) uncertain.add(cue.speaker_label);
    return {
      index: index + 1,
      text: renderCueText(cue, mergeGap),
      start_seconds: round(cue.start_seconds),
      end_seconds: round(cue.end_seconds),
      start_frame: secondsToFrame(cue.start_seconds, rate, "round"),
      end_frame: Math.max(secondsToFrame(cue.end_seconds, rate, "round"), secondsToFrame(cue.start_seconds, rate, "round") + 1),
      speaker_label: cue.speaker_label,
      color,
      uncertain: speakerUncertain,
      stack_slot: cue.stack_slot,
      position: { x: 0.5, y: round(MAIN_CAPTION_Y - cue.stack_slot * STACK_STEP, 3) },
      merged_cue_count: cue.merged_cue_count,
      aligned_to_shot: cue.aligned_to_shot,
      review_stack: cue.review_stack,
    };
  });

  if (uncertain.size) {
    warnings.push(`uncertain speaker(s) with no palette color: ${[...uncertain].join(", ")}. Leave them uncolored and ask before assigning a color.`);
  }

  const speakers = [...new Set(combined.map((cue) => cue.speaker_label))];
  return {
    cues,
    cue_count: cues.length,
    stacked_overlap_count: stackedOverlapCount,
    uncertain_speakers: [...uncertain],
    speakers,
    palette,
    warnings,
    assumptions: [
      "Same-speaker words closer than merge_gap_seconds become one cue; a flash-length cue then combines with the next same-speaker cue using a comma.",
      "Overlapping different-speaker cues stack: the earlier in-point stays on the main (bottom) line; later talkers move up one slot.",
      "A caption never receives a guessed color. Missing palette entries stay uncertain until the editor names the speaker.",
      "Labeled shot changes clamp a matching speaker's in-point forward when that still leaves a readable hold.",
    ],
    applied: false,
    apply_boundary: applyBoundary(),
    routes: [...REACTION_SHORTS_ROUTES],
    next_steps: [
      "Review uncertain_speakers and stacked cues before applying anything in Premiere.",
      "Create or select one timeline per Short, then style reviewed cues as graphic captions with the returned colors and stack positions.",
      "Call export_sequence_review_frames around stacked and shot-aligned cues; a successful plan is not visual verification.",
    ],
    plan_revision: digestWordTimeline(timeline, { palette, shots, rate, mergeGap, minSolo, combineGap, minHold }),
    evidence: {
      source_project_item_id: timeline.source_project_item_id,
      transcript_revision: timeline.transcript_revision,
      word_count: timeline.words.length,
      duration_seconds: timeline.duration_seconds,
      frame_rate: rate,
    },
  };
}

function subscribeCopy(value: unknown, selectedBrand: ShortBrand): string {
  const supplied = optionalText(value, "copy", 80);
  if (supplied) return supplied;
  if (selectedBrand === "cafe") return "Subscribe for more gaming";
  return "Subscribe for more";
}

export function planShortSubscribeCta(input: Record<string, unknown>): ShortSubscribeCtaPlan {
  if (!isRecord(input)) fail("arguments must be an object");
  rejectUnknownKeys(input, ["duration_seconds", "at_ratio", "hold_seconds", "hook_end_seconds", "frame_rate", "brand", "copy", "platform"], "arguments");
  if (input.duration_seconds === undefined) fail("duration_seconds is required");
  const duration = boundedNumber(input.duration_seconds, "duration_seconds", 3, 180, 3);
  const atRatio = boundedNumber(input.at_ratio, "at_ratio", 0.4, 0.9, 2 / 3);
  const hold = boundedNumber(input.hold_seconds, "hold_seconds", 1, 5, 2);
  const hookEnd = input.hook_end_seconds === undefined
    ? 0
    : boundedNumber(input.hook_end_seconds, "hook_end_seconds", 0, duration, 0);
  const rate = frameRate(input.frame_rate);
  const selectedBrand = brand(input.brand);
  const platform = input.platform === undefined ? "youtube_shorts" : input.platform;
  if (typeof platform !== "string" || !(platform in PLATFORM_SAFE_ZONES)) {
    fail(`platform must be one of: ${Object.keys(PLATFORM_SAFE_ZONES).join(", ")}`);
  }
  const copy = subscribeCopy(input.copy, selectedBrand);
  const warnings: string[] = [];
  let start = duration * atRatio;
  if (hookEnd > start) {
    start = hookEnd;
    warnings.push(`subscribe CTA was moved to ${round(start)}s so it starts after the supplied hook`);
  }
  if (start + hold > duration + EPSILON) {
    start = Math.max(0, duration - hold);
    warnings.push(`subscribe CTA was clamped to the last ${hold}s so it finishes inside the Short`);
  }
  const end = Math.min(duration, start + hold);
  if (selectedBrand === "cafe") {
    warnings.push("Use Cafe typography and colors only. Watch Club fonts, name cards, and speaker accents do not apply.");
  }
  const profile = PLATFORM_SAFE_ZONES[platform as SafeZonePlatform];
  return {
    start_seconds: round(start),
    end_seconds: round(end),
    start_frame: secondsToFrame(start, rate, "round"),
    end_frame: secondsToFrame(end, rate, "round"),
    hold_seconds: hold,
    copy,
    platform: platform as SafeZonePlatform,
    brand: selectedBrand,
    position: { x: 0.5, y: CTA_Y },
    size: { width: CTA_WIDTH, height: CTA_HEIGHT },
    style: {
      fill: selectedBrand === "watch_club" ? "#F4EFE4" : "#FFFFFF",
      text: selectedBrand === "watch_club" ? "#2B2118" : "#111111",
      icon: "#FF0000",
      note: selectedBrand === "watch_club"
        ? "Ivory brush panel with a small YouTube-red subscribe mark. Keep this quieter than the captions."
        : "Small white condensed label with a YouTube-red subscribe mark. Do not use Watch Club Punkboy or speaker-color name cards.",
    },
    warnings,
    assumptions: [
      `Default placement is ${round(atRatio, 4)} of duration (about two-thirds) for roughly ${hold}s.`,
      "The prompt is an on-picture overlay, not a YouTube Studio end screen. Already-published Shorts cannot receive burned-in footage changes at the same URL.",
      `Keep the CTA above the ${platform} bottom UI zone (starts near y=${profile.zones.find((zone) => zone.id.includes("bottom"))?.y ?? 0.82}).`,
    ],
    applied: false,
    apply_boundary: "This plan never changes Premiere or uploads to YouTube. Place a reviewed MOGRT or pre-rendered overlay at the returned times, then inspect review frames.",
    routes: [...SUBSCRIBE_CTA_ROUTES],
    next_steps: [
      "Place the subscribe overlay on a video track above the picture for the returned range only.",
      "Call check_caption_safe_zone with the returned rectangle, then export_sequence_review_frames at the CTA in-point.",
    ],
    plan_revision: `sha256:${createHash("sha256").update(JSON.stringify({ duration, atRatio, hold, hookEnd, rate, selectedBrand, platform, copy })).digest("hex")}`,
    evidence: { duration_seconds: duration, at_ratio: atRatio, frame_rate: rate },
  };
}

function sanitizePathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\\/]/.test(trimmed) || trimmed === "." || trimmed === "..") fail(`${label} must be a single folder or file name, not a path`);
  if (!/^[\p{L}\p{N} _.'"!?:+,&~×()[\]-]+$/u.test(trimmed)) fail(`${label} may contain letters, numbers, spaces, and typical title punctuation`);
  return trimmed;
}

function isAbsoluteExportRoot(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function pathApiFor(root: string): typeof path.win32 | typeof path.posix {
  if (/^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\")) return path.win32;
  return path.posix;
}

export function planShortExportFolder(input: Record<string, unknown>): ShortExportFolderPlan {
  if (!isRecord(input)) fail("arguments must be an object");
  rejectUnknownKeys(input, ["export_root", "series_name", "title", "brand", "extension"], "arguments");
  const exportRoot = requiredText(input.export_root, "export_root", 4096);
  if (!isAbsoluteExportRoot(exportRoot)) fail("export_root must be an absolute path");
  const series = sanitizePathSegment(requiredText(input.series_name, "series_name", 80), "series_name");
  const title = sanitizePathSegment(requiredText(input.title, "title", 120), "title");
  const selectedBrand = brand(input.brand);
  const extension = (optionalText(input.extension, "extension", 8) ?? "mp4").replace(/^\./, "").toLocaleLowerCase();
  if (!/^[a-z0-9]{2,8}$/.test(extension)) fail("extension must be 2-8 alphanumeric characters");
  const api = pathApiFor(exportRoot);
  const recommendedDirectory = api.join(exportRoot, series);
  const recommendedFilename = `${title}.${extension}`;
  const recommendedPath = api.join(recommendedDirectory, recommendedFilename);
  const isolation = selectedBrand === "cafe"
    ? "Export Cafe Shorts only into the Cafe exports tree. Do not reuse Watch Club speaker colors, Punkboy, or name-card graphics."
    : selectedBrand === "watch_club"
      ? "Export Watch Club Shorts into the Watch Club ALL Shorts tree, creating the series folder when it is missing."
      : "Keep this export inside the supplied root and series folder; do not mix brand assets across channels.";
  return {
    export_root: exportRoot,
    series_name: series,
    title,
    brand: selectedBrand,
    recommended_directory: recommendedDirectory,
    recommended_filename: recommendedFilename,
    recommended_path: recommendedPath,
    create_directory_if_missing: true,
    brand_isolation: isolation,
    warnings: [],
    assumptions: [
      "This plan does not create folders or write files. Create recommended_directory if it is missing, then export_sequence to recommended_path.",
      "One sequence per Short. Do not overwrite a reviewed export without explicit approval.",
    ],
    applied: false,
    apply_boundary: "Local path planning only. It never creates a directory, starts an export, or contacts Premiere.",
    routes: [...SHORT_EXPORT_ROUTES],
    next_steps: [
      `Create ${recommendedDirectory} if it does not exist.`,
      `Call export_sequence to ${recommendedPath} after caption and CTA review, then verify_delivery_file.`,
    ],
    plan_revision: `sha256:${createHash("sha256").update(JSON.stringify({ exportRoot, series, title, selectedBrand, extension })).digest("hex")}`,
  };
}
