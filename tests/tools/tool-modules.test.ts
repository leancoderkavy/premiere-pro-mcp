import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
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
import { getMediaAnalysisTools } from "../../src/tools/media-analysis.js";
import { getInterchangeAnalysisTools } from "../../src/tools/interchange-analysis.js";
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
import { getRecoveryTools } from "../../src/tools/recovery.js";
import { getAvSettingsTools } from "../../src/tools/av-settings.js";
import { getProjectContextTools } from "../../src/tools/project-context.js";
import { getEditorialPlanTools } from "../../src/tools/editorial-plans.js";
import { getProjectIntakeTools } from "../../src/tools/project-intake.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";
import { getSpotWorkflowTools } from "../../src/tools/spot-workflows.js";
import type { Telemetry, TelemetryProperties } from "../../src/telemetry.js";

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
  { name: "export", getter: getExportTools, minTools: 10 },
  { name: "media-analysis", getter: getMediaAnalysisTools, minTools: 5 },
  { name: "interchange-analysis", getter: getInterchangeAnalysisTools, minTools: 5 },
  { name: "advanced", getter: getAdvancedTools, minTools: 20 },
  { name: "keyframes", getter: getKeyframeTools, minTools: 5 },
  { name: "scripting", getter: getScriptingTools, minTools: 3 },
  { name: "inspection", getter: getInspectionTools, minTools: 5 },
  { name: "selection", getter: getSelectionTools, minTools: 5 },
  { name: "clipboard", getter: getClipboardTools, minTools: 4 },
  { name: "source-monitor", getter: getSourceMonitorTools, minTools: 5 },
  { name: "track-targeting", getter: getTrackTargetingTools, minTools: 20 },
  { name: "utility", getter: getUtilityTools, minTools: 15 },
  { name: "health", getter: getHealthTools, minTools: 3 },
  { name: "workspace", getter: getWorkspaceTools, minTools: 2 },
  { name: "captions", getter: getCaptionTools, minTools: 1 },
  { name: "playback", getter: getPlaybackTools, minTools: 3 },
  { name: "project-manager", getter: getProjectManagerTools, minTools: 1 },
  { name: "recovery", getter: getRecoveryTools, minTools: 2 },
  { name: "av-settings", getter: getAvSettingsTools, minTools: 4 },
  { name: "project-context", getter: getProjectContextTools, minTools: 3 },
  { name: "editorial-plans", getter: () => getEditorialPlanTools(), minTools: 2 },
  { name: "project-intake", getter: getProjectIntakeTools, minTools: 1 },
  { name: "competitor-gaps", getter: getCompetitorGapTools, minTools: 8 },
  { name: "spot-workflows", getter: getSpotWorkflowTools, minTools: 4 },
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
              const types = Array.isArray(prop.type) ? prop.type : [prop.type];
              expect(
                types.length > 0 && types.every((type) =>
                  ["string", "number", "integer", "boolean", "array", "object"].includes(type)
                ),
                `${name}.${propName} has valid type "${types.join(",")}"`
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
  it("all modules together have 319 tools", () => {
    let total = 0;
    for (const mod of ALL_MODULES) {
      total += Object.keys(mod.getter(bridgeOptions)).length;
    }
    expect(total).toBe(319);
  });

  it("there are 37 directly enumerated modules", () => {
    expect(ALL_MODULES.length).toBe(37);
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
      expect(callArgs[1]?.failFastOnUnreadyHeartbeat).toBe(true);
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

  describe("health.verify_premiere_connection", () => {
    it("uses a read-only boolean check and emits activation only after readiness is confirmed", async () => {
      const events: Array<{ event: string; properties?: TelemetryProperties }> = [];
      const telemetry: Telemetry = {
        enabled: true,
        capture: (event, properties) => events.push({ event, properties }),
        shutdown: async () => {},
      };
      mockedSendCommand.mockResolvedValue({
        success: true,
        data: { projectOpen: true, sequenceOpen: true },
      });

      const tools = getHealthTools(bridgeOptions, undefined, undefined, { telemetry });
      const result = await (tools.verify_premiere_connection.handler as any)({});
      const script = String(mockedSendCommand.mock.calls[0][0]);

      expect(result).toMatchObject({
        success: true,
        data: { overall: "ready", safeCheck: { readOnly: true, mutatesProject: false } },
      });
      expect(script).toContain("projectOpen");
      expect(script).toContain("sequenceOpen");
      expect(mockedSendCommand.mock.calls[0][1]?.failFastOnUnreadyHeartbeat).toBe(true);
      expect(script).not.toContain("projectName");
      expect(script).not.toContain("project.path");
      expect(events).toEqual([
        expect.objectContaining({
          event: "premiere_mcp_activation_completed",
          properties: { activation_stage: "verified_connection", backend: "cep" },
        }),
      ]);
      expect(JSON.stringify(events)).not.toMatch(/prompt|path|token|project|media|argument|result|profile/i);
    });

    it("does not record activation when the read-only check is incomplete", async () => {
      const events: Array<{ event: string; properties?: TelemetryProperties }> = [];
      const telemetry: Telemetry = {
        enabled: true,
        capture: (event, properties) => events.push({ event, properties }),
        shutdown: async () => {},
      };
      mockedSendCommand.mockResolvedValue({
        success: true,
        data: { projectOpen: true, sequenceOpen: false },
      });

      const tools = getHealthTools(bridgeOptions, undefined, undefined, { telemetry });
      const result = await (tools.verify_premiere_connection.handler as any)({});

      expect(result).toMatchObject({ success: true, data: { overall: "needs_attention" } });
      expect(events).toEqual([]);
    });

    it("does not fall back from an unavailable UXP check to CEP", async () => {
      const tools = getHealthTools(bridgeOptions);
      const result = await (tools.verify_premiere_connection.handler as any)({ backend: "uxp" });

      expect(result).toMatchObject({ success: true, data: { backend: "uxp", overall: "needs_attention" } });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });
  });

  describe("project.create_project", () => {
    it("rejects a directory path without invoking Premiere", async () => {
      const tools = getProjectTools(bridgeOptions);

      const result = await (tools.create_project.handler as any)({
        path: "/tmp/film-test",
      });

      expect(result).toEqual({
        success: false,
        error:
          "create_project path must be a full .prproj file path; Premiere cannot create a project from a directory path.",
      });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("verifies the active project path after creating a project", async () => {
      const tools = getProjectTools(bridgeOptions);

      await (tools.create_project.handler as any)({
        path: "/tmp/Film Test.prproj",
      });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('var requestedPath = "/tmp/Film Test.prproj"');
      expect(script).toContain("var beforePath = app.project");
      expect(script).toContain("var actualPath = project ? String(project.path || \"\") : \"\"");
      expect(script).toContain("__normalizedProjectPath(actualPath) !== __normalizedProjectPath(requestedPath)");
    });
  });

  describe("reported tool regressions", () => {
    beforeEach(() => mockedSendCommand.mockClear());

    it("does not report duplicate consolidation as successful without a reduced duplicate scan", async () => {
      const tools = getProjectTools(bridgeOptions);
      await tools.consolidate_duplicates.handler({});

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("function __duplicateMediaStats()");
      expect(script).toContain("var before = __duplicateMediaStats()");
      expect(script).toContain("var after = __duplicateMediaStats()");
      expect(script).toContain("duplicate media groups did not decrease");
      expect(script).toContain("verified: true");
    });

    it("fails reverse_clip locally with an actionable unsupported-capability error", async () => {
      const tools = getAdvancedTools(bridgeOptions);
      const result = await tools.reverse_clip.handler({ node_id: "clip-1" });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("not exposed by Premiere's supported ExtendScript or UXP APIs"),
      });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("merges XMP patches through AdobeXMPScript and reparses host readback", async () => {
      const tools = getMetadataTools(bridgeOptions);
      await tools.set_xmp_metadata.handler({
        item_id: "source-1",
        xmp_xml: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
      });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('new ExternalObject("lib:AdobeXMPScript")');
      expect(script).toContain("var existingXmp = new XMPMeta(existingPacket)");
      expect(script).toContain("XMPUtils.appendProperties(patchXmp, existingXmp, true, true, false)");
      expect(script).toContain("var writtenPacket = String(item.getXMPMetadata() || \"\")");
      expect(script).toContain('verification: "readback_xmp_packet_reparsed"');
    });
  });

  describe("health.get_capabilities", () => {
    it("reports platform support without requiring Premiere to be running", async () => {
      const tools = getHealthTools(bridgeOptions);
      const result = await tools.get_capabilities.handler();
      expect(result.success).toBe(true);
      expect(result.data.backends.cep.platforms).toEqual(["macOS", "Windows"]);
      expect(result.data.premiere.hostVerificationRequired).toBe(true);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("includes per-tool operational metadata from the supplied catalog", async () => {
      const tools = getHealthTools(
        bridgeOptions,
        undefined,
        () => ({
          get_capabilities: { description: "Report capabilities." },
          ripple_delete: { description: "Ripple delete. Uses QE DOM." },
        }),
      );
      const result = await tools.get_capabilities.handler();
      expect(result.data.tools.total).toBe(2);
      expect(result.data.tools.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "ripple_delete",
            status: "experimental",
            backend: "CEP/ExtendScript + QE",
          }),
        ]),
      );
    });
  });

  describe("bounded read tools", () => {
    it("returns a filtered, paged get_capabilities catalog without changing the capability summary", async () => {
      const tools = getHealthTools(
        bridgeOptions,
        undefined,
        () => ({
          ping: { description: "Ping." },
          get_capabilities: { description: "Capabilities." },
          ripple_delete: { description: "Ripple delete. Uses QE DOM." },
        }),
      );
      const result = await tools.get_capabilities.handler({ tool_names: ["ripple_delete", "missing"], tool_limit: 1 });

      expect(result.success).toBe(true);
      expect(result.data.tools.tools).toEqual([expect.objectContaining({ name: "ripple_delete" })]);
      expect(result.data.tools.pagination).toEqual({
        offset: 0,
        limit: 1,
        returned: 1,
        totalMatching: 1,
        hasMore: false,
        nextOffset: null,
      });
      expect(result.data.backends.cep.status).toBe("production");
    });

    it("omits requested metadata XML payloads before invoking the CEP bridge", async () => {
      const tools = getMetadataTools(bridgeOptions);
      await tools.get_metadata.handler({
        item_id: "source-1",
        include_project_metadata: false,
        include_xmp_metadata: false,
      });

      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).not.toContain("item.getProjectMetadata()");
      expect(script).not.toContain("item.getXMPMetadata()");
      expect(script).toContain("metadata.nodeId = item.nodeId");
    });

    it("generates bounded overview and bin read scripts", async () => {
      const tools = getInspectionTools(bridgeOptions);
      await tools.get_full_project_overview.handler({
        include_bin_tree: false,
        sequence_offset: 5,
        sequence_limit: 10,
      });
      const overview = mockedSendCommand.mock.calls[0][0];
      expect(overview).toContain("var binTree = null");
      expect(overview).toContain("var sequenceOffset = 5");
      expect(overview).toContain("var sequenceLimit = 10");
      expect(overview).toContain("sequencePagination");

      vi.clearAllMocks();
      await tools.get_bin_contents.handler({
        bin_id: "Footage",
        recursive: false,
        offset: 10,
        limit: 25,
        max_depth: 0,
      });
      const bin = mockedSendCommand.mock.calls[0][0];
      expect(bin).toContain("var allContents = walkItems(target, false, 0)");
      expect(bin).toContain("allContents.slice(offset, offset + limit)");
      expect(bin).toContain("totalDirectItems");
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
      expect(script).toContain("playbackRequested: true");
      expect(script).toContain("playbackVerified: false");
      expect(script).toContain("poll get_playhead_position");
    });

    it("play_timeline has no speed parameter (QE startPlayback ignores it)", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      expect(tools.play_timeline.parameters).toEqual({});
    });

    it("does not claim legacy source-monitor or stop-playback requests are verified", async () => {
      const tools = getPlaybackTools(bridgeOptions);
      await (tools.stop_playback.handler as any)({});
      let script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("stopRequested: true");
      expect(script).toContain("playbackVerified: false");

      vi.clearAllMocks();
      await (tools.play_source_monitor.handler as any)({ speed: 1 });
      script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("playbackRequested: true");
      expect(script).toContain("poll get_source_monitor_position");
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

  describe("verified Premiere mutations", () => {
    it("uses settings fields and readback for set_sequence_settings", async () => {
      const tools = getSequenceTools(bridgeOptions);
      await (tools.set_sequence_settings.handler as any)({ sequence_id: "seq-1", width: 1920, height: 1080 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("settings.videoFrameWidth = 1920");
      expect(script).toContain("settings.videoFrameHeight = 1080");
      expect(script).toContain("var applied = seq.getSettings()");
      expect(script).toContain("Premiere did not apply the requested frame width");
      expect(script).toContain("verified: true");

      vi.clearAllMocks();
      await (tools.set_sequence_settings.handler as any)({ width: 1920 });
      expect(mockedSendCommand.mock.calls[0][0]).toContain("settings.videoFrameWidth = 1920");
      expect(mockedSendCommand.mock.calls[0][0]).not.toContain("settings.videoFrameHeight =");

      vi.clearAllMocks();
      await (tools.set_sequence_settings.handler as any)({ height: 1080 });
      expect(mockedSendCommand.mock.calls[0][0]).toContain("settings.videoFrameHeight = 1080");
      expect(mockedSendCommand.mock.calls[0][0]).not.toContain("settings.videoFrameWidth =");

      vi.clearAllMocks();
      await expect((tools.set_sequence_settings.handler as any)({ width: 0 })).resolves.toMatchObject({ success: false });
      expect(mockedSendCommand).not.toHaveBeenCalled();

      await expect((tools.set_sequence_settings.handler as any)({})).resolves.toMatchObject({ success: false });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("fails unsupported legacy AAF and multiple-undo requests before mutation", async () => {
      const aaf = await (getExportTools(bridgeOptions).export_aaf.handler as any)({ output_path: "/tmp/turnover.aaf" });
      const undoTools = getTrackTargetingTools(bridgeOptions);
      const undo = await (undoTools.multiple_undo.handler as any)({ count: 2 });
      const invalidUndo = await (undoTools.multiple_undo.handler as any)({ count: 0 });
      expect(aaf).toMatchObject({ success: false, error: expect.stringContaining("No export was attempted") });
      expect(undo).toMatchObject({ success: false, error: expect.stringContaining("No mutation was attempted") });
      expect(invalidUndo).toMatchObject({ success: false, error: expect.stringContaining("integer from 1 through 100") });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("finds pan on Channel Volume layouts and verifies the readback", async () => {
      const tools = getTrackTargetingTools(bridgeOptions);
      await (tools.set_clip_pan.handler as any)({ node_id: "audio-clip-1", pan: -50 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('result.trackType !== "audio"');
      expect(script).toContain("component.properties");
      expect(script).toContain('property.displayName === "Balance"');
      expect(script).toContain("panProperty.getValue()");
      expect(script).toContain("Premiere did not apply the requested pan");

      vi.clearAllMocks();
      await expect((tools.set_clip_pan.handler as any)({ node_id: "audio-clip-1", pan: 101 })).resolves.toMatchObject({ success: false });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("supports the documented ## zero-padded rename placeholder", async () => {
      const tools = getTrackTargetingTools(bridgeOptions);
      await (tools.batch_rename_clips.handler as any)({ pattern: "QA_Batch_##", track_type: "video", track_index: 0 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('.split("##").join(paddedSequenceNumber)');
       expect(script).toContain('while (paddedSequenceNumber.length < 2)');
       expect(script).toContain('"0" + paddedSequenceNumber');
     });

    it("converts audio dB from Premiere's +15 dB normalized level and verifies the readback", async () => {
      const tools = getAudioTools(bridgeOptions);
      await (tools.adjust_audio_levels.handler as any)({ node_id: "clip-1", level_db: -6 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("requestedLevel");
      expect(script).toContain("levelProp.getValue()");
      expect(script).toContain("Premiere did not apply the requested audio level");
      expect(script).toContain("0.089125");
      expect(script).toContain("appliedDb");

      vi.clearAllMocks();
      await expect((tools.adjust_audio_levels.handler as any)({ node_id: "clip-1", level_db: 16 }))
        .resolves.toMatchObject({ success: false, error: expect.stringContaining("+15 dB") });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("preflights and verifies every batch effect target instead of swallowing failures", async () => {
      const tools = getClipboardTools(bridgeOptions);
      await (tools.batch_apply_effect.handler as any)({ effect_name: "Gaussian Blur", target: "selected" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("function findQeClip(target)");
      expect(script).toContain("function countEffectComponents(clip)");
      expect(script).toContain("component count did not increase");
      expect(script).toContain("Batch effect application was only partially verified");
      expect(script).toContain("selectedIncompatible");

      vi.clearAllMocks();
      await expect((tools.batch_apply_effect.handler as any)({ effect_name: "Gaussian Blur", target: "track" }))
        .resolves.toMatchObject({ success: false, error: expect.stringContaining("track_type") });
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("does not report an empty QE audio-transition catalog as an available list", async () => {
      const tools = getTransitionsTools(bridgeOptions);
      await (tools.list_available_audio_transitions.handler as any)({});
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("QE reported an empty audio-transition catalog");
      expect(script).toContain("no transition availability is claimed");
      expect(script).toContain('source: "qe.catalog"');
    });

    it("uses Time objects and verifies audio keyframe values", async () => {
      const tools = getAudioTools(bridgeOptions);
      await (tools.add_audio_keyframes.handler as any)({
        node_id: "clip-1",
        keyframes: [{ time_seconds: 1.5, level_db: -12 }],
      });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("new Time()");
      expect(script).toContain("getValueAtTime(t)");
      expect(script).toContain("verificationErrors");
    });

    it("verifies ripple delete and passes QE razor a sequence timecode", async () => {
      await (getAdvancedTools(bridgeOptions).ripple_delete.handler as any)({ node_id: "clip-1" });
      let script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("if (__findClip(deletedNodeId))");

      vi.clearAllMocks();
      await (getTimelineTools(bridgeOptions).split_clip.handler as any)({ time_seconds: 2 });
      script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var expectedClipCount = clipCountBefore + eligibleBefore.length");
      expect(script).toContain("function __hasSegment");
      expect(script).toContain("var __razorTc");
      expect(script).toContain("track.razor(__razorTc)");
      expect(script).not.toContain("track.razor(cutTicks.toString())");

      vi.clearAllMocks();
      await (getTrackTargetingTools(bridgeOptions).razor_all_tracks.handler as any)({ time_seconds: 2 });
      script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var __razorTc");
      expect(script).toContain("getVideoTrackAt(t).razor(__razorTc)");
      expect(script).toContain("getAudioTrackAt(t).razor(__razorTc)");
    });

    it("targets the QE clip, preserves an unsupported speed boundary, and verifies track state", async () => {
      const tools = getTransitionsTools(bridgeOptions);
      await (tools.add_transition.handler as any)({
        transition_name: "Cross Dissolve",
        track_index: 0,
        cut_point_seconds: 2,
      });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("__findQeClipByDomClip(qeTrack, outgoingClip)");
      expect(script).toContain('typeof qeClip.addTransition !== "function"');
      expect(script).toContain('qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true)');
      expect(script).not.toContain("qeTrack.addTransition(");
      expect(script).toContain("transitionCountBefore");
      expect(script).toContain("domTrack.transitions.numItems <= transitionCountBefore");

      vi.clearAllMocks();
      await (tools.add_transition_to_clip.handler as any)({
        node_id: "clip-1", transition_name: "Cross Dissolve", position: "both",
      });
      const clipScript = mockedSendCommand.mock.calls[0][0];
      expect(clipScript).toContain("__findQeClipByDomClip(qeTrack, result.clip)");
      expect(clipScript).toContain("var requestedCount = position === \"both\" ? 2 : 1");
      expect(clipScript).toContain('qeClip.addTransition(transitionQE, false, String(durationFrames), "0", 0.5, true, true)');
      expect(clipScript).toContain('qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, true, true)');

      vi.clearAllMocks();
      await (tools.batch_add_transitions.handler as any)({ transition_name: "Cross Dissolve" });
      const batchScript = mockedSendCommand.mock.calls[0][0];
      expect(batchScript).toContain("__findQeClipByDomClip(qeTrack, outgoingClip)");
      expect(batchScript).toContain('qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true)');
      expect(batchScript).toContain("verifiedCount !== requestedCount");
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

      // Helpers are no longer inlined — the whole script is user code.
      const userCode = mockedSendCommand.mock.calls[0][0];
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
      expect(script).toContain("__captionTrackCount");
      expect(script).toContain("no caption track appeared in host readback");
      expect(script).toContain("accepted: true");
    });
  });

  describe("project-manager tools", () => {
    it("consolidate_and_transfer verifies a copied project in a new destination", async () => {
      const tools = getProjectManagerTools(bridgeOptions);
      expect(tools.consolidate_and_transfer).toBeDefined();
      expect(typeof tools.consolidate_and_transfer.handler).toBe("function");
      await (tools.consolidate_and_transfer.handler as any)({ destination_path: "/tmp/transfer" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("destination_path must be a new, empty folder");
      expect(script).toContain('destination.getFiles("*.prproj")');
      expect(script).toContain("copiedProjectCount");
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

  it("scripts do not inline helpers; helpers source defines them", async () => {
    const tools = getDiscoveryTools(bridgeOptions);
    await (tools.get_project_info.handler as any)({});

    const script = mockedSendCommand.mock.calls[0][0];
    // Inlining ~14KB of helpers per command overflowed the ExtendScript stack
    // on long-lived engines; commands must stay lean.
    expect(script).not.toContain("function __jsonStringify(obj)");
    const helpers = getHelpersSource();
    expect(helpers).toContain("function __result(data)");
    expect(helpers).toContain("function __error(msg)");
    expect(helpers).toContain("TICKS_PER_SECOND");
  });
});
