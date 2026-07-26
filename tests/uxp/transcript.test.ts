import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const transcript = require("../../uxp-plugin/transcript.cjs");

describe("UXP transcript helpers", () => {
  it("validates and parses Premiere transcript JSON", () => {
    expect(transcript.parseTranscriptJSON('{"segments":[]}')).toEqual({ segments: [] });
    expect(() => transcript.parseTranscriptJSON("")).toThrow("non-empty");
    expect(() => transcript.parseTranscriptJSON("{")).toThrow("invalid");
  });

  it("searches nested strings without assuming a transcript schema", () => {
    const raw = JSON.stringify({
      language: "en",
      segments: [
        { speaker: "A", text: "Ship the launch date today" },
        { words: [{ value: "LAUNCH DATE" }] },
      ],
    });
    const result = transcript.searchTranscriptJSON(raw, "launch date", { maxResults: 10 });
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ path: "$.segments[0].text", index: 9 });
    expect(result.matches[1].path).toBe("$.segments[1].words[0].value");
  });

  it("supports case-sensitive search and bounded results", () => {
    const raw = JSON.stringify({ text: "Cut cut cut cut" });
    expect(transcript.searchTranscriptJSON(raw, "Cut", { caseSensitive: true }).matches).toHaveLength(1);
    expect(transcript.searchTranscriptJSON(raw, "cut", { maxResults: 2 })).toMatchObject({
      limited: true,
      matches: [{ index: 0 }, { index: 4 }],
    });
    expect(() => transcript.searchTranscriptJSON(raw, "cut", { maxResults: 0 })).toThrow("between 1 and 500");
  });

  it("compares Premiere versions numerically", () => {
    expect(transcript.versionAtLeast("25.6.0", "25.6.0")).toBe(true);
    expect(transcript.versionAtLeast("26.3", "25.6.0")).toBe(true);
    expect(transcript.versionAtLeast("25.5.9", "25.6.0")).toBe(false);
  });
});
