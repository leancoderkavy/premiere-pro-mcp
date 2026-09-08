import { describe, expect, it } from "vitest";
import { getRhythmPlanTools } from "../../src/tools/rhythm-plans.js";

const TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function checkSchema(schema: Record<string, unknown>, path: string, problems: string[]) {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) problems.push(`${path} allows additional properties`);
    for (const [name, property] of Object.entries(properties ?? {})) {
      const propertyPath = `${path}.${name}`;
      if (!TYPES.has(String(property.type))) problems.push(`${propertyPath} has no valid type`);
      if (typeof property.description !== "string" || !property.description.trim()) problems.push(`${propertyPath} has no description`);
      checkSchema(property, propertyPath, problems);
    }
    for (const required of (schema.required as string[] | undefined) ?? []) if (!properties || !(required in properties)) problems.push(`${path} requires unknown property ${required}`);
  }
  if (schema.type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    if (!items || !TYPES.has(String(items.type))) problems.push(`${path} array items lack a type`);
    if (typeof schema.maxItems !== "number") problems.push(`${path} array lacks maxItems`);
    if (items) checkSchema(items, `${path}[]`, problems);
  }
  if (schema.type === "string" && typeof schema.maxLength !== "number" && !Array.isArray(schema.enum) && typeof schema.pattern !== "string") problems.push(`${path} string lacks maxLength`);
  if ((schema.type === "number" || schema.type === "integer") && typeof schema.minimum !== "number" && typeof schema.exclusiveMinimum !== "number") problems.push(`${path} number lacks a minimum`);
  if ((schema.type === "number" || schema.type === "integer") && typeof schema.maximum !== "number") problems.push(`${path} number lacks a maximum`);
}

const REVISION = `sha256:${"b".repeat(64)}`;
const wordTimeline = { source_project_item_id: "item-9", transcript_revision: REVISION, words: [
  { text: "Big", start_seconds: 0, end_seconds: 0.4 },
  { text: "news.", start_seconds: 0.4, end_seconds: 0.9 },
  { text: "Seriously", start_seconds: 4, end_seconds: 4.5 },
  { text: "huge!", start_seconds: 4.5, end_seconds: 5 },
] };

describe("getRhythmPlanTools", () => {
  const tools = getRhythmPlanTools();

  it("exposes exactly the two rhythm plan tools", () => {
    expect(Object.keys(tools).sort()).toEqual(["plan_beat_montage", "plan_emphasis_zoom_keyframes"]);
  });

  it("declares bounded, described schemas with local-only descriptions", () => {
    for (const [name, tool] of Object.entries(tools)) {
      const problems: string[] = [];
      checkSchema(tool.parameters as unknown as Record<string, unknown>, name, problems);
      expect(problems).toEqual([]);
      expect(tool.description.length).toBeLessThanOrEqual(400);
      expect(tool.description).toMatch(/never changes Premiere/);
      expect(tool.description).toMatch(/[Ll]ocal-only/);
    }
    expect(tools.plan_beat_montage.parameters.required).toEqual(["beat_seconds", "clips"]);
    expect(tools.plan_emphasis_zoom_keyframes.parameters.properties.trigger.enum).toEqual(["sentence_start", "emphasis_words", "every_n_seconds", "supplied"]);
    expect(tools.plan_beat_montage.parameters.properties.order.enum).toEqual(["as_given", "priority", "round_robin"]);
    expect(tools.plan_emphasis_zoom_keyframes.parameters.properties.trigger_seconds.maxItems).toBe(2000);
    expect(tools.plan_beat_montage.parameters.properties.beat_seconds.maxItems).toBe(5000);
    expect(tools.plan_beat_montage.parameters.properties.clips.maxItems).toBe(256);
  });

  describe("plan_emphasis_zoom_keyframes", () => {
    const tool = tools.plan_emphasis_zoom_keyframes;

    it("returns a keyframe plan from supplied triggers", async () => {
      const result = await tool.handler({ trigger_seconds: [1, 6], frame_rate: 25 });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const data = result.data;
      expect(data.applied).toBe(false);
      expect(data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(data.events).toHaveLength(2);
      expect(data.keyframes.length).toBe(data.counts.keyframes);
      expect(data.keyframes.every((key) => ["Scale", "Position"].includes(key.property) && ["bezier", "linear", "hold"].includes(key.interpolation))).toBe(true);
      expect(data.automation.uxp.map((entry) => entry.parameter)).toEqual(["Scale", "Position"]);
      expect(data.automation.uxp.every((entry) => entry.component === "Motion")).toBe(true);
      expect(data.automation.legacy.every((entry) => entry.route === "add_keyframe")).toBe(true);
      expect(data.routes).toContain("automate_effect_parameters_uxp");
      expect(data.evidence).toMatchObject({ source: "trigger_seconds", trigger_count: 2 });
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(Array.isArray(data.assumptions)).toBe(true);
    });

    it("returns a keyframe plan from a word timeline", async () => {
      const result = await tool.handler({ word_timeline: wordTimeline, trigger: "emphasis_words", emphasis_words: ["HUGE"] });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.events.map((event) => [event.trigger_time_seconds, event.reason])).toEqual([[4.5, "emphasis_word:huge"]]);
      expect(result.data.evidence).toMatchObject({ source: "word_timeline", transcript_revision: REVISION, source_project_item_id: "item-9" });
    });

    it("rejects both inputs, neither input, and malformed args without throwing", async () => {
      const both = await tool.handler({ word_timeline: wordTimeline, trigger_seconds: [1] });
      expect(both).toMatchObject({ success: false, error: expect.stringContaining("exactly one of word_timeline or trigger_seconds") });
      const neither = await tool.handler({});
      expect(neither.success).toBe(false);
      const bad = await tool.handler({ trigger_seconds: "1,2,3" });
      expect(bad).toMatchObject({ success: false, error: expect.stringContaining("trigger_seconds must contain") });
      const badScale = await tool.handler({ trigger_seconds: [1], zoom_scale: 105, base_scale: 110 });
      expect(badScale).toMatchObject({ success: false, error: expect.stringContaining("zoom_scale must be greater than base_scale") });
      const undefinedArgs = await tool.handler(undefined as unknown as Record<string, unknown>);
      expect(undefinedArgs.success).toBe(false);
    });
  });

  describe("plan_beat_montage", () => {
    const tool = tools.plan_beat_montage;
    const beats = Array.from({ length: 9 }, (_, index) => index * 0.5);

    it("returns batches, trim plan, and markers", async () => {
      const result = await tool.handler({ beat_seconds: beats, clips: [{ item_id: "A", duration_seconds: 10 }, { item_id: "B", duration_seconds: 10, in_seconds: 2 }], allow_reuse: true });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const data = result.data;
      expect(data.applied).toBe(false);
      expect(data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(data.placements).toHaveLength(4);
      expect(data.placements[1]).toMatchObject({ item_id: "B", in_seconds: 2, out_seconds: 3, start_seconds: 1 });
      expect(data.batches).toHaveLength(1);
      expect(data.batches[0]).toHaveLength(4);
      expect(data.trim_plan).toHaveLength(4);
      expect(data.markers.cut_times_seconds).toEqual([0, 1, 2, 3]);
      expect(data.coverage_seconds).toBe(4);
      expect(data.unused_clips).toEqual([]);
      expect(data.routes).toEqual(expect.arrayContaining(["add_to_timeline_batch", "trim_clip", "apply_beat_markers_uxp"]));
      expect(data.evidence).toMatchObject({ beat_count: 9, clip_count: 2 });
    });

    it("rejects malformed args without throwing", async () => {
      expect(await tool.handler({ clips: [{ item_id: "A", duration_seconds: 1 }] })).toMatchObject({ success: false, error: expect.stringContaining("beat_seconds") });
      expect(await tool.handler({ beat_seconds: [1, 0], clips: [{ item_id: "A", duration_seconds: 1 }] })).toMatchObject({ success: false, error: expect.stringContaining("strictly ascending") });
      expect(await tool.handler({ beat_seconds: beats, clips: "A" })).toMatchObject({ success: false, error: expect.stringContaining("clips must contain") });
      expect(await tool.handler({ beat_seconds: beats, clips: [{ item_id: "A", duration_seconds: 1 }], order: "shuffle" })).toMatchObject({ success: false, error: expect.stringContaining("order must be one of") });
      expect((await tool.handler(null as unknown as Record<string, unknown>)).success).toBe(false);
    });

    it("is deterministic across calls", async () => {
      const args = { beat_seconds: beats, clips: [{ item_id: "A", duration_seconds: 10 }] };
      const first = await tool.handler(args);
      const second = await tool.handler(JSON.parse(JSON.stringify(args)));
      expect(first.success && second.success && first.data.plan_revision === second.data.plan_revision).toBe(true);
    });
  });
});
