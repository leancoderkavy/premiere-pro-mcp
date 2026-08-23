import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
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
import { getEffectsTools } from "../../src/tools/effects.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTextTools } from "../../src/tools/text.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getCaptionTools } from "../../src/tools/captions.js";

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

  it("sets and restores the AME one-frame range in seconds", () => {
    const helpers = getHelpersSource();

    // Sequence.setInPoint/setOutPoint accept seconds. Passing ticks here made
    // the fallback target an enormous range and prevented a still from landing.
    expect(helpers).toContain("seq.setInPoint(__ticksToSeconds(startTicks))");
    expect(helpers).toContain("seq.setOutPoint(__ticksToSeconds(startTicks + frameTicks))");
    expect(helpers).toContain("seq.setInPoint(__ticksToSeconds(savedIn))");
    expect(helpers).toContain("seq.setOutPoint(__ticksToSeconds(savedOut))");
    expect(helpers).not.toContain("seq.setInPoint(String(startTicks))");
  });
});

// Defects found while reviewing PR #3 (repair 6 broken tools on Premiere Pro 2026).
describe("PR #3 follow-ups — color_correct and export_sequence", () => {
  const effects = getEffectsTools(bridgeOptions);
  const exportTools = getExportTools(bridgeOptions);

  it("color_correct applies a value of 0 exactly once", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", saturation: 0 });

    // saturation: 0 is a valid full desaturate. Guarding on `!changes.saturation`
    // leaves the guard permanently open for 0, re-firing setValue on every later
    // Lumetri sub-section that repeats the "Saturation" display name.
    expect(code).toContain("!taken.saturation");
    expect(code).toContain("taken.saturation = true");
    expect(code).not.toContain("!changes.saturation");
  });

  it("color_correct carries no dead helper", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", exposure: 1 });
    expect(code).not.toContain("trySet");
  });

  it("color_correct only emits setters for the controls it was given", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", exposure: 1.5 });

    expect(code).toContain('name === "Exposure"');
    expect(code).not.toContain('name === "Saturation"');
  });

  it("export_sequence finds its default preset without hardcoding a version year", async () => {
    const code = await codeFor(exportTools.export_sequence, { output_path: "/tmp/out.mp4" });

    expect(code).toContain("__findH264Preset()");
    // Hardcoded install paths rot the moment Adobe ships the next version.
    expect(code).not.toContain("Adobe Media Encoder 2025");
    expect(code).not.toContain("Adobe Media Encoder 2026");
  });
});

describe("script-builder helpers used by the fixes are actually defined", () => {
  const exportTools = getExportTools(bridgeOptions);

  it("defines every helper the generated scripts call", async () => {
    const script = getHelpersSource();

    for (const helper of [
      "function __exportStillFrame(",
      "function __firstWrittenFile(",
      "function __findStillPreset(",
      "function __collectAllPresets(",
      "function __findProxyPreset(",
      "function __findH264Preset(",
      "function __adobeAppFolders(",
      "function __collectEprFiles(",
    ]) {
      expect(script).toContain(helper);
    }
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/189
describe("issue #189 — Premiere 26.3 capability boundaries and macOS presets", () => {
  const trackTargeting = getTrackTargetingTools(bridgeOptions);
  const timeline = getTimelineTools(bridgeOptions);
  const advanced = getAdvancedTools(bridgeOptions);
  const text = getTextTools(bridgeOptions);
  const keyframes = getKeyframeTools(bridgeOptions);
  const captions = getCaptionTools(bridgeOptions);

  it("searches resources inside macOS application bundles and normalizes H.264 filters", async () => {
    const helpers = getHelpersSource();
    const code = await codeFor(trackTargeting.get_encoder_presets, { format: "H.264" });

    expect(helpers).toContain("function __adobeApplicationResourceFolder(");
    expect(helpers).toContain('"/Contents/"');
    expect(helpers).toContain('"MediaIO/systempresets"');
    expect(code).toContain('__presetSearchText("H.264")');
    expect(code).toContain("__presetSearchText(p.name)");
  });

  it("never calls unsupported speed setters", async () => {
    const variants = [
      timeline.speed_change.handler({ node_id: "clip-1", speed_percent: 65 }),
      advanced.set_clip_speed_qe.handler({ node_id: "clip-1", speed_percent: 65 }),
      timeline.set_clip_properties.handler({ node_id: "clip-1", speed: 0.65 }),
    ];

    await expect(Promise.all(variants)).resolves.toEqual([
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
    ]);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("fails raw-text caption creation before it can call an unsupported signature", async () => {
    const result = await text.add_text_overlay.handler({ text: "TREINO UPPER" });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining("No mutation was attempted"),
    }));
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("labels keyframe and caption results as storage or structure verification, not rendered output", async () => {
    const keyframeScript = await scriptFor(keyframes.add_keyframe, {
      node_id: "clip-1", effect_name: "Opacity", property_name: "Opacity", time_seconds: 0, value: 0,
    });
    expect(keyframeScript).toContain("getValueAtKey(time)");
    expect(keyframeScript).toContain("renderVerified: false");
    expect(keyframeScript).toContain("Premiere parameter readback only");

    const captionScript = await scriptFor(captions.create_caption_track, { item_id: "captions.srt" });
    expect(captionScript).toContain("renderVerified: false");
    expect(captionScript).toContain("verify playback or exported frames");
  });

  it("validates and structurally verifies timeline insertion instead of trusting insertClip", async () => {
    const invalid = await timeline.add_to_timeline.handler({ item_id: "clip-1", start_seconds: -1 });
    expect(invalid).toEqual(expect.objectContaining({ success: false }));
    expect(mockedSendCommand).not.toHaveBeenCalled();

    const script = await scriptFor(timeline.add_to_timeline, {
      item_id: "clip-1", track_index: 0, audio_track_index: 0, start_seconds: 3.4,
    });
    expect(script).toContain("beforeVideoCount");
    expect(script).toContain("afterVideoCount > beforeVideoCount + 1");
    expect(script).toContain("residual frame fragment");
    expect(script).toContain("matchedItem");
    expect(script).toContain("verified: true");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/194
describe("issue #194 — string-backed MOGRT effect properties", () => {
  const keyframes = getKeyframeTools(bridgeOptions);

  it("accepts and safely serializes the JSON string exposed by MOGRT text properties", async () => {
    expect(keyframes.set_effect_property.parameters.properties.value).toMatchObject({
      type: ["number", "string"],
    });

    const script = await scriptFor(keyframes.set_effect_property, {
      node_id: "clip-1",
      effect_name: "AE.ADBE Capsule",
      property_name: "Source Text",
      value: '{"textEditValue":"Hello \\"editor\\""}',
    });

    expect(script).toContain('var requestedValue = "{\\"textEditValue\\":\\"Hello \\\\\\\"editor\\\\\\\"\\"}";');
    expect(script).toContain("prop.setValue(requestedValue, true)");
    expect(script).toContain("readbackVerified: readbackAvailable && readbackValue === requestedValue");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/196
describe("issue #196 — empty Premiere 26.x QE effect catalogs", () => {
  const effects = getEffectsTools(bridgeOptions);

  it("routes an empty legacy QE catalog to the documented UXP effect workflow, not an effect-name miss", async () => {
    const script = await scriptFor(effects.apply_effect, {
      node_id: "clip-1",
      effect_name: "Transform",
    });

    expect(script).toContain('var effectCatalog = __getQeEffectCatalog("video")');
    expect(script).toContain("if (!effectCatalog.ok) return __error(effectCatalog.error)");

    const helpers = getHelpersSource();
    expect(helpers).toContain("function __getQeEffectCatalog(kind)");
    expect(helpers).toContain("Premiere returned an empty legacy QE");
    expect(helpers).toContain("no effect was applied");
    expect(helpers).toContain("manage_clip_effects_uxp");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/129
describe("issue #129 — CEP component removal is capability-gated", () => {
  const effects = getEffectsTools(bridgeOptions);
  const clipboard = getClipboardTools(bridgeOptions);

  it.each([
    ["index", { node_id: "clip1", effect_index: 3 }],
    ["name", { node_id: "clip1", effect_name: "Amplify" }],
  ])("remove_effect by %s guards an unavailable Component.remove()", async (_mode, args) => {
    const code = await codeFor(effects.remove_effect, args);

    expect(code).toContain('typeof component.remove !== "function"');
    expect(code).toContain("No safe targeted QE fallback exists");
    expect(code).toContain("return __error(removal.error)");
    expect(code).not.toContain("qeClip.removeEffects()");
  });

  it("preflights every matching component before remove_effect_by_name mutates any", async () => {
    const code = await codeFor(clipboard.remove_effect_by_name, {
      node_id: "clip1",
      effect_name: "Amplify",
    });

    expect(code).toContain("var matches = []");
    expect(code).toContain("if (!canRemoveComponent(component))");
    expect(code).toContain("No matching components were removed");
    expect(code).not.toContain("qeClip.removeEffects()");
    expect(code.indexOf("if (!canRemoveComponent(component))"))
      .toBeLessThan(code.lastIndexOf("component.remove()"));
  });

  it("documents the capability boundary in each targeted removal tool", () => {
    expect(effects.remove_effect.description).toContain("capability error");
    expect(clipboard.remove_effect_by_name.description).toContain("capability error");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/37
describe("issue #37 — sequence frame rate uses ticks per frame", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("converts fps to a Time duration and verifies the applied ticks", async () => {
    const script = await scriptFor(utility.set_sequence_frame_rate, { frame_rate: 30 });

    expect(script).toContain("TICKS_PER_SECOND / requestedFps");
    expect(script).toContain("var frameDuration = new Time()");
    expect(script).toContain("frameDuration.ticks = requestedTicks.toString()");
    expect(script).toContain("settings.videoFrameRate = frameDuration");
    expect(script).toContain("Math.abs(appliedTicks - requestedTicks) > 1");
    expect(script).not.toContain("settings.videoFrameRate = 30");
  });

  it("rejects invalid frame rates before sending a Premiere command", async () => {
    mockedSendCommand.mockClear();
    const result = await utility.set_sequence_frame_rate.handler({ frame_rate: 0 });

    expect(result).toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
