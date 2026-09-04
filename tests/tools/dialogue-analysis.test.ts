import { describe, expect, it } from "vitest";
import { analyzeDialogueEditCandidates } from "../../src/tools/dialogue-analysis.js";

const revision = `sha256:${"a".repeat(64)}`;
describe("dialogue candidate analysis", () => {
  it("returns stable review candidates without applying edits", () => {
    const input = { segments: [
      { id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 1, text: "Um hello world" },
      { id: "b", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 1, end_seconds: 2, text: "hello world again" },
      { id: "c", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 2, end_seconds: 3, text: "hello world again" },
    ], fillerWords: ["um"], silenceRanges: [{ source_project_item_id: "clip", start_seconds: 3, end_seconds: 4 }], minimumSilenceSeconds: .7 };
    const first = analyzeDialogueEditCandidates(input), second = analyzeDialogueEditCandidates(input);
    expect(first.analysis_revision).toBe(second.analysis_revision);
    expect(first.candidates.map((x) => x.reason)).toEqual(["filler_word", "repeated_phrase", "long_silence"]);
    expect(first.applied).toBe(false);
  });
  it("rejects unbound transcript input", () => expect(() => analyzeDialogueEditCandidates({ segments: [{ id: "a", source_project_item_id: "clip", transcript_revision: "bad", start_seconds: 0, end_seconds: 1, text: "hello" }] })).toThrow(/sha256/));
});
