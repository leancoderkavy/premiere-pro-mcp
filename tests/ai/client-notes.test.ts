import { describe, expect, it } from "vitest";
import {
  MARKER_COLORS,
  MAX_NOTES_BYTES,
  parseTimecodeToken,
  planClientNotesChecklist,
  secondsToTimecode,
} from "../../src/ai/client-notes.js";

const NOTES = `Round 2 notes from the client:
- 0:12 music is way too loud under the VO, must fix before delivery
- 01:05 - 01:12 the logo lower third is cut off on the left
- 1:40 can we try a warmer grade here? the skin tones look green
Sarah: 2:03 typo in the caption, it says "recieve"
- Tighten the intro, it drags
- 3:15 looks great, love this shot
- 00:02:30:12 hold the wide a few frames longer if possible
- 4:55 export a vertical version for reels
- 6:40 legal wants the license plate blurred
`;

describe("parseTimecodeToken", () => {
  it("reads mm:ss, hh:mm:ss, hh:mm:ss:ff, and minute/second words", () => {
    expect(parseTimecodeToken("1:23", 30, "auto")).toBe(83);
    expect(parseTimecodeToken("01:02:03", 30, "auto")).toBe(3723);
    expect(parseTimecodeToken("00:01:23:15", 30, "auto")).toBeCloseTo(83.5, 6);
    expect(parseTimecodeToken("1m23s", 30, "auto")).toBe(83);
    expect(parseTimecodeToken("83s", 30, "auto")).toBe(83);
    expect(parseTimecodeToken("1:23.5", 30, "auto")).toBeCloseTo(83.5, 6);
  });

  it("switches three-part values to mm:ss:ff only when asked or unambiguous", () => {
    expect(parseTimecodeToken("12:34:10", 30, "auto")).toBeCloseTo(12 * 60 + 34 + 10 / 30, 6);
    expect(parseTimecodeToken("01:02:03", 30, "frames")).toBeCloseTo(62 + 3 / 30, 6);
    expect(parseTimecodeToken("12:34:10", 30, "clock")).toBe(12 * 3600 + 34 * 60 + 10);
    expect(parseTimecodeToken("01:02:45", 30, "frames")).toBeNull();
  });

  it("rejects impossible fields", () => {
    expect(parseTimecodeToken("1:75", 30, "auto")).toBeNull();
    expect(parseTimecodeToken("00:00:10:30", 30, "auto")).toBeNull();
  });
});

describe("secondsToTimecode", () => {
  it("formats hh:mm:ss:ff", () => {
    expect(secondsToTimecode(83.5, 30)).toBe("00:01:23:15");
    expect(secondsToTimecode(3723, 25)).toBe("01:02:03:00");
  });
});

describe("planClientNotesChecklist", () => {
  it("rejects empty or oversized notes and bad options", () => {
    expect(() => planClientNotesChecklist({ notes: "   " })).toThrow(/non-empty/);
    expect(() => planClientNotesChecklist({ notes: "x".repeat(MAX_NOTES_BYTES + 1) })).toThrow(/at most/);
    expect(() => planClientNotesChecklist({ notes: "1:00 fix it", frame_rate: 0 })).toThrow(/frame_rate/);
    expect(() => planClientNotesChecklist({ notes: "1:00 fix it", timecode_style: "weird" })).toThrow(/timecode_style/);
    expect(() => planClientNotesChecklist({ notes: "1:00 fix it", marker_color_mode: "rainbow" })).toThrow(/marker_color_mode/);
    expect(() => planClientNotesChecklist({ notes: "1:00\n2:00" })).toThrow(/actionable/);
    expect(() => planClientNotesChecklist({ notes: "Round 1 notes:" })).toThrow(/actionable/);
  });

  it("builds a classified, prioritized checklist with marker payloads", () => {
    const plan = planClientNotesChecklist({ notes: NOTES, frame_rate: 25, sequence_duration_seconds: 300 });
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.counts.items).toBe(9);
    expect(plan.counts.lines).toBe(10);

    const byText = new Map(plan.items.map((item) => [item.text, item]));
    const music = plan.items.find((item) => item.text.startsWith("music is way too loud"))!;
    expect(music.category).toBe("audio");
    expect(music.priority).toBe("must");
    expect(music.time_seconds).toBe(12);
    expect(music.marker?.color).toBe(MARKER_COLORS.red);
    expect(music.marker?.name).toMatch(/^\[audio!\]/);

    const logo = plan.items.find((item) => item.text.includes("logo lower third"))!;
    expect(logo.category).toBe("graphics");
    expect(logo.time_seconds).toBe(65);
    expect(logo.end_seconds).toBe(72);
    expect(logo.duration_seconds).toBe(7);
    expect(logo.marker?.duration_seconds).toBe(7);

    const grade = plan.items.find((item) => item.text.includes("warmer grade"))!;
    expect(grade.category).toBe("color");
    expect(grade.kind).toBe("change");

    const typo = plan.items.find((item) => item.text.includes("typo in the caption"))!;
    expect(typo.category).toBe("text");
    expect(typo.reviewer).toBe("Sarah");
    expect(typo.time_seconds).toBe(123);

    const intro = plan.items.find((item) => item.text.startsWith("Tighten the intro"))!;
    expect(intro.category).toBe("timing");
    expect(intro.time_seconds).toBeNull();
    expect(intro.marker).toBeNull();

    const approval = plan.items.find((item) => item.text.includes("looks great"))!;
    expect(approval.kind).toBe("approval");
    expect(approval.marker).toBeNull();

    const hold = plan.items.find((item) => item.text.startsWith("hold the wide"))!;
    expect(hold.time_seconds).toBeCloseTo(150 + 12 / 25, 3);
    expect(hold.priority).toBe("nice");
    expect(hold.category).toBe("timing");

    const legal = plan.items.find((item) => item.text.includes("license plate"))!;
    expect(legal.category).toBe("legal");
    expect(legal.priority).toBe("must");
    expect(legal.out_of_range).toBe(true);
    expect(legal.marker).toBeNull();

    expect(plan.items.find((item) => item.text.includes("vertical version"))!.category).toBe("delivery");
    expect(byText.size).toBe(plan.items.length);

    expect(plan.markers.map((marker) => marker.time_seconds)).toEqual([...plan.markers.map((marker) => marker.time_seconds)].sort((a, b) => a - b));
    expect(plan.markers).toHaveLength(6);
    expect(plan.counts.markers).toBe(6);
    expect(plan.counts.by_priority.must).toBe(2);
    expect(plan.counts.out_of_range).toBe(1);
    expect(plan.checklist_markdown).toContain("- [x] ");
    expect(plan.checklist_markdown).toContain("(audio, must)");
    expect(plan.checklist_markdown.split("\n")[1]).toContain("must");
    expect(plan.routes).toContain("add_markers_batch");
    expect(plan.warnings.some((warning) => warning.includes("beyond sequence_duration_seconds"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("no timecode"))).toBe(true);
  });

  it("supports category and fixed marker colors, prefixes, and approval markers", () => {
    const plan = planClientNotesChecklist({
      notes: "0:10 sound is muddy\n0:20 approved",
      marker_color_mode: "category",
      marker_name_prefix: "R2",
      include_approvals_as_markers: true,
    });
    expect(plan.markers).toHaveLength(2);
    expect(plan.markers[0].color).toBe(MARKER_COLORS.blue);
    expect(plan.markers[0].name.startsWith("R2 [audio]")).toBe(true);
    const fixed = planClientNotesChecklist({ notes: "0:10 sound is muddy", marker_color_mode: "fixed", fixed_marker_color: 7 });
    expect(fixed.markers[0].color).toBe(7);
  });

  it("separates real questions from requests phrased as questions", () => {
    const plan = planClientNotesChecklist({ notes: "0:10 Is this the approved logo version?\n0:20 Can you push the title 10 frames later?" });
    expect(plan.items[0].kind).toBe("question");
    expect(plan.items[1].kind).toBe("change");
    expect(plan.items[1].category).toBe("timing");
    expect(plan.checklist_markdown).toContain(", question)");
  });

  it("does not treat section labels as reviewers and carries a reviewer across lines", () => {
    const plan = planClientNotesChecklist({ notes: "Audio: 0:10 too loud\nMarcus:\n- 0:20 lose the dissolve\n- 0:30 swap the b-roll" });
    expect(plan.items[0].reviewer).toBeNull();
    expect(plan.items[0].category).toBe("audio");
    expect(plan.items[1].reviewer).toBe("Marcus");
    expect(plan.items[2].reviewer).toBe("Marcus");
    expect(plan.items[1].category).toBe("cut");
  });

  it("caps items and reports the truncation", () => {
    const notes = Array.from({ length: 12 }, (_, index) => `0:${String(index + 10).padStart(2, "0")} fix cut ${index}`).join("\n");
    const plan = planClientNotesChecklist({ notes, max_items: 5 });
    expect(plan.counts.items).toBe(5);
    expect(plan.warnings.some((warning) => warning.includes("beyond max_items=5"))).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const first = planClientNotesChecklist({ notes: NOTES });
    const second = planClientNotesChecklist({ notes: NOTES });
    expect(second).toEqual(first);
  });
});
