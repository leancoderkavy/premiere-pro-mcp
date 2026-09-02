import { describe, expect, it, vi } from "vitest";
import { capabilitiesForToolInvocation, capabilityForTool, guardToolHandler, isToolPermitted, resolveCapabilities } from "../src/security/capabilities.js";
import { buildPlatformCapabilityReport } from "../src/platform-capabilities.js";
import {
  buildToolCapabilityReport,
  deriveToolOperationalCapability,
} from "../src/tool-capability-report.js";

describe("capability profiles", () => {
  it("fails closed for unsafe scripting by default", async () => {
    const handler = vi.fn(async () => "ok");
    const guarded = guardToolHandler("execute_extendscript", handler, resolveCapabilities(undefined), () => "op-1");
    await expect(guarded({})).rejects.toMatchObject({ code: "CAPABILITY_DENIED", operationId: "op-1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("permits unsafe scripting only when explicitly enabled", async () => {
    const handler = vi.fn(async () => "ok");
    const guarded = guardToolHandler("send_raw_script", handler, resolveCapabilities("inspect,unsafe-script"));
    await expect(guarded({})).resolves.toBe("ok");
  });

  it("rejects unknown capabilities instead of silently widening access", () => {
    expect(() => resolveCapabilities("inspect,admin")).toThrow("Unknown Premiere MCP capability");
  });

  it("classifies sensitive tools", () => {
    expect(capabilityForTool("execute_extendscript")).toBe("unsafe-script");
    expect(capabilityForTool("evaluate_expression")).toBe("unsafe-script");
    expect(capabilityForTool("export_sequence")).toBe("export");
    expect(capabilityForTool("export_sequence_review_frames")).toBe("export");
    expect(capabilityForTool("export_sequence_marker_review_frames")).toBe("export");
    expect(capabilityForTool("capture_frame")).toBe("export");
    expect(capabilityForTool("validate_export_preset")).toBe("export");
    expect(capabilityForTool("verify_delivery_file")).toBe("filesystem");
    expect(capabilityForTool("verify_delivery_conformance")).toBe("filesystem");
    expect(capabilityForTool("create_project_backup")).toBe("filesystem");
    expect(capabilityForTool("analyze_loudness")).toBe("filesystem");
    expect(capabilityForTool("detect_beats")).toBe("filesystem");
    expect(capabilityForTool("detect_motion_peaks")).toBe("filesystem");
    expect(capabilityForTool("read_video_scopes")).toBe("filesystem");
    expect(capabilityForTool("plan_shot_match")).toBe("filesystem");
    expect(capabilityForTool("analyze_video_qc")).toBe("filesystem");
    expect(capabilityForTool("detect_source_scene_changes")).toBe("filesystem");
    expect(capabilityForTool("normalize_loudness_file")).toBe("filesystem");
    expect(capabilityForTool("import_media")).toBe("filesystem");
    expect(capabilityForTool("manage_proxy_ingest_uxp")).toBe("edit");
    expect(capabilityForTool("audition_source_monitor_uxp")).toBe("edit");
    expect(capabilityForTool("relink_offline_media_uxp")).toBe("filesystem");
    expect(capabilityForTool("import_project_media_uxp")).toBe("filesystem");
    expect(capabilityForTool("edit_timeline_uxp")).toBe("edit");
    expect(capabilityForTool("encode_media_uxp")).toBe("export");
    expect(capabilityForTool("inspect_project_selection_uxp")).toBe("inspect");
    expect(capabilityForTool("manage_markers_uxp")).toBe("edit");
    expect(capabilityForTool("get_project_info")).toBe("inspect");
    expect(capabilityForTool("preview_transcript_edit_uxp")).toBe("inspect");
    expect(capabilityForTool("plan_transcript_rough_cut_uxp")).toBe("inspect");
    expect(capabilityForTool("create_context_edit_plan")).toBe("inspect");
    expect(capabilityForTool("search_project_context")).toBe("inspect");
    expect(capabilityForTool("ping")).toBe("inspect");
    expect(capabilityForTool("trim_clip")).toBe("edit");
  });

  it("enforces inspect and edit profiles instead of only guarding unsafe tools", async () => {
    const handler = vi.fn(async () => "ok");
    await expect(
      guardToolHandler("get_project_info", handler, resolveCapabilities("edit"), () => "inspect-1")({}),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "inspect" });
    await expect(
      guardToolHandler("trim_clip", handler, resolveCapabilities("inspect"), () => "edit-1")({}),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("enforces every capability required by consolidated UXP actions", async () => {
    const handler = vi.fn(async () => "ok");
    expect(capabilitiesForToolInvocation("manage_proxy_ingest_uxp", { action: "attach_proxy" }))
      .toEqual(["edit", "filesystem"]);
    expect(capabilitiesForToolInvocation("manage_proxy_ingest_uxp", { action: "inspect_proxy" }))
      .toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("manage_project_context", { action: "capture" }))
      .toEqual(["inspect", "filesystem"]);
    expect(capabilitiesForToolInvocation("manage_project_context", { action: "status" }))
      .toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("manage_project_context", { action: "clear" }))
      .toEqual(["filesystem"]);

    await expect(
      guardToolHandler("manage_proxy_ingest_uxp", handler, resolveCapabilities("filesystem"), () => "proxy-edit")({ action: "set_ingest" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit", operationId: "proxy-edit" });
    await expect(
      guardToolHandler("manage_proxy_ingest_uxp", handler, resolveCapabilities("edit"), () => "proxy-file")({ action: "attach_proxy" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "filesystem", operationId: "proxy-file" });
    await expect(
      guardToolHandler("audition_source_monitor_uxp", handler, resolveCapabilities("filesystem"), () => "monitor-edit")({ action: "play" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit" });
    await expect(
      guardToolHandler("edit_timeline_uxp", handler, resolveCapabilities("filesystem"), () => "timeline-edit")({ action: "insert" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("lists sequence-range inspection for inspect authority but requires edit to update", async () => {
    const handler = vi.fn(async () => "ok");
    const inspectOnly = resolveCapabilities("inspect");
    expect(isToolPermitted("manage_sequence_range_uxp", inspectOnly)).toBe(true);
    expect(capabilitiesForToolInvocation("manage_sequence_range_uxp", { action: "inspect" })).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("manage_sequence_range_uxp", { action: "update" })).toEqual(["edit"]);

    await expect(
      guardToolHandler("manage_sequence_range_uxp", handler, inspectOnly, () => "range-inspect")({ action: "inspect" }),
    ).resolves.toBe("ok");
    await expect(
      guardToolHandler("manage_sequence_range_uxp", handler, inspectOnly, () => "range-update")({ action: "update" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit", operationId: "range-update" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["manage_clip_effects_uxp", "catalog"],
    ["batch_selected_clips_uxp", "inspect"],
    ["manage_timeline_selection_uxp", "inspect"],
    ["manage_timeline_selection_uxp", "inspect_targets"],
    ["manage_proxy_ingest_uxp", "inspect_proxy"],
    ["manage_metadata_uxp", "get"],
    ["manage_color_conformance_uxp", "preflight"],
    ["audition_source_monitor_uxp", "state"],
    ["preflight_production_storage_uxp", "preflight"],
    ["inspect_project_selection_uxp", "views"],
    ["manage_markers_uxp", "inspect"],
    ["organize_project_items_uxp", "inspect_bin"],
    ["manage_sequence_settings_uxp", "get"],
    ["manage_sequence_range_uxp", "inspect"],
    ["automate_effect_parameters_uxp", "inspect"],
    ["transform_track_item_uxp", "inspect"],
    ["manage_sequences_uxp", "inspect"],
    ["encode_media_uxp", "preflight"],
  ])("keeps %s:%s available to inspect-only profiles", (toolName, action) => {
    expect(capabilitiesForToolInvocation(toolName, { action })).toEqual(["inspect"]);
    expect(isToolPermitted(toolName, resolveCapabilities("inspect"))).toBe(true);
  });

  it.each([
    ["manage_clip_effects_uxp", "add", ["edit"]],
    ["batch_selected_clips_uxp", "remove_effect", ["edit"]],
    ["manage_timeline_selection_uxp", "replace", ["edit"]],
    ["manage_timeline_selection_uxp", "clear", ["edit"]],
    ["manage_metadata_uxp", "update", ["edit"]],
    ["manage_color_conformance_uxp", "update", ["edit"]],
    ["preflight_production_storage_uxp", "configure_project", ["edit"]],
    ["manage_markers_uxp", "remove", ["edit"]],
    ["organize_project_items_uxp", "move", ["edit"]],
    ["manage_sequence_settings_uxp", "update", ["edit"]],
    ["manage_sequence_range_uxp", "update", ["edit"]],
    ["import_project_media_uxp", "files", ["edit", "filesystem"]],
    ["automate_effect_parameters_uxp", "add_keyframe", ["edit"]],
    ["transform_track_item_uxp", "update", ["edit"]],
    ["manage_sequences_uxp", "delete", ["edit"]],
    ["encode_media_uxp", "sequence", ["export", "filesystem"]],
  ] as const)("requires exact mutation authority for %s:%s", (toolName, action, required) => {
    expect(capabilitiesForToolInvocation(toolName, { action })).toEqual(required);
  });

  it("requires filesystem authority only for preset-based encoder preflight", async () => {
    expect(capabilitiesForToolInvocation("encode_media_uxp", { action: "preflight" }))
      .toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("encode_media_uxp", { action: "preflight", preset_file: "D:/Approved/h264.epr" }))
      .toEqual(["inspect", "filesystem"]);

    const handler = vi.fn(async () => "ok");
    await expect(
      guardToolHandler("encode_media_uxp", handler, resolveCapabilities("inspect"), () => "preset-preflight")({
        action: "preflight", preset_file: "D:/Approved/h264.epr",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "filesystem", operationId: "preset-preflight" });
    await expect(
      guardToolHandler("encode_media_uxp", handler, resolveCapabilities("inspect"))({ action: "preflight" }),
    ).resolves.toBe("ok");
  });

  it.each([
    ["darwin", "macOS"],
    ["win32", "Windows"],
  ] as const)("reports static compatibility for %s", (platform, name) => {
    const report = buildPlatformCapabilityReport(
      resolveCapabilities("inspect,edit,export,filesystem"),
      platform,
      platform === "win32" ? "C:\\Temp\\premiere-mcp-bridge" : "/tmp/premiere-mcp-bridge",
    );
    expect(report.runtime).toMatchObject({ platform, platformName: name, supported: true });
    expect(report.backends.cep.platforms).toEqual(["macOS", "Windows"]);
    expect(report.backends.uxp.hostVerificationRequired).toBe(true);
    expect(report.backends.uxp.commands).toContain("operation.cancel");
    expect(report.backends.uxp.commands).toContain("markers.addBeatGrid");
    expect(report.backends.uxp.events).toContain("premiere.state.changed");
    expect(report.backends.uxp.operationSemantics.atomicRollback).toBe(false);
    expect(report.authority.disabled).toContain("unsafe-script");
  });

  it("does not claim Premiere host support on Linux", () => {
    const report = buildPlatformCapabilityReport(resolveCapabilities(undefined), "linux");
    expect(report.runtime.supported).toBe(false);
    expect(report.premiere.hostVerificationRequired).toBe(true);
  });

  it("derives tool operational metadata from catalog definitions and authority", () => {
    const capabilities = resolveCapabilities("inspect");
    const qeTool = deriveToolOperationalCapability(
      "ripple_delete",
      { description: "Ripple delete a clip. Uses QE DOM." },
      capabilities,
    );
    expect(qeTool).toMatchObject({
      backend: "CEP/ExtendScript + QE",
      backends: ["cep", "extendscript", "qe"],
      status: "experimental",
      minimumPremiereVersion: "2020 (QE availability varies by build)",
      authority: { required: "edit", enabled: false },
      verificationBoundary: "bridge_response",
      hostVerificationRequired: true,
    });
    expect(qeTool.notes).toContain(
      "Disabled by the current 'environment' authority profile.",
    );
  });

  it("reports local discovery separately from live-host verification", () => {
    const tool = deriveToolOperationalCapability(
      "get_capabilities",
      { description: "Report static capabilities." },
      resolveCapabilities(undefined),
    );
    expect(tool).toMatchObject({
      backend: "local",
      backends: ["local"],
      status: "supported",
      minimumPremiereVersion: null,
      verificationBoundary: "static_metadata_only",
      hostVerificationRequired: false,
    });

  });

  it("classifies caption inventory with its UXP backend and baseline", () => {
    const tool = deriveToolOperationalCapability(
      "inspect_caption_tracks_uxp",
      { description: "Inventory native caption tracks on the active sequence." },
      resolveCapabilities("inspect"),
    );
    expect(tool).toMatchObject({
      backend: "UXP",
      backends: ["uxp"],
      minimumPremiereVersion: "25.6",
      authority: { required: "inspect", enabled: true },
      verificationBoundary: "host_response",
      hostVerificationRequired: true,
    });
    expect(tool.notes).toEqual([
      "Runs through the authenticated local UXP bridge using Premiere UXP APIs.",
    ]);
  });

  it("does not infer QE usage from a UXP tool description that rejects QE", () => {
    const tool = deriveToolOperationalCapability(
      "edit_timeline_uxp",
      { description: "Edit through documented UXP APIs without undocumented QE calls." },
      resolveCapabilities("edit"),
    );
    expect(tool).toMatchObject({
      backend: "UXP",
      backends: ["uxp"],
      status: "supported",
      minimumPremiereVersion: "25.6",
    });
    expect(tool.notes).not.toEqual(expect.arrayContaining([
      expect.stringContaining("undocumented QE DOM"),
    ]));
  });

  it("represents authenticated UXP-only tool metadata without a CEP fallback claim", () => {
    const tool = deriveToolOperationalCapability(
      "inspect_caption_tracks_uxp",
      {
        description: "Inspect native caption tracks.",
        operationalCapability: {
          backend: "UXP",
          backends: ["uxp"],
          minimumPremiereVersion: "25.6",
          verificationBoundary: "structured_uxp_readback",
          hostVerificationRequired: true,
        },
      },
      resolveCapabilities("inspect"),
    );
    expect(tool).toMatchObject({
      backend: "UXP",
      backends: ["uxp"],
      minimumPremiereVersion: "25.6",
      verificationBoundary: "structured_uxp_readback",
      hostVerificationRequired: true,
    });
  });

  it("builds a deterministic summary from the registered catalog", () => {
    const report = buildToolCapabilityReport(
      {
        trim_clip: { description: "Trim a clip." },
        get_project_info: { description: "Read the project." },
        add_transition: { description: "Add a transition. Uses QE DOM." },
      },
      resolveCapabilities("inspect,edit"),
    );
    expect(report.generatedFrom).toBe("registered-tool-catalog");
    expect(report.total).toBe(3);
    expect(report.byStatus).toEqual({
      supported: 2,
      limited: 0,
      experimental: 1,
      unsupported: 0,
    });
    expect(report.tools.map((tool) => tool.name)).toEqual([
      "add_transition",
      "get_project_info",
      "trim_clip",
    ]);
  });

  it.each([
    [
      "verify_delivery_file",
      "Verify a delivery file and calculate its checksum.",
      {
        backend: "local",
        backends: ["local"],
        authority: { required: "filesystem", enabled: true },
        verificationBoundary: "local_filesystem",
        hostVerificationRequired: false,
        minimumPremiereVersion: null,
      },
    ],
    [
      "get_advanced_feature_support",
      "Report collaboration and AI feature support.",
      {
        backend: "local",
        backends: ["local"],
        authority: { required: "inspect", enabled: true },
        verificationBoundary: "static_metadata_only",
        hostVerificationRequired: false,
        minimumPremiereVersion: null,
      },
    ],
    [
      "preview_editorial_plan",
      "Revalidate an editorial plan against saved project context.",
      {
        backend: "local",
        backends: ["local"],
        authority: { required: "inspect", enabled: true },
        verificationBoundary: "plan_revalidation",
        hostVerificationRequired: false,
        minimumPremiereVersion: null,
      },
    ],
    [
      "validate_export_preset",
      "Validate an export preset and resolve its output extension.",
      {
        backend: "local + CEP/ExtendScript",
        backends: ["local", "cep", "extendscript"],
        authority: { required: "export", enabled: true },
        verificationBoundary: "local_and_host_response",
        hostVerificationRequired: true,
        minimumPremiereVersion: "2020",
      },
    ],
  ])("reports QA-forward boundaries for %s", (name, description, expected) => {
    const tool = deriveToolOperationalCapability(
      name,
      { description },
      resolveCapabilities("inspect,export,filesystem"),
    );
    expect(tool).toMatchObject({ name, status: "supported", ...expected });
  });

  it("lets registration metadata override catalog defaults", () => {
    const tool = deriveToolOperationalCapability(
      "verify_delivery_file",
      {
        description: "Future host-backed delivery verification.",
        operationalCapability: {
          backend: "local + CEP/ExtendScript",
          backends: ["local", "cep", "extendscript"],
          minimumPremiereVersion: "26.0",
          hostVerificationRequired: true,
          verificationBoundary: "local_and_host_response",
          notes: ["Explicit registration metadata."],
        },
      },
      resolveCapabilities("filesystem"),
    );
    expect(tool).toMatchObject({
      backend: "local + CEP/ExtendScript",
      backends: ["local", "cep", "extendscript"],
      minimumPremiereVersion: "26.0",
      hostVerificationRequired: true,
      verificationBoundary: "local_and_host_response",
      notes: ["Explicit registration metadata."],
    });
  });
});

describe("isToolPermitted", () => {
  it("withholds unsafe-script tools under the default profile", () => {
    const config = resolveCapabilities(undefined);
    expect(isToolPermitted("execute_extendscript", config)).toBe(false);
    expect(isToolPermitted("evaluate_expression", config)).toBe(false);
    expect(isToolPermitted("send_raw_script", config)).toBe(false);
  });

  it("permits unsafe-script tools once the authority is named", () => {
    const config = resolveCapabilities("inspect,edit,export,filesystem,unsafe-script");
    expect(isToolPermitted("execute_extendscript", config)).toBe(true);
    expect(isToolPermitted("evaluate_expression", config)).toBe(true);
  });

  it("permits ordinary edit tools under the default profile", () => {
    const config = resolveCapabilities(undefined);
    expect(isToolPermitted("trim_clip", config)).toBe(true);
    expect(isToolPermitted("get_project_info", config)).toBe(true);
    expect(isToolPermitted("export_sequence", config)).toBe(true);
  });

  it("withholds edit and export tools under an inspect-only profile", () => {
    const config = resolveCapabilities("inspect");
    expect(isToolPermitted("trim_clip", config)).toBe(false);
    expect(isToolPermitted("export_sequence", config)).toBe(false);
    expect(isToolPermitted("import_media", config)).toBe(false);
    expect(isToolPermitted("verify_delivery_conformance", config)).toBe(false);
    expect(isToolPermitted("get_project_info", config)).toBe(true);
    expect(isToolPermitted("manage_proxy_ingest_uxp", config)).toBe(true);
    expect(isToolPermitted("audition_source_monitor_uxp", config)).toBe(true);
    expect(isToolPermitted("edit_timeline_uxp", config)).toBe(false);
  });

  it("permits delivery conformance verification only with filesystem authority", () => {
    expect(isToolPermitted("verify_delivery_conformance", resolveCapabilities("inspect"))).toBe(false);
    expect(isToolPermitted("verify_delivery_conformance", resolveCapabilities("filesystem"))).toBe(true);
  });

  it("always advertises the diagnostic tools, even under a profile that excludes inspect", () => {
    // Without this, a too-narrow profile leaves no supported way to ask the
    // server which authority it actually has.
    const config = resolveCapabilities("export");
    expect(isToolPermitted("get_capabilities", config)).toBe(true);
    expect(isToolPermitted("ping", config)).toBe(true);
    expect(isToolPermitted("get_project_info", config)).toBe(false);
  });

  it("agrees with capabilityForTool for every capability in the profile", () => {
    const config = resolveCapabilities("edit");
    expect(capabilityForTool("trim_clip")).toBe("edit");
    expect(isToolPermitted("trim_clip", config)).toBe(true);
  });
});
