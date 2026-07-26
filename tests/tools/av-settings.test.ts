import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAvSettingsTools } from "../../src/tools/av-settings.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getAvSettingsTools({ tempDir: "/tmp/test", timeoutMs: 1000 });

describe("AV feature support", () => {
  it("identifies documented support and UI-only boundaries without a host call", async () => {
    const result = await tools.get_av_feature_support.handler();
    expect(result.success).toBe(true);
    expect(result.data.supported.projectItemAudioChannelMapping.status).toBe("supported_with_limitations");
    expect(result.data.blocked.enhanceSpeech).toMatchObject({
      status: "ui_only",
      reason: expect.stringContaining("No documented"),
    });
    expect(result.data.blocked.audioTrackMixerRoutingAndSubmixes.status).toBe("unsupported");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("AV inspection scripts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inspects documented sequence audio and color/render fields", async () => {
    await tools.inspect_sequence_av_settings.handler();
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("audioChannelCount");
    expect(script).toContain("autoToneMapEnabled");
    expect(script).toContain("compositeLinearColor");
    expect(script).toContain("sequenceWorkingColorSpace");
  });

  it("inspects project item color spaces, LUTs, override options, and channel shape", async () => {
    await tools.inspect_project_item_av_metadata.handler({ item_id: 'clip "A"' });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('clip \\"A\\"');
    expect(script).toContain("getColorSpace");
    expect(script).toContain("getOriginalColorSpace");
    expect(script).toContain("getOverrideColorSpaceList");
    expect(script).toContain("getAudioChannelMapping");
  });
});

describe("audio channel mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-integer and negative indexes before bridge execution", async () => {
    await expect(tools.set_project_item_audio_channel_mapping.handler({
      item_id: "clip", channel_index: -1, source_channel_index: 0,
    })).resolves.toEqual({ success: false, error: "channel_index must be a non-negative integer" });
    await expect(tools.set_project_item_audio_channel_mapping.handler({
      item_id: "clip", channel_index: 0, source_channel_index: 1.5,
    })).resolves.toEqual({ success: false, error: "source_channel_index must be a non-negative integer" });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("requires Premiere to accept the documented mapping call", async () => {
    await tools.set_project_item_audio_channel_mapping.handler({
      item_id: "clip", channel_index: 1, source_channel_index: 0,
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("mapping.setMappingForChannel(1, 0)");
    expect(script).toContain("accepted !== true");
    expect(script).toContain('verification: "api-return"');
  });
});
