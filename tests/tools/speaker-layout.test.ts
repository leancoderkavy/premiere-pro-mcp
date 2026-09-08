import { describe, expect, it } from "vitest";
import { getSpeakerLayoutTools } from "../../src/tools/speaker-layout.js";

const revision = `sha256:${"b".repeat(64)}`;
const wordTimeline = {
  source_project_item_id: "clip-7",
  transcript_revision: revision,
  words: [
    { text: "Welcome", start_seconds: 0, end_seconds: 1, speaker_label: "Host" },
    { text: "back.", start_seconds: 1, end_seconds: 2.5, speaker_label: "Host" },
    { text: "Thanks", start_seconds: 2.6, end_seconds: 4, speaker_label: "Guest" },
    { text: "sure.", start_seconds: 4, end_seconds: 6, speaker_label: "Guest" },
  ],
};
const regions = [
  { speaker_label: "Host", x: 0.05, y: 0.15, width: 0.3, height: 0.5 },
  { speaker_label: "Guest", x: 0.65, y: 0.15, width: 0.3, height: 0.5 },
];
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

/**
 * `describedProperty` is true for every named property of an object schema:
 * those must carry a human-readable description. An array's `items` node is a
 * shape, not a property, so it only has to be typed and bounded.
 */
function checkSchema(schema: Record<string, unknown>, path: string, describedProperty = false): void {
  expect(SCHEMA_TYPES.has(schema.type as string), `${path}.type`).toBe(true);
  if (describedProperty) expect(typeof schema.description, `${path}.description`).toBe("string");
  if (schema.type === "object") {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties, `${path}.properties`).toBeTypeOf("object");
    for (const [name, child] of Object.entries(properties)) checkSchema(child, `${path}.${name}`, true);
    for (const required of (schema.required as string[] | undefined) ?? []) expect(properties[required], `${path}.required ${required}`).toBeDefined();
  }
  if (schema.type === "array") {
    expect(schema.maxItems, `${path}.maxItems`).toBeTypeOf("number");
    checkSchema(schema.items as Record<string, unknown>, `${path}.items`);
  }
  if (schema.type === "string" && !schema.enum && !schema.pattern) expect(schema.maxLength, `${path}.maxLength`).toBeTypeOf("number");
  if (schema.type === "number" || schema.type === "integer") {
    expect(schema.minimum ?? schema.exclusiveMinimum, `${path}.minimum`).toBeTypeOf("number");
    expect(schema.maximum, `${path}.maximum`).toBeTypeOf("number");
  }
}

describe("getSpeakerLayoutTools", () => {
  const tools = getSpeakerLayoutTools();

  it("exposes exactly the two plan tools with local-only descriptions", () => {
    expect(Object.keys(tools).sort()).toEqual(["plan_active_speaker_reframe", "plan_speaker_checkerboard"]);
    for (const tool of Object.values(tools)) {
      expect(tool.description.length).toBeLessThan(400);
      expect(tool.description).toMatch(/Local-only; never changes Premiere/);
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("declares fully typed, described, and bounded schemas", () => {
    for (const [name, tool] of Object.entries(tools)) {
      checkSchema(tool.parameters as unknown as Record<string, unknown>, name);
      expect(tool.parameters.additionalProperties).toBe(false);
    }
    expect(tools.plan_speaker_checkerboard.parameters.required).toEqual(["word_timeline"]);
    expect(tools.plan_active_speaker_reframe.parameters.required).toEqual(["word_timeline", "source_frame", "speaker_regions"]);
    expect(tools.plan_active_speaker_reframe.parameters.properties.layout.enum).toEqual(["active_speaker", "stacked", "split_left_right", "auto"]);
    expect(tools.plan_active_speaker_reframe.parameters.properties.speaker_regions.maxItems).toBe(8);
  });

  it("plans a checkerboard from a word timeline", async () => {
    const result = await tools.plan_speaker_checkerboard.handler({ word_timeline: wordTimeline, frame_rate: 25, handle_frames: 1 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data;
    expect(data.applied).toBe(false);
    expect(data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(data.evidence.transcript_revision).toBe(revision);
    expect(data.speakers.map((speaker) => speaker.label)).toEqual(["Host", "Guest"]);
    expect(data.segments).toHaveLength(2);
    expect(data.segments[1]).toMatchObject({ speaker_label: "Guest", video_track_index: 1, audio_track_index: 1, requires_move: true });
    expect(data.segments[0].end_frame).toBeLessThanOrEqual(data.segments[1].start_frame);
    expect(data.split_points_seconds.length).toBeGreaterThan(0);
    expect(data.tracks_to_add).toEqual({ video: 1, audio: 1 });
    expect(data.routes.map((route) => route.tool)).toContain("razor_all_tracks");
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(Array.isArray(data.assumptions)).toBe(true);
  });

  it("plans an active-speaker reframe with keyframes", async () => {
    const result = await tools.plan_active_speaker_reframe.handler({ word_timeline: wordTimeline, source_frame: { width: 3840, height: 2160 }, speaker_regions: regions, layout: "active_speaker" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data;
    expect(data.applied).toBe(false);
    expect(data.layout).toBe("active_speaker");
    expect(data.target_frame).toEqual({ width: 1080, height: 1920 });
    expect(data.switches.map((sw) => sw.speaker_label)).toEqual(["Host", "Guest"]);
    expect(data.keyframes.filter((keyframe) => keyframe.property === "Scale")).toHaveLength(2);
    expect(data.keyframes.every((keyframe) => keyframe.interpolation === "hold")).toBe(true);
    expect(data.routes.map((route) => route.tool)).toEqual(["create_sequence_from_preset", "set_clip_scale", "set_clip_position", "add_keyframe"]);
    expect(data.alternative_routes.map((route) => route.tool)).toContain("auto_reframe_sequence");
  });

  it("plans a stacked layout by default for two speakers", async () => {
    const result = await tools.plan_active_speaker_reframe.handler({ word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: regions });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.layout).toBe("stacked");
    expect("layers" in result.data && result.data.layers).toHaveLength(2);
    expect(result.data.routes.map((route) => route.tool)).toContain("duplicate_clip");
  });

  it("returns errors instead of throwing for invalid input", async () => {
    const checkerboard = tools.plan_speaker_checkerboard.handler;
    const reframe = tools.plan_active_speaker_reframe.handler;
    await expect(checkerboard({})).resolves.toMatchObject({ success: false, error: expect.stringMatching(/word_timeline/) });
    await expect(checkerboard(undefined as unknown as Record<string, unknown>)).resolves.toMatchObject({ success: false });
    await expect(checkerboard({ word_timeline: wordTimeline, handle_frames: 99 })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/handle_frames/) });
    await expect(checkerboard({ word_timeline: wordTimeline, nope: 1 })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/unknown field/) });
    await expect(checkerboard({ word_timeline: { ...wordTimeline, words: wordTimeline.words.map(({ speaker_label: _label, ...rest }) => rest) } })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/speaker_label/) });
    await expect(reframe({ word_timeline: wordTimeline, speaker_regions: regions })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/source_frame/) });
    await expect(reframe({ word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: [regions[0]] })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/missing a region.*Guest/) });
    await expect(reframe({ word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: regions, layout: "pip" })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/layout/) });
    await expect(reframe({ word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: "none" })).resolves.toMatchObject({ success: false, error: expect.stringMatching(/speaker_regions/) });
  });

  it("produces identical plans for identical input", async () => {
    const args = { word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: regions };
    const [first, second] = await Promise.all([tools.plan_active_speaker_reframe.handler(args), tools.plan_active_speaker_reframe.handler(args)]);
    expect(first).toEqual(second);
    const [board1, board2] = await Promise.all([tools.plan_speaker_checkerboard.handler({ word_timeline: wordTimeline }), tools.plan_speaker_checkerboard.handler({ word_timeline: wordTimeline })]);
    expect(board1).toEqual(board2);
  });

  it("does not mutate caller input", async () => {
    const snapshot = JSON.stringify({ wordTimeline, regions });
    await tools.plan_active_speaker_reframe.handler({ word_timeline: wordTimeline, source_frame: { width: 1920, height: 1080 }, speaker_regions: regions });
    await tools.plan_speaker_checkerboard.handler({ word_timeline: wordTimeline, speaker_order: ["Guest"] });
    expect(JSON.stringify({ wordTimeline, regions })).toBe(snapshot);
  });
});
