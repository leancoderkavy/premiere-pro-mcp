import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectContextDocument } from "../context/project-context-store.js";

const id = z.string().trim().min(1).max(512);
const frame = z.number().int().min(0).max(1_000_000_000);
const range = z.strictObject({ inFrame: frame.describe("Inclusive start frame."), outFrame: frame.describe("Exclusive end frame.") });
const rate = z.strictObject({ numerator: z.number().int().min(1).max(240_000), denominator: z.number().int().min(1).max(100_000) }).describe("Exact frames-per-second fraction, for example 24000/1001.");
const preference = z.strictObject({ reviewer: id, revision: id.describe("Human review revision, independent of script or host revisions."), rank: z.number().int().min(1).max(100).describe("Human rank; lower is preferred. Never automatically changes order or selects a take."), reason: z.string().trim().min(1).max(2000) });

/** Explicit declarations, never an inferred studio template or host observation. */
export const filmEditorialSchema = z.strictObject({
  project_id: id.describe("Captured project-context ID."),
  expected_context_revision: id.describe("Exact captured context revision; stale requests fail."),
  expected_source_revision: id.describe("Exact captured source revision."),
  expected_timeline_revision: id.describe("Exact captured timeline revision."),
  script_revision: id.describe("Human-supplied script revision for scene and line identities."),
  profile: z.strictObject({
    name: id,
    reviewMode: z.enum(["source_markers", "full_stringout", "line_comparison", "beat_sections"]),
    overlapFrames: frame,
    trackRoles: z.array(z.strictObject({ name: id, type: z.enum(["video", "audio"]), index: z.number().int().min(0).max(127) })).min(1).max(128),
  }).describe("Custom review preferences; overlap is a review-only source handle in each source timebase."),
  scenes: z.array(z.strictObject({ id, label: id })).min(1).max(200).describe("Expected script scenes, including those without coverage."),
  sources: z.array(z.strictObject({
    evidenceId: id, sourceId: id, sourceRevision: id, durationFrames: frame, timebase: rate,
    sync: z.enum(["checked", "issue", "unknown"]),
    channels: z.array(id).max(32),
  })).min(1).max(200).describe("Declared source inventory tied to captured source evidence; technical values require host verification."),
  coverage: z.array(z.strictObject({
    id, sourceId: id, sceneIds: z.array(id).min(1).max(20),
    range, setup: id, take: id, lineId: id.optional(), beatId: id.optional(),
    picture: preference.optional(), audio: preference.optional(),
  })).max(500).describe("Many-to-many source-range to scene graph. Preferences never remove unselected coverage."),
  occurrences: z.array(z.strictObject({
    id, evidenceId: id, timelineRevision: id, sourceId: id, coverageId: id, sequenceId: id, reelId: id,
    sourceRange: range, timelineRange: range, timebase: rate,
    speed: z.enum(["1x", "retimed"]),
  })).max(500).describe("Explicit source/timeline occurrences, separate from source coverage; retimes block automatic handoff."),
  notes: z.array(z.strictObject({
    id, sequenceId: id, timelineRevision: id, frame, text: z.string().trim().min(1).max(2000),
    status: z.enum(["open", "addressed", "accepted"]), reviewer: id,
  })).max(200).describe("Version-bound screening notes. Stale notes remain unresolved; frames are never guessed onto a new cut."),
  vfx: z.array(z.strictObject({
    shotId: id, occurrenceId: id, version: id, previousVersion: id.optional(),
    creativeStatus: z.enum(["candidate", "accepted", "rejected"]),
    deliveryStatus: z.enum(["not_sent", "sent", "acknowledged", "reconciled"]),
    receipt: id.optional(),
  })).max(200).describe("Independent creative and delivery states; reconciled deliveries require a receipt."),
  storyCards: z.array(z.strictObject({ id, title: id, coverageIds: z.array(id).min(1).max(100), dependsOn: z.array(id).max(100) })).max(100).describe("Reorderable story fragments and explicit dependency graph."),
  turnover: z.strictObject({
    department: z.enum(["sound", "color", "vfx"]), handlesFrames: frame,
    format: z.enum(["AAF", "XML", "EDL", "manifest"]),
    settings: z.string().trim().min(1).max(2000),
  }).describe("Requested turnover settings; handles use each source timebase. This tool creates a manifest, never an export."),
  viewing: z.strictObject({
    purpose: z.enum(["editorial", "screening", "turnover"]),
    burnIns: z.boolean(), roughVfx: z.boolean(), tempAudio: z.boolean(),
  }).describe("Explicit output viewing profile; rendered-output checks remain required."),
  previous: z.strictObject({
    projectId: id, sourceRevision: id, timelineRevision: id,
    occurrences: z.array(z.strictObject({ id, sourceId: id, sourceRevision: id, sourceTimebase: rate, sequenceId: id, reelId: id, sourceRange: range, timelineRange: range, timebase: rate, speed: z.enum(["1x", "retimed"]) })).max(500),
  }).optional().describe("Optional previously saved occurrence snapshot for change impact. Caller supplied, not an authenticated host receipt."),
});

export type FilmEditorialInput = z.infer<typeof filmEditorialSchema>;

function unique<T>(items: T[], key: (item: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const value = key(item);
    if (result.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    result.set(value, item);
  }
  return result;
}

function validRange(value: z.infer<typeof range>, label: string, duration?: number) {
  if (value.outFrame <= value.inFrame || (duration !== undefined && value.outFrame > duration)) {
    throw new Error(`Invalid half-open frame range for ${label}`);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function buildFilmEditorialPacket(document: ProjectContextDocument, raw: unknown) {
  const input = filmEditorialSchema.parse(raw);
  if (document.projectId !== input.project_id || document.revision !== input.expected_context_revision ||
      document.sourceRevision !== input.expected_source_revision || document.timelineRevision !== input.expected_timeline_revision) {
    throw new Error("Project context is stale or belongs to another project; recapture and review the manifest");
  }
  const evidence = unique(document.records, r => r.id, "context evidence");
  const scenes = unique(input.scenes, s => s.id, "scene");
  const sources = unique(input.sources, s => s.sourceId, "source");
  unique(input.sources, s => s.evidenceId, "source evidence");
  unique(input.profile.trackRoles, t => `${t.type}:${t.index}`, "track assignment");
  const coverage = unique(input.coverage, c => c.id, "coverage");
  const occurrences = unique(input.occurrences, o => o.id, "occurrence");
  unique(input.occurrences, o => o.evidenceId, "occurrence evidence");
  unique(input.notes, n => n.id, "note");
  unique(input.vfx, v => v.shotId, "VFX shot");
  const cards = unique(input.storyCards, c => c.id, "story card");
  for (const source of sources.values()) {
    const record = evidence.get(source.evidenceId);
    if (!record || record.kind !== "source" || record.sourceId !== source.sourceId ||
        record.sourceRevision !== source.sourceRevision) {
      throw new Error(`Source identity/revision mismatch: ${source.sourceId}`);
    }
    if (source.durationFrames === 0) throw new Error(`Source duration must be positive: ${source.sourceId}`);
    unique(source.channels, c => c, "channel");
  }
  for (const item of coverage.values()) {
    const source = sources.get(item.sourceId);
    if (!source) throw new Error(`Unknown source: ${item.sourceId}`);
    validRange(item.range, item.id, source.durationFrames);
    unique(item.sceneIds, s => s, "scene reference");
    for (const scene of item.sceneIds) if (!scenes.has(scene)) throw new Error(`Unknown scene: ${scene}`);
    if (input.profile.reviewMode === "line_comparison" && !item.lineId) throw new Error(`Line comparison requires lineId: ${item.id}`);
    if (input.profile.reviewMode === "beat_sections" && !item.beatId) throw new Error(`Beat sections require beatId: ${item.id}`);
  }
  for (const occurrence of occurrences.values()) {
    const source = sources.get(occurrence.sourceId);
    const item = coverage.get(occurrence.coverageId);
    const record = evidence.get(occurrence.evidenceId);
    if (!source || !item || item.sourceId !== occurrence.sourceId || !record || record.kind !== "timeline" ||
        record.timelineItemId !== occurrence.id || record.sourceId !== occurrence.sourceId || record.sequenceId !== occurrence.sequenceId ||
        record.timelineRevision !== occurrence.timelineRevision || (record.sourceRevision !== undefined && record.sourceRevision !== source.sourceRevision)) throw new Error(`Occurrence identity/revision mismatch: ${occurrence.id}`);
    validRange(occurrence.sourceRange, occurrence.id, source.durationFrames);
    validRange(occurrence.timelineRange, occurrence.id);
    const secondsPerFrame = occurrence.timebase.denominator / occurrence.timebase.numerator;
    if ((record.startSeconds !== undefined && Math.abs(record.startSeconds - occurrence.timelineRange.inFrame * secondsPerFrame) > 0.000001) ||
        (record.endSeconds !== undefined && Math.abs(record.endSeconds - occurrence.timelineRange.outFrame * secondsPerFrame) > 0.000001)) throw new Error(`Captured timeline timing mismatch: ${occurrence.id}`);
    if (occurrence.sourceRange.inFrame < item.range.inFrame || occurrence.sourceRange.outFrame > item.range.outFrame) throw new Error(`Occurrence exceeds coverage: ${occurrence.id}`);
    if (occurrence.speed === "1x") {
      const sourceDuration = BigInt(occurrence.sourceRange.outFrame - occurrence.sourceRange.inFrame) * BigInt(source.timebase.denominator) * BigInt(occurrence.timebase.numerator);
      const timelineDuration = BigInt(occurrence.timelineRange.outFrame - occurrence.timelineRange.inFrame) * BigInt(occurrence.timebase.denominator) * BigInt(source.timebase.numerator);
      if (sourceDuration !== timelineDuration) throw new Error(`1x duration/timebase mismatch: ${occurrence.id}`);
    }
  }
  for (const shot of input.vfx) {
    if (!occurrences.has(shot.occurrenceId)) throw new Error(`Unknown VFX occurrence: ${shot.occurrenceId}`);
    if (shot.previousVersion === shot.version) throw new Error(`VFX lineage must retain a different previous version: ${shot.shotId}`);
    if (shot.deliveryStatus !== "not_sent" && !shot.receipt) throw new Error(`VFX delivery state requires a receipt: ${shot.shotId}`);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(cardId: string) {
    if (visiting.has(cardId)) throw new Error(`Story dependency cycle: ${cardId}`);
    if (visited.has(cardId)) return;
    const card = cards.get(cardId);
    if (!card) throw new Error(`Unknown story dependency: ${cardId}`);
    visiting.add(cardId);
    unique(card.coverageIds, c => c, "story coverage reference");
    unique(card.dependsOn, c => c, "story dependency");
    for (const ref of card.coverageIds) if (!coverage.has(ref)) throw new Error(`Unknown story coverage: ${ref}`);
    for (const dependency of card.dependsOn) visit(dependency);
    visiting.delete(cardId);
    visited.add(cardId);
  }
  for (const card of input.storyCards) visit(card.id);

  const exceptions: { code: string; id: string; detail: string }[] = [];
  const add = (code: string, id: string, detail: string) => exceptions.push({ code, id, detail });
  for (const record of document.records) {
    if (record.kind === "sequence" && record.metadata?.captureTruncated === true) add("capture_truncated", record.id, "Recapture a complete scoped sequence before turnover.");
  }
  const capturedSources = document.records.filter(r => r.kind === "source");
  for (const source of capturedSources) if (!input.sources.some(s => s.evidenceId === source.id)) add("source_not_in_inventory", source.id, "Captured source is outside this packet; project-wide coverage is incomplete.");
  for (const record of document.records.filter(r => r.kind === "timeline")) {
    if (!input.occurrences.some(o => o.evidenceId === record.id)) add("occurrence_not_in_inventory", record.id, "Captured timeline occurrence is outside the turnover manifest.");
  }
  if (!input.occurrences.length) add("turnover_empty", input.project_id, "No timeline occurrences are available for turnover.");
  for (const source of input.sources) {
    if (evidence.get(source.evidenceId)?.metadata?.offline === true) add("source_offline", source.sourceId, "Captured media is offline.");
    if (source.sync !== "checked") add("sync_unresolved", source.sourceId, source.sync);
    if (!source.channels.length) add("channels_missing", source.sourceId, "Supply the original channel layout before sound turnover.");
    if (!input.coverage.some(c => c.sourceId === source.sourceId)) add("source_unreviewed", source.sourceId, "No source coverage ranges have been recorded.");
  }
  const sceneCoverage = input.scenes.map(scene => {
    const items = input.coverage.filter(c => c.sceneIds.includes(scene.id));
    if (!items.length) add("scene_uncovered", scene.id, "No declared source coverage for this script scene.");
    return { ...scene, coverageIds: items.map(c => c.id), setupCount: new Set(items.map(c => c.setup)).size,
      picturePreferences: items.filter(c => c.picture).map(c => ({ coverageId: c.id, ...c.picture! })),
      audioPreferences: items.filter(c => c.audio).map(c => ({ coverageId: c.id, ...c.audio! })) };
  });
  const reviewGroups = sceneCoverage.map(scene => ({ sceneId: scene.id, items: scene.coverageIds.map(ref => {
    const item = coverage.get(ref)!;
    const source = sources.get(item.sourceId)!;
    const overlap = input.profile.reviewMode === "beat_sections" ? input.profile.overlapFrames : 0;
    return { coverageId: ref, sourceId: item.sourceId, group: item.lineId && input.profile.reviewMode === "line_comparison" ? item.lineId : item.beatId && input.profile.reviewMode === "beat_sections" ? item.beatId : item.setup,
      sourceRange: item.range, reviewRange: { inFrame: Math.max(0, item.range.inFrame - overlap), outFrame: Math.min(source.durationFrames, item.range.outFrame + overlap) },
      timebase: source.timebase, picture: item.picture ?? null, audio: item.audio ?? null };
  }) }));
  const reviewArtifacts = input.profile.reviewMode === "source_markers"
    ? { kind: "source_markers", markers: input.coverage.map(item => ({ coverageId: item.id, sourceId: item.sourceId, sourceRange: item.range, timebase: sources.get(item.sourceId)!.timebase, sceneIds: item.sceneIds, label: [item.setup, item.take, item.lineId ?? item.beatId].filter(Boolean).join(" / ") })) }
    : { kind: input.profile.reviewMode, sequences: reviewGroups.flatMap(scene => {
      const groups = new Map<string, typeof scene.items>();
      for (const item of scene.items) {
        const key = input.profile.reviewMode === "full_stringout" ? "all_coverage" : item.group;
        const items = groups.get(key) ?? [];
        items.push(item);
        groups.set(key, items);
      }
      return [...groups].map(([group, items]) => ({ sceneId: scene.sceneId, group, orderedSourceSegments: items,
        assemblyStatus: "requires_host_preview", mixedTimebases: new Set(items.map(i => `${i.timebase.numerator}/${i.timebase.denominator}`)).size > 1 }));
    }) };
  const notes = input.notes.map(note => {
    const sequenceKnown = document.records.some(r => r.sequenceId === note.sequenceId && r.timelineRevision === document.timelineRevision);
    const resolution = !sequenceKnown ? "sequence_unresolved" : note.timelineRevision !== document.timelineRevision ? "revision_unresolved" : "current_revision";
    if (resolution !== "current_revision") add(resolution, note.id, "Keep the original frame and revision; request human remapping.");
    return { ...note, resolution, remapped: false };
  });
  const turnoverEntries = input.occurrences.map(occurrence => {
    const source = sources.get(occurrence.sourceId)!;
    const record = evidence.get(occurrence.evidenceId)!;
    if (record.startSeconds === undefined || record.endSeconds === undefined) add("timeline_timing_unverified", occurrence.id, "Captured context lacks timeline range readback.");
    const handles = input.turnover.handlesFrames;
    const availableHead = Math.min(handles, occurrence.sourceRange.inFrame);
    const availableTail = Math.min(handles, source.durationFrames - occurrence.sourceRange.outFrame);
    if (availableHead !== handles || availableTail !== handles) add("handles_short", occurrence.id, "Requested handles exceed declared source bounds.");
    if (occurrence.speed !== "1x") add("retime_manual_review", occurrence.id, "Source mapping requires host inspection before handoff.");
    return { ...occurrence, sourceEvidenceId: source.evidenceId, sourceRevision: source.sourceRevision, sourceTimebase: source.timebase,
      channels: source.channels, requestedHandles: handles, availableHead, availableTail,
      exportSourceRange: { inFrame: occurrence.sourceRange.inFrame - availableHead, outFrame: occurrence.sourceRange.outFrame + availableTail } };
  });
  const snapshot = { projectId: input.project_id, sourceRevision: input.expected_source_revision, timelineRevision: input.expected_timeline_revision,
    occurrences: input.occurrences.map(({ id, sourceId, sequenceId, reelId, sourceRange, timelineRange, timebase, speed }) => ({ id, sourceId, sourceRevision: sources.get(sourceId)!.sourceRevision, sourceTimebase: sources.get(sourceId)!.timebase, sequenceId, reelId, sourceRange, timelineRange, timebase, speed })) };
  const changes: { id: string; change: string; departments: string[] }[] = [];
  if (input.previous) {
    if (input.previous.projectId !== input.project_id) throw new Error("Previous snapshot belongs to another project");
    const prior = unique(input.previous.occurrences, o => o.id, "previous occurrence");
    for (const old of prior.values()) {
      validRange(old.sourceRange, old.id);
      validRange(old.timelineRange, old.id);
    }
    if (input.previous.timelineRevision === snapshot.timelineRevision && input.previous.sourceRevision === snapshot.sourceRevision && stable(input.previous) !== stable(snapshot)) throw new Error("Different occurrence snapshots cannot share a timeline revision and source revision");
    for (const now of snapshot.occurrences) {
      const old = prior.get(now.id);
      if (!old || stable(old) !== stable(now)) changes.push({ id: now.id, change: !old ? "added" : old.reelId !== now.reelId ? "reel_changed" : "changed", departments: ["sound", "color", "vfx"] });
    }
    for (const old of prior.values()) if (!occurrences.has(old.id)) changes.push({ id: old.id, change: "removed", departments: ["sound", "color", "vfx"] });
  }
  return {
    schemaVersion: 1, packetId: createHash("sha256").update(stable(input)).digest("hex"),
    projectId: input.project_id, expectedContextRevision: document.revision, expectedSourceRevision: document.sourceRevision,
    expectedTimelineRevision: document.timelineRevision, scriptRevision: input.script_revision,
    applied: false, hostVerified: false, evidenceBoundary: "captured_identity_and_caller_declarations",
    profile: input.profile, sourceInventory: input.sources, coverageGraph: input.coverage, sceneCoverage, reviewGroups, reviewArtifacts,
    coverageScope: "declared_ranges_only", exceptions, notes,
    vfx: input.vfx.map(shot => ({ ...shot, replacementAuthorized: false })),
    storyCards: input.storyCards, storyDependencyOrder: [...visited],
    viewing: { ...input.viewing, requiredOutputChecks: ["Verify track visibility and overlays in rendered frames", "Verify rough VFX and temporary audio against the chosen profile"], verified: false },
    turnover: { ...input.turnover, entries: turnoverEntries, exported: false, readyForHostPreflight: exceptions.length === 0,
      requiredHostChecks: ["Verify source durations, timebases, channels, sync and occurrence ranges", "Inspect effects, nests, multicam, merged clips and retimes", "Verify interchange support, handles and an actual round-trip import"] },
    changeImpact: { scope: "declared_occurrences_and_source_revisions", compared: Boolean(input.previous), previousRevision: input.previous?.timelineRevision ?? null, changes }, snapshot,
    nextSteps: ["Review declarations and exceptions with the editor and assistant editor", "Use create_editorial_plan and preview_editorial_plan for supported organization; apply only through its guarded route", "Build and inspect derivative review sequences using live host tools; this packet is not an executable edit plan", "Recapture context after edits and regenerate this packet before turnover"],
  };
}
