import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

type Prop = { displayName: string; value: unknown; getValue: () => unknown; setValue: (value: unknown, update: boolean) => void };

function prop(displayName: string, value: unknown, sticks = true): Prop {
  const p: Prop = {
    displayName,
    value,
    getValue: () => p.value,
    setValue: (next) => { if (sticks) p.value = next; },
  };
  return p;
}

/** Premiere's Motion effect: "Scale" is the height once Uniform Scale is off; there is no "Scale Height". */
function host(props: Prop[]) {
  const motion = { displayName: "Motion", properties: { numItems: props.length, ...props } };
  const clip = { nodeId: "clip-1", name: "A001", components: { numItems: 1, 0: motion } };
  const seq = {
    videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } },
    audioTracks: { numTracks: 0 },
  };
  return { app: { project: { activeSequence: seq } } };
}

async function run(args: { node_id: string; scale_width: number; scale_height: number }, app: unknown) {
  mockedSendCommand.mockClear();
  const result = await getTrackTargetingTools(bridgeOptions).set_scale_width_height.handler(args);
  if (!mockedSendCommand.mock.calls.length) return result as { success: boolean; error?: string };
  const script = mockedSendCommand.mock.calls[0][0] as string;
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, app as object)));
}

beforeEach(() => vi.clearAllMocks());

describe("set_scale_width_height (#642)", () => {
  it("writes the height to Motion > Scale and verifies all three values", async () => {
    const uniform = prop("Uniform Scale", true);
    const scale = prop("Scale", 100);
    const width = prop("Scale Width", 100);
    const result = await run({ node_id: "clip-1", scale_width: 150, scale_height: 80 }, host([prop("Position", [0.5, 0.5]), scale, width, uniform]));
    expect(result).toMatchObject({
      success: true,
      data: { scaleWidth: 150, scaleHeight: 80, uniformScale: false, verified: true, before: { uniformScale: true, scaleWidth: 100, scaleHeight: 100 } },
    });
    expect(scale.value).toBe(80);
    expect(width.value).toBe(150);
    expect(uniform.value).toBe(false);
  });

  it("fails instead of reporting success when a value does not read back", async () => {
    const result = await run(
      { node_id: "clip-1", scale_width: 150, scale_height: 80 },
      host([prop("Scale", 100, false), prop("Scale Width", 100), prop("Uniform Scale", true)]),
    );
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("did not read back") });
  });

  it("refuses before changing anything when the Motion properties are missing", async () => {
    const uniform = prop("Uniform Scale", true);
    const result = await run({ node_id: "clip-1", scale_width: 150, scale_height: 80 }, host([prop("Scale", 100), uniform]));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Nothing was changed") });
    expect(uniform.value).toBe(true);
  });

  it("rejects out-of-range or non-numeric values before building a script", async () => {
    for (const bad of [-1, 10001, Number.NaN, "80); app.quit(" as unknown as number]) {
      const result = await run({ node_id: "clip-1", scale_width: 100, scale_height: bad }, host([]));
      expect(result).toMatchObject({ success: false, error: expect.stringContaining("scale_height must be") });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
