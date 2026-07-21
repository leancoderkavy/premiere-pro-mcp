import { describe, expect, it, vi } from "vitest";
import { capabilityForTool, guardToolHandler, resolveCapabilities } from "../src/security/capabilities.js";

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
    expect(capabilityForTool("export_sequence")).toBe("export");
    expect(capabilityForTool("import_media")).toBe("filesystem");
  });
});
