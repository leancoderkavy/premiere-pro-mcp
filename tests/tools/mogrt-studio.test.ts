import { describe, expect, it } from "vitest";
import { getMogrtStudioTools } from "../../src/tools/mogrt-studio.js";

const bridgeOptions = { tempDir: "D:/PremiereBridge", timeoutMs: 5000 };
const artifact = { exists: true, size_bytes: 64, zip_header_valid: true };

describe("MOGRT studio tools", () => {
  it("validates a contained brand kit and serially creates a bounded JSON batch", async () => {
    const afterEffectsScripts: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("templates.json"),
      readText: () => JSON.stringify([
        { recipe: "title_card", template_name: "Brand Intro", headline: "Hello" },
        { recipe: "callout", template_name: "Brand Tip", headline: "Tip" },
      ]),
      artifactStatus: () => artifact,
      tokenFactory: (() => { const tokens = ["batch-preview", "unused"]; return () => tokens.shift() ?? "token"; })(),
      operationIdFactory: () => "operation-1",
      sendAfterEffects: async (script) => {
        afterEffectsScripts.push(script);
        return { success: true, data: { exportRequested: true } };
      },
    });

    await expect(tools.validate_mogrt_brand_kit.handler({
      approved_workspace_path: "D:/Approved",
      brand_kit: { name: "Brand", name_prefix: "Brand", font_family: "Inter", accent_color: "#112233", text_color: "#FFFFFF", safe_margin_percent: 0.12 },
    })).resolves.toMatchObject({ success: true, data: { brandKit: { name: "Brand", accent_color: "#112233", safe_margin_percent: 0.12 } } });

    const preview = await tools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/templates.json",
      brand_kit: { name: "Brand", name_prefix: "Brand", accent_color: "#112233", safe_margin_percent: 0.1 },
    });
    expect(preview).toMatchObject({ success: true, data: { previewToken: "batch-preview", plans: [{ recipe: "title_card", accent_color: "#112233" }, { recipe: "callout", accent_color: "#112233" }] } });

    await expect(tools.create_mogrt_batch.handler({ preview_token: "batch-preview", confirm_export: true })).resolves.toMatchObject({
      success: true,
      data: { completed: [{ templateName: "Brand Intro" }, { templateName: "Brand Tip" }], batchAtomic: false },
    });
    expect(afterEffectsScripts).toHaveLength(2);
    expect(afterEffectsScripts[0]).toContain('recipe: "title_card"');
    expect(afterEffectsScripts[1]).toContain('recipe: "callout"');
  });

  it("publishes only the previewed artifact to a new immutable local-library version", async () => {
    const copied: Array<[string, string]> = [];
    const directories: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate === "D:\\Approved\\templates\\Launch.mogrt",
      artifactStatus: () => artifact,
      tokenFactory: () => "library-preview",
      operationIdFactory: () => "operation-library",
      copyFile: (source, destination) => copied.push([source, destination]),
      makeDirectory: (candidate) => directories.push(candidate),
    });

    const preview = await tools.preview_mogrt_library_publish.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      library_directory: "D:/Approved/library",
      template_name: "Launch",
    });
    expect(preview).toMatchObject({ success: true, data: { previewToken: "library-preview", version: "v001" } });

    await expect(tools.publish_mogrt_to_library.handler({ preview_token: "library-preview", confirm_publish: true })).resolves.toMatchObject({
      success: true,
      data: { version: "v001", overwrite: false },
    });
    expect(directories[0]).toContain("v001");
    expect(copied[0]?.[1]).toContain("Launch.mogrt");
  });

  it("requires a disposable named Premiere target and reports import rather than visual verification", async () => {
    const premiereScripts: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      artifactStatus: () => artifact,
      tokenFactory: () => "handoff-preview",
      operationIdFactory: () => "operation-handoff",
      sendPremiere: async (script) => {
        premiereScripts.push(script);
        return { success: true, data: { imported: true, visualVerified: false, exposedControlDescriptors: [] } };
      },
    });

    const preview = await tools.preview_mogrt_premiere_handoff.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      sequence_id: "sequence-1",
      disposable_sequence_name: "MOGRT Verify - Launch",
    });
    expect(preview).toMatchObject({ success: true, data: { previewToken: "handoff-preview" } });
    await expect(tools.apply_mogrt_premiere_handoff.handler({ preview_token: "handoff-preview", confirm_import: true })).resolves.toMatchObject({
      success: true,
      data: { visualVerified: false },
    });
    expect(premiereScripts[0]).toContain("MOGRT Verify - Launch");
    expect(premiereScripts[0]).toContain("titleTrack.clips.numItems !== 0");
  });

  it("previews then queues an existing composition without starting a render", async () => {
    const scripts: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: () => false,
      tokenFactory: () => "render-preview",
      operationIdFactory: () => "operation-render",
      sendAfterEffects: async (script) => {
        scripts.push(script);
        return { success: true, data: { queued: true, renderStarted: false } };
      },
    });
    const preview = await tools.preview_after_effects_render.handler({
      approved_workspace_path: "D:/Approved",
      composition_name: "Launch",
      output_path: "D:/Approved/renders/Launch.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    });
    expect(preview).toMatchObject({ success: true, data: { previewToken: "render-preview" } });
    await expect(tools.enqueue_after_effects_render.handler({ preview_token: "render-preview", confirm_enqueue: true })).resolves.toMatchObject({ success: true, data: { renderStarted: false } });
    expect(scripts[0]).toContain("project.renderQueue.items.add(comp)");
    expect(scripts[0]).toContain("renderStarted: false");
  });

  it("uses AE controller-name readback only when the host exposes that API", async () => {
    const scripts: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      operationIdFactory: () => "operation-inspect",
      sendAfterEffects: async (script) => {
        scripts.push(script);
        return { success: true, data: { exposedControlsReadbackAvailable: true, exposedControlNames: ["Headline"] } };
      },
    });
    await expect(tools.inspect_after_effects_template_source.handler({ composition_name: "Launch" })).resolves.toMatchObject({
      success: true,
      data: { exposedControlsReadbackAvailable: true, exposedControlNames: ["Headline"] },
    });
    expect(scripts[0]).toContain("motionGraphicsTemplateControllerCount");
    expect(scripts[0]).toContain("getMotionGraphicsTemplateControllerName");
  });
});
