import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { CHECKPOINT_PREFIX, getEditorRequestTools, PLAYHEAD_ACTIONS } from "../../src/tools/editor-requests.js";

const bridgeOptions: BridgeOptions = { tempDir: "/tmp/editor-request-tests", timeoutMs: 5000 };
const mockedSendCommand = vi.mocked(sendCommand);
const tools = getEditorRequestTools(bridgeOptions);

const READBACK = {
  name: "Podcast 12",
  id: "77",
  frameRate: 29.97002997,
  zeroPointSeconds: 3600,
  dropFrame: true,
  tracks: [{
    type: "video",
    index: 0,
    name: "V1",
    clips: [
      { nodeId: "c1", name: "Cam A", startSeconds: 0, endSeconds: 5, inPointSeconds: 10, outPointSeconds: 15, enabled: true, speed: 100, mediaStartSeconds: 0 },
      { nodeId: "c2", name: "Cam B", startSeconds: 5, endSeconds: 9, inPointSeconds: 20, outPointSeconds: 24, enabled: true, speed: 100 },
    ],
  }],
};

describe("editor-request tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSendCommand.mockResolvedValue({ success: true, data: {} });
  });

  it("exposes the requested tool names", () => {
    expect(Object.keys(tools).sort()).toEqual([
      "add_markers_batch",
      "create_sequence_checkpoint",
      "export_sequence_edl",
      "list_sequence_checkpoints",
      "navigate_playhead",
      "select_clips_by_pattern",
    ]);
  });

  describe("add_markers_batch", () => {
    it("validates every marker before contacting Premiere", async () => {
      expect((await tools.add_markers_batch.handler({ markers: [] })).success).toBe(false);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: -1 }] })).error).toMatch(/markers\[0\]\.time_seconds/);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1, color: 9 }] })).error).toMatch(/color/);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1 }], sequence_id: "x", node_id: "y" })).error).toMatch(/cannot be combined/);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1 }], skip_existing_within_frames: 500 })).error).toMatch(/skip_existing_within_frames/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("sorts, dedupes, preflights range, and verifies count and times", async () => {
      mockedSendCommand.mockResolvedValue({ success: true, data: { createdCount: 2 } });
      const result = await tools.add_markers_batch.handler({
        markers: [
          { time_seconds: 10, name: "Chapter 2", color: 6 },
          { time_seconds: 2.5, name: "Beat \"one\"", comments: "line1\nline2", duration_seconds: 1 },
          { time_seconds: 10, name: "Chapter 2" },
        ],
        skip_existing_within_frames: 2,
      });
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).duplicateRequestsIgnored).toBe(1);
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script.indexOf("t: 2.5")).toBeLessThan(script.indexOf("t: 10"));
      expect(script).toContain('n: "Beat \\"one\\""');
      expect(script).toContain("Preflight range before any write");
      expect(script).toContain("allow_beyond_end");
      expect(script).toContain("markers.createMarker(spec.t)");
      expect(script).toContain("setColorByIndex");
      expect(script).toContain("afterCount !== beforeCount + created.length");
      expect(script).toContain("var skipWithinSeconds = 2 * frameSeconds");
      expect(script).toContain("__result(");
    });

    it("rejects malformed names, comments, and durations", async () => {
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1, name: 5 as never }] })).error).toMatch(/name must be a string/);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1, comments: "x".repeat(2001) }] })).error).toMatch(/comments must be a string/);
      expect((await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1, duration_seconds: -2 }] })).error).toMatch(/duration_seconds/);
      expect((await tools.add_markers_batch.handler({ markers: [null as never] })).error).toMatch(/time_seconds/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("passes through a plain result when nothing was deduplicated and honours allow_beyond_end", async () => {
      mockedSendCommand.mockResolvedValue({ success: true, data: { createdCount: 1 } });
      const result = await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1 }], sequence_id: "Seq A", allow_beyond_end: true });
      expect(result.data).toEqual({ createdCount: 1 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('__findSequence("Seq A")');
      expect(script).toContain("var allowBeyondEnd = true");
      mockedSendCommand.mockResolvedValue({ success: false, error: "No active sequence" });
      expect(await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1 }, { time_seconds: 1 }] })).toEqual({ success: false, error: "No active sequence" });
    });

    it("targets a clip when node_id is given", async () => {
      await tools.add_markers_batch.handler({ markers: [{ time_seconds: 1 }], node_id: "clip-9" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('__findClip("clip-9")');
      expect(script).toContain('targetKind = "clip"');
      expect(script).toContain("clipResult.clip.markers");
    });
  });

  describe("select_clips_by_pattern", () => {
    it("rejects impossible patterns and filters before contacting Premiere", async () => {
      expect((await tools.select_clips_by_pattern.handler({ every_nth: 2, offset: 2 })).error).toMatch(/offset/);
      expect((await tools.select_clips_by_pattern.handler({ every_nth: 0 })).error).toMatch(/every_nth/);
      expect((await tools.select_clips_by_pattern.handler({ min_duration_seconds: 5, max_duration_seconds: 1 })).error).toMatch(/max_duration_seconds/);
      expect((await tools.select_clips_by_pattern.handler({ start_seconds: 5, end_seconds: 5 })).error).toMatch(/end_seconds/);
      expect((await tools.select_clips_by_pattern.handler({ name_regex: "([" })).error).toMatch(/not a valid regular expression/);
      expect((await tools.select_clips_by_pattern.handler({ name_regex: "(?<=a)b" })).error).toMatch(/ES3/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("generates an every-other-clip selection with readback", async () => {
      await tools.select_clips_by_pattern.handler({ every_nth: 2, offset: 1, track_type: "video", track_index: 0, name_contains: "B-Roll", count_scope: "across_tracks", include_disabled: false });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var everyNth = 2");
      expect(script).toContain("var offset = 1");
      expect(script).toContain("var perTrack = false");
      expect(script).toContain('var nameContains = "b-roll"');
      expect(script).toContain("var includeDisabled = false");
      expect(script).toContain("var trackIndexFilter = 0");
      expect(script).toContain("(ordinal - offset) % everyNth !== 0");
      expect(script).toContain("setSelected(true, true)");
      expect(script).toContain("verifiedSelected !== chosen.length");
      expect(script).not.toContain("candidatesFrom(seq.audioTracks");
    });

    it("compiles a regex filter into the ES3 script", async () => {
      await tools.select_clips_by_pattern.handler({ name_regex: "^A00\\d+", track_type: "both" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('new RegExp("^A00\\\\d+", "i")');
      expect(script).toContain("candidatesFrom(seq.audioTracks");
    });

    it("emits null filters by default and validates numeric filters", async () => {
      await tools.select_clips_by_pattern.handler({ track_type: "audio", add_to_selection: true, min_duration_seconds: 1, max_duration_seconds: 4, start_seconds: 0, end_seconds: 9 });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var nameContains = null");
      expect(script).toContain("var nameRegex = null");
      expect(script).toContain("var trackIndexFilter = null");
      expect(script).toContain("var addToSelection = true");
      expect(script).toContain("var minDuration = 1");
      expect(script).toContain("var rangeEnd = 9");
      expect(script).not.toContain("candidatesFrom(seq.videoTracks");
      expect((await tools.select_clips_by_pattern.handler({ track_index: 2.5 })).error).toMatch(/track_index/);
      expect((await tools.select_clips_by_pattern.handler({ min_duration_seconds: -1 })).error).toMatch(/min_duration_seconds/);
      expect((await tools.select_clips_by_pattern.handler({ name_regex: "x".repeat(256) })).error).toMatch(/name_regex/);
    });
  });

  describe("navigate_playhead", () => {
    it("validates the action and frame count", async () => {
      expect((await tools.navigate_playhead.handler({ action: "sideways" as never })).error).toMatch(/action must be one of/);
      expect((await tools.navigate_playhead.handler({ action: "step_forward", frames: 0 })).error).toMatch(/frames/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("defaults to all tracks and one frame, and validates track_index", async () => {
      await tools.navigate_playhead.handler({ action: "next_edit" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("var frames = 1");
      expect(script).toContain("var trackIndexFilter = null");
      expect(script).toContain("scan(seq.videoTracks);");
      expect(script).toContain("scan(seq.audioTracks);");
      expect((await tools.navigate_playhead.handler({ action: "next_edit", track_index: -1 })).error).toMatch(/track_index/);
      vi.clearAllMocks();
      await tools.navigate_playhead.handler({ action: "previous_edit", track_type: "audio" });
      expect(mockedSendCommand.mock.calls[0][0]).not.toContain("scan(seq.videoTracks);");
    });

    it("moves and reads back for every action", async () => {
      for (const action of PLAYHEAD_ACTIONS) {
        vi.clearAllMocks();
        const result = await tools.navigate_playhead.handler({ action, frames: 3, track_type: "video", track_index: 1 });
        expect(result.success).toBe(true);
        const script = mockedSendCommand.mock.calls[0][0];
        expect(script).toContain(`var action = "${action}"`);
        expect(script).toContain("var frames = 3");
        expect(script).toContain("seq.setPlayerPosition(String(Math.round(target)))");
        expect(script).toContain("Math.abs(observed - target) > frameTicks");
        expect(script).toContain("__result(");
      }
    });
  });

  describe("create_sequence_checkpoint / list_sequence_checkpoints", () => {
    it("rejects bad labels", async () => {
      expect((await tools.create_sequence_checkpoint.handler({ label: "a\nb" })).error).toMatch(/label/);
      expect((await tools.create_sequence_checkpoint.handler({ label: "x".repeat(65) })).error).toMatch(/label/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("clones, renames, verifies structure, re-activates, and returns a snapshot", async () => {
      await tools.create_sequence_checkpoint.handler({ label: "before multicam", sequence_id: "Podcast 12" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain('__findSequence("Podcast 12")');
      expect(script).toContain(`"${CHECKPOINT_PREFIX} " + originalName + " - before multicam - `);
      expect(script).toMatch(/\d{8}-\d{6}Z/);
      expect(script).toContain("seq.clone()");
      expect(script).toContain("clone.name = checkpointName");
      expect(script).toContain("clip counts differ");
      expect(script).toContain("project.openSequence(activeBefore)");
      expect(script).toContain("snapshot: snapshot");
      expect(script).toContain("__sequenceSnapshot(seq)");
    });

    it("can omit the snapshot and lists checkpoints read-only", async () => {
      await tools.create_sequence_checkpoint.handler({ include_snapshot: false });
      const createScript = mockedSendCommand.mock.calls[0][0];
      expect(createScript).toContain("snapshot: null");
      expect(createScript).toContain(" - checkpoint - ");
      expect(createScript).toContain("__getCurrentActiveSequence()");
      vi.clearAllMocks();
      await tools.list_sequence_checkpoints.handler({});
      expect(mockedSendCommand.mock.calls[0][0]).not.toContain("filterSeq");
      vi.clearAllMocks();
      await tools.list_sequence_checkpoints.handler({ sequence_id: "Podcast 12" });
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain(`var prefix = "${CHECKPOINT_PREFIX} "`);
      expect(script).toContain("originalName = String(filterSeq.name)");
      expect(script).not.toContain("clone()");
      expect(script).not.toContain("deleteSequence");
    });
  });

  describe("export_sequence_edl", () => {
    let workspace: string;
    beforeEach(() => {
      workspace = mkdtempSync(path.join(tmpdir(), "edl-export-"));
    });
    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it("validates paths and options before contacting Premiere", async () => {
      expect((await tools.export_sequence_edl.handler({ output_path: path.join(workspace, "a.edl") })).error).toMatch(/approved_workspace_path is required/);
      expect((await tools.export_sequence_edl.handler({ approved_workspace_path: workspace })).error).toMatch(/only accepted together/);
      expect((await tools.export_sequence_edl.handler({ output_path: path.join(workspace, "a.txt"), approved_workspace_path: workspace })).error).toMatch(/\.edl extension/);
      expect((await tools.export_sequence_edl.handler({ output_path: path.join(tmpdir(), "escape.edl"), approved_workspace_path: workspace })).error).toMatch(/contained within/);
      expect((await tools.export_sequence_edl.handler({ track_index: -1 })).error).toMatch(/track_index/);
      expect(mockedSendCommand).not.toHaveBeenCalled();
    });

    it("reads back one track and returns a validated EDL inline", async () => {
      mockedSendCommand.mockResolvedValue({ success: true, data: READBACK });
      const result = await tools.export_sequence_edl.handler({ sequence_id: "Podcast 12", reel_mode: "tape_name" });
      expect(result.success).toBe(true);
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("seq.videoTracks");
      expect(script).toContain("var trackIndex = 0");
      expect(script).toContain("item.startTime()");
      expect(script).toContain("xmpDM:tapeName");
      expect(script).toContain("seq.videoDisplayFormat");
      expect(script).not.toContain("exportAsMediaDirect");
      const data = result.data as Record<string, unknown>;
      expect(data.written).toBe(false);
      expect(data.drop_frame).toBe(true);
      expect(data.timecode_rate).toBe(29.97);
      expect(data.event_count).toBe(2);
      expect(String(data.edl)).toContain("FCM: DROP FRAME");
      expect(String(data.edl)).toContain("01:00:00;00");
      expect((data.validation as { valid: boolean }).valid).toBe(true);
      expect(data.verificationScope).toMatch(/not a Premiere-native export/);
    });

    it("writes the EDL inside the approved workspace and never overwrites", async () => {
      mockedSendCommand.mockResolvedValue({ success: true, data: READBACK });
      const target = path.join(workspace, "podcast.edl");
      const result = await tools.export_sequence_edl.handler({ output_path: target, approved_workspace_path: workspace, track_type: "video", frame_rate: 30, drop_frame: false });
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.written).toBe(true);
      // macOS resolves /var to /private/var through realpath; compare canonical paths.
      expect(data.output_path).toBe(path.join(realpathSync(workspace), "podcast.edl"));
      expect(readFileSync(target, "utf8")).toContain("FCM: NON-DROP FRAME");
      expect(data.edl).toBeUndefined();
      const again = await tools.export_sequence_edl.handler({ output_path: target, approved_workspace_path: workspace });
      expect(again.success).toBe(false);
      expect(again.error).toMatch(/already exists/);
    });

    it("propagates readback failures and generator errors", async () => {
      mockedSendCommand.mockResolvedValue({ success: false, error: "No active sequence" });
      expect(await tools.export_sequence_edl.handler({})).toEqual({ success: false, error: "No active sequence" });
      mockedSendCommand.mockResolvedValue({ success: true, data: { ...READBACK, frameRate: 17 } });
      expect((await tools.export_sequence_edl.handler({})).error).toMatch(/no CMX 3600 timecode rate/);
      writeFileSync(path.join(workspace, "keep.txt"), "x");
    });

    it("reads audio tracks without the tape-name XMP probe and rejects bad track types", async () => {
      mockedSendCommand.mockResolvedValue({ success: true, data: { ...READBACK, tracks: [{ ...READBACK.tracks[0], type: "audio", index: 1 }] } });
      const result = await tools.export_sequence_edl.handler({ track_type: "audio", track_index: 1, reel_mode: "numbered" });
      expect(result.success).toBe(true);
      const script = mockedSendCommand.mock.calls[0][0];
      expect(script).toContain("seq.audioTracks");
      expect(script).toContain("var trackIndex = 1");
      expect(script).not.toContain("xmpDM:tapeName");
      expect((result.data as Record<string, unknown>).events).toHaveLength(2);
      expect((await tools.export_sequence_edl.handler({ track_type: "captions" as never })).error).toMatch(/track_type/);
    });

    it("refuses inline output above the size limit", async () => {
      const clips = Array.from({ length: 1900 }, (_, index) => ({
        nodeId: `c${index}`,
        name: `Clip ${index} ${"long name padding ".repeat(12)}`,
        startSeconds: index,
        endSeconds: index + 1,
        inPointSeconds: 0,
        outPointSeconds: 1,
        enabled: true,
        speed: 100,
      }));
      mockedSendCommand.mockResolvedValue({ success: true, data: { ...READBACK, frameRate: 25, dropFrame: false, tracks: [{ type: "video", index: 0, clips }] } });
      const result = await tools.export_sequence_edl.handler({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/above the .* inline limit/);
    });
  });
});
