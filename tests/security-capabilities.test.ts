import { describe, expect, it, vi } from "vitest";
import { capabilityForTool, guardToolHandler, resolveCapabilities } from "../src/security/capabilities.js";
import { buildPlatformCapabilityReport } from "../src/platform-capabilities.js";

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
    expect(capabilityForTool("import_media")).toBe("filesystem");
    expect(capabilityForTool("get_project_info")).toBe("inspect");
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
    expect(report.authority.disabled).toContain("unsafe-script");
  });

  it("does not claim Premiere host support on Linux", () => {
    const report = buildPlatformCapabilityReport(resolveCapabilities(undefined), "linux");
    expect(report.runtime.supported).toBe(false);
    expect(report.premiere.hostVerificationRequired).toBe(true);
  });
});
