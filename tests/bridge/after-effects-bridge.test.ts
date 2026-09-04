import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  AFTER_EFFECTS_BRIDGE_HELPERS,
  AFTER_EFFECTS_DEFAULT_TEMP_DIR_NAME,
  getAfterEffectsTempDir,
  sendAfterEffectsCommand,
} from "../../src/bridge/after-effects-bridge.js";

describe("After Effects bridge", () => {
  it("uses an independent bridge directory and AE-only helpers", async () => {
    expect(getAfterEffectsTempDir(undefined, "D:/Temp")).toBe(join("D:/Temp", AFTER_EFFECTS_DEFAULT_TEMP_DIR_NAME));
    await sendAfterEffectsCommand("return __aeResult({});", { tempDir: "D:/PremiereOnly" });
    expect(sendCommand).toHaveBeenCalledWith("return __aeResult({});", expect.objectContaining({
      tempDir: getAfterEffectsTempDir(),
      helpers: AFTER_EFFECTS_BRIDGE_HELPERS,
    }));
    expect(AFTER_EFFECTS_BRIDGE_HELPERS.source).toContain("__aeResult");
    expect(AFTER_EFFECTS_BRIDGE_HELPERS.source).not.toContain("__findSequence");
  });
});
