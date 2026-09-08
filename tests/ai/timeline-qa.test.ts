import { describe, expect, it } from "vitest";
import {
  auditTimelineHealth,
  diffSequenceSnapshots,
  formatTimecode,
  HEALTH_CHECKS,
  mediaBasename,
  normalizeSequenceSnapshot,
  snapshotRevision,
  trackLabel,
  type SequenceSnapshot,
} from "../../src/ai/timeline-qa.js";

type RawClip = Record<string, unknown>;
const clip = (id: string, start: number, end: number, extra: RawClip = {}): RawClip => ({ id, name: `Clip ${id}`, start_seconds: start, end_seconds: end, in_seconds: 0, out_seconds: end - start, ...extra });
const raw = (video: RawClip[][], audio: RawClip[][] = [], extra: Record<string, unknown> = {}) => ({
  frame_rate: 30,
  tracks: [
    ...video.map((clips, index) => ({ type: "video", index, clips })),
    ...audio.map((clips, index) => ({ type: "audio", index, clips })),
  ],
  ...extra,
});
const norm = (value: unknown, options?: Parameters<typeof normalizeSequenceSnapshot>[1]) => normalizeSequenceSnapshot(value, options);
const clean = () => raw(
  [[clip("v1", 0, 5, { project_item_id: "p1" }), clip("v2", 5, 10, { project_item_id: "p2" })]],
  [[clip("a1", 0, 5, { project_item_id: "p1" }), clip("a2", 5, 10, { project_item_id: "p2" })]],
  { duration_seconds: 10 },
);

describe("normalizeSequenceSnapshot", () => {
  it("accepts the normalized shape and sorts tracks and clips deterministically", () => {
    const snapshot = norm({ frame_rate: 24, tracks: [
      { type: "audio", index: 0, clips: [clip("a", 0, 1)] },
      { type: "video", index: 1, clips: [clip("late", 4, 5), clip("early", 1, 2)] },
      { type: "video", index: 0, clips: [] },
    ] });
    expect(snapshot.frame_rate).toBe(24);
    expect(snapshot.frame_rate_source).toBe("snapshot");
    expect(snapshot.synthetic_ids).toBe(false);
    expect(snapshot.tracks.map(trackLabel)).toEqual(["V1", "V2", "A1"]);
    expect(snapshot.tracks[1].clips.map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("accepts the raw get_sequence_structure shape", () => {
    const snapshot = norm({
      name: "Main", id: "seq-1", durationSeconds: 12,
      videoTracks: [{ index: 0, name: "Video 1", clips: [{ index: 0, nodeId: "n1", name: "Interview A", startSeconds: 1, endSeconds: 6, durationSeconds: 5, inPointSeconds: 2, outPointSeconds: 7, mediaType: "Video", enabled: false, speed: 1.5 }] }],
      audioTracks: [{ index: 0, name: "Audio 1", clips: [{ index: 0, nodeId: "n2", name: "Interview A", startSeconds: 1, endSeconds: 6, durationSeconds: 5, inPointSeconds: 2, outPointSeconds: 7, mediaType: "Audio" }] }],
    });
    expect(snapshot.sequence_id).toBe("seq-1");
    expect(snapshot.name).toBe("Main");
    expect(snapshot.duration_seconds).toBe(12);
    expect(snapshot.frame_rate_source).toBe("default");
    expect(snapshot.frame_rate).toBe(30);
    const video = snapshot.tracks[0].clips[0];
    expect(video).toMatchObject({ id: "n1", name: "Interview A", start_seconds: 1, end_seconds: 6, in_seconds: 2, out_seconds: 7, disabled: true, speed_percent: 150 });
    expect(snapshot.tracks[1].clips[0]).toMatchObject({ id: "n2", disabled: false });
  });

  it("accepts the inspect_sequence_structure_uxp shape and synthesizes ids", () => {
    const snapshot = norm({
      sequence: { id: "uxp-seq", name: "UXP" },
      tracks: [{ mediaType: "video", trackIndex: 2, name: "V3", items: [{ mediaType: "video", trackIndex: 2, clipIndex: 0, name: "Shot", startSeconds: 0, endSeconds: 2, inSeconds: 0, outSeconds: 2, durationSeconds: 2, speed: 100, disabled: false, sourceProjectItemId: "src-1" }] }],
    }, { frameRateOverride: 25 });
    expect(snapshot.sequence_id).toBe("uxp-seq");
    expect(snapshot.frame_rate).toBe(25);
    expect(snapshot.frame_rate_source).toBe("override");
    expect(snapshot.synthetic_ids).toBe(true);
    expect(snapshot.tracks[0]).toMatchObject({ type: "video", index: 2, name: "V3" });
    expect(snapshot.tracks[0].clips[0]).toMatchObject({ id: "~v2:0", project_item_id: "src-1", speed_percent: 100 });
  });

  it("keeps only a basename and sha256 of media paths", () => {
    const snapshot = norm(raw([[clip("v", 0, 1, { media_path: "/Volumes/Secret Drive/project/interview.mov" })]]));
    const item = snapshot.tracks[0].clips[0];
    expect(item.media_basename).toBe("interview.mov");
    expect(item.media_path_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain("Secret Drive");
    expect(mediaBasename("C:\\Media\\take 1.mp4")).toBe("take 1.mp4");
  });

  it.each([
    [null, /must be an object/],
    [{ frame_rate: 30 }, /tracks array/],
    [{ tracks: [{ type: "still", index: 0, clips: [] }] }, /type must be/],
    [{ tracks: [{ type: "video", index: -1, clips: [] }] }, /index must be/],
    [{ tracks: [{ type: "video", index: 0, clips: [{ id: "a", end_seconds: 1 }] }] }, /start_seconds is required/],
    [{ tracks: [{ type: "video", index: 0, clips: [{ id: "a", start_seconds: "0", end_seconds: 1 }] }] }, /start_seconds must be/],
    [{ tracks: [{ type: "video", index: 0, clips: [{ id: "a", start_seconds: 0, end_seconds: 1 }, { id: "a", start_seconds: 1, end_seconds: 2 }] }] }, /duplicate clip id/],
    [{ tracks: [{ type: "video", index: 0, clips: [] }, { type: "video", index: 0, clips: [] }] }, /duplicate track/],
    [{ frame_rate: 0, tracks: [] }, /frame_rate must be/],
    [{ tracks: Array.from({ length: 65 }, (_, index) => ({ type: "video", index, clips: [] })) }, /at most 64/],
    [{ tracks: [{ type: "video", index: 0, clips: [{ id: "a", start_seconds: 0, end_seconds: 1, disabled: "no" }] }] }, /disabled must be/],
    [{ tracks: [{ type: "video", index: 0, clips: [{ id: "a", start_seconds: 0, end_seconds: 1, linked_ids: "x" }] }] }, /linked_ids/],
  ])("rejects malformed snapshots", (input, message) => expect(() => norm(input)).toThrow(message));

  it("rejects an invalid frame rate override", () => expect(() => norm(raw([]), { frameRateOverride: 500 })).toThrow(/frame_rate must be/));
});

describe("formatTimecode", () => {
  it("formats non-drop HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(12 + 4 / 30, 30)).toBe("00:00:12:04");
    expect(formatTimecode(3661.5, 24)).toBe("01:01:01:12");
    expect(formatTimecode(1, 29.97)).toBe("00:00:01:00");
    expect(formatTimecode(-0.5, 30)).toBe("-00:00:00:15");
  });
});

describe("diffSequenceSnapshots", () => {
  const diff = (before: unknown, after: unknown, options?: Parameters<typeof diffSequenceSnapshots>[2]) => diffSequenceSnapshots(norm(before), norm(after), options);

  it("reports identical snapshots as unchanged", () => {
    const result = diff(clean(), clean());
    expect(result.summary).toMatchObject({ added: 0, removed: 0, moved: 0, trimmed: 0, retimed: 0, enabled_changed: 0, renamed: 0, unchanged: 4, changed_clips: 0, tracks_added: 0, tracks_removed: 0 });
    expect(result.identical).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.edl_like_lines).toEqual([]);
    expect(result.duration_delta_seconds).toBe(0);
    expect(result.applied).toBe(false);
  });

  it("detects added and removed clips and tracks", () => {
    const before = raw([[clip("v1", 0, 5), clip("v2", 5, 10)]], [[clip("a1", 0, 10)]]);
    const after = raw([[clip("v1", 0, 5)], [clip("v9", 2, 4)]]);
    const result = diff(before, after);
    expect(result.summary).toMatchObject({ added: 1, removed: 2, tracks_added: 1, tracks_removed: 1, unchanged: 1 });
    expect(result.tracks_added).toEqual(["V2"]);
    expect(result.tracks_removed).toEqual(["A1"]);
    expect(result.changes.map((c) => [c.kind, c.clip_id])).toEqual([["removed", "v2"], ["added", "v9"], ["removed", "a1"]]);
    expect(result.edl_like_lines).toEqual([
      "V1 clip 'Clip v2' removed 00:00:05:00 → 00:00:10:00",
      "V2 clip 'Clip v9' added 00:00:02:00 → 00:00:04:00",
      "A1 clip 'Clip a1' removed 00:00:00:00 → 00:00:10:00",
    ]);
  });

  it("detects a slide as moved with frame deltas and timecode lines", () => {
    const before = raw([[clip("v1", 12 + 4 / 30, 15, { name: "Interview A" })]]);
    const after = raw([[clip("v1", 15, 17 + 26 / 30, { name: "Interview A" })]]);
    const result = diff(before, after);
    expect(result.summary.moved).toBe(1);
    const change = result.changes[0];
    expect(change.kind).toBe("moved");
    expect(change.kinds).toEqual(["moved"]);
    expect(change.delta_frames).toEqual({ start: 86, end: 86, in: 0, out: 0 });
    expect(change.track_before).toBe("V1");
    expect(change.track_after).toBe("V1");
    expect(result.edl_like_lines[0]).toBe("V1 clip 'Interview A' moved 00:00:12:04 → 00:00:15:00");
  });

  it("detects head and tail trims and slips as trimmed", () => {
    const before = raw([[clip("head", 0, 5), clip("tail", 10, 15), clip("slip", 20, 25)]]);
    const after = raw([[clip("head", 1, 5, { in_seconds: 1, out_seconds: 5 }), clip("tail", 10, 14, { out_seconds: 4 }), clip("slip", 20, 25, { in_seconds: 2, out_seconds: 7 })]]);
    const result = diff(before, after);
    expect(result.summary).toMatchObject({ trimmed: 3, moved: 0 });
    const byId = Object.fromEntries(result.changes.map((c) => [c.clip_id, c]));
    expect(byId.head.delta_frames).toEqual({ start: 30, end: 0, in: 30, out: 0 });
    expect(byId.tail.delta_frames).toEqual({ start: 0, end: -30, in: 0, out: -30 });
    expect(byId.slip.delta_frames).toEqual({ start: 0, end: 0, in: 60, out: 60 });
    expect(byId.head.kinds).toEqual(["trimmed"]);
    expect(result.edl_like_lines[0]).toContain("trimmed 00:00:00:00-00:00:05:00 → 00:00:01:00-00:00:05:00 (in +30f, out +0f)");
  });

  it("detects retimed, enabled_changed, and renamed clips", () => {
    const before = raw([[clip("v1", 0, 5, { speed_percent: 100, disabled: false, name: "Old" })]]);
    const after = raw([[clip("v1", 0, 5, { speed_percent: 200, disabled: true, name: "New" })]]);
    const result = diff(before, after);
    expect(result.summary).toMatchObject({ retimed: 1, enabled_changed: 1, renamed: 1, changed_clips: 1, unchanged: 0 });
    const change = result.changes[0];
    expect(change.kinds).toEqual(["retimed", "enabled_changed", "renamed"]);
    expect(change.details).toMatchObject({ speed_percent_before: 100, speed_percent_after: 200, disabled_before: false, disabled_after: true, name_before: "Old", name_after: "New", matched_by: "id" });
    expect(result.edl_like_lines[0]).toBe("V1 clip 'New' retimed 100% → 200%; disabled; renamed 'Old' → 'New'");
  });

  it("matches clips across tracks by source identity when ids differ", () => {
    const before = raw([[clip("v1", 0, 5, { project_item_id: "p1", name: "Shot" })], []]);
    const after = raw([[], [clip("other", 3, 8, { project_item_id: "p1", name: "Shot" })]]);
    const result = diff(before, after);
    expect(result.summary).toMatchObject({ moved: 1, added: 0, removed: 0, renamed: 0 });
    expect(result.changes[0]).toMatchObject({ kind: "moved", kinds: ["moved"], clip_id: "v1", clip_id_after: "other", track_before: "V1", track_after: "V2" });
    expect(result.changes[0].details).toMatchObject({ matched_by: "content" });
    expect(result.edl_like_lines[0]).toBe("V2 clip 'Shot' moved V1→V2 00:00:00:00 → 00:00:03:00");
    expect(result.evidence.matched_by_content).toBe(1);
  });

  it("matches by content when ids are synthetic and notes the assumption", () => {
    const before = { tracks: [{ mediaType: "video", trackIndex: 0, items: [{ name: "Shot", startSeconds: 0, endSeconds: 2, inSeconds: 0, outSeconds: 2, sourceProjectItemId: "s" }] }] };
    const after = { tracks: [{ mediaType: "video", trackIndex: 0, items: [{ name: "Intro", startSeconds: 0, endSeconds: 1, inSeconds: 0, outSeconds: 1 }, { name: "Shot", startSeconds: 1, endSeconds: 3, inSeconds: 0, outSeconds: 2, sourceProjectItemId: "s" }] }] };
    const result = diff(before, after);
    expect(result.summary).toMatchObject({ added: 1, moved: 1, removed: 0 });
    expect(result.assumptions.join(" ")).toMatch(/lacked stable clip ids/);
    expect(result.assumptions.join(" ")).toMatch(/assumed 30 fps/);
  });

  it("honours tolerance_frames and frame_rate overrides", () => {
    const before = raw([[clip("v1", 0, 5)]]);
    const after = raw([[clip("v1", 2 / 30, 5 + 2 / 30)]]);
    expect(diff(before, after).summary.moved).toBe(1);
    const tolerant = diff(before, after, { toleranceFrames: 2 });
    expect(tolerant.summary.moved).toBe(0);
    expect(tolerant.summary.unchanged).toBe(1);
    expect(tolerant.tolerance_frames).toBe(2);
    expect(diff(before, after, { frameRate: 60 }).changes[0].delta_frames?.start).toBe(4);
    expect(() => diff(before, after, { toleranceFrames: 11 })).toThrow(/tolerance_frames/);
    expect(() => diff(before, after, { frameRate: 0 })).toThrow(/frame_rate/);
  });

  it("reports duration deltas and stable revisions", () => {
    const before = raw([[clip("v1", 0, 5)]], [], { duration_seconds: 5 });
    const after = raw([[clip("v1", 0, 5), clip("v2", 5, 8)]]);
    const result = diff(before, after);
    expect(result.duration_before_seconds).toBe(5);
    expect(result.duration_after_seconds).toBe(8);
    expect(result.duration_delta_seconds).toBe(3);
    expect(result.snapshot_revisions.before).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.snapshot_revisions.before).not.toBe(result.snapshot_revisions.after);
    expect(result.plan_revision).toBe(diff(before, after).plan_revision);
    expect(diff(before, after)).toEqual(result);
  });

  it("does not leak full media paths into the diff", () => {
    const path = "/Users/someone/Private/footage/take1.mov";
    const before = raw([[clip("v1", 0, 5, { media_path: path })]]);
    const after = raw([[clip("v1", 1, 6, { media_path: path })], [clip("v2", 0, 1, { media_path: path })]]);
    const text = JSON.stringify(diff(before, after));
    expect(text).not.toContain("/Users/someone");
    expect(text).toContain("take1.mov");
  });

  it("orders changes and lines by track then start regardless of input order", () => {
    const before = raw([[], []], [[]]);
    const after = raw([[clip("b", 5, 6), clip("a", 1, 2)], [clip("c", 0, 1)]], [[clip("d", 0, 1)]]);
    const result = diff(before, after);
    expect(result.changes.map((c) => c.clip_id)).toEqual(["a", "b", "c", "d"]);
    expect(result.by_track).toEqual([{ track: "V1", added: 2, removed: 0, moved_in: 0, moved_out: 0, trimmed: 0, retimed: 0, enabled_changed: 0, renamed: 0, unchanged: 0 }, expect.objectContaining({ track: "V2", added: 1 }), expect.objectContaining({ track: "A1", added: 1 })]);
  });
});

describe("auditTimelineHealth", () => {
  const audit = (input: unknown, options?: Parameters<typeof auditTimelineHealth>[1]) => auditTimelineHealth(norm(input), options);
  const codes = (result: ReturnType<typeof auditTimelineHealth>) => result.findings.map((f) => f.code);

  it("scores a clean timeline 100 with no findings", () => {
    const result = audit(clean());
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("pass");
    expect(result.counts).toEqual({});
    expect(result.checked).toEqual(expect.arrayContaining([...HEALTH_CHECKS]));
    expect(result.skipped_checks).toEqual([]);
    expect(result.weights).toEqual({ error: 15, warning: 5, info: 1, per_code_cap: 30 });
    expect(result.applied).toBe(false);
    expect(result.snapshot_revision).toBe(snapshotRevision(norm(clean())));
    expect(result.review_frame_seconds).toEqual([]);
    expect(result.next_steps).toEqual(["inspect_sequence_review_report"]);
  });

  it("flags flash frames with a configurable threshold", () => {
    const input = raw([[clip("v1", 0, 5), clip("flash", 5, 5 + 2 / 30), clip("v2", 5 + 2 / 30, 10)]], [[clip("a", 0, 10)]]);
    const result = audit(input);
    expect(codes(result)).toEqual(["flash_frame"]);
    expect(result.findings[0]).toMatchObject({ severity: "warning", track: "V1", clip_id: "flash", timecode: "00:00:05:00" });
    expect(result.findings[0].message).toContain("2 frames");
    expect(audit(input, { flashFrameMaxFrames: 1 }).findings).toEqual([]);
    expect(() => audit(input, { flashFrameMaxFrames: 13 })).toThrow(/flash_frame_max_frames/);
  });

  it("flags gaps on video as warnings and on audio as info, honouring gap_min_frames", () => {
    const input = raw([[clip("v1", 0, 4), clip("v2", 5, 10)]], [[clip("a1", 0, 4), clip("a2", 5, 10)]], { duration_seconds: 10 });
    const result = audit(input);
    expect(result.findings.filter((f) => f.code === "gap")).toEqual([
      expect.objectContaining({ severity: "warning", track: "V1", start_seconds: 4, end_seconds: 5, timecode: "00:00:04:00" }),
      expect.objectContaining({ severity: "info", track: "A1" }),
    ]);
    expect(result.findings[0].message).toBe("V1 has a 30-frame gap 00:00:04:00 → 00:00:05:00 before 'Clip v2'.");
    expect(audit(input, { gapMinFrames: 31 }).findings.filter((f) => f.code === "gap")).toEqual([]);
    expect(result.routes.gap).toEqual(["get_timeline_gaps", "ripple_delete"]);
    expect(result.next_steps).toContain("ripple_delete");
  });

  it("flags overlapping clips as errors with review frames", () => {
    const input = raw([[clip("v1", 0, 5), clip("v2", 4, 10)]], [[clip("a", 0, 10)]]);
    const result = audit(input);
    expect(codes(result)).toEqual(["overlap"]);
    expect(result.findings[0]).toMatchObject({ severity: "error", track: "V1", clip_id: "v2", start_seconds: 4, end_seconds: 5 });
    expect(result.review_frame_seconds).toEqual([4]);
    expect(result.next_steps[0]).toBe("export_sequence_review_frames");
    expect(result.score).toBe(85);
    expect(result.grade).toBe("review");
  });

  it("flags disabled clips and routes to enable_disable_clip", () => {
    const input = raw([[clip("v1", 0, 5, { disabled: true }), clip("v2", 5, 10)]], [[clip("a", 0, 10)]]);
    const result = audit(input);
    // Disabled video does not count as enabled coverage, so the sequence now opens on black.
    expect(codes(result)).toEqual(["leading_black", "disabled_clip"]);
    expect(result.findings.find((f) => f.code === "disabled_clip")).toMatchObject({ severity: "info", clip_id: "v1" });
    expect(codes(audit(raw([[clip("v1", 0, 5), clip("v2", 5, 10, { disabled: true })]], [[clip("a", 0, 5)]])))).toEqual(["disabled_clip"]);
    expect(result.routes.disabled_clip).toEqual(["enable_disable_clip"]);
  });

  it("flags repeated shots only when source ranges overlap", () => {
    const repeated = raw([[clip("v1", 0, 5, { project_item_id: "p", in_seconds: 10, out_seconds: 15 }), clip("v2", 5, 10, { project_item_id: "p", in_seconds: 12, out_seconds: 17 })]], [[clip("a", 0, 10)]]);
    const result = audit(repeated);
    expect(codes(result)).toEqual(["repeated_shot"]);
    expect(result.findings[0]).toMatchObject({ severity: "warning", track: "V1", clip_id: "v2" });
    expect(result.findings[0].message).toContain("reuses 3s");
    const distinct = raw([[clip("v1", 0, 5, { project_item_id: "p", in_seconds: 10, out_seconds: 15 }), clip("v2", 5, 10, { project_item_id: "p", in_seconds: 15, out_seconds: 20 })]], [[clip("a", 0, 10)]]);
    expect(codes(audit(distinct))).toEqual([]);
    const byPath = raw([[clip("v1", 0, 5, { media_path: "/m/x.mov", in_seconds: 0, out_seconds: 5 }), clip("v2", 5, 10, { media_path: "/m/x.mov", in_seconds: 0, out_seconds: 5 })]], [[clip("a", 0, 10)]]);
    expect(codes(audit(byPath))).toEqual(["repeated_shot"]);
  });

  it("flags video without enabled audio and audio without video", () => {
    const input = raw([[clip("v1", 0, 5), clip("v2", 5, 10)]], [[clip("a1", 0, 5), clip("a2", 5, 10, { disabled: true }), clip("a3", 12, 14)]]);
    const result = audit(input);
    expect(codes(result)).toEqual(["video_without_audio", "disabled_clip", "gap", "audio_without_video"]);
    expect(result.findings[0]).toMatchObject({ code: "video_without_audio", severity: "warning", clip_id: "v2", track: "V1" });
    expect(result.findings.find((f) => f.code === "audio_without_video")).toMatchObject({ severity: "info", clip_id: "a3", track: "A1" });
  });

  it("skips A/V coverage checks when the other media type is absent", () => {
    const result = audit(raw([[clip("v1", 0, 5)]]));
    expect(result.findings).toEqual([]);
    expect(result.checked).not.toContain("video_without_audio");
    expect(result.skipped_checks).toEqual([
      { check: "video_without_audio", reason: "snapshot contains no audio tracks" },
      { check: "trailing_gap", reason: "no expected_duration_seconds or snapshot duration" },
    ]);
  });

  it("flags clips past the expected duration and trailing gaps before it", () => {
    const input = raw([[clip("v1", 0, 5), clip("v2", 5, 12)]], [[clip("a", 0, 12)]]);
    const past = audit(input, { expectedDurationSeconds: 10 });
    expect(codes(past)).toEqual(["beyond_expected_duration", "beyond_expected_duration"]);
    expect(past.findings.map((f) => [f.track, f.clip_id])).toEqual([["A1", "a"], ["V1", "v2"]]);
    expect(past.findings[0]).toMatchObject({ severity: "error", timecode: "00:00:00:00" });
    expect(past.review_frame_seconds).toEqual([0, 5]);
    const trailing = audit(input, { expectedDurationSeconds: 15 });
    expect(codes(trailing)).toEqual(["trailing_gap"]);
    expect(trailing.findings[0]).toMatchObject({ severity: "warning", start_seconds: 12, end_seconds: 15, timecode: "00:00:12:00" });
    expect(codes(audit(raw([[clip("v1", 0, 5)]], [[clip("a", 0, 5)]], { duration_seconds: 6 })))).toEqual(["trailing_gap"]);
  });

  it("flags extreme speed against max_speed_percent", () => {
    const input = raw([[clip("v1", 0, 5, { speed_percent: 800 }), clip("v2", 5, 10, { speed_percent: -50 })]], [[clip("a", 0, 10)]]);
    const result = audit(input);
    expect(codes(result)).toEqual(["extreme_speed"]);
    expect(result.findings[0]).toMatchObject({ severity: "warning", clip_id: "v1" });
    expect(result.routes.extreme_speed).toEqual(["speed_change"]);
    expect(codes(audit(input, { maxSpeedPercent: 1000 }))).toEqual([]);
    expect(codes(audit(input, { maxSpeedPercent: 40 }))).toEqual(["extreme_speed", "extreme_speed"]);
  });

  it("flags negative and inverted time ranges as errors", () => {
    const input = raw([[clip("neg", -1, 2), clip("inv", 5, 5), clip("ok", 6, 8)]], [[clip("a", 0, 8)]]);
    const result = audit(input);
    expect(codes(result)).toEqual(["invalid_time_range", "invalid_time_range", "gap"]);
    expect(result.findings[0]).toMatchObject({ clip_id: "neg", severity: "error", timecode: "-00:00:01:00" });
    expect(result.findings[0].message).toContain("negative");
    expect(result.findings[1]).toMatchObject({ clip_id: "inv", severity: "error" });
    expect(result.review_frame_seconds).toEqual([0, 5]);
  });

  it("flags empty tracks, unnamed clips, leading black, and frame rate mismatches", () => {
    const input = raw([[{ id: "x", start_seconds: 2, end_seconds: 5 }], []], [[clip("a", 2, 5)]]);
    const result = audit(input, { expectedFrameRate: 24 });
    expect(codes(result)).toEqual(["frame_rate_mismatch", "leading_black", "empty_track", "unnamed_clip"]);
    expect(result.findings[0]).toMatchObject({ severity: "error", timecode: "00:00:00:00" });
    expect(result.findings[1]).toMatchObject({ code: "leading_black", severity: "warning", clip_id: "x", start_seconds: 0, end_seconds: 2 });
    expect(result.findings[1].message).toContain("60 frames of black");
    expect(result.findings[2]).toMatchObject({ code: "empty_track", severity: "info", track: "V2" });
    expect(result.findings[3]).toMatchObject({ code: "unnamed_clip", severity: "info", track: "V1", clip_id: "x" });
    expect(codes(audit(input, { expectedFrameRate: 30 }))).not.toContain("frame_rate_mismatch");
  });

  it("sorts findings by severity then time and caps per-code penalties", () => {
    const video = [clip("v0", 0, 1)];
    for (let index = 1; index <= 40; index += 1) video.push({ id: `u${index}`, start_seconds: index, end_seconds: index + 1 });
    video.push(clip("overlap", 40.5, 42));
    const result = audit(raw([video], [[clip("a", 0, 42)]]));
    expect(result.findings[0].code).toBe("overlap");
    expect(result.counts).toEqual({ overlap: 1, unnamed_clip: 40 });
    expect(result.penalty).toBe(15 + 30);
    expect(result.score).toBe(55);
    expect(result.grade).toBe("fail");
    const starts = result.findings.slice(1).map((f) => f.start_seconds as number);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("is deterministic and validates options", () => {
    const input = raw([[clip("v1", 0, 5), clip("v2", 6, 10)]], [[clip("a", 0, 10)]]);
    expect(audit(input)).toEqual(audit(input));
    expect(audit(input).plan_revision).toMatch(/^sha256:/);
    expect(audit(input).plan_revision).not.toBe(audit(input, { gapMinFrames: 2 }).plan_revision);
    expect(() => audit(input, { gapMinFrames: 0 })).toThrow(/gap_min_frames/);
    expect(() => audit(input, { maxSpeedPercent: 0 })).toThrow(/max_speed_percent/);
    expect(() => audit(input, { expectedDurationSeconds: -1 })).toThrow(/expected_duration_seconds/);
    expect(() => audit(input, { expectedFrameRate: 999 })).toThrow(/expected_frame_rate/);
    expect(() => audit(input, { frameRate: "30" })).toThrow(/frame_rate/);
  });

  it("records the assumed frame rate when none was supplied", () => {
    const snapshot: SequenceSnapshot = norm({ tracks: [{ type: "video", index: 0, clips: [clip("v", 0, 1)] }] });
    expect(auditTimelineHealth(snapshot).assumptions).toEqual(["No frame rate was supplied; assumed 30 fps."]);
    expect(auditTimelineHealth(snapshot, { frameRate: 25 }).assumptions).toEqual([]);
  });
});
