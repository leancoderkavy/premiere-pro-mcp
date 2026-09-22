import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMaskFitTools } from "../../src/tools/mask-fit.js";
import { capabilityForTool } from "../../src/security/capabilities.js";
import { annotationsForTool } from "../../src/workflows/tool-metadata.js";

const bridgeOptions: BridgeOptions = { tempDir: "/tmp/mask-fit-tests", timeoutMs: 5000 };
const mockedSendCommand = vi.mocked(sendCommand);
const tool = getMaskFitTools(bridgeOptions).compute_mask_fit_motion;
const SUBJECT = { left: 0.25, top: 0.2, right: 0.75, bottom: 0.6 };

function hostData(overrides: Record<string, unknown> = {}) {
  return {
    clip: { name: "speaker.png", nodeId: "clip-1", trackIndex: 1 },
    sequence: { width: 1920, height: 1080 },
    source: { name: "speaker.png", width: 2000, height: 3000, pixelAspectRatio: 1, sizeSource: "project_metadata_video_info" },
    motion: {
      found: true,
      properties: [
        { name: "Position", value: [0.5, 0.5], timeVarying: false },
        { name: "Scale", value: 100, timeVarying: false },
        { name: "Uniform Scale", value: true },
        { name: "Rotation", value: 0 },
        { name: "Anchor Point", value: [0.5, 0.5] },
      ],
    },
    mask: {
      found: true,
      clipName: "speaker.png",
      componentName: "Rounded Crop",
      matchName: "Vendor.RoundedCrop",
      properties: [
        { name: "Center", value: [0.5, 0.5] },
        { name: "Width", value: 400 },
        { name: "Height", value: 400 },
        { name: "Roundness", value: 100 },
      ],
    },
    components: ["Opacity", "Motion", "Rounded Crop"],
    maskClipComponents: ["Opacity", "Motion", "Rounded Crop"],
    ...overrides,
  };
}

describe("compute_mask_fit_motion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is classified as a read-only inspect tool", () => {
    expect(capabilityForTool("compute_mask_fit_motion")).toBe("inspect");
    expect(annotationsForTool("compute_mask_fit_motion").readOnlyHint).toBe(true);
  });

  it("reads host state without mutating and returns scale and position in host units", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData() });
    const result = await tool.handler({ node_id: "clip-1", subject: SUBJECT, placement: { top: 0.1, bottom: 0.9 } });
    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.committed).toBe(false);
    expect(data.scale_percent).toBeCloseTo(26.667, 2);
    expect(data.position.host_units).toBe("normalized");
    expect(data.position.apply_value).toEqual(data.position.normalized);
    expect(data.position.pixels.x).toBeCloseTo(960, 2);
    expect(data.inputs.mask.interpretation.method).toBe("center_size");
    expect(data.next_steps[0]).toContain("set_clip_scale");
    expect(data.next_steps[2]).toContain("capture_frame");
    expect(data.warnings.some((warning: string) => warning.includes("same clip"))).toBe(true);

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).not.toMatch(/setValue|addVideoEffect|removeVideoEffect/);
    expect(script).toContain("getProjectMetadata");
    expect(script).toContain('"rounded crop"');
    expect(script).not.toMatch(/\b(let|const)\s|=>/);
  });

  it("escapes user strings and reads the mask from a separate clip", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData() });
    await tool.handler({ node_id: 'clip"1', mask_node_id: "adj\\layer", mask_effect: 'Crop"; bad()', subject: SUBJECT });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('__findClip("clip\\"1")');
    expect(script).toContain('__findClip("adj\\\\layer")');
    expect(script).toContain('"crop\\"; bad()"');
  });

  it("reports pixel units when Premiere returns pixel positions and converts a pixel anchor", async () => {
    const data = hostData();
    data.motion.properties[0].value = [960, 540];
    data.motion.properties[4].value = [1000, 1500];
    mockedSendCommand.mockResolvedValueOnce({ success: true, data });
    const result = await tool.handler({ node_id: "clip-1", mask_node_id: "adj-1", subject: SUBJECT });
    const out = result.data as any;
    expect(out.position.host_units).toBe("pixels");
    expect(out.position.apply_value).toEqual(out.position.pixels);
    expect(out.inputs.motion.anchor_fraction).toEqual({ x: 0.5, y: 0.5 });
    expect(out.warnings.some((warning: string) => warning.includes("same clip"))).toBe(false);
  });

  it("collects motion warnings and leaves units unknown without readback", async () => {
    mockedSendCommand.mockResolvedValueOnce({
      success: true,
      data: hostData({
        motion: {
          found: true,
          properties: [
            { name: "Scale", value: 80, timeVarying: true },
            { name: "Rotation", value: 12 },
            { name: "Uniform Scale", value: false },
          ],
        },
        mask: {
          found: true,
          componentName: "Crop",
          properties: [
            { name: "Left", value: 30, timeVarying: true },
            { name: "Top", value: 10 },
            { name: "Right", value: 30 },
            { name: "Bottom", value: 10 },
            { name: "Zoom", value: true },
          ],
        },
      }),
    });
    const result = await tool.handler({ node_id: "clip-1", subject: SUBJECT, mask_effect: "Crop" });
    const out = result.data as any;
    expect(out.position.host_units).toBe("unknown");
    expect(out.position.apply_value).toBeNull();
    expect(out.next_steps[1]).toContain("position.normalized");
    const joined = out.warnings.join(" ");
    expect(joined).toContain("Rotation is 12");
    expect(joined).toContain("Uniform Scale is off");
    expect(joined).toContain("keyframed (Scale)");
    expect(joined).toContain("Mask parameters are keyframed");
    expect(joined).toContain("Zoom option is on");
  });

  it("uses mask_override and caller source size without requiring mask parameters", async () => {
    mockedSendCommand.mockResolvedValueOnce({
      success: true,
      data: hostData({ source: { name: "x" }, mask: { found: false, properties: [] }, motion: { found: false, properties: [] } }),
    });
    const result = await tool.handler({
      node_id: "clip-1",
      subject: SUBJECT,
      mask_override: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
      source_width: 1000,
      source_height: 1000,
      fit_axis: "width",
      source_prescale: 0.5,
    });
    expect(result.success).toBe(true);
    const out = result.data as any;
    expect(out.inputs.mask.interpretation.method).toBe("override");
    expect(out.inputs.source.sizeSource).toBe("caller");
    expect(out.warnings.some((warning: string) => warning.includes("Motion effect was not found"))).toBe(true);
    expect(mockedSendCommand.mock.calls[0][0]).toContain("if (false)");
  });

  it("fails with the components found when the mask effect is missing", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData({ mask: { found: false, properties: [] } }) });
    const result = await tool.handler({ node_id: "clip-1", subject: SUBJECT });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Components found: Opacity, Motion, Rounded Crop");
  });

  it("fails with the properties found when mask parameters cannot be interpreted", async () => {
    mockedSendCommand.mockResolvedValueOnce({
      success: true,
      data: hostData({ mask: { found: true, componentName: "Rounded Crop", properties: [{ name: "Roundness", value: 50 }, { name: "Color", value: "red" }] } }),
    });
    const result = await tool.handler({ node_id: "clip-1", subject: SUBJECT });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Properties found: Roundness=50; Color=\"red\"");
    expect(result.error).toContain("mask_override");
  });

  it("fails when frame sizes are unavailable", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData({ sequence: {} }) });
    expect((await tool.handler({ node_id: "clip-1", subject: SUBJECT })).error).toContain("sequence frame size");

    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData({ source: { name: "x", width: null, height: null } }) });
    expect((await tool.handler({ node_id: "clip-1", subject: SUBJECT })).error).toContain("source_width and source_height");
  });

  it("passes host errors through and reports geometry errors", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "Clip not found: nope" });
    expect((await tool.handler({ node_id: "nope", subject: SUBJECT })).error).toBe("Clip not found: nope");

    mockedSendCommand.mockResolvedValueOnce({ success: true, data: hostData() });
    const bad = await tool.handler({ node_id: "clip-1", subject: SUBJECT, placement: { top: 0.9, bottom: 0.1 } });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("placement.bottom");
  });

  it("validates arguments before contacting Premiere", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ subject: SUBJECT }, "node_id is required"],
      [{ node_id: "c" }, "subject is required"],
      [{ node_id: "c", subject: { left: 0.8, top: 0, right: 0.2, bottom: 1 } }, "subject.right"],
      [{ node_id: "c", subject: SUBJECT, mask_override: { left: 0, top: 0.5, right: 1, bottom: 0.5 } }, "mask_override.bottom"],
      [{ node_id: "c", subject: SUBJECT, source_width: 100 }, "together"],
      [{ node_id: "c", subject: SUBJECT, mask_space: "clip" }, "mask_space 'clip'"],
      [{ node_id: "c", subject: SUBJECT, mask_effect: "   " }, "must not be empty"],
    ];
    for (const [args, message] of cases) {
      const result = await tool.handler(args as any);
      expect(result.success, message).toBe(false);
      expect(result.error).toContain(message);
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
