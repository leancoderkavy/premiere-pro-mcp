import { describe, expect, it } from "vitest";
import {
  normalizeTranscriptDeletionRanges,
  previewTranscriptEdit,
  transcriptRevision,
} from "../../src/tools/transcript-edits.js";

describe("transcript edit range edge cases", () => {
  it.each([
    [null, "deletion 0 must be an object"],
    ["not a range", "deletion 0 must be an object"],
    [{ start_seconds: -0.01, end_seconds: 1 }, "start_seconds must be a non-negative number"],
    [{ start_seconds: Number.NaN, end_seconds: 1 }, "start_seconds must be a non-negative number"],
    [{ start_seconds: 1, end_seconds: Number.POSITIVE_INFINITY }, "end_seconds must be greater than start_seconds"],
    [{ start_seconds: 1, end_seconds: 1 }, "end_seconds must be greater than start_seconds"],
  ])("rejects invalid deletion input %j", (deletion, message) => {
    expect(() => normalizeTranscriptDeletionRanges([deletion])).toThrow(message);
  });

  it("rounds normalized values and merges precisely adjacent ranges", () => {
    expect(normalizeTranscriptDeletionRanges([
      { start_seconds: 2, end_seconds: 3.00000049 },
      { start_seconds: 1.00000031, end_seconds: 2 },
    ], 0.0000004)).toEqual([
      { start_seconds: 1, end_seconds: 3.000001 },
    ]);
  });

  it("uses end time as a stable secondary sort key before merging equal-start ranges", () => {
    expect(normalizeTranscriptDeletionRanges([
      { start_seconds: 5.0000004, end_seconds: 8 },
      { start_seconds: 5.0000003, end_seconds: 6 },
    ])).toEqual([
      { start_seconds: 5, end_seconds: 8 },
    ]);
  });
});

describe("transcript preview revision guard", () => {
  it("rejects empty transcript payloads before creating a revision", () => {
    expect(() => previewTranscriptEdit("", "", [{ start_seconds: 1, end_seconds: 2 }]))
      .toThrow("Premiere returned an empty transcript");
    expect(() => previewTranscriptEdit(null as unknown as string, "", [{ start_seconds: 1, end_seconds: 2 }]))
      .toThrow("Premiere returned an empty transcript");
  });

  it("does not treat an empty requested revision as a valid transcript lock", () => {
    const json = '{"segments":[{"text":"approve"}]}';
    expect(transcriptRevision(json)).not.toBe("");
    expect(() => previewTranscriptEdit(json, "", [{ start_seconds: 1, end_seconds: 2 }]))
      .toThrow("Transcript revision does not match");
  });
});
