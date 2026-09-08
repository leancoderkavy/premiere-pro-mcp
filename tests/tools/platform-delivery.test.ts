import { describe, expect, it } from "vitest";
import { PLATFORM_IDS, SPEC_DISCLAIMER } from "../../src/ai/platform-specs.js";
import { getPlatformDeliveryTools } from "../../src/tools/platform-delivery.js";

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: unknown[] };

function assertSchema(schema: Schema, path: string) {
  expect(schema.type, `${path} needs a type`).toBeTypeOf("string");
  expect(["string", "number", "integer", "boolean", "array", "object"], `${path} type`).toContain(schema.type);
  expect(schema.description, `${path} needs a description`).toBeTypeOf("string");
  if (schema.properties) for (const [key, child] of Object.entries(schema.properties)) assertSchema(child, `${path}.${key}`);
  if (schema.items) assertSchema(schema.items, `${path}[]`);
  if (schema.required && schema.properties) for (const key of schema.required) expect(schema.properties, `${path} required ${key}`).toHaveProperty(key);
}

const source = { width: 1920, height: 1080, frame_rate: 30, duration_seconds: 40 };

describe("getPlatformDeliveryTools", () => {
  const tools = getPlatformDeliveryTools();

  it("exposes exactly the two plan-style tools with local-only descriptions", () => {
    expect(Object.keys(tools)).toEqual(["plan_platform_delivery_matrix", "validate_platform_publish_package"]);
    for (const tool of Object.values(tools)) {
      expect(tool.description.length).toBeLessThanOrEqual(360);
      expect(tool.description).toMatch(/Local-only/);
      expect(tool.description).toMatch(/never/);
    }
  });

  it("has fully described, bounded schemas", () => {
    for (const [name, tool] of Object.entries(tools)) {
      const parameters = tool.parameters as unknown as Schema & { additionalProperties: boolean };
      expect(parameters.type).toBe("object");
      expect(parameters.additionalProperties).toBe(false);
      for (const [key, child] of Object.entries(parameters.properties ?? {})) assertSchema(child, `${name}.${key}`);
      for (const key of parameters.required ?? []) expect(parameters.properties).toHaveProperty(key);
    }
    const matrix = tools.plan_platform_delivery_matrix.parameters;
    expect(matrix.required).toEqual(["source", "targets"]);
    expect(matrix.properties.targets.items.enum).toEqual([...PLATFORM_IDS]);
    expect(matrix.properties.targets.maxItems).toBe(PLATFORM_IDS.length);
    expect(matrix.properties.source.required).toEqual(["width", "height", "frame_rate", "duration_seconds"]);
    const validate = tools.validate_platform_publish_package.parameters;
    expect(validate.required).toEqual(["platform", "duration_seconds", "width", "height", "frame_rate"]);
    expect(validate.properties.title.maxLength).toBe(1000);
    expect(validate.properties.description.maxLength).toBe(10000);
    expect(validate.properties.hashtags.maxItems).toBe(100);
    expect(validate.properties.content_flags.items.enum).toEqual(["ai_generated", "paid_partnership", "music_licensed"]);
  });

  it("plans a delivery matrix on the happy path", async () => {
    const result = await tools.plan_platform_delivery_matrix.handler({ source, targets: ["tiktok", "youtube", "linkedin"], strategy: "pad_blur", export_preset_hint: "Match Source - High bitrate" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.applied).toBe(false);
    expect(result.data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.data.assumptions[0]).toBe(SPEC_DISCLAIMER);
    expect(result.data.targets.map((target) => target.platform.id)).toEqual(["tiktok", "youtube", "linkedin"]);
    expect(result.data.targets[0].reframe.pad_blur_recipe).toBeDefined();
    expect(result.data.targets[0].reframe.fit_scale_percent).toBe(56.25);
    expect(result.data.targets[1].aspect_change.requires_reframe).toBe(false);
    expect(result.data.summary.targets).toBe(3);
    expect(result.data.routes).toContain("export_sequence");
    expect(result.data.next_steps.length).toBeGreaterThan(0);
    expect(Array.isArray(result.data.warnings)).toBe(true);
  });

  it("defaults strategy to auto_reframe", async () => {
    const result = await tools.plan_platform_delivery_matrix.handler({ source, targets: ["instagram_reels"] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.strategy).toBe("auto_reframe");
    expect(result.data.targets[0].steps.some((step) => step.routes.includes("auto_reframe_sequence"))).toBe(true);
  });

  it("returns success:false for invalid matrix arguments without throwing", async () => {
    const cases: Array<Record<string, unknown>> = [
      {},
      { source, targets: [] },
      { source, targets: ["nope"] },
      { source, targets: ["tiktok", "tiktok"] },
      { source: { ...source, width: -1 }, targets: ["tiktok"] },
      { source: "1920x1080", targets: ["tiktok"] },
      { source, targets: ["tiktok"], strategy: "squash" },
      { source, targets: ["tiktok"], export_preset_hint: 5 },
    ];
    for (const args of cases) {
      const result = await tools.plan_platform_delivery_matrix.handler(args);
      expect(result.success, JSON.stringify(args)).toBe(false);
      if (!result.success) expect(result.error).toBeTypeOf("string");
    }
  });

  it("validates a publish package on the happy path", async () => {
    const result = await tools.validate_platform_publish_package.handler({ platform: "tiktok", title: "Hook", description: "Body", hashtags: ["#fyp", "#edit"], duration_seconds: 30, width: 1080, height: 1920, frame_rate: 30, file_size_bytes: 20_000_000, container: "mp4", video_codec: "H.264", audio_codec: "AAC", has_captions: true, content_flags: ["ai_generated"] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ready).toBe(true);
    expect(result.data.violations).toEqual([]);
    expect(result.data.warnings.map((warning) => warning.code)).toEqual(["ai_generated_label"]);
    expect(result.data.normalized_hashtags).toEqual(["#fyp", "#edit"]);
    expect(result.data.character_counts.title).toBe(4);
    expect(result.data.applied).toBe(false);
    expect(result.data.assumptions).toContain(SPEC_DISCLAIMER);
    expect(result.data.platform.id).toBe("tiktok");
  });

  it("reports violations through the tool wrapper", async () => {
    const result = await tools.validate_platform_publish_package.handler({ platform: "instagram_reels", hashtags: ["reels", "#Reels", "#reels"], duration_seconds: 500, width: 1920, height: 1080, frame_rate: 30, container: "mov" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ready).toBe(false);
    expect(result.data.violations.map((violation) => violation.code)).toEqual(["duration_exceeds_max", "aspect_mismatch", "container_mismatch", "hashtag_invalid", "hashtag_duplicate", "hashtag_duplicate"]);
    expect(result.data.normalized_hashtags).toEqual(["#reels"]);
    for (const violation of result.data.violations) {
      expect(violation.field).toBeTypeOf("string");
      expect(violation.message).toBeTypeOf("string");
      expect(violation).toHaveProperty("limit");
      expect(violation).toHaveProperty("actual");
    }
  });

  it("returns success:false for invalid publish arguments without throwing", async () => {
    const base = { platform: "youtube", duration_seconds: 30, width: 1920, height: 1080, frame_rate: 30 };
    const cases: Array<Record<string, unknown>> = [
      {},
      { ...base, platform: "vimeo" },
      { ...base, duration_seconds: -5 },
      { ...base, width: 0 },
      { ...base, frame_rate: "30" },
      { ...base, hashtags: "#one" },
      { ...base, content_flags: ["unknown"] },
      { ...base, title: "x".repeat(1001) },
      { ...base, has_captions: "true" },
      { ...base, unexpected: 1 },
    ];
    for (const args of cases) {
      const result = await tools.validate_platform_publish_package.handler(args);
      expect(result.success, JSON.stringify(args)).toBe(false);
      if (!result.success) expect(result.error).toBeTypeOf("string");
    }
  });

  it("produces identical output for identical arguments", async () => {
    const args = { source, targets: ["youtube_shorts", "x"] };
    const a = await tools.plan_platform_delivery_matrix.handler(args);
    const b = await tools.plan_platform_delivery_matrix.handler({ ...args });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
