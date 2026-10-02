import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

beforeEach(() => vi.clearAllMocks());

describe("undo counts never span a project switch (#654 review)", () => {
  it.each([
    ["open_project", { path: "/Projects/B.prproj" }, "app.openDocument("],
    ["create_project", { path: "/Projects/New.prproj" }, "app.newProject("],
    ["close_project", {}, "closeDocument("],
  ])("%s clears the undo start before switching", async (name, args, call) => {
    const tools = getProjectTools(bridgeOptions) as Record<string, { handler: (a: never) => Promise<unknown> }>;
    await tools[name].handler(args as never);
    const script = String(mockedSendCommand.mock.calls[0]?.[0] ?? "");
    expect(script).toContain(call);
    const reset = script.lastIndexOf("__undoStart = null;", script.indexOf(call));
    expect(reset).toBeGreaterThan(-1);
  });
});

describe("undo descriptions do not overclaim", () => {
  it("scope undoSteps to CEP results and recommend the stack guard", () => {
    const undo = getProjectTools(bridgeOptions).undo.description;
    const multiple = getTrackTargetingTools(bridgeOptions).multiple_undo.description;
    for (const description of [undo, multiple]) {
      expect(description).toContain("Only CEP tool results carry undoSteps");
      expect(description).toContain("Always pass expected_undo_stack_index");
      expect(description).toContain("undoTracked:false");
      expect(description).not.toContain("added nothing to the undo history");
    }
  });
});
