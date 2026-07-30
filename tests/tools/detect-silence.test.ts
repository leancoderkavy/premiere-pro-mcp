import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  getAudioTools,
  invertToSegments,
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
