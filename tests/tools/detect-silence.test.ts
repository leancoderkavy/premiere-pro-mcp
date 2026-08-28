import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  getAudioTools,
  invertToSegments,
  mapSilenceIntervalsToTimeline,
  parseDurationSeconds,
  parseSilenceDetectOutput,
} from "../../src/tools/audio.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getAudioTools({ tempDir: "/tmp/test", timeoutMs: 1000 });

beforeEach(() => vi.clearAllMocks());

describe("parseSilenceDetectOutput", () => {
  it("pairs each silence_start with its silence_end", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 2.5",
      "[silencedetect @ 0x1] silence_end: 6.25 | silence_duration: 3.75",
      "[silencedetect @ 0x1] silence_start: 10",
      "[silencedetect @ 0x1] silence_end: 12.5 | silence_duration: 2.5",
    ].join("\n");

    expect(parseSilenceDetectOutput(stderr, 20)).toEqual([
      { start: 2.5, end: 6.25, duration: 3.75 },
      { start: 10, end: 12.5, duration: 2.5 },
    ]);
  });

  it("closes a silence that runs to the end of the file at the media duration", () => {
    // ffmpeg emits no silence_end when the file ends mid-silence.
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 2",
      "[silencedetect @ 0x1] silence_end: 5 | silence_duration: 3",
      "[silencedetect @ 0x1] silence_start: 17.5",
    ].join("\n");

    expect(parseSilenceDetectOutput(stderr, 20)).toEqual([
      { start: 2, end: 5, duration: 3 },
      { start: 17.5, end: 20, duration: 2.5 },
    ]);
  });

  it("drops an unterminated silence when the duration is unknown", () => {
    const stderr = "[silencedetect @ 0x1] silence_start: 17.5";
    expect(parseSilenceDetectOutput(stderr, null)).toEqual([]);
  });

  it("clamps a negative silence_start to zero", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: -0.001",
      "[silencedetect @ 0x1] silence_end: 4 | silence_duration: 4",
    ].join("\n");
    expect(parseSilenceDetectOutput(stderr, 20)[0].start).toBe(0);
  });

  it("returns nothing for output containing no silence markers", () => {
    expect(parseSilenceDetectOutput("frame= 480 fps=0.0 q=-0.0", 20)).toEqual([]);
  });
});

describe("parseDurationSeconds", () => {
  it("reads the duration banner", () => {
    expect(parseDurationSeconds("  Duration: 00:00:20.00, start: 0.000000")).toBe(20);
  });

  it("handles hours and fractional seconds", () => {
    expect(parseDurationSeconds("  Duration: 01:02:03.50, bitrate: 1000 kb/s")).toBeCloseTo(3723.5, 3);
  });

  it("returns null when no duration is present", () => {
    expect(parseDurationSeconds("no banner here")).toBeNull();
  });
});

describe("invertToSegments", () => {
  it("returns the ranges between silences", () => {
    const silences = [
      { start: 2, end: 5, duration: 3 },
      { start: 10, end: 12, duration: 2 },
    ];
    expect(invertToSegments(silences, 20)).toEqual([
      { start: 0, end: 2, duration: 2 },
      { start: 5, end: 10, duration: 5 },
      { start: 12, end: 20, duration: 8 },
    ]);
  });

  it("omits a leading segment when the media opens on silence", () => {
    const silences = [{ start: 0, end: 4, duration: 4 }];
    expect(invertToSegments(silences, 20)).toEqual([
      { start: 4, end: 20, duration: 16 },
    ]);
  });

  it("omits a trailing segment when the media ends on silence", () => {
    const silences = [{ start: 16, end: 20, duration: 4 }];
    expect(invertToSegments(silences, 20)).toEqual([
      { start: 0, end: 16, duration: 16 },
    ]);
  });

  it("returns the whole media when there is no silence", () => {
    expect(invertToSegments([], 20)).toEqual([
      { start: 0, end: 20, duration: 20 },
    ]);
  });

  it("returns nothing usable when the duration is unknown", () => {
    expect(invertToSegments([], null)).toEqual([]);
  });

  it("collapses fully silent media to no segments", () => {
    const silences = [{ start: 0, end: 20, duration: 20 }];
    expect(invertToSegments(silences, 20)).toEqual([]);
  });
});

describe("mapSilenceIntervalsToTimeline", () => {
  it("clips source ranges and maps the retained intervals onto a 1x placement", () => {
    expect(mapSilenceIntervalsToTimeline([
      { start: 0, end: 4, duration: 4 },
      { start: 7, end: 12, duration: 5 },
    ], {
      sourceInSeconds: 2,
      sourceOutSeconds: 10,
      timelineStartSeconds: 100,
      maxCandidates: 50,
    })).toEqual({
      totalCandidateCount: 2,
      truncated: false,
      candidates: [
        {
          sourceStartSeconds: 2,
          sourceEndSeconds: 4,
          durationSeconds: 2,
          timelineStartSeconds: 100,
          timelineEndSeconds: 102,
        },
        {
          sourceStartSeconds: 7,
          sourceEndSeconds: 10,
          durationSeconds: 3,
          timelineStartSeconds: 105,
          timelineEndSeconds: 108,
        },
      ],
    });
  });

  it("keeps counting bounded candidates after its response limit", () => {
    const result = mapSilenceIntervalsToTimeline([
      { start: 1, end: 2, duration: 1 },
      { start: 3, end: 4, duration: 1 },
    ], {
      sourceInSeconds: 0,
      sourceOutSeconds: 10,
      timelineStartSeconds: 0,
      maxCandidates: 1,
    });
    expect(result.totalCandidateCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(1);
  });
});

describe("detect_silence argument handling", () => {
  it("requires either a media path or a project item", async () => {
    const result = await tools.detect_silence.handler({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("media_path or project_item_id");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("rejects a positive noise threshold", async () => {
    const result = await tools.detect_silence.handler({
      media_path: "/tmp/whatever.mp4",
      noise_threshold_db: 12,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("dBFS");
  });

  it("rejects a non-positive minimum duration", async () => {
    const result = await tools.detect_silence.handler({
      media_path: "/tmp/whatever.mp4",
      min_duration_seconds: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("greater than 0");
  });

  it("reports a missing file before shelling out to ffmpeg", async () => {
    const result = await tools.detect_silence.handler({
      media_path: "/tmp/definitely-not-here-9f3a2b.mp4",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found on disk");
  });

  it("resolves a project item's media path through the bridge", async () => {
    mockedSendCommand.mockResolvedValueOnce({
      success: false,
      error: "Project item not found: missing-clip",
    });
    const result = await tools.detect_silence.handler({
      project_item_id: "missing-clip",
    });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(mockedSendCommand.mock.calls[0][0]).toContain("getMediaPath");
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing-clip");
  });
});

describe("plan_silence_review_markers argument handling", () => {
  const plan = tools.plan_silence_review_markers;

  it("rejects invalid placement or response bounds before decoding media", async () => {
    await expect(plan.handler({
      media_path: "/tmp/does-not-matter.mov",
      timeline_start_seconds: -1,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("timeline_start_seconds") });
    await expect(plan.handler({
      media_path: "/tmp/does-not-matter.mov",
      timeline_start_seconds: 0,
      source_in_seconds: 5,
      source_out_seconds: 5,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("source_out_seconds") });
    await expect(plan.handler({
      media_path: "/tmp/does-not-matter.mov",
      timeline_start_seconds: 0,
      max_candidates: 201,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("max_candidates") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("detect_silence distribution prerequisites", () => {
  it("installs ffmpeg in the production container", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/apk add --no-cache ffmpeg/);
  });

  it("documents the local ffmpeg prerequisite", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("`detect_silence`");
    expect(readme).toContain("winget install Gyan.FFmpeg");
    expect(readme).toContain("brew install ffmpeg");
  });
});
