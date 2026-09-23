import { describe, expect, it } from "vitest";
import { buildMogrtPlan, buildMogrtRecipeScript, buildTextStyleExpression, getMogrtAuthoringTools } from "../../src/tools/mogrt-authoring.js";

const bridgeOptions = { tempDir: "D:/PremiereBridge", timeoutMs: 5000 };

describe("MOGRT authoring tools", () => {
  it("issues a bounded lower-third preview and consumes its token exactly once", async () => {
    const scripts: string[] = [];
    const tools = getMogrtAuthoringTools(bridgeOptions, {
      directoryExists: () => true,
      tokenFactory: () => "preview-token",
      send: async (script) => {
        scripts.push(script);
        return { success: true, data: { exportRequested: true, hostExportReturn: false } };
      },
      artifactStatus: () => ({ exists: false, size_bytes: null, zip_header_valid: false }),
      operationIdFactory: () => "operation-1",
    });

    const preview = await tools.preview_mogrt_recipe.handler({
      recipe: "lower_third",
      template_name: "Launch Title",
      headline: "A headline",
      subtitle: "A subtitle",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    });
    expect(preview).toMatchObject({
      success: true,
      data: {
        applied: false,
        previewToken: "preview-token",
        plan: { output_path: "D:\\Approved\\templates\\Launch Title.mogrt" },
      },
    });

    const created = await tools.create_mogrt_recipe.handler({
      preview_token: "preview-token",
      confirm_export: true,
    });
    expect(created).toMatchObject({ success: true, data: { operationId: "operation-1" } });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("exportAsMotionGraphicsTemplate");
    expect(scripts[0]).toContain("addToMotionGraphicsTemplate");
    expect(scripts[0]).toContain("Open a saved After Effects project inside approved_workspace_path");
    expect(scripts[0]).toContain("existing.exists");

    await expect(tools.create_mogrt_recipe.handler({
      preview_token: "preview-token",
      confirm_export: true,
    })).rejects.toThrow("already used");
  });

  it("fails closed when an output path leaves its approved workspace", async () => {
    const tools = getMogrtAuthoringTools(bridgeOptions, { directoryExists: () => true });
    await expect(tools.preview_mogrt_recipe.handler({
      template_name: "Outside",
      headline: "Nope",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Elsewhere",
    })).rejects.toThrow("inside approved_workspace_path");
  });

  it("supports only the bounded recipe library and applies contained brand-kit defaults", async () => {
    const tools = getMogrtAuthoringTools(bridgeOptions, { directoryExists: () => true });
    await expect(tools.preview_mogrt_recipe.handler({
      recipe: "social_end_card",
      template_name: "Brand End Card",
      headline: "Follow us",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      brand_kit: { name: "Brand", name_prefix: "Brand", accent_color: "#102030", text_color: "#FFFFFF", safe_margin_percent: 0.1 },
    })).resolves.toMatchObject({
      success: true,
      data: { plan: { recipe: "social_end_card", accent_color: "#102030", text_color: "#FFFFFF" } },
    });
    await expect(tools.preview_mogrt_recipe.handler({
      recipe: "arbitrary_script",
      template_name: "Nope",
      headline: "Nope",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    })).rejects.toThrow("recipe must be one of");
  });

  it("does not report a valid ZIP header as visual or import verification", async () => {
    const tools = getMogrtAuthoringTools(bridgeOptions, {
      artifactStatus: () => ({ exists: true, size_bytes: 42, zip_header_valid: true }),
      operationIdFactory: () => "operation-verify",
    });
    await expect(tools.verify_mogrt_artifact.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
    })).resolves.toMatchObject({
      success: true,
      data: { visualVerified: false, importVerified: false, artifact: { zip_header_valid: true } },
    });
  });

  it("rejects unapproved preview inputs before a connector call", async () => {
    const tools = getMogrtAuthoringTools(bridgeOptions, { directoryExists: () => false });
    await expect(tools.preview_mogrt_recipe.handler(null)).rejects.toThrow("arguments must be an object");
    await expect(tools.preview_mogrt_recipe.handler({
      template_name: "Missing output",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    })).rejects.toThrow("must already exist");
    await expect(tools.preview_mogrt_recipe.handler({
      template_name: "Bad.",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    })).rejects.toThrow("template_name");
    await expect(tools.preview_mogrt_recipe.handler({
      template_name: "Safe",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      unexpected: true,
    })).rejects.toThrow("unsupported field");

    const existingDirectory = getMogrtAuthoringTools(bridgeOptions, { directoryExists: () => true });
    await expect(existingDirectory.preview_mogrt_recipe.handler({
      recipe: "not_a_recipe",
      template_name: "Safe",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    })).rejects.toThrow("recipe must be one of");
    await expect(existingDirectory.preview_mogrt_recipe.handler({
      template_name: "Safe",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "/approved/templates",
    })).rejects.toThrow("same path format");
    await expect(existingDirectory.preview_mogrt_recipe.handler({
      template_name: "Safe",
      headline: "No file",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      frame_rate: 31,
    })).rejects.toThrow("frame_rate must be one of");
  });

  it("requires confirmation, preserves bridge errors, and reports local artifact failures", async () => {
    let now = 0;
    const tools = getMogrtAuthoringTools(bridgeOptions, {
      directoryExists: () => true,
      now: () => now,
      tokenFactory: () => "expiring-token",
      operationIdFactory: () => "operation-error",
      send: async () => ({ success: false, error: "connector unavailable" }),
      artifactStatus: () => ({ exists: true, size_bytes: 10, zip_header_valid: false }),
    });
    await tools.preview_mogrt_recipe.handler({
      template_name: "Safe",
      headline: "A headline",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    });
    await expect(tools.create_mogrt_recipe.handler({
      preview_token: "expiring-token",
      confirm_export: false,
    })).rejects.toThrow("confirm_export");
    await expect(tools.create_mogrt_recipe.handler({
      preview_token: "expiring-token",
      confirm_export: true,
    })).resolves.toMatchObject({ success: false, error: "connector unavailable (operation operation-error)" });

    await expect(tools.verify_mogrt_artifact.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
    })).resolves.toMatchObject({ success: false, error: "The artifact is not a recognizable ZIP-based .mogrt file" });

    await tools.preview_mogrt_recipe.handler({
      template_name: "Expired",
      headline: "A headline",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    });
    now = 10 * 60 * 1000;
    await expect(tools.create_mogrt_recipe.handler({
      preview_token: "expiring-token",
      confirm_export: true,
    })).rejects.toThrow("expired");
  });

  it("exposes full text style and transform controls on headline layers by default (#618)", () => {
    const plan = buildMogrtPlan({
      recipe: "title_card",
      template_name: "Styled Title",
      headline: "Say \"hi\"",
      subtitle: "Sub",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    }, () => true);
    expect(plan.text_controls).toBe("full");
    const script = buildMogrtRecipeScript(plan);
    for (const name of ["Font Size", "Fill Color", "Stroke Color", "Stroke Width"]) {
      expect(script).toContain(`addTextStyleControls(headlineLayer, comp, "Headline"`);
      expect(script).toContain(`label + " ${name}"`);
    }
    for (const name of ["Position", "Scale", "Rotation", "Anchor Point", "Opacity"]) {
      expect(script).toContain(`label + " ${name}"`);
    }
    expect(script).toContain("ADBE Rotate Z");
    expect(script).toContain("ADBE Anchor Point");
    expect(script).toContain("exposeTransform(subtitleLayer, comp, \"Subtitle\")");
    expect(script).toContain("addToMotionGraphicsTemplateAs");
    expect(script).toContain("getMotionGraphicsTemplateControllerName");
    expect(script).toContain("Say \\\"hi\\\"");
    expect(script).toContain("fontFamilyEditable: false");
    expect(script).not.toMatch(/\b(?:let|const)\s|=>/);

    const expression = buildTextStyleExpression("Headline");
    expect(expression).toContain('effect("Headline Font Size")("Slider")');
    expect(expression).toContain("setFillColor");
    expect(expression).toContain("setApplyStroke(strokeWidth > 0)");
  });

  it("keeps legacy text-only controls when text_controls is text_only and rejects unknown modes", () => {
    const base = {
      template_name: "Plain",
      headline: "Plain",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    };
    const script = buildMogrtRecipeScript(buildMogrtPlan({ ...base, text_controls: "text_only" }, () => true));
    expect(script).not.toContain("addTextStyleControls(headlineLayer");
    expect(script).toContain("exposedControls.headline = expose(headlineSource, comp)");
    expect(() => buildMogrtPlan({ ...base, text_controls: "everything" }, () => true)).toThrow("text_controls must be one of");
    expect(() => buildMogrtPlan({ ...base, placeholder_media_path: "D:/Approved/logo.png" }, () => true)).toThrow("only supported by the media_placeholder recipe");
  });

  it("builds a media-placeholder recipe with a replaceable media slot and transform controls (#619)", async () => {
    const scripts: string[] = [];
    const tools = getMogrtAuthoringTools(bridgeOptions, {
      directoryExists: () => true,
      tokenFactory: () => "media-token",
      operationIdFactory: () => "operation-media",
      artifactStatus: () => ({ exists: true, size_bytes: 10, zip_header_valid: true }),
      send: async (script) => {
        scripts.push(script);
        return { success: true, data: { exposedControls: { media: true }, exposedControlNames: ["Media"] } };
      },
    });
    const preview = await tools.preview_mogrt_recipe.handler({
      recipe: "media_placeholder",
      template_name: "Logo Slot",
      placeholder_media_path: "D:/Approved/media/logo.png",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    });
    expect(preview).toMatchObject({
      success: true,
      data: { plan: { recipe: "media_placeholder", placeholder_media_path: "D:\\Approved\\media\\logo.png" } },
    });
    expect((preview.data.plan as { headline?: string }).headline).toBeUndefined();
    await expect(tools.create_mogrt_recipe.handler({ preview_token: "media-token", confirm_export: true }))
      .resolves.toMatchObject({ success: true, data: { exposedControlNames: ["Media"], operationId: "operation-media" } });
    const script = scripts[0];
    expect(script).toContain("mediaLayer.addToMotionGraphicsTemplateAs(comp, \"Media\")");
    expect(script).toContain("exposeTransform(mediaLayer, comp, \"Media\")");
    expect(script).toContain("The approved placeholder media no longer exists");
    expect(script).not.toContain("Accent bar");
    expect(script).not.toContain("headlineLayer");
  });

  it("validates media-placeholder paths before contacting After Effects", () => {
    const base = {
      recipe: "media_placeholder",
      template_name: "Slot",
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
    };
    expect(() => buildMogrtPlan(base, () => true)).toThrow("placeholder_media_path is required");
    expect(() => buildMogrtPlan({ ...base, placeholder_media_path: "D:/Approved/clip.exe" }, () => true)).toThrow("PNG, JPEG, MOV, or MP4");
    expect(() => buildMogrtPlan({ ...base, placeholder_media_path: "media/clip.mp4" }, () => true)).toThrow("absolute path");
    expect(() => buildMogrtPlan({ ...base, placeholder_media_path: "D:/Elsewhere/clip.mp4" }, () => true)).toThrow("inside approved_workspace_path");
    const captioned = buildMogrtPlan({ ...base, headline: "Caption", placeholder_media_path: "D:/Approved/clip.mov" }, () => true);
    const script = buildMogrtRecipeScript(captioned);
    expect(script).toContain("exposeTransform(headlineLayer, comp, \"Headline\")");
    expect(script).toContain("exposeTransform(mediaLayer, comp, \"Media\")");
  });
});
