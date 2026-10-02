import { runInNewContext } from "node:vm";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getSequenceTools } from "../../src/tools/sequence.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledOnce();
  return String(mockedSendCommand.mock.calls[0][0]);
}

function execute(script: string, app: unknown, extras: Record<string, unknown> = {}) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, ...extras })));
}

beforeEach(() => vi.clearAllMocks());

describe("minor host contract receipts", () => {
  it("labels the mixed local and CEP extension lookup", () => {
    expect(getSequenceTools(bridgeOptions).get_export_file_extension.operationalCapability).toMatchObject({
      backend: "local + CEP/ExtendScript", authority: "filesystem", verificationBoundary: "local_and_host_response",
    });
  });

  it("uses the host extension when available and an explicitly inferred AME folder extension otherwise", async () => {
    const root = mkdtempSync(join(tmpdir(), "ame-extension-"));
    try {
      const formatFolder = join(root, "3F3F3F3F_4D6F6F56");
      mkdirSync(formatFolder);
      const presetPath = join(formatFolder, "H264 Match Source - High bitrate.epr");
      writeFileSync(presetPath, "<preset />");
      const tool = getSequenceTools(bridgeOptions).get_export_file_extension;
      mockedSendCommand.mockImplementation(async (script: string) => execute(script, { project: { activeSequence: {
        name: "Sequence", getExportFileExtension: () => undefined,
      } } }));
      await expect(tool.handler({ preset_path: presetPath })).resolves.toMatchObject({
        success: true,
        data: { extension: ".mov", extensionSource: "preset_folder", hostConfirmed: false, formatCode: "MooV", warning: expect.stringContaining("not confirmed") },
      });
      mockedSendCommand.mockImplementation(async (script: string) => execute(script, { project: { activeSequence: {
        name: "Sequence", getExportFileExtension: () => ".mp4",
      } } }));
      await expect(tool.handler({ preset_path: presetPath })).resolves.toMatchObject({
        success: true, data: { extension: ".mp4", extensionSource: "premiere", hostConfirmed: true },
      });
      mockedSendCommand.mockImplementation(async (script: string) => execute(script, { project: { activeSequence: {
        name: "Sequence", getExportFileExtension: () => "mp4",
      } } }));
      await expect(tool.handler({ preset_path: presetPath })).resolves.toMatchObject({
        success: true, data: { extension: "mp4", extensionSource: "premiere", hostConfirmed: true },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not infer an extension from an unrecognized or missing preset", async () => {
    const root = mkdtempSync(join(tmpdir(), "ame-extension-"));
    try {
      const recognizedFolder = join(root, "3F3F3F3F_4D6F6F56");
      mkdirSync(recognizedFolder);
      const presetPath = join(recognizedFolder, "preset.epr");
      writeFileSync(presetPath, "<preset />");
      const tool = getSequenceTools(bridgeOptions).get_export_file_extension;
      mockedSendCommand.mockImplementation(async (script: string) => execute(script, { project: { activeSequence: {
        name: "Sequence", getExportFileExtension: () => undefined,
      } } }));
      await expect(tool.handler({ preset_path: presetPath })).resolves.toMatchObject({ success: true, data: { extension: ".mov", hostConfirmed: false } });
      const unknownPreset = join(root, "unknown.epr");
      writeFileSync(unknownPreset, "<preset />");
      await expect(tool.handler({ preset_path: unknownPreset })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not provide") });
      rmSync(presetPath);
      await expect(tool.handler({ preset_path: presetPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not provide") });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns when a stored keyframe is at the clip's first invisible frame", async () => {
    const script = await scriptFor(getKeyframeTools(bridgeOptions).add_keyframe, {
      node_id: "clip-1", effect_name: "Opacity", property_name: "Opacity", time_seconds: 3, value: 50,
    });
    const property = {
      displayName: "Opacity",
      areKeyframesSupported: () => true,
      isTimeVarying: () => true,
      addKey: vi.fn(),
      setValueAtKey: vi.fn(),
      getValueAtKey: () => 50,
      getKeys: () => [{ ticks: String(3 * 254016000000) }],
    };
    const component = { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: property } };
    const clip = {
      nodeId: "clip-1", start: { ticks: "0" }, end: { ticks: String(3 * 254016000000) },
      inPoint: { ticks: "0" }, getSpeed: () => 1, isSpeedReversed: () => false,
      components: { numItems: 1, 0: component },
    };
    const app = { project: { activeSequence: {
      videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } },
      audioTracks: { numTracks: 0 },
    } } };
    const result = execute(script, app, { Time: function Time(this: { ticks?: string }) { this.ticks = "0"; } });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        stored: true,
        keyframesOutsideVisibleRange: 1,
        warning: expect.stringContaining("outside the clip's visible range"),
      }),
    }));
    expect(property.addKey).toHaveBeenCalledOnce();
  });
});
