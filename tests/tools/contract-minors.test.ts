import { runInNewContext } from "node:vm";
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
  it("reports an unavailable export extension as an error rather than a successful missing field", async () => {
    const script = await scriptFor(getSequenceTools(bridgeOptions).get_export_file_extension, {
      preset_path: "/tmp/preset.epr",
    });
    const unavailable = execute(script, { project: { activeSequence: {
      name: "Sequence", getExportFileExtension: () => undefined,
    } } });
    expect(unavailable).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining("did not provide an export extension"),
    }));

    const available = execute(script, { project: { activeSequence: {
      name: "Sequence", getExportFileExtension: () => ".mov",
    } } });
    expect(available).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ extension: ".mov" }),
    }));
  });

  it("warns when a stored keyframe falls beyond the clip's visible span", async () => {
    const script = await scriptFor(getKeyframeTools(bridgeOptions).add_keyframe, {
      node_id: "clip-1", effect_name: "Opacity", property_name: "Opacity", time_seconds: 99, value: 50,
    });
    const property = {
      displayName: "Opacity",
      areKeyframesSupported: () => true,
      isTimeVarying: () => true,
      addKey: vi.fn(),
      setValueAtKey: vi.fn(),
      getValueAtKey: () => 50,
    };
    const component = { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: property } };
    const clip = {
      nodeId: "clip-1", start: { ticks: "0" }, end: { ticks: String(3 * 254016000000) },
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
