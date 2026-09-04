import { describe, expect, it } from "vitest";
import { analyzeDialogueEditCandidates, getDialogueAnalysisTools } from "../../src/tools/dialogue-analysis.js";

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
  it.each([
    [[], /between 1/], [[null], /must be an object/],
    [[{ id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 1, text: "x", extra: 1 }], /unknown field/],
    [[{ id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 1, end_seconds: 1, text: "x" }], /greater/],
    [[{ id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 1, text: 1 }], /text must/],
  ])("rejects malformed segments", (segments, message) => expect(() => analyzeDialogueEditCandidates({ segments })).toThrow(message));
  it("validates optional analysis controls", () => {
    const segments = [{ id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 1, text: "okay" }];
    expect(() => analyzeDialogueEditCandidates({ segments, fillerWords: "um" })).toThrow(/filler_words/);
    expect(() => analyzeDialogueEditCandidates({ segments, fillerWords: ["um", "um"] })).toThrow(/duplicates/);
    expect(() => analyzeDialogueEditCandidates({ segments, minimumSilenceSeconds: 40 })).toThrow(/between/);
    expect(() => analyzeDialogueEditCandidates({ segments, silenceRanges: "bad" })).toThrow(/silence_ranges/);
    expect(() => analyzeDialogueEditCandidates({ segments, silenceRanges: [null] })).toThrow(/must be an object/);
    expect(() => analyzeDialogueEditCandidates({ segments, silenceRanges: [{ source_project_item_id: "clip", start_seconds: 0, end_seconds: 1, extra: true }] })).toThrow(/unknown field/);
  });
  it("deduplicates time removal and ignores short silence", () => {
    const segments = [
      { id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 2, text: "um okay" },
      { id: "b", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 3, end_seconds: 4, text: "different" },
    ];
    const result = analyzeDialogueEditCandidates({ segments, fillerWords: ["um"], silenceRanges: [{ source_project_item_id: "clip", start_seconds: 1, end_seconds: 3 }, { source_project_item_id: "clip", start_seconds: 5, end_seconds: 5.2 }], minimumSilenceSeconds: .5 });
    expect(result.projected_removed_seconds).toBe(3);
    expect(result.candidate_count).toBe(2);
  });
  it("rejects duplicate ids and invalid labels", () => {
    const base = { id: "a", source_project_item_id: "clip", transcript_revision: revision, start_seconds: 0, end_seconds: 1, text: "x" };
    expect(() => analyzeDialogueEditCandidates({ segments: [base, { ...base, start_seconds: 1, end_seconds: 2 }] })).toThrow(/duplicate id/);
    expect(() => analyzeDialogueEditCandidates({ segments: [{ ...base, speaker_label: "" }] })).toThrow(/speaker_label/);
  });
  it("bounds very large candidate sets", () => {
    const segments = Array.from({ length: 520 }, (_, index) => ({ id: String(index), source_project_item_id: "clip", transcript_revision: revision, start_seconds: index, end_seconds: index + .5, text: "um repeated phrase" }));
    const result = analyzeDialogueEditCandidates({ segments, fillerWords: ["um"] });
    expect(result.candidate_count).toBe(512);
    expect(result.truncated).toBe(true);
  });
  it("normalizes handler failures", async () => {
    expect((await getDialogueAnalysisTools().analyze_dialogue_edit_candidates.handler({ segments: [] })).success).toBe(false);
  });
});
