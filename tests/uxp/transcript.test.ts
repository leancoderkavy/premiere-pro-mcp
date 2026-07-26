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

  it("continues past a same-name non-clip but fails an exact non-clip ID", () => {
    const folder = { name: "Interview" };
    const clip = { name: "Interview", kind: "clip" };
    const cast = (item: typeof folder | typeof clip) => {
      if (!("kind" in item)) throw new Error("not a clip");
      return item;
    };
    expect(transcript.matchingClipCandidate(folder, "folder-1", "", "Interview", cast)).toEqual({
      matched: true,
      clip: null,
    });
    expect(transcript.matchingClipCandidate(clip, "clip-1", "", "Interview", cast).clip).toBe(clip);
    expect(() => transcript.matchingClipCandidate(folder, "folder-1", "folder-1", "", cast)).toThrow("not a clip");
  });

  it("propagates export-probe failures instead of reporting transcript absence", async () => {
    await expect(transcript.probeTranscriptExport(async () => "")).resolves.toBe(false);
    await expect(transcript.probeTranscriptExport(async () => '{"segments":[]}')).resolves.toBe(true);
    await expect(
      transcript.probeTranscriptExport(async () => {
        throw new Error("offline media");
      }),
    ).rejects.toThrow("offline media");
  });
});
