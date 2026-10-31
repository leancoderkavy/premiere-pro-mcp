import type { CommandResult } from "../bridge/file-bridge.js";
import { premiereLevelToDb } from "./track-targeting.js";

/**
 * Scale annotations for effect parameters read or written through CEP.
 *
 * ComponentParam.getValue()/setValue() on Premiere's audio effects (Highpass,
 * Simple Parametric EQ, Single-band Compressor, Hard Limiter, DeEsser, ...)
 * use a host-normalized 0..1 value, not the Hz, dB, ms or ratio shown in
 * Effect Controls. Adobe documents neither the normalization nor the curve
 * (ComponentParam docs only say the value "varies with stream type"), so these
 * values carry a warning and no invented units. The only conversion offered is
 * Volume > Level, whose mapping (1 = +15 dB) the volume tools already rely on.
 */

export type AudioValueScale = "normalized_0_1" | "host_raw_unknown";

export const AUDIO_EFFECT_SCALE_WARNING =
  "Audio effect parameters are read and written as Premiere's normalized 0-1 values, not the Hz, dB, ms or ratio shown in Effect Controls. " +
  "Adobe does not document the mapping and it is not necessarily linear, so do not read a value as a frequency, level or time. " +
  "Calibrate any change by rendering a short export before and after and comparing the spectrum or levels.";

export const HIGHPASS_DEFAULT_WARNING =
  "Highpass Cutoff 0.25 (Premiere's default) measured at about 1.2 kHz on Premiere 26.5.2, which removes most of the body of speech. Lower it and verify by rendering.";

/**
 * Highpass Cutoff measured on Premiere Pro 26.5.2 (macOS, 48 kHz) from rendered
 * export spectra at roughly the -6 dB point. Guidance only: not a formula, not
 * documented by Adobe, and not checked on other hosts or sample rates.
 */
export const HIGHPASS_CUTOFF_MEASUREMENTS = Object.freeze({
  source: "measured",
  host: "Premiere Pro 26.5.2, macOS, 48 kHz sequence",
  method: "Rendered short exports compared by spectrum; approximate -6 dB point.",
  points: Object.freeze([
    Object.freeze({ value: 0.02, approximateCutoff: "below 30 Hz (flat to 30 Hz)" }),
    Object.freeze({ value: 0.047, approximateCutoff: "75-90 Hz" }),
    Object.freeze({ value: 0.065, approximateCutoff: "about 130 Hz" }),
    Object.freeze({ value: 0.25, approximateCutoff: "about 1.2 kHz (Premiere default)" }),
  ]),
  caution: "Measured points, not a formula. Do not extrapolate; verify the chosen value by rendering.",
});

interface PropertyLike {
  index?: unknown;
  displayName?: unknown;
  value?: unknown;
  valueType?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for an effect (not a built-in Volume/Channel Volume/Panner/Balance) on an audio clip. */
function isAudioEffect(data: Record<string, unknown>): boolean {
  return data.trackType === "audio" && data.builtInComponent === false;
}

export function audioValueScale(value: unknown): AudioValueScale | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value >= 0 && value <= 1 ? "normalized_0_1" : "host_raw_unknown";
}

function isHighpassCutoff(effectName: unknown, propertyName: unknown): boolean {
  return effectName === "Highpass" && propertyName === "Cutoff";
}

function isVolumeLevel(matchName: unknown, propertyName: unknown): boolean {
  return typeof matchName === "string" && /^Internal Volume /.test(matchName) && propertyName === "Level";
}

/** Volume > Level in dB, using the same mapping set_clip_volume writes with. */
function volumeLevelDisplay(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  const db = premiereLevelToDb(value);
  return {
    displayValue: db === null ? null : Math.round(db * 100) / 100,
    displayUnits: "dB",
    displayValueSource: "Premiere Volume Level mapping used by set_clip_volume: dB = 20*log10(value) + 15 (1 = +15 dB).",
    ...(db === null ? { displayNote: "Level 0 is silence (-infinity dB)." } : {}),
  };
}

function annotateProperty(property: PropertyLike, effectName: unknown, matchName: unknown, audioEffect: boolean): PropertyLike {
  if (audioEffect) {
    const scale = audioValueScale(property.value);
    if (!scale) return property;
    const annotated: PropertyLike = { ...property, valueScale: scale };
    if (isHighpassCutoff(effectName, property.displayName)) annotated.measuredGuidance = HIGHPASS_CUTOFF_MEASUREMENTS;
    return annotated;
  }
  if (isVolumeLevel(matchName, property.displayName)) {
    const display = volumeLevelDisplay(property.value);
    if (display) return { ...property, ...display };
  }
  return property;
}

function withWarnings(data: Record<string, unknown>, extra: string[]): string[] {
  const existing = Array.isArray(data.warnings) ? data.warnings.filter((entry): entry is string => typeof entry === "string") : [];
  return [...existing, ...extra.filter((entry) => !existing.includes(entry))];
}

function parameterScaleSummary(): Record<string, unknown> {
  return {
    kind: "normalized_0_1",
    basis: "inferred",
    appliesTo: "Numeric parameters of effects on audio clips, other than the built-in Volume, Channel Volume, Panner and Balance components.",
    documentedMapping: false,
  };
}

/** Add valueScale, warnings, measured guidance and documented conversions to a get_effect_properties result. */
export function annotateEffectPropertiesResult(result: CommandResult): CommandResult {
  if (!result || !result.success || !isRecord(result.data)) return result;
  const data = result.data;
  if (!Array.isArray(data.properties)) return result;
  const audioEffect = isAudioEffect(data);
  const properties = data.properties.map((property) =>
    isRecord(property) ? annotateProperty(property, data.effect, data.matchName, audioEffect) : property,
  );
  const annotated: Record<string, unknown> = { ...data, properties };
  if (audioEffect) {
    const warnings = [AUDIO_EFFECT_SCALE_WARNING];
    const defaultCutoff = properties.some(
      (property) => isRecord(property) && isHighpassCutoff(data.effect, property.displayName) && property.value === 0.25,
    );
    if (defaultCutoff) warnings.push(HIGHPASS_DEFAULT_WARNING);
    annotated.parameterScale = parameterScaleSummary();
    annotated.warnings = withWarnings(data, warnings);
  }
  return { ...result, data: annotated };
}

/** Add the same scale information to a set_effect_property result (success or readback failure). */
export function annotateSetEffectPropertyResult(result: CommandResult): CommandResult {
  if (!result || !isRecord(result.data)) return result;
  const data = result.data;
  const annotated: Record<string, unknown> = { ...data };
  if (isAudioEffect(data)) {
    const scale = audioValueScale(data.requestedValue) ?? audioValueScale(data.value);
    if (scale) annotated.valueScale = scale;
    if (isHighpassCutoff(data.effectDisplayName, data.propertyDisplayName)) annotated.measuredGuidance = HIGHPASS_CUTOFF_MEASUREMENTS;
    annotated.parameterScale = parameterScaleSummary();
    annotated.warnings = withWarnings(data, [AUDIO_EFFECT_SCALE_WARNING]);
  } else if (isVolumeLevel(data.matchName, data.propertyDisplayName)) {
    const display = volumeLevelDisplay(data.value);
    if (display) Object.assign(annotated, display);
  } else {
    return result;
  }
  return { ...result, data: annotated };
}
