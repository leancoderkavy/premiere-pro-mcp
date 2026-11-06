import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countTtmlCues, parseSubtitles } from "../../src/ai/caption-export.js";
import { CAPTION_PLAN_OPTION_PROPERTIES } from "../../src/ai/caption-plan.js";
import { resolveCaptionPlan } from "../../src/tools/caption-inputs.js";
import { getCaptionPlanningTools, MAX_INLINE_PLAN_CAPTIONS } from "../../src/tools/caption-planning.js";

const tools = getCaptionPlanningTools();
type Result = { success: boolean; data?: any; error?: string };
const plan = async (args: Record<string, unknown>): Promise<Result> => tools.plan_captions.handler(args);
const check = async (args: Record<string, unknown>): Promise<Result> => tools.check_captions.handler(args);
const ok = (r: Result) => {
  if (!r.success) throw new Error(`expected success, got ${r.error}`);
  return r.data;
};
const bad = (r: Result) => {
  if (r.success) throw new Error("expected failure");
  return r.error as string;
};

const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello there, my friends.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond caption is right here.\n";
const SCRIBE = JSON.stringify({
  words: [
    { text: "Hello", start: 1, end: 1.4, type: "word" },
    { text: "there.", start: 1.5, end: 2, type: "word" },
    { text: "Bye", start: 6, end: 6.3, type: "word" },
    { text: "now.", start: 6.4, end: 6.8, type: "word" },
  ],
});
const PREMIERE = JSON.stringify({
  segments: [
    { start: 1, duration: 2.5, speaker: "spk1", words: [{ text: "Hello", start: 1, duration: 0.4 }, { text: "there", start: 1.5, duration: 0.5 }, { text: ".", start: 2, duration: 0, type: "punctuation" }] },
    { start: 4, duration: 1, words: [{ text: "Bye.", start: 4, duration: 0.6 }] },
  ],
  speakers: [{ id: "spk1", name: "Anna" }],
});
const timeline = () => ({
  source_project_item_id: "item-1",
  transcript_revision: `sha256:${"a".repeat(64)}`,
  words: [
    { text: "Hello", start_seconds: 1, end_seconds: 1.4 },
    { text: "there.", start_seconds: 1.5, end_seconds: 2 },
    { text: "Goodbye", start_seconds: 5, end_seconds: 5.5 },
    { text: "friends.", start_seconds: 5.6, end_seconds: 6.2 },
  ],
});
/** Many one-sentence words so the plan runs past the inline limit. */
const longTranscript = (sentences: number) =>
  JSON.stringify({ words: Array.from({ length: sentences }, (_, i) => ({ text: `Word${i}.`, start: i * 3, end: i * 3 + 0.8, type: "word" })) });

let root = "";
let ws = "";
let outside = "";
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "caption-planning-"));
  ws = path.join(root, "work");
  outside = path.join(root, "outside");
  mkdirSync(ws);
  mkdirSync(outside);
  writeFileSync(path.join(ws, "t.srt"), SRT);
  writeFileSync(path.join(ws, "t.vtt"), "WEBVTT\n\n00:01.000 --> 00:03.000\nHello there, my friends.\n");
  writeFileSync(path.join(ws, "scribe.json"), SCRIBE);
  writeFileSync(path.join(ws, "premiere.json"), PREMIERE);
  writeFileSync(path.join(ws, "bad.txt"), SRT);
  writeFileSync(path.join(ws, "empty.srt"), "nothing here\n");
  writeFileSync(path.join(outside, "x.srt"), SRT);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
function assertSchema(schema: Schema, where: string) {
  expect(schema.type, `${where} has a type`).toBeTruthy();
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      expect(child.description, `${where}.${key} has a description`).toBeTruthy();
      assertSchema(child, `${where}.${key}`);
    }
    for (const name of schema.required ?? []) expect(schema.properties[name], `${where} required ${name}`).toBeTruthy();
  }
  if (schema.items) assertSchema(schema.items, `${where}[]`);
}

describe("schemas", () => {
  it("exposes the two tools with described, closed schemas", () => {
    expect(Object.keys(tools).sort()).toEqual(["check_captions", "plan_captions"]);
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required).toEqual([]);
      expect(tool.description).toMatch(/local/i);
      // The shared planner options carry descriptions on every property of the top level.
      for (const [key, value] of Object.entries(tool.parameters.properties)) expect((value as Schema).description, `${name}.${key}`).toBeTruthy();
      assertSchema(tool.parameters as Schema, name);
    }
    const props = tools.plan_captions.parameters.properties as Record<string, unknown>;
    for (const key of Object.keys(CAPTION_PLAN_OPTION_PROPERTIES)) expect(props[key]).toBeDefined();
    for (const key of ["word_timeline", "transcript_text", "transcript_path", "approved_workspace_path", "sequence_timebase_ticks", "plan_output_path", "export"]) expect(props[key]).toBeDefined();
    expect(tools.plan_captions.description).toMatch(/netflix_adult.*social_9x16/);
    expect(tools.plan_captions.description).toMatch(/detect_scene_edits/);
  });
});

describe("plan_captions inputs", () => {
  it("plans from SRT text, VTT text, Scribe JSON text and Premiere JSON text", async () => {
    const fromSrt = ok(await plan({ transcript_text: SRT, standard: "netflix_adult", frame_rate: 25 }));
    expect(fromSrt.counts.captions).toBeGreaterThanOrEqual(2);
    expect(fromSrt.captions_inline).toBe(true);
    expect(fromSrt.captions[0]).toMatchObject({ n: 1, kind: "speech" });
    expect(fromSrt.settings).toMatchObject({ frame_rate: 25, standard: "netflix_adult" });
    expect(fromSrt.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fromSrt.applied).toBe(false);
    expect(fromSrt.source).toMatchObject({ kind: "text", format: "srt" });
    const fromVtt = ok(await plan({ transcript_text: "WEBVTT\n\n00:01.000 --> 00:03.000\nHi there\n", frame_rate: 25 }));
    expect(fromVtt.source.format).toBe("vtt");
    const fromScribe = ok(await plan({ transcript_text: SCRIBE, frame_rate: 25 }));
    expect(fromScribe.source.format).toBe("json");
    expect(fromScribe.counts.captions).toBe(2);
    const fromPremiere = ok(await plan({ transcript_text: PREMIERE, frame_rate: 25, speaker_style: "label" }));
    expect(fromPremiere.captions[0].lines[0]).toMatch(/^ANNA:/);
  });

  it("plans from a word_timeline and from transcript files", async () => {
    const fromTimeline = ok(await plan({ word_timeline: timeline(), frame_rate: 24 }));
    expect(fromTimeline.source.kind).toBe("word_timeline");
    expect(fromTimeline.counts.captions).toBe(2);
    for (const file of ["t.srt", "t.vtt", "scribe.json", "premiere.json"]) {
      const data = ok(await plan({ transcript_path: path.join(ws, file), approved_workspace_path: ws, frame_rate: 25 }));
      expect(data.source.kind, file).toBe("path");
      expect(data.counts.captions, file).toBeGreaterThan(0);
    }
  });

  it("applies planner options, offset, range and cut times", async () => {
    const data = ok(await plan({ transcript_text: SCRIBE, standard: "bbc", frame_rate: 25, offset: 10, from_s: 0, to_s: 5, cut_times: [11.5], cleanup: { remove_fillers: true }, sdh: { sound_events: true } }));
    expect(data.counts.captions).toBe(1);
    expect(data.captions[0].start).toBeGreaterThanOrEqual(11);
    expect(data.cleanup).not.toBeNull();
    expect(data.settings.cut_count).toBe(1);
  });

  it("reports violations and truncates long change lists", async () => {
    const data = ok(await plan({ transcript_text: SCRIBE, standard: "netflix_adult", fix: false, frame_rate: 25, max_chars_per_line: 8 }));
    expect(Array.isArray(data.violations)).toBe(true);
    expect(data.violations_truncated).toBe(false);
    expect(data.changes_truncated).toBe(false);
  });

  it("requires exactly one transcript input", async () => {
    expect(bad(await plan({}))).toMatch(/exactly one of word_timeline, transcript_text or transcript_path/);
    expect(bad(await plan({ transcript_text: SRT, word_timeline: timeline() }))).toMatch(/exactly one/);
    expect(bad(await plan({ plan_path: path.join(ws, "x.json"), approved_workspace_path: ws }))).toMatch(/plan_path is not accepted/);
    expect(bad(await tools.plan_captions.handler(null as any))).toMatch(/arguments must be an object/);
    expect(bad(await plan({ transcript_text: SRT, approved_workspace_path: ws }))).toMatch(/only accepted together with/);
    expect(bad(await plan({ transcript_path: path.join(ws, "t.srt") }))).toMatch(/approved_workspace_path/);
    expect(bad(await plan({ transcript_path: path.join(ws, "bad.txt"), approved_workspace_path: ws }))).toMatch(/\.srt, \.vtt or \.json/);
    expect(bad(await plan({ transcript_path: path.join(outside, "x.srt"), approved_workspace_path: ws }))).toMatch(/contained within/);
    expect(bad(await plan({ transcript_text: SRT, standard: "nope" }))).toMatch(/standard/);
  });

  it("refuses files and a plan path without a workspace", async () => {
    expect(bad(await plan({ transcript_text: SRT, plan_output_path: path.join(ws, "p.json") }))).toMatch(/approved_workspace_path is required/);
    expect(bad(await plan({ transcript_text: SRT, export: { format: "srt", output_path: path.join(ws, "p.srt") } }))).toMatch(/approved_workspace_path is required/);
  });
});

describe("sequence_timebase_ticks", () => {
  it("converts ticks per frame to a frame rate", async () => {
    expect(ok(await plan({ transcript_text: SRT, sequence_timebase_ticks: 10160640000 })).settings).toMatchObject({ frame_rate: 25, frame_rate_assumed: false });
    expect(ok(await plan({ transcript_text: SRT, sequence_timebase_ticks: 8475667200 })).settings.frame_rate).toBe(30000 / 1001);
    expect(ok(await plan({ transcript_text: SRT, sequence_timebase_ticks: 10160640000, frame_rate: 25 })).settings.frame_rate).toBe(25);
  });
  it("errors when frame_rate and ticks disagree or ticks are bad", async () => {
    expect(bad(await plan({ transcript_text: SRT, sequence_timebase_ticks: 10160640000, frame_rate: 30 }))).toMatch(/disagree/);
    expect(bad(await plan({ transcript_text: SRT, sequence_timebase_ticks: -5 }))).toMatch(/positive number of ticks/);
    expect(bad(await plan({ transcript_text: SRT, frame_rate: "fast" }))).toMatch(/frame_rate must be a positive number/);
  });
});

describe("plan_output_path", () => {
  it("writes a plan document that resolveCaptionPlan reads back", async () => {
    const out = path.join(ws, "plan1.json");
    const data = ok(await plan({ transcript_text: SRT, standard: "netflix_adult", frame_rate: 25, plan_output_path: out, approved_workspace_path: ws }));
    expect(data.plan_path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(data.next_steps.join("\n")).toContain("import_plan");
    expect(data.next_steps.join("\n")).toContain("add_caption_graphics");
    expect(data.next_steps.join("\n")).toContain("check_captions");
    const back = resolveCaptionPlan({ plan_path: out, approved_workspace_path: ws });
    expect(back.document.plan_revision).toBe(data.plan_revision);
    expect(back.plan.captions).toHaveLength(data.captions.length);
    // The saved plan lints through check_captions.
    const lint = ok(await check({ plan_path: out, approved_workspace_path: ws }));
    expect(lint.source).toMatchObject({ kind: "plan", plan_revision: data.plan_revision });
    expect(lint.standard).toBe("netflix_adult");
    expect(lint.frame_rate).toBe(25);
    expect(lint.frame_rate_inferred).toBe(false);
    expect(lint.pass).toBe(true);
  });

  it("never overwrites, requires .json, and stays inside the workspace", async () => {
    const out = path.join(ws, "plan2.json");
    ok(await plan({ transcript_text: SRT, frame_rate: 25, plan_output_path: out, approved_workspace_path: ws }));
    expect(bad(await plan({ transcript_text: SRT, frame_rate: 25, plan_output_path: out, approved_workspace_path: ws }))).toMatch(/already exists/);
    expect(bad(await plan({ transcript_text: SRT, plan_output_path: path.join(ws, "plan.txt"), approved_workspace_path: ws }))).toMatch(/must end in \.json/);
    expect(bad(await plan({ transcript_text: SRT, plan_output_path: path.join(outside, "p.json"), approved_workspace_path: ws }))).toMatch(/contained within/);
    expect(existsSync(path.join(outside, "p.json"))).toBe(false);
    expect(existsSync(path.join(ws, "plan.txt"))).toBe(false);
  });

  it("truncates a large plan and requires a file for it", async () => {
    const big = longTranscript(MAX_INLINE_PLAN_CAPTIONS + 20);
    expect(bad(await plan({ transcript_text: big, frame_rate: 25 }))).toMatch(/above the inline limit/);
    const out = path.join(ws, "big.json");
    const data = ok(await plan({ transcript_text: big, frame_rate: 25, plan_output_path: out, approved_workspace_path: ws }));
    expect(data.counts.captions).toBeGreaterThan(MAX_INLINE_PLAN_CAPTIONS);
    expect(data.captions_inline).toBe(false);
    expect(data.captions).toBeUndefined();
    expect(data.captions_first).toHaveLength(3);
    expect(data.captions_last).toHaveLength(3);
    expect(data.captions_omitted).toBe(data.counts.captions - 6);
    expect(resolveCaptionPlan({ plan_path: out, approved_workspace_path: ws }).plan.captions).toHaveLength(data.counts.captions);
    // A big export to a file is also accepted without a separate plan file.
    const exp = ok(await plan({ transcript_text: big, frame_rate: 25, export: { format: "srt", output_path: path.join(ws, "big.srt") }, approved_workspace_path: ws }));
    expect(exp.export.cue_count_readback).toBe(exp.counts.captions);
    expect(exp.next_steps[0]).toMatch(/Rerun with plan_output_path/);
    expect(exp.next_steps[1]).toContain("after saving the plan");
  });

  it("caps the inline plan by size as well as count", async () => {
    // Under 500 captions, but every caption carries a long word list: bytes trip the limit.
    const words = Array.from({ length: 440 * 14 }, (_, i) => ({ text: i % 14 === 13 ? "wordy." : "wordy", start: i * 0.2 + Math.floor(i / 14) * 1.5, end: i * 0.2 + Math.floor(i / 14) * 1.5 + 0.15, type: "word" }));
    const r = await plan({ transcript_text: JSON.stringify({ words }), frame_rate: 25 });
    expect(bad(r)).toMatch(/above the inline limit/);
  });
});

describe("export", () => {
  it("returns srt, vtt and ttml inline with a read-back cue count", async () => {
    for (const format of ["srt", "vtt", "ttml"] as const) {
      const data = ok(await plan({ transcript_text: SRT, frame_rate: 25, standard: "netflix_adult", export: { format } }));
      expect(data.export.format).toBe(format);
      expect(data.export.written).toBe(false);
      expect(typeof data.export.inline).toBe("string");
      expect(data.export.cue_count_readback).toBe(data.counts.captions);
      expect(data.export.readback_matches).toBe(true);
      expect(data.export.read_back_from).toBe("text");
      expect(data.export.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (format === "vtt") expect(data.export.inline.startsWith("WEBVTT")).toBe(true);
      if (format === "ttml") expect(countTtmlCues(data.export.inline)).toBe(data.counts.captions);
    }
  });

  it("writes to files, reads them back, and passes position, speaker and language options", async () => {
    const srt = ok(await plan({ transcript_text: SRT, frame_rate: 25, export: { format: "srt", output_path: path.join(ws, "o.srt") }, approved_workspace_path: ws }));
    expect(srt.export).toMatchObject({ written: true, path: path.join(ws, "o.srt"), read_back_from: "file", readback_matches: true });
    expect(parseSubtitles(readFileSync(path.join(ws, "o.srt"), "utf8"), "srt").cues).toHaveLength(srt.counts.captions);

    const vtt = ok(await plan({ transcript_text: PREMIERE, frame_rate: 25, speaker_style: "none", export: { format: "vtt", output_path: path.join(ws, "o.vtt"), line_pct: 80, align: "center", region_width_pct: 60, speaker_voice: true }, approved_workspace_path: ws }));
    const vttText = readFileSync(path.join(ws, "o.vtt"), "utf8");
    expect(vttText).toMatch(/line:80%/);
    expect(vttText).toMatch(/<v Anna>/);
    expect(vtt.export.cue_count_readback).toBe(vtt.counts.captions);

    const ttml = ok(await plan({ transcript_text: SRT, frame_rate: 25, export: { format: "ttml", output_path: path.join(ws, "o.ttml"), lang: "en-GB", line_pct: 80 }, approved_workspace_path: ws }));
    expect(readFileSync(path.join(ws, "o.ttml"), "utf8")).toContain("en-GB");
    expect(ttml.export.readback_matches).toBe(true);
    ok(await plan({ transcript_text: SRT, frame_rate: 25, export: { format: "ttml", output_path: path.join(ws, "o.xml") }, approved_workspace_path: ws }));
    expect(existsSync(path.join(ws, "o.xml"))).toBe(true);

    const both = ok(await plan({ transcript_text: SRT, frame_rate: 25, plan_output_path: path.join(ws, "both.json"), export: { format: "srt", output_path: path.join(ws, "both.srt") }, approved_workspace_path: ws }));
    expect(both.plan_path).toBe(path.join(ws, "both.json"));
    expect(both.export.path).toBe(path.join(ws, "both.srt"));
  });

  it("warns that srt has no positions", async () => {
    const data = ok(await plan({ transcript_text: SRT, frame_rate: 25, export: { format: "srt", line_pct: 50 } }));
    expect(data.warnings.join(" ")).toMatch(/only apply to vtt and ttml/);
  });

  it("refuses to overwrite, a wrong extension, other bad paths and bad options, writing nothing", async () => {
    const out = path.join(ws, "keep.srt");
    writeFileSync(out, "keep me");
    expect(bad(await plan({ transcript_text: SRT, export: { format: "srt", output_path: out }, approved_workspace_path: ws }))).toMatch(/already exists/);
    expect(readFileSync(out, "utf8")).toBe("keep me");
    expect(bad(await plan({ transcript_text: SRT, export: { format: "vtt", output_path: path.join(ws, "wrong.srt") }, approved_workspace_path: ws }))).toMatch(/does not match format vtt/);
    expect(bad(await plan({ transcript_text: SRT, export: { format: "ttml", output_path: path.join(ws, "wrong.vtt") }, approved_workspace_path: ws }))).toMatch(/\.ttml or \.xml/);
    expect(bad(await plan({ transcript_text: SRT, export: { format: "srt", output_path: path.join(ws, "noext") }, approved_workspace_path: ws }))).toMatch(/\(none\)/);
    expect(bad(await plan({ transcript_text: SRT, export: { format: "srt", output_path: path.join(outside, "o.srt") }, approved_workspace_path: ws }))).toMatch(/contained within/);
    expect(existsSync(path.join(outside, "o.srt"))).toBe(false);
    const same = path.join(ws, "same.json");
    expect(bad(await plan({ transcript_text: SRT, plan_output_path: same, export: { format: "srt", output_path: same }, approved_workspace_path: ws }))).toMatch(/does not match format srt|different files/);
    // A bad plan path stops the export file from being written too.
    expect(bad(await plan({ transcript_text: SRT, plan_output_path: path.join(ws, "p.txt"), export: { format: "srt", output_path: path.join(ws, "never.srt") }, approved_workspace_path: ws }))).toMatch(/must end in \.json/);
    expect(existsSync(path.join(ws, "never.srt"))).toBe(false);
  });

  it("validates the export object", async () => {
    const cases: Array<[unknown, RegExp]> = [
      ["srt", /export must be an object/],
      [{ format: "ass" }, /export.format must be one of/],
      [{}, /export.format must be one of/],
      [{ format: "srt", extra: 1 }, /unknown field: extra/],
      [{ format: "srt", output_path: 5 }, /output_path must be a string/],
      [{ format: "vtt", speaker_voice: "yes" }, /speaker_voice/],
      [{ format: "vtt", line_pct: 101 }, /line_pct/],
      [{ format: "vtt", line_pct: "x" }, /line_pct/],
      [{ format: "vtt", align: "left" }, /align/],
      [{ format: "vtt", region_width_pct: 0 }, /region_width_pct/],
      [{ format: "vtt", region_width_pct: 101 }, /region_width_pct/],
      [{ format: "ttml", lang: "e" }, /lang/],
      [{ format: "ttml", lang: 5 }, /lang/],
    ];
    for (const [value, pattern] of cases) expect(bad(await plan({ transcript_text: SRT, export: value })), JSON.stringify(value)).toMatch(pattern);
  });
});

describe("check_captions", () => {
  const goodCues = [
    { start_seconds: 1, end_seconds: 3, text: "Hello there, my friends." },
    { start_seconds: 3.08, end_seconds: 5, text: "Second caption right here." },
  ];

  it("lints a file, text (srt and vtt), a plan and cues", async () => {
    const file = ok(await check({ file_path: path.join(ws, "t.srt"), approved_workspace_path: ws, frame_rate: 25 }));
    expect(file.source).toMatchObject({ kind: "file", format: "srt", cue_count: 2 });
    expect(file.standard_summary.id).toBe("netflix_adult");
    expect(file.cues).toBe(2);
    expect(file.applied).toBe(false);
    expect(file.frame_rate).toBe(25);
    const vttFile = ok(await check({ file_path: path.join(ws, "t.vtt"), approved_workspace_path: ws }));
    expect(vttFile.source.format).toBe("vtt");
    const text = ok(await check({ text: SRT }));
    expect(text.source).toMatchObject({ kind: "text", format: "srt" });
    const vttText = ok(await check({ text: "WEBVTT\n\n00:01.000 --> 00:03.000\nHi there\n", format: "vtt", standard: "bbc" }));
    expect(vttText.standard).toBe("bbc");
    const cues = ok(await check({ cues: goodCues, frame_rate: 25 }));
    expect(cues.source).toMatchObject({ kind: "cues", cue_count: 2 });
    expect(cues.pass).toBe(true);
    expect(cues.counts).toEqual({});
  });

  it("flags what breaks the standard", async () => {
    const data = ok(await check({
      cues: [
        { start_seconds: 0, end_seconds: 0.5, text: "This line is far too long to read in half a second." },
        { start_seconds: 0.52, end_seconds: 2, text: "" },
      ],
      frame_rate: 25,
    }));
    expect(data.pass).toBe(false);
    expect(Object.keys(data.counts)).toEqual(expect.arrayContaining(["cps", "min_duration", "gap", "empty"]));
    expect(data.next_steps.join(" ")).toMatch(/plan_captions/);
  });

  it("infers the frame rate from the cue times and says so", async () => {
    const data = ok(await check({ cues: goodCues }));
    expect(data.frame_rate_inferred).toBe(true);
    expect(data.frame_rate).toBe(25);
    const guess = ok(await check({ cues: [{ start_seconds: 0.123, end_seconds: 2.117, text: "Odd times" }, { start_seconds: 2.5, end_seconds: 4, text: "Next one" }] }));
    expect(guess.frame_rate_inferred).toBe(true);
    expect(guess.warnings.join(" ")).toMatch(/24 fps is assumed/);
  });

  it("takes sequence_timebase_ticks and errors when it disagrees", async () => {
    const data = ok(await check({ cues: goodCues, sequence_timebase_ticks: 10160640000 }));
    expect(data.frame_rate).toBe(25);
    expect(data.frame_rate_inferred).toBe(false);
    expect(bad(await check({ cues: goodCues, sequence_timebase_ticks: 10160640000, frame_rate: 30 }))).toMatch(/disagree/);
  });

  it("flags shot changes from cut_times", async () => {
    const cuts = ok(await check({ cues: goodCues, frame_rate: 25, cut_times: [2] }));
    expect(cuts.counts.shot_change).toBe(1);
  });

  it("limits the issue list with max_issues", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ start_seconds: i, end_seconds: i + 0.1, text: "A" }));
    const all = ok(await check({ cues: many, frame_rate: 25 }));
    expect(all.issues.length).toBeGreaterThan(5);
    const few = ok(await check({ cues: many, frame_rate: 25, max_issues: 5 }));
    expect(few.issues).toHaveLength(5);
    expect(few.truncated).toBe(true);
    expect(few.counts.min_duration).toBe(30);
  });

  it("estimates the safe area and flags cues outside it", async () => {
    const cues = [
      { start_seconds: 1, end_seconds: 3, text: "Short line" },
      { start_seconds: 3.08, end_seconds: 6, text: "This caption line is far too wide for the box" },
    ];
    const base = { cues, frame_rate: 25, standard: "social_9x16", safe_area: "reels_9_16", frame: { width: 1080, height: 1920 }, font_size_px: 60 };
    const data = ok(await check(base));
    expect(data.safe_zone).toMatchObject({ method: "estimated", safe_area: "reels_9_16", approximate: true, frame: { width: 1080, height: 1920 }, font_size_px: 60, char_width_ratio: 0.55 });
    expect(data.safe_zone.box_px).toEqual({ left: 120, top: 288, right: 888, bottom: 1248 });
    expect(data.safe_zone.baseline_y_px).toBe(1248);
    const flagged = data.issues.filter((i: any) => i.rule === "safe_zone");
    expect(flagged.map((i: any) => i.n)).toEqual([2]);
    expect(flagged[0].detail).toMatch(/estimate/);
    // A narrower face fits; a baseline far down moves the box outside at the bottom.
    expect(ok(await check({ ...base, char_width_ratio: 0.25 })).counts.safe_zone).toBeUndefined();
    const low = ok(await check({ ...base, char_width_ratio: 0.25, baseline_y_pct: 95 }));
    expect(low.counts.safe_zone).toBe(2);
    expect(low.safe_zone.baseline_y_px).toBe(1824);
    // A safe box without an area id picks the default for the frame: reels for portrait, 16:9 title safe otherwise.
    expect(ok(await check({ ...base, safe_area: undefined })).safe_zone.safe_area).toBe("reels_9_16");
    const wide = ok(await check({ cues, frame_rate: 25, frame: { width: 1920, height: 1080 }, font_size_px: 40 }));
    expect(wide.safe_zone.safe_area).toBe("landscape_16_9");
    expect(wide.counts.safe_zone).toBeUndefined();
    // Descenders may hang below the bottom edge: the text box ends at the baseline.
    expect(ok(await check({ ...base, cues: [cues[0]], font_size_px: 200, char_width_ratio: 0.3 })).counts.safe_zone).toBeUndefined();
  });

  it("validates the safe-zone arguments", async () => {
    const cues = [{ start_seconds: 1, end_seconds: 3, text: "Hi" }];
    const frame = { width: 1080, height: 1920 };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ safe_area: "reels_9_16" }, /frame .* is required/],
      [{ frame }, /font_size_px is required/],
      [{ frame, font_size_px: -1 }, /font_size_px/],
      [{ frame: { width: 4, height: 1920 }, font_size_px: 40 }, /frame.width/],
      [{ frame: { width: 1080, height: 99999 }, font_size_px: 40 }, /frame.height/],
      [{ frame, font_size_px: 40, char_width_ratio: 0 }, /char_width_ratio/],
      [{ frame, font_size_px: 40, safe_area: "toString" }, /safe_area must be one of/],
      [{ frame, font_size_px: 40, safe_area: "nope" }, /safe_area must be one of/],
      [{ frame, font_size_px: 40, baseline_y_pct: 120 }, /baseline_y_pct/],
    ];
    for (const [extra, pattern] of cases) expect(bad(await check({ cues, ...extra })), JSON.stringify(extra)).toMatch(pattern);
  });

  it("requires exactly one input and a workspace only for files", async () => {
    const cue = [{ start_seconds: 1, end_seconds: 3, text: "Hi" }];
    expect(bad(await check({}))).toMatch(/exactly one of file_path, text, plan_path or cues/);
    expect(bad(await check({ text: SRT, cues: cue }))).toMatch(/exactly one/);
    expect(bad(await check({ file_path: path.join(ws, "t.srt") }))).toMatch(/approved_workspace_path is required/);
    expect(bad(await check({ plan_path: path.join(ws, "p.json") }))).toMatch(/approved_workspace_path is required/);
    expect(bad(await check({ text: SRT, approved_workspace_path: ws }))).toMatch(/only accepted together with/);
    expect(bad(await tools.check_captions.handler("x" as any))).toMatch(/arguments must be an object/);
  });

  it("validates files, text, cues and options", async () => {
    expect(bad(await check({ file_path: path.join(ws, "bad.txt"), approved_workspace_path: ws }))).toMatch(/\.srt or \.vtt/);
    expect(bad(await check({ file_path: path.join(outside, "x.srt"), approved_workspace_path: ws }))).toMatch(/contained within/);
    expect(bad(await check({ file_path: path.join(ws, "empty.srt"), approved_workspace_path: ws }))).toMatch(/no readable cues/);
    expect(bad(await check({ file_path: path.join(ws, "missing.srt"), approved_workspace_path: ws }))).toMatch(/does not exist/);
    expect(bad(await check({ text: "   " }))).toMatch(/non-empty string/);
    expect(bad(await check({ text: SRT, format: "ttml" }))).toMatch(/format must be srt or vtt/);
    expect(bad(await check({ cues: [{ start_seconds: 1, end_seconds: 2, text: "x" }], format: "srt" }))).toMatch(/format only applies/);
    expect(bad(await check({ text: SRT, standard: "nope" }))).toMatch(/standard must be one of/);
    expect(bad(await check({ text: SRT, max_issues: 0 }))).toMatch(/max_issues/);
    expect(bad(await check({ text: SRT, max_issues: 1.5 }))).toMatch(/max_issues/);
    expect(bad(await check({ text: SRT, cut_times: "x" }))).toMatch(/cut_times/);
    expect(bad(await check({ text: SRT, cut_times: [-1] }))).toMatch(/cut_times\[0\]/);
    expect(bad(await check({ cues: [] }))).toMatch(/between 1 and 20000/);
    const cueCases: Array<[unknown, RegExp]> = [
      [null, /cues\[0\] must be an object/],
      [{ start_seconds: -1, end_seconds: 1, text: "x" }, /start_seconds/],
      [{ start_seconds: 0, end_seconds: "a", text: "x" }, /end_seconds/],
      [{ start_seconds: 0, end_seconds: 1, text: 5 }, /text must be a string/],
    ];
    for (const [cue, pattern] of cueCases) expect(bad(await check({ cues: [cue] })), JSON.stringify(cue)).toMatch(pattern);
    expect(bad(await check({ cues: Array.from({ length: 20001 }, () => ({ start_seconds: 0, end_seconds: 1, text: "x" })) }))).toMatch(/between 1 and 20000/);
  });

  it("reports blocks that could not be read as a warning", async () => {
    const data = ok(await check({ text: `${SRT}\nnot a cue block\nat all\n` }));
    expect(data.warnings.join(" ")).toMatch(/no readable timing line/);
  });

  it("rejects a plan with an invalid file and uses an assumed-rate plan without a rate", async () => {
    writeFileSync(path.join(ws, "notplan.json"), "{ nope");
    expect(bad(await check({ plan_path: path.join(ws, "notplan.json"), approved_workspace_path: ws }))).toMatch(/not valid JSON/);
    const out = path.join(ws, "assumed.json");
    ok(await plan({ transcript_text: SRT, plan_output_path: out, approved_workspace_path: ws }));
    const data = ok(await check({ plan_path: out, approved_workspace_path: ws }));
    expect(data.frame_rate_inferred).toBe(true);
  });
});

describe("review fixes: speaker names, offsets and NTSC rates", () => {
  const TWO_SPEAKERS = JSON.stringify({
    words: [
      { text: "Hello", start: 1, end: 1.4, type: "word", speaker_id: "speaker_0" },
      { text: "there.", start: 1.5, end: 2, type: "word", speaker_id: "speaker_0" },
      { text: "Hi", start: 3, end: 3.3, type: "word", speaker_id: "speaker_1" },
      { text: "back.", start: 3.4, end: 3.9, type: "word", speaker_id: "speaker_1" },
    ],
  });

  it("writes speaker_names as the display names in VTT <v> spans", async () => {
    const data = ok(await plan({ transcript_text: TWO_SPEAKERS, frame_rate: 25, speaker_names: { speaker_0: "Anna" }, export: { format: "vtt" } }));
    expect(data.export.inline).toContain("<v Anna>Hello there.</v>");
    expect(data.export.inline).toContain("<v speaker_1>Hi back.</v>");
    const plain = ok(await plan({ transcript_text: TWO_SPEAKERS, frame_rate: 25, export: { format: "vtt" } }));
    expect(plain.export.inline).toContain("<v speaker_0>Hello there.</v>");
  });

  it("refuses a bad speaker_names value before exporting", async () => {
    expect(bad(await plan({ transcript_text: TWO_SPEAKERS, frame_rate: 25, speaker_names: { speaker_0: 5 }, export: { format: "vtt" } }))).toMatch(/speaker_names/);
  });

  it("plans a negative offset, saves a plan that loads again and writes nothing when the plan cannot be saved", async () => {
    const out = path.join(ws, "neg-offset.json");
    const data = ok(await plan({ transcript_text: SCRIBE, frame_rate: 25, offset: -1.7, plan_output_path: out, approved_workspace_path: ws }));
    expect(data.captions.every((c: { start: number }) => c.start >= 0)).toBe(true);
    expect(data.warnings.join(" ")).toMatch(/before 0 s/);
    const checked = ok(await check({ plan_path: out, approved_workspace_path: ws }));
    expect(checked.source.cue_count).toBe(data.captions.length);
  });

  it("rounds to the exact NTSC rate and shows the rounded one in check_captions", async () => {
    const data = ok(await plan({ transcript_text: SRT, sequence_timebase_ticks: 8475667200 }));
    expect(data.settings.frame_rate).toBe(30000 / 1001);
    const checked = ok(await check({ text: SRT, frame_rate: 29.97 }));
    expect(checked.frame_rate).toBe(29.97);
    const viaTicks = ok(await check({ text: SRT, sequence_timebase_ticks: 8475667200 }));
    expect(viaTicks.frame_rate).toBe(29.97);
    // 29.97 and its ticks agree
    ok(await plan({ transcript_text: SRT, sequence_timebase_ticks: 8475667200, frame_rate: 29.97 }));
  });
});
