import { describe, expect, it } from "vitest";
import { buildBeatSlots, normalizeBeatMontageOptions, orderMontageClips, planBeatMontage } from "../../src/ai/beat-montage.js";

const grid = (count: number, step: number, offset = 0) => Array.from({ length: count }, (_, index) => Number((offset + index * step).toFixed(6)));
const clip = (item_id: string, duration_seconds: number, extra: Record<string, unknown> = {}) => ({ item_id, duration_seconds, ...extra });

describe("buildBeatSlots", () => {
  const options = (overrides: Record<string, unknown> = {}, beatCount = 8) => normalizeBeatMontageOptions(overrides, beatCount);

  it("cuts every N beats by default", () => {
    const warnings: string[] = [];
    const slots = buildBeatSlots(grid(9, 0.5), options({}, 9), warnings);
    expect(slots.map((slot) => [slot.beat_index_start, slot.beat_index_end])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8]]);
    expect(slots[0]).toMatchObject({ start_frame: 0, end_frame: 30 });
    expect(warnings).toEqual([]);
  });

  it("merges spans shorter than min_shot_seconds with the following beats", () => {
    const warnings: string[] = [];
    const slots = buildBeatSlots([0, 0.1, 0.2, 1, 2], options({ cut_every_n_beats: 1 }, 5), warnings);
    expect(slots.map((slot) => [slot.beat_index_start, slot.beat_index_end])).toEqual([[0, 3], [3, 4]]);
    expect(warnings.some((warning) => warning.includes("merged"))).toBe(true);
  });

  it("splits spans longer than max_shot_seconds at intermediate beats", () => {
    const warnings: string[] = [];
    const slots = buildBeatSlots([0, 2, 4, 6, 8], options({ cut_every_n_beats: 4 }, 5), warnings);
    expect(slots.map((slot) => [slot.beat_index_start, slot.beat_index_end])).toEqual([[0, 3], [3, 4]]);
    expect(warnings.some((warning) => warning.includes("split"))).toBe(true);
  });

  it("keeps and flags a single beat gap that exceeds max_shot_seconds", () => {
    const warnings: string[] = [];
    const slots = buildBeatSlots([0, 10], options({}, 2), warnings);
    expect(slots).toEqual([{ beat_index_start: 0, beat_index_end: 1, start_frame: 0, end_frame: 300 }]);
    expect(warnings.some((warning) => warning.includes("exceed max_shot_seconds"))).toBe(true);
  });

  it("drops a trailing span shorter than min_shot_seconds", () => {
    const warnings: string[] = [];
    const slots = buildBeatSlots([0, 1, 1.1], options({ cut_every_n_beats: 1 }, 3), warnings);
    expect(slots.map((slot) => [slot.beat_index_start, slot.beat_index_end])).toEqual([[0, 1]]);
    expect(warnings.some((warning) => warning.includes("Trailing span"))).toBe(true);
  });

  it("starts from start_beat_index", () => {
    const slots = buildBeatSlots(grid(9, 0.5), options({ start_beat_index: 3 }, 9), []);
    expect(slots[0]).toMatchObject({ beat_index_start: 3, beat_index_end: 5 });
  });
});

describe("orderMontageClips", () => {
  const clips = [
    { item_id: "a", duration_seconds: 1, in_seconds: 0, priority: 1, index: 0 },
    { item_id: "b", duration_seconds: 1, in_seconds: 0, priority: 5, index: 1 },
    { item_id: "c", duration_seconds: 1, in_seconds: 0, priority: null, index: 2 },
    { item_id: "d", duration_seconds: 1, in_seconds: 0, priority: 5, index: 3 },
  ];

  it("keeps the given order", () => {
    expect(orderMontageClips(clips, "as_given").map((clip) => clip.item_id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by priority descending with stable ties", () => {
    expect(orderMontageClips(clips, "priority").map((clip) => clip.item_id)).toEqual(["b", "d", "a", "c"]);
  });

  it("interleaves priority groups for round_robin", () => {
    expect(orderMontageClips(clips, "round_robin").map((clip) => clip.item_id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("planBeatMontage", () => {
  it("assigns clips in order and stops when they run out without reuse", () => {
    const plan = planBeatMontage({ beat_seconds: grid(17, 0.5), clips: [clip("A", 10), clip("B", 10), clip("C", 10)] });
    expect(plan.applied).toBe(false);
    expect(plan.placements.map((placement) => [placement.item_id, placement.start_seconds, placement.in_seconds, placement.out_seconds, placement.duration_seconds])).toEqual([
      ["A", 0, 0, 1, 1],
      ["B", 1, 0, 1, 1],
      ["C", 2, 0, 1, 1],
    ]);
    expect(plan.placements[0]).toMatchObject({ index: 0, clip_index: 0, track_index: 0, audio_track_index: 0, end_seconds: 1, beat_index_start: 0, beat_index_end: 2, ends_on_beat: true });
    expect(plan.coverage_seconds).toBe(3);
    expect(plan.shot_count).toBe(3);
    expect(plan.unused_clips).toEqual([]);
    expect(plan.warnings.some((warning) => warning.includes("clips exhausted after 3 shot(s)"))).toBe(true);
    expect(plan.counts).toMatchObject({ beats: 17, clips: 3, shots: 3, batches: 1, reused_shots: 0 });
  });

  it("cycles clips progressively when allow_reuse is true", () => {
    const plan = planBeatMontage({ beat_seconds: grid(17, 0.5), clips: [clip("A", 10), clip("B", 10), clip("C", 10)], allow_reuse: true });
    expect(plan.placements).toHaveLength(8);
    expect(plan.placements.map((placement) => placement.item_id)).toEqual(["A", "B", "C", "A", "B", "C", "A", "B"]);
    expect(plan.placements[3]).toMatchObject({ item_id: "A", start_seconds: 3, in_seconds: 1, out_seconds: 2 });
    expect(plan.placements[6]).toMatchObject({ item_id: "A", in_seconds: 2, out_seconds: 3 });
    expect(plan.counts.reused_shots).toBe(5);
    expect(plan.coverage_seconds).toBe(8);
    expect(plan.warnings.some((warning) => warning.includes("reuse the same item_id"))).toBe(true);
  });

  it("restarts a reused clip from its in point when the remainder is too short", () => {
    const plan = planBeatMontage({ beat_seconds: grid(9, 1), clips: [clip("A", 2.5, { in_seconds: 0.5 })], cut_every_n_beats: 1, allow_reuse: true });
    // A usable range 0.5..2.5 (2s): shots of 1s -> in 0.5, 1.5, then remainder 0 -> restart at 0.5
    expect(plan.placements.slice(0, 3).map((placement) => placement.in_seconds)).toEqual([0.5, 1.5, 0.5]);
  });

  it("trims a clip shorter than its slot and resumes at the next beat", () => {
    const plan = planBeatMontage({ beat_seconds: grid(11, 1), clips: [clip("short", 1.5), clip("long", 30)] });
    expect(plan.placements[0]).toMatchObject({ item_id: "short", start_seconds: 0, duration_seconds: 1.5, out_seconds: 1.5, ends_on_beat: false, beat_index_start: 0, beat_index_end: 2 });
    expect(plan.placements[1]).toMatchObject({ item_id: "long", start_seconds: 2, duration_seconds: 2, beat_index_start: 2, beat_index_end: 4, ends_on_beat: true });
    expect(plan.warnings.some((warning) => warning.includes("shorter than its slot") && warning.includes("resumes at beat 2"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("15 frame(s) of timeline are left empty"))).toBe(true);
  });

  it("skips clips shorter than min_shot_seconds and reports them unused", () => {
    const plan = planBeatMontage({ beat_seconds: grid(5, 1), clips: [clip("tiny", 0.2), clip("ok", 10)], cut_every_n_beats: 1 });
    expect(plan.placements.map((placement) => placement.item_id)).toEqual(["ok"]);
    expect(plan.unused_clips).toEqual([{ clip_index: 0, item_id: "tiny", reason: "shorter than min_shot_seconds" }]);
  });

  it("stops when no clip can satisfy min_shot_seconds even with reuse", () => {
    const plan = planBeatMontage({ beat_seconds: grid(5, 1), clips: [clip("tiny", 0.2)], allow_reuse: true });
    expect(plan.placements).toEqual([]);
    expect(plan.warnings.some((warning) => warning.includes("no clip is long enough"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("No shots were placed"))).toBe(true);
  });

  it("chunks placements into add_to_timeline_batch groups of at most 32", () => {
    const plan = planBeatMontage({ beat_seconds: grid(100, 0.5), clips: [clip("A", 60)], cut_every_n_beats: 1, allow_reuse: true });
    expect(plan.placements).toHaveLength(99);
    expect(plan.batches.map((batch) => batch.length)).toEqual([32, 32, 32, 3]);
    expect(plan.batches.flat()).toHaveLength(99);
    expect(plan.batches[0][0]).toEqual({ item_id: "A", track_index: 0, start_seconds: 0, audio_track_index: 0 });
    expect(Object.keys(plan.batches[1][5]).sort()).toEqual(["audio_track_index", "item_id", "start_seconds", "track_index"]);
    expect(plan.markers.cut_times_seconds).toEqual(plan.placements.map((placement) => placement.start_seconds));
    expect(plan.markers.batches.map((batch) => batch.length)).toEqual([99]);
    expect(plan.markers.name_prefix).toBe("Cut");
  });

  it("chunks marker batches at 512", () => {
    const plan = planBeatMontage({ beat_seconds: grid(1201, 0.5), clips: [clip("A", 700)], cut_every_n_beats: 1, allow_reuse: true });
    expect(plan.placements).toHaveLength(1200);
    expect(plan.markers.batches.map((batch) => batch.length)).toEqual([512, 512, 176]);
    expect(plan.batches.every((batch) => batch.length <= 32)).toBe(true);
  });

  it("produces trim_plan entries aligned to placements", () => {
    const plan = planBeatMontage({ beat_seconds: grid(5, 1), clips: [clip("A", 10, { in_seconds: 3 })], cut_every_n_beats: 2 });
    expect(plan.trim_plan).toEqual([
      { placement_index: 0, item_id: "A", in_seconds: 3, out_seconds: 5, set_item_in_out: { item_id: "A", in_seconds: 3, out_seconds: 5 }, trim_clip_after_insert: { new_in_seconds: 3, new_out_seconds: 5 } },
    ]);
  });

  it("caps the montage at total_duration_seconds measured from the first cut", () => {
    const plan = planBeatMontage({ beat_seconds: grid(11, 1), clips: [clip("A", 60)], cut_every_n_beats: 1, total_duration_seconds: 3.5, allow_reuse: true });
    expect(plan.placements.map((placement) => [placement.start_seconds, placement.duration_seconds, placement.ends_on_beat])).toEqual([[0, 1, true], [1, 1, true], [2, 1, true], [3, 0.5, false]]);
    expect(plan.coverage_seconds).toBe(3.5);
    expect(plan.montage_end_seconds).toBe(3.5);
    expect(plan.warnings.some((warning) => warning.includes("total_duration_seconds reached"))).toBe(true);
  });

  it("honours start_beat_index and track indices", () => {
    const plan = planBeatMontage({ beat_seconds: grid(9, 1), clips: [clip("A", 60)], start_beat_index: 4, video_track_index: 2, audio_track_index: 3 });
    expect(plan.placements[0]).toMatchObject({ start_seconds: 4, beat_index_start: 4, track_index: 2, audio_track_index: 3 });
    expect(plan.montage_start_seconds).toBe(4);
    expect(plan.batches[0][0]).toMatchObject({ track_index: 2, audio_track_index: 3 });
  });

  it("applies priority ordering", () => {
    const plan = planBeatMontage({ beat_seconds: grid(9, 1), clips: [clip("low", 60, { priority: 1 }), clip("high", 60, { priority: 9 })], order: "priority" });
    expect(plan.placements.map((placement) => placement.item_id)).toEqual(["high", "low"]);
  });

  it("snaps shot boundaries to frames", () => {
    const plan = planBeatMontage({ beat_seconds: [0, 0.51, 1.02, 1.53], clips: [clip("A", 10)], cut_every_n_beats: 1, frame_rate: 25, allow_reuse: true });
    // 0.51s * 25 = 12.75 -> 13 frames = 0.52s; 1.02 -> 25.5 -> 26 frames = 1.04s; 1.53 -> 38.25 -> 38 = 1.52s
    expect(plan.placements.map((placement) => [placement.start_seconds, placement.end_seconds])).toEqual([[0, 0.52], [0.52, 1.04], [1.04, 1.52]]);
  });

  it("is deterministic and sensitive to inputs", () => {
    const args = { beat_seconds: grid(9, 1), clips: [clip("A", 10), clip("B", 10)] };
    const a = planBeatMontage(args);
    const b = planBeatMontage(JSON.parse(JSON.stringify(args)));
    const c = planBeatMontage({ ...args, cut_every_n_beats: 3 });
    expect(a.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(a.plan_revision).toBe(b.plan_revision);
    expect(a.plan_revision).not.toBe(c.plan_revision);
    expect(a.evidence).toMatchObject({ beat_count: 9, clip_count: 2, plan_revision: a.plan_revision });
    expect(a.routes).toEqual(expect.arrayContaining(["add_to_timeline_batch", "trim_clip", "set_item_in_out", "apply_beat_markers_uxp"]));
    expect(a.next_steps.length).toBeGreaterThan(0);
    expect(a.assumptions.length).toBeGreaterThan(0);
  });
});

describe("planBeatMontage validation", () => {
  const beats = grid(5, 1);
  it.each([
    [{ clips: [clip("A", 1)] }, "beat_seconds must contain"],
    [{ beat_seconds: [0], clips: [clip("A", 1)] }, "beat_seconds must contain"],
    [{ beat_seconds: [0, 1, 1], clips: [clip("A", 1)] }, "strictly ascending"],
    [{ beat_seconds: [0, "x"], clips: [clip("A", 1)] }, "beat_seconds[1] must be a finite number"],
    [{ beat_seconds: beats }, "clips must contain"],
    [{ beat_seconds: beats, clips: [] }, "clips must contain"],
    [{ beat_seconds: beats, clips: [{ item_id: "A", duration_seconds: 1, colour: "red" }] }, "unknown field: colour"],
    [{ beat_seconds: beats, clips: [{ item_id: "", duration_seconds: 1 }] }, "clips[0].item_id"],
    [{ beat_seconds: beats, clips: [{ item_id: "A", duration_seconds: 0 }] }, "duration_seconds must be greater than 0"],
    [{ beat_seconds: beats, clips: [clip("A", 1, { in_seconds: 1 })] }, "in_seconds must be less than duration_seconds"],
    [{ beat_seconds: beats, clips: [clip("A", 1, { priority: 1.5 })] }, "priority must be an integer"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], order: "random" }, "order must be one of"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], min_shot_seconds: 5, max_shot_seconds: 2 }, "max_shot_seconds must be at least min_shot_seconds"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], start_beat_index: 4 }, "start_beat_index must be between 0 and 3"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], cut_every_n_beats: 0 }, "cut_every_n_beats must be between"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], allow_reuse: 1 }, "allow_reuse must be a boolean"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], total_duration_seconds: 0 }, "total_duration_seconds must be greater than 0"],
    [{ beat_seconds: beats, clips: [clip("A", 1)], frame_rate: 0 }, "frame_rate must be between"],
  ])("rejects %j", (args, message) => {
    expect(() => planBeatMontage(args as Record<string, unknown>)).toThrow(message);
  });

  it("rejects oversized inputs", () => {
    expect(() => planBeatMontage({ beat_seconds: grid(5001, 0.1), clips: [clip("A", 1)] })).toThrow("between 2 and 5000");
    expect(() => planBeatMontage({ beat_seconds: beats, clips: Array.from({ length: 257 }, (_, index) => clip(`c${index}`, 1)) })).toThrow("between 1 and 256");
  });
});
