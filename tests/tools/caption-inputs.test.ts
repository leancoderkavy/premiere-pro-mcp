import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCaptionPlan, captionPlanDocument } from "../../src/ai/caption-plan.js";
import { resolveContainedInputPath } from "../../src/tools/caption-authoring.js";
import { digestWordTimeline } from "../../src/ai/word-timeline.js";
import {
  CAPTION_PLAN_INPUT_PROPERTIES,
  CAPTION_TRANSCRIPT_INPUT_PROPERTIES,
  assertSavablePlanDocument,
  hasTranscriptInput,
  MAX_CAPTION_PLAN_BYTES,
  MAX_CAPTION_TRANSCRIPT_BYTES,
  resolveCaptionPlan,
  resolveCaptionTranscript,
  writeCaptionPlanDocument,
} from "../../src/tools/caption-inputs.js";

let root = "";
let workspace = "";
let outside = "";
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello there, friends.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond caption here.\n";
const JSON_TRANSCRIPT = JSON.stringify({ words: [{ text: "Hello", start: 1, end: 1.4, type: "word" }, { text: "there.", start: 1.5, end: 2, type: "word" }, { text: "Bye.", start: 6, end: 6.5, type: "word" }] });
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const timeline = () => ({
  source_project_item_id: "item-1",
  transcript_revision: `sha256:${"a".repeat(64)}`,
  words: [
    { text: "Hello", start_seconds: 1, end_seconds: 1.4 },
    { text: "there.", start_seconds: 1.5, end_seconds: 2 },
  ],
});

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "caption-inputs-"));
  workspace = path.join(root, "work");
  outside = path.join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  writeFileSync(path.join(workspace, "a.srt"), SRT);
  writeFileSync(path.join(workspace, "b.json"), JSON_TRANSCRIPT);
  writeFileSync(path.join(workspace, "c.vtt"), "WEBVTT\n\n00:01.000 --> 00:02.000\nHi there\n");
  writeFileSync(path.join(workspace, "d.txt"), SRT);
  writeFileSync(path.join(workspace, "bom.srt"), "﻿" + SRT);
  writeFileSync(path.join(outside, "x.srt"), SRT);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("input schemas", () => {
  it("describe every property", () => {
    for (const props of [CAPTION_TRANSCRIPT_INPUT_PROPERTIES, CAPTION_PLAN_INPUT_PROPERTIES]) {
      for (const [k, v] of Object.entries(props)) expect(typeof (v as { description: string }).description, k).toBe("string");
    }
    expect(Object.keys(CAPTION_TRANSCRIPT_INPUT_PROPERTIES).sort()).toEqual(["approved_workspace_path", "transcript_format", "transcript_path", "transcript_text", "word_timeline"]);
    expect(CAPTION_TRANSCRIPT_INPUT_PROPERTIES.transcript_text.maxLength).toBe(MAX_CAPTION_TRANSCRIPT_BYTES);
    expect(MAX_CAPTION_TRANSCRIPT_BYTES).toBe(16 * 1024 * 1024);
    expect(MAX_CAPTION_PLAN_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe("resolveCaptionTranscript", () => {
  it("requires exactly one source", () => {
    expect(() => resolveCaptionTranscript({})).toThrow(/exactly one/);
    expect(() => resolveCaptionTranscript({ transcript_text: SRT, transcript_path: "x" })).toThrow(/exactly one/);
    expect(() => resolveCaptionTranscript({ transcript_text: SRT, word_timeline: timeline() })).toThrow(/exactly one/);
    expect(hasTranscriptInput({})).toBe(false);
    expect(hasTranscriptInput({ transcript_text: null, word_timeline: undefined })).toBe(false);
    expect(hasTranscriptInput({ transcript_text: "x" })).toBe(true);
  });

  it("reads a word_timeline and binds its digest", () => {
    const r = resolveCaptionTranscript({ word_timeline: timeline() });
    expect(r.segments[0].text).toBe("Hello there.");
    expect(r.source).toEqual({ kind: "word_timeline", sha256: expect.stringMatching(/^[a-f0-9]{64}$/), format: "word_timeline" });
    expect(`sha256:${r.source.sha256}`).toBe(digestWordTimeline({ ...timeline(), duration_seconds: 2, speakers: [] }));
    expect(() => resolveCaptionTranscript({ word_timeline: timeline(), transcript_format: "srt" })).toThrow(/does not apply/);
    expect(() => resolveCaptionTranscript({ word_timeline: { words: [] } })).toThrow(/word_timeline/);
  });

  it("reads transcript_text, detecting or taking the format", () => {
    const srt = resolveCaptionTranscript({ transcript_text: SRT });
    expect(srt.source).toEqual({ kind: "text", sha256: sha(SRT), format: "srt" });
    expect(srt.segments).toHaveLength(2);
    expect(resolveCaptionTranscript({ transcript_text: JSON_TRANSCRIPT }).source.format).toBe("json");
    expect(resolveCaptionTranscript({ transcript_text: "WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n" }).source.format).toBe("vtt");
    expect(resolveCaptionTranscript({ transcript_text: SRT, transcript_format: "srt" }).segments).toHaveLength(2);
    expect(resolveCaptionTranscript({ transcript_text: "﻿" + SRT }).segments).toHaveLength(2);
    expect(() => resolveCaptionTranscript({ transcript_text: "  " })).toThrow(/non-empty/);
    expect(() => resolveCaptionTranscript({ transcript_text: 5 })).toThrow(/non-empty/);
    expect(() => resolveCaptionTranscript({ transcript_text: SRT, transcript_format: "xml" })).toThrow(/transcript_format/);
    expect(() => resolveCaptionTranscript({ transcript_text: "garbage" })).toThrow(/No timed lines/);
  });

  it("refuses text above 16 MiB", () => {
    expect(() => resolveCaptionTranscript({ transcript_text: "a".repeat(MAX_CAPTION_TRANSCRIPT_BYTES + 1) })).toThrow(/limit/);
  });

  it("reads files inside the workspace by extension, with a hash of the bytes", () => {
    const srtPath = path.join(workspace, "a.srt");
    const r = resolveCaptionTranscript({ transcript_path: srtPath, approved_workspace_path: workspace });
    expect(r.source).toEqual({ kind: "path", path: realpathSync(srtPath), sha256: sha(readFileSync(srtPath)), format: "srt" });
    expect(resolveCaptionTranscript({ transcript_path: path.join(workspace, "b.json"), approved_workspace_path: workspace }).source.format).toBe("json");
    expect(resolveCaptionTranscript({ transcript_path: path.join(workspace, "c.vtt"), approved_workspace_path: workspace }).source.format).toBe("vtt");
    expect(resolveCaptionTranscript({ transcript_path: path.join(workspace, "bom.srt"), approved_workspace_path: workspace }).segments).toHaveLength(2);
    // an explicit format wins over the extension
    expect(resolveCaptionTranscript({ transcript_path: path.join(workspace, "b.json"), approved_workspace_path: workspace, transcript_format: "json" }).source.format).toBe("json");
  });

  it("refuses paths outside the workspace, wrong extensions, missing files and no workspace", () => {
    expect(() => resolveCaptionTranscript({ transcript_path: path.join(outside, "x.srt"), approved_workspace_path: workspace })).toThrow(/contained within/);
    expect(() => resolveCaptionTranscript({ transcript_path: path.join(workspace, "d.txt"), approved_workspace_path: workspace })).toThrow(/\.srt, \.vtt or \.json/);
    expect(() => resolveCaptionTranscript({ transcript_path: path.join(workspace, "nope.srt"), approved_workspace_path: workspace })).toThrow(/does not exist/);
    expect(() => resolveCaptionTranscript({ transcript_path: path.join(workspace, "a.srt") })).toThrow(/approved_workspace_path/);
    expect(() => resolveCaptionTranscript({ transcript_path: "relative.srt", approved_workspace_path: workspace })).toThrow(/absolute/);
  });
});

describe("resolveCaptionPlan from a transcript", () => {
  it("builds a plan with the planner options in the arguments and a document bound to the source", () => {
    const r = resolveCaptionPlan({ transcript_text: SRT, standard: "netflix_adult", frame_rate: 25 });
    expect(r.plan.captions.length).toBeGreaterThan(0);
    expect(r.plan.settings).toMatchObject({ frame_rate: 25, standard: "netflix_adult" });
    expect(r.document.source).toEqual({ kind: "text", sha256: sha(SRT), format: "srt" });
    expect(r.document.plan_revision).toMatch(/^sha256:/);
    expect(r.warnings).toEqual(r.plan.warnings);
    expect(r.document.captions).toEqual(r.plan.captions);
  });

  it("carries the file path in the source", () => {
    const r = resolveCaptionPlan({ transcript_path: path.join(workspace, "a.srt"), approved_workspace_path: workspace, frame_rate: 25 });
    expect(r.document.source.kind).toBe("path");
    expect(r.document.source.path).toBe(realpathSync(path.join(workspace, "a.srt")));
  });

  it("lets the override frame rate win, and warns only when the argument differs", () => {
    const same = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 25 }, { frame_rate: 25 });
    expect(same.warnings.join(" ")).not.toMatch(/differs/);
    const differ = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 30 }, { frame_rate: 25 });
    expect(differ.plan.settings.frame_rate).toBe(25);
    expect(differ.warnings.join(" ")).toMatch(/differs from the sequence/);
    const none = resolveCaptionPlan({ transcript_text: SRT }, { frame_rate: 24 });
    expect(none.plan.settings).toMatchObject({ frame_rate: 24, frame_rate_assumed: false });
    expect(() => resolveCaptionPlan({ transcript_text: SRT }, { frame_rate: 0 })).toThrow(/positive/);
  });

  it("merges override cut_times with the argument's, sorted and deduped", () => {
    const r = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 25, cut_times: [3, 1] }, { cut_times: [2, 3] });
    expect(r.plan.settings.cut_count).toBe(3);
    expect(() => resolveCaptionPlan({ transcript_text: SRT }, { cut_times: [-1] })).toThrow(/cut_times/);
    expect(resolveCaptionPlan({ transcript_text: SRT, frame_rate: 25 }, { cut_times: [] }).plan.settings.cut_count).toBe(0);
  });

  it("refuses both or neither of plan_path and a transcript", () => {
    expect(() => resolveCaptionPlan({})).toThrow(/exactly one of plan_path or a transcript/);
    expect(() => resolveCaptionPlan({ plan_path: "x", transcript_text: SRT })).toThrow(/exactly one of plan_path or a transcript/);
    expect(() => resolveCaptionPlan({ transcript_text: SRT, standard: "bogus" })).toThrow(/standard must be one of/);
  });
});

describe("saved plans", () => {
  const savedPlan = () => {
    const plan = buildCaptionPlan(
      [{ text: "x", start: 1, end: 6, words: [{ text: "Hello", start: 1, end: 1.4 }, { text: "there.", start: 1.5, end: 2 }, { text: "Bye.", start: 6, end: 6.5 }] }],
      { frame_rate: 25, standard: "netflix_adult" }
    );
    return captionPlanDocument(plan, { kind: "text", sha256: "e".repeat(64), format: "json" });
  };

  it("writes a document with wx, refuses to overwrite, and refuses other places and extensions", () => {
    const doc = savedPlan();
    const target = path.join(workspace, "plan1.json");
    const written = writeCaptionPlanDocument(doc, workspace, target);
    expect(written).toBe(path.join(realpathSync(workspace), "plan1.json"));
    expect(JSON.parse(readFileSync(written, "utf8"))).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(() => writeCaptionPlanDocument(doc, workspace, target)).toThrow(/already exists/);
    expect(() => writeCaptionPlanDocument(doc, workspace, path.join(outside, "p.json"))).toThrow(/contained within/);
    expect(() => writeCaptionPlanDocument(doc, workspace, path.join(workspace, "plan.txt"))).toThrow(/\.json/);
    expect(existsSync(path.join(workspace, "plan.txt"))).toBe(false);
  });

  it("round-trips through plan_path with the same revision", () => {
    const doc = savedPlan();
    const file = path.join(workspace, "plan2.json");
    writeCaptionPlanDocument(doc, workspace, file);
    const r = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace });
    expect(r.document.plan_revision).toBe(doc.plan_revision);
    expect(r.plan.captions).toEqual(doc.captions);
    expect(r.document.source).toEqual(doc.source);
    expect(r.warnings).toEqual(doc.warnings);
    // a matching override changes nothing; a cut_times override is ignored with a warning
    const same = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 25.005, cut_times: [] });
    expect(same.document.plan_revision).toBe(doc.plan_revision);
    const ignored = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { cut_times: [2] });
    expect(ignored.warnings.join(" ")).toMatch(/cut_times were ignored/);
  });

  it("re-rounds every time to the override frame rate and warns", () => {
    const doc = savedPlan();
    const file = path.join(workspace, "plan3.json");
    writeCaptionPlanDocument(doc, workspace, file);
    const r = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 24 });
    expect(r.warnings.join(" ")).toMatch(/25 fps.*24 fps/);
    expect(r.plan.settings.frame_rate).toBe(24);
    expect(r.document.settings.frame_rate).toBe(24);
    expect(r.document.plan_revision).not.toBe(doc.plan_revision);
    for (const c of r.plan.captions) {
      expect(Math.abs(c.start * 24 - Math.round(c.start * 24))).toBeLessThan(1e-6);
      expect(Math.abs(c.end * 24 - Math.round(c.end * 24))).toBeLessThan(1e-6);
      expect(c.end).toBeGreaterThan(c.start);
      for (const w of c.words) expect(Math.abs(w.start * 24 - Math.round(w.start * 24))).toBeLessThan(1e-6);
      expect(c.highlight).toHaveLength(c.words.length);
    }
    // the re-rounded document validates again
    const again = path.join(workspace, "plan3b.json");
    writeCaptionPlanDocument(r.document, workspace, again);
    expect(resolveCaptionPlan({ plan_path: again, approved_workspace_path: workspace }).document.plan_revision).toBe(r.document.plan_revision);
    expect(() => resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: -1 })).toThrow(/positive/);
  });

  it("keeps a caption at least one frame long after re-rounding to a coarser rate", () => {
    const plan = buildCaptionPlan([{ text: "x", start: 0, end: 1, words: [{ text: "Hi", start: 0.51, end: 0.52 }] }], { frame_rate: 120, min_duration: 0.1, linger: 0 });
    const doc = captionPlanDocument(plan, { kind: "text", sha256: "f".repeat(64), format: "json" });
    const file = path.join(workspace, "plan4.json");
    writeCaptionPlanDocument(doc, workspace, file);
    const r = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 10 });
    for (const c of r.plan.captions) expect(c.end).toBeGreaterThan(c.start);
  });

  it("refuses an edited plan, bad JSON, a wrong extension and a path outside the workspace", () => {
    const doc = savedPlan();
    const edited = JSON.parse(JSON.stringify(doc));
    edited.captions[0].end += 1;
    writeFileSync(path.join(workspace, "edited.json"), JSON.stringify(edited));
    expect(() => resolveCaptionPlan({ plan_path: path.join(workspace, "edited.json"), approved_workspace_path: workspace })).toThrow(/does not match/);
    writeFileSync(path.join(workspace, "bad.json"), "{nope");
    expect(() => resolveCaptionPlan({ plan_path: path.join(workspace, "bad.json"), approved_workspace_path: workspace })).toThrow(/not valid JSON/);
    expect(() => resolveCaptionPlan({ plan_path: path.join(workspace, "a.srt"), approved_workspace_path: workspace })).toThrow(/must end in \.json/);
    writeFileSync(path.join(outside, "p.json"), JSON.stringify(doc));
    expect(() => resolveCaptionPlan({ plan_path: path.join(outside, "p.json"), approved_workspace_path: workspace })).toThrow(/contained within/);
    expect(() => resolveCaptionPlan({ plan_path: path.join(workspace, "plan2.json") })).toThrow(/approved_workspace_path/);
  });
});

describe("resolveContainedInputPath maxBytes", () => {
  it("keeps the 2 MiB default and takes a larger or smaller limit", () => {
    const big = path.join(workspace, "big.srt");
    writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 32));
    expect(() => resolveContainedInputPath(workspace, big)).toThrow(/above the 2097152-byte/);
    expect(resolveContainedInputPath(workspace, big, MAX_CAPTION_TRANSCRIPT_BYTES)).toBe(realpathSync(big));
    expect(() => resolveCaptionTranscript({ transcript_path: big, approved_workspace_path: workspace })).toThrow(/No timed lines/);
    expect(() => resolveContainedInputPath(workspace, path.join(workspace, "a.srt"), 10)).toThrow(/above the 10-byte/);
  });
});

describe("review fixes: retiming, NTSC override and saving", () => {
  it("restores the minimum gap after re-rounding to another frame rate and warns with the count", () => {
    // At 60 fps the first caption ends at frame 34 and the second starts at frame 35 (a gap of 1 frame); at 24 fps they are
    // frames 13.6 and 14.0, so both round to frame 14 and would touch.
    const words = [
      { text: "One", start: 0.1, end: 0.2 },
      { text: "two", start: 0.2, end: 0.3 },
      { text: "three.", start: 0.3, end: 25 / 60 },
      { text: "Four", start: 35 / 60, end: 0.7 },
      { text: "five.", start: 0.7, end: 0.9 },
    ];
    const plan = buildCaptionPlan([{ text: "x", start: 0, end: 4, words }], { frame_rate: 60, min_gap_frames: 1, linger: 0.15, min_duration: 0.1, pause_break: 0.5 });
    expect(plan.captions.map((c) => [c.start, c.end])).toEqual([[0.1, 34 / 60], [35 / 60, expect.any(Number)]]);
    const doc = captionPlanDocument(plan, { kind: "text", sha256: "e".repeat(64), format: "json" });
    const file = path.join(workspace, "gap60.json");
    writeCaptionPlanDocument(doc, workspace, file);
    const r = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 24 });
    const frame = 1 / 24;
    for (let i = 0; i + 1 < r.plan.captions.length; i++) {
      const c = r.plan.captions[i];
      const next = r.plan.captions[i + 1];
      expect(next.start - c.end, `gap after caption ${i + 1}`).toBeGreaterThanOrEqual(frame - 1e-9);
      expect(c.end - c.start).toBeGreaterThanOrEqual(frame - 1e-9);
    }
    expect(r.warnings.join(" ")).toMatch(/\d+ captions? ended too close to the next after re-rounding/);
    // the re-timed document reads back
    const again = path.join(workspace, "gap24.json");
    writeCaptionPlanDocument(r.document, workspace, again);
    expect(resolveCaptionPlan({ plan_path: again, approved_workspace_path: workspace }).document.plan_revision).toBe(r.document.plan_revision);
  });

  it("uses the plan's own min_gap_frames when it is larger than one frame", () => {
    const plan = buildCaptionPlan([{ text: "x", start: 0, end: 5, words: [{ text: "One.", start: 0.1, end: 0.4 }, { text: "Two.", start: 1.2, end: 1.5 }] }], { frame_rate: 50, min_gap_frames: 4, linger: 0.7, min_duration: 0.2, pause_break: 0.5 });
    const file = path.join(workspace, "gap4.json");
    writeCaptionPlanDocument(captionPlanDocument(plan, { kind: "text", sha256: "d".repeat(64), format: "json" }), workspace, file);
    const r = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 25 });
    const [a, b] = r.plan.captions;
    expect(b.start - a.end).toBeGreaterThanOrEqual(4 / 25 - 1e-9);
  });

  it("converts an NTSC override to the exact rate and does not re-round a plan already made at it", () => {
    const plan = buildCaptionPlan([{ text: "x", start: 0, end: 4, words: [{ text: "Hello", start: 1, end: 1.4 }, { text: "there.", start: 1.5, end: 2 }] }], { frame_rate: 30000 / 1001 });
    const file = path.join(workspace, "ntsc.json");
    writeCaptionPlanDocument(captionPlanDocument(plan, { kind: "text", sha256: "c".repeat(64), format: "json" }), workspace, file);
    const same = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 29.97 });
    expect(same.plan.settings.frame_rate).toBe(30000 / 1001);
    expect(same.warnings).toEqual(plan.warnings);
    const fresh = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 25 }, { frame_rate: 23.976 });
    expect(fresh.plan.settings.frame_rate).toBe(24000 / 1001);
    expect(fresh.warnings.join(" ")).toMatch(/frame_rate 25 differs from the sequence's 23.976/);
    const asked = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 29.97 }, { frame_rate: 30000 / 1001 });
    expect(asked.warnings.join(" ")).not.toMatch(/differs/);
    const retimed = resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }, { frame_rate: 23.976 });
    expect(retimed.warnings.join(" ")).toMatch(/29\.97 fps; every time was re-rounded to 23\.976 fps/);
  });

  it("refuses to write a plan that parseCaptionPlanDocument would reject (negative times)", () => {
    const plan = buildCaptionPlan([{ text: "x", start: 0, end: 4, words: [{ text: "Hello", start: 1, end: 1.4 }] }], { frame_rate: 25 });
    const doc = captionPlanDocument(plan, { kind: "text", sha256: "b".repeat(64), format: "json" });
    const broken = { ...doc, captions: [{ ...doc.captions[0], start: -1 }] };
    const target = path.join(workspace, "negative.json");
    expect(() => writeCaptionPlanDocument(broken, workspace, target)).toThrow(/not valid and was not saved.*start must be 0 or more/);
    expect(existsSync(target)).toBe(false);
    expect(() => assertSavablePlanDocument(doc)).not.toThrow();
  });

  it("plans a negative offset into a plan that saves and loads", () => {
    const r = resolveCaptionPlan({ transcript_text: JSON_TRANSCRIPT, frame_rate: 25, offset: -1.6 });
    expect(r.plan.captions.every((c) => c.start >= 0)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/before 0 s/);
    const file = path.join(workspace, "offset.json");
    writeCaptionPlanDocument(r.document, workspace, file);
    expect(resolveCaptionPlan({ plan_path: file, approved_workspace_path: workspace }).document.plan_revision).toBe(r.document.plan_revision);
  });
});
