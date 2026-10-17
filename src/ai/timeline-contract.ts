import { createHash } from "node:crypto";
import { ticks, rate, frameToTicks, type RationalRate } from "./exact-time.js";

export interface TimelineClip {
  id: string; source_id: string; track_id: string; start_ticks: string; end_ticks: string; in_ticks: string; out_ticks: string;
  source_duration_ticks: string | null; speed: RationalRate; reversed: boolean; enabled: boolean;
  linked_ids: string[]; identity: "host" | "synthetic"; effects: EffectDescriptor[]; nested: boolean;
}
export interface EffectDescriptor { identity: string; match_name: string | null; display_name: string; built_in: boolean; parameters: Array<{ identity: string; display_name: string; type: "number" | "boolean" | "string" | "unknown"; units: string | null; animated: boolean | null; writable: boolean | null }> }
export interface TimelineTrack { id: string; type: "video" | "audio"; index: number; locked: boolean | null; sync_locked: boolean | null; targeted: boolean | null; muted: boolean | null }
export interface TimelineSnapshot {
  schema_version: 1; backend: "cep" | "uxp" | "offline"; project_id: string; sequence_id: string; session_id: string;
  revision: string; frame_rate: RationalRate; display_start_ticks: string; tracks: TimelineTrack[]; clips: TimelineClip[];
  completeness: { clips: boolean; links: boolean; locks: boolean; effects: boolean; transitions: boolean; markers: boolean };
  transitions: unknown[]; markers: unknown[]; pagination: { offset: number; total: number; next_offset: number | null };
}
export const MAX_SNAPSHOT_CLIPS = 10000;
export function boundedObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!keys.includes(key)) throw new Error(`${label} has unknown field ${key}`);
  return object;
}
export function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new Error(`${label} must be an identity string of 1 to 512 characters`);
  return value;
}
function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be an array of at most ${maximum} entries`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}
function nullableBoolean(value: unknown, label: string): boolean | null { return value === null ? null : boolean(value, label); }
export function snapshotRevision(snapshot: Omit<TimelineSnapshot, "revision"> | TimelineSnapshot): string {
  const { revision: _revision, ...data } = snapshot as TimelineSnapshot;
  return `sha256:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
}
export function validateSnapshot(value: unknown): TimelineSnapshot {
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > 8 * 1024 * 1024) throw new Error("snapshot exceeds 8 MiB");
  const raw = boundedObject(value, ["schema_version", "backend", "project_id", "sequence_id", "session_id", "revision", "frame_rate", "display_start_ticks", "tracks", "clips", "completeness", "transitions", "markers", "pagination"], "snapshot");
  if (raw.schema_version !== 1 || !["cep", "uxp", "offline"].includes(String(raw.backend))) throw new Error("unsupported snapshot schema/backend");
  const tracks = array(raw.tracks, 512, "tracks").map((entry): TimelineTrack => {
    const t = boundedObject(entry, ["id", "type", "index", "locked", "sync_locked", "targeted", "muted"], "track");
    if (!["video", "audio"].includes(String(t.type)) || !Number.isSafeInteger(t.index) || Number(t.index) < 0) throw new Error("invalid track type/index");
    return { id: identity(t.id, "track.id"), type: t.type as TimelineTrack["type"], index: t.index as number, locked: nullableBoolean(t.locked, "locked"), sync_locked: nullableBoolean(t.sync_locked, "sync_locked"), targeted: nullableBoolean(t.targeted, "targeted"), muted: nullableBoolean(t.muted, "muted") };
  });
  if (new Set(tracks.map(t => t.id)).size !== tracks.length) throw new Error("duplicate track identity");
  const clips = array(raw.clips, MAX_SNAPSHOT_CLIPS, "clips").map((entry): TimelineClip => {
    const c = boundedObject(entry, ["id", "source_id", "track_id", "start_ticks", "end_ticks", "in_ticks", "out_ticks", "source_duration_ticks", "speed", "reversed", "enabled", "linked_ids", "identity", "effects", "nested"], "clip");
    for (const field of ["start_ticks", "end_ticks", "in_ticks", "out_ticks"]) ticks(c[field], field);
    if (ticks(c.end_ticks) <= ticks(c.start_ticks) || ticks(c.out_ticks) <= ticks(c.in_ticks) || ticks(c.start_ticks) < 0n || ticks(c.in_ticks) < 0n) throw new Error("clip ranges must be positive exclusive-end intervals");
    if (c.source_duration_ticks !== null && ticks(c.source_duration_ticks) < ticks(c.out_ticks)) {
      const padding = ticks(c.out_ticks) - ticks(c.source_duration_ticks);
      const frame = ticks(frameToTicks("1", rate(raw.frame_rate as RationalRate)));
      const speed = rate(c.speed as RationalRate);
      if (raw.backend !== "cep" || c.identity !== "host" || c.reversed !== false || c.nested !== false || speed.numerator !== speed.denominator || ticks(c.in_ticks) >= ticks(c.source_duration_ticks) || padding >= frame) throw new Error(`Existing source window exceeds source duration by ${padding} ticks; only host padding below one sequence frame is allowed`);
    }
    if (!["host", "synthetic"].includes(String(c.identity))) throw new Error("clip identity must be host or synthetic");
    const effects = array(c.effects, 256, "effects").map((effect): EffectDescriptor => {
      const e = boundedObject(effect, ["identity", "match_name", "display_name", "built_in", "parameters"], "effect");
      return { identity: identity(e.identity, "effect.identity"), match_name: e.match_name === null ? null : identity(e.match_name, "match_name"), display_name: identity(e.display_name, "display_name"), built_in: boolean(e.built_in, "built_in"), parameters: array(e.parameters, 256, "parameters").map((parameter) => {
        const p = boundedObject(parameter, ["identity", "display_name", "type", "units", "animated", "writable"], "parameter");
        if (!["number", "boolean", "string", "unknown"].includes(String(p.type))) throw new Error("unknown parameter type");
        return { identity: identity(p.identity, "parameter.identity"), display_name: identity(p.display_name, "parameter.display_name"), type: p.type as EffectDescriptor["parameters"][number]["type"], units: p.units === null ? null : identity(p.units, "units"), animated: nullableBoolean(p.animated, "animated"), writable: nullableBoolean(p.writable, "writable") };
      }) };
    });
    const clip: TimelineClip = { id: identity(c.id, "clip.id"), source_id: identity(c.source_id, "source_id"), track_id: identity(c.track_id, "track_id"), start_ticks: c.start_ticks as string, end_ticks: c.end_ticks as string, in_ticks: c.in_ticks as string, out_ticks: c.out_ticks as string, source_duration_ticks: c.source_duration_ticks as string | null, speed: rate(c.speed as RationalRate), reversed: boolean(c.reversed, "reversed"), enabled: boolean(c.enabled, "enabled"), linked_ids: array(c.linked_ids, 256, "linked_ids").map(id => identity(id, "linked id")), identity: c.identity as TimelineClip["identity"], effects, nested: boolean(c.nested, "nested") };
    if (!tracks.some(t => t.id === clip.track_id)) throw new Error("clip references an unknown track");
    return clip;
  });
  if (new Set(clips.map(c => c.id)).size !== clips.length) throw new Error("duplicate clip identity");
  const completeness = boundedObject(raw.completeness, ["clips", "links", "locks", "effects", "transitions", "markers"], "completeness");
  for (const field of ["clips", "links", "locks", "effects", "transitions", "markers"]) boolean(completeness[field], field);
  if (completeness.locks && tracks.some(track => track.locked === null)) throw new Error("complete locks require known lock state on every track");
  if (completeness.clips && completeness.links) {
    const byId = new Map(clips.map(clip => [clip.id, clip]));
    for (const clip of clips) for (const partnerId of clip.linked_ids) if (!byId.has(partnerId) || !byId.get(partnerId)!.linked_ids.includes(clip.id)) throw new Error("complete links require present reciprocal partner identities");
  }
  const page = boundedObject(raw.pagination, ["offset", "total", "next_offset"], "pagination");
  if (!Number.isSafeInteger(page.offset) || Number(page.offset) < 0 || !Number.isSafeInteger(page.total) || Number(page.total) < Number(page.offset) + clips.length || !(page.next_offset === null || (Number.isSafeInteger(page.next_offset) && Number(page.next_offset) === Number(page.offset) + clips.length && Number(page.next_offset) < Number(page.total)))) throw new Error("invalid snapshot pagination");
  if (completeness.clips && (page.offset !== 0 || page.next_offset !== null || page.total !== clips.length)) throw new Error("complete snapshot cannot have missing pages");
  ticks(raw.display_start_ticks, "display_start_ticks");
  const snapshot: TimelineSnapshot = { schema_version: 1, backend: raw.backend as TimelineSnapshot["backend"], project_id: identity(raw.project_id, "project_id"), sequence_id: identity(raw.sequence_id, "sequence_id"), session_id: identity(raw.session_id, "session_id"), revision: identity(raw.revision, "revision"), frame_rate: rate(raw.frame_rate as RationalRate), display_start_ticks: raw.display_start_ticks as string, tracks, clips, completeness: completeness as unknown as TimelineSnapshot["completeness"], transitions: array(raw.transitions, 2000, "transitions"), markers: array(raw.markers, 2000, "markers"), pagination: page as unknown as TimelineSnapshot["pagination"] };
  if (snapshot.revision !== snapshotRevision(snapshot)) throw new Error("snapshot revision does not match exact canonical content");
  return snapshot;
}

export type ExpectedEdit = { type: "enable"; clip_id: string; enabled: boolean } | { type: "move"; clip_id: string; start_ticks: string } | { type: "trim"; clip_id: string; in_ticks?: string; out_ticks?: string } | { type: "remove"; clip_id: string; ripple: boolean; scope: "track" | "sync_locked" } | { type: "split"; clip_id: string; at_ticks: string; right_id: string } | { type: "insert" | "overwrite"; clip: TimelineClip; scope: "track" | "sync_locked" };
export function affectedTracks(snapshot: TimelineSnapshot, trackId: string, scope: "track" | "sync_locked"): TimelineTrack[] {
  if (scope !== "track" && scope !== "sync_locked") throw new Error("unsupported ripple scope");
  const selected = snapshot.tracks.filter(t => t.id === trackId || (scope === "sync_locked" && t.sync_locked === true));
  if (scope === "sync_locked" && snapshot.tracks.some(t => t.sync_locked === null)) throw new Error("SYNC_SCOPE_UNKNOWN: inspect sync-lock state before planning");
  if (!selected.length || selected.some(t => t.locked !== false)) throw new Error("TRACK_LOCKED_OR_UNKNOWN: participating tracks must be explicitly unlocked");
  return selected;
}
/**
 * Without a known source duration, only source frames the clip already uses are
 * proven to exist: a move or a shortening trim stays inside the current in/out.
 * Inserted or overwritten candidates name a caller-supplied range, so they pass
 * `requireSourceDuration` and still need the duration.
 */
export function sourceHandlePreflight(snapshot: TimelineSnapshot, clip: TimelineClip, proposedIn: string, proposedOut: string, proposedStart: string, proposedEnd: string, requireSourceDuration = false): void {
  if (clip.speed.numerator !== clip.speed.denominator || clip.reversed || clip.nested) throw new Error("UNSUPPORTED_TIME_MAPPING: edits require nonnested forward 1x media");
  const i = ticks(proposedIn), o = ticks(proposedOut), s = ticks(proposedStart), e = ticks(proposedEnd);
  if (clip.source_duration_ticks === null && requireSourceDuration) throw new Error("SOURCE_DURATION_UNKNOWN: inserted or overwritten source ranges need a known source duration; inspect physical source handles before planning");
  if (clip.source_duration_ticks === null && (i < ticks(clip.in_ticks) || o > ticks(clip.out_ticks))) throw new Error("SOURCE_DURATION_UNKNOWN: a source duration is needed only to extend beyond the clip's current source range; inspect physical source handles before planning");
  const physicalEnd = clip.source_duration_ticks === null ? null : ticks(clip.source_duration_ticks);
  const originalOut = ticks(clip.out_ticks);
  const frameTicks = ticks(frameToTicks("1", snapshot.frame_rate));
  if (physicalEnd !== null && originalOut - physicalEnd >= frameTicks) throw new Error(`SOURCE_HANDLE_BOUNDARY: existing source window is over physical end by ${originalOut - physicalEnd} ticks, at least one sequence frame`);
  const sourceLimit = physicalEnd === null || (!requireSourceDuration && originalOut > physicalEnd) ? originalOut : physicalEnd;
  if (i < 0n || (physicalEnd !== null && i >= physicalEnd) || o > sourceLimit || o <= i || s < 0n || e <= s || e - s !== o - i) throw new Error("SOURCE_HANDLE_BOUNDARY: proposed range exceeds source or has inconsistent duration");
  if (snapshot.tracks.find(track => track.id === clip.track_id)?.type === "video" && e - s < ticks(frameToTicks("1", snapshot.frame_rate))) throw new Error("MINIMUM_VISIBLE_DURATION: edit would create a subframe video sliver");
  if (snapshot.clips.some(other => other.id !== clip.id && other.track_id === clip.track_id && ticks(other.start_ticks) < e && ticks(other.end_ticks) > s)) throw new Error("NEIGHBOR_OCCUPIED: edit would overlap another clip");
}
function requirePrediction(snapshot: TimelineSnapshot): void {
  if (!snapshot.completeness.clips || !snapshot.completeness.links || !snapshot.completeness.locks) throw new Error("INCOMPLETE_SNAPSHOT: prediction requires complete clips, links and lock state");
  if (snapshot.clips.some(c => c.identity !== "host")) throw new Error("SYNTHETIC_IDENTITY: synthetic clip identities cannot authorize an edit");
}
/** Conservative subset model, never a claim of undocumented Premiere semantics. */
export function predictEdits(input: unknown, operations: ExpectedEdit[]): { snapshot: TimelineSnapshot; changes: Array<{ id: string; before: TimelineClip | null; after: TimelineClip | null }>; participants: string[]; host_verified: false } {
  const original = validateSnapshot(input); requirePrediction(original);
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) throw new Error("operations require 1 to 100 entries");
  const next = structuredClone(original), participants = new Set<string>();
  for (const operation of operations) {
    boundedObject(operation, operation.type === "enable" ? ["type", "clip_id", "enabled"] : operation.type === "move" ? ["type", "clip_id", "start_ticks"] : operation.type === "trim" ? ["type", "clip_id", "in_ticks", "out_ticks"] : operation.type === "remove" ? ["type", "clip_id", "ripple", "scope"] : operation.type === "split" ? ["type", "clip_id", "at_ticks", "right_id"] : ["type", "clip", "scope"], "operation");
    if (operation.type === "insert" || operation.type === "overwrite") {
      const candidate = structuredClone(operation.clip);
      const validation = { ...next, clips: [candidate], pagination: { offset: 0, total: 1, next_offset: null } };
      validation.revision = snapshotRevision(validation); validateSnapshot(validation);
      if (next.clips.some(c => c.id === candidate.id)) throw new Error("insert requires a unique prediction identity");
      // A placement ID cannot be known before Premiere creates it. Even when
      // the source planner supplied a host-looking ID, predicted additions
      // remain synthetic and cannot become an apply authorization.
      candidate.identity = "synthetic";
      const tracks = affectedTracks(next, candidate.track_id, operation.scope), selected = new Set(tracks.map(t => t.id));
      const start = ticks(candidate.start_ticks), end = ticks(candidate.end_ticks), duration = end - start;
      if (operation.type === "overwrite") {
        // Trimming/splitting victims or linked deletion requires host-specific evidence.
        const victims = next.clips.filter(c => c.track_id === candidate.track_id && ticks(c.start_ticks) < end && ticks(c.end_ticks) > start);
        if (victims.some(c => ticks(c.start_ticks) < start || ticks(c.end_ticks) > end || c.linked_ids.length)) throw new Error("OVERWRITE_PARTIAL_OR_LINKED: prediction refuses collateral source/link edits");
        next.clips = next.clips.filter(c => !victims.includes(c));
      } else {
        if (next.clips.some(c => selected.has(c.track_id) && ticks(c.start_ticks) < start && ticks(c.end_ticks) > start)) throw new Error("STRADDLING_CLIP: insertion requires separately modeled split");
        for (const c of next.clips) if (selected.has(c.track_id) && ticks(c.start_ticks) >= start) { c.start_ticks = (ticks(c.start_ticks) + duration).toString(); c.end_ticks = (ticks(c.end_ticks) + duration).toString(); participants.add(c.id); }
      }
      sourceHandlePreflight(next, candidate, candidate.in_ticks, candidate.out_ticks, candidate.start_ticks, candidate.end_ticks, true);
      next.clips.push(candidate); participants.add(candidate.id); continue;
    }
    if (!("clip_id" in operation)) throw new Error("unsupported expected edit operation");
    const clip = next.clips.find(c => c.id === operation.clip_id);
    if (!clip) throw new Error("CLIP_NOT_FOUND");
    affectedTracks(next, clip.track_id, "track"); participants.add(clip.id);
    if (operation.type !== "enable" && clip.linked_ids.length) throw new Error("LINKED_EDIT_REQUIRES_GROUP: model refuses edits without an explicit partner operation group");
    if (operation.type === "enable") clip.enabled = boolean(operation.enabled, "enabled");
    else if (operation.type === "move") {
      const start = ticks(operation.start_ticks), end = start + ticks(clip.end_ticks) - ticks(clip.start_ticks);
      sourceHandlePreflight(next, clip, clip.in_ticks, clip.out_ticks, start.toString(), end.toString());
      clip.start_ticks = start.toString(); clip.end_ticks = end.toString();
    } else if (operation.type === "trim") {
      if ((operation.in_ticks === undefined) === (operation.out_ticks === undefined)) throw new Error("trim requires exactly one source boundary");
      const i = operation.in_ticks ?? clip.in_ticks, o = operation.out_ticks ?? clip.out_ticks;
      const start = ticks(clip.start_ticks) + ticks(i) - ticks(clip.in_ticks), end = ticks(clip.end_ticks) + ticks(o) - ticks(clip.out_ticks);
      sourceHandlePreflight(next, clip, i, o, start.toString(), end.toString()); Object.assign(clip, { in_ticks: i, out_ticks: o, start_ticks: start.toString(), end_ticks: end.toString() });
    } else if (operation.type === "split") {
      const at = ticks(operation.at_ticks), rightId = identity(operation.right_id, "right_id");
      if (clip.reversed || clip.nested || clip.speed.numerator !== clip.speed.denominator || clip.effects.length) throw new Error("SPLIT_SEMANTICS_UNSUPPORTED: split requires plain forward 1x source");
      if (at <= ticks(clip.start_ticks) || at >= ticks(clip.end_ticks) || next.clips.some(c => c.id === rightId)) throw new Error("split boundary or right identity invalid");
      if (next.tracks.find(t => t.id === clip.track_id)?.type === "video") { const frame = ticks(frameToTicks("1", next.frame_rate)); if (at - ticks(clip.start_ticks) < frame || ticks(clip.end_ticks) - at < frame) throw new Error("MINIMUM_VISIBLE_DURATION: split would create a subframe video sliver"); }
      const source = ticks(clip.in_ticks) + at - ticks(clip.start_ticks), right = { ...structuredClone(clip), id: rightId, identity: "synthetic" as const, start_ticks: at.toString(), in_ticks: source.toString() };
      clip.end_ticks = at.toString(); clip.out_ticks = source.toString(); next.clips.push(right); participants.add(right.id);
    } else if (operation.type === "remove") {
      boolean(operation.ripple, "ripple"); next.clips = next.clips.filter(c => c.id !== clip.id);
      if (operation.ripple) {
        const scope = new Set(affectedTracks(next, clip.track_id, operation.scope).map(t => t.id)), start = ticks(clip.start_ticks), end = ticks(clip.end_ticks), length = end - start;
        if (next.clips.some(c => scope.has(c.track_id) && ticks(c.start_ticks) < end && ticks(c.end_ticks) > start)) throw new Error("RIPPLE_OCCUPIED: range intersects another participant");
        for (const c of next.clips) if (scope.has(c.track_id) && ticks(c.start_ticks) >= end) { c.start_ticks = (ticks(c.start_ticks) - length).toString(); c.end_ticks = (ticks(c.end_ticks) - length).toString(); participants.add(c.id); }
      }
    } else throw new Error("unsupported expected edit operation");
  }
  next.pagination.total = next.clips.length; next.revision = snapshotRevision(next);
  const beforeById = new Map(original.clips.map(c => [c.id, c])), afterById = new Map(next.clips.map(c => [c.id, c]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changes = [...ids].flatMap(id => { const before = beforeById.get(id) ?? null, after = afterById.get(id) ?? null; return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ id, before, after }]; });
  return { snapshot: next, changes, participants: [...participants], host_verified: false };
}

export function verifyContinuity(expected: unknown, actual: unknown) {
  const a = validateSnapshot(expected), b = validateSnapshot(actual);
  if (a.backend !== b.backend || a.project_id !== b.project_id || a.sequence_id !== b.sequence_id || a.session_id !== b.session_id) throw new Error("HOST_IDENTITY_CHANGED: restart inspection");
  const discrepancies: string[] = [];
  const expectedById = new Map(a.clips.map(c => [c.id, c])), actualById = new Map(b.clips.map(c => [c.id, c]));
  for (const clip of a.clips) {
    const observed = actualById.get(clip.id);
    if (!observed) { discrepancies.push(`missing:${clip.id}`); continue; }
    for (const key of ["source_id", "track_id", "start_ticks", "end_ticks", "in_ticks", "out_ticks", "enabled", "linked_ids", "speed", "reversed", "nested"] as const) if (JSON.stringify(clip[key]) !== JSON.stringify(observed[key])) discrepancies.push(`${clip.id}:${key}`);
  }
  for (const clip of b.clips) if (!expectedById.has(clip.id)) discrepancies.push(`unexpected:${clip.id}`);
  return { verified: discrepancies.length === 0 && b.completeness.clips && b.completeness.links, discrepancies: discrepancies.slice(0, 1000), truncated: discrepancies.length > 1000, verification_scope: "exact structure only; audible synchronization and rendered effects require artifact evidence" };
}
export function mapTimeDomain(clip: TimelineClip, value: string, domain: "source" | "clip_relative" | "sequence") {
  if (clip.nested || clip.reversed || clip.speed.numerator !== clip.speed.denominator) throw new Error("UNSUPPORTED_TIME_MAPPING: nested/reverse/retimed keyframes require measured mapping");
  const relative = ticks(value) - (domain === "source" ? ticks(clip.in_ticks) : domain === "sequence" ? ticks(clip.start_ticks) : domain === "clip_relative" ? 0n : (() => { throw new Error("invalid time domain"); })());
  return { clip_relative_ticks: relative.toString(), source_ticks: (ticks(clip.in_ticks) + relative).toString(), sequence_ticks: (ticks(clip.start_ticks) + relative).toString(), outside_visible_range: relative < 0n || relative >= ticks(clip.end_ticks) - ticks(clip.start_ticks), domain };
}
