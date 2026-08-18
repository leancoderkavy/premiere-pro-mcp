import { createHash } from "node:crypto";

export interface TranscriptDeletionRange {
  start_seconds: number;
  end_seconds: number;
}

export interface TranscriptEditPreview {
  transcriptRevision: string;
  deletionRanges: TranscriptDeletionRange[];
  deletedSeconds: number;
  confirmationToken: string;
  applied: false;
}

export interface TranscriptPlacement {
  placement_id: string;
  track_type: "video" | "audio";
  track_index: number;
  source_in_seconds: number;
  source_out_seconds: number;
  timeline_start_seconds: number;
  timeline_end_seconds: number;
}

export interface TranscriptRoughCutStep {
  placement_id: string;
  track_type: "video" | "audio";
  track_index: number;
  source_range: TranscriptDeletionRange;
  timeline_range: TranscriptDeletionRange;
  instructions: readonly [string, string, string, string];
}

export interface TranscriptRoughCutPlan extends TranscriptEditPreview {
  planVersion: 1;
  requiresDuplicateSequence: true;
  requiresPostMutationRequery: true;
  ripple: boolean;
  steps: TranscriptRoughCutStep[];
  unmappedDeletionRanges: TranscriptDeletionRange[];
}

const MAX_DELETION_RANGES = 100;

export function transcriptRevision(json: string): string {
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeTranscriptDeletionRanges(
  value: unknown,
  handleSeconds = 0,
): TranscriptDeletionRange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("deletions must contain at least one transcript time range");
  }
  if (value.length > MAX_DELETION_RANGES) {
    throw new Error(`transcript edits are limited to ${MAX_DELETION_RANGES} deletion ranges`);
  }
  if (!Number.isFinite(handleSeconds) || handleSeconds < 0 || handleSeconds > 10) {
    throw new Error("handle_seconds must be between 0 and 10");
  }

  const ranges = value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`deletion ${index} must be an object`);
    }
    const range = entry as Partial<TranscriptDeletionRange>;
    if (!Number.isFinite(range.start_seconds) || Number(range.start_seconds) < 0) {
      throw new Error(`deletion ${index} start_seconds must be a non-negative number`);
    }
    if (!Number.isFinite(range.end_seconds) || Number(range.end_seconds) <= Number(range.start_seconds)) {
      throw new Error(`deletion ${index} end_seconds must be greater than start_seconds`);
    }
    return {
      start_seconds: roundSeconds(Math.max(0, Number(range.start_seconds) - handleSeconds)),
      end_seconds: roundSeconds(Number(range.end_seconds) + handleSeconds),
    };
  }).sort((left, right) => left.start_seconds - right.start_seconds || left.end_seconds - right.end_seconds);

  const merged: TranscriptDeletionRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start_seconds <= previous.end_seconds) {
      previous.end_seconds = roundSeconds(Math.max(previous.end_seconds, range.end_seconds));
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function previewTranscriptEdit(
  json: string,
  requestedRevision: string,
  deletions: unknown,
  handleSeconds = 0,
): TranscriptEditPreview {
  if (typeof json !== "string" || !json) throw new Error("Premiere returned an empty transcript");
  const revision = transcriptRevision(json);
  if (requestedRevision !== revision) {
    throw new Error("Transcript revision does not match the current Premiere transcript; export it again before planning edits");
  }
  const deletionRanges = normalizeTranscriptDeletionRanges(deletions, handleSeconds);
  const canonical = JSON.stringify({ transcriptRevision: revision, deletionRanges });
  return {
    transcriptRevision: revision,
    deletionRanges,
    deletedSeconds: roundSeconds(deletionRanges.reduce((total, range) => total + range.end_seconds - range.start_seconds, 0)),
    confirmationToken: createHash("sha256").update(canonical).digest("hex"),
    applied: false,
  };
}

function finite(value: unknown, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return Number(value);
}

export function planTranscriptRoughCut(
  preview: TranscriptEditPreview,
  placementsValue: unknown,
  ripple = true,
): TranscriptRoughCutPlan {
  if (!Array.isArray(placementsValue) || placementsValue.length === 0) {
    throw new Error("placements must contain at least one verified 1x sequence placement");
  }
  if (placementsValue.length > 256) throw new Error("transcript rough cuts are limited to 256 placements");

  const placements = placementsValue.map((value, index): TranscriptPlacement => {
    if (!value || typeof value !== "object") throw new Error(`placement ${index} must be an object`);
    const item = value as Partial<TranscriptPlacement>;
    if (typeof item.placement_id !== "string" || !item.placement_id.trim() || item.placement_id.length > 512) {
      throw new Error(`placement ${index} placement_id must be 1-512 characters`);
    }
    if (item.track_type !== "video" && item.track_type !== "audio") {
      throw new Error(`placement ${index} track_type must be video or audio`);
    }
    if (!Number.isInteger(item.track_index) || Number(item.track_index) < 0) {
      throw new Error(`placement ${index} track_index must be a non-negative integer`);
    }
    const sourceIn = finite(item.source_in_seconds, `placement ${index} source_in_seconds`);
    const sourceOut = finite(item.source_out_seconds, `placement ${index} source_out_seconds`);
    const timelineStart = finite(item.timeline_start_seconds, `placement ${index} timeline_start_seconds`);
    const timelineEnd = finite(item.timeline_end_seconds, `placement ${index} timeline_end_seconds`);
    if (sourceIn < 0 || timelineStart < 0 || sourceOut <= sourceIn || timelineEnd <= timelineStart) {
      throw new Error(`placement ${index} must contain increasing non-negative source and timeline ranges`);
    }
    if (Math.abs((sourceOut - sourceIn) - (timelineEnd - timelineStart)) > 0.001) {
      throw new Error(`placement ${index} is retimed or has an unverified source-to-timeline mapping`);
    }
    return {
      placement_id: item.placement_id,
      track_type: item.track_type,
      track_index: Number(item.track_index),
      source_in_seconds: sourceIn,
      source_out_seconds: sourceOut,
      timeline_start_seconds: timelineStart,
      timeline_end_seconds: timelineEnd,
    };
  });

  const mapped = new Set<number>();
  const steps: TranscriptRoughCutStep[] = [];
  for (const placement of placements) {
    for (let rangeIndex = 0; rangeIndex < preview.deletionRanges.length; rangeIndex++) {
      const deletion = preview.deletionRanges[rangeIndex];
      const start = Math.max(deletion.start_seconds, placement.source_in_seconds);
      const end = Math.min(deletion.end_seconds, placement.source_out_seconds);
      if (end <= start) continue;
      mapped.add(rangeIndex);
      const timelineStart = roundSeconds(placement.timeline_start_seconds + start - placement.source_in_seconds);
      const timelineEnd = roundSeconds(placement.timeline_start_seconds + end - placement.source_in_seconds);
      steps.push({
        placement_id: placement.placement_id,
        track_type: placement.track_type,
        track_index: placement.track_index,
        source_range: { start_seconds: roundSeconds(start), end_seconds: roundSeconds(end) },
        timeline_range: { start_seconds: timelineStart, end_seconds: timelineEnd },
        instructions: [
          `Split ${placement.track_type} track ${placement.track_index} at ${timelineEnd}s.`,
          `Split ${placement.track_type} track ${placement.track_index} at ${timelineStart}s.`,
          "Re-query the sequence and identify the segment enclosed by those verified boundaries.",
          `Remove only that segment${ripple ? " with ripple enabled" : " without ripple"}, then re-query and verify the resulting structure.`,
        ],
      });
    }
  }
  steps.sort((left, right) => right.timeline_range.start_seconds - left.timeline_range.start_seconds);

  return {
    ...preview,
    planVersion: 1,
    requiresDuplicateSequence: true,
    requiresPostMutationRequery: true,
    ripple,
    steps,
    unmappedDeletionRanges: preview.deletionRanges.filter((_, index) => !mapped.has(index)),
  };
}
