import { describe, it, expect } from "vitest";
import {
  dbToPremiereLevel,
  premiereLevelToDb,
  PREMIERE_MAX_LEVEL_DB,
} from "../src/tools/track-targeting.js";

/**
 * Premiere's `Volume > Level` is a normalised 0..1 value, not decibels.
 * Measured against Premiere Pro 26.3.2: a clip left untouched (0 dB in the
 * UI) reads back 0.17782794, which is exactly 10^(-15/20). That fixes the
 * scale - 1.0 is +15 dB.
 */
describe("Premiere audio level conversion", () => {
  it("maps unity gain to Premiere's observed 0 dB value", () => {
    expect(dbToPremiereLevel(0)).toBeCloseTo(0.17782794, 7);
  });

  it("maps the top of the range to 1.0", () => {
    expect(dbToPremiereLevel(PREMIERE_MAX_LEVEL_DB)).toBeCloseTo(1.0, 10);
  });

  it("keeps every level inside the range Premiere accepts", () => {
    for (const db of [-60, -18, -11, -5.8, 0, 6, 15]) {
      const level = dbToPremiereLevel(db);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it("clamps above +15 dB rather than exceeding 1.0", () => {
    expect(dbToPremiereLevel(40)).toBeCloseTo(1.0, 10);
  });

  it("round-trips dB -> level -> dB", () => {
    for (const db of [-24, -17.7, -11, -5.8, 0, 7.5]) {
      const back = premiereLevelToDb(dbToPremiereLevel(db));
      expect(back).not.toBeNull();
      expect(back as number).toBeCloseTo(db, 6);
    }
  });

  it("reports silence as null rather than -Infinity", () => {
    expect(premiereLevelToDb(0)).toBeNull();
    expect(premiereLevelToDb(-1)).toBeNull();
  });

  /**
   * Regression guard. Before the fix, volume_db was passed straight to
   * setValue(): -11 dB fell outside 0..1 and clamped to 0 (silence), while
   * +7 dB clamped to 1.0 (+15 dB). Both failed without raising an error.
   */
  it("does not pass raw decibels through as a level", () => {
    expect(dbToPremiereLevel(-11)).not.toBe(-11);
    expect(dbToPremiereLevel(-11)).toBeGreaterThan(0);
    expect(dbToPremiereLevel(7)).not.toBe(7);
    expect(dbToPremiereLevel(7)).toBeLessThan(1);
  });
});
