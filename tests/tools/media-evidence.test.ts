import { beforeEach, describe, expect, it, vi } from "vitest";
const run = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(() => {}, { [promisify.custom]: run }) };
});
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
import { existsSync } from "node:fs";
import { probeMediaDurationSeconds } from "../../src/tools/media-evidence.js";
const stream = (duration_ts: unknown, time_base = "1/30000", codec_type = "video") => ({ codec_type, duration_ts, time_base });
const output = (streams: unknown[]) => ({ stdout: JSON.stringify({ streams }) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(existsSync).mockReturnValue(true); });
describe("physical media duration evidence", () => {
  it("uses integer timestamp clocks instead of rounded format duration", async () => {
    run.mockResolvedValue({ stdout: JSON.stringify({ format: { duration: "3.336667" }, streams: [stream(100100)] }) });
    expect(await probeMediaDurationSeconds("/source.mp4")).toBe(100100 / 30000);
    expect(run).toHaveBeenCalledWith("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration_ts,time_base", "-of", "json", "/source.mp4"], expect.any(Object));
  });
  it("takes the conservative intersection of audio and video duration", async () => {
    run.mockResolvedValue(output([stream(300000), stream(432000, "1/48000", "audio")]));
    expect(await probeMediaDurationSeconds("/source.mp4")).toBe(9);
  });
  it("ignores non-media stream clocks", async () => {
    run.mockResolvedValue(output([stream(300000), { codec_type: "subtitle" }]));
    expect(await probeMediaDurationSeconds("/source.mp4")).toBe(10);
  });
  it.each([undefined, "N/A", 0, -1, 1.5, 9007199254740992])("refuses an unknown or unsafe duration timestamp %s", async (duration) => {
    run.mockResolvedValue(output([stream(300000), stream(duration, "1/48000", "audio")]));
    expect(await probeMediaDurationSeconds("/source.mp4")).toBeNull();
  });
  it.each(["0/30000", "1/0", "N/A", "0.5/30000", "1/9007199254740992"])("refuses an invalid time base %s", async (timebase) => {
    run.mockResolvedValue(output([stream(300000, timebase)]));
    expect(await probeMediaDurationSeconds("/source.mp4")).toBeNull();
  });
  it("has no extension-based still exception", async () => {
    run.mockResolvedValue(output([stream(undefined)]));
    expect(await probeMediaDurationSeconds("/source.png")).toBeNull();
  });
  it("refuses missing files and failed probes", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(await probeMediaDurationSeconds("/missing.mp4")).toBeNull();
    expect(run).not.toHaveBeenCalled();
    vi.mocked(existsSync).mockReturnValue(true);
    run.mockRejectedValue(Error("ffprobe unavailable"));
    expect(await probeMediaDurationSeconds("/source.mp4")).toBeNull();
  });
});
