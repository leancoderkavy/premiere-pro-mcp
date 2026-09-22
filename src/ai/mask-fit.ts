/**
 * Deterministic geometry for fitting a still image's subject inside an
 * existing crop/mask region by changing only Motion Scale and Position.
 *
 * No image analysis happens here. The caller supplies the subject box as
 * fractions of the source frame, and the mask region comes either from the
 * mask effect's own parameters or from an explicit override.
 *
 * Motion model (rotation 0, uniform scale), with the source measured in
 * display pixels (width x pixel aspect ratio):
 *
 *   sequence_x = position_x + (u - anchor_u) * displayWidth  * scale * prescale
 *   sequence_y = position_y + (v - anchor_v) * displayHeight * scale * prescale
 *
 * where (u, v) and (anchor_u, anchor_v) are fractions of the source frame.
 */

export interface FrameSize {
  width: number;
  height: number;
}

/** Axis-aligned box as fractions (0..1) of a frame. */
export interface NormalizedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MaskPlacement {
  /** Subject top edge as a fraction of the mask height (0 = mask top). */
  top: number;
  /** Subject bottom edge as a fraction of the mask height (1 = mask bottom). */
  bottom: number;
  /** Subject left edge as a fraction of the mask width (width fit only). */
  left: number;
  /** Subject right edge as a fraction of the mask width (width fit only). */
  right: number;
  /** Subject horizontal center as a fraction of the mask width (height fit only). */
  center_x: number;
  /** Subject vertical center as a fraction of the mask height (width fit only). */
  center_y: number;
}

export type FitAxis = "height" | "width";

export interface MaskFitInput {
  sequence: FrameSize;
  source: FrameSize & { pixelAspectRatio?: number };
  /** Mask region as fractions of the sequence frame. */
  mask: NormalizedBox;
  /** Subject box as fractions of the source frame. */
  subject: NormalizedBox;
  placement?: Partial<MaskPlacement>;
  fitAxis?: FitAxis;
  /** Motion Anchor Point as fractions of the source frame; defaults to the center. */
  anchor?: { x: number; y: number };
  /**
   * Extra scale Premiere applies before Motion (for example "Scale to Frame
   * Size"). Defaults to 1. Motion Scale is reported net of this factor.
   */
  sourcePrescale?: number;
}

export interface MaskFitResult {
  scale_percent: number;
  position_pixels: { x: number; y: number };
  position_normalized: { x: number; y: number };
  placement: MaskPlacement;
  fit_axis: FitAxis;
  mask_pixels: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  subject_pixels: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  image_pixels: { left: number; top: number; right: number; bottom: number };
  warnings: string[];
}

export const DEFAULT_MASK_PLACEMENT: MaskPlacement = {
  top: 0.15,
  bottom: 0.85,
  left: 0.15,
  right: 0.85,
  center_x: 0.5,
  center_y: 0.5,
};

const MIN_SPAN = 1e-6;
const EDGE_TOLERANCE_PX = 0.5;

function assertFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function assertFrame(frame: FrameSize, label: string): void {
  assertFinite(frame.width, `${label} width`);
  assertFinite(frame.height, `${label} height`);
  if (frame.width <= 0 || frame.height <= 0) throw new Error(`${label} width and height must be positive.`);
}

export function validateNormalizedBox(box: NormalizedBox, label: string, allowOutside = false): void {
  for (const key of ["left", "top", "right", "bottom"] as const) {
    assertFinite(box[key], `${label}.${key}`);
    if (!allowOutside && (box[key] < 0 || box[key] > 1)) {
      throw new Error(`${label}.${key} must be between 0 and 1 (fraction of the frame).`);
    }
  }
  if (box.right - box.left <= MIN_SPAN) throw new Error(`${label}.right must be greater than ${label}.left.`);
  if (box.bottom - box.top <= MIN_SPAN) throw new Error(`${label}.bottom must be greater than ${label}.top.`);
}

function round(value: number, digits = 4): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function resolvePlacement(placement: Partial<MaskPlacement> | undefined): MaskPlacement {
  const resolved: MaskPlacement = { ...DEFAULT_MASK_PLACEMENT };
  if (placement) {
    for (const key of Object.keys(DEFAULT_MASK_PLACEMENT) as (keyof MaskPlacement)[]) {
      const value = placement[key];
      if (value === undefined) continue;
      assertFinite(value, `placement.${key}`);
      resolved[key] = value;
    }
  }
  if (resolved.bottom - resolved.top <= MIN_SPAN) throw new Error("placement.bottom must be greater than placement.top.");
  if (resolved.right - resolved.left <= MIN_SPAN) throw new Error("placement.right must be greater than placement.left.");
  return resolved;
}

/** Compute the Motion Scale and Position that map the subject box onto the target region of the mask. */
export function computeMaskFitMotion(input: MaskFitInput): MaskFitResult {
  assertFrame(input.sequence, "sequence");
  assertFrame(input.source, "source");
  validateNormalizedBox(input.mask, "mask", true);
  validateNormalizedBox(input.subject, "subject");
  const par = input.source.pixelAspectRatio ?? 1;
  assertFinite(par, "source pixel aspect ratio");
  if (par <= 0) throw new Error("source pixel aspect ratio must be positive.");
  const prescale = input.sourcePrescale ?? 1;
  assertFinite(prescale, "source_prescale");
  if (prescale <= 0) throw new Error("source_prescale must be positive.");
  const anchor = input.anchor ?? { x: 0.5, y: 0.5 };
  assertFinite(anchor.x, "anchor.x");
  assertFinite(anchor.y, "anchor.y");
  const fitAxis: FitAxis = input.fitAxis ?? "height";
  const placement = resolvePlacement(input.placement);

  const seqW = input.sequence.width;
  const seqH = input.sequence.height;
  const displayW = input.source.width * par;
  const displayH = input.source.height;

  const maskLeft = input.mask.left * seqW;
  const maskTop = input.mask.top * seqH;
  const maskW = (input.mask.right - input.mask.left) * seqW;
  const maskH = (input.mask.bottom - input.mask.top) * seqH;

  const subjectW = input.subject.right - input.subject.left;
  const subjectH = input.subject.bottom - input.subject.top;
  const subjectCenterU = (input.subject.left + input.subject.right) / 2;
  const subjectCenterV = (input.subject.top + input.subject.bottom) / 2;

  let effectiveScale: number;
  let targetCenterX: number;
  let targetCenterY: number;
  if (fitAxis === "height") {
    const targetSpan = (placement.bottom - placement.top) * maskH;
    effectiveScale = targetSpan / (subjectH * displayH);
    targetCenterX = maskLeft + placement.center_x * maskW;
    targetCenterY = maskTop + ((placement.top + placement.bottom) / 2) * maskH;
  } else {
    const targetSpan = (placement.right - placement.left) * maskW;
    effectiveScale = targetSpan / (subjectW * displayW);
    targetCenterX = maskLeft + ((placement.left + placement.right) / 2) * maskW;
    targetCenterY = maskTop + placement.center_y * maskH;
  }

  const positionX = targetCenterX - (subjectCenterU - anchor.x) * displayW * effectiveScale;
  const positionY = targetCenterY - (subjectCenterV - anchor.y) * displayH * effectiveScale;

  const mapX = (u: number) => positionX + (u - anchor.x) * displayW * effectiveScale;
  const mapY = (v: number) => positionY + (v - anchor.y) * displayH * effectiveScale;

  const subjectPx = {
    left: mapX(input.subject.left),
    top: mapY(input.subject.top),
    right: mapX(input.subject.right),
    bottom: mapY(input.subject.bottom),
  };
  const imagePx = { left: mapX(0), top: mapY(0), right: mapX(1), bottom: mapY(1) };
  const maskPx = { left: maskLeft, top: maskTop, right: maskLeft + maskW, bottom: maskTop + maskH };

  const warnings: string[] = [];
  const uncovered: string[] = [];
  if (imagePx.left > maskPx.left + EDGE_TOLERANCE_PX) uncovered.push("left");
  if (imagePx.top > maskPx.top + EDGE_TOLERANCE_PX) uncovered.push("top");
  if (imagePx.right < maskPx.right - EDGE_TOLERANCE_PX) uncovered.push("right");
  if (imagePx.bottom < maskPx.bottom - EDGE_TOLERANCE_PX) uncovered.push("bottom");
  if (uncovered.length > 0) {
    warnings.push(
      `The scaled image does not cover the mask's bounding box on the ${uncovered.join(", ")} side(s); empty pixels may show inside the mask. Choose a larger subject span in the placement or a different source image.`,
    );
  }
  if (subjectPx.left < maskPx.left - EDGE_TOLERANCE_PX || subjectPx.right > maskPx.right + EDGE_TOLERANCE_PX) {
    warnings.push("The subject box is wider than the mask at this scale, so the mask will clip its sides.");
  }
  if (subjectPx.top < maskPx.top - EDGE_TOLERANCE_PX || subjectPx.bottom > maskPx.bottom + EDGE_TOLERANCE_PX) {
    warnings.push("The subject box extends past the mask's top or bottom at this scale.");
  }
  if (
    input.mask.left < 0 || input.mask.top < 0 || input.mask.right > 1 || input.mask.bottom > 1
  ) {
    warnings.push("The mask region extends outside the sequence frame.");
  }

  const box = (b: { left: number; top: number; right: number; bottom: number }) => ({
    left: round(b.left, 2),
    top: round(b.top, 2),
    right: round(b.right, 2),
    bottom: round(b.bottom, 2),
  });

  return {
    scale_percent: round((effectiveScale / prescale) * 100, 3),
    position_pixels: { x: round(positionX, 2), y: round(positionY, 2) },
    position_normalized: { x: round(positionX / seqW, 6), y: round(positionY / seqH, 6) },
    placement,
    fit_axis: fitAxis,
    mask_pixels: { ...box(maskPx), width: round(maskW, 2), height: round(maskH, 2) },
    subject_pixels: {
      ...box(subjectPx),
      width: round(subjectPx.right - subjectPx.left, 2),
      height: round(subjectPx.bottom - subjectPx.top, 2),
    },
    image_pixels: box(imagePx),
    warnings,
  };
}

/** One effect parameter as read from Premiere. */
export interface RawEffectProperty {
  name: string;
  value: unknown;
}

export interface MaskInterpretation {
  box: NormalizedBox;
  method: "edges" | "center_size";
  used_properties: string[];
  assumptions: string[];
}

function findProperty(properties: readonly RawEffectProperty[], names: readonly string[]): RawEffectProperty | undefined {
  const wanted = names.map((name) => name.toLowerCase());
  const exact = properties.find((prop) => wanted.includes(prop.name.trim().toLowerCase()));
  if (exact) return exact;
  // Otherwise match on a whole word, preferring the shortest name so
  // "Left Crop" wins over "Top Left Corner Radius".
  let best: RawEffectProperty | undefined;
  let bestTokens = Number.POSITIVE_INFINITY;
  for (const prop of properties) {
    const tokens = prop.name.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length < bestTokens && wanted.some((name) => tokens.includes(name))) {
      best = prop;
      bestTokens = tokens.length;
    }
  }
  return best;
}

function scalarValue(prop: RawEffectProperty | undefined): number | undefined {
  if (!prop) return undefined;
  if (typeof prop.value === "number" && Number.isFinite(prop.value)) return prop.value;
  if (Array.isArray(prop.value) && prop.value.length === 1 && typeof prop.value[0] === "number") return prop.value[0];
  return undefined;
}

function pointValue(prop: RawEffectProperty | undefined): [number, number] | undefined {
  if (!prop || !Array.isArray(prop.value) || prop.value.length < 2) return undefined;
  const [x, y] = prop.value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

/** Values at or below this magnitude are treated as frame fractions rather than pixels. */
const NORMALIZED_LIMIT = 1.5;

export function looksNormalizedPoint(point: readonly number[]): boolean {
  return point.every((value) => Math.abs(value) <= NORMALIZED_LIMIT);
}

/**
 * Turn a mask effect's parameters into a box in sequence-frame fractions.
 * Supports edge insets (Crop-style Left/Top/Right/Bottom percentages) and
 * center plus size (Center/Position with Width/Height, Size, or Radius).
 * Returns undefined when neither shape is recognizable.
 */
export function interpretMaskProperties(
  properties: readonly RawEffectProperty[],
  sequence: FrameSize,
): MaskInterpretation | undefined {
  const left = findProperty(properties, ["left"]);
  const top = findProperty(properties, ["top"]);
  const right = findProperty(properties, ["right"]);
  const bottom = findProperty(properties, ["bottom"]);
  const edges = [left, top, right, bottom].map(scalarValue);
  if (edges.every((value) => value !== undefined)) {
    const [l, t, r, b] = edges as number[];
    return {
      box: { left: l / 100, top: t / 100, right: 1 - r / 100, bottom: 1 - b / 100 },
      method: "edges",
      used_properties: [left!.name, top!.name, right!.name, bottom!.name],
      assumptions: ["Left/Top/Right/Bottom are percentages of the frame cropped from each edge (Premiere Crop convention)."],
    };
  }

  const centerProp = findProperty(properties, ["center", "centre", "position"]);
  const center = pointValue(centerProp);
  if (!center || !centerProp) return undefined;
  const assumptions: string[] = [];
  let cx: number;
  let cy: number;
  if (looksNormalizedPoint(center)) {
    cx = center[0];
    cy = center[1];
    assumptions.push(`${centerProp.name} read as fractions of the sequence frame.`);
  } else {
    cx = center[0] / sequence.width;
    cy = center[1] / sequence.height;
    assumptions.push(`${centerProp.name} read as sequence pixels.`);
  }

  const toFraction = (value: number, dimension: number, label: string): number => {
    if (Math.abs(value) <= 1) {
      assumptions.push(`${label} read as a fraction of the sequence frame.`);
      return value;
    }
    assumptions.push(`${label} read as sequence pixels.`);
    return value / dimension;
  };

  const widthProp = findProperty(properties, ["width"]);
  const heightProp = findProperty(properties, ["height"]);
  const sizeProp = findProperty(properties, ["size"]);
  const radiusProp = findProperty(properties, ["radius"]);
  let halfW: number | undefined;
  let halfH: number | undefined;
  const used = [centerProp.name];
  const width = scalarValue(widthProp);
  const height = scalarValue(heightProp);
  const sizePoint = pointValue(sizeProp);
  const size = scalarValue(sizeProp);
  const radius = scalarValue(radiusProp);
  if (width !== undefined && height !== undefined) {
    halfW = toFraction(width, sequence.width, widthProp!.name) / 2;
    halfH = toFraction(height, sequence.height, heightProp!.name) / 2;
    used.push(widthProp!.name, heightProp!.name);
  } else if (sizePoint) {
    halfW = toFraction(sizePoint[0], sequence.width, `${sizeProp!.name} x`) / 2;
    halfH = toFraction(sizePoint[1], sequence.height, `${sizeProp!.name} y`) / 2;
    used.push(sizeProp!.name);
  } else if (size !== undefined) {
    const pixels = Math.abs(size) <= 1 ? size * Math.min(sequence.width, sequence.height) : size;
    assumptions.push(
      Math.abs(size) <= 1
        ? `${sizeProp!.name} read as a fraction of the shorter sequence side (square region).`
        : `${sizeProp!.name} read as a square region's side in sequence pixels.`,
    );
    halfW = pixels / 2 / sequence.width;
    halfH = pixels / 2 / sequence.height;
    used.push(sizeProp!.name);
  } else if (radius !== undefined) {
    const pixels = Math.abs(radius) <= 1 ? radius * Math.min(sequence.width, sequence.height) : radius;
    assumptions.push(
      Math.abs(radius) <= 1
        ? `${radiusProp!.name} read as a fraction of the shorter sequence side (circle bounding box).`
        : `${radiusProp!.name} read as a circle radius in sequence pixels.`,
    );
    halfW = pixels / sequence.width;
    halfH = pixels / sequence.height;
    used.push(radiusProp!.name);
  }
  if (halfW === undefined || halfH === undefined || halfW <= 0 || halfH <= 0) return undefined;
  return {
    box: { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH },
    method: "center_size",
    used_properties: used,
    assumptions,
  };
}
