import { createHash } from "node:crypto";

/**
 * Local-only social/video platform delivery specs and planning math.
 * Nothing here contacts Premiere or the network; every function is pure and deterministic.
 */

export const SPEC_DISCLAIMER =
  "Platform limits are approximate, community-documented values as of 2026 and change without notice; confirm against each platform's current upload guidance before publishing.";

export const PLATFORM_IDS = [
  "tiktok",
  "instagram_reels",
  "instagram_feed",
  "instagram_story",
  "youtube_shorts",
  "youtube",
  "linkedin",
  "x",
  "facebook_reels",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type AspectRatio = { w: number; h: number };
export type SafeZone = { top: number; bottom: number; left: number; right: number };

export type PlatformSpec = {
  id: PlatformId;
  display_name: string;
  aspect: AspectRatio;
  /** Additional aspect ratios the platform accepts without penalty. */
  alternate_aspects: AspectRatio[];
  width: number;
  height: number;
  frame_rates: number[];
  min_duration_seconds: number;
  max_duration_seconds: number;
  /** Soft ceiling the platform or its algorithm favors; undefined means same as max. */
  recommended_max_duration_seconds?: number;
  max_file_size_mb: number;
  video_codec: "H.264";
  audio_codec: "AAC";
  recommended_video_bitrate_mbps: number;
  audio_bitrate_kbps: number;
  container: "mp4";
  title_max_chars: number;
  description_max_chars: number;
  hashtag_max_count: number;
  hashtag_recommended_count: number;
  /** Normalized insets (0..1) that platform UI may cover. */
  safe_zone: SafeZone;
  /** Normalized vertical anchor (0 = top, 1 = bottom) for caption placement. */
  caption_anchor_y: number;
  vertical: boolean;
  notes: string[];
};

const VERTICAL: AspectRatio = { w: 9, h: 16 };
const LANDSCAPE: AspectRatio = { w: 16, h: 9 };
const SQUARE: AspectRatio = { w: 1, h: 1 };
const PORTRAIT_4_5: AspectRatio = { w: 4, h: 5 };

const SOCIAL_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const YOUTUBE_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

export const PLATFORM_SPECS: Readonly<Record<PlatformId, PlatformSpec>> = {
  tiktok: {
    id: "tiktok",
    display_name: "TikTok",
    aspect: VERTICAL,
    alternate_aspects: [SQUARE],
    width: 1080,
    height: 1920,
    frame_rates: SOCIAL_FPS,
    min_duration_seconds: 1,
    max_duration_seconds: 600,
    recommended_max_duration_seconds: 60,
    max_file_size_mb: 4096,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 10,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 100,
    description_max_chars: 4000,
    hashtag_max_count: 30,
    hashtag_recommended_count: 5,
    safe_zone: { top: 0.12, bottom: 0.3, left: 0.05, right: 0.16 },
    caption_anchor_y: 0.62,
    vertical: true,
    notes: [
      "Uploads up to 10 minutes are accepted; 15-60 seconds performs best for discovery.",
      "Mobile uploads are capped near 288 MB; desktop uploads allow up to 4 GB.",
      "Keep on-screen text out of the right action rail and the bottom caption/UI area.",
    ],
  },
  instagram_reels: {
    id: "instagram_reels",
    display_name: "Instagram Reels",
    aspect: VERTICAL,
    alternate_aspects: [PORTRAIT_4_5, SQUARE],
    width: 1080,
    height: 1920,
    frame_rates: SOCIAL_FPS,
    min_duration_seconds: 3,
    max_duration_seconds: 180,
    recommended_max_duration_seconds: 90,
    max_file_size_mb: 4096,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 125,
    description_max_chars: 2200,
    hashtag_max_count: 30,
    hashtag_recommended_count: 5,
    safe_zone: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.2 },
    caption_anchor_y: 0.58,
    vertical: true,
    notes: [
      "Reels up to 3 minutes are accepted; Reels under 90 seconds remain eligible for recommendation surfaces.",
      "The first 125 caption characters show before truncation; the caption body is treated as the title here.",
      "Feed preview crops the center 4:5, so keep essential content inside the middle 1080x1350.",
    ],
  },
  instagram_feed: {
    id: "instagram_feed",
    display_name: "Instagram Feed (4:5)",
    aspect: PORTRAIT_4_5,
    alternate_aspects: [SQUARE, VERTICAL],
    width: 1080,
    height: 1350,
    frame_rates: SOCIAL_FPS,
    min_duration_seconds: 3,
    max_duration_seconds: 60,
    max_file_size_mb: 4096,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 125,
    description_max_chars: 2200,
    hashtag_max_count: 30,
    hashtag_recommended_count: 5,
    safe_zone: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
    caption_anchor_y: 0.85,
    vertical: false,
    notes: [
      "4:5 occupies the most feed height without cropping; longer feed videos are surfaced as Reels.",
      "Feed video posts longer than 60 seconds are converted to Reels by the platform.",
    ],
  },
  instagram_story: {
    id: "instagram_story",
    display_name: "Instagram Story",
    aspect: VERTICAL,
    alternate_aspects: [],
    width: 1080,
    height: 1920,
    frame_rates: SOCIAL_FPS,
    min_duration_seconds: 1,
    max_duration_seconds: 60,
    max_file_size_mb: 4096,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 0,
    description_max_chars: 0,
    hashtag_max_count: 10,
    hashtag_recommended_count: 1,
    safe_zone: { top: 0.14, bottom: 0.2, left: 0.05, right: 0.05 },
    caption_anchor_y: 0.7,
    vertical: true,
    notes: [
      "Stories have no text caption field; hashtags are stickers and count toward a 10-sticker practical limit.",
      "Stories longer than 60 seconds are split into multiple cards.",
    ],
  },
  youtube_shorts: {
    id: "youtube_shorts",
    display_name: "YouTube Shorts",
    aspect: VERTICAL,
    alternate_aspects: [SQUARE],
    width: 1080,
    height: 1920,
    frame_rates: YOUTUBE_FPS,
    min_duration_seconds: 1,
    max_duration_seconds: 180,
    recommended_max_duration_seconds: 60,
    max_file_size_mb: 262144,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 10,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 100,
    description_max_chars: 5000,
    hashtag_max_count: 15,
    hashtag_recommended_count: 3,
    safe_zone: { top: 0.12, bottom: 0.28, left: 0.05, right: 0.15 },
    caption_anchor_y: 0.64,
    vertical: true,
    notes: [
      "Shorts up to 3 minutes are accepted (raised from 60 seconds); vertical or square aspect is required for Shorts classification.",
      "More than 15 hashtags causes YouTube to ignore all hashtags on the upload.",
    ],
  },
  youtube: {
    id: "youtube",
    display_name: "YouTube (16:9)",
    aspect: LANDSCAPE,
    alternate_aspects: [],
    width: 1920,
    height: 1080,
    frame_rates: YOUTUBE_FPS,
    min_duration_seconds: 1,
    max_duration_seconds: 43200,
    max_file_size_mb: 262144,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 384,
    container: "mp4",
    title_max_chars: 100,
    description_max_chars: 5000,
    hashtag_max_count: 15,
    hashtag_recommended_count: 3,
    safe_zone: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
    caption_anchor_y: 0.85,
    vertical: false,
    notes: [
      "Unverified accounts are limited to 15-minute uploads; verified accounts allow up to 12 hours or 256 GB.",
      "Use 12 Mbps or higher for 1080p at 50/60 fps; 4K uploads should be 35-45 Mbps.",
      "Upload sidecar captions instead of burn-in so viewers can toggle them.",
    ],
  },
  linkedin: {
    id: "linkedin",
    display_name: "LinkedIn",
    aspect: LANDSCAPE,
    alternate_aspects: [SQUARE, VERTICAL, PORTRAIT_4_5],
    width: 1920,
    height: 1080,
    frame_rates: [24, 25, 30, 60],
    min_duration_seconds: 3,
    max_duration_seconds: 600,
    recommended_max_duration_seconds: 90,
    max_file_size_mb: 5120,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 200,
    description_max_chars: 3000,
    hashtag_max_count: 30,
    hashtag_recommended_count: 3,
    safe_zone: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    caption_anchor_y: 0.85,
    vertical: false,
    notes: [
      "Native video posts accept 3 seconds to 10 minutes and up to 5 GB; feed autoplay is muted so captions matter.",
      "Post text is limited to 3000 characters; roughly the first 210 characters show before 'see more'.",
    ],
  },
  x: {
    id: "x",
    display_name: "X (Twitter)",
    aspect: LANDSCAPE,
    alternate_aspects: [SQUARE, VERTICAL],
    width: 1920,
    height: 1080,
    frame_rates: [24, 25, 30, 40, 60],
    min_duration_seconds: 0.5,
    max_duration_seconds: 600,
    recommended_max_duration_seconds: 140,
    max_file_size_mb: 512,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 5,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 280,
    description_max_chars: 280,
    hashtag_max_count: 10,
    hashtag_recommended_count: 2,
    safe_zone: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    caption_anchor_y: 0.85,
    vertical: false,
    notes: [
      "Free accounts are limited to 2 minutes 20 seconds (140 s); Premium accounts can upload longer video.",
      "Post text (title and description share the same 280-character field) counts hashtags toward the limit.",
      "Video uploads are capped at 512 MB and re-encoded; keep bitrate modest.",
    ],
  },
  facebook_reels: {
    id: "facebook_reels",
    display_name: "Facebook Reels",
    aspect: VERTICAL,
    alternate_aspects: [],
    width: 1080,
    height: 1920,
    frame_rates: SOCIAL_FPS,
    min_duration_seconds: 3,
    max_duration_seconds: 90,
    max_file_size_mb: 4096,
    video_codec: "H.264",
    audio_codec: "AAC",
    recommended_video_bitrate_mbps: 8,
    audio_bitrate_kbps: 128,
    container: "mp4",
    title_max_chars: 100,
    description_max_chars: 2200,
    hashtag_max_count: 30,
    hashtag_recommended_count: 5,
    safe_zone: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.2 },
    caption_anchor_y: 0.58,
    vertical: true,
    notes: [
      "Facebook Reels accept up to 90 seconds; the description doubles as the discoverable caption.",
      "Keep essential content inside the center 4:5 region for feed preview cropping.",
    ],
  },
};

export const REFRAME_STRATEGIES = ["auto_reframe", "pad_blur", "center_crop", "letterbox"] as const;
export type ReframeStrategy = (typeof REFRAME_STRATEGIES)[number];

export const CONTENT_FLAGS = ["ai_generated", "paid_partnership", "music_licensed"] as const;
export type ContentFlag = (typeof CONTENT_FLAGS)[number];

const ASPECT_TOLERANCE = 0.01;
const FRAME_RATE_TOLERANCE = 0.01;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(",")}}`;
}

export function digestInputs(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && (PLATFORM_IDS as readonly string[]).includes(value);
}

export function getPlatformSpec(id: unknown): PlatformSpec {
  if (!isPlatformId(id)) throw new Error(`platform must be one of: ${PLATFORM_IDS.join(", ")}`);
  return PLATFORM_SPECS[id];
}

/** Reduced integer aspect label such as "16:9" for arbitrary dimensions. */
export function aspectLabel(width: number, height: number): string {
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

export function aspectMatches(width: number, height: number, aspect: AspectRatio, tolerance = ASPECT_TOLERANCE): boolean {
  const actual = width / height;
  const target = aspect.w / aspect.h;
  return Math.abs(actual - target) / target <= tolerance;
}

/** Keep the source frame rate when the platform accepts it, else pick the nearest accepted rate (ties resolve to the lower rate). */
export function chooseFrameRate(source: number, allowed: readonly number[]): { frame_rate: number; changed: boolean } {
  const exact = allowed.find((rate) => Math.abs(rate - source) <= FRAME_RATE_TOLERANCE);
  if (exact !== undefined) return { frame_rate: exact, changed: false };
  const sorted = [...allowed].sort((a, b) => a - b);
  let best = sorted[0];
  for (const rate of sorted) if (Math.abs(rate - source) < Math.abs(best - source)) best = rate;
  return { frame_rate: best, changed: true };
}

export type ReframeMath = {
  fit_scale_percent: number;
  fill_scale_percent: number;
  fit_frame: { width: number; height: number };
  fill_frame: { width: number; height: number };
  /** Pixels of target frame left uncovered by a fit (letterbox/pillarbox) placement. */
  fit_padding: { horizontal: number; vertical: number };
  /** Pixels of scaled source that spill outside the target frame under a fill placement. */
  fill_overflow: { horizontal: number; vertical: number };
};

/** Scale percentages relative to a source clip placed at 100% inside a target sequence. */
export function computeReframeMath(source: { width: number; height: number }, target: { width: number; height: number }): ReframeMath {
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  const fit = Math.min(sx, sy);
  const fill = Math.max(sx, sy);
  const fitFrame = { width: Math.round(source.width * fit), height: Math.round(source.height * fit) };
  const fillFrame = { width: Math.round(source.width * fill), height: Math.round(source.height * fill) };
  return {
    fit_scale_percent: round2(fit * 100),
    fill_scale_percent: round2(fill * 100),
    fit_frame: fitFrame,
    fill_frame: fillFrame,
    fit_padding: { horizontal: Math.max(0, target.width - fitFrame.width), vertical: Math.max(0, target.height - fitFrame.height) },
    fill_overflow: { horizontal: Math.max(0, fillFrame.width - target.width), vertical: Math.max(0, fillFrame.height - target.height) },
  };
}

/** Estimated MP4 size in MB: (video Mbps + audio Mbps) x seconds / 8. */
export function estimateFileSizeMb(videoMbps: number, audioKbps: number, durationSeconds: number): number {
  return round2(((videoMbps + audioKbps / 1000) * durationSeconds) / 8);
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  return value;
}

function positiveInteger(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${max}`);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be a string of at most ${max} characters`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function specSummary(spec: PlatformSpec) {
  return {
    id: spec.id,
    display_name: spec.display_name,
    aspect: `${spec.aspect.w}:${spec.aspect.h}`,
    width: spec.width,
    height: spec.height,
    frame_rates: [...spec.frame_rates],
    min_duration_seconds: spec.min_duration_seconds,
    max_duration_seconds: spec.max_duration_seconds,
    recommended_max_duration_seconds: spec.recommended_max_duration_seconds ?? spec.max_duration_seconds,
    max_file_size_mb: spec.max_file_size_mb,
    notes: [...spec.notes],
  };
}

export type DeliverySource = {
  width: number;
  height: number;
  frame_rate: number;
  duration_seconds: number;
  has_captions?: boolean;
  sequence_id?: string;
};

export function normalizeDeliverySource(value: unknown): DeliverySource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("source must be an object");
  const raw = value as Record<string, unknown>;
  const allowed = ["width", "height", "frame_rate", "duration_seconds", "has_captions", "sequence_id"];
  const unknown = Object.keys(raw).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`source has an unknown field: ${unknown}`);
  const hasCaptions = optionalBoolean(raw.has_captions, "source.has_captions");
  const sequenceId = optionalText(raw.sequence_id, "source.sequence_id", 512);
  return {
    width: positiveInteger(raw.width, "source.width", 16384),
    height: positiveInteger(raw.height, "source.height", 16384),
    frame_rate: finiteNumber(raw.frame_rate, "source.frame_rate", 1, 240),
    duration_seconds: finiteNumber(raw.duration_seconds, "source.duration_seconds", 0.001, 172800),
    ...(hasCaptions === undefined ? {} : { has_captions: hasCaptions }),
    ...(sequenceId === undefined ? {} : { sequence_id: sequenceId }),
  };
}

export function normalizeTargets(value: unknown): PlatformId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLATFORM_IDS.length) throw new Error(`targets must contain between 1 and ${PLATFORM_IDS.length} platform ids`);
  const ids = value.map((item, index) => {
    if (!isPlatformId(item)) throw new Error(`targets[${index}] must be one of: ${PLATFORM_IDS.join(", ")}`);
    return item;
  });
  if (new Set(ids).size !== ids.length) throw new Error("targets contains duplicate platform ids");
  return ids;
}

export function normalizeStrategy(value: unknown): ReframeStrategy {
  if (value === undefined) return "auto_reframe";
  if (typeof value !== "string" || !(REFRAME_STRATEGIES as readonly string[]).includes(value)) throw new Error(`strategy must be one of: ${REFRAME_STRATEGIES.join(", ")}`);
  return value as ReframeStrategy;
}

type PlanStep = { index: number; step: string; routes: string[]; detail: string; parameters?: Record<string, unknown> };

function reframeSteps(strategy: ReframeStrategy, spec: PlatformSpec, math: ReframeMath, requiresReframe: boolean, dimensionsDiffer: boolean): { step?: Omit<PlanStep, "index">; notes: string[]; recipe?: Record<string, unknown> } {
  if (!requiresReframe) {
    if (!dimensionsDiffer) return { notes: ["Source already matches the target aspect and frame size; no reframe needed."] };
    return {
      step: { step: "scale_to_frame", routes: ["set_clip_scale"], detail: `Same aspect; scale clips to ${math.fit_scale_percent}% so they fill the ${spec.width}x${spec.height} frame.`, parameters: { scale: math.fit_scale_percent } },
      notes: ["Aspect ratio is unchanged; only a uniform scale is required."],
    };
  }
  switch (strategy) {
    case "auto_reframe":
      return {
        step: { step: "auto_reframe", routes: ["auto_reframe_sequence"], detail: `Run Auto Reframe to ${spec.aspect.w}:${spec.aspect.h} with motion tracking; equivalent fill scale is ${math.fill_scale_percent}%.`, parameters: { target_aspect: `${spec.aspect.w}:${spec.aspect.h}`, motion_preset: "default" } },
        notes: ["Auto Reframe tracks subjects across the crop; review any shot with multiple subjects or fast camera moves."],
      };
    case "pad_blur": {
      const recipe = {
        background_layer: { track: "V1", scale_percent: math.fill_scale_percent, effect: "Gaussian Blur", blurriness: 80, repeat_edge_pixels: true, note: "Duplicate of the source scaled to fill the frame; overflow is cropped by the sequence bounds." },
        foreground_layer: { track: "V2", scale_percent: math.fit_scale_percent, position: "center", note: "Original clip scaled to fit; the blurred copy shows through the padding bands." },
        padding_pixels: math.fit_padding,
      };
      return {
        step: { step: "pad_blur_layers", routes: ["apply_effect", "set_clip_scale"], detail: `Two-layer pad: background copy at ${math.fill_scale_percent}% with Gaussian Blur under a foreground at ${math.fit_scale_percent}%.`, parameters: recipe },
        notes: ["Pad-blur preserves the full source frame; the blurred background fills the remaining area."],
        recipe,
      };
    }
    case "center_crop":
      return {
        step: { step: "center_crop", routes: ["set_clip_scale", "set_clip_position"], detail: `Scale clips to ${math.fill_scale_percent}% centered; ${math.fill_overflow.horizontal}x${math.fill_overflow.vertical} px are cropped.`, parameters: { scale: math.fill_scale_percent, position: "center", cropped_pixels: math.fill_overflow } },
        notes: ["Center crop discards the frame edges; verify that subjects stay inside the crop."],
      };
    case "letterbox":
      return {
        step: { step: "letterbox", routes: ["set_clip_scale"], detail: `Scale clips to ${math.fit_scale_percent}%; ${math.fit_padding.horizontal}x${math.fit_padding.vertical} px of bars remain.`, parameters: { scale: math.fit_scale_percent, padding_pixels: math.fit_padding } },
        notes: ["Letterbox keeps the full frame but leaves black bars that vertical platforms penalize in discovery."],
      };
  }
}

export function planPlatformDeliveryMatrix(input: { source: unknown; targets: unknown; strategy?: unknown; export_preset_hint?: unknown }) {
  const source = normalizeDeliverySource(input.source);
  const targets = normalizeTargets(input.targets);
  const strategy = normalizeStrategy(input.strategy);
  const presetHint = optionalText(input.export_preset_hint, "export_preset_hint", 256);
  const warnings: string[] = [];
  const counts = { targets: targets.length, requires_reframe: 0, trim_required: 0, too_short: 0, frame_rate_changed: 0, over_file_limit: 0, captions_recommended: 0 };
  const routeSet = new Set<string>();

  const plans = targets.map((id) => {
    const spec = PLATFORM_SPECS[id];
    const rate = chooseFrameRate(source.frame_rate, spec.frame_rates);
    if (rate.changed) {
      counts.frame_rate_changed++;
      warnings.push(`${spec.display_name}: source frame rate ${source.frame_rate} is not accepted; sequence will use ${rate.frame_rate} fps.`);
    }
    const math = computeReframeMath(source, spec);
    const requiresReframe = !aspectMatches(source.width, source.height, spec.aspect);
    const dimensionsDiffer = source.width !== spec.width || source.height !== spec.height;
    if (requiresReframe) counts.requires_reframe++;
    const reframe = reframeSteps(strategy, spec, math, requiresReframe, dimensionsDiffer);

    let status: "ok" | "trim_required" | "too_short" = "ok";
    let overage = 0;
    if (source.duration_seconds > spec.max_duration_seconds) {
      status = "trim_required";
      overage = round2(source.duration_seconds - spec.max_duration_seconds);
      counts.trim_required++;
      warnings.push(`${spec.display_name}: duration ${source.duration_seconds}s exceeds the ${spec.max_duration_seconds}s limit by ${overage}s; trim before export.`);
    } else if (source.duration_seconds < spec.min_duration_seconds) {
      status = "too_short";
      counts.too_short++;
      warnings.push(`${spec.display_name}: duration ${source.duration_seconds}s is below the ${spec.min_duration_seconds}s minimum.`);
    }
    const recommendedMax = spec.recommended_max_duration_seconds ?? spec.max_duration_seconds;
    const aboveRecommended = status === "ok" && source.duration_seconds > recommendedMax;
    if (aboveRecommended) warnings.push(`${spec.display_name}: duration ${source.duration_seconds}s is above the recommended ${recommendedMax}s but under the hard limit.`);

    const plannedDuration = Math.min(source.duration_seconds, spec.max_duration_seconds);
    const estimatedMb = estimateFileSizeMb(spec.recommended_video_bitrate_mbps, spec.audio_bitrate_kbps, plannedDuration);
    const withinLimit = estimatedMb <= spec.max_file_size_mb;
    if (!withinLimit) {
      counts.over_file_limit++;
      warnings.push(`${spec.display_name}: estimated ${estimatedMb} MB exceeds the ${spec.max_file_size_mb} MB upload limit; lower the bitrate or shorten the cut.`);
    }

    const burnIn = spec.vertical && source.has_captions !== true;
    if (burnIn) counts.captions_recommended++;

    const steps: PlanStep[] = [];
    const push = (step: Omit<PlanStep, "index">) => {
      steps.push({ index: steps.length, ...step });
      for (const route of step.routes) routeSet.add(route);
    };
    push({ step: "clone_sequence", routes: ["duplicate_sequence", "manage_sequences_uxp"], detail: `Duplicate ${source.sequence_id ?? "the source sequence"} as a ${spec.display_name} delivery sequence.`, parameters: { ...(source.sequence_id ? { sequence_id: source.sequence_id } : {}), name_suffix: `_${spec.id}` } });
    push({ step: "set_sequence_settings", routes: ["set_sequence_settings"], detail: `Set frame size ${spec.width}x${spec.height} at ${rate.frame_rate} fps.`, parameters: { width: spec.width, height: spec.height, frame_rate: rate.frame_rate } });
    if (reframe.step) push(reframe.step);
    if (burnIn) push({ step: "captions", routes: ["create_caption_track"], detail: `Import a reviewed caption artifact and burn in near y=${spec.caption_anchor_y} inside the safe zone.`, parameters: { anchor_y: spec.caption_anchor_y, safe_zone: spec.safe_zone } });
    push({ step: "validate_export", routes: ["validate_project_for_export"], detail: "Validate the delivery sequence and media before rendering." });
    push({ step: "export", routes: ["export_sequence"], detail: `Export ${spec.container.toUpperCase()} ${spec.video_codec}/${spec.audio_codec} at ~${spec.recommended_video_bitrate_mbps} Mbps${presetHint ? ` using preset hint "${presetHint}"` : ""}.`, parameters: { container: spec.container, video_codec: spec.video_codec, audio_codec: spec.audio_codec, target_bitrate_mbps: spec.recommended_video_bitrate_mbps, ...(presetHint ? { export_preset_hint: presetHint } : {}) } });
    push({ step: "verify_file", routes: ["verify_delivery_file"], detail: "Confirm the rendered file exists and is readable." });
    push({ step: "verify_conformance", routes: ["verify_delivery_conformance"], detail: `Confirm ${spec.width}x${spec.height}, ${rate.frame_rate} fps, ${spec.container}/${spec.video_codec}/${spec.audio_codec}, duration <= ${spec.max_duration_seconds}s.`, parameters: { width: spec.width, height: spec.height, frame_rate: rate.frame_rate, max_duration_seconds: spec.max_duration_seconds } });

    return {
      platform: specSummary(spec),
      sequence_settings: { width: spec.width, height: spec.height, frame_rate: rate.frame_rate },
      frame_rate_changed: rate.changed,
      aspect_change: { from: aspectLabel(source.width, source.height), to: `${spec.aspect.w}:${spec.aspect.h}`, requires_reframe: requiresReframe },
      reframe: {
        strategy: requiresReframe ? strategy : "none",
        fit_scale_percent: math.fit_scale_percent,
        fill_scale_percent: math.fill_scale_percent,
        fit_frame: math.fit_frame,
        fill_frame: math.fill_frame,
        fit_padding: math.fit_padding,
        fill_overflow: math.fill_overflow,
        notes: reframe.notes,
        ...(reframe.recipe ? { pad_blur_recipe: reframe.recipe } : {}),
      },
      duration_fit: { status, overage_seconds: overage, planned_duration_seconds: plannedDuration, above_recommended: aboveRecommended, recommended_max_duration_seconds: recommendedMax },
      captions: { required_burn_in: burnIn, anchor_y: spec.caption_anchor_y, safe_zone: { ...spec.safe_zone } },
      export: {
        container: spec.container,
        video_codec: spec.video_codec,
        audio_codec: spec.audio_codec,
        target_bitrate_mbps: spec.recommended_video_bitrate_mbps,
        audio_bitrate_kbps: spec.audio_bitrate_kbps,
        estimated_file_size_mb: estimatedMb,
        max_file_size_mb: spec.max_file_size_mb,
        within_limit: withinLimit,
      },
      steps,
    };
  });

  const evidence = { source, targets, strategy, ...(presetHint ? { export_preset_hint: presetHint } : {}), spec_version: "2026-approximate" };
  return {
    plan_revision: digestInputs(evidence),
    evidence,
    strategy,
    targets: plans,
    summary: counts,
    routes: [...routeSet],
    next_steps: ["Review each target's steps, then apply them in order with the listed routes.", "Re-run validate_platform_publish_package with the rendered file's real dimensions, duration, and size before uploading."],
    warnings,
    assumptions: [SPEC_DISCLAIMER, "Scale percentages assume the source clip sits at 100% scale inside the new sequence.", "File size estimates use constant-bitrate math; VBR renders vary by content."],
    applied: false,
  };
}

export type PublishViolation = { code: string; field: string; message: string; limit: number | string; actual: number | string };
export type PublishWarning = { code: string; field: string; message: string };

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeHashtags(raw: string[]): { normalized: string[]; invalid: Array<{ index: number; value: string; reason: string }>; duplicates: string[] } {
  const seen = new Set<string>();
  const normalized: string[] = [];
  const invalid: Array<{ index: number; value: string; reason: string }> = [];
  const duplicates: string[] = [];
  raw.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) {
      invalid.push({ index, value, reason: "empty" });
      return;
    }
    if (!trimmed.startsWith("#")) invalid.push({ index, value, reason: "missing_hash_prefix" });
    if (/\s/.test(trimmed)) invalid.push({ index, value, reason: "contains_whitespace" });
    const body = trimmed.replace(/^#+/, "").replace(/\s+/g, "");
    if (!body) {
      invalid.push({ index, value, reason: "empty" });
      return;
    }
    const key = body.toLocaleLowerCase();
    if (seen.has(key)) {
      duplicates.push(`#${body}`);
      return;
    }
    seen.add(key);
    normalized.push(`#${body}`);
  });
  return { normalized, invalid, duplicates };
}

export function validatePlatformPublishPackage(input: Record<string, unknown>) {
  const allowed = ["platform", "title", "description", "hashtags", "duration_seconds", "width", "height", "frame_rate", "file_size_bytes", "container", "video_codec", "audio_codec", "has_captions", "content_flags"];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`unknown field: ${unknown}`);
  const spec = getPlatformSpec(input.platform);
  const title = input.title === undefined ? "" : (() => { if (typeof input.title !== "string" || input.title.length > 1000) throw new Error("title must be a string of at most 1000 characters"); return input.title; })();
  const description = input.description === undefined ? "" : (() => { if (typeof input.description !== "string" || input.description.length > 10000) throw new Error("description must be a string of at most 10000 characters"); return input.description; })();
  const hashtagsRaw = input.hashtags === undefined ? [] : (() => {
    if (!Array.isArray(input.hashtags) || input.hashtags.length > 100) throw new Error("hashtags must be an array of at most 100 strings");
    return input.hashtags.map((item, index) => { if (typeof item !== "string" || item.length > 150) throw new Error(`hashtags[${index}] must be a string of at most 150 characters`); return item; });
  })();
  const duration = finiteNumber(input.duration_seconds, "duration_seconds", 0, 172800);
  const width = positiveInteger(input.width, "width", 16384);
  const height = positiveInteger(input.height, "height", 16384);
  const frameRate = finiteNumber(input.frame_rate, "frame_rate", 1, 240);
  const fileSizeBytes = input.file_size_bytes === undefined ? undefined : finiteNumber(input.file_size_bytes, "file_size_bytes", 0, 1e13);
  const container = optionalText(input.container, "container", 32)?.toLocaleLowerCase();
  const videoCodec = optionalText(input.video_codec, "video_codec", 64);
  const audioCodec = optionalText(input.audio_codec, "audio_codec", 64);
  const hasCaptions = optionalBoolean(input.has_captions, "has_captions");
  const flags = input.content_flags === undefined ? [] : (() => {
    if (!Array.isArray(input.content_flags) || input.content_flags.length > CONTENT_FLAGS.length) throw new Error(`content_flags must be an array of at most ${CONTENT_FLAGS.length} entries`);
    const values = input.content_flags.map((item, index) => { if (typeof item !== "string" || !(CONTENT_FLAGS as readonly string[]).includes(item)) throw new Error(`content_flags[${index}] must be one of: ${CONTENT_FLAGS.join(", ")}`); return item as ContentFlag; });
    if (new Set(values).size !== values.length) throw new Error("content_flags contains duplicates");
    return values;
  })();

  const violations: PublishViolation[] = [];
  const warnings: PublishWarning[] = [];

  if (duration > spec.max_duration_seconds) violations.push({ code: "duration_exceeds_max", field: "duration_seconds", message: `Duration ${duration}s exceeds the ${spec.display_name} maximum of ${spec.max_duration_seconds}s.`, limit: spec.max_duration_seconds, actual: duration });
  else if (duration < spec.min_duration_seconds) violations.push({ code: "duration_below_min", field: "duration_seconds", message: `Duration ${duration}s is below the ${spec.display_name} minimum of ${spec.min_duration_seconds}s.`, limit: spec.min_duration_seconds, actual: duration });
  else {
    const recommendedMax = spec.recommended_max_duration_seconds ?? spec.max_duration_seconds;
    if (duration > recommendedMax) warnings.push({ code: "duration_above_recommended", field: "duration_seconds", message: `Duration ${duration}s is above the recommended ${recommendedMax}s for ${spec.display_name}.` });
    if (spec.id === "x" && duration > 140) warnings.push({ code: "x_free_tier_duration", field: "duration_seconds", message: "Videos longer than 140s require an X Premium account; free-tier uploads will be rejected." });
  }

  const acceptedAspects = [spec.aspect, ...spec.alternate_aspects];
  const actualAspect = aspectLabel(width, height);
  if (!acceptedAspects.some((aspect) => aspectMatches(width, height, aspect))) {
    violations.push({ code: "aspect_mismatch", field: "width/height", message: `Aspect ${actualAspect} (${width}x${height}) does not match ${spec.display_name}'s accepted aspects within 1%.`, limit: acceptedAspects.map((aspect) => `${aspect.w}:${aspect.h}`).join("|"), actual: actualAspect });
  } else if (!aspectMatches(width, height, spec.aspect)) {
    warnings.push({ code: "aspect_not_primary", field: "width/height", message: `Aspect ${actualAspect} is accepted but ${spec.aspect.w}:${spec.aspect.h} is the primary ${spec.display_name} format.` });
  }
  if (width < spec.width && height < spec.height) warnings.push({ code: "resolution_below_recommended", field: "width/height", message: `${width}x${height} is below the recommended ${spec.width}x${spec.height}.` });

  const rate = chooseFrameRate(frameRate, spec.frame_rates);
  if (rate.changed) warnings.push({ code: "frame_rate_not_recommended", field: "frame_rate", message: `Frame rate ${frameRate} is not in ${spec.display_name}'s accepted list (${spec.frame_rates.join(", ")}); nearest is ${rate.frame_rate}.` });

  if (fileSizeBytes !== undefined) {
    const mb = round2(fileSizeBytes / (1024 * 1024));
    if (mb > spec.max_file_size_mb) violations.push({ code: "file_size_exceeds_max", field: "file_size_bytes", message: `File size ${mb} MB exceeds the ${spec.display_name} limit of ${spec.max_file_size_mb} MB.`, limit: spec.max_file_size_mb, actual: mb });
  }

  const titleChars = codePointLength(title);
  const descriptionChars = codePointLength(description);
  if (titleChars > spec.title_max_chars) violations.push({ code: "title_too_long", field: "title", message: `Title is ${titleChars} characters; ${spec.display_name} allows ${spec.title_max_chars}.`, limit: spec.title_max_chars, actual: titleChars });
  if (descriptionChars > spec.description_max_chars) violations.push({ code: "description_too_long", field: "description", message: `Description is ${descriptionChars} characters; ${spec.display_name} allows ${spec.description_max_chars}.`, limit: spec.description_max_chars, actual: descriptionChars });

  if (container !== undefined && container !== spec.container) violations.push({ code: "container_mismatch", field: "container", message: `Container "${container}" is not the expected ${spec.container}.`, limit: spec.container, actual: container });
  const codecKey = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  if (videoCodec !== undefined && !["h264", "avc", "avc1"].includes(codecKey(videoCodec))) violations.push({ code: "video_codec_mismatch", field: "video_codec", message: `Video codec "${videoCodec}" is not ${spec.video_codec}.`, limit: spec.video_codec, actual: videoCodec });
  if (audioCodec !== undefined && !["aac", "mp4a"].includes(codecKey(audioCodec))) violations.push({ code: "audio_codec_mismatch", field: "audio_codec", message: `Audio codec "${audioCodec}" is not ${spec.audio_codec}.`, limit: spec.audio_codec, actual: audioCodec });

  const hashtags = normalizeHashtags(hashtagsRaw);
  for (const item of hashtags.invalid) violations.push({ code: "hashtag_invalid", field: `hashtags[${item.index}]`, message: `Hashtag "${item.value}" is invalid (${item.reason}); hashtags must start with '#' and contain no spaces.`, limit: "#word", actual: item.value });
  for (const duplicate of hashtags.duplicates) violations.push({ code: "hashtag_duplicate", field: "hashtags", message: `Hashtag ${duplicate} appears more than once (case-insensitive).`, limit: 1, actual: duplicate });
  if (hashtagsRaw.length > spec.hashtag_max_count) violations.push({ code: "hashtag_count_exceeds_max", field: "hashtags", message: `${hashtagsRaw.length} hashtags exceed the ${spec.display_name} maximum of ${spec.hashtag_max_count}.`, limit: spec.hashtag_max_count, actual: hashtagsRaw.length });
  else if (hashtags.normalized.length > spec.hashtag_recommended_count) warnings.push({ code: "hashtag_count_above_recommended", field: "hashtags", message: `${hashtags.normalized.length} hashtags is above the recommended ${spec.hashtag_recommended_count} for ${spec.display_name}.` });

  if (spec.vertical && hasCaptions !== true) warnings.push({ code: "captions_missing", field: "has_captions", message: `${spec.display_name} is watched muted by default; burn in or attach captions.` });
  if (flags.includes("ai_generated")) warnings.push({ code: "ai_generated_label", field: "content_flags", message: `Content is flagged ai_generated; enable ${spec.display_name}'s AI-generated/altered-content label at upload.` });
  if (flags.includes("paid_partnership")) warnings.push({ code: "paid_partnership_disclosure", field: "content_flags", message: `Enable ${spec.display_name}'s paid-partnership/branded-content disclosure at upload.` });
  if (flags.includes("music_licensed")) warnings.push({ code: "music_license_evidence", field: "content_flags", message: "Keep the music license evidence available; automated audio matching may still claim or mute the upload." });

  const hashtagText = hashtags.normalized.join(" ");
  const evidence = { platform: spec.id, title, description, hashtags: hashtagsRaw, duration_seconds: duration, width, height, frame_rate: frameRate, ...(fileSizeBytes === undefined ? {} : { file_size_bytes: fileSizeBytes }), ...(container === undefined ? {} : { container }), ...(videoCodec === undefined ? {} : { video_codec: videoCodec }), ...(audioCodec === undefined ? {} : { audio_codec: audioCodec }), ...(hasCaptions === undefined ? {} : { has_captions: hasCaptions }), content_flags: flags, spec_version: "2026-approximate" };
  return {
    plan_revision: digestInputs(evidence),
    evidence,
    platform: specSummary(spec),
    ready: violations.length === 0,
    violations,
    warnings,
    normalized_hashtags: hashtags.normalized,
    character_counts: {
      title: titleChars,
      title_max: spec.title_max_chars,
      description: descriptionChars,
      description_max: spec.description_max_chars,
      hashtags: codePointLength(hashtagText),
      description_with_hashtags: codePointLength(description && hashtagText ? `${description} ${hashtagText}` : description || hashtagText),
    },
    routes: ["verify_delivery_conformance", "verify_delivery_file"],
    next_steps: violations.length ? ["Resolve every violation, re-export if media limits are involved, then re-run this validation."] : ["Package is within known limits; upload through the platform's own tooling and apply any flagged disclosures."],
    assumptions: [SPEC_DISCLAIMER, "Character counts use Unicode code points; some platforms count grapheme clusters or weight URLs differently."],
    applied: false,
  };
}
