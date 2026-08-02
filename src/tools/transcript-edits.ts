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
