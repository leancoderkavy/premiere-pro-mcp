import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import {
  normalizeTranscriptDeletionRanges,
  planTranscriptRoughCut,
  previewTranscriptEdit,
  transcriptRevision,
} from "../../src/tools/transcript-edits.js";
import { getUxpTools } from "../../src/tools/uxp.js";

describe("transcript edit planning", () => {
  it("creates stable transcript revisions", () => {
    expect(transcriptRevision('{"segments":[]}')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(transcriptRevision('{"segments":[]}')).toBe(transcriptRevision('{"segments":[]}'));
    expect(transcriptRevision('{"segments":[1]}')).not.toBe(transcriptRevision('{"segments":[]}'));
  });

  it("sorts, adds handles, and merges overlapping deletion ranges", () => {
    expect(normalizeTranscriptDeletionRanges([
      { start_seconds: 5, end_seconds: 7 },
      { start_seconds: 1, end_seconds: 3 },
      { start_seconds: 2.9, end_seconds: 5.1 },
    ], 0.1)).toEqual([{ start_seconds: 0.9, end_seconds: 7.1 }]);
  });

  it("rejects invalid or excessive deletion ranges", () => {
    expect(() => normalizeTranscriptDeletionRanges([])).toThrow("at least one");
    expect(() => normalizeTranscriptDeletionRanges([{ start_seconds: 2, end_seconds: 1 }])).toThrow("greater than");
    expect(() => normalizeTranscriptDeletionRanges([{ start_seconds: 0, end_seconds: 1 }], 11)).toThrow("between 0 and 10");
    expect(() => normalizeTranscriptDeletionRanges(Array.from({ length: 101 }, (_, i) => ({ start_seconds: i, end_seconds: i + 0.5 })))).toThrow("limited to 100");
  });

  it("revision-locks previews and returns a deterministic confirmation token", () => {
    const json = '{"segments":[{"text":"remove this"}]}';
    const revision = transcriptRevision(json);
    const first = previewTranscriptEdit(json, revision, [
      { start_seconds: 4, end_seconds: 5 },
      { start_seconds: 1, end_seconds: 2.5 },
    ]);
    const second = previewTranscriptEdit(json, revision, [
      { start_seconds: 1, end_seconds: 2.5 },
      { start_seconds: 4, end_seconds: 5 },
    ]);
    expect(first).toMatchObject({ deletedSeconds: 2.5, applied: false });
    expect(first.confirmationToken).toBe(second.confirmationToken);
    expect(() => previewTranscriptEdit(json, transcriptRevision("different"), [{ start_seconds: 1, end_seconds: 2 }])).toThrow("does not match");
  });

  it("maps transcript deletions to descending verified 1x timeline cut instructions", () => {
    const json = '{"segments":[]}';
    const preview = previewTranscriptEdit(json, transcriptRevision(json), [
      { start_seconds: 2, end_seconds: 4 },
      { start_seconds: 8, end_seconds: 12 },
    ]);
    const plan = planTranscriptRoughCut(preview, [{
      placement_id: "clip-1",
      track_type: "video",
      track_index: 0,
      source_in_seconds: 0,
      source_out_seconds: 10,
      timeline_start_seconds: 20,
      timeline_end_seconds: 30,
    }]);
    expect(plan).toMatchObject({
      applied: false,
      requiresDuplicateSequence: true,
      requiresPostMutationRequery: true,
      ripple: true,
      unmappedDeletionRanges: [],
    });
    expect(plan.steps.map((step) => step.timeline_range)).toEqual([
      { start_seconds: 28, end_seconds: 30 },
      { start_seconds: 22, end_seconds: 24 },
    ]);
  });

  it("rejects retimed placements instead of guessing source-to-timeline mapping", () => {
    const json = '{"segments":[]}';
    const preview = previewTranscriptEdit(json, transcriptRevision(json), [{ start_seconds: 1, end_seconds: 2 }]);
    expect(() => planTranscriptRoughCut(preview, [{
      placement_id: "retimed",
      track_type: "video",
      track_index: 0,
      source_in_seconds: 0,
      source_out_seconds: 10,
      timeline_start_seconds: 0,
      timeline_end_seconds: 5,
    }])).toThrow("retimed");
  });
});

describe("transcript UXP MCP tools", () => {
  it("exports native transcript JSON with a stable revision", async () => {
    const json = '{"segments":[]}';
    const request = vi.fn().mockResolvedValue({ projectItemId: "clip-1", projectItemName: "Interview", json });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).get_clip_transcript_uxp.handler({ project_item_id: "clip-1" });
    expect(request).toHaveBeenCalledWith("transcript.export", { projectItemId: "clip-1" });
    expect(result).toMatchObject({
      success: true,
      data: { result: { projectItemId: "clip-1", json, transcriptRevision: transcriptRevision(json) } },
    });
  });

  it("maps bounded search arguments to the native transcript command", async () => {
    const request = vi.fn().mockResolvedValue({ matches: [] });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    await getUxpTools(bridge).search_clip_transcript_uxp.handler({
      project_item_name: "Interview",
      query: "launch date",
      case_sensitive: true,
      max_results: 10,
    });
    expect(request).toHaveBeenCalledWith("transcript.search", {
      projectItemName: "Interview",
      query: "launch date",
      caseSensitive: true,
      maxResults: 10,
    });
  });

  it("re-exports the transcript before producing a revision-locked preview", async () => {
    const json = '{"segments":[{"text":"cut this"}]}';
    const request = vi.fn().mockResolvedValue({ projectItemId: "clip-1", projectItemName: "Interview", json });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).preview_transcript_edit_uxp.handler({
      project_item_id: "clip-1",
      transcript_revision: transcriptRevision(json),
      deletions: [{ start_seconds: 2, end_seconds: 4 }],
    });
    expect(request).toHaveBeenCalledWith("transcript.export", { projectItemId: "clip-1" });
    expect(result).toMatchObject({
      success: true,
      data: { result: { projectItemId: "clip-1", deletedSeconds: 2, applied: false } },
    });
  });

  it("builds a transcript rough-cut plan without mutating Premiere", async () => {
    const json = '{"segments":[{"text":"cut this"}]}';
    const request = vi.fn().mockResolvedValue({ projectItemId: "clip-1", projectItemName: "Interview", json });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).plan_transcript_rough_cut_uxp.handler({
      project_item_id: "clip-1",
      transcript_revision: transcriptRevision(json),
      deletions: [{ start_seconds: 2, end_seconds: 4 }],
      placements: [{
        placement_id: "timeline-clip-1",
        track_type: "video",
        track_index: 0,
        source_in_seconds: 0,
        source_out_seconds: 10,
        timeline_start_seconds: 20,
        timeline_end_seconds: 30,
      }],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("transcript.export", { projectItemId: "clip-1" });
    expect(result).toMatchObject({
      success: true,
      data: { result: { applied: false, requiresDuplicateSequence: true, steps: [{ timeline_range: { start_seconds: 22, end_seconds: 24 } }] } },
    });
  });
});
