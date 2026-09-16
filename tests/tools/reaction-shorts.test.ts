import { describe, expect, it } from "vitest";
import { getReactionShortsTools } from "../../src/tools/reaction-shorts.js";
import { annotationsForTool } from "../../src/workflows/tool-metadata.js";
import { capabilityForTool } from "../../src/security/capabilities.js";

const revision = `sha256:${"d".repeat(64)}`;
const wordTimeline = {
  source_project_item_id: "clip-8",
  transcript_revision: revision,
  words: [
    { text: "No", start_seconds: 12, end_seconds: 12.2, speaker_label: "Nanda" },
    { text: "please", start_seconds: 12.4, end_seconds: 13.2, speaker_label: "Nanda" },
    { text: "No!", start_seconds: 14.8, end_seconds: 16, speaker_label: "YYQ" },
  ],
};
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

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

describe("getReactionShortsTools", () => {
  const tools = getReactionShortsTools();

  it("exposes the three local-only plan tools", () => {
    expect(Object.keys(tools).sort()).toEqual([
      "plan_reaction_captions",
      "plan_short_export_folder",
      "plan_short_subscribe_cta",
    ]);
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description.length).toBeLessThan(400);
      expect(tool.description).toMatch(/Local-only; never/);
      expect(annotationsForTool(name)).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(capabilityForTool(name)).toBe("inspect");
    }
  });

  it("declares fully typed, described, and bounded schemas", () => {
    for (const [name, tool] of Object.entries(tools)) {
      checkSchema(tool.parameters as unknown as Record<string, unknown>, name);
      expect(tool.parameters.additionalProperties).toBe(false);
    }
    expect(tools.plan_reaction_captions.parameters.required).toEqual(["word_timeline", "speaker_palette"]);
    expect(tools.plan_short_subscribe_cta.parameters.required).toEqual(["duration_seconds"]);
    expect(tools.plan_short_export_folder.parameters.required).toEqual(["export_root", "series_name", "title"]);
    expect(tools.plan_reaction_captions.parameters.properties.speaker_palette.maxItems).toBe(16);
    expect(tools.plan_short_subscribe_cta.parameters.properties.brand.enum).toEqual(["watch_club", "cafe", "other"]);
  });

  it("plans reaction captions through the handler", async () => {
    const result = await tools.plan_reaction_captions.handler({
      word_timeline: wordTimeline,
      speaker_palette: [
        { speaker_label: "Nanda", color: "#ef4444" },
        { speaker_label: "YYQ", color: "#22c55e" },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { cues: Array<{ text: string; color: string }>; applied: boolean };
    expect(data.applied).toBe(false);
    expect(data.cues[0]).toMatchObject({ text: "No, please", color: "#EF4444" });
  });

  it("returns handler errors without throwing", async () => {
    const missing = await tools.plan_reaction_captions.handler({ word_timeline: wordTimeline });
    expect(missing).toMatchObject({ success: false, error: expect.stringMatching(/speaker_palette/) });
    const relative = await tools.plan_short_export_folder.handler({
      export_root: "exports",
      series_name: "Kingdom",
      title: "Short 01",
    });
    expect(relative).toMatchObject({ success: false, error: expect.stringMatching(/absolute path/) });
  });

  it("is deterministic", async () => {
    const args = { duration_seconds: 19.9, brand: "cafe" };
    const [first, second] = await Promise.all([
      tools.plan_short_subscribe_cta.handler(args),
      tools.plan_short_subscribe_cta.handler(args),
    ]);
    expect(first).toEqual(second);
  });
});
