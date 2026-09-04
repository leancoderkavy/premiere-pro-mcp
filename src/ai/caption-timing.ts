import { createHash } from "node:crypto";

export const MAX_CAPTION_ARTIFACT_CHARACTERS = 750_000;
export const MAX_CAPTION_CUES = 10_000;
export const DEFAULT_CAPTION_TIMING_TOLERANCE_SECONDS = 0.25;

export interface CaptionCue {
  startSeconds: number;
  endSeconds: number;
}

export interface CaptionTimingOptions {
  targetDurationSeconds?: number;
  observedOffsetSeconds?: number;
  allowProportionalScaling?: boolean;
  timingToleranceSeconds?: number;
}

export interface CaptionTimingSample {
  position: "beginning" | "middle" | "end";
  cueNumber: number;
  before: { startSeconds: number; endSeconds: number };
  after?: { startSeconds: number; endSeconds: number };
}

export interface CaptionTimingPlan {
  schemaVersion: 1;
  planId: string;
  artifactFormat: "srt" | "vtt";
  cueCount: number;
  timeline: {
    firstStartSeconds: number;
    lastEndSeconds: number;
    captionSpanSeconds: number;
  };
  status: "aligned" | "constant_offset" | "proportional_drift" | "review_required";
  correction: {
    kind: "none" | "shift" | "scale" | "shift_then_scale";
    shiftSeconds: number;
    scale: number;
    proposed: boolean;
    reason: string;
  };
  targetDurationSeconds?: number;
  observedOffsetSeconds?: number;
  samples: CaptionTimingSample[];
  applied: false;
  verificationBoundary: string;
}

function boundedFiniteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}`);
  }
  return value;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

function parseTimecode(value: string, cueNumber: number): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new Error(`Cue ${cueNumber} has an invalid timecode`);
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] ?? "").padEnd(3, "0") || 0);
  if (minutes > 59 || seconds > 59) throw new Error(`Cue ${cueNumber} has an invalid timecode`);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function timingLine(block: string, blockNumber: number): { startSeconds: number; endSeconds: number } | undefined {
  const line = block.split("\n").find((entry) => entry.includes("-->"));
  if (!line) return undefined;
  const match = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(line);
  if (!match) throw new Error(`Caption block ${blockNumber} has an invalid timing line`);
  const startSeconds = parseTimecode(match[1], blockNumber);
  const endSeconds = parseTimecode(match[2], blockNumber);
  if (endSeconds <= startSeconds) throw new Error(`Cue ${blockNumber} must end after it starts`);
  return { startSeconds, endSeconds };
}

export function parseCaptionArtifact(content: unknown, artifactFormat: unknown): { format: "srt" | "vtt"; cues: CaptionCue[] } {
  if (typeof content !== "string" || !content.trim()) throw new Error("caption_content is required");
  if (content.length > MAX_CAPTION_ARTIFACT_CHARACTERS) {
    throw new Error(`caption_content exceeds ${MAX_CAPTION_ARTIFACT_CHARACTERS} characters`);
  }
  if (artifactFormat !== "srt" && artifactFormat !== "vtt") {
    throw new Error("artifact_format must be either srt or vtt");
  }
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (artifactFormat === "vtt" && !/^WEBVTT(?:\s|$)/.test(normalized)) {
    throw new Error("A VTT artifact must begin with WEBVTT");
  }
  const cues: CaptionCue[] = [];
  const blocks = normalized.split(/\n{2,}/);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index].trim();
    if (!block || /^WEBVTT(?:\s|$)/.test(block) || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const timing = timingLine(block, index + 1);
    if (!timing) continue;
    const prior = cues.at(-1);
    if (prior && timing.startSeconds < prior.endSeconds) {
      throw new Error(`Cue ${index + 1} overlaps the preceding cue`);
    }
    cues.push(timing);
    if (cues.length > MAX_CAPTION_CUES) throw new Error(`Caption artifact exceeds ${MAX_CAPTION_CUES} cues`);
  }
  if (!cues.length) throw new Error("Caption artifact contains no timed cues");
  return { format: artifactFormat, cues };
}

function sampleIndexes(length: number): Array<{ position: CaptionTimingSample["position"]; index: number }> {
  const candidates: Array<{ position: CaptionTimingSample["position"]; index: number }> = [
    { position: "beginning", index: 0 },
    { position: "middle", index: Math.floor((length - 1) / 2) },
    { position: "end", index: length - 1 },
  ];
  const seen = new Set<number>();
  return candidates.filter(({ index }) => {
    if (seen.has(index)) return false;
    seen.add(index);
    return true;
  });
}

function validTransformedRange(cues: CaptionCue[], shiftSeconds: number, scale: number): boolean {
  return cues.every((cue) => {
    const start = (cue.startSeconds + shiftSeconds) * scale;
    const end = (cue.endSeconds + shiftSeconds) * scale;
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
  });
}

function planId(format: "srt" | "vtt", cues: CaptionCue[], options: CaptionTimingOptions): string {
  const source = JSON.stringify({ format, cues, options });
  return `caption-plan-${createHash("sha256").update(source).digest("hex").slice(0, 24)}`;
}

/**
 * Create a review-only timing proposal. The caller owns the caption artifact;
 * this function intentionally never writes it, reaches Premiere, or treats a
 * timing model as proof of subtitle readability.
 */
export function buildCaptionTimingPlan(
  content: unknown,
  artifactFormat: unknown,
  options: CaptionTimingOptions = {},
): CaptionTimingPlan {
  const parsed = parseCaptionArtifact(content, artifactFormat);
  const targetDurationSeconds = boundedFiniteNumber(options.targetDurationSeconds, "target_duration_seconds", 0.001, 604_800);
  const observedOffsetSeconds = boundedFiniteNumber(options.observedOffsetSeconds, "observed_offset_seconds", -86_400, 86_400);
  const tolerance = boundedFiniteNumber(
    options.timingToleranceSeconds,
    "timing_tolerance_seconds",
    0.001,
    10,
    DEFAULT_CAPTION_TIMING_TOLERANCE_SECONDS,
  )!;
  if (options.allowProportionalScaling !== undefined && typeof options.allowProportionalScaling !== "boolean") {
    throw new Error("allow_proportional_scaling must be a boolean");
  }

  const firstStartSeconds = parsed.cues[0].startSeconds;
  const lastEndSeconds = parsed.cues.at(-1)!.endSeconds;
  let status: CaptionTimingPlan["status"] = "aligned";
  let shiftSeconds = 0;
  let scale = 1;
  let kind: CaptionTimingPlan["correction"]["kind"] = "none";
  let proposed = false;
  let reason = "The artifact has no requested correction.";

  const hasObservedOffset = observedOffsetSeconds !== undefined && Math.abs(observedOffsetSeconds) > tolerance;
  if (hasObservedOffset) {
    shiftSeconds = -observedOffsetSeconds!;
    if (!validTransformedRange(parsed.cues, shiftSeconds, 1)) {
      status = "review_required";
      shiftSeconds = 0;
      reason = "The observed offset would move at least one cue before zero; review the source timing manually.";
    } else {
      status = "constant_offset";
      kind = "shift";
      proposed = true;
      reason = "The caller supplied an observed constant synchronization offset; this preview shifts every cue by the inverse offset.";
    }
  }

  const endAfterShift = (lastEndSeconds + shiftSeconds) * scale;
  const durationDifference = targetDurationSeconds === undefined ? 0 : targetDurationSeconds - endAfterShift;
  if (targetDurationSeconds !== undefined && Math.abs(durationDifference) > tolerance) {
    if (options.allowProportionalScaling !== true) {
      if (!proposed) status = "review_required";
      reason = `${reason} The requested target duration differs by ${roundSeconds(durationDifference)} seconds; proportional scaling was not authorized.`;
    } else if (firstStartSeconds + shiftSeconds > tolerance) {
      status = "review_required";
      shiftSeconds = 0;
      scale = 1;
      kind = "none";
      proposed = false;
      reason = "The first cue is not anchored near zero, so duration scaling could change intentional lead-in timing; review manually.";
    } else {
      const candidateScale = targetDurationSeconds / (lastEndSeconds + shiftSeconds);
      if (!Number.isFinite(candidateScale) || candidateScale <= 0 || candidateScale < 0.5 || candidateScale > 2 || !validTransformedRange(parsed.cues, shiftSeconds, candidateScale)) {
        status = "review_required";
        shiftSeconds = 0;
        scale = 1;
        kind = "none";
        proposed = false;
        reason = "The requested duration would require an unsafe or implausible proportional timing scale; review manually.";
      } else {
        scale = candidateScale;
        status = "proportional_drift";
        kind = Math.abs(shiftSeconds) > 0 ? "shift_then_scale" : "scale";
        proposed = true;
        reason = "The caller authorized a bounded proportional timing preview to match the supplied target duration.";
      }
    }
  }

  const samples = sampleIndexes(parsed.cues.length).map(({ position, index }) => {
    const cue = parsed.cues[index];
    const before = { startSeconds: roundSeconds(cue.startSeconds), endSeconds: roundSeconds(cue.endSeconds) };
    return {
      position,
      cueNumber: index + 1,
      before,
      ...(proposed ? {
        after: {
          startSeconds: roundSeconds((cue.startSeconds + shiftSeconds) * scale),
          endSeconds: roundSeconds((cue.endSeconds + shiftSeconds) * scale),
        },
      } : {}),
    };
  });

  return {
    schemaVersion: 1,
    planId: planId(parsed.format, parsed.cues, options),
    artifactFormat: parsed.format,
    cueCount: parsed.cues.length,
    timeline: {
      firstStartSeconds: roundSeconds(firstStartSeconds),
      lastEndSeconds: roundSeconds(lastEndSeconds),
      captionSpanSeconds: roundSeconds(lastEndSeconds - firstStartSeconds),
    },
    status,
    correction: { kind, shiftSeconds: roundSeconds(shiftSeconds), scale: Number(scale.toFixed(9)), proposed, reason },
    ...(targetDurationSeconds === undefined ? {} : { targetDurationSeconds: roundSeconds(targetDurationSeconds) }),
    ...(observedOffsetSeconds === undefined ? {} : { observedOffsetSeconds: roundSeconds(observedOffsetSeconds) }),
    samples,
    applied: false,
    verificationBoundary: "This is a local artifact-timing preview only. It does not modify an SRT/VTT file, import captions, contact Premiere, prove caption-track structure, playback synchronization, readability, or rendered output.",
  };
}
