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

  it("rejects unsafe batch input and returns partial progress without promising rollback", async () => {
    const sent: string[] = [];
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("batch.json"),
      readText: () => JSON.stringify([
        { recipe: "title_card", template_name: "First", headline: "One" },
        { recipe: "quote_card", template_name: "Second", headline: "Two" },
      ]),
      tokenFactory: () => "batch-token",
      operationIdFactory: () => "operation-batch-failure",
      artifactStatus: () => artifact,
      sendAfterEffects: async (script) => {
        sent.push(script);
        return sent.length === 1
          ? { success: true, data: { exportRequested: true } }
          : { success: false, error: "After Effects refused the second export" };
      },
    });

    await expect(tools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/batch.txt",
    })).rejects.toThrow(".json or .csv");
    await expect(tools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/missing.json",
    })).rejects.toThrow("does not exist");

    await tools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/batch.json",
    });
    await expect(tools.create_mogrt_batch.handler({ preview_token: "batch-token", confirm_export: false })).rejects.toThrow("confirm_export must be true");
    await expect(tools.create_mogrt_batch.handler({ preview_token: "batch-token", confirm_export: true })).resolves.toMatchObject({
      success: false,
      data: { completed: [{ templateName: "First" }], failedTemplate: "Second", batchAtomic: false },
    });
    await expect(tools.create_mogrt_batch.handler({ preview_token: "batch-token", confirm_export: true })).rejects.toThrow("already used");
  });

  it("parses bounded CSV batches and rejects duplicate output artifacts", async () => {
    const csvTools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("batch.csv"),
      readText: () => "recipe,template_name,headline,duration_seconds\nquote_card,Quote,Hello,7\n",
      tokenFactory: () => "csv-preview",
      operationIdFactory: () => "operation-csv",
    });
    await expect(csvTools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/batch.csv",
    })).resolves.toMatchObject({ success: true, data: { plans: [{ recipe: "quote_card", duration_seconds: 7 }] } });

    const duplicateTools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("duplicate.json"),
      readText: () => JSON.stringify([
        { template_name: "Same", headline: "One" },
        { template_name: "Same", headline: "Two" },
      ]),
    });
    await expect(duplicateTools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/duplicate.json",
    })).rejects.toThrow("unique template_name");
  });

  it("keeps library publishing immutable when the source or destination changes", async () => {
    let sourceIsValid = true;
    let destinationExists = false;
    const tokens = ["library-one", "library-two"];
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate === "D:\\Approved\\templates\\Launch.mogrt" || destinationExists,
      artifactStatus: () => ({ ...artifact, zip_header_valid: sourceIsValid }),
      tokenFactory: () => tokens.shift() ?? "library-extra",
      operationIdFactory: () => "operation-library-race",
    });
    const request = {
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      library_directory: "D:/Approved/library",
      template_name: "Launch",
    };
    await tools.preview_mogrt_library_publish.handler(request);
    sourceIsValid = false;
    await expect(tools.publish_mogrt_to_library.handler({ preview_token: "library-one", confirm_publish: true })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no longer a recognizable ZIP"),
    });

    sourceIsValid = true;
    await tools.preview_mogrt_library_publish.handler(request);
    destinationExists = true;
    await expect(tools.publish_mogrt_to_library.handler({ preview_token: "library-two", confirm_publish: true })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("destination now exists"),
    });
  });

  it("lists an existing library but never treats a missing root as a publishable target", async () => {
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: (candidate) => !candidate.endsWith("missing") && !candidate.endsWith("Flat"),
      listDirectory: (candidate) => candidate.endsWith("library") ? ["Launch", "Flat"] : ["v001", "notes", "v002"],
      operationIdFactory: () => "operation-library-inspect",
    });
    await expect(tools.inspect_mogrt_library.handler({
      approved_workspace_path: "D:/Approved",
      library_directory: "D:/Approved/missing",
    })).resolves.toMatchObject({ success: false, error: "library_directory does not exist" });
    await expect(tools.inspect_mogrt_library.handler({
      approved_workspace_path: "D:/Approved",
      library_directory: "D:/Approved/library",
    })).resolves.toMatchObject({ success: true, data: { templates: [{ name: "Launch", versions: ["v001", "v002"] }, { name: "Flat", versions: [] }] } });
  });

  it("requires confirmation and reports host failures for render enqueueing", async () => {
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: () => false,
      tokenFactory: () => "render-token",
      operationIdFactory: () => "operation-render-failure",
      sendAfterEffects: async () => ({ success: false, error: "No matching composition" }),
    });
    const request = {
      approved_workspace_path: "D:/Approved",
      composition_name: "Launch",
      output_path: "D:/Approved/renders/Launch.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    };
    await tools.preview_after_effects_render.handler(request);
    await expect(tools.enqueue_after_effects_render.handler({ preview_token: "render-token", confirm_enqueue: false })).rejects.toThrow("confirm_enqueue must be true");
    await expect(tools.enqueue_after_effects_render.handler({ preview_token: "render-token", confirm_enqueue: true })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("No matching composition"),
    });
  });

  it("fails closed when a handoff artifact changes or the disposable target is invalid", async () => {
    let artifactIsValid = true;
    const tools = getMogrtStudioTools(bridgeOptions, {
      artifactStatus: () => ({ ...artifact, zip_header_valid: artifactIsValid }),
      tokenFactory: () => "handoff-token",
      operationIdFactory: () => "operation-handoff-failure",
    });
    const base = {
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      sequence_id: "sequence-1",
    };
    await expect(tools.preview_mogrt_premiere_handoff.handler({ ...base, disposable_sequence_name: "Launch" })).rejects.toThrow("must begin");
    await tools.preview_mogrt_premiere_handoff.handler({ ...base, disposable_sequence_name: "MOGRT Verify - Launch" });
    await expect(tools.apply_mogrt_premiere_handoff.handler({ preview_token: "handoff-token", confirm_import: false })).rejects.toThrow("confirm_import must be true");
    artifactIsValid = false;
    await expect(tools.apply_mogrt_premiere_handoff.handler({ preview_token: "handoff-token", confirm_import: true })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no longer a recognizable ZIP"),
    });
  });

  it("preserves inspection failure boundaries without creating render queue items", async () => {
    const tools = getMogrtStudioTools(bridgeOptions, {
      operationIdFactory: () => "operation-inspection-failure",
      sendAfterEffects: async () => ({ success: false, error: "No open After Effects project" }),
    });
    await expect(tools.inspect_after_effects_template_source.handler({ composition_name: "Launch" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("No open After Effects project"),
    });
    await expect(tools.inspect_after_effects_render_templates.handler()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("No open After Effects project"),
    });
  });

  it("rejects malformed batch files and accepts escaped CSV values without changing a project", async () => {
    const preview = (contents: string) => getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("rows.csv"),
      readText: () => contents,
      tokenFactory: () => "csv-token",
    }).preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/rows.csv",
    });

    await expect(preview("recipe,template_name,headline\r\nquote_card,Quote,\"Hello, \"\"world\"\"\"\r\n")).resolves.toMatchObject({
      success: true,
      data: { plans: [{ headline: "Hello, \"world\"" }] },
    });
    await expect(preview("recipe,unsupported\nquote_card,nope\n")).rejects.toThrow("unsupported column");
    await expect(preview("recipe,template_name,headline\n\"quote_card,Quote,broken")).rejects.toThrow("unterminated quoted field");
    await expect(preview("recipe,template_name,headline\n")).rejects.toThrow("header row and at least one template row");
  });

  it("rejects malformed arguments, cross-format paths, and out-of-range handoff coordinates", async () => {
    const tools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("rows.json"),
      readText: () => "{}",
      artifactStatus: () => artifact,
    });
    await expect(tools.preview_mogrt_batch.handler(null)).rejects.toThrow("arguments must be an object");
    await expect(tools.preview_mogrt_batch.handler({
      approved_workspace_path: "relative",
      output_directory: "relative/templates",
      data_file_path: "relative/rows.json",
    })).rejects.toThrow("Path must be absolute");
    await expect(tools.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "/Approved/data/rows.json",
    })).rejects.toThrow("same path format");

    const handoff = {
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      sequence_id: "sequence-1",
      disposable_sequence_name: "MOGRT Verify - Launch",
    };
    await expect(tools.preview_mogrt_premiere_handoff.handler({ ...handoff, mogrt_path: "D:/Approved/templates/Launch.txt" })).rejects.toThrow("must end in .mogrt");
    await expect(tools.preview_mogrt_premiere_handoff.handler({ ...handoff, video_track_index: 1.5 })).rejects.toThrow("must be an integer");
    await expect(tools.preview_mogrt_premiere_handoff.handler({ ...handoff, start_seconds: -1 })).rejects.toThrow("must be a finite number");
  });

  it("rejects missing render and library roots before issuing a confirmation token", async () => {
    const renderTools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => false,
      fileExists: () => false,
    });
    await expect(renderTools.preview_after_effects_render.handler({
      approved_workspace_path: "D:/Approved",
      composition_name: "Launch",
      output_path: "D:/Approved/renders/Launch.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    })).rejects.toThrow("parent directory must already exist");

    const libraryTools = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => false,
      fileExists: (candidate) => candidate === "D:\\Approved\\templates\\Launch.mogrt",
      artifactStatus: () => artifact,
    });
    await expect(libraryTools.preview_mogrt_library_publish.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      library_directory: "D:/Approved/library",
      template_name: "Launch",
    })).rejects.toThrow("will not create a new library root");
  });

  it("returns host errors after consuming only a valid Premiere handoff preview", async () => {
    const tools = getMogrtStudioTools(bridgeOptions, {
      artifactStatus: () => artifact,
      tokenFactory: () => "handoff-host-error",
      operationIdFactory: () => "operation-handoff-host-error",
      sendPremiere: async () => ({ success: false, error: "The verification track is occupied" }),
      sendAfterEffects: async () => ({ success: true, data: { readOnly: true } }),
    });
    await expect(tools.inspect_after_effects_template_source.handler()).resolves.toMatchObject({ success: true, data: { readOnly: true } });
    await expect(tools.inspect_after_effects_render_templates.handler()).resolves.toMatchObject({ success: true, data: { readOnly: true } });
    await tools.preview_mogrt_premiere_handoff.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Launch.mogrt",
      sequence_id: "sequence-1",
      disposable_sequence_name: "MOGRT Verify - Launch",
      video_track_index: 2,
      audio_track_index: 1,
      start_seconds: 12.5,
    });
    await expect(tools.apply_mogrt_premiere_handoff.handler({ preview_token: "handoff-host-error", confirm_import: true })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("verification track is occupied"),
    });
  });

  it("rejects malformed authoring boundaries and expires abandoned render previews", async () => {
    const guarded = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: (candidate) => candidate.endsWith("logo.png") || candidate.endsWith("Existing.mov"),
      readText: () => "[]",
      artifactStatus: () => ({ exists: false, size_bytes: null, zip_header_valid: false }),
    });
    await expect(guarded.validate_mogrt_brand_kit.handler({
      approved_workspace_path: "D:/Approved",
      brand_kit: { name: "Brand", logo_path: "D:/Approved/logo.png" },
    })).resolves.toMatchObject({ success: true, data: { logoPathExists: true } });
    await expect(guarded.preview_mogrt_batch.handler({
      approved_workspace_path: "D:/Approved",
      output_directory: "D:/Approved/templates",
      data_file_path: "D:/Approved/data/rows.json",
      unsupported: true,
    })).rejects.toThrow("unsupported field");
    await expect(guarded.preview_after_effects_render.handler({
      approved_workspace_path: "D:/Approved",
      composition_name: "Bad.",
      output_path: "D:/Approved/renders/New.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    })).rejects.toThrow("composition_name must use");
    await expect(guarded.preview_after_effects_render.handler({
      approved_workspace_path: "D:/Approved",
      composition_name: "Existing",
      output_path: "D:/Approved/renders/Existing.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    })).rejects.toThrow("already exists");
    await expect(guarded.preview_mogrt_premiere_handoff.handler({
      approved_workspace_path: "D:/Approved",
      mogrt_path: "D:/Approved/templates/Invalid.mogrt",
      sequence_id: "sequence-1",
      disposable_sequence_name: "MOGRT Verify - Invalid",
    })).rejects.toThrow("must exist and have a ZIP header");

    let now = 0;
    const expiring = getMogrtStudioTools(bridgeOptions, {
      directoryExists: () => true,
      fileExists: () => false,
      tokenFactory: () => "expired-render",
      now: () => now,
    });
    await expiring.preview_after_effects_render.handler({
      approved_workspace_path: "D:/Approved",
      composition_name: "Launch",
      output_path: "D:/Approved/renders/Launch.mov",
      render_settings_template: "Best Settings",
      output_module_template: "Lossless",
    });
    now = 600_000;
    await expect(expiring.enqueue_after_effects_render.handler({ preview_token: "expired-render", confirm_enqueue: true })).rejects.toThrow("expired");
  });
});
