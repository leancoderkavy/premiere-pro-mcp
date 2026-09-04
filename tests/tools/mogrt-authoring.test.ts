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
});
