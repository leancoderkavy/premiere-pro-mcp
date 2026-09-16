import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planReactionCaptions,
  planShortExportFolder,
  planShortSubscribeCta,
} from "../../src/ai/reaction-shorts.js";
import type { TranscriptWord } from "../../src/ai/word-timeline.js";

const revision = `sha256:${"c".repeat(64)}`;
const word = (text: string, start: number, end: number, speaker?: string): TranscriptWord => (
  speaker ? { text, start_seconds: start, end_seconds: end, speaker_label: speaker } : { text, start_seconds: start, end_seconds: end }
);
const timeline = (words: TranscriptWord[]) => ({
  source_project_item_id: "clip-doro",
  transcript_revision: revision,
  words,
});
const palette = [
  { speaker_label: "JYR", color: "#3B82F6" },
  { speaker_label: "Nanda", color: "#EF4444" },
  { speaker_label: "YYQ", color: "#22C55E" },
];

describe("planReactionCaptions", () => {
  it("stacks overlapping speakers and keeps palette colors", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("No!", 14.8, 16.2, "Nanda"),
        word("No!", 14.85, 16.1, "YYQ"),
      ]),
      speaker_palette: palette,
    });
    expect(plan.applied).toBe(false);
    expect(plan.stacked_overlap_count).toBe(1);
    expect(plan.cues.map((cue) => [cue.speaker_label, cue.color, cue.stack_slot, cue.review_stack])).toEqual([
      ["Nanda", "#EF4444", 0, false],
      ["YYQ", "#22C55E", 1, true],
    ]);
    expect(plan.cues[0].position.y).toBe(0.7);
    expect(plan.cues[1].position.y).toBe(0.62);
    expect(plan.uncertain_speakers).toEqual([]);
  });

  it("combines same-speaker flashes across an interleaved talker", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("no", 12.0, 12.2, "Nanda"),
        word("wait", 12.1, 12.6, "YYQ"),
        word("please", 12.35, 13.1, "Nanda"),
      ]),
      speaker_palette: palette,
    });
    expect(plan.cues.map((cue) => [cue.speaker_label, cue.text, cue.merged_cue_count])).toEqual([
      ["Nanda", "No, please", 2],
      ["YYQ", "Wait", 1],
    ]);
    expect(plan.stacked_overlap_count).toBeGreaterThan(0);
  });

  it("combines a flash word with the next same-speaker line", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("no", 12.0, 12.2, "Nanda"),
        word("please", 12.35, 13.1, "Nanda"),
      ]),
      speaker_palette: palette,
    });
    expect(plan.cues).toHaveLength(1);
    expect(plan.cues[0]).toMatchObject({
      text: "No, please",
      speaker_label: "Nanda",
      color: "#EF4444",
      merged_cue_count: 2,
    });
  });

  it("combines a flash word across an overlapping speaker", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("no", 12.0, 12.2, "Nanda"),
        word("oops", 12.1, 12.5, "YYQ"),
        word("please", 12.55, 13.2, "Nanda"),
      ]),
      speaker_palette: palette,
    });
    expect(plan.cues).toHaveLength(2);
    expect(plan.cues[0]).toMatchObject({
      text: "No, please",
      speaker_label: "Nanda",
      color: "#EF4444",
      merged_cue_count: 2,
    });
    expect(plan.cues[1]).toMatchObject({ speaker_label: "YYQ", text: "Oops", stack_slot: 1, review_stack: true });
  });

  it("leaves unknown speakers uncolored instead of guessing", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("Whoa", 6.0, 6.8, "YYQ"),
        word("Cross?", 7.0, 8.2, "Guest"),
      ]),
      speaker_palette: palette,
    });
    expect(plan.cues[1]).toMatchObject({ speaker_label: "Guest", color: null, uncertain: true });
    expect(plan.uncertain_speakers).toEqual(["Guest"]);
    expect(plan.warnings[0]).toMatch(/Guest/);
    expect(plan.apply_boundary).toMatch(/never receive a guessed color|Do not invent a color/i);
  });

  it("clamps a caption to the speaker's shot change", () => {
    const plan = planReactionCaptions({
      word_timeline: timeline([
        word("Was", 17.0, 17.3, "YYQ"),
        word("he", 17.3, 17.5, "YYQ"),
        word("aiming?", 17.5, 18.6, "YYQ"),
      ]),
      speaker_palette: palette,
      shot_changes: [{ time_seconds: 17.4, speaker_label: "YYQ" }],
    });
    expect(plan.cues).toHaveLength(1);
    expect(plan.cues[0].start_seconds).toBe(17.4);
    expect(plan.cues[0].aligned_to_shot).toBe(true);
    expect(plan.cues[0].text).toBe("Was he aiming?");
  });

  it("rejects invalid palette colors and unknown fields", () => {
    expect(() => planReactionCaptions({
      word_timeline: timeline([word("Hi", 0, 1, "JYR")]),
      speaker_palette: [{ speaker_label: "JYR", color: "blue" }],
    })).toThrow(/#RRGGBB/);
    expect(() => planReactionCaptions({
      word_timeline: timeline([word("Hi", 0, 1, "JYR")]),
      speaker_palette: palette,
      extra: true,
    })).toThrow(/unknown field/);
  });
});

describe("planShortSubscribeCta", () => {
  it("places the prompt two-thirds through a Short", () => {
    const plan = planShortSubscribeCta({ duration_seconds: 22.5, brand: "cafe" });
    expect(plan.start_seconds).toBe(15);
    expect(plan.end_seconds).toBe(17);
    expect(plan.copy).toBe("Subscribe for more gaming");
    expect(plan.style.icon).toBe("#FF0000");
    expect(plan.warnings[0]).toMatch(/Watch Club/);
    expect(plan.applied).toBe(false);
  });

  it("starts after a late hook and clamps to the tail", () => {
    const afterHook = planShortSubscribeCta({ duration_seconds: 20, hook_end_seconds: 16 });
    expect(afterHook.start_seconds).toBe(16);
    expect(afterHook.end_seconds).toBe(18);
    const tail = planShortSubscribeCta({ duration_seconds: 10, hold_seconds: 3, at_ratio: 0.9 });
    expect(tail.start_seconds).toBe(7);
    expect(tail.end_seconds).toBe(10);
  });
});

describe("planShortExportFolder", () => {
  const exportRoot = join(tmpdir(), "all-shorts");

  it("nests the file under a series folder and asks to create it", () => {
    const plan = planShortExportFolder({
      export_root: exportRoot,
      series_name: "Dorohedoro",
      title: "Chota Troll",
      brand: "watch_club",
    });
    expect(plan.recommended_directory).toBe(join(exportRoot, "Dorohedoro"));
    expect(plan.recommended_path).toBe(join(exportRoot, "Dorohedoro", "Chota Troll.mp4"));
    expect(plan.create_directory_if_missing).toBe(true);
    expect(plan.brand_isolation).toMatch(/Watch Club/);
    expect(plan.applied).toBe(false);
  });

  it("joins Windows and POSIX export roots on any host", () => {
    const windows = planShortExportFolder({
      export_root: "D:/Exports/ALL Shorts",
      series_name: "Dorohedoro",
      title: "Chota Troll",
      brand: "watch_club",
    });
    expect(windows.recommended_directory).toBe("D:\\Exports\\ALL Shorts\\Dorohedoro");
    expect(windows.recommended_path).toBe("D:\\Exports\\ALL Shorts\\Dorohedoro\\Chota Troll.mp4");

    const posix = planShortExportFolder({
      export_root: "/Volumes/Media/ALL Shorts",
      series_name: "Dorohedoro",
      title: "Chota Troll",
      brand: "watch_club",
    });
    expect(posix.recommended_directory).toBe("/Volumes/Media/ALL Shorts/Dorohedoro");
    expect(posix.recommended_path).toBe("/Volumes/Media/ALL Shorts/Dorohedoro/Chota Troll.mp4");
  });

  it("allows typical series punctuation while rejecting path segments", () => {
    expect(planShortExportFolder({
      export_root: exportRoot,
      series_name: "Re:Zero",
      title: "SPY×FAMILY",
    }).recommended_directory).toBe(join(exportRoot, "Re:Zero"));
    expect(planShortExportFolder({
      export_root: "/Volumes/Media/ALL Shorts",
      series_name: "SPY×FAMILY",
      title: "Re:Zero",
      brand: "watch_club",
    }).recommended_filename).toBe("Re:Zero.mp4");
    expect(() => planShortExportFolder({
      export_root: exportRoot,
      series_name: "Fate/stay night",
      title: "Nope",
    })).toThrow(/single folder/);
  });

  it("rejects path traversal in the series name", () => {
    expect(() => planShortExportFolder({
      export_root: "/Volumes/Media/ALL Shorts",
      series_name: "../escape",
      title: "Nope",
    })).toThrow(/single folder/);
    expect(() => planShortExportFolder({
      export_root: "relative/out",
      series_name: "Kingdom",
      title: "Short 01",
    })).toThrow(/absolute path/);
  });
});
