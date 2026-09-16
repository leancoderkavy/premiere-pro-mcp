import { describe, expect, it } from "vitest";
import { buildCmx3600Edl, framesToTimecode, resolveTimecodeRate } from "../../src/ai/edl-export.js";
import { parseCmx3600Edl, timecodeToFrames, validateCmx3600Edl } from "../../src/tools/interchange-analysis.js";

const SNAPSHOT = {
  name: "Spot v3",
  id: "42",
  frameRate: 25,
  zeroPointSeconds: 3600,
  dropFrame: false,
  tracks: [
    {
      type: "video",
      index: 0,
      name: "V1",
      clips: [
        { nodeId: "n1", name: "Interview A.mov", startSeconds: 0, endSeconds: 4, inPointSeconds: 10, outPointSeconds: 14, enabled: true, speed: 100, mediaStartSeconds: 3600 },
        { nodeId: "n2", name: "B-Roll #2!", startSeconds: 4, endSeconds: 6.5, inPointSeconds: 0, outPointSeconds: 2.5, enabled: true, speed: 100 },
        { nodeId: "n3", name: "Interview A.mov", startSeconds: 7, endSeconds: 9, inPointSeconds: 30, outPointSeconds: 34, enabled: true, speed: 200 },
        { nodeId: "n4", name: "Old take", startSeconds: 9, endSeconds: 10, inPointSeconds: 0, outPointSeconds: 1, enabled: false, speed: 100 },
      ],
    },
    { type: "audio", index: 0, name: "A1", clips: [{ nodeId: "a1", name: "VO", startSeconds: 0, endSeconds: 10, inPointSeconds: 0, outPointSeconds: 10, enabled: true, speed: 100 }] },
  ],
};

describe("framesToTimecode", () => {
  it("round-trips non-drop and drop-frame timecode through the CMX parser", () => {
    for (const frames of [0, 1, 29, 30, 1798, 1799, 1800, 17982, 17983, 107892, 215784, 1_000_000]) {
      expect(timecodeToFrames(framesToTimecode(frames, 29.97, true), 29.97)).toBe(frames);
      expect(timecodeToFrames(framesToTimecode(frames, 30, false), 30)).toBe(frames);
      expect(timecodeToFrames(framesToTimecode(frames, 59.94, true), 59.94)).toBe(frames);
      expect(timecodeToFrames(framesToTimecode(frames, 24, false), 24)).toBe(frames);
    }
    expect(framesToTimecode(1800, 29.97, true)).toBe("00:01:00;02");
    expect(framesToTimecode(17982, 29.97, true)).toBe("00:10:00;00");
    expect(framesToTimecode(90000, 25, false)).toBe("01:00:00:00");
  });

  it("refuses drop-frame at integer rates", () => {
    expect(() => framesToTimecode(10, 25, true)).toThrow(/Drop-frame/);
  });
});

describe("resolveTimecodeRate", () => {
  it("snaps measured rates and applies the 23.976 convention", () => {
    expect(resolveTimecodeRate(29.97002997)).toEqual({ rate: 29.97, note: null });
    expect(resolveTimecodeRate(23.976).rate).toBe(24);
    expect(resolveTimecodeRate(23.976).note).toMatch(/23\.976/);
    expect(resolveTimecodeRate(25, 30).rate).toBe(30);
    expect(() => resolveTimecodeRate(17)).toThrow(/no CMX 3600 timecode rate/);
    expect(() => resolveTimecodeRate(25, 26)).toThrow(/frame_rate must be one of/);
  });
});

describe("buildCmx3600Edl", () => {
  it("writes a valid single-track list with reels, comments, M2 lines, and record offsets", () => {
    const result = buildCmx3600Edl(SNAPSHOT);
    expect(result.validation.valid).toBe(true);
    expect(result.event_count).toBe(3);
    expect(result.skipped_disabled).toBe(1);
    expect(result.retimed_events).toBe(1);
    expect(result.timecode_rate).toBe(25);
    expect(result.drop_frame).toBe(false);
    expect(result.title).toBe("Spot v3");
    expect(result.edl.startsWith("TITLE: Spot v3\r\nFCM: NON-DROP FRAME\r\n")).toBe(true);

    const [first, second, third] = result.events;
    expect(first.reel).toBe("INTERVIE");
    expect(third.reel).toBe("INTERVIE");
    expect(second.reel).toBe("BROLL2");
    expect(first.source_in).toBe("01:00:10:00");
    expect(first.source_out).toBe("01:00:14:00");
    expect(first.record_in).toBe("01:00:00:00");
    expect(first.record_out).toBe("01:00:04:00");
    expect(third.motion_line).toMatch(/^M2\s+INTERVIE\s+050\.0\s+00:00:30:00$/);
    expect(third.source_out).toBe("00:00:34:00");
    expect(result.edl).toContain("* FROM CLIP NAME: B-Roll #2!");
    expect(result.edl).toMatch(/^001  INTERVIE V     C        01:00:10:00 01:00:14:00 01:00:00:00 01:00:04:00\r?$/m);
    expect(result.warnings.some((warning) => warning.includes("Gap of 12 frame(s)"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("1 disabled clip"))).toBe(true);
    expect(result.reels.map((reel) => reel.reel)).toEqual(["INTERVIE", "BROLL2"]);
    expect(result.edl_sha256).toMatch(/^[a-f0-9]{64}$/);

    const parsed = parseCmx3600Edl(result.edl);
    expect(parsed.title).toBe("Spot v3");
    expect(parsed.events).toHaveLength(3);
    expect(parsed.unrecognizedEventLines).toEqual([]);
    expect(validateCmx3600Edl(parsed, 25).valid).toBe(true);
  });

  it("supports numbered reels, disabled clips, audio tracks, and custom record start", () => {
    const result = buildCmx3600Edl(SNAPSHOT, { reel_mode: "numbered", include_disabled: true, record_start_seconds: 0, include_clip_name_comments: false });
    expect(result.event_count).toBe(4);
    expect(result.events.map((event) => event.reel)).toEqual(["001", "002", "003", "004"]);
    expect(result.events[3].disabled).toBe(true);
    expect(result.edl).toContain("* DISABLED IN PREMIERE");
    expect(result.edl).not.toContain("FROM CLIP NAME");
    expect(result.events[0].record_in).toBe("00:00:00:00");

    const audio = buildCmx3600Edl(SNAPSHOT, { track_type: "audio", track_index: 0, title: "AUDIO PASS" });
    expect(audio.events[0].track).toBe("A");
    expect(audio.title).toBe("AUDIO PASS");
  });

  it("uses tape names when requested and falls back to clip names", () => {
    const snapshot = structuredClone(SNAPSHOT);
    (snapshot.tracks[0].clips[0] as Record<string, unknown>).tapeName = "A001C003";
    const result = buildCmx3600Edl(snapshot, { reel_mode: "tape_name" });
    expect(result.events[0].reel).toBe("A001C003");
    expect(result.reels[0].source).toBe("tape_name");
    expect(result.events[1].reel).toBe("BROLL2");
  });

  it("writes drop-frame timecode when the sequence display format says so", () => {
    const snapshot = { ...SNAPSHOT, frameRate: 29.97002997, dropFrame: true, zeroPointSeconds: 0 };
    const result = buildCmx3600Edl(snapshot);
    expect(result.drop_frame).toBe(true);
    expect(result.edl).toContain("FCM: DROP FRAME");
    expect(result.events[0].record_in).toBe("00:00:00;00");
    expect(result.validation.valid).toBe(true);
    expect(() => buildCmx3600Edl({ ...SNAPSHOT, frameRate: 25 }, { drop_frame: true })).toThrow(/only valid at 29\.97/);
  });

  it("accepts raw get_sequence_structure shapes and multiplier speeds", () => {
    const raw = {
      name: "Raw",
      id: 7,
      frameRate: 24,
      videoTracks: [{ index: 0, clips: [{ nodeId: "x", name: "Shot", startSeconds: 0, endSeconds: 2, inPointSeconds: 5, outPointSeconds: 7, enabled: true, speed: 1 }] }],
      audioTracks: [],
    };
    const result = buildCmx3600Edl(raw);
    expect(result.retimed_events).toBe(0);
    expect(result.events[0].speed_percent).toBe(100);
  });

  it("accepts alternate snapshot keys, string numbers, and raw-array track lookup", () => {
    const alternate = {
      name: "  ",
      id: 9,
      frame_rate: "25",
      tracks: [
        { mediaType: "video", trackIndex: 0, clips: [] },
        {
          mediaType: "video",
          trackIndex: 1,
          clips: [
            { id: "alt-1", start_seconds: 0, end_seconds: 2, in_seconds: 1, out_seconds: 3, disabled: false, speed_percent: 100, projectItemName: "From Item" },
            { start_seconds: 2, end_seconds: 3, disabled: true },
            { start_seconds: 3, end_seconds: 4, speed: -1 },
          ],
        },
      ],
    };
    const result = buildCmx3600Edl(alternate, { track_index: 1, include_disabled: true, title: "ALT" });
    expect(result.sequence_name).toBeNull();
    expect(result.sequence_id).toBe("9");
    expect(result.timecode_rate).toBe(25);
    expect(result.events[0].node_id).toBe("alt-1");
    expect(result.events[0].clip_name).toBe("From Item");
    expect(result.events[1].clip_name).toBe("CLIP 2");
    expect(result.events[1].disabled).toBe(true);
    expect(result.events[2].speed_percent).toBe(-100);
    expect(result.events[2].motion_line).toMatch(/^M2\s+CLIP3\s+-025\.0\s+/);

    const rawFallback = { frameRate: 30, videoTracks: [{ clips: [{ startSeconds: 0, endSeconds: 1 }] }], audioTracks: [] };
    expect(buildCmx3600Edl(rawFallback).event_count).toBe(1);
    expect(() => buildCmx3600Edl({ frameRate: 30, videoTracks: [], audioTracks: [] })).toThrow(/No video track with index 0/);
    expect(() => buildCmx3600Edl({ frameRate: 30 })).toThrow(/must include tracks/);
    expect(() => buildCmx3600Edl({ frameRate: 30, tracks: [{ type: "video", index: 0, clips: "nope" }] })).toThrow(/clips must be an array/);
    expect(() => buildCmx3600Edl({ frameRate: 30, tracks: [{ type: "video", index: 0, clips: ["nope"] }] })).toThrow(/must be an object/);
    expect(() => buildCmx3600Edl({ frameRate: 30, tracks: [{ type: "video", index: 0, clips: [{ startSeconds: 1, endSeconds: 1 }] }] })).toThrow(/end after it starts/);
    expect(() => buildCmx3600Edl({ frameRate: 30, tracks: [{ type: "video", index: 0, clips: [{ startSeconds: "x", endSeconds: 1 }] }] })).toThrow(/finite number/);
    expect(() => buildCmx3600Edl({ frameRate: 30, tracks: [{ type: "video", index: 0, clips: [{ endSeconds: 1 }] }] })).toThrow(/startSeconds is required/);
  });

  it("validates option types and frame-rate edge cases", () => {
    expect(() => buildCmx3600Edl(SNAPSHOT, { include_disabled: "yes" })).toThrow(/include_disabled must be a boolean/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { track_index: 1.5 })).toThrow(/track_index must be an integer/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { record_start_seconds: -1 })).toThrow(/record_start_seconds/);
    expect(() => buildCmx3600Edl({ ...SNAPSHOT, frameRate: 0 })).toThrow(/between 0 and 240/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { title: 42 })).toThrow(/title must be/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { title: "x".repeat(80) })).toThrow(/title must be/);
    const overridden = buildCmx3600Edl(SNAPSHOT, { frame_rate: 30 });
    expect(overridden.warnings.some((warning) => warning.includes("overrides the sequence rate"))).toBe(true);
    expect(buildCmx3600Edl({ ...SNAPSHOT, frameRate: 47.952 }).warnings.some((warning) => warning.includes("47.952"))).toBe(true);
    // Sub-frame clips collapse at the timecode rate and are refused rather than written as zero-length events.
    const tiny = { ...SNAPSHOT, tracks: [{ type: "video", index: 0, clips: [{ name: "Tiny", startSeconds: 0, endSeconds: 0.01, inPointSeconds: 0, outPointSeconds: 0.01 }] }] };
    expect(() => buildCmx3600Edl(tiny)).toThrow(/collapses to zero frames/);
    // A retimed clip whose host out point precedes its in point still gets a positive source span.
    const inverted = { ...SNAPSHOT, tracks: [{ type: "video", index: 0, clips: [{ name: "Rev", startSeconds: 0, endSeconds: 2, inPointSeconds: 10, outPointSeconds: 9, speed: 150 }] }] };
    const fixed = buildCmx3600Edl(inverted);
    expect(fixed.events[0].source_out).toBe("00:00:12:00");
  });

  it("fails closed on overlapping clips, empty tracks, and bad options", () => {
    const overlapping = structuredClone(SNAPSHOT);
    overlapping.tracks[0].clips[1].startSeconds = 3;
    expect(() => buildCmx3600Edl(overlapping)).toThrow(/overlaps the previous event/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { track_index: 3 })).toThrow(/No video track with index 3/);
    expect(() => buildCmx3600Edl({ ...SNAPSHOT, tracks: [{ type: "video", index: 0, clips: [] }] })).toThrow(/no clips/);
    expect(() => buildCmx3600Edl({ ...SNAPSHOT, tracks: [{ type: "video", index: 0, clips: [{ startSeconds: 0, endSeconds: 1, enabled: false }] }] })).toThrow(/no enabled clips/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { title: "" })).toThrow(/title/);
    expect(() => buildCmx3600Edl(SNAPSHOT, { reel_mode: "random" })).toThrow(/reel_mode/);
    expect(() => buildCmx3600Edl("nope")).toThrow(/snapshot must be an object/);
  });
});
