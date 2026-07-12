import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getExportTools } from "../../src/tools/export.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

/** Run a tool handler and return the ExtendScript it generated. */
async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalled();
  return mockedSendCommand.mock.calls[0][0] as string;
}

/**
 * Same, with comments removed. The helpers name the broken APIs in prose to explain
 * why they're avoided ("ProjectItem has no createProxy()"), so an assertion that a
 * method is never *called* has to look at code only.
 */
async function codeFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  const script = await scriptFor(tool, args);
  return script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

beforeEach(() => vi.clearAllMocks());

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/6
describe("issue #6 — markers must use seconds, not ticks", () => {
  const markers = getMarkerTools(bridgeOptions);

  it("add_marker passes seconds straight to createMarker", async () => {
    const script = await scriptFor(markers.add_marker, { time_seconds: 2.0 });

    expect(script).toContain("createMarker(2)");
    // The old bug: __secondsToTicks(2) -> 508032000000 handed to createMarker(),
    // placing the marker ~508 billion seconds down the timeline.
    expect(script).not.toContain("__secondsToTicks(2).toString()");
    expect(script).not.toMatch(/createMarker\(parseFloat/);
  });

  it("add_marker sets marker.end in seconds when given a duration", async () => {
    const script = await scriptFor(markers.add_marker, { time_seconds: 2.0, duration_seconds: 3.0 });

    expect(script).toContain("marker.end = 5");
    expect(script).not.toMatch(/marker\.end = __secondsToTicks/);
  });

  it("list_markers reads Time.seconds rather than re-converting ticks", async () => {
    const script = await scriptFor(markers.list_markers, {});

    expect(script).toContain("startSeconds: marker.start.seconds");
    expect(script).toContain("endSeconds: marker.end.seconds");
    expect(script).not.toContain("__ticksToSeconds(marker.start.ticks)");
  });

  it("delete_marker still compares ticks against ticks", async () => {
    // This path was always correct — both sides are ticks. Guard it so the #6
    // fix doesn't get over-applied here.
    const script = await scriptFor(markers.delete_marker, { time_seconds: 2.0 });

    expect(script).toContain("__secondsToTicks(2)");
    expect(script).toContain("marker.start.ticks");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/7
describe("issue #7 — no calls to nonexistent ExtendScript methods", () => {
  const exportTools = getExportTools(bridgeOptions);
  const trackTargeting = getTrackTargetingTools(bridgeOptions);

  it("manage_proxies never calls ProjectItem.createProxy()", async () => {
    const code = await codeFor(exportTools.manage_proxies, {
      item_id: "clip1",
      action: "create",
      output_path: "/tmp/proxy.mov",
    });

    // ProjectItem has no createProxy(); proxies must go through Media Encoder.
    expect(code).not.toContain("createProxy");
    expect(code).toContain("encodeProjectItem");
  });

  it("manage_proxies 'create' refuses to report false success without an output path", async () => {
    const script = await scriptFor(exportTools.manage_proxies, { item_id: "clip1", action: "create" });

    expect(script).toContain("output_path is required");
    expect(script).not.toContain("Proxy creation started");
  });

  it("manage_proxies 'toggle' reports the state it actually set", async () => {
    const script = await scriptFor(exportTools.manage_proxies, { item_id: "clip1", action: "toggle" });

    // The old code reported !isProxyEnabled() *after* flipping it — i.e. the inverse
    // of the truth, every single time.
    expect(script).toContain("proxiesEnabled: enabled");
    expect(script).not.toContain("proxiesEnabled: !app.project.isProxyEnabled()");
  });

  it("get_encoder_presets never calls encoder.getFormatList()", async () => {
    const code = await codeFor(trackTargeting.get_encoder_presets, { format: "H.264" });

    // EncoderManager has no getFormatList(); presets are found by scanning .epr files.
    expect(code).not.toContain("getFormatList");
    expect(code).toContain("__collectAllPresets()");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/9
describe("issue #9 — frame export uses the QE DOM and verifies the file landed", () => {
  const exportTools = getExportTools(bridgeOptions);
  const utility = getUtilityTools(bridgeOptions);

  const frameTools: Array<[string, { handler: (args: never) => Promise<unknown> }, unknown]> = [
    ["export_frame", exportTools.export_frame, { output_path: "/tmp/f.png" }],
    ["capture_frame", exportTools.capture_frame, {}],
    ["freeze_frame", utility.freeze_frame, { output_path: "/tmp/f.png" }],
  ];

  for (const [name, tool, args] of frameTools) {
    it(`${name} does not call exportFramePNG on the public DOM sequence`, async () => {
      const script = await scriptFor(tool, args);

      // exportFramePNG exists only on the QE sequence. Calling it on
      // app.project.activeSequence throws "seq.exportFramePNG is not a function".
      expect(script).not.toMatch(/seq\.exportFramePNG/);
      expect(script).toContain("__exportStillFrame(");
    });

    it(`${name} surfaces an error instead of claiming success when no file is written`, async () => {
      const script = await scriptFor(tool, args);

      expect(script).toContain("if (!res.ok) return __error(");
    });
  }
});

describe("script-builder helpers used by the fixes are actually defined", () => {
  const exportTools = getExportTools(bridgeOptions);

  it("prepends every helper the generated scripts call", async () => {
    const script = await scriptFor(exportTools.export_frame, { output_path: "/tmp/f.png" });

    for (const helper of [
      "function __exportStillFrame(",
      "function __firstWrittenFile(",
      "function __findStillPreset(",
      "function __collectAllPresets(",
      "function __findProxyPreset(",
      "function __adobeAppFolders(",
      "function __collectEprFiles(",
    ]) {
      expect(script).toContain(helper);
    }
  });
});
