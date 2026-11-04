import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTools } from "../src/server.js";
import { resolveCapabilities } from "../src/security/capabilities.js";
import type { UxpWebSocketBridge } from "../src/bridge/uxp-websocket-bridge.js";
import { sendCommand } from "../src/bridge/file-bridge.js";

vi.mock("../src/bridge/file-bridge.js", async (original) => ({
  ...await original<typeof import("../src/bridge/file-bridge.js")>(),
  sendCommand: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function bridge() {
  return {
    request: vi.fn().mockRejectedValue(new Error("mutation outcome unknown")),
    getState: () => ({ status: "connected", connected: true }),
  };
}
function tools(native: ReturnType<typeof bridge>, mode?: "auto" | "cep") {
  return collectTools({}, resolveCapabilities(), native as unknown as UxpWebSocketBridge,
    undefined, undefined, undefined, undefined, mode);
}

describe("server bridge mode", () => {
  it("keeps force-CEP catalogs separate from automatic UXP catalogs", async () => {
    const native = bridge();
    expect(tools(native, "auto")).toHaveProperty("copy_clips_between_sequences_uxp");
    const cep = tools(native, "cep");
    expect(cep).not.toHaveProperty("copy_clips_between_sequences_uxp");
    await expect(cep.detect_scene_edits.handler({ mode: "apply_cuts", confirm_non_undoable: true }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("requires an authenticated Premiere UXP bridge") });
    expect(native.request).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
    expect(tools(native, "auto")).toHaveProperty("copy_clips_between_sequences_uxp");
  });

  it("honors the environment when a library or HTTP caller supplies no mode override", () => {
    vi.stubEnv("PREMIERE_BRIDGE_MODE", "cep");
    expect(tools(bridge())).not.toHaveProperty("copy_clips_between_sequences_uxp");
    expect(tools(bridge(), "auto")).toHaveProperty("copy_clips_between_sequences_uxp");
  });

  it("does not dispatch CEP after a connected UXP mutation fails", async () => {
    const native = bridge();
    await expect(tools(native, "auto").detect_scene_edits.handler({ mode: "apply_cuts", confirm_non_undoable: true }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("mutation outcome unknown") });
    expect(native.request).toHaveBeenCalledOnce();
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
