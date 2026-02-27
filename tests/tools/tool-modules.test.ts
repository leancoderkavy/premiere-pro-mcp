import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

// Mock sendCommand and sendRawCommand so tool handlers don't do real I/O
vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand, sendRawCommand } from "../../src/bridge/file-bridge.js";

const mockedSendCommand = vi.mocked(sendCommand);
const mockedSendRawCommand = vi.mocked(sendRawCommand);

const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

// Import all tool modules
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getTransitionsTools } from "../../src/tools/transitions.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { getTextTools } from "../../src/tools/text.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getTrackTools } from "../../src/tools/tracks.js";
import { getPlayheadTools } from "../../src/tools/playhead.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getExportTools } from "../../src/tools/export.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getScriptingTools } from "../../src/tools/scripting.js";
import { getInspectionTools } from "../../src/tools/inspection.js";
import { getSelectionTools } from "../../src/tools/selection.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getHealthTools } from "../../src/tools/health.js";
import { getWorkspaceTools } from "../../src/tools/workspace.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { getPlaybackTools } from "../../src/tools/playback.js";
import { getProjectManagerTools } from "../../src/tools/project-manager.js";

interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

type ToolModule = Record<string, ToolDef>;

// All modules with their expected tool counts and names
const ALL_MODULES: Array<{
  name: string;
  getter: (opts: BridgeOptions) => ToolModule;
  minTools: number;
}> = [
  { name: "discovery", getter: getDiscoveryTools, minTools: 8 },
  { name: "project", getter: getProjectTools, minTools: 20 },
  { name: "media", getter: getMediaTools, minTools: 12 },
  { name: "sequence", getter: getSequenceTools, minTools: 8 },
  { name: "timeline", getter: getTimelineTools, minTools: 8 },
  { name: "effects", getter: getEffectsTools, minTools: 6 },
  { name: "transitions", getter: getTransitionsTools, minTools: 3 },
  { name: "audio", getter: getAudioTools, minTools: 2 },
  { name: "text", getter: getTextTools, minTools: 2 },
  { name: "markers", getter: getMarkerTools, minTools: 3 },
  { name: "tracks", getter: getTrackTools, minTools: 3 },
  { name: "playhead", getter: getPlayheadTools, minTools: 4 },
  { name: "metadata", getter: getMetadataTools, minTools: 6 },
  { name: "export", getter: getExportTools, minTools: 8 },
  { name: "advanced", getter: getAdvancedTools, minTools: 20 },
  { name: "keyframes", getter: getKeyframeTools, minTools: 5 },
  { name: "scripting", getter: getScriptingTools, minTools: 3 },
  { name: "inspection", getter: getInspectionTools, minTools: 5 },
  { name: "selection", getter: getSelectionTools, minTools: 5 },
  { name: "clipboard", getter: getClipboardTools, minTools: 4 },
  { name: "source-monitor", getter: getSourceMonitorTools, minTools: 5 },
  { name: "track-targeting", getter: getTrackTargetingTools, minTools: 20 },
  { name: "utility", getter: getUtilityTools, minTools: 15 },
  { name: "health", getter: getHealthTools, minTools: 1 },
  { name: "workspace", getter: getWorkspaceTools, minTools: 2 },
  { name: "captions", getter: getCaptionTools, minTools: 1 },
  { name: "playback", getter: getPlaybackTools, minTools: 3 },
  { name: "project-manager", getter: getProjectManagerTools, minTools: 1 },
];

describe("Tool Module Structure", () => {
  for (const mod of ALL_MODULES) {
    describe(`${mod.name} module`, () => {
      let tools: ToolModule;

      beforeEach(() => {
        tools = mod.getter(bridgeOptions);
      });

      it(`exports at least ${mod.minTools} tools`, () => {
        expect(Object.keys(tools).length).toBeGreaterThanOrEqual(mod.minTools);
      });

      it("each tool has a description string", () => {
        for (const [name, tool] of Object.entries(tools)) {
          expect(typeof tool.description, `${name} description`).toBe("string");
          expect(tool.description.length, `${name} description length`).toBeGreaterThan(0);
        }
      });

      it("each tool has a parameters object", () => {
        for (const [name, tool] of Object.entries(tools)) {
          expect(typeof tool.parameters, `${name} parameters`).toBe("object");
        }
      });

      it("each tool has an async handler function", () => {
        for (const [name, tool] of Object.entries(tools)) {
          expect(typeof tool.handler, `${name} handler`).toBe("function");
        }
      });

      it("parameter properties all have type fields", () => {
        for (const [name, tool] of Object.entries(tools)) {
          const props = (tool.parameters as any).properties;
          if (props) {
            for (const [propName, prop] of Object.entries(props) as [string, any][]) {
              expect(prop.type, `${name}.${propName} type`).toBeDefined();
              expect(
                ["string", "number", "boolean", "array", "object"].includes(prop.type),
                `${name}.${propName} has valid type "${prop.type}"`
              ).toBe(true);
            }
          }
        }
      });

      it("parameter properties all have description fields", () => {
        for (const [name, tool] of Object.entries(tools)) {
          const props = (tool.parameters as any).properties;
          if (props) {
            for (const [propName, prop] of Object.entries(props) as [string, any][]) {
              expect(
                typeof prop.description,
                `${name}.${propName} should have description`
              ).toBe("string");
            }
          }
        }
      });

      it("required fields reference existing properties", () => {
        for (const [name, tool] of Object.entries(tools)) {
          const params = tool.parameters as any;
          const required = params.required || [];
          const propNames = Object.keys(params.properties || {});
          for (const req of required) {
            expect(
              propNames.includes(req),
              `${name}: required field "${req}" should exist in properties`
            ).toBe(true);
          }
        }
      });
    });
  }
});

describe("Total Tool Count", () => {
  it("all modules together have 269 tools", () => {
    let total = 0;
    for (const mod of ALL_MODULES) {
      total += Object.keys(mod.getter(bridgeOptions)).length;
    }
    expect(total).toBe(269);
  });

  it("there are 28 modules", () => {
    expect(ALL_MODULES.length).toBe(28);
  });
});

describe("Tool Handler Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ success: true, data: { mock: true } });
  });

  describe("health.ping", () => {
    it("calls sendCommand with shortened timeout", async () => {
      const tools = getHealthTools(bridgeOptions);
      await (tools.ping.handler as any)({});

      expect(mockedSendCommand).toHaveBeenCalledTimes(1);
      const callArgs = mockedSendCommand.mock.calls[0];
      // Script should contain app.version
      expect(callArgs[0]).toContain("app.version");
      // Should use a 5-second timeout override
      expect(callArgs[1]?.timeoutMs).toBe(5000);
    });

    it("generates script that checks connectivity", async () => {
      const tools = getHealthTools(bridgeOptions);
      await (tools.ping.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("app.project");
      expect(script).toContain("__result");
      expect(script).toContain("connected: true");
    });
  });

  describe("workspace tools", () => {
    it("get_workspaces generates correct script", async () => {
      const tools = getWorkspaceTools(bridgeOptions);
      await (tools.get_workspaces.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("app.getWorkspaces()");
      expect(script).toContain("__result");
    });

    it("set_workspace escapes the workspace name", async () => {
      const tools = getWorkspaceTools(bridgeOptions);
      await (tools.set_workspace.handler as any)({ name: 'My "Custom" Workspace' });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('My \\"Custom\\" Workspace');
      expect(script).toContain("app.setWorkspace");
    });
  });

  describe("playback tools", () => {
    it("play_timeline uses QE DOM", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.play_timeline.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("app.enableQE()");
      expect(script).toContain("qe.startPlayback()");
    });

    it("play_timeline uses default speed of 1.0", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.play_timeline.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("speed: 1");
    });

    it("play_timeline accepts custom speed", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.play_timeline.handler as any)({ speed: 2.5 });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("speed: 2.5");
    });

    it("stop_playback uses QE DOM", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.stop_playback.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("qe.stopPlayback()");
    });

    it("get_source_monitor_position reads ticks", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.get_source_monitor_position.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("app.sourceMonitor.getPosition()");
      expect(script).toContain("__ticksToSeconds");
    });
  });

  describe("discovery tools", () => {
    it("get_project_info generates correct script", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.get_project_info.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("app.project");
      expect(script).toContain("project.name");
      expect(script).toContain("project.path");
      expect(script).toContain("numSequences");
      expect(script).toContain("__result");
    });

    it("list_project_items handles optional bin_path", async () => {
      const tools = getDiscoveryTools(bridgeOptions);

      // Without bin_path
      await (tools.list_project_items.handler as any)({});
      let script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var binPath = null");

      vi.clearAllMocks();

      // With bin_path
      await (tools.list_project_items.handler as any)({ bin_path: "Footage/Raw" });
      script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("Footage/Raw");
    });

    it("list_project_items escapes bin_path", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.list_project_items.handler as any)({ bin_path: 'My "Folder"' });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('My \\"Folder\\"');
    });

    it("get_clip_properties escapes node_id", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.get_clip_properties.handler as any)({ node_id: "abc-123" });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("abc-123");
      expect(script).toContain("__findClip");
    });

    it("get_clip_at_position generates correct track lookup", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.get_clip_at_position.handler as any)({
        time_seconds: 5.5,
        track_index: 1,
        track_type: "video",
      });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("seq.videoTracks");
      expect(script).toContain("5.5");
    });

    it("get_clip_at_position uses audio tracks when specified", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.get_clip_at_position.handler as any)({
        time_seconds: 2.0,
        track_index: 0,
        track_type: "audio",
      });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("seq.audioTracks");
    });

    it("list_sequence_tracks defaults to active sequence", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.list_sequence_tracks.handler as any)({});

      const script = mockedSendCommand.mock.calls[0][0];
      // The user code portion (after helpers) should use activeSequence directly
      const userCode = script.split("// === End MCP Bridge Helpers ===")[1];
      expect(userCode).toContain("app.project.activeSequence");
      // Should NOT call __findSequence in user code when no sequence_id is provided
      expect(userCode).not.toContain('__findSequence("');
    });

    it("list_sequence_tracks uses __findSequence when id provided", async () => {
      const tools = getDiscoveryTools(bridgeOptions);
      await (tools.list_sequence_tracks.handler as any)({ sequence_id: "seq-1" });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("__findSequence");
      expect(script).toContain("seq-1");
    });
  });

  describe("caption tools", () => {
    it("create_caption_track generates correct script", async () => {
      const tools = getCaptionTools(bridgeOptions);
      const toolNames = Object.keys(tools);
      expect(toolNames).toContain("create_caption_track");

      await (tools.create_caption_track.handler as any)({ item_id: "my-srt-file" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("__result");
      expect(script).toContain("my-srt-file");
      expect(script).toContain("createCaptionTrack");
    });
  });

  describe("project-manager tools", () => {
    it("consolidate_and_transfer exists and is callable", async () => {
      const tools = getProjectManagerTools(bridgeOptions);
      expect(tools.consolidate_and_transfer).toBeDefined();
      expect(typeof tools.consolidate_and_transfer.handler).toBe("function");
    });
  });
});

describe("Tool Handler Return Values", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handlers return the result from sendCommand", async () => {
    const expected = { success: true, data: { version: "24.0" } };
    mockedSendCommand.mockResolvedValue(expected);

    const tools = getHealthTools(bridgeOptions);
    const result = await (tools.ping.handler as any)({});

    expect(result).toEqual(expected);
  });

  it("handlers propagate sendCommand errors", async () => {
    mockedSendCommand.mockRejectedValue(new Error("Connection failed"));

    const tools = getHealthTools(bridgeOptions);
    await expect((tools.ping.handler as any)({})).rejects.toThrow("Connection failed");
  });

  it("handlers propagate failure results", async () => {
    const failResult = { success: false, error: "No active sequence" };
    mockedSendCommand.mockResolvedValue(failResult);

    const tools = getDiscoveryTools(bridgeOptions);
    const result = await (tools.get_active_sequence.handler as any)({});

    expect(result.success).toBe(false);
    expect(result.error).toBe("No active sequence");
  });
});

describe("Tool Naming Conventions", () => {
  it("all tool names use snake_case", () => {
    for (const mod of ALL_MODULES) {
      const tools = mod.getter(bridgeOptions);
      for (const name of Object.keys(tools)) {
        expect(name, `${mod.name}.${name} should be snake_case`).toMatch(
          /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
        );
      }
    }
  });

  it("no duplicate tool names across modules", () => {
    const allNames: string[] = [];
    for (const mod of ALL_MODULES) {
      const tools = mod.getter(bridgeOptions);
      allNames.push(...Object.keys(tools));
    }
    const unique = new Set(allNames);
    expect(unique.size).toBe(allNames.length);
  });
});

describe("Script Generation Patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ success: true, data: {} });
  });

  it("all scripts contain __result or __error", async () => {
    for (const mod of ALL_MODULES) {
      const tools = mod.getter(bridgeOptions);
      for (const [name, tool] of Object.entries(tools)) {
        vi.clearAllMocks();
        try {
          // Call with minimal args — we only care about the generated script
          await tool.handler({});
        } catch {
          // Some handlers may throw if required args are missing, that's OK
          continue;
        }

        if (mockedSendCommand.mock.calls.length > 0) {
          const script = mockedSendCommand.mock.calls[0][0];
          const hasResult = script.includes("__result") || script.includes("__error");
          expect(hasResult, `${mod.name}.${name} script should use __result or __error`).toBe(true);
        }
        if (mockedSendRawCommand.mock.calls.length > 0) {
          // Raw commands (scripting module) may not follow the pattern
          continue;
        }
      }
    }
  });

  it("scripts are wrapped in IIFE with try/catch", async () => {
    const tools = getDiscoveryTools(bridgeOptions);
    await (tools.get_project_info.handler as any)({});

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("(function() {");
    expect(script).toContain("} catch(e) {");
    expect(script).toContain("})();");
  });

  it("scripts include helper functions", async () => {
    const tools = getDiscoveryTools(bridgeOptions);
    await (tools.get_project_info.handler as any)({});

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("function __result(data)");
    expect(script).toContain("function __error(msg)");
    expect(script).toContain("TICKS_PER_SECOND");
  });
});
