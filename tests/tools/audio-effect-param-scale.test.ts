import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import {
  AUDIO_EFFECT_SCALE_WARNING,
  HIGHPASS_CUTOFF_MEASUREMENTS,
  HIGHPASS_DEFAULT_WARNING,
  annotateEffectPropertiesResult,
  annotateSetEffectPropertyResult,
  audioValueScale,
} from "../../src/tools/audio-effect-param-scale.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridge = { tempDir: "/tmp/audio-effect-param-scale", timeoutMs: 5_000 };
const TICKS = 254016000000;

class MockTime { ticks = "0"; }

function collection<T>(items: T[]) {
  Object.defineProperty(items, "numItems", { get: () => items.length });
  return items as T[] & { numItems: number };
}

function parameter(displayName: string, initial: unknown, clamp = false) {
  let value = initial;
  return {
    displayName,
    getValue: vi.fn(() => value),
    setValue: vi.fn((next: unknown) => {
      value = clamp && typeof next === "number" ? Math.min(1, Math.max(0, next)) : next;
    }),
    getColorValue: vi.fn(() => { throw new Error("Unknown error exception"); }),
    isTimeVarying: vi.fn(() => false),
    areKeyframesSupported: vi.fn(() => true),
  };
}

type Param = ReturnType<typeof parameter>;

function host(trackType: "audio" | "video", components: Array<{ displayName: string; matchName: string; properties: Param[] }>) {
  const clip = {
    nodeId: "clip", name: "Clip", start: { ticks: "0" }, end: { ticks: String(10 * TICKS) },
    components: collection(components.map((component) => ({ ...component, properties: collection(component.properties) }))),
  };
  const withClip = collection([{ clips: collection([clip]) }]) as unknown as { numTracks: number };
  withClip.numTracks = 1;
  const empty = collection([]) as unknown as { numTracks: number };
  empty.numTracks = 0;
  const context = createContext({
    Time: MockTime,
    app: {
      project: {
        activeSequence: {
          timebase: String(TICKS / 25),
          videoTracks: trackType === "video" ? withClip : empty,
          audioTracks: trackType === "audio" ? withClip : empty,
        },
      },
    },
  });
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(runInContext(getHelpersSource() + "\n" + script, context) as string) as never);
}

function highpass(cutoff = 0.25, clamp = false) {
  const bypass = parameter("Bypass", false);
  const cutoffParam = parameter("Cutoff", cutoff, clamp);
  return { component: { displayName: "Highpass", matchName: "Internal Highpass", properties: [bypass, cutoffParam] }, cutoffParam };
}

const keyframes = getKeyframeTools(bridge);

beforeEach(() => vi.resetAllMocks());

describe("audio effect parameter scale on get_effect_properties", () => {
  it("marks audio effect parameters as normalized, warns, and attaches measured Highpass guidance", async () => {
    const { component } = highpass();
    host("audio", [component]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Highpass" }) as any;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ trackType: "audio", builtInComponent: false, parameterScale: { kind: "normalized_0_1", basis: "inferred", documentedMapping: false } });
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING, HIGHPASS_DEFAULT_WARNING]);
    expect(result.data.properties[0]).toEqual({ index: 0, displayName: "Bypass", isTimeVarying: false, keyframesSupported: true, value: false });
    expect(result.data.properties[1]).toMatchObject({ displayName: "Cutoff", value: 0.25, valueScale: "normalized_0_1", measuredGuidance: HIGHPASS_CUTOFF_MEASUREMENTS });
    expect(result.data.properties[1]).not.toHaveProperty("displayValue");
    expect(result.data.properties[1]).not.toHaveProperty("displayUnits");
  });

  it("omits the default-cutoff warning once the cutoff has been lowered", async () => {
    host("audio", [highpass(0.047).component]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Highpass" }) as any;
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING]);
  });

  it("does not claim a scale for audio effect values outside 0-1 and gives other effects no Highpass guidance", async () => {
    const threshold = parameter("Threshold", 1);
    const raw = parameter("Raw Plug-in Value", 440);
    host("audio", [{ displayName: "Single-band Compressor", matchName: "2da3e2bc-5005-481c-bbeb-7689d3169edf", properties: [threshold, raw] }]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Single-band Compressor" }) as any;
    expect(result.data.properties[0]).toMatchObject({ valueScale: "normalized_0_1" });
    expect(result.data.properties[0]).not.toHaveProperty("measuredGuidance");
    expect(result.data.properties[1]).toMatchObject({ value: 440, valueScale: "host_raw_unknown" });
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING]);
  });

  it("leaves video effects and built-in audio components unlabelled, and converts Volume Level to dB", async () => {
    host("video", [{ displayName: "Gaussian Blur", matchName: "AE.ADBE Gaussian Blur 2", properties: [parameter("Blurriness", 0.5)] }]);
    const video = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Gaussian Blur" }) as any;
    expect(video.data).toMatchObject({ trackType: "video", builtInComponent: false });
    expect(video.data).not.toHaveProperty("warnings");
    expect(video.data).not.toHaveProperty("parameterScale");
    expect(video.data.properties[0]).not.toHaveProperty("valueScale");

    const level = parameter("Level", 0.17782794100389226);
    host("audio", [
      { displayName: "Volume", matchName: "Internal Volume Stereo", properties: [parameter("Bypass", false), level] },
      { displayName: "Channel Volume", matchName: "Internal Channel Volume Stereo", properties: [parameter("Left", 0.5)] },
    ]);
    const volume = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Volume" }) as any;
    expect(volume.data).toMatchObject({ trackType: "audio", builtInComponent: true });
    expect(volume.data).not.toHaveProperty("warnings");
    expect(volume.data.properties[1]).toMatchObject({ value: 0.17782794100389226, displayValue: 0, displayUnits: "dB" });
    expect(volume.data.properties[1]).not.toHaveProperty("valueScale");
    const channel = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Channel Volume" }) as any;
    expect(channel.data.properties[0]).not.toHaveProperty("displayValue");
    expect(channel.data.properties[0]).not.toHaveProperty("valueScale");
  });

  it("treats the localized Balance built-in as built in", async () => {
    host("audio", [{ displayName: "Equilibrio", matchName: "Internal Audio Balance", properties: [parameter("Equilibrio", 0.5)] }]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Equilibrio" }) as any;
    expect(result.data.builtInComponent).toBe(true);
    expect(result.data).not.toHaveProperty("warnings");
  });

  it("passes failures through untouched", async () => {
    host("audio", [highpass().component]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Missing" }) as any;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Effect not found") });
    expect(result.data ?? null).toBeNull();
  });
});

// Component identities read live from Premiere 26.5.2 (macOS, en-US). Effects
// share the "Internal " prefix with the intrinsics or use GUID match names.
const LIVE_EFFECTS = [
  { displayName: "Highpass", matchName: "Internal Highpass", property: "Cutoff", value: 0.25 },
  { displayName: "Simple Parametric EQ", matchName: "Internal Parameteric EQ", property: "Boost", value: 0.5 },
  { displayName: "DeEsser", matchName: "ffbe710f-cd69-4139-ad26-65603616d9d4", property: "Threshold", value: 0.625 },
  { displayName: "Single-band Compressor", matchName: "2da3e2bc-5005-481c-bbeb-7689d3169edf", property: "Ratio", value: 0 },
  { displayName: "Hard Limiter", matchName: "e0b23f05-f1a7-4ef7-9b50-7ec3e3002058", property: "Release", value: 0.375 },
];

describe("live 26.5.2 audio component identities", () => {
  it.each(LIVE_EFFECTS)("labels $displayName ($matchName) as a normalized audio effect", async ({ displayName, matchName, property, value }) => {
    host("audio", [{ displayName, matchName, properties: [parameter("Bypass", false), parameter(property, value)] }]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: displayName }) as any;
    expect(result.data).toMatchObject({ matchName, builtInComponent: false, parameterScale: { kind: "normalized_0_1" } });
    expect(result.data.warnings).toContain(AUDIO_EFFECT_SCALE_WARNING);
    expect(result.data.properties[1]).toMatchObject({ displayName: property, value, valueScale: "normalized_0_1" });
  });

  it.each(LIVE_EFFECTS)("refuses 80 for $displayName before writing", async ({ displayName, matchName, property, value }) => {
    const target = parameter(property, value, true);
    host("audio", [{ displayName, matchName, properties: [parameter("Bypass", false), target] }]);
    const result = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: matchName, property_name: property, value: 80 }) as any;
    expect(result).toMatchObject({ success: false, data: { outcome: "not_applied", builtInComponent: false, matchName } });
    expect(target.setValue).not.toHaveBeenCalled();
  });

  it("keeps the live intrinsics built in, with Volume Level in dB", async () => {
    host("audio", [
      { displayName: "Volume", matchName: "Internal Volume Stereo", properties: [parameter("Bypass", false), parameter("Level", 0.1778279410038923)] },
      { displayName: "Channel Volume", matchName: "Internal Channel Volume Stereo", properties: [parameter("Left", 0.1778279410038923)] },
      { displayName: "Balance", matchName: "Internal Audio Balance", properties: [parameter("Balance", 0)] },
      { displayName: "Panner", matchName: "", properties: [parameter("Pan", 0)] },
      { displayName: "Highpass", matchName: "Internal Highpass", properties: [parameter("Cutoff", 0.25)] },
    ]);
    const volume = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Internal Volume Stereo" }) as any;
    expect(volume.data).toMatchObject({ builtInComponent: true });
    expect(volume.data).not.toHaveProperty("warnings");
    expect(volume.data.properties[1]).toMatchObject({ value: 0.1778279410038923, displayValue: 0, displayUnits: "dB" });
    for (const name of ["Channel Volume", "Balance", "Panner"]) {
      const intrinsic = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: name }) as any;
      expect(intrinsic.data).toMatchObject({ builtInComponent: true });
      expect(intrinsic.data).not.toHaveProperty("parameterScale");
    }
    // Balance takes raw -100..100 values (set_clip_pan), so it must not be guarded.
    const pan = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Internal Audio Balance", property_name: "Balance", value: 50 }) as any;
    expect(pan).toMatchObject({ success: true, data: { outcome: "verified", value: 50, builtInComponent: true } });
    expect(pan.data).not.toHaveProperty("warnings");
  });

  it("keeps the remove-safety classifier unchanged for video clips", async () => {
    host("video", [{ displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: [parameter("Opacity", 100)] }]);
    const result = await keyframes.get_effect_properties.handler({ node_id: "clip", effect_name: "Opacity" }) as any;
    expect(result.data).toMatchObject({ trackType: "video", builtInComponent: true });
  });
});

describe("audio effect parameter scale on set_effect_property", () => {
  it("refuses a value outside 0-1 before writing a normalized audio parameter", async () => {
    const { component, cutoffParam } = highpass(0.25, true);
    host("audio", [component]);
    const result = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Highpass", property_name: "Cutoff", value: 80 }) as any;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("normalized 0-1 value, not Hz, dB or ms") });
    expect(result.error).toContain("Nothing was changed");
    expect(result.data).toMatchObject({ outcome: "not_applied", set: false, value: 0.25, requestedValue: 80, valueScale: "host_raw_unknown", measuredGuidance: HIGHPASS_CUTOFF_MEASUREMENTS });
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING]);
    expect(cutoffParam.setValue).not.toHaveBeenCalled();
  });

  it("writes a normalized value and annotates the verified result", async () => {
    const { component, cutoffParam } = highpass(0.25, true);
    host("audio", [component]);
    const result = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Internal Highpass", property_name: "Cutoff", value: 0.047 }) as any;
    expect(result).toMatchObject({ success: true, data: { outcome: "verified", value: 0.047, valueScale: "normalized_0_1", effectDisplayName: "Highpass", propertyDisplayName: "Cutoff", trackType: "audio", builtInComponent: false } });
    expect(result.data.measuredGuidance).toEqual(HIGHPASS_CUTOFF_MEASUREMENTS);
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING]);
    expect(cutoffParam.setValue).toHaveBeenCalledWith(0.047, true);
  });

  it("allows an explicit raw write and reports the host clamp as a failed readback", async () => {
    const { component, cutoffParam } = highpass(0.25, true);
    host("audio", [component]);
    const result = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Highpass", property_name: "Cutoff", value: 80, allow_out_of_range_audio_value: true }) as any;
    expect(cutoffParam.setValue).toHaveBeenCalledWith(80, true);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("readback does not match"), data: { outcome: "failed", value: 1, valueScale: "host_raw_unknown" } });
    expect(result.data.warnings).toEqual([AUDIO_EFFECT_SCALE_WARNING]);
  });

  it("writes raw values when the current audio value is already outside 0-1", async () => {
    const raw = parameter("Frequency", 440);
    host("audio", [{ displayName: "Third Party EQ", matchName: "VST3 Third Party EQ", properties: [raw] }]);
    const result = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Third Party EQ", property_name: "Frequency", value: 1000 }) as any;
    expect(result).toMatchObject({ success: true, data: { outcome: "verified", value: 1000, valueScale: "host_raw_unknown" } });
    expect(raw.setValue).toHaveBeenCalledWith(1000, true);
  });

  it("keeps video and built-in audio writes unchanged apart from a Volume Level dB readout", async () => {
    const blur = parameter("Blurriness", 10);
    host("video", [{ displayName: "Gaussian Blur", matchName: "AE.ADBE Gaussian Blur 2", properties: [blur] }]);
    const video = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Gaussian Blur", property_name: "Blurriness", value: 25 }) as any;
    expect(video).toMatchObject({ success: true, data: { outcome: "verified", value: 25, trackType: "video", builtInComponent: false } });
    expect(video.data).not.toHaveProperty("warnings");
    expect(video.data).not.toHaveProperty("valueScale");

    const level = parameter("Level", 0.17782794100389226);
    host("audio", [{ displayName: "Volume", matchName: "Internal Volume Mono", properties: [parameter("Bypass", false), level] }]);
    const volume = await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Volume", property_name: "Level", value: 1 }) as any;
    expect(volume).toMatchObject({ success: true, data: { outcome: "verified", value: 1, displayValue: 15, displayUnits: "dB", builtInComponent: true } });
    expect(volume.data).not.toHaveProperty("warnings");
  });

  it("validates the override flag and escapes the effect and property names", async () => {
    await expect(keyframes.set_effect_property.handler({ node_id: "clip", effect_name: "Highpass", property_name: "Cutoff", value: 0.1, allow_out_of_range_audio_value: "yes" as never }))
      .resolves.toEqual({ success: false, error: "allow_out_of_range_audio_value must be a boolean." });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    mockedSendCommand.mockResolvedValue({ success: false, error: "Clip not found" });
    await keyframes.set_effect_property.handler({ node_id: "clip", effect_name: 'Hi"gh\\pass\n', property_name: 'Cut"off', value: 2 });
    const script = mockedSendCommand.mock.calls[0][0] as string;
    expect(script).toContain('effect: "Hi\\"gh\\\\pass\\n"');
    expect(script).toContain('property: "Cut\\"off"');
    expect(script).toContain("var allowRawAudioValue = false;");
    expect(script).not.toMatch(/\blet |\bconst |=>/);
  });
});

describe("annotation helpers", () => {
  it("classifies values without inventing a scale for non-numbers", () => {
    expect(audioValueScale(0)).toBe("normalized_0_1");
    expect(audioValueScale(1)).toBe("normalized_0_1");
    expect(audioValueScale(1.5)).toBe("host_raw_unknown");
    expect(audioValueScale(-0.1)).toBe("host_raw_unknown");
    expect(audioValueScale(Number.NaN)).toBeUndefined();
    expect(audioValueScale(true)).toBeUndefined();
    expect(audioValueScale([0.5, 0.5])).toBeUndefined();
  });

  it("tolerates malformed bridge results and keeps existing warnings", () => {
    expect(annotateEffectPropertiesResult({ success: true, data: null })).toEqual({ success: true, data: null });
    expect(annotateEffectPropertiesResult({ success: true, data: { trackType: "audio", builtInComponent: false } })).toEqual({ success: true, data: { trackType: "audio", builtInComponent: false } });
    expect(annotateSetEffectPropertyResult({ success: false, error: "x" })).toEqual({ success: false, error: "x" });
    const merged = annotateEffectPropertiesResult({
      success: true,
      data: { trackType: "audio", builtInComponent: false, effect: "DeEsser", warnings: ["host note", AUDIO_EFFECT_SCALE_WARNING, 7], properties: [null, { displayName: "Threshold", value: 0.625 }] },
    }) as any;
    expect(merged.data.warnings).toEqual(["host note", AUDIO_EFFECT_SCALE_WARNING]);
    expect(merged.data.properties).toEqual([null, { displayName: "Threshold", value: 0.625, valueScale: "normalized_0_1" }]);
  });

  it("reports silence for a zero Volume Level instead of a non-finite dB value", () => {
    const result = annotateEffectPropertiesResult({
      success: true,
      data: { trackType: "audio", builtInComponent: true, matchName: "Internal Volume Stereo", properties: [{ displayName: "Level", value: 0 }, { displayName: "Level", value: 3 }] },
    }) as any;
    expect(result.data.properties[0]).toMatchObject({ displayValue: null, displayUnits: "dB", displayNote: expect.stringContaining("silence") });
    expect(result.data.properties[1]).not.toHaveProperty("displayValue");
  });
});
