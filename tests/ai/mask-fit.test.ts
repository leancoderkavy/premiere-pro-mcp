import { describe, expect, it } from "vitest";
import {
  computeMaskFitMotion,
  interpretMaskProperties,
  looksNormalizedPoint,
  resolvePlacement,
  validateNormalizedBox,
} from "../../src/ai/mask-fit.js";

const HD = { width: 1920, height: 1080 };

describe("computeMaskFitMotion", () => {
  it("maps a centered subject onto the mask's target span (height fit)", () => {
    // Mask: 400x400 px square centered in a 1920x1080 frame.
    const mask = { left: 760 / 1920, top: 340 / 1080, right: 1160 / 1920, bottom: 740 / 1080 };
    const result = computeMaskFitMotion({
      sequence: HD,
      source: { width: 2000, height: 3000 },
      mask,
      subject: { left: 0.25, top: 0.2, right: 0.75, bottom: 0.6 },
      placement: { top: 0.1, bottom: 0.9, center_x: 0.5 },
    });
    // Target span 320 px / (0.4 * 3000 px) = 0.2667
    expect(result.scale_percent).toBeCloseTo(26.667, 2);
    // Subject center (0.5, 0.4) must land on the mask center (960, 540).
    expect(result.subject_pixels.top).toBeCloseTo(380, 1);
    expect(result.subject_pixels.bottom).toBeCloseTo(700, 1);
    expect((result.subject_pixels.left + result.subject_pixels.right) / 2).toBeCloseTo(960, 1);
    expect(result.position_pixels.x).toBeCloseTo(960, 2);
    expect(result.position_pixels.y).toBeCloseTo(540 + 0.1 * 3000 * (320 / 1200), 2);
    expect(result.position_normalized.x).toBeCloseTo(0.5, 6);
    expect(result.warnings).toEqual([]);
  });

  it("uses the default placement and reports it", () => {
    const result = computeMaskFitMotion({
      sequence: HD,
      source: { width: 1000, height: 1000 },
      mask: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
      subject: { left: 0.3, top: 0.2, right: 0.7, bottom: 0.8 },
    });
    expect(result.placement.top).toBe(0.15);
    expect(result.placement.bottom).toBe(0.85);
    expect(result.fit_axis).toBe("height");
    expect(result.subject_pixels.height).toBeCloseTo(0.7 * 540, 1);
  });

  it("fits width, honors anchor, pixel aspect ratio, and prescale", () => {
    const result = computeMaskFitMotion({
      sequence: HD,
      source: { width: 1000, height: 1000, pixelAspectRatio: 2 },
      mask: { left: 0.25, top: 0, right: 0.75, bottom: 1 },
      subject: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 },
      placement: { left: 0, right: 1, center_y: 0.5 },
      fitAxis: "width",
      anchor: { x: 0, y: 0 },
      sourcePrescale: 2,
    });
    // Mask width 960 px; subject width 0.2 * 2000 display px = 400 -> effective 2.4, net of prescale 1.2.
    expect(result.scale_percent).toBeCloseTo(120, 3);
    expect(result.subject_pixels.left).toBeCloseTo(480, 1);
    expect(result.subject_pixels.right).toBeCloseTo(1440, 1);
    // Anchor at the top-left: position is where source (0, 0) lands.
    expect(result.position_pixels.x).toBeCloseTo(result.image_pixels.left, 1);
    expect(result.position_pixels.y).toBeCloseTo(result.image_pixels.top, 1);
    expect((result.subject_pixels.top + result.subject_pixels.bottom) / 2).toBeCloseTo(540, 1);
  });

  it("warns when the image leaves part of the mask empty or the subject is clipped", () => {
    const result = computeMaskFitMotion({
      sequence: HD,
      source: { width: 1000, height: 1000 },
      mask: { left: 0.25, top: 0.1, right: 0.75, bottom: 0.9 },
      subject: { left: 0, top: 0, right: 1, bottom: 1 },
      placement: { top: 0.4, bottom: 0.6 },
    });
    expect(result.warnings.some((warning) => warning.includes("does not cover"))).toBe(true);

    const clipped = computeMaskFitMotion({
      sequence: HD,
      source: { width: 4000, height: 1000 },
      mask: { left: 0.45, top: 0.1, right: 0.55, bottom: 0.9 },
      subject: { left: 0, top: 0, right: 1, bottom: 1 },
      placement: { top: 0, bottom: 1 },
    });
    expect(clipped.warnings.some((warning) => warning.includes("wider than the mask"))).toBe(true);
    expect(clipped.warnings.some((warning) => warning.includes("past the mask"))).toBe(false);
  });

  it("flags a mask outside the frame and subject spilling vertically", () => {
    const result = computeMaskFitMotion({
      sequence: HD,
      source: { width: 1000, height: 1000 },
      mask: { left: -0.1, top: 0.2, right: 0.5, bottom: 0.8 },
      subject: { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 },
      placement: { top: -0.2, bottom: 1.2 },
    });
    expect(result.warnings.some((warning) => warning.includes("outside the sequence frame"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("past the mask"))).toBe(true);
  });

  it("rejects invalid geometry", () => {
    const base = {
      sequence: HD,
      source: { width: 1000, height: 1000 },
      mask: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
      subject: { left: 0.3, top: 0.2, right: 0.7, bottom: 0.8 },
    };
    expect(() => computeMaskFitMotion({ ...base, sequence: { width: 0, height: 1080 } })).toThrow("positive");
    expect(() => computeMaskFitMotion({ ...base, subject: { left: 0.5, top: 0.2, right: 0.5, bottom: 0.8 } })).toThrow("greater than");
    expect(() => computeMaskFitMotion({ ...base, subject: { left: 0.1, top: 0.9, right: 0.5, bottom: 0.8 } })).toThrow("greater than");
    expect(() => computeMaskFitMotion({ ...base, subject: { left: -0.1, top: 0.2, right: 0.5, bottom: 0.8 } })).toThrow("between 0 and 1");
    expect(() => computeMaskFitMotion({ ...base, subject: { left: Number.NaN, top: 0.2, right: 0.5, bottom: 0.8 } })).toThrow("finite");
    expect(() => computeMaskFitMotion({ ...base, source: { width: 10, height: 10, pixelAspectRatio: 0 } })).toThrow("aspect");
    expect(() => computeMaskFitMotion({ ...base, sourcePrescale: -1 })).toThrow("source_prescale");
    expect(() => computeMaskFitMotion({ ...base, anchor: { x: Number.POSITIVE_INFINITY, y: 0 } })).toThrow("anchor.x");
    expect(() => computeMaskFitMotion({ ...base, placement: { top: 0.8, bottom: 0.2 } })).toThrow("placement.bottom");
    expect(() => computeMaskFitMotion({ ...base, placement: { left: 0.8, right: 0.2 } })).toThrow("placement.right");
  });

  it("validates boxes and placement helpers directly", () => {
    expect(() => validateNormalizedBox({ left: -0.5, top: 0, right: 1.5, bottom: 1 }, "mask", true)).not.toThrow();
    expect(resolvePlacement(undefined).center_x).toBe(0.5);
    expect(resolvePlacement({ center_x: 0.4 }).center_x).toBe(0.4);
    expect(looksNormalizedPoint([0.5, 0.5])).toBe(true);
    expect(looksNormalizedPoint([960, 540])).toBe(false);
  });
});

describe("interpretMaskProperties", () => {
  it("reads Crop-style edge percentages", () => {
    const result = interpretMaskProperties(
      [
        { name: "Left", value: 30 },
        { name: "Top", value: 10 },
        { name: "Right", value: 30 },
        { name: "Bottom", value: 20 },
        { name: "Zoom", value: false },
        { name: "Edge Feather", value: 0 },
      ],
      HD,
    );
    expect(result?.method).toBe("edges");
    expect(result?.box).toEqual({ left: 0.3, top: 0.1, right: 0.7, bottom: 0.8 });
  });

  it("prefers exact edge names over names that only contain the word", () => {
    const result = interpretMaskProperties(
      [
        { name: "Top Left Radius", value: 50 },
        { name: "Left Crop", value: 10 },
        { name: "Top Crop", value: 10 },
        { name: "Right Crop", value: 10 },
        { name: "Bottom Crop", value: [10] },
      ],
      HD,
    );
    expect(result?.method).toBe("edges");
    expect(result?.used_properties).toEqual(["Left Crop", "Top Crop", "Right Crop", "Bottom Crop"]);
    expect(result?.box).toEqual({ left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 });
  });

  it("reads a normalized center with pixel width and height", () => {
    const result = interpretMaskProperties(
      [
        { name: "Center", value: [0.5, 0.5] },
        { name: "Width", value: 400 },
        { name: "Height", value: 400 },
        { name: "Roundness", value: 100 },
      ],
      HD,
    );
    expect(result?.method).toBe("center_size");
    expect(result?.box.left).toBeCloseTo(760 / 1920, 6);
    expect(result?.box.bottom).toBeCloseTo(740 / 1080, 6);
    expect(result?.assumptions.join(" ")).toContain("sequence pixels");
  });

  it("reads a pixel center with a radius, a size pair, and fractional sizes", () => {
    const radius = interpretMaskProperties([{ name: "Center", value: [960, 540] }, { name: "Radius", value: 200 }], HD);
    expect(radius?.box.left).toBeCloseTo(760 / 1920, 6);
    expect(radius?.box.top).toBeCloseTo(340 / 1080, 6);

    const fractionalRadius = interpretMaskProperties([{ name: "Center", value: [0.5, 0.5] }, { name: "Radius", value: 0.25 }], HD);
    expect(fractionalRadius?.box.top).toBeCloseTo(0.25, 6);

    const pair = interpretMaskProperties([{ name: "Position", value: [0.5, 0.5] }, { name: "Size", value: [0.5, 0.5] }], HD);
    expect(pair?.box).toEqual({ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 });

    const square = interpretMaskProperties([{ name: "Center", value: [0.5, 0.5] }, { name: "Size", value: 540 }], HD);
    expect(square?.box.top).toBeCloseTo(0.25, 6);

    const fractionalSquare = interpretMaskProperties([{ name: "Center", value: [0.5, 0.5] }, { name: "Size", value: 0.5 }], HD);
    expect(fractionalSquare?.box.top).toBeCloseTo(0.25, 6);

    const fractionalWH = interpretMaskProperties(
      [{ name: "Center", value: [0.5, 0.5] }, { name: "Width", value: 0.5 }, { name: "Height", value: 0.5 }],
      HD,
    );
    expect(fractionalWH?.box).toEqual({ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 });
  });

  it("returns undefined for unrecognizable parameters", () => {
    expect(interpretMaskProperties([{ name: "Roundness", value: 50 }], HD)).toBeUndefined();
    expect(interpretMaskProperties([{ name: "Center", value: [0.5, 0.5] }], HD)).toBeUndefined();
    expect(interpretMaskProperties([{ name: "Center", value: "bad" }], HD)).toBeUndefined();
    expect(interpretMaskProperties([{ name: "Center", value: [0.5, "x"] }, { name: "Radius", value: 1 }], HD)).toBeUndefined();
    expect(interpretMaskProperties([{ name: "Center", value: [0.5, 0.5] }, { name: "Radius", value: 0 }], HD)).toBeUndefined();
    expect(interpretMaskProperties([{ name: "Left", value: "10" }, { name: "Top", value: 1 }, { name: "Right", value: 1 }, { name: "Bottom", value: 1 }], HD)).toBeUndefined();
  });
});
