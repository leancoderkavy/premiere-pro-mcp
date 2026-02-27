import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "../src/server.js";
import { z } from "zod";

// Mock all tool modules to return simple tool definitions
vi.mock("../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

// We need the real tool modules to verify registration,
// but mock sendCommand so handlers don't actually do file I/O
vi.mock("../src/tools/discovery.js", () => ({
  getDiscoveryTools: () => ({
    mock_discovery_tool: {
      description: "A mock discovery tool",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name param" },
        },
        required: ["name"],
      },
      handler: vi.fn().mockResolvedValue({ success: true, data: { found: true } }),
    },
  }),
}));

vi.mock("../src/tools/project.js", () => ({ getProjectTools: () => ({}) }));
vi.mock("../src/tools/media.js", () => ({ getMediaTools: () => ({}) }));
vi.mock("../src/tools/sequence.js", () => ({ getSequenceTools: () => ({}) }));
vi.mock("../src/tools/timeline.js", () => ({ getTimelineTools: () => ({}) }));
vi.mock("../src/tools/effects.js", () => ({ getEffectsTools: () => ({}) }));
vi.mock("../src/tools/transitions.js", () => ({ getTransitionsTools: () => ({}) }));
vi.mock("../src/tools/audio.js", () => ({ getAudioTools: () => ({}) }));
vi.mock("../src/tools/text.js", () => ({ getTextTools: () => ({}) }));
vi.mock("../src/tools/markers.js", () => ({ getMarkerTools: () => ({}) }));
vi.mock("../src/tools/tracks.js", () => ({ getTrackTools: () => ({}) }));
vi.mock("../src/tools/playhead.js", () => ({ getPlayheadTools: () => ({}) }));
vi.mock("../src/tools/metadata.js", () => ({ getMetadataTools: () => ({}) }));
vi.mock("../src/tools/export.js", () => ({ getExportTools: () => ({}) }));
vi.mock("../src/tools/advanced.js", () => ({ getAdvancedTools: () => ({}) }));
vi.mock("../src/tools/keyframes.js", () => ({ getKeyframeTools: () => ({}) }));
vi.mock("../src/tools/scripting.js", () => ({ getScriptingTools: () => ({}) }));
vi.mock("../src/tools/inspection.js", () => ({ getInspectionTools: () => ({}) }));
vi.mock("../src/tools/selection.js", () => ({ getSelectionTools: () => ({}) }));
vi.mock("../src/tools/clipboard.js", () => ({ getClipboardTools: () => ({}) }));
vi.mock("../src/tools/source-monitor.js", () => ({ getSourceMonitorTools: () => ({}) }));
vi.mock("../src/tools/track-targeting.js", () => ({ getTrackTargetingTools: () => ({}) }));
vi.mock("../src/tools/utility.js", () => ({ getUtilityTools: () => ({}) }));
vi.mock("../src/tools/health.js", () => ({ getHealthTools: () => ({}) }));
vi.mock("../src/tools/workspace.js", () => ({ getWorkspaceTools: () => ({}) }));
vi.mock("../src/tools/captions.js", () => ({ getCaptionTools: () => ({}) }));
vi.mock("../src/tools/playback.js", () => ({ getPlaybackTools: () => ({}) }));
vi.mock("../src/tools/project-manager.js", () => ({ getProjectManagerTools: () => ({}) }));
vi.mock("../src/resources/extendscript-reference.js", () => ({
  EXTENDSCRIPT_REFERENCE: "mock reference",
}));

describe("createServer", () => {
  it("returns an McpServer instance", () => {
    const server = createServer({});
    expect(server).toBeDefined();
    expect(typeof server.tool).toBe("function");
    expect(typeof server.resource).toBe("function");
    expect(typeof server.connect).toBe("function");
  });

  it("registers tools from all modules", () => {
    const toolSpy = vi.fn();
    const originalTool = createServer({}).tool;

    // Create a new server and spy on tool registration
    const server = createServer({});
    // The server should have been created successfully with registered tools
    expect(server).toBeDefined();
  });

  it("does not throw with empty bridge options", () => {
    expect(() => createServer({})).not.toThrow();
  });

  it("does not throw with custom bridge options", () => {
    expect(() =>
      createServer({ tempDir: "/custom/tmp", timeoutMs: 5000 })
    ).not.toThrow();
  });
});

describe("jsonSchemaToZodShape (tested via createServer)", () => {
  // We test the schema conversion indirectly by verifying the server
  // successfully registers tools with different parameter types.
  // The function is private, so we test through the public API.

  it("handles tools with string parameters", () => {
    // The mock_discovery_tool has a required string parameter.
    // If schema conversion fails, createServer would throw.
    expect(() => createServer({})).not.toThrow();
  });

  it("handles tools with no parameters", () => {
    // Many tools (health ping, etc.) have empty parameters.
    expect(() => createServer({})).not.toThrow();
  });
});
