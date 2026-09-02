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
import { getProjectTools } from "../../src/tools/project.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getTextTools } from "../../src/tools/text.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getPlayheadTools } from "../../src/tools/playhead.js";

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

describe("real-host social sequence regressions", () => {
  const sequence = getSequenceTools(bridgeOptions);
  const playhead = getPlayheadTools(bridgeOptions);
  const utility = getUtilityTools(bridgeOptions);

  it("calls Auto Reframe with its required five arguments and reports the derivative", async () => {
    const script = await scriptFor(sequence.auto_reframe_sequence, {
      sequence_id: "source-1",
      target_width: 1080,
      target_height: 1920,
      motion_preset: "faster",
      new_name: "TikTok Test",
    });
    expect(script).toContain('seq.autoReframeSequence(9, 16, "faster", newName, false)');
    expect(script).toContain("if (!reframed) return __error");
    expect(script).toContain("id: reframed.sequenceID");
  });

  it("sets and reads sequence in/out points in seconds with verification", async () => {
    const setScript = await scriptFor(playhead.set_sequence_in_out_points, { in_seconds: 0, out_seconds: 60 });
    expect(setScript).toContain("seq.setInPoint(0)");
    expect(setScript).toContain("seq.setOutPoint(60)");
    expect(setScript).not.toContain("__secondsToTicks(60)");
    expect(setScript).toContain("Math.abs(observedOut - 60)");

    const getScript = await scriptFor(playhead.get_sequence_in_out_points, {});
    expect(getScript).toContain("outSeconds: Number(seq.getOutPoint())");
    expect(getScript).not.toContain("__ticksToSeconds(seq.getOutPoint())");
  });

  it("uses documented DOM work-area accessors instead of unavailable properties and method names", async () => {
    const workArea = await codeFor(playhead.get_work_area, {});
    expect(workArea).toContain("seq.getWorkAreaInPoint()");
    expect(workArea).toContain("seq.getWorkAreaOutPoint()");
    expect(workArea).not.toContain("seq.workInPoint");
    expect(workArea).not.toContain("seq.workOutPoint");

    const enabled = await codeFor(sequence.is_work_area_enabled, {});
    expect(enabled).toContain("seq.isWorkAreaEnabled()");
    expect(enabled).not.toContain("seq.isWorkAreaBarEnabled()");
  });

  it("matches a sequence through projectItem.nodeId and verifies both names", async () => {
    const script = await scriptFor(utility.rename_project_item, { item_id: "item-1", new_name: "Instagram Test" });
    expect(script).toContain("candidate.projectItem.nodeId === item.nodeId");
    expect(script).toContain('sequence.name = "Instagram Test"');
    expect(script).toContain("sequence && sequence.name !==");
  });
});

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

  it("probes an exact QE effect name before treating an empty catalog as unavailable", async () => {
    const script = await scriptFor(effects.apply_effect, {
      node_id: "clip-1",
      effect_name: "Transform",
    });

    expect(script).toContain("qe.project.getVideoEffectByName(effectName)");
    expect(script).toContain('var effectCatalog = __getQeEffectCatalog("video")');
    expect(script).toContain("Direct QE lookup for");
    expect(script).toContain('lookupSource: lookupSource');

    const listScript = await scriptFor(effects.list_available_effects, {});
    expect(listScript).toContain("var commonNames = [");
    expect(listScript).toContain("qe.byName.partial");
    expect(listScript).toContain("Direct lookup did not resolve any bounded fallback effects.");

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

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/235
describe("issue #235 — CEP tool calls use the host's documented argument types", () => {
  const utility = getUtilityTools(bridgeOptions);
  const tracks = getTrackTargetingTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("uses a string-backed pixel aspect ratio and verifies the settings readback", async () => {
    const script = await scriptFor(utility.set_sequence_pixel_aspect_ratio, { ratio: "1.0" });

    expect(utility.set_sequence_pixel_aspect_ratio.parameters.properties.ratio).toMatchObject({ type: "string" });
    expect(script).toContain('settings.videoPixelAspectRatio = "1.0"');
    expect(script).toContain("seq.getSettings()");
    expect(script).toContain("Premiere did not apply the requested sequence pixel aspect ratio");
  });

  it("clears sequence points with seconds derived from their tick values", async () => {
    const script = await scriptFor(tracks.clear_sequence_in_out, {});

    expect(script).toContain("var zeroSeconds = __ticksToSeconds(seq.zeroPoint)");
    expect(script).toContain("var endSeconds = __ticksToSeconds(seq.end)");
    expect(script).toContain("seq.setInPoint(zeroSeconds)");
    expect(script).toContain("seq.setOutPoint(endSeconds)");
    expect(script).not.toContain("seq.zeroPoint.ticks");
  });

  it("passes every positional bars-and-tone argument and captures the created item", async () => {
    const script = await scriptFor(project.create_bars_and_tone, {
      width: 1920,
      height: 1080,
      pixel_aspect_numerator: 1,
      pixel_aspect_denominator: 1,
      audio_sample_rate: 48000,
      name: "Bars",
    });

    expect(script).toContain("app.project.newBarsAndTone(");
    expect(script).toContain("1920,");
    expect(script).toContain("1080,");
    expect(script).toContain("1,");
    expect(script).toContain("48000,");
    expect(script).toContain('"Bars"');
    expect(script).toContain("if (!item) return __error");
  });

  it("writes the Anti-flicker numeric stream value and verifies it", async () => {
    const script = await scriptFor(tracks.set_anti_alias_quality, { node_id: "clip-1", enabled: false });

    expect(script).toContain("var requestedValue = 0");
    expect(script).toContain("antiFlicker.setValue(requestedValue, 1)");
    expect(script).toContain("antiFlicker.getValue()");
    expect(script).not.toContain("Use Composition's Shutter Angle");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/236
describe("issue #236 — CEP tools supply required positional arguments", () => {
  const advanced = getAdvancedTools(bridgeOptions);
  const text = getTextTools(bridgeOptions);

  it("passes action, linked-audio, and sensitivity to scene detection", async () => {
    const script = await scriptFor(advanced.scene_edit_detection, {
      action: "CreateMarkers",
      apply_cuts_to_linked_audio: false,
      sensitivity: "MediumSensitivity",
    });

    expect(script).toContain("seq.performSceneEditDetectionOnSelection(");
    expect(script).toContain('"CreateMarkers"');
    expect(script).toContain("false,");
    expect(script).toContain('"MediumSensitivity"');
    expect(script).toContain("Select at least one clip");
  });

  it("passes the Creative Cloud Library name before the MOGRT name", async () => {
    const script = await scriptFor(text.import_mogrt_from_library, {
      library_name: "Brand Library",
      mogrt_name: "Lower Third",
    });

    expect(text.import_mogrt_from_library.parameters.required).toEqual(["library_name", "mogrt_name"]);
    expect(script).toContain("seq.importMGTFromLibrary(");
    expect(script).toContain('libraryName,');
    expect(script).toContain('mogrtName,');
    expect(script).toContain("startTicks,");
  });

  it("fails raw-text overlay creation before sending an unsupported bridge call", async () => {
    const result = await text.add_text_overlay.handler({ text: "Title" });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("No mutation was attempted") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/237
describe("issue #237 — reported mutations must be observable or fail", () => {
  const advanced = getAdvancedTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);
  const tracks = getTrackTargetingTools(bridgeOptions);
  const media = getMediaTools(bridgeOptions);
  const exports = getExportTools(bridgeOptions);

  it("makes trim tools read back their claimed changes", async () => {
    const slide = await scriptFor(advanced.slide_edit, { node_id: "clip-1", offset_seconds: 1 });
    const slip = await scriptFor(advanced.slip_edit, { node_id: "clip-1", offset_seconds: 1 });
    const roll = await scriptFor(advanced.roll_edit, { node_id: "clip-1", offset_seconds: 1 });

    expect(slide).toContain("The slide edit returned without an observable timeline change");
    expect(roll).toContain("The roll edit returned without an observable timeline change");
    expect(slip).toContain("The slip edit returned without an observable source in/out change");
    expect(slip).toContain("verified: true");
  });

  it("uses structural receipts for import and duplicate consolidation", async () => {
    const imports = await scriptFor(project.import_sequences, {
      project_path: "/tmp/source.prproj",
      sequence_ids: ["source-sequence-id"],
    });
    const duplicates = await scriptFor(project.consolidate_duplicates, {});

    expect(imports).toContain("new File");
    expect(imports).toContain("beforeIds");
    expect(duplicates).toContain("var nodeId = String(item.nodeId || \"\")");
    expect(duplicates).toContain("pathMap[mediaPath].nodeIds[nodeId]");
    expect(imports).toContain("Premiere did not add any of the requested sequences");
    expect(duplicates).toContain("__duplicateMediaStats");
    expect(duplicates).toContain("duplicate media groups did not decrease");
  });

  it("checks image imports, source-point writes, disable state, and offline state", async () => {
    const image = await scriptFor(tracks.import_image_sequence, { first_file_path: "/tmp/frame_001.png" });
    const points = await scriptFor(tracks.set_item_in_out, { item_id: "item-1", in_seconds: 1 });
    const enabled = await scriptFor(tracks.batch_enable_disable, { target: "selected", enabled: false });
    const offline = await scriptFor(media.set_offline, { item_id: "item-1", offline: false });

    expect(image).toContain("sourceFile.exists");
    expect(image).toContain("Premiere accepted the image-sequence import but no project item was added");
    expect(points).toContain("item.getInPoint");
    expect(points).toContain("Premiere did not apply the requested project-item in point");
    expect(enabled).toContain("track.clips[c].disabled = disabled");
    expect(enabled).toContain("No clips matched target 'selected'");
    expect(offline).toContain("item.refreshMedia()");
    expect(offline).toContain("item.isOffline()");
  });

  it("labels sequence close as a tab operation and verifies an OMF file", async () => {
    const close = await scriptFor(advanced.close_sequence, { sequence_id: "sequence-1" });
    const omf = await scriptFor(exports.export_omf, { output_path: "/tmp/export.omf" });

    expect(close).toContain("timelineTabCloseRequested: true");
    expect(close).toContain("sequenceRetainedInProject");
    expect(omf).toContain("outputFile.exists");
    expect(omf).toContain("Premiere did not write the requested OMF file");
    expect(exports.export_omf.parameters.properties.include_pan).toMatchObject({ type: "boolean" });
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/238
describe("issue #238 — AME uses canonical paths and documented encodeFile positions", () => {
  const exports = getExportTools(bridgeOptions);

  it("captures AME job IDs and does not present queueing as a completed encode", async () => {
    const queued = await scriptFor(exports.add_to_render_queue, { output_path: "/tmp/render.mp4" });
    const projectItem = await scriptFor(exports.encode_project_item, {
      item_id: "item-1",
      output_path: "/tmp/render.mp4",
      preset_path: "/tmp/preset.epr",
    });

    expect(queued).toContain("var outputFile = new File");
    expect(queued).toContain("var jobId = encoder.encodeSequence");
    expect(queued).toContain("Queue presence and output-file creation are not verified");
    expect(projectItem).toContain("outputFile.fsName");
    expect(projectItem).toContain("var jobId = app.encoder.encodeProjectItem");
  });

  it("passes work area before removal and never passes undefined Time values", async () => {
    const wholeFile = await scriptFor(exports.encode_file, {
      input_path: "/tmp/source.mov",
      output_path: "/tmp/render.mp4",
      preset_path: "/tmp/preset.epr",
    });
    const range = await scriptFor(exports.encode_file, {
      input_path: "/tmp/source.mov",
      output_path: "/tmp/render.mp4",
      preset_path: "/tmp/preset.epr",
      in_seconds: 1,
      out_seconds: 2,
    });

    expect(wholeFile).toContain("var srcIn = new Time()");
    expect(wholeFile).toContain("var workArea = 0");
    expect(range).toContain("var workArea = 1");
    expect(range).toContain("workArea,");
    expect(range).not.toContain("var srcIn = undefined");
    expect(range).toContain("var jobId = app.encoder.encodeFile");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/322
describe("issue #322 — marker filtering retains the requested sequence collection", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("resolves the requested sequence once and returns its identity with the marker set", async () => {
    const script = await scriptFor(utility.get_sequence_markers_by_type, {
      sequence_id: "target-sequence", marker_type: "Comment",
    });

    expect(script).toContain('var seq = __findSequence("target-sequence")');
    expect(script).toContain("var selectedSequence = { id: String(seq.sequenceID)");
    expect(script).toContain("var markerCollection = seq.markers");
    expect(script).toContain("markerCollection.getFirstMarker()");
    expect(script).toContain("markerCollection.getNextMarker(m)");
    expect(script).toContain("sequence: selectedSequence");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/323
describe("issue #323 — AME handoffs are unverified until a queue or file readback", () => {
  const exports = getExportTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("does not present AME acceptance as a queued, started, or completed encode", async () => {
    const render = await scriptFor(exports.add_to_render_queue, { output_path: "/tmp/render.mp4" });
    const item = await scriptFor(exports.encode_project_item, {
      item_id: "item-1", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr",
    });
    const proxy = await scriptFor(exports.manage_proxies, {
      item_id: "item-1", action: "create", output_path: "/tmp/proxy.mov", preset_path: "/tmp/proxy.epr",
    });
    const file = await scriptFor(exports.encode_file, {
      input_path: "/tmp/source.mov", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr",
    });
    const batch = await scriptFor(project.start_batch_encode, {});

    for (const script of [render, item, proxy, file]) {
      expect(script).toContain('if (!jobId || String(jobId) === "0") return __error');
      expect(script).toContain("accepted: true");
      expect(script).toContain('outcome: "committed_unverified"');
      expect(script).not.toContain("queued: true");
    }
    expect(batch).toContain("requested: true");
    expect(batch).toContain('outcome: "committed_unverified"');
    expect(batch).not.toContain("started: true");
    expect(batch).toContain("var startResult = app.encoder.startBatch()");
    expect(batch).toContain("if (startResult !== 1 && startResult !== true)");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/324
describe("issue #324 — duplicate media requires distinct project-item node IDs", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("deduplicates each media path by stable node ID before forming a group", async () => {
    const script = await scriptFor(utility.get_duplicate_media, {});

    expect(script).toContain("var nodeId = String(item.nodeId || \"\")");
    expect(script).toContain("pathMap[mp] = { items: [], nodeIds: {} }");
    expect(script).toContain("if (!pathMap[mp].nodeIds[nodeId])");
    expect(script).toContain("pathMap[path].items.length > 1");
    expect(script).not.toContain("pathMap[path].length > 1");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/326
describe("issue #326 — sequence creation requires project-collection readback", () => {
  const sequence = getSequenceTools(bridgeOptions);

  it("does not report a QE-active sequence as created unless it is discoverable", async () => {
    const script = await scriptFor(sequence.create_sequence, {
      name: "Verified Sequence", preset_path: "/tmp/sequence.sqpreset",
    });
    expect(script).toContain("var sequenceId = String(seq.sequenceID)");
    expect(script).toContain("var created = __findSequence(sequenceId)");
    expect(script).toContain("no creation success is reported");
    expect(script).toContain("verified: true");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/327
describe("issue #327 — legacy media replacement is fail-closed", () => {
  const clipboard = getClipboardTools(bridgeOptions);

  it("never uses overwriteClip when duration and adjacent-track preservation cannot be verified", async () => {
    expect(clipboard.replace_clip_media.operationalCapability).toMatchObject({
      backend: "local", backends: ["local"], status: "unsupported", hostVerificationRequired: false,
    });
    const result = await clipboard.replace_clip_media.handler({ clip_node_id: "clip-1", new_item_id: "item-2" } as never);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("No mutation was attempted") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
