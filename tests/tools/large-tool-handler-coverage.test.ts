import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: { covered: true } }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: { covered: true } }),
}));

import { sendCommand, sendRawCommand } from "../../src/bridge/file-bridge.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { getExportTools } from "../../src/tools/export.js";
import { getHealthTools } from "../../src/tools/health.js";
import { getInspectionTools } from "../../src/tools/inspection.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getProjectManagerTools } from "../../src/tools/project-manager.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getRecoveryTools } from "../../src/tools/recovery.js";
import { getScriptingTools } from "../../src/tools/scripting.js";
import { getSelectionTools } from "../../src/tools/selection.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getTextTools } from "../../src/tools/text.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getTrackTools } from "../../src/tools/tracks.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getUtilityTools } from "../../src/tools/utility.js";

type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  default?: unknown;
};

type Tool = {
  parameters: Schema;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const bridgeOptions: BridgeOptions = { tempDir: "/tmp/handler-coverage", timeoutMs: 25 };
const mockedSendCommand = vi.mocked(sendCommand);
const mockedSendRawCommand = vi.mocked(sendRawCommand);

const FIELD_VALUES: Record<string, unknown> = {
  path: "/tmp/coverage.prproj",
  file_path: "/tmp/coverage.mov",
  output_path: "/tmp/coverage.json",
  folder_path: "/tmp",
  node_id: "coverage-node",
  clip_node_id: "coverage-node",
  project_item_node_id: "coverage-item",
  sequence_id: "coverage-sequence",
  sequence_name: "Coverage Sequence",
  track_index: 1,
  source_track_index: 0,
  destination_track_index: 1,
  time_seconds: 2.5,
  start_seconds: 1,
  end_seconds: 3,
  duration_seconds: 2,
  frame_number: 12,
  name: "Coverage Name",
  text: "Coverage text",
  script: "return __result({ covered: true });",
  code: "return __result({ covered: true });",
};

function valueFor(schema: Schema, field: string, includeOptional: boolean): unknown {
  if (field in FIELD_VALUES) return FIELD_VALUES[field];
  if (schema.enum?.length) return includeOptional ? schema.enum.at(-1) : schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case "boolean": return includeOptional;
    case "number": return 1;
    case "array": return [valueFor(schema.items ?? { type: "string" }, field, includeOptional)];
    case "object": return argsFor(schema, includeOptional);
    default: return `coverage-${field}`;
  }
}

function argsFor(schema: Schema, includeOptional: boolean): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (includeOptional || required.has(field)) args[field] = valueFor(property, field, includeOptional);
  }
  return args;
}

const modules: Array<[string, () => Record<string, Tool>, Set<string>?]> = [
  ["advanced", () => getAdvancedTools(bridgeOptions) as Record<string, Tool>],
  ["audio", () => getAudioTools(bridgeOptions) as Record<string, Tool>, new Set(["detect_silence"])],
  ["export", () => getExportTools(bridgeOptions) as Record<string, Tool>, new Set(["validate_export_preset", "verify_delivery_file"])],
  ["clipboard", () => getClipboardTools(bridgeOptions) as Record<string, Tool>],
  ["captions", () => getCaptionTools(bridgeOptions) as Record<string, Tool>],
  ["discovery", () => getDiscoveryTools(bridgeOptions) as Record<string, Tool>],
  ["effects", () => getEffectsTools(bridgeOptions) as Record<string, Tool>],
  ["inspection", () => getInspectionTools(bridgeOptions) as Record<string, Tool>],
  ["markers", () => getMarkerTools(bridgeOptions) as Record<string, Tool>],
  ["media", () => getMediaTools(bridgeOptions) as Record<string, Tool>],
  ["metadata", () => getMetadataTools(bridgeOptions) as Record<string, Tool>],
  ["project-manager", () => getProjectManagerTools(bridgeOptions) as Record<string, Tool>],
  ["project", () => getProjectTools(bridgeOptions) as Record<string, Tool>],
  ["recovery", () => getRecoveryTools(bridgeOptions) as Record<string, Tool>, new Set(["get_bridge_telemetry"])],
  ["scripting", () => getScriptingTools(bridgeOptions) as Record<string, Tool>],
  ["selection", () => getSelectionTools(bridgeOptions) as Record<string, Tool>],
  ["sequence", () => getSequenceTools(bridgeOptions) as Record<string, Tool>],
  ["source-monitor", () => getSourceMonitorTools(bridgeOptions) as Record<string, Tool>],
  ["text", () => getTextTools(bridgeOptions) as Record<string, Tool>],
  ["timeline", () => getTimelineTools(bridgeOptions) as Record<string, Tool>],
  ["track-targeting", () => getTrackTargetingTools(bridgeOptions) as Record<string, Tool>],
  ["tracks", () => getTrackTools(bridgeOptions) as Record<string, Tool>],
  ["utility", () => getUtilityTools(bridgeOptions) as Record<string, Tool>],
];

describe("large tool handler coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ success: true, data: { covered: true } });
    mockedSendRawCommand.mockResolvedValue({ success: true, data: { covered: true } });
  });

  for (const [moduleName, getTools, excludedTools = new Set<string>()] of modules) {
    describe(moduleName, () => {
      for (const [toolName, tool] of Object.entries(getTools())) {
        if (excludedTools.has(toolName)) continue;
        it.each([
          ["required arguments", false],
          ["all arguments", true],
        ])(`${toolName} handles %s`, async (_label, includeOptional) => {
          const commandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
          const result = await tool.handler(argsFor(tool.parameters, includeOptional));

          expect(result).toBeDefined();
          const nextCommandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
          if (nextCommandCount === commandCount) {
            expect(result).toMatchObject({ success: false });
            return;
          }
          const script = mockedSendCommand.mock.calls.at(-1)?.[0]
            ?? mockedSendRawCommand.mock.calls.at(-1)?.[0];
          expect(script).toEqual(expect.any(String));
          expect(script.length).toBeGreaterThan(20);
        });

        for (const [field, property] of Object.entries(tool.parameters.properties ?? {})) {
          for (const enumValue of property.enum?.slice(1, -1) ?? []) {
            it(`${toolName} handles ${field}=${String(enumValue)}`, async () => {
              const args = argsFor(tool.parameters, true);
              args[field] = enumValue;
              const commandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
              const result = await tool.handler(args);
              const nextCommandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
              if (nextCommandCount === commandCount) {
                expect(result).toMatchObject({ success: false });
                return;
              }
              expect(nextCommandCount).toBeGreaterThan(commandCount);
            });
          }
          if (property.type === "boolean") {
            it(`${toolName} handles ${field}=false`, async () => {
              const args = argsFor(tool.parameters, true);
              args[field] = false;
              const commandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
              const result = await tool.handler(args);
              const nextCommandCount = mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length;
              if (nextCommandCount === commandCount) {
                expect(result).toMatchObject({ success: false });
                return;
              }
              expect(nextCommandCount).toBeGreaterThan(commandCount);
            });
          }
        }
      }
    });
  }

  it.each([Number.NaN, 0, 241])("rejects invalid sequence frame rate %s locally", async (frameRate) => {
    const tool = getUtilityTools(bridgeOptions).set_sequence_frame_rate;
    const result = await tool.handler({ frame_rate: frameRate });

    expect(result).toEqual({
      success: false,
      error: "frame_rate must be a finite value between 1 and 240 fps",
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["smoothness only", { node_id: "coverage-node", smoothness: 25 }],
    ["method only", { node_id: "coverage-node", method: "Subspace Warp" }],
  ])("stabilizes with %s", async (_label, args) => {
    await getEffectsTools(bridgeOptions).stabilize_clip.handler(args);
    expect(mockedSendCommand).toHaveBeenCalledWith(expect.stringContaining("Warp Stabilizer"), bridgeOptions);
  });

  describe("health diagnostic failure branches", () => {
    it("reports successful, primitive, and rejected UXP diagnostic responses", async () => {
      const request = vi.fn()
        .mockResolvedValueOnce({ projectOpen: true, sequenceOpen: true })
        .mockResolvedValueOnce("unexpected")
        .mockRejectedValueOnce(new Error("offline"));
      const tools = getHealthTools(bridgeOptions, undefined, undefined, {
        uxpBridge: { request } as never,
      });

      await expect(tools.verify_premiere_connection.handler({ backend: "uxp" }))
        .resolves.toMatchObject({ success: true, data: { overall: "ready" } });
      await expect(tools.verify_premiere_connection.handler({ backend: "uxp" }))
        .resolves.toMatchObject({ success: true, data: { overall: "needs_attention" } });
      await expect(tools.verify_premiere_connection.handler({ backend: "uxp" }))
        .resolves.toMatchObject({ success: true, data: { overall: "needs_attention" } });
    });

    it("turns a thrown CEP diagnostic into a completed needs-attention report", async () => {
      mockedSendCommand.mockRejectedValueOnce(new Error("CEP unavailable"));
      const result = await getHealthTools(bridgeOptions).verify_premiere_connection.handler({ backend: "cep" });
      expect(result).toMatchObject({ success: true, data: { overall: "needs_attention" } });
    });
  });
});
