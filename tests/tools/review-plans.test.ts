import { describe, expect, it } from "vitest";
import { getReviewPlanTools } from "../../src/tools/review-plans.js";

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

describe("getReviewPlanTools", () => {
  const tools = getReviewPlanTools();

  it("exposes exactly the two review planners", () => {
    expect(Object.keys(tools).sort()).toEqual(["plan_client_notes_checklist", "plan_multicam_angle_switches"]);
  });

  it("declares bounded, described, local-only schemas", () => {
    for (const [name, tool] of Object.entries(tools)) {
      const problems: string[] = [];
      checkSchema(tool.parameters as unknown as Record<string, unknown>, name, problems);
      expect(problems).toEqual([]);
      expect(tool.description.length).toBeLessThanOrEqual(420);
      expect(tool.description).toMatch(/never changes Premiere/);
      expect(tool.description).toMatch(/[Ll]ocal-only/);
    }
    expect(tools.plan_client_notes_checklist.parameters.required).toEqual(["notes"]);
    expect(tools.plan_multicam_angle_switches.parameters.required).toEqual(["speaker_segments", "cameras"]);
    expect(tools.plan_client_notes_checklist.parameters.properties.timecode_style.enum).toEqual(["auto", "clock", "frames"]);
    expect(tools.plan_multicam_angle_switches.parameters.properties.cameras.items.properties.role.enum).toEqual(["single", "two_shot", "wide"]);
  });

  it("plans client notes and reports failures as tool errors", async () => {
    const ok = await tools.plan_client_notes_checklist.handler({ notes: "- 0:12 music too loud, must fix\n- 1:05 logo cut off" });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.applied).toBe(false);
    expect(ok.data.markers).toHaveLength(2);
    expect(ok.data.items[0].category).toBe("audio");
    const bad = await tools.plan_client_notes_checklist.handler({ notes: "" });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error).toMatch(/notes/);
  });

  it("plans multicam switches and reports failures as tool errors", async () => {
    const ok = await tools.plan_multicam_angle_switches.handler({
      speaker_segments: [{ speaker: "A", start_seconds: 0, end_seconds: 10 }, { speaker: "B", start_seconds: 10, end_seconds: 20 }],
      cameras: [{ camera_id: "1", speakers: ["A"], video_track_index: 1 }, { camera_id: "2", speakers: ["B"], video_track_index: 2 }],
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.cuts.map((cut) => cut.camera_id)).toEqual(["1", "2"]);
    expect(ok.data.switch_times_seconds).toEqual([10]);
    const bad = await tools.plan_multicam_angle_switches.handler({ speaker_segments: [], cameras: [] });
    expect(bad.success).toBe(false);
  });
});
