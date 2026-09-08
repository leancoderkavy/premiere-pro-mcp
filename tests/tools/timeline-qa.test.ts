import { describe, expect, it } from "vitest";
import { getTimelineQaTools } from "../../src/tools/timeline-qa.js";

const tools = getTimelineQaTools();
const clip = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ id, name: `Clip ${id}`, start_seconds: start, end_seconds: end, in_seconds: 0, out_seconds: end - start, ...extra });
const snapshot = (video: Array<Record<string, unknown>>, audio: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ({ frame_rate: 30, tracks: [{ type: "video", index: 0, clips: video }, { type: "audio", index: 0, clips: audio }], ...extra });

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
function checkSchema(schema: Schema, path: string) {
  expect(typeof schema.type, `${path} type`).toBe("string");
  expect(["string", "number", "integer", "boolean", "array", "object"], `${path} type value`).toContain(schema.type);
  if (path.includes(".")) expect(typeof schema.description, `${path} description`).toBe("string");
  if (schema.properties) for (const [key, value] of Object.entries(schema.properties)) checkSchema(value, `${path}.${key}`);
  if (schema.items) checkSchema(schema.items, `${path}.items`);
  if (schema.required) for (const key of schema.required) expect(schema.properties, `${path} required ${key}`).toHaveProperty(key);
}

describe("timeline QA tool schemas", () => {
  it("exposes exactly two read-only tools with local-only descriptions", () => {
    expect(Object.keys(tools).sort()).toEqual(["audit_timeline_health", "diff_sequence_snapshots"]);
    for (const tool of Object.values(tools)) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description).toMatch(/Local-only/);
      expect(tool.description).toMatch(/never/);
    }
  });

  it("gives every parameter a type and description and declares required fields", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      checkSchema(tool.parameters as Schema, name);
    }
    expect(tools.diff_sequence_snapshots.parameters.required).toEqual(["before", "after"]);
    expect(tools.audit_timeline_health.parameters.required).toEqual(["snapshot"]);
    expect(tools.audit_timeline_health.parameters.properties.flash_frame_max_frames).toMatchObject({ type: "integer", minimum: 1, maximum: 12 });
    expect(tools.diff_sequence_snapshots.parameters.properties.tolerance_frames).toMatchObject({ type: "integer", minimum: 0, maximum: 10 });
  });
});

describe("diff_sequence_snapshots", () => {
  const tool = tools.diff_sequence_snapshots;

  it("returns a plan-shaped diff on the happy path", async () => {
    const before = snapshot([clip("v1", 0, 5), clip("v2", 5, 10)], [clip("a1", 0, 10)]);
    const after = snapshot([clip("v1", 0, 5), clip("v2", 6, 11)], [clip("a1", 0, 10)]);
    const result = await tool.handler({ before, after });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary).toMatchObject({ moved: 1, unchanged: 2, added: 0, removed: 0 });
    expect(result.data.applied).toBe(false);
    expect(result.data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.data.snapshot_revisions.before).toMatch(/^sha256:/);
    expect(result.data.evidence).toMatchObject({ matched_by_id: 3 });
    expect(result.data.routes.apply).toContain("move_clip_to_track");
    expect(result.data.next_steps).toContain("inspect_sequence_review_report");
    expect(result.data.edl_like_lines).toEqual(["V1 clip 'Clip v2' moved 00:00:05:00 → 00:00:06:00"]);
    expect(Array.isArray(result.data.warnings)).toBe(true);
    expect(Array.isArray(result.data.assumptions)).toBe(true);
  });

  it("accepts raw get_sequence_structure output and applies frame_rate and tolerance", async () => {
    const structure = (start: number) => ({
      name: "Seq", id: "s1", durationSeconds: 10,
      videoTracks: [{ index: 0, name: "V1", clips: [{ index: 0, nodeId: "n1", name: "Shot", startSeconds: start, endSeconds: start + 4, durationSeconds: 4, inPointSeconds: 0, outPointSeconds: 4, mediaType: "Video", enabled: true }] }],
      audioTracks: [],
    });
    const exact = await tool.handler({ before: structure(0), after: structure(1 / 24), frame_rate: 24 });
    expect(exact).toMatchObject({ success: true, data: { summary: { moved: 1 }, frame_rate: 24 } });
    const tolerant = await tool.handler({ before: structure(0), after: structure(1 / 24), frame_rate: 24, tolerance_frames: 1 });
    expect(tolerant).toMatchObject({ success: true, data: { summary: { moved: 0, unchanged: 1 } } });
  });

  it("never returns full media paths", async () => {
    const before = snapshot([clip("v1", 0, 5, { media_path: "/Volumes/Private/reel/a.mov" })]);
    const after = snapshot([clip("v1", 1, 6, { media_path: "/Volumes/Private/reel/a.mov" })]);
    const text = JSON.stringify(await tool.handler({ before, after }));
    expect(text).not.toContain("/Volumes/Private");
    expect(text).toContain("a.mov");
  });

  it("is deterministic across calls", async () => {
    const before = snapshot([clip("v1", 0, 5)]);
    const after = snapshot([clip("v1", 0, 6), clip("v2", 6, 8)]);
    expect(await tool.handler({ before, after })).toEqual(await tool.handler({ before, after }));
  });

  it.each([
    [{}, /before must be an object/],
    [{ before: snapshot([]), after: null }, /after must be an object/],
    [{ before: snapshot([]), after: { tracks: "x" } }, /tracks array/],
    [{ before: snapshot([]), after: snapshot([]), tolerance_frames: 2.5 }, /tolerance_frames/],
    [{ before: snapshot([]), after: snapshot([]), frame_rate: 0 }, /frame_rate/],
    [{ before: snapshot([{ id: "a", start_seconds: 0 }]), after: snapshot([]) }, /end_seconds is required/],
    [{ before: snapshot([clip("dup", 0, 1), clip("dup", 1, 2)]), after: snapshot([]) }, /duplicate clip id/],
  ])("rejects invalid arguments without throwing", async (args, message) => {
    const result = await tool.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });
});

describe("audit_timeline_health", () => {
  const tool = tools.audit_timeline_health;

  it("returns a full report for a healthy snapshot", async () => {
    const result = await tool.handler({ snapshot: snapshot([clip("v1", 0, 5)], [clip("a1", 0, 5)], { duration_seconds: 5 }) });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.score).toBe(100);
    expect(result.data.findings).toEqual([]);
    expect(result.data.applied).toBe(false);
    expect(result.data.snapshot_revision).toMatch(/^sha256:/);
    expect(result.data.plan_revision).toMatch(/^sha256:/);
    expect(result.data.checked.length).toBeGreaterThanOrEqual(15);
    expect(result.data.weights).toMatchObject({ error: 15, warning: 5, info: 1 });
    expect(result.data.evidence.snapshot_revision).toBe(result.data.snapshot_revision);
  });

  it("surfaces findings, counts, routes, and review frames with thresholds applied", async () => {
    const input = snapshot([clip("v1", 0, 5), clip("v2", 4.5, 8), clip("v3", 9, 9 + 2 / 30, { disabled: true })], [clip("a1", 0, 10)]);
    const result = await tool.handler({ snapshot: input, expected_duration_seconds: 12, gap_min_frames: 1, flash_frame_max_frames: 3, max_speed_percent: 400, expected_frame_rate: 30 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.counts).toEqual({ overlap: 1, gap: 1, flash_frame: 1, disabled_clip: 1, trailing_gap: 1 });
    expect(result.data.findings[0]).toMatchObject({ code: "overlap", severity: "error", timecode: "00:00:04:15" });
    expect(result.data.review_frame_seconds).toEqual([4.5]);
    expect(result.data.routes).toMatchObject({ gap: ["get_timeline_gaps", "ripple_delete"], disabled_clip: ["enable_disable_clip"] });
    expect(result.data.next_steps[0]).toBe("export_sequence_review_frames");
    expect(result.data.thresholds).toEqual({ frame_rate: 30, flash_frame_max_frames: 3, gap_min_frames: 1, max_speed_percent: 400, expected_duration_seconds: 12, expected_frame_rate: 30 });
    expect(result.data.score).toBe(100 - 15 - 5 - 5 - 1 - 5);
  });

  it("accepts raw inspect_sequence_structure_uxp output with a frame_rate override", async () => {
    const uxp = { sequence: { id: "seq", name: "UXP" }, tracks: [
      { mediaType: "video", trackIndex: 0, name: "V1", items: [{ mediaType: "video", trackIndex: 0, clipIndex: 0, name: "A", startSeconds: 0, endSeconds: 2, inSeconds: 0, outSeconds: 2, speed: 100, disabled: false }] },
      { mediaType: "audio", trackIndex: 0, name: "A1", items: [{ mediaType: "audio", trackIndex: 0, clipIndex: 0, name: "A", startSeconds: 0, endSeconds: 2, inSeconds: 0, outSeconds: 2, speed: 100, disabled: false }] },
    ] };
    const result = await tool.handler({ snapshot: uxp, frame_rate: 25 });
    expect(result).toMatchObject({ success: true, data: { score: 100, thresholds: { frame_rate: 25 }, evidence: { sequence_id: "seq", sequence_name: "UXP" }, assumptions: [] } });
  });

  it("never returns full media paths in findings", async () => {
    const path = "/Users/private/footage/dup.mov";
    const input = snapshot([clip("v1", 0, 5, { media_path: path }), clip("v2", 5, 10, { media_path: path })], [clip("a1", 0, 10)]);
    const result = await tool.handler({ snapshot: input });
    const text = JSON.stringify(result);
    expect(result).toMatchObject({ success: true, data: { counts: { repeated_shot: 1 } } });
    expect(text).not.toContain("/Users/private");
  });

  it.each([
    [{}, /snapshot must be an object/],
    [{ snapshot: [] }, /snapshot must be an object/],
    [{ snapshot: snapshot([]), flash_frame_max_frames: 0 }, /flash_frame_max_frames/],
    [{ snapshot: snapshot([]), gap_min_frames: -1 }, /gap_min_frames/],
    [{ snapshot: snapshot([]), max_speed_percent: "fast" }, /max_speed_percent/],
    [{ snapshot: snapshot([]), expected_duration_seconds: 1e9 }, /expected_duration_seconds/],
    [{ snapshot: snapshot([]), expected_frame_rate: 0.5 }, /expected_frame_rate/],
    [{ snapshot: snapshot([]), frame_rate: "30" }, /frame_rate/],
    [{ snapshot: { tracks: [{ type: "video", index: 0, clips: [{ id: "a", start_seconds: 0, end_seconds: 1, speed_percent: "x" }] }] } }, /speed_percent/],
  ])("rejects invalid arguments without throwing", async (args, message) => {
    const result = await tool.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });
});
