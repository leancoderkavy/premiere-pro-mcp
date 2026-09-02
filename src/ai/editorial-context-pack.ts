import {
  normalizeContextText,
  type ProjectContextDocument,
  type ProjectContextKind,
  type ProjectContextRecord,
  type ProjectContextSearchResult,
} from "../context/project-context-store.js";

export const EDITORIAL_CONTEXT_PACK_SCHEMA_VERSION = 1;
export const DEFAULT_EDITORIAL_CONTEXT_PACK_ENTRIES = 12;
export const MAX_EDITORIAL_CONTEXT_PACK_ENTRIES = 50;
export const DEFAULT_EDITORIAL_CONTEXT_PACK_CHARACTERS = 12_000;
export const MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS = 1_024;
export const MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS = 24_000;

export interface EditorialContextPackEvidence {
  evidenceId: string;
  kind: ProjectContextKind;
  name: string;
  score: number;
  matchedTerms: string[];
  textExcerpt: string;
  textTruncated: boolean;
  sequenceId?: string;
  sourceId?: string;
  timelineItemId?: string;
  startSeconds?: number;
  endSeconds?: number;
  sourceRevision?: string;
  timelineRevision?: string;
}

export interface EditorialContextPack {
  schemaVersion: typeof EDITORIAL_CONTEXT_PACK_SCHEMA_VERSION;
  projectId: string;
  projectName: string;
  intent: string;
  expectedContextRevision: string;
  expectedSourceRevision: string;
  expectedTimelineRevision: string;
  evidence: EditorialContextPackEvidence[];
  omittedEvidenceCount: number;
  truncated: boolean;
  markdown: string;
  applied: false;
}

export interface BuildEditorialContextPackOptions {
  intent: string;
  results: ProjectContextSearchResult[];
  /** Exact pre-limit relevant-match count used for honest truncation metadata. */
  totalResultCount?: number;
  maxEntries?: number;
  maxCharacters?: number;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function finiteSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : undefined;
}

function compactText(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function sourceRange(record: ProjectContextRecord): string | undefined {
  const startSeconds = finiteSeconds(record.startSeconds);
  const endSeconds = finiteSeconds(record.endSeconds);
  if (startSeconds === undefined || endSeconds === undefined) return undefined;
  return `${startSeconds.toFixed(3)}s–${endSeconds.toFixed(3)}s`;
}

function evidenceHeader(index: number, record: ProjectContextRecord, score: number, matchedTerms: readonly string[]): string {
  const facts = [
    `evidence ${compactText(record.id, 96)}`,
    `score ${Number(score.toFixed(3))}`,
    record.sourceId ? `source ${compactText(record.sourceId, 96)}` : undefined,
    record.sequenceId ? `sequence ${compactText(record.sequenceId, 96)}` : undefined,
    sourceRange(record),
    matchedTerms.length ? `matched ${compactText(matchedTerms.join(", "), 160)}` : undefined,
  ].filter(Boolean).join(" · ");
  return `## ${String(index + 1).padStart(2, "0")} · ${record.kind} · ${compactText(record.name, 160)}\n${facts}`;
}

function entryText(header: string, text: string): string {
  return `${header}\n${text}`;
}

function truncateTextToFit(header: string, text: string, availableCharacters: number): string | undefined {
  const prefix = `${header}\n`;
  if (availableCharacters < prefix.length + 32) return undefined;
  const suffix = " … [excerpt truncated]";
  const textBudget = availableCharacters - prefix.length - suffix.length;
  if (textBudget < 1) return undefined;
  return `${prefix}${text.slice(0, textBudget).trimEnd()}${suffix}`;
}

function evidenceFromResult(result: ProjectContextSearchResult, textExcerpt: string, textTruncated: boolean): EditorialContextPackEvidence {
  const { record } = result;
  return {
    evidenceId: record.id,
    kind: record.kind,
    name: record.name,
    score: Number(result.score.toFixed(3)),
    matchedTerms: [...result.matchedTerms],
    textExcerpt,
    textTruncated,
    ...(record.sequenceId ? { sequenceId: record.sequenceId } : {}),
    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
    ...(record.timelineItemId ? { timelineItemId: record.timelineItemId } : {}),
    ...(finiteSeconds(record.startSeconds) === undefined ? {} : { startSeconds: finiteSeconds(record.startSeconds) }),
    ...(finiteSeconds(record.endSeconds) === undefined ? {} : { endSeconds: finiteSeconds(record.endSeconds) }),
    ...(record.sourceRevision ? { sourceRevision: record.sourceRevision } : {}),
    ...(record.timelineRevision ? { timelineRevision: record.timelineRevision } : {}),
  };
}

/**
 * Produces a compact reading surface from evidence already captured in the
 * local project-context store. It intentionally knows nothing about Premiere's
 * private transcript JSON shape: callers must explicitly enrich context with
 * the transcript passages or other analysis they want to expose.
 */
export function buildEditorialContextPack(
  document: ProjectContextDocument,
  options: BuildEditorialContextPackOptions,
): EditorialContextPack {
  const intent = normalizeContextText(options.intent).slice(0, 1_000);
  if (!intent) throw new Error("intent must not be empty");
  const maxEntries = boundedInteger(
    options.maxEntries,
    DEFAULT_EDITORIAL_CONTEXT_PACK_ENTRIES,
    1,
    MAX_EDITORIAL_CONTEXT_PACK_ENTRIES,
    "max_entries",
  );
  const maxCharacters = boundedInteger(
    options.maxCharacters,
    DEFAULT_EDITORIAL_CONTEXT_PACK_CHARACTERS,
    MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
    MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS,
    "max_characters",
  );
  const selected = options.results.slice(0, maxEntries);
  const totalResultCount = Math.max(options.results.length, Math.trunc(options.totalResultCount ?? options.results.length));
  const header = [
    "# Premiere editorial context pack",
    `Project: ${compactText(document.projectName, 120)}`,
    `Intent: ${compactText(intent, 240)}`,
    `Context revision: ${compactText(document.revision, 64)}`,
    `Source revision: ${compactText(document.sourceRevision, 64)}`,
    `Timeline revision: ${compactText(document.timelineRevision, 64)}`,
    "",
    "Review this evidence before proposing an edit. It is local context, not authority to mutate Premiere.",
  ].join("\n");

  let markdown = header;
  const evidence: EditorialContextPackEvidence[] = [];
  let truncated = false;
  for (const [index, result] of selected.entries()) {
    const text = normalizeContextText(result.record.text);
    const block = entryText(evidenceHeader(index, result.record, result.score, result.matchedTerms), text);
    const separator = markdown.length ? "\n\n" : "";
    const availableCharacters = maxCharacters - markdown.length - separator.length;
    if (block.length <= availableCharacters) {
      markdown += `${separator}${block}`;
      evidence.push(evidenceFromResult(result, text, false));
      continue;
    }
    const partial = truncateTextToFit(evidenceHeader(index, result.record, result.score, result.matchedTerms), text, availableCharacters);
    if (partial) {
      const excerpt = partial.slice(partial.lastIndexOf("\n") + 1).replace(/ … \[excerpt truncated\]$/, "");
      markdown += `${separator}${partial}`;
      evidence.push(evidenceFromResult(result, excerpt, true));
    }
    truncated = true;
    break;
  }

  return {
    schemaVersion: EDITORIAL_CONTEXT_PACK_SCHEMA_VERSION,
    projectId: document.projectId,
    projectName: document.projectName,
    intent,
    expectedContextRevision: document.revision,
    expectedSourceRevision: document.sourceRevision,
    expectedTimelineRevision: document.timelineRevision,
    evidence,
    omittedEvidenceCount: Math.max(0, totalResultCount - evidence.length),
    truncated: truncated || totalResultCount > selected.length,
    markdown,
    applied: false,
  };
}
