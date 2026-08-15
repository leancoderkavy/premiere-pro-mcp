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
  ["inspection", () => getInspectionTools(bridgeOptions) as Record<string, Tool>],
  ["track-targeting", () => getTrackTargetingTools(bridgeOptions) as Record<string, Tool>],
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
          expect(mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length)
            .toBeGreaterThan(commandCount);
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
              await tool.handler(args);
              expect(mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length)
                .toBeGreaterThan(0);
            });
          }
          if (property.type === "boolean") {
            it(`${toolName} handles ${field}=false`, async () => {
              const args = argsFor(tool.parameters, true);
              args[field] = false;
              await tool.handler(args);
              expect(mockedSendCommand.mock.calls.length + mockedSendRawCommand.mock.calls.length)
                .toBeGreaterThan(0);
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
