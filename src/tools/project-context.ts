import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { buildToolScript } from "../bridge/script-builder.js";
import { type BridgeOptions, sendCommand } from "../bridge/file-bridge.js";
import {
  contextRevision,
  MAX_CONTEXT_RECORDS,
  normalizeContextKeywords,
  normalizeContextText,
  PROJECT_CONTEXT_SCHEMA_VERSION,
  type ProjectContextDocument,
  type ProjectContextKind,
  type ProjectContextRecord,
  ProjectContextRepository,
  type ProjectContextRepositoryOptions,
  searchProjectContext,
  stableContextId,
} from "../context/project-context-store.js";

const CORE_CONTEXT_KINDS = new Set<ProjectContextKind>(["project", "sequence", "source", "timeline"]);
const ENRICHMENT_KINDS = new Set<ProjectContextKind>(["transcript", "shot", "audio", "note"]);
const MAX_CAPTURED_TIMELINE_ITEMS = 2_000;
const MAX_ENRICHMENTS_PER_CALL = 512;
export const MAX_CONCURRENT_SOURCE_FINGERPRINTS = 16;

interface SnapshotClip {
  nodeId: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  inPointSeconds: number;
  outPointSeconds: number;
  speed?: number;
  trackType: "video" | "audio";
  trackIndex: number;
  sourceId?: string;
  sourceName?: string;
  mediaPath?: string;
  offline?: boolean;
}

export interface PremiereContextSnapshot {
  projectName: string;
  projectPath?: string;
  sequence: {
    id: string;
    name: string;
    durationSeconds: number;
    clips: SnapshotClip[];
    truncated: boolean;
  };
}

export interface ContextEnrichmentInput {
  id?: string;
  kind: ProjectContextKind;
  name?: string;
  text: string;
  keywords?: string[];
  sequence_id?: string;
  source_id?: string;
  timeline_item_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  track_type?: "video" | "audio";
  track_index?: number;
  source_revision?: string;
  timeline_revision?: string;
  metadata?: Record<string, unknown>;
}

export const EDITORIAL_EVIDENCE_TYPES = [
  "transcript_passage",
  "speaker_label",
  "shot_log",
  "audio_observation",
  "operator_note",
  "frame_reference",
] as const;

export type EditorialEvidenceType = (typeof EDITORIAL_EVIDENCE_TYPES)[number];

export interface EditorialEvidenceInput {
  id?: string;
  type: EditorialEvidenceType;
  name?: string;
  text?: string;
  keywords?: string[];
  speaker_label?: string;
  frame_reference_id?: string;
  sequence_id?: string;
  source_id?: string;
  timeline_item_id?: string;
  start_seconds?: number;
  end_seconds?: number;
  track_type?: "video" | "audio";
  track_index?: number;
  source_revision?: string;
  timeline_revision?: string;
  metadata?: Record<string, unknown>;
}

interface MediaFingerprint {
  mediaPathHash?: string;
  size?: number;
  modifiedMs?: number;
}

type FingerprintMedia = (mediaPath: string | undefined) => Promise<MediaFingerprint>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMediaPath(value: string): string {
  const normalized = path.normalize(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

async function fingerprintMedia(mediaPath: string | undefined): Promise<MediaFingerprint> {
  if (!mediaPath) return {};
  const normalized = normalizeMediaPath(mediaPath);
  const mediaPathHash = hash(normalized);
  try {
    const info = await stat(mediaPath);
    if (!info.isFile()) return { mediaPathHash };
    return { mediaPathHash, size: info.size, modifiedMs: Math.trunc(info.mtimeMs) };
  } catch {
    return { mediaPathHash };
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (/(?:^|_)(?:path|token|secret|password|api.?key)(?:$|_)/i.test(key)) continue;
    if (typeof entry === "string") result[key] = normalizeContextText(entry).slice(0, 2_000);
    else if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
    else if (typeof entry === "boolean" || entry === null) result[key] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}

function safeName(value: unknown, fallback: string): string {
  return normalizeContextText(value).slice(0, 512) || fallback;
}

function captureScript(): string {
  return buildToolScript(`
    var project = app.project;
    if (!project) return __error("No project is open");
    var sequence = project.activeSequence;
    if (!sequence) return __error("No active sequence");
    var clips = [];
    var truncated = false;
    var maxItems = ${MAX_CAPTURED_TIMELINE_ITEMS};

    function appendTracks(tracks, trackType) {
      for (var trackIndex = 0; trackIndex < tracks.numTracks; trackIndex++) {
        var track = tracks[trackIndex];
        for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
          if (clips.length >= maxItems) { truncated = true; return; }
          var clip = track.clips[clipIndex];
          var entry = {
            nodeId: String(clip.nodeId),
            name: String(clip.name || "Untitled clip"),
            startSeconds: __ticksToSeconds(clip.start.ticks),
            endSeconds: __ticksToSeconds(clip.end.ticks),
            inPointSeconds: __ticksToSeconds(clip.inPoint.ticks),
            outPointSeconds: __ticksToSeconds(clip.outPoint.ticks),
            trackType: trackType,
            trackIndex: trackIndex
          };
          try { entry.speed = clip.getSpeed(); } catch (e) {}
          try {
            if (clip.projectItem) {
              entry.sourceId = String(clip.projectItem.nodeId);
              entry.sourceName = String(clip.projectItem.name || clip.name || "Untitled source");
              try { entry.mediaPath = clip.projectItem.getMediaPath(); } catch (e) {}
              try { entry.offline = clip.projectItem.isOffline(); } catch (e) {}
            }
          } catch (e) {}
          clips.push(entry);
        }
      }
    }

    appendTracks(sequence.videoTracks, "video");
    if (!truncated) appendTracks(sequence.audioTracks, "audio");
    return __result({
      projectName: String(project.name || "Untitled project"),
      projectPath: String(project.path || ""),
      sequence: {
        id: String(sequence.sequenceID),
        name: String(sequence.name || "Untitled sequence"),
        durationSeconds: __ticksToSeconds(sequence.end),
        clips: clips,
        truncated: truncated
      }
    });
  `);
}

export async function buildContextDocumentFromSnapshot(
  snapshot: PremiereContextSnapshot,
  existing?: ProjectContextDocument,
  fingerprint: FingerprintMedia = fingerprintMedia,
): Promise<{ document: ProjectContextDocument; invalidatedRecords: number }> {
  if (!snapshot.projectName || !snapshot.sequence?.id || !Array.isArray(snapshot.sequence.clips)) {
    throw new Error("Premiere returned an incomplete context snapshot");
  }
  if (snapshot.sequence.clips.length > MAX_CAPTURED_TIMELINE_ITEMS) {
    throw new Error(`Context capture is limited to ${MAX_CAPTURED_TIMELINE_ITEMS} timeline items`);
  }

  const projectIdentity = snapshot.projectPath?.trim() || snapshot.projectName;
  const projectId = stableContextId("project", normalizeMediaPath(projectIdentity));
  const projectPathHash = snapshot.projectPath?.trim() ? hash(normalizeMediaPath(snapshot.projectPath)) : undefined;
  const indexedAt = new Date().toISOString();
  const uniqueSources = new Map<string, SnapshotClip>();
  for (const clip of snapshot.sequence.clips) {
    if (clip.sourceId && !uniqueSources.has(clip.sourceId)) uniqueSources.set(clip.sourceId, clip);
  }

  const sourceEntries = [...uniqueSources.entries()];
  const fingerprints = new Map<string, MediaFingerprint>();
  let nextSourceIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_SOURCE_FINGERPRINTS, sourceEntries.length) },
    async () => {
      while (nextSourceIndex < sourceEntries.length) {
        const [sourceId, clip] = sourceEntries[nextSourceIndex++]!;
        fingerprints.set(sourceId, await fingerprint(clip.mediaPath));
      }
    },
  ));

  const sourceRecords: ProjectContextRecord[] = [...uniqueSources.entries()].map(([sourceId, clip]) => {
    const media = fingerprints.get(sourceId) ?? {};
    const extension = clip.mediaPath ? path.extname(clip.mediaPath).replace(/^\./, "").toLocaleLowerCase() : "";
    const sourceRevision = stableContextId(
      "source",
      sourceId,
      media.mediaPathHash,
      media.size,
      media.modifiedMs,
      clip.offline === true,
    );
    return {
      id: stableContextId("source-record", sourceId),
      kind: "source",
      name: safeName(clip.sourceName, safeName(clip.name, "Untitled source")),
      text: [
        `Source ${safeName(clip.sourceName, safeName(clip.name, "Untitled source"))}.`,
        extension ? `Media type ${extension}.` : "",
        clip.offline === true ? "Media is offline." : "Media is online or its state is unknown.",
      ].filter(Boolean).join(" "),
      keywords: [extension, clip.trackType].filter(Boolean),
      sourceId,
      sourceRevision,
      mediaPathHash: media.mediaPathHash,
      metadata: {
        ...(media.size !== undefined ? { fileSize: media.size } : {}),
        ...(media.modifiedMs !== undefined ? { modifiedMs: media.modifiedMs } : {}),
        offline: clip.offline === true,
      },
      indexedAt,
    };
  });
  const sourceRevisionById = new Map(sourceRecords.map((record) => [record.sourceId!, record.sourceRevision!]));
  const sourceRevision = stableContextId(
    "sources",
    sourceRecords.map((record) => [record.sourceId, record.sourceRevision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

  const timelineRecords: ProjectContextRecord[] = snapshot.sequence.clips.map((clip) => {
    const timelineRevision = stableContextId(
      "timeline-item",
      snapshot.sequence.id,
      clip.nodeId,
      clip.startSeconds,
      clip.endSeconds,
      clip.inPointSeconds,
      clip.outPointSeconds,
      clip.speed,
      clip.trackType,
      clip.trackIndex,
    );
    return {
      id: stableContextId("timeline-record", snapshot.sequence.id, clip.nodeId, clip.trackType, clip.trackIndex),
      kind: "timeline",
      name: safeName(clip.name, "Untitled timeline item"),
      text: `${safeName(clip.name, "Untitled timeline item")} on ${clip.trackType} track ${clip.trackIndex} from ${clip.startSeconds.toFixed(3)}s to ${clip.endSeconds.toFixed(3)}s using source ${clip.inPointSeconds.toFixed(3)}s to ${clip.outPointSeconds.toFixed(3)}s.`,
      keywords: [clip.trackType, `track-${clip.trackIndex}`],
      sequenceId: snapshot.sequence.id,
      sourceId: clip.sourceId,
      timelineItemId: clip.nodeId,
      startSeconds: clip.startSeconds,
      endSeconds: clip.endSeconds,
      trackType: clip.trackType,
      trackIndex: clip.trackIndex,
      sourceRevision: clip.sourceId ? sourceRevisionById.get(clip.sourceId) : undefined,
      timelineRevision,
      indexedAt,
    };
  });
  const timelineRevision = stableContextId(
    "timeline",
    snapshot.sequence.id,
    timelineRecords.map((record) => [record.id, record.timelineRevision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

  const retained: ProjectContextRecord[] = [];
  let invalidatedRecords = 0;
  for (const record of existing?.records ?? []) {
    if (CORE_CONTEXT_KINDS.has(record.kind)) continue;
    const currentSourceRevision = record.sourceId ? sourceRevisionById.get(record.sourceId) : undefined;
    const sourceStillValid = !record.sourceId || (currentSourceRevision && record.sourceRevision === currentSourceRevision);
    const timelineStillValid = !record.timelineRevision || record.timelineRevision === timelineRevision;
    if (sourceStillValid && timelineStillValid) retained.push(record);
    else invalidatedRecords++;
  }

  const records: ProjectContextRecord[] = [
    {
      id: stableContextId("project-record", projectId),
      kind: "project",
      name: safeName(snapshot.projectName, "Untitled project"),
      text: `Project ${safeName(snapshot.projectName, "Untitled project")} with active sequence ${safeName(snapshot.sequence.name, "Untitled sequence")}.`,
      keywords: ["project", "premiere"],
      sequenceId: snapshot.sequence.id,
      indexedAt,
    },
    {
      id: stableContextId("sequence-record", snapshot.sequence.id),
      kind: "sequence",
      name: safeName(snapshot.sequence.name, "Untitled sequence"),
      text: `Sequence ${safeName(snapshot.sequence.name, "Untitled sequence")} is ${snapshot.sequence.durationSeconds.toFixed(3)} seconds with ${snapshot.sequence.clips.length} indexed timeline items${snapshot.sequence.truncated ? "; capture was truncated" : ""}.`,
      keywords: ["sequence", "timeline"],
      sequenceId: snapshot.sequence.id,
      startSeconds: 0,
      endSeconds: snapshot.sequence.durationSeconds,
      timelineRevision,
      metadata: { captureTruncated: snapshot.sequence.truncated },
      indexedAt,
    },
    ...sourceRecords,
    ...timelineRecords,
    ...retained,
  ];
  if (records.length > MAX_CONTEXT_RECORDS) {
    throw new Error(`Captured context exceeds the ${MAX_CONTEXT_RECORDS}-record project limit`);
  }

  const revision = contextRevision(sourceRevision, timelineRevision, records);
  return {
    invalidatedRecords,
    document: {
      schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
      projectId,
      projectName: safeName(snapshot.projectName, "Untitled project"),
      projectPathHash,
      revision,
      sourceRevision,
      timelineRevision,
      updatedAt: indexedAt,
      records,
    },
  };
}

export function enrichContextDocument(
  document: ProjectContextDocument,
  inputs: ContextEnrichmentInput[],
  replace = false,
): { document: ProjectContextDocument; upserted: number } {
  if (!inputs.length) throw new Error("records must contain at least one enrichment");
  if (inputs.length > MAX_ENRICHMENTS_PER_CALL) {
    throw new Error(`One enrichment call is limited to ${MAX_ENRICHMENTS_PER_CALL} records`);
  }
  const sourceRevisionById = new Map(
    document.records
      .filter((record) => record.kind === "source" && record.sourceId && record.sourceRevision)
      .map((record) => [record.sourceId!, record.sourceRevision!]),
  );
  const now = new Date().toISOString();
  const normalized = inputs.map((input, index): ProjectContextRecord => {
    if (!ENRICHMENT_KINDS.has(input.kind)) {
      throw new Error(`records[${index}].kind must be transcript, shot, audio, or note`);
    }
    const text = normalizeContextText(input.text);
    if (!text) throw new Error(`records[${index}].text must not be empty`);
    const sourceRevision = input.source_id ? sourceRevisionById.get(input.source_id) : undefined;
    if (input.source_id && !sourceRevision) {
      throw new Error(`records[${index}] references an unknown source_id`);
    }
    if (input.source_revision && input.source_revision !== sourceRevision) {
      throw new Error(`records[${index}] has a stale source_revision; capture context again before enrichment`);
    }
    if (input.timeline_revision && input.timeline_revision !== document.timelineRevision) {
      throw new Error(`records[${index}] has a stale timeline_revision; capture context again before enrichment`);
    }
    const startSeconds = finiteNumber(input.start_seconds);
    const endSeconds = finiteNumber(input.end_seconds);
    if (startSeconds !== undefined && startSeconds < 0) throw new Error(`records[${index}].start_seconds must be non-negative`);
    if (endSeconds !== undefined && (endSeconds < 0 || (startSeconds !== undefined && endSeconds < startSeconds))) {
      throw new Error(`records[${index}].end_seconds must be at or after start_seconds`);
    }
    return {
      id: input.id?.trim().slice(0, 256) || stableContextId(
        "enrichment",
        input.kind,
        input.source_id,
        input.timeline_item_id,
        startSeconds,
        endSeconds,
        text,
      ),
      kind: input.kind,
      name: safeName(input.name, `${input.kind} context`),
      text,
      keywords: normalizeContextKeywords(input.keywords),
      sequenceId: input.sequence_id,
      sourceId: input.source_id,
      timelineItemId: input.timeline_item_id,
      startSeconds,
      endSeconds,
      trackType: input.track_type,
      trackIndex: finiteNumber(input.track_index),
      sourceRevision,
      timelineRevision: input.timeline_item_id || input.sequence_id ? document.timelineRevision : undefined,
      metadata: sanitizeMetadata(input.metadata),
      indexedAt: now,
    };
  });
  const base = replace
    ? document.records.filter((record) => CORE_CONTEXT_KINDS.has(record.kind))
    : document.records;
  const byId = new Map(base.map((record) => [record.id, record]));
  for (const record of normalized) byId.set(record.id, record);
  const records = [...byId.values()];
  if (records.length > MAX_CONTEXT_RECORDS) {
    throw new Error(`Project context is limited to ${MAX_CONTEXT_RECORDS} records`);
  }
  const updatedAt = now;
  return {
    upserted: normalized.length,
    document: {
      ...document,
      records,
      updatedAt,
      revision: contextRevision(document.sourceRevision, document.timelineRevision, records),
    },
  };
}

function requireProjectId(value: unknown): string {
  const projectId = typeof value === "string" ? value.trim() : "";
  if (!projectId || projectId.length > 256) throw new Error("project_id is required");
  return projectId;
}

function enrichmentSchema() {
  return {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional stable enrichment ID for deterministic replacement" },
      kind: { type: "string", enum: ["transcript", "shot", "audio", "note"] },
      name: { type: "string" },
      text: { type: "string", description: "Transcript, visual description, audio observation, or editor note" },
      keywords: { type: "array", items: { type: "string" } },
      sequence_id: { type: "string" },
      source_id: { type: "string" },
      timeline_item_id: { type: "string" },
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      track_type: { type: "string", enum: ["video", "audio"] },
      track_index: { type: "number" },
      source_revision: { type: "string", description: "Optional stale-analysis guard from the source record" },
      timeline_revision: { type: "string", description: "Optional stale-placement guard from context status" },
      metadata: { type: "object", description: "Small scalar metadata object; path and credential-like keys are discarded" },
    },
    required: ["kind", "text"],
  };
}

function editorialEvidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", maxLength: 256, description: "Optional stable evidence ID for deterministic replacement." },
      type: { type: "string", enum: EDITORIAL_EVIDENCE_TYPES, description: "Evidence shape: transcript passage, speaker label, shot log, audio observation, operator note, or an opaque frame reference." },
      name: { type: "string", maxLength: 512, description: "Optional bounded display name for the local evidence record." },
      text: { type: "string", maxLength: 20000, description: "Caller-approved local evidence text. Required except for speaker_label and frame_reference, which can derive a bounded local note." },
      keywords: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256, description: "One local search keyword." }, description: "Optional local search keywords." },
      speaker_label: { type: "string", maxLength: 160, description: "For transcript_passage or speaker_label, an editor-supplied speaker label. It is not inferred by this server." },
      frame_reference_id: { type: "string", maxLength: 256, description: "For frame_reference, an opaque fixture or review-frame identifier, never a native file path or URL." },
      sequence_id: { type: "string", maxLength: 512, description: "Optional captured sequence ID. Requires the exact current timeline_revision." },
      source_id: { type: "string", maxLength: 512, description: "Optional captured source ID. Requires the exact current source_revision." },
      timeline_item_id: { type: "string", maxLength: 512, description: "Optional captured timeline item ID. Requires the exact current timeline_revision." },
      start_seconds: { type: "number", minimum: 0, description: "Optional non-negative source or sequence start in seconds." },
      end_seconds: { type: "number", minimum: 0, description: "Optional end in seconds at or after start_seconds." },
      track_type: { type: "string", enum: ["video", "audio"], description: "Optional recorded track type when the evidence is tied to a timeline item." },
      track_index: { type: "number", minimum: 0, description: "Optional recorded track index when the evidence is tied to a timeline item." },
      source_revision: { type: "string", maxLength: 256, description: "Required exact source revision whenever source_id is supplied." },
      timeline_revision: { type: "string", maxLength: 256, description: "Required exact timeline revision whenever sequence_id or timeline_item_id is supplied." },
      metadata: { type: "object", description: "Optional small scalar metadata. Credential-like and path-like keys are discarded before local storage." },
    },
    required: ["type"],
  };
}

function evidenceText(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  const normalized = normalizeContextText(value);
  if (!normalized && required) throw new Error(`${field} is required`);
  if (normalized.length > 20_000) throw new Error(`${field} must be at most 20000 characters`);
  return normalized || undefined;
}

function evidenceLabel(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeContextText(value);
  if (!normalized || normalized.length > 160) throw new Error(`${field} must be a non-empty string of at most 160 characters`);
  return normalized;
}

function opaqueReference(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) {
    throw new Error("frame_reference_id must be an opaque identifier using letters, numbers, dots, underscores, or hyphens; paths and URLs are not accepted");
  }
  return value;
}

function requireExactRevision(value: unknown, expected: string, field: string): void {
  if (typeof value !== "string" || value !== expected) {
    throw new Error(`${field} must match the currently captured revision; capture context again before importing evidence`);
  }
}

function editorialEvidenceToEnrichment(
  document: ProjectContextDocument,
  inputs: EditorialEvidenceInput[],
): ContextEnrichmentInput[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_ENRICHMENTS_PER_CALL) {
    throw new Error(`evidence must contain between 1 and ${MAX_ENRICHMENTS_PER_CALL} entries`);
  }
  const sourceRevisionById = new Map(
    document.records
      .filter((record) => record.kind === "source" && record.sourceId && record.sourceRevision)
      .map((record) => [record.sourceId!, record.sourceRevision!]),
  );
  const sequenceIds = new Set(document.records.filter((record) => record.kind === "sequence").map((record) => record.sequenceId));
  const timelineItemIds = new Set(document.records.filter((record) => record.kind === "timeline").map((record) => record.timelineItemId));

  return inputs.map((input, index): ContextEnrichmentInput => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !EDITORIAL_EVIDENCE_TYPES.includes(input.type)) {
      throw new Error(`evidence[${index}].type must be a supported editorial evidence type`);
    }
    if (input.source_id) {
      const expectedSourceRevision = sourceRevisionById.get(input.source_id);
      if (!expectedSourceRevision) throw new Error(`evidence[${index}] references an unknown source_id`);
      requireExactRevision(input.source_revision, expectedSourceRevision, `evidence[${index}].source_revision`);
    } else if (input.source_revision !== undefined) {
      throw new Error(`evidence[${index}].source_revision requires source_id`);
    }
    if (input.sequence_id || input.timeline_item_id) {
      requireExactRevision(input.timeline_revision, document.timelineRevision, `evidence[${index}].timeline_revision`);
    } else if (input.timeline_revision !== undefined) {
      throw new Error(`evidence[${index}].timeline_revision requires sequence_id or timeline_item_id`);
    }
    if (input.sequence_id && !sequenceIds.has(input.sequence_id)) {
      throw new Error(`evidence[${index}] references an unknown sequence_id`);
    }
    if (input.timeline_item_id && !timelineItemIds.has(input.timeline_item_id)) {
      throw new Error(`evidence[${index}] references an unknown timeline_item_id`);
    }

    const speakerLabel = evidenceLabel(input.speaker_label, `evidence[${index}].speaker_label`);
    const explicitText = evidenceText(input.text, `evidence[${index}].text`, input.type !== "speaker_label" && input.type !== "frame_reference");
    const frameReferenceId = input.type === "frame_reference"
      ? opaqueReference(input.frame_reference_id)
      : undefined;
    const mapped = {
      transcript_passage: "transcript",
      speaker_label: "note",
      shot_log: "shot",
      audio_observation: "audio",
      operator_note: "note",
      frame_reference: "shot",
    } as const;
    const type = input.type as EditorialEvidenceType;
    const text = explicitText
      ?? (type === "speaker_label"
        ? `Speaker label: ${speakerLabel ?? "unspecified"}.`
        : `Frame reference: ${frameReferenceId}.`);
    const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
    return {
      id: input.id,
      kind: mapped[type],
      name: input.name,
      text,
      keywords: input.keywords,
      sequence_id: input.sequence_id,
      source_id: input.source_id,
      timeline_item_id: input.timeline_item_id,
      start_seconds: input.start_seconds,
      end_seconds: input.end_seconds,
      track_type: input.track_type,
      track_index: input.track_index,
      source_revision: input.source_revision,
      timeline_revision: input.timeline_revision,
      metadata: {
        ...metadata,
        evidenceType: type,
        ...(speakerLabel ? { speakerLabel } : {}),
        ...(frameReferenceId ? { frameReferenceId } : {}),
      },
    };
  });
}

export interface ProjectContextToolDependencies {
  repository?: ProjectContextRepository;
  repositoryOptions?: ProjectContextRepositoryOptions;
  captureSnapshot?: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export function getProjectContextTools(
  bridgeOptions: BridgeOptions,
  dependencies: ProjectContextToolDependencies = {},
) {
  const repository = dependencies.repository ?? new ProjectContextRepository(dependencies.repositoryOptions);
  const loadSnapshot = dependencies.captureSnapshot ?? (() => sendCommand(captureScript(), bridgeOptions));
  return {
    manage_project_context: {
      description: "Capture, enrich, import revision-bound editorial evidence, inspect, or clear a durable local Premiere project-context index. Capture stores bounded active-sequence/source metadata; local enrichment and evidence import add caller-approved transcripts, speaker labels, shots, audio observations, notes, or opaque frame references without re-analyzing media. Never include secrets or unrelated customer data.",
      parameters: {
        type: "object" as const,
        properties: {
          action: { type: "string", enum: ["capture", "enrich", "import_evidence", "status", "clear"], description: "Capture active context, enrich it, import revision-bound editorial evidence, inspect status, or clear one local project index." },
          project_id: { type: "string", description: "Project context ID returned by capture; optional for status to list projects" },
          replace: { type: "boolean", description: "For enrich, replace prior enrichments while retaining captured core records" },
          records: { type: "array", items: enrichmentSchema(), description: "For enrich, up to 512 transcript, shot, audio, or note records" },
          evidence: { type: "array", items: editorialEvidenceSchema(), description: "For import_evidence, up to 512 caller-approved records with strict source/timeline revision guards. The server does not read referenced frame files, invoke analysis, or contact a provider." },
        },
        required: ["action"],
      },
      handler: async (args: {
        action: "capture" | "enrich" | "import_evidence" | "status" | "clear";
        project_id?: string;
        replace?: boolean;
        records?: ContextEnrichmentInput[];
        evidence?: EditorialEvidenceInput[];
      }) => {
        if (args.action === "capture") {
          const result = await loadSnapshot();
          if (!result.success) return result;
          const snapshot = result.data as PremiereContextSnapshot;
          const projectIdentity = snapshot.projectPath?.trim() || snapshot.projectName;
          const projectId = stableContextId("project", normalizeMediaPath(projectIdentity));
          const existing = await repository.get(projectId);
          const built = await buildContextDocumentFromSnapshot(snapshot, existing);
          await repository.put(built.document);
          return {
            success: true,
            data: {
              backend: await repository.backendName(),
              projectId: built.document.projectId,
              projectName: built.document.projectName,
              revision: built.document.revision,
              sourceRevision: built.document.sourceRevision,
              timelineRevision: built.document.timelineRevision,
              recordCount: built.document.records.length,
              invalidatedRecords: built.invalidatedRecords,
              captureTruncated: snapshot.sequence.truncated,
            },
          };
        }
        if (args.action === "status") {
          if (!args.project_id) {
            return { success: true, data: { backend: await repository.backendName(), projects: await repository.list() } };
          }
          const document = await repository.get(requireProjectId(args.project_id));
          if (!document) return { success: false, error: "Project context not found" };
          const counts = Object.fromEntries(
            [...new Set(document.records.map((record) => record.kind))].map((kind) => [
              kind,
              document.records.filter((record) => record.kind === kind).length,
            ]),
          );
          return {
            success: true,
            data: {
              backend: await repository.backendName(),
              projectId: document.projectId,
              projectName: document.projectName,
              revision: document.revision,
              sourceRevision: document.sourceRevision,
              timelineRevision: document.timelineRevision,
              recordCount: document.records.length,
              counts,
              updatedAt: document.updatedAt,
            },
          };
        }
        if (args.action === "clear") {
          const projectId = requireProjectId(args.project_id);
          return { success: true, data: { projectId, cleared: await repository.delete(projectId) } };
        }
        if (args.action === "enrich") {
          const projectId = requireProjectId(args.project_id);
          const current = await repository.get(projectId);
          if (!current) return { success: false, error: "Project context not found; capture it before enrichment" };
          const enriched = enrichContextDocument(current, args.records ?? [], args.replace === true);
          await repository.put(enriched.document);
          return {
            success: true,
            data: {
              backend: await repository.backendName(),
              projectId,
              revision: enriched.document.revision,
              sourceRevision: enriched.document.sourceRevision,
              timelineRevision: enriched.document.timelineRevision,
              recordCount: enriched.document.records.length,
              upserted: enriched.upserted,
            },
          };
        }
        if (args.action === "import_evidence") {
          const projectId = requireProjectId(args.project_id);
          const current = await repository.get(projectId);
          if (!current) return { success: false, error: "Project context not found; capture it before importing editorial evidence" };
          try {
            const inputs = editorialEvidenceToEnrichment(current, args.evidence ?? []);
            const enriched = enrichContextDocument(current, inputs, args.replace === true);
            await repository.put(enriched.document);
            return {
              success: true,
              data: {
                backend: await repository.backendName(),
                projectId,
                revision: enriched.document.revision,
                sourceRevision: enriched.document.sourceRevision,
                timelineRevision: enriched.document.timelineRevision,
                recordCount: enriched.document.records.length,
                upserted: enriched.upserted,
                importedEvidenceTypes: [...new Set(args.evidence!.map((entry) => entry.type))],
                applied: false,
                verificationBoundary: "Evidence was stored only in the local project-context index. The server did not open a frame, invoke vision/ASR/LLM/Adobe services, or mutate Premiere.",
              },
            };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        return { success: false, error: `Unsupported project context action: ${String(args.action)}` };
      },
    },
    search_project_context: {
      description: "Search a durable Premiere project-context index for relevant sources, timeline placements, transcript passages, shots, audio observations, and notes. Returns bounded evidence with stable IDs and revisions; it never changes Premiere.",
      parameters: {
        type: "object" as const,
        properties: {
          project_id: { type: "string", description: "Project context ID returned by manage_project_context capture" },
          query: { type: "string", description: "Natural-language or keyword query matched against indexed evidence" },
          sequence_id: { type: "string", description: "Optional exact sequence ID filter" },
          kinds: {
            type: "array",
            items: { type: "string", enum: ["project", "sequence", "source", "timeline", "transcript", "shot", "audio", "note"] },
            description: "Optional context-kind filter",
          },
          max_results: { type: "integer", minimum: 1, maximum: 50, description: "Maximum 50; default 12" },
        },
        required: ["project_id", "query"],
      },
      handler: async (args: {
        project_id: string;
        query: string;
        sequence_id?: string;
        kinds?: ProjectContextKind[];
        max_results?: number;
      }) => {
        const projectId = requireProjectId(args.project_id);
        if (args.max_results !== undefined &&
          (!Number.isInteger(args.max_results) || args.max_results < 1 || args.max_results > 50)) {
          return { success: false, error: "max_results must be an integer from 1 through 50" };
        }
        const document = await repository.get(projectId);
        if (!document) return { success: false, error: "Project context not found" };
        const results = searchProjectContext(document, {
          query: args.query,
          sequenceId: args.sequence_id,
          kinds: args.kinds,
          limit: args.max_results ?? 12,
        });
        return {
          success: true,
          data: {
            projectId,
            revision: document.revision,
            sourceRevision: document.sourceRevision,
            timelineRevision: document.timelineRevision,
            results: results.map(({ score, matchedTerms, record }) => ({
              score,
              matchedTerms,
              id: record.id,
              kind: record.kind,
              name: record.name,
              evidence: record.text,
              keywords: record.keywords,
              sequenceId: record.sequenceId,
              sourceId: record.sourceId,
              timelineItemId: record.timelineItemId,
              startSeconds: record.startSeconds,
              endSeconds: record.endSeconds,
              trackType: record.trackType,
              trackIndex: record.trackIndex,
              sourceRevision: record.sourceRevision,
              timelineItemRevision: record.timelineRevision,
              metadata: record.metadata,
            })),
          },
        };
      },
    },
    create_context_edit_plan: {
      description: "Create a non-mutating, evidence-backed edit-plan scaffold from indexed Premiere context. It returns ranked source/time candidates and stale-state guards; the model must review them and use preview_edit_plan before any mutation.",
      parameters: {
        type: "object" as const,
        properties: {
          project_id: { type: "string", description: "Project context ID returned by manage_project_context capture" },
          intent: { type: "string", description: "Editing goal, such as finding the strongest budget explanation for a rough cut" },
          sequence_id: { type: "string", description: "Optional exact sequence ID filter" },
          strategy: { type: "string", enum: ["rough_cut", "select_ranges", "review"], description: "Planning mode; default rough_cut" },
          max_candidates: { type: "number", description: "Maximum 25; default 8" },
        },
        required: ["project_id", "intent"],
      },
      handler: async (args: {
        project_id: string;
        intent: string;
        sequence_id?: string;
        strategy?: "rough_cut" | "select_ranges" | "review";
        max_candidates?: number;
      }) => {
        const projectId = requireProjectId(args.project_id);
        const document = await repository.get(projectId);
        if (!document) return { success: false, error: "Project context not found" };
        const results = searchProjectContext(document, {
          query: args.intent,
          sequenceId: args.sequence_id,
          kinds: ["transcript", "shot", "audio", "note", "timeline", "source"],
          limit: Math.max(1, Math.min(25, Math.trunc(args.max_candidates ?? 8))),
        });
        return {
          success: true,
          data: {
            applied: false,
            projectId,
            intent: normalizeContextText(args.intent).slice(0, 1_000),
            strategy: args.strategy ?? "rough_cut",
            expectedContextRevision: document.revision,
            expectedTimelineRevision: document.timelineRevision,
            candidates: results.map(({ score, record }) => ({
              evidenceId: record.id,
              score,
              kind: record.kind,
              name: record.name,
              evidence: record.text,
              sourceId: record.sourceId,
              timelineItemId: record.timelineItemId,
              startSeconds: record.startSeconds,
              endSeconds: record.endSeconds,
              sourceRevision: record.sourceRevision,
            })),
            nextSteps: [
              "Review candidate evidence and reject unsupported or duplicate ranges.",
              "Capture project context again if the active sequence changed; require the same expectedTimelineRevision.",
              "Resolve exact project-item and timeline identities before constructing operations.",
              "Call preview_edit_plan and present its confirmation token before apply_edit_plan.",
            ],
          },
        };
      },
    },
  };
}
