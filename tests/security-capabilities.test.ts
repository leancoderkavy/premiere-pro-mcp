import { describe, expect, it, vi } from "vitest";
import { capabilityForTool, guardToolHandler, isToolPermitted, resolveCapabilities } from "../src/security/capabilities.js";
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
    expect(capabilityForTool("capture_frame")).toBe("export");
    expect(capabilityForTool("validate_export_preset")).toBe("export");
    expect(capabilityForTool("verify_delivery_file")).toBe("filesystem");
    expect(capabilityForTool("import_media")).toBe("filesystem");
    expect(capabilityForTool("get_project_info")).toBe("inspect");
    expect(capabilityForTool("preview_transcript_edit_uxp")).toBe("inspect");
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
    expect(isToolPermitted("get_project_info", config)).toBe(true);
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
