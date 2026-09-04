import { describe, expect, it } from "vitest";
import { getMogrtAuthoringTools } from "../../src/tools/mogrt-authoring.js";

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
});
