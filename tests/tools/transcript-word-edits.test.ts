import { describe, expect, it } from "vitest";
import { getTranscriptWordEditTools } from "../../src/tools/transcript-word-edits.js";

const revision = `sha256:${"a".repeat(64)}`;
const words = (text: string, at = 0) => text.split(/\s+/).map((token, index) => ({ text: token, start_seconds: at + index * 0.4, end_seconds: at + index * 0.4 + 0.3 }));
const timeline = (text: string, at = 0) => ({ source_project_item_id: "clip-1", transcript_revision: revision, words: words(text, at) });

const TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);
function checkSchema(schema: Record<string, unknown>, path: string) {
  expect(TYPES.has(schema.type as string), `${path}.type`).toBe(true);
  if (schema.type === "object" && schema.properties) {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    for (const [name, property] of Object.entries(properties)) {
      expect(typeof property.description, `${path}.${name}.description`).toBe("string");
      checkSchema(property, `${path}.${name}`);
    }
    for (const name of (schema.required as string[] | undefined) ?? []) expect(properties[name], `${path}.required ${name}`).toBeDefined();
  }
  if (schema.type === "array") checkSchema(schema.items as Record<string, unknown>, `${path}[]`);
}

describe("transcript word edit tools", () => {
  const tools = getTranscriptWordEditTools();
  const names = ["plan_filler_word_removal", "plan_pause_tightening", "plan_word_mute_ranges", "detect_repeated_takes"] as const;

  it("exposes exactly the four planning tools", () => {
    expect(Object.keys(tools).sort()).toEqual([...names].sort());
  });

  it.each(names)("%s has a closed, fully described schema", (name) => {
    const tool = tools[name];
    expect(tool.description.length).toBeLessThan(400);
    expect(tool.description).toMatch(/never changes Premiere/);
    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.required).toContain("word_timeline");
    checkSchema(tool.parameters as unknown as Record<string, unknown>, name);
  });

  it("requires words for plan_word_mute_ranges only", () => {
    expect(tools.plan_word_mute_ranges.parameters.required).toEqual(["word_timeline", "words"]);
    expect(tools.plan_filler_word_removal.parameters.required).toEqual(["word_timeline"]);
  });

  it.each(names)("%s returns success:false without throwing on invalid args", async (name) => {
    const tool = tools[name];
    for (const args of [{}, { word_timeline: null }, { word_timeline: { source_project_item_id: "x", transcript_revision: "bad", words: [] } }, { word_timeline: timeline("hi"), frame_rate: 999, words: ["hi"] }]) {
      const result = await tool.handler(args as Record<string, unknown>);
      expect(result.success).toBe(false);
      if (!result.success) expect(typeof result.error).toBe("string");
    }
    const notObject = await tool.handler(null as unknown as Record<string, unknown>);
    expect(notObject.success).toBe(false);
  });

  it("plans filler removal through the handler", async () => {
    const result = await tools.plan_filler_word_removal.handler({ word_timeline: timeline("um hello world"), handle_frames: 0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.applied).toBe(false);
    expect(data.plan_revision).toMatch(/^sha256:/);
    expect(data.evidence).toEqual({ source_project_item_id: "clip-1", transcript_revision: revision, word_count: 3 });
    expect(data.removal_ranges).toHaveLength(1);
    expect(data.keep_ranges).toHaveLength(1);
    expect(data.routes).toEqual({ primary: ["preview_derived_dialogue_sequence_uxp", "apply_derived_dialogue_sequence_uxp"], fallback: ["split_clip", "ripple_delete"] });
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(Array.isArray(data.assumptions)).toBe(true);
  });

  it("plans pause tightening through the handler", async () => {
    const result = await tools.plan_pause_tightening.handler({ word_timeline: { source_project_item_id: "clip-1", transcript_revision: revision, words: [{ text: "a", start_seconds: 0, end_seconds: 0.5 }, { text: "b", start_seconds: 3, end_seconds: 3.5 }] } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.pauses_tightened).toBe(1);
    expect(data.applied).toBe(false);
    expect((data.removal_ranges as unknown[]).length).toBe(1);
  });

  it("plans word muting through the handler without leaking the flagged word", async () => {
    const result = await tools.plan_word_mute_ranges.handler({ word_timeline: timeline("the darn thing"), words: ["darn"], mode: "bleep" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(JSON.stringify(result.data)).not.toMatch(/darn/);
    const data = result.data as Record<string, unknown>;
    expect((data.mute_ranges as unknown[]).length).toBe(1);
    expect((data.audio_keyframes as unknown[]).length).toBe(4);
    expect((data.tone_placements as unknown[]).length).toBe(1);
    expect((data.routes as { primary: string[] }).primary).toContain("create_bars_and_tone");
  });

  it("detects repeated takes through the handler", async () => {
    const line = "we went to the store today.";
    const result = await tools.detect_repeated_takes.handler({ word_timeline: { source_project_item_id: "clip-1", transcript_revision: revision, words: [...words(line, 0), ...words(line, 4)] } });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.group_count).toBe(1);
    expect(data.applied).toBe(false);
    expect((data.groups as Array<{ kept_index: number }>)[0].kept_index).toBe(1);
  });

  it("produces the same plan_revision for the same input", async () => {
    const args = { word_timeline: timeline("um hello uh world") };
    const first = await tools.plan_filler_word_removal.handler(args);
    const second = await tools.plan_filler_word_removal.handler(args);
    expect(first.success && second.success && (first.data as { plan_revision: string }).plan_revision).toBe(second.success ? (second.data as { plan_revision: string }).plan_revision : undefined);
  });
});
