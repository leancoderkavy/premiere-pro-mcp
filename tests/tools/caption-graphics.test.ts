import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as acorn from "acorn";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
vi.mock("../../src/tools/mogrt-validation.js", () => ({ validateMogrtArchive: vi.fn(() => null) }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { validateMogrtArchive } from "../../src/tools/mogrt-validation.js";
import {
  alignWordsToTokens,
  buildGraphicsClips,
  buildGraphicsPlaceScript,
  buildGraphicsReadbackScript,
  buildGraphicsRemoveScript,
  buildGraphicsTrackInspectScript,
  evaluateReadback,
  getCaptionGraphicsTools,
  linesUpToToken,
  mapTextToFields,
  parseGraphicsOptions,
  parseHexColor,
  type CaptionGraphicsOptions,
  type ClipSpec,
  type FrameInfo,
} from "../../src/tools/caption-graphics.js";
import { resolveCaptionPlan, writeCaptionPlanDocument } from "../../src/tools/caption-inputs.js";
import { isPremiereAuthored, preflightCaptionTemplate, readMogrtControls } from "../../src/tools/mogrt-controls.js";
import { writeZip } from "../../src/tools/mogrt-bake.js";
import { cleanupTempDirs, makeTempDir } from "../helpers/temp-dir.js";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeFakeCaptionHost, TPS, type FakeHostOptions } from "../helpers/fake-caption-host.js";

const tool = getCaptionGraphicsTools({}).add_caption_graphics;
const mockedSend = vi.mocked(sendCommand);

function stamp(sec: number): string {
  const ms = Math.round(sec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}
function srt(texts: string[], step = 3): string {
  return texts.map((t, i) => `${i + 1}\n${stamp(1 + i * step)} --> ${stamp(3 + i * step)}\n${t}\n`).join("\n");
}
const SPEAKERS = JSON.stringify([
  { text: "Hello there my friend.", start: 1, end: 3, speaker: "A" },
  { text: "I am fine thanks.", start: 4, end: 6, speaker: "B" },
]);
const THREE = srt(["Hello there my friend.", "I am fine thanks.", "See you tomorrow then."]);

type Kind = "read" | "inspect" | "remove" | "place" | "readback" | "other";
function kindOf(script: string): Kind {
  if (script.includes("timebase: timebase")) return "read";
  if (script.includes("staleCount: staleCount")) return "inspect";
  if (script.includes("removeAttempted")) return "remove";
  if (script.includes("importMGT")) return "place";
  if (script.includes("rows: out")) return "readback";
  return "other";
}

function install(options: FakeHostOptions = {}, wrap?: (script: string, kind: Kind) => any | undefined) {
  const host = makeFakeCaptionHost(options);
  const calls: Kind[] = [];
  const scripts: string[] = [];
  mockedSend.mockImplementation(async (script: string) => {
    const kind = kindOf(script);
    calls.push(kind);
    scripts.push(script);
    const forced = wrap?.(script, kind);
    if (forced !== undefined) return forced;
    return host.run(script);
  });
  return { host, calls, scripts };
}

const base = { mogrt_path: "C:/templates/caption.mogrt", track_index: 1, text_fields: { line_fields: ["Line 1", "Line 2"] }, font_size_px: 30 };
const run = (extra: Record<string, unknown>) => tool.handler({ ...base, ...extra }) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateMogrtArchive).mockReturnValue(null);
});

describe("option validation", () => {
  const ok = { mogrt_path: "a.mogrt", track_index: 0, text_fields: { text_field: "Text" } };
  it("accepts the minimal forms and fills defaults", () => {
    expect(parseGraphicsOptions(ok)).toMatchObject({ name_prefix: "Caption", word_mode: "off", placement: "template", fit: "both", replace_existing: true, chunk_size: 25 });
    expect(parseGraphicsOptions({ ...ok, text_fields: { line_fields: ["Line 1"] }, color_field: "Fill", safe_area: "tiktok_9_16", font_size_px: 50, char_width_ratio: 0.5 }))
      .toMatchObject({ color_field: "Fill", safe_area: "tiktok_9_16", font_size_px: 50, char_width_ratio: 0.5 });
  });
  it.each([
    [{ ...ok, mogrt_path: undefined }, "mogrt_path is required"],
    [{ ...ok, mogrt_path: "a.aep" }, "must end in .mogrt"],
    [{ ...ok, track_index: -1 }, "track_index"],
    [{ ...ok, track_index: 1.5 }, "track_index"],
    [{ ...ok, text_fields: undefined }, "text_fields is required"],
    [{ ...ok, text_fields: {} }, "exactly one"],
    [{ ...ok, text_fields: { line_fields: ["a"], text_field: "b" } }, "exactly one"],
    [{ ...ok, text_fields: { text_field: "a", extra: 1 } }, "unknown field"],
    [{ ...ok, text_fields: { line_fields: [] } }, "1 to 6"],
    [{ ...ok, text_fields: { line_fields: ["a", "a"] } }, "unique"],
    [{ ...ok, text_fields: { line_fields: [""] } }, "display name"],
    [{ ...ok, text_fields: { text_field: 7 } }, "display name"],
    [{ ...ok, color_field: "" }, "color_field"],
    [{ ...ok, name_prefix: " x" }, "name_prefix"],
    [{ ...ok, name_prefix: 4 }, "name_prefix"],
    [{ ...ok, word_mode: "words" }, "word_mode"],
    [{ ...ok, placement: "left" }, "placement"],
    [{ ...ok, fit: "squash" }, "fit"],
    [{ ...ok, safe_area: "tv" }, "safe_area"],
    [{ ...ok, font_size_px: 0 }, "font_size_px"],
    [{ ...ok, font_size_px: "big" }, "font_size_px"],
    [{ ...ok, char_width_ratio: 9 }, "char_width_ratio"],
    [{ ...ok, replace_existing: "yes" }, "replace_existing"],
    [{ ...ok, chunk_size: 0 }, "chunk_size"],
    [{ ...ok, chunk_size: 51 }, "chunk_size"],
  ])("rejects %#", (args, message) => {
    expect(() => parseGraphicsOptions(args as Record<string, unknown>)).toThrow(message as string);
  });
  it("describes expected_project_path and the host limits in the tool description", () => {
    expect(tool.description).toContain("expected_project_path");
    expect(tool.description).toContain("committed_unverified");
    expect(tool.parameters.required).toEqual(["mogrt_path", "track_index", "text_fields"]);
    expect(Object.keys(tool.parameters.properties)).toEqual(expect.arrayContaining(["plan_path", "transcript_text", "word_mode", "placement", "fit", "replace_existing", "standard"]));
  });
});

describe("text field mapping", () => {
  it("maps one line per field, joins extras into the last and blanks unused fields", () => {
    const two = { line_fields: ["Line 1", "Line 2"] };
    expect(mapTextToFields(["a"], two)).toEqual([{ name: "Line 1", text: "a" }, { name: "Line 2", text: "" }]);
    expect(mapTextToFields(["a", "b"], two)).toEqual([{ name: "Line 1", text: "a" }, { name: "Line 2", text: "b" }]);
    expect(mapTextToFields(["a", "b", "c"], two)).toEqual([{ name: "Line 1", text: "a" }, { name: "Line 2", text: "b c" }]);
    expect(mapTextToFields(["a", "b"], { line_fields: ["Only"] })).toEqual([{ name: "Only", text: "a b" }]);
  });
  it("joins lines with a carriage return for a single field", () => {
    expect(mapTextToFields(["a", "b"], { text_field: "Text" })).toEqual([{ name: "Text", text: "a\rb" }]);
  });
  it("parses hex colours", () => {
    expect(parseHexColor("#ff8000")).toEqual([255, 128, 0]);
    expect(parseHexColor("orange")).toBeNull();
  });
});

describe("word alignment helpers", () => {
  it("aligns words to tokens, skipping label prefixes and giving trailing tokens to the last word", () => {
    expect(alignWordsToTokens(["Hello", "there"], ["-", "Hello", "there"])).toEqual([1, 2]);
    expect(alignWordsToTokens(["Hello", "there"], ["Hello", "there", "♪"])).toEqual([0, 2]);
    expect(alignWordsToTokens(["Hello", "there"], ["Hello", "world"])).toBeNull();
    expect(alignWordsToTokens(["-", "Hi"], ["-", "Hi"])).toEqual([0, 1]);
    expect(alignWordsToTokens(["don't"], ["don't,"])).toEqual([0]);
  });
  it("keeps the caption's own line breaks when it grows", () => {
    expect(linesUpToToken(["one two", "three four"], 0)).toEqual(["one"]);
    expect(linesUpToToken(["one two", "three four"], 2)).toEqual(["one two", "three"]);
    expect(linesUpToToken(["one two", "", "three"], 3)).toEqual(["one two", "three"]);
  });
});

const frame: FrameInfo = { width: 1080, height: 1920, exact_fps: 25, frame_ticks: TPS / 25 };
const opts = (extra: Partial<CaptionGraphicsOptions> = {}): CaptionGraphicsOptions => ({ ...parseGraphicsOptions(base), ...extra });
const planOf = (text: string, extra: Record<string, unknown> = {}) => resolveCaptionPlan({ transcript_text: text, ...extra }, { frame_rate: 25 }).plan;

describe("clip specs", () => {
  it("makes one named, frame-exact clip per caption", () => {
    const built = buildGraphicsClips(planOf(THREE), frame, opts(), 30);
    expect(built.clips).toHaveLength(3);
    expect(built.clips.map((c) => c.name)).toEqual(["Caption 001", "Caption 002", "Caption 003"]);
    expect(built.clips[0].start).toBe(1);
    expect(built.clips[0].start_ticks).toBe(25 * (TPS / 25));
    expect(built.clips[0].fields.map((f) => f.name)).toEqual(["Line 1", "Line 2"]);
    expect(built.safe_area).toBe("reels_9_16");
    expect(built.clips.every((c) => c.position === null && c.color === null && c.scale === 1)).toBe(true);
  });

  it("uses landscape safe area for a wide frame and honours an explicit one", () => {
    const wide = { ...frame, width: 1920, height: 1080 };
    expect(buildGraphicsClips(planOf(THREE), wide, opts(), 40).safe_area).toBe("landscape_16_9");
    expect(buildGraphicsClips(planOf(THREE), wide, opts({ safe_area: "tiktok_9_16" }), 40).safe_area).toBe("tiktok_9_16");
  });

  it("single mode makes one clip per word from the highlight time to the next word", () => {
    const plan = planOf(THREE);
    const built = buildGraphicsClips(plan, frame, opts({ word_mode: "single" }), 60);
    const words = plan.captions.reduce((n, c) => n + c.words.length, 0);
    expect(built.clips).toHaveLength(words);
    const first = built.clips.filter((c) => c.caption_n === 1);
    expect(first[0].lines).toEqual([plan.captions[0].words[0].text]);
    expect(first[0].start).toBe(plan.captions[0].start);
    expect(first[1].start).toBeCloseTo(plan.captions[0].highlight![1], 6);
    expect(first[0].end).toBe(first[1].start);
    expect(first[first.length - 1].end).toBe(plan.captions[0].end);
    expect(built.clips[0].name).toBe("Caption 001");
  });

  it("accumulate mode grows the text word by word and ends on the full caption", () => {
    const plan = planOf(THREE);
    const built = buildGraphicsClips(plan, frame, opts({ word_mode: "accumulate" }), 30);
    const first = built.clips.filter((c) => c.caption_n === 1);
    expect(first[0].lines.join(" ")).toBe("Hello");
    expect(first[1].lines.join(" ")).toBe("Hello there");
    expect(first[first.length - 1].lines).toEqual(plan.captions[0].lines);
    expect(first[first.length - 1].end).toBe(plan.captions[0].end);
  });

  it("shows a caption whole when its words do not line up with its text", () => {
    const plan = planOf(THREE);
    plan.captions[0] = { ...plan.captions[0], lines: ["Completely different"] };
    const built = buildGraphicsClips(plan, frame, opts({ word_mode: "accumulate" }), 60);
    expect(built.clips.filter((c) => c.caption_n === 1)).toHaveLength(1);
    expect(built.warnings.join(" ")).toContain("did not line up");
  });

  it("counts skipped words in single mode when frames collide", () => {
    const plan = planOf(THREE);
    const c = plan.captions[0];
    // Two words starting on the same frame: the second can hold no frame.
    plan.captions[0] = { ...c, highlight: c.highlight!.map((h, i) => (i === 2 ? c.highlight![1] : h)) };
    const built = buildGraphicsClips(plan, frame, opts({ word_mode: "single" }), 60);
    expect(built.warnings.join(" ")).toContain("too short to hold a frame");
  });

  it("estimates the fit: rebreak narrows a wide caption, shrink scales it, none only reports", () => {
    const long = planOf(srt(["This caption is deliberately long enough to need several lines"]), { max_lines: 3, max_chars_per_line: 80 });
    const rebreak = buildGraphicsClips(long, frame, opts({ fit: "rebreak", text_fields: { line_fields: ["Line 1", "Line 2", "Line 3"] } }), 40);
    expect(rebreak.refits[0]).toMatchObject({ n: 1, method: "estimated", action: "rebreak" });
    expect(rebreak.clips[0].lines.length).toBe(3);
    expect(rebreak.clips[0].scale).toBe(1);
    const mid = planOf(srt(["This caption is a bit too wide to fit"]), { max_chars_per_line: 80 });
    const shrink = buildGraphicsClips(mid, frame, opts({ fit: "shrink" }), 40);
    expect(shrink.clips[0].scale).toBeLessThan(1);
    expect(shrink.clips[0].scale).toBeGreaterThan(0.7);
    expect(shrink.refits[0]).toMatchObject({ action: "shrink", fits: true });
    const floor = buildGraphicsClips(long, frame, opts({ fit: "shrink" }), 40);
    expect(floor.clips[0].scale).toBe(0.7);
    expect(floor.refits[0].fits).toBe(false);
    const none = buildGraphicsClips(long, frame, opts({ fit: "none" }), 40);
    expect(none.refits).toEqual([]);
    expect(none.clips[0].scale).toBe(1);
    expect(none.outside_safe[0]).toMatchObject({ n: 1, reason: "too_wide" });
    const word = buildGraphicsClips(planOf(srt(["Extraordinarily unquestionably"]), { max_chars_per_line: 80 }), frame, opts({ fit: "both", word_mode: "single" }), 90);
    expect(word.refits.some((r) => r.word_index !== undefined && r.action === "shrink")).toBe(true);
  });

  it("uses the caller's character width ratio", () => {
    const plan = planOf(srt(["Eighteen characters"]));
    expect(buildGraphicsClips(plan, frame, opts({ fit: "none" }), 40).outside_safe).toEqual([]);
    expect(buildGraphicsClips(plan, frame, opts({ fit: "none", char_width_ratio: 1.5 }), 40).outside_safe[0].reason).toBe("too_wide");
  });

  it("places the estimated text box against the safe area", () => {
    const plan = planOf(srt(["Hello there"]));
    const bottom = buildGraphicsClips(plan, frame, opts({ placement: "safe_bottom" }), 60);
    const area = bottom.clips[0];
    const height = 60 * 1.2;
    const safeBottom = 1248; // reels_9_16 safe bottom at 1080x1920
    expect(area.position![0]).toBe(0.5);
    expect(area.position![1] * 1920).toBeCloseTo(safeBottom - height / 2, 3);
    const top = buildGraphicsClips(plan, frame, opts({ placement: "safe_top" }), 60).clips[0];
    expect(top.position![1] * 1920).toBeCloseTo(288 + height / 2, 3);
    const middle = buildGraphicsClips(plan, frame, opts({ placement: "safe_middle" }), 60).clips[0];
    expect(middle.position![1] * 1920).toBeCloseTo((288 + 1248) / 2, 3);
  });

  it("flags captions whose estimated box leaves the safe area vertically", () => {
    const plan = planOf(srt(["Hello there"]));
    const tall = buildGraphicsClips(plan, frame, opts({ placement: "safe_bottom", fit: "none" }), 900);
    expect(tall.outside_safe.map((o) => o.reason)).toEqual(["above_safe_area"]);
    const low = buildGraphicsClips(plan, { ...frame, height: 200 }, opts({ placement: "safe_top", fit: "none" }), 900);
    expect(low.outside_safe.map((o) => o.reason)).toContain("below_safe_area");
  });

  it("carries the speaker colour", () => {
    const text = srt(["Hello there."]);
    const plan = planOf(text);
    plan.captions[0] = { ...plan.captions[0], color: "#ff0000" };
    expect(buildGraphicsClips(plan, frame, opts(), 60).clips[0].color).toBe("#ff0000");
  });

  it("pads clip numbers to the clip count", () => {
    const many = srt(Array.from({ length: 1001 }, (_, i) => `Caption number ${i} here.`), 3);
    const plan = planOf(many);
    const built = buildGraphicsClips(plan, frame, opts({ fit: "none" }), 40);
    expect(built.clips[0].name).toBe(`Caption ${"1".padStart(String(built.clips.length).length, "0")}`);
  });

  it("refuses more than 2000 clips, huge start times and collisions", () => {
    const many = srt(Array.from({ length: 2001 }, (_, i) => `Caption number ${i} here.`), 3);
    expect(() => buildGraphicsClips(planOf(many), frame, opts({ fit: "none" }), 40)).toThrow("at most 2000");
    const late = planOf(srt(["Hello there."]));
    late.captions[0] = { ...late.captions[0], start: 40000, end: 40002 };
    expect(() => buildGraphicsClips(late, frame, opts({ fit: "none" }), 40)).toThrow("hours");
    const clash = planOf(THREE);
    clash.captions[1] = { ...clash.captions[1], start: clash.captions[0].start, end: clash.captions[0].start + 0.01 };
    expect(() => buildGraphicsClips(clash, frame, opts({ fit: "none" }), 40)).toThrow("overlap");
  });

  it("trims a clip that runs into the next after rounding", () => {
    const plan = planOf(THREE);
    plan.captions[0] = { ...plan.captions[0], end: plan.captions[1].start + 0.5 };
    const built = buildGraphicsClips(plan, frame, opts({ fit: "none" }), 40);
    expect(built.clips[0].end).toBe(built.clips[1].start);
  });
});

describe("evaluateReadback", () => {
  const spec: ClipSpec = {
    index: 0, caption_n: 1, start: 1, end: 3, start_ticks: TPS, end_ticks: 3 * TPS, name: "Caption 001", lines: ["Hi"],
    fields: [{ name: "Line 1", text: "Hi" }], color: "#102030", scale: 0.8, position: [0.5, 0.4],
  };
  const good = {
    found: true, name: "Caption 001", startTicks: TPS, endTicks: 3 * TPS,
    parameters: [{ displayName: "Line 1", value: JSON.stringify({ textEditValue: "Hi" }) }],
    color: [255, 16, 32, 48], position: [0.5, 0.4], motionScale: 80,
  };
  const ft = TPS / 25;
  it("verifies a clean row", () => {
    expect(evaluateReadback(spec, "motion_scale", good, ft, "Color").status).toBe("verified");
  });
  it("reports each kind of mismatch", () => {
    expect(evaluateReadback(spec, undefined, undefined, ft, "Color").status).toBe("mismatch");
    const bad = evaluateReadback(spec, "motion_scale", {
      ...good, name: "x", startTicks: TPS + ft, endTicks: 3 * TPS - ft, color: [255, 0, 0, 0], position: [0.1, 0.1], motionScale: 50,
      parameters: [{ displayName: "Line 1", value: JSON.stringify({ textEditValue: "Other" }) }],
    }, ft, "Color");
    expect(bad.status).toBe("mismatch");
    expect(bad.problems.join("|")).toMatch(/name.*start.*end.*text field Line 1.*colour.*position.*Motion scale/);
    expect(evaluateReadback(spec, undefined, { ...good, parameters: [{ displayName: "Line 1", missing: true }] }, ft, "Color").problems.join()).toContain("missing");
  });
  it("is committed_unverified when the host returns nothing to compare", () => {
    expect(evaluateReadback(spec, "motion_scale", { ...good, startTicks: undefined }, ft, "Color").status).toBe("committed_unverified");
    expect(evaluateReadback(spec, undefined, { ...good, color: null }, ft, "Color").status).toBe("committed_unverified");
    expect(evaluateReadback(spec, undefined, { ...good, position: null }, ft, "Color").status).toBe("committed_unverified");
    expect(evaluateReadback(spec, "motion_scale", { ...good, motionScale: undefined }, ft, "Color").status).toBe("committed_unverified");
    expect(evaluateReadback(spec, undefined, { ...good, parameters: [{ displayName: "Line 1", readbackError: "x" }] }, ft, "Color").status).toBe("committed_unverified");
  });
});

describe("generated scripts", () => {
  it("parse as ECMAScript 3 and escape hostile strings", () => {
    const spec: ClipSpec = {
      index: 0, caption_n: 1, start: 1, end: 3, start_ticks: TPS, end_ticks: 3 * TPS, name: 'Cap"tion\\ 001', lines: ['Say "hi"\n'],
      fields: [{ name: 'Line "1"', text: 'Say "hi"\r\\' }], color: "#112233", scale: 0.9, position: [0.5, 0.7],
    };
    const scripts = [
      buildGraphicsTrackInspectScript(1, 'Cap"tion\\', 0, 10),
      buildGraphicsRemoveScript(1, 'Cap"tion\\'),
      buildGraphicsPlaceScript(1, 'C:\\a"b.mogrt', 'Co"lor', [{ spec, existing: null }, { spec: { ...spec, color: null, position: null, scale: 1 }, existing: 'node"1' }]),
      buildGraphicsReadbackScript(1, 'Co"lor', [{ nodeId: 'n"1', fieldNames: ['Line "1"'] }]),
      buildGraphicsReadbackScript(1, undefined, []),
    ];
    for (const script of scripts) {
      expect(() => acorn.parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();
      expect(script).not.toMatch(/\blet\b|\bconst\b|=>|`/);
    }
  });
});

describe("add_caption_graphics against a fake Premiere", () => {
  it("places verified clips, one chunk, names and texts", async () => {
    const { host, calls } = install();
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ outcome: "verified", verified: true, clip_count: 3, verified_count: 3, removed_existing: 0, track_index: 1 });
    expect(calls).toEqual(["read", "inspect", "place", "readback"]);
    expect(result.data.chunks).toEqual([expect.objectContaining({ chunk: 1, clips: 3, placed_ok: 3, verified: 3, mismatch: 0 })]);
    const clips = host.tracks[1].clips as any[];
    expect(clips.map((c) => c.name)).toEqual(["Caption 001", "Caption 002", "Caption 003"]);
    expect(clips[0]._clip.texts["Line 1"]).toBe("Hello there my friend.");
    expect(clips[0]._clip.texts["Line 2"]).toBe("");
    expect(clips[0]._clip._start).toBe(25 * host.frameTicks);
    expect(clips[0]._clip._end - clips[0]._clip._start).toBe(Math.round(result.data.placed[0].end * 25 - result.data.placed[0].start * 25) * host.frameTicks);
    expect(host.tracks[0].clips).toHaveLength(0);
    expect(result.data.placed[0]).toMatchObject({ n: 1, name: "Caption 001", status: "verified", text: "Hello there my friend." });
    expect(result.data.host_limitations.join(" ")).toContain("per-word highlight colour");
    expect(result.data.fit).toMatchObject({ method: "estimated", font_size_source: "caller", font_size_px: 30, safe_area: "reels_9_16" });
    expect(result.data.plan.caption_count).toBe(3);
  });

  it("maps a single text field with carriage returns", async () => {
    const { host } = install();
    const long = srt(["This caption is deliberately long enough to need two lines in the box"]);
    const result = await run({ transcript_text: long, text_fields: { text_field: "Text" }, max_chars_per_line: 36 });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect((host.tracks[1].clips[0] as any)._clip.texts.Text).toContain("\r");
  });

  it("splits 60 captions into 3 chunks of 25, 25 and 10", async () => {
    const texts = Array.from({ length: 60 }, (_, i) => `Caption number ${i + 1} is here.`);
    const { host, calls } = install({ durationSeconds: 400 });
    const result = await run({ transcript_text: srt(texts, 3), fit: "none" });
    expect(result.success).toBe(true);
    expect(result.data.plan.caption_count).toBe(60);
    expect(result.data.chunks.map((c: any) => c.clips)).toEqual([25, 25, 10]);
    expect(calls.filter((c) => c === "place")).toHaveLength(3);
    expect(calls.filter((c) => c === "readback")).toHaveLength(3);
    expect(host.tracks[1].clips).toHaveLength(60);
    expect(host.log.imports).toBe(60);
    expect(result.data.placed).toHaveLength(60);
  });

  it("honours chunk_size and caps the reported list", async () => {
    const texts = Array.from({ length: 210 }, (_, i) => `Caption number ${i + 1} is here.`);
    install({ durationSeconds: 900 });
    const result = await run({ transcript_text: srt(texts, 3), fit: "none", chunk_size: 50 });
    expect(result.success).toBe(true);
    expect(result.data.chunks).toHaveLength(5);
    expect(result.data.placed).toHaveLength(200);
    expect(result.data.placed_truncated).toBe(true);
    expect(result.data.clip_count).toBe(210);
  });

  it("removes earlier caption clips first and reads back that none remain before placing", async () => {
    const existing = [
      { track: 1, name: "Caption 001", start: 0, end: 1 },
      { track: 1, name: "Caption 002", start: 1, end: 2 },
      { track: 1, name: "Caption 99", start: 200, end: 201 },
      { track: 1, name: "Captions 001", start: 203, end: 204 },
      { track: 1, name: "Far away", start: 100, end: 101 },
    ];
    const { host, calls } = install({ existing });
    const staleIds = (host.tracks[1].clips as any[]).filter((c) => /^Caption \d{3}$/.test(c.name)).map((c) => c.nodeId);
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(true);
    expect(result.data.removed_existing).toBe(2);
    expect(calls).toEqual(["read", "inspect", "remove", "inspect", "place", "readback"]);
    const names = (host.tracks[1].clips as any[]).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Caption 99", "Captions 001", "Far away", "Caption 001", "Caption 002", "Caption 003"]));
    const ids = (host.tracks[1].clips as any[]).map((c) => c.nodeId);
    for (const stale of staleIds) expect(ids).not.toContain(stale);
    expect(host.log.removes).toBe(2);
  });

  it("refuses when removal leaves stale clips behind and places nothing", async () => {
    const { host, calls } = install({ removeIsNoop: true, existing: [{ track: 1, name: "Caption 001", start: 0, end: 1 }] });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("still on the track");
    expect(host.log.imports).toBe(0);
    expect(calls).not.toContain("place");
  });

  it("stops when the post-removal readback fails", async () => {
    let inspects = 0;
    install({ existing: [{ track: 1, name: "Caption 001", start: 0, end: 1 }] }, (_s, kind) => {
      if (kind === "inspect" && ++inspects === 2) return { success: false, error: "bridge lost" };
      return undefined;
    });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not read the track back");
  });

  it("reports a failed removal call", async () => {
    install({ existing: [{ track: 1, name: "Caption 001", start: 0, end: 1 }] }, (_s, kind) => (kind === "remove" ? { success: false, error: "locked out" } : undefined));
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Removing the earlier caption clips failed");
  });

  it("refuses to replace when replace_existing is false", async () => {
    const { host, calls } = install({ existing: [{ track: 1, name: "Caption 001", start: 0, end: 1 }] });
    const result = await run({ transcript_text: THREE, replace_existing: false });
    expect(result.success).toBe(false);
    expect(result.error).toContain("replace_existing true");
    expect(calls).toEqual(["read", "inspect"]);
    expect(host.log.removes).toBe(0);
    expect(host.log.imports).toBe(0);
  });

  it("refuses when other clips overlap the plan's range and lists them", async () => {
    const { host, calls } = install({ existing: [{ track: 1, name: "B-roll", start: 2, end: 6 }, { track: 1, name: "Late", start: 11, end: 12 }] });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("overlap");
    expect(result.error).toContain("add_track");
    expect(result.data.overlapping_clips.map((c: any) => c.name)).toContain("B-roll");
    expect(host.log.imports).toBe(0);
    expect(host.log.removes).toBe(0);
    expect(calls).toEqual(["read", "inspect"]);
  });

  it("refuses a track that does not exist and a locked track", async () => {
    install();
    const missing = await run({ transcript_text: THREE, track_index: 3 });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("add_track");
    install({ lockedTracks: [1] });
    const locked = await run({ transcript_text: THREE });
    expect(locked.success).toBe(false);
    expect(locked.error).toContain("locked");
  });

  it("validates before contacting Premiere", async () => {
    install();
    expect((await run({ transcript_text: THREE, track_index: -1 })).success).toBe(false);
    expect(mockedSend).not.toHaveBeenCalled();
    vi.mocked(validateMogrtArchive).mockReturnValueOnce("MOGRT ZIP must contain definition.json");
    const bad = await run({ transcript_text: THREE });
    expect(bad).toMatchObject({ success: false, error: expect.stringContaining("definition.json") });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("reports sequence and plan problems", async () => {
    install({}, (_s, kind) => (kind === "read" ? { success: false, error: "No active sequence" } : undefined));
    expect(await run({ transcript_text: THREE })).toMatchObject({ success: false, error: expect.stringContaining("No active sequence") });
    install();
    expect(await run({ plan_path: "x.json", transcript_text: THREE })).toMatchObject({ success: false, error: expect.stringContaining("exactly one") });
    const empty = await run({ transcript_text: THREE, from_s: 5000 });
    expect(empty.success).toBe(false);
  });

  it("stops at the first failed placement and never reports a partial batch as success", async () => {
    const { host, calls } = install({ importFailsAt: [3] });
    const result = await run({ transcript_text: srt(["One here.", "Two here.", "Three here.", "Four here.", "Five here."]) });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Clip 3 of 5");
    expect(result.data).toMatchObject({ outcome: "partial", verified: false, placed_count: 2, planned_clip_count: 5, caption_clips_on_track: 2 });
    expect(host.log.imports).toBe(3);
    expect(result.data.advice).toContain("replace_existing");
    expect(result.data.chunks[0]).toMatchObject({ placed_ok: 2, failed_at_clip: 3 });
    expect(calls).toContain("readback");
  });

  it("removes the half-built clip when a template cannot be written and reports orphan_removed true", async () => {
    const { host } = install({ controls: ["Line 1", "Color"] });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Line 2");
    expect(result.error).toContain("orphan_removed true");
    expect(host.log.imports).toBe(1);
    expect(host.log.removes).toBe(1);
    expect(host.tracks[1].clips).toHaveLength(0);
    expect(result.data).toMatchObject({ orphan_removed: true, caption_clips_on_track: 0, placed_count: 0 });
    expect(result.data.chunks[0]).toMatchObject({ failed_at_clip: 1, orphan_removed: true });
  });

  it("names the clip right after importMGT, so a failed removal still leaves a clip the next run replaces", async () => {
    const { host } = install({ controls: ["Line 1", "Color"], removeFails: ["Caption 001"] });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("orphan_removed false");
    expect(result.data).toMatchObject({ orphan_removed: false, caption_clips_on_track: 1 });
    expect(host.tracks[1].clips).toHaveLength(1);
    expect(host.tracks[1].clips[0].name).toBe("Caption 001");
    expect(result.data.placed[0]).toMatchObject({ status: "mismatch", name: "Caption 001" });
  });

  it("reports orphan_removed for a failing probe clip and for a later chunk, counting the clips left on the track", async () => {
    const { host } = install({ controls: ["Line 1", "Color"] });
    const { font_size_px: _drop, ...noSize } = base;
    const probe = await tool.handler({ ...noSize, transcript_text: THREE }) as any;
    expect(probe.success).toBe(false);
    expect(probe.data).toMatchObject({ orphan_removed: true, caption_clips_on_track: 0 });
    expect(probe.data.chunks[0]).toMatchObject({ chunk: 0, orphan_removed: true });
    expect(host.tracks[1].clips).toHaveLength(0);

  });

  it("removes a clip whose colour step fails after it was named and sized", async () => {
    const { host } = install();
    const result = await run({ transcript_text: SPEAKERS, speaker_style: "color", color_field: "Missing" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("colour control");
    expect(result.data.orphan_removed).toBe(true);
    expect(result.data.caption_clips_on_track).toBe(host.tracks[1].clips.length);
    expect(host.tracks[1].clips).toHaveLength(0);
  });

  it("sets clip.end to the exact target when the default length is within a frame but not within half a frame", async () => {
    const { host } = install({ mogrtSeconds: 2.264 });
    const result = await run({ transcript_text: srt(["One here."]) });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ outcome: "verified", verified_count: 1 });
    const clip = (host.tracks[1].clips[0] as any)._clip;
    expect(clip._end - clip._start).toBe(56 * host.frameTicks);
  });

  it("fails and removes the clip when the end cannot be set to the exact frame", async () => {
    const { host } = install({ mogrtSeconds: 2.264, endWriteSkew: 0.7 * Math.round(TPS / 25) });
    const result = await run({ transcript_text: srt(["One here."]) });
    expect(result.success).toBe(false);
    expect(result.error).toContain("exact frame");
    expect(host.tracks[1].clips).toHaveLength(0);
  });

  it("tolerates a throwing clip.end write when the default length is already exact, and fails when it is not", async () => {
    const { host } = install({ mogrtSeconds: 2.24, endWriteThrows: true });
    expect((await run({ transcript_text: srt(["One here."]) })).success).toBe(true);
    expect(host.tracks[1].clips).toHaveLength(1);
    install({ mogrtSeconds: 2.264, endWriteThrows: true });
    const failed = await run({ transcript_text: srt(["One here."]) });
    expect(failed.success).toBe(false);
    expect(failed.error).toContain("exact frame");
  });

  it("stops before a chunk when a foreign clip starts inside the template's default length", async () => {
    const { host, calls } = install({ mogrtSeconds: 30, existing: [{ track: 1, name: "B-roll", start: 25, end: 28 }] });
    const result = await run({ transcript_text: THREE, chunk_size: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Stopped before chunk 2");
    expect(result.error).toContain("default length (30 s)");
    expect(result.data).toMatchObject({ outcome: "partial", placed_count: 1, template_default_length_seconds: 30 });
    expect(result.data.overlapping_clips.map((c: any) => c.name)).toEqual(["B-roll"]);
    expect(host.log.imports).toBe(1);
    expect(calls.filter((c) => c === "place")).toHaveLength(1);
  });

  it("reports a failed pre-chunk track check, and lets the run through when nothing foreign is near", async () => {
    let inspects = 0;
    install({ mogrtSeconds: 30 }, (_s, kind) => (kind === "inspect" && ++inspects === 2 ? { success: false, error: "bridge lost" } : undefined));
    const stopped = await run({ transcript_text: THREE, chunk_size: 1 });
    expect(stopped.success).toBe(false);
    expect(stopped.error).toContain("Could not check video track 1 before chunk 2");
    install({ mogrtSeconds: 30 });
    const clear = await run({ transcript_text: THREE, chunk_size: 1 });
    expect(clear.success).toBe(true);
    expect(clear.data.clip_count).toBe(3);
  });

  it("learns the default length from the font probe and checks before chunk 1", async () => {
    const { host } = install({ mogrtSeconds: 30, existing: [{ track: 1, name: "B-roll", start: 25, end: 28 }] });
    const { font_size_px: _drop, ...noSize } = base;
    const result = await tool.handler({ ...noSize, transcript_text: THREE }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Stopped before chunk 1");
    expect(host.log.imports).toBe(1);
  });

  it("marks a clip committed_unverified when the font size cannot be read back after shrinking", async () => {
    let hide = false;
    install({ textJson: (t) => JSON.stringify(hide ? { textEditValue: t } : { textEditValue: t, fontSizeEditValue: 60, capPropFontSizeEdit: true }) }, (_s, kind) => {
      if (kind === "readback") hide = true;
      return undefined;
    });
    const result = await run({ transcript_text: srt(["This caption is a bit too wide to fit"]), fit: "shrink", font_size_px: 40, max_chars_per_line: 80 });
    expect(result.success).toBe(true);
    expect(result.data.fit.shrink_methods).toEqual({ font_size: 1 });
    expect(result.data).toMatchObject({ outcome: "committed_unverified", verified_count: 0, committed_unverified_count: 1 });
  });

  it("reports a mismatch when the font size reads back different from the shrunk size", async () => {
    const result = await (async () => {
      install({ textJson: (t) => JSON.stringify({ textEditValue: t, fontSizeEditValue: 60, capPropFontSizeEdit: true }) });
      return run({ transcript_text: srt(["This caption is a bit too wide to fit"]), fit: "shrink", font_size_px: 40, max_chars_per_line: 80 });
    })();
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not read back as written");
    expect(result.data.placed[0].problems.join(" ")).toContain("font size of Line 1 reads 60");
  });

  it("describes per-part name_prefix in the tool, the parameters and the 2000-clip error", () => {
    expect(tool.parameters.properties.name_prefix.description).toContain("Caption A");
    expect(tool.parameters.properties.replace_existing.description).toContain("own name_prefix");
    expect(tool.parameters.properties.chunk_size.description).toContain("different name_prefix");
    const many = srt(Array.from({ length: 2001 }, (_, i) => `Caption number ${i} here.`), 3);
    expect(() => buildGraphicsClips(planOf(many), frame, opts({ fit: "none" }), 40)).toThrow(/own name_prefix[\s\S]*Caption A/);
  });

  it("documents the audio track convention in host_limitations", async () => {
    install();
    const result = await run({ transcript_text: THREE });
    expect(result.data.host_limitations.join(" ")).toContain("audio track with the same index");
  });

  it("stops and reports a mismatch when the host ignores a text write", async () => {
    const { host } = install({ ignoreTextFor: ["Line 1"] });
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not read back");
    expect(result.data.placed.every((p: any) => p.status === "mismatch")).toBe(true);
    expect(host.log.imports).toBe(3);
  });

  it("stops after a chunk with a mismatch instead of placing the rest", async () => {
    const texts = Array.from({ length: 6 }, (_, i) => `Caption number ${i + 1} is here.`);
    const { host } = install({ ignoreName: true });
    const result = await run({ transcript_text: srt(texts), chunk_size: 2, fit: "none" });
    expect(result.success).toBe(false);
    expect(host.log.imports).toBe(2);
    expect(result.error).toContain("chunk 1");
  });

  it("reports a chunk call that fails outright", async () => {
    install({}, (_s, kind) => (kind === "place" ? { success: false, error: "evalScript timed out" } : undefined));
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(false);
    expect(result.error).toContain("chunk 1 of 1 failed");
    expect(result.data.outcome).toBe("partial");
  });

  it("is committed_unverified, not verified, when readback is unavailable", async () => {
    install({}, (_s, kind) => (kind === "readback" ? { success: false, error: "no readback" } : undefined));
    const result = await run({ transcript_text: THREE });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ outcome: "committed_unverified", verified: false, committed_unverified_count: 3 });
    expect(result.data.chunks[0].readback_error).toBe("no readback");
    expect(result.data.warnings.join(" ")).toContain("could not be fully read back");
  });

  it("reads the font size from the first clip's text JSON, revises that clip instead of importing it again", async () => {
    const { host, calls } = install({ textJson: (t) => JSON.stringify({ textEditValue: t, fontSizeEditValue: 48, capPropFontSizeEdit: true }) });
    const { font_size_px: _drop, ...noSize } = base;
    const result = await tool.handler({ ...noSize, transcript_text: THREE }) as any;
    expect(result.success).toBe(true);
    expect(result.data.fit).toMatchObject({ font_size_px: 48, font_size_source: "template_json" });
    expect(result.data.chunks[0]).toMatchObject({ chunk: 0 });
    expect(result.data.chunks).toHaveLength(2);
    expect(calls).toEqual(["read", "inspect", "place", "place", "readback"]);
    expect(host.log.imports).toBe(3);
    expect(host.tracks[1].clips).toHaveLength(3);
    expect(result.data.warnings.join(" ")).toContain("read from the template's text JSON");
  });

  it("falls back to 6% of the short side with a warning when the template exposes no size", async () => {
    install({ textJson: (t) => JSON.stringify({ textEditValue: t }) });
    const { font_size_px: _drop, ...noSize } = base;
    const result = await tool.handler({ ...noSize, transcript_text: THREE }) as any;
    expect(result.success).toBe(true);
    expect(result.data.fit).toMatchObject({ font_size_source: "fallback", font_size_px: 0.06 * 1080 });
    expect(result.data.warnings.join(" ")).toContain("6% of the frame's short side");
  });

  it("stops when the probe clip cannot be placed", async () => {
    install({ importFailsAt: [1] });
    const { font_size_px: _drop, ...noSize } = base;
    const result = await tool.handler({ ...noSize, transcript_text: THREE }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("first caption clip");
    install({ importThrowsAt: [1] });
    expect(await tool.handler({ ...noSize, transcript_text: THREE })).toMatchObject({ success: false });
    install({}, (_s, kind) => (kind === "place" ? { success: false, error: "gone" } : undefined));
    expect(await tool.handler({ ...noSize, transcript_text: THREE })).toMatchObject({ success: false, error: expect.stringContaining("gone") });
  });

  it("shrinks by rewriting fontSizeEditValue when the control allows it", async () => {
    const { host } = install();
    const long = srt(["This caption is a bit too wide to fit"]);
    const result = await run({ transcript_text: long, fit: "shrink", font_size_px: 40, max_chars_per_line: 80 });
    expect(result.success).toBe(true);
    expect(result.data.fit.shrink_methods).toEqual({ font_size: 1 });
    const clip = (host.tracks[1].clips[0] as any)._clip;
    expect(clip["fontSize:Line 1"]).toBeLessThan(60);
    expect(clip["fontSize:Line 1"]).toBeGreaterThanOrEqual(42);
    expect(clip.motion.scale).toBe(100);
    expect(result.data.fit.refit_count).toBe(1);
    expect(result.data.fit.refits[0]).toMatchObject({ method: "estimated", action: "shrink" });
  });

  it("falls back to Motion Scale when the font size cannot be edited", async () => {
    const { host } = install({ textJson: (t) => JSON.stringify({ textEditValue: t, fontSizeEditValue: 60, capPropFontSizeEdit: false }) });
    const long = srt(["This caption is a bit too wide to fit"]);
    const result = await run({ transcript_text: long, fit: "shrink", font_size_px: 40, max_chars_per_line: 80 });
    expect(result.success).toBe(true);
    expect(result.data.fit.shrink_methods).toEqual({ motion_scale: 1 });
    const scale = (host.tracks[1].clips[0] as any)._clip.motion.scale;
    expect(scale).toBeLessThan(100);
    expect(scale).toBeGreaterThanOrEqual(70);
    expect(result.data.placed[0].shrink).toBe("motion_scale");
  });

  it("sets the Motion position for safe_bottom and flags a host that ignores it", async () => {
    const first = install();
    const ok = await run({ transcript_text: THREE, placement: "safe_bottom" });
    expect(ok.success).toBe(true);
    const clip = (first.host.tracks[1].clips[0] as any)._clip;
    expect(clip.motion.position[0]).toBe(0.5);
    expect(clip.motion.position[1] * 1920).toBeCloseTo(1248 - (30 * 1.2) / 2, 0);
    expect(ok.data.warnings.join(" ")).toContain("centred");
    install({ ignorePosition: true });
    const bad = await run({ transcript_text: THREE, placement: "safe_bottom" });
    expect(bad.success).toBe(false);
    expect(bad.data.placed[0].problems.join(" ")).toContain("position");
  });

  it("sets and reads back the speaker colour with color_field", async () => {
    const { host } = install();
    const result = await run({ transcript_text: SPEAKERS, speaker_style: "color", color_field: "Color" });
    expect(result.success).toBe(true);
    const planned = result.data.plan.caption_count;
    expect(planned).toBe(2);
    const colours = (host.tracks[1].clips as any[]).map((c) => c._clip.colorValue);
    expect(colours.every((c) => Array.isArray(c) && c[0] === 255)).toBe(true);
  });

  it("warns instead of colouring when there is no color_field, and the other way round", async () => {
    install();
    const none = await run({ transcript_text: SPEAKERS, speaker_style: "color" });
    expect(none.success).toBe(true);
    expect(none.data.warnings.join(" ")).toContain("no color_field");
    install();
    const field = await run({ transcript_text: THREE, color_field: "Color" });
    expect(field.data.warnings.join(" ")).toContain("no speaker colours");
  });

  it("reports colour mismatch and unreadable colour", async () => {
    install({ colorReadback: [255, 1, 2, 3] });
    const bad = await run({ transcript_text: SPEAKERS, speaker_style: "color", color_field: "Color" });
    expect(bad.success).toBe(false);
    expect(bad.data.placed[0].problems.join(" ")).toContain("colour");
    install({ colorReadback: null });
    const unknown = await run({ transcript_text: SPEAKERS, speaker_style: "color", color_field: "Color" });
    expect(unknown.success).toBe(true);
    expect(unknown.data.outcome).toBe("committed_unverified");
  });

  it("makes one clip per word in single mode and accumulating clips in accumulate mode", async () => {
    const plan = resolveCaptionPlan({ transcript_text: THREE }, { frame_rate: 25 }).plan;
    const words = plan.captions.reduce((n, c) => n + c.words.length, 0);
    const single = install();
    const s = await run({ transcript_text: THREE, word_mode: "single", fit: "none" });
    expect(s.success).toBe(true);
    expect(s.data.clip_count).toBe(words);
    expect((single.host.tracks[1].clips[0] as any)._clip.texts["Line 1"]).toBe("Hello");
    const acc = install();
    const a = await run({ transcript_text: THREE, word_mode: "accumulate", fit: "none" });
    expect(a.success).toBe(true);
    expect(a.data.clip_count).toBe(words);
    const texts = (acc.host.tracks[1].clips as any[]).slice(0, 3).map((c) => c._clip.texts["Line 1"]);
    expect(texts).toEqual(["Hello", "Hello there", "Hello there my"]);
  });

  it("passes edit points to the plan as cut times when cut_source is edit_points", async () => {
    const { scripts } = install({ existing: [{ track: 0, name: "Interview", start: 0, end: 2 }, { track: 0, name: "Cutaway", start: 2, end: 110 }] });
    const result = await run({ transcript_text: THREE, cut_source: "edit_points" });
    expect(result.success).toBe(true);
    expect(scripts[0]).toContain("if (true)");
    expect(result.data.sequence).toMatchObject({ cut_source: "edit_points", edit_point_count: 2 });
  });

  it("survives a script-level exception and surfaces unknown arguments cleanly", async () => {
    mockedSend.mockRejectedValue(new Error("bridge down"));
    expect(await run({ transcript_text: THREE })).toMatchObject({ success: false, error: "bridge down" });
    mockedSend.mockRejectedValue("plain");
    expect(await run({ transcript_text: THREE })).toMatchObject({ success: false, error: "plain" });
  });
});

describe("add_caption_graphics clamps to the sequence end", () => {
  it("places no clip past the end, drops a caption that would start after it and reports sequence_end", async () => {
    const { host } = install({ durationSeconds: 8 });
    const texts = ["First caption here.", "Second caption here.", "Third caption here.", "Fourth caption here."];
    const result = await run({ transcript_text: srt(texts, 3), fit: "none" });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data.plan.sequence_end).toBeCloseTo(8, 6);
    expect(result.data.plan.sequence_end_changes.some((c: any) => c.action === "dropped")).toBe(true);
    expect(result.data.plan.caption_count).toBe(3);
    for (const clip of host.tracks[1].clips as any[]) expect(clip._clip._end / TPS).toBeLessThanOrEqual(8 + 1e-6);
  });
});

describe("a template with fewer line fields than the plan has lines", () => {
  const TEXT = "Today we're looking at the new Land Rover Defender launch film, which is a big one.";
  const social = () => planOf(srt([TEXT]), { standard: "social_9x16" });
  const tooManyForTwo = () => {
    const p = social();
    expect(p.captions[0].lines.length).toBeGreaterThanOrEqual(3);
    return p;
  };

  it("re-breaks to the field count instead of joining lines 2 and 3 into the second field", () => {
    const plan = tooManyForTwo();
    const built = buildGraphicsClips(plan, frame, opts({ fit: "both", text_fields: { line_fields: ["Title", "Subtitle"] } }), 30);
    expect(built.effective_max_lines).toBe(2);
    expect(built.rebreaks).toHaveLength(1);
    expect(built.rebreaks[0]).toMatchObject({ n: 1, reason: "template_line_fields", line_fields: 2, to_lines: 2 });
    expect(built.rebreaks[0].from_lines).toBeGreaterThanOrEqual(3);
    const clip = built.clips[0];
    expect(clip.lines).toHaveLength(2);
    // Each field holds exactly one broken line, and no text is lost.
    expect(clip.fields.map((f) => f.text)).toEqual(clip.lines);
    expect(clip.fields.map((f) => f.text).join(" ")).toBe(plan.captions[0].text);
    expect(built.warnings.join(" ")).toMatch(/re-broken into at most 2 lines/);
  });

  it("shrinks when the two lines are wider than the safe area, and reports a re-break that cannot fit with fit none", () => {
    const plan = tooManyForTwo();
    const fields = { line_fields: ["Title", "Subtitle"] };
    const shrunk = buildGraphicsClips(plan, frame, opts({ fit: "both", text_fields: fields }), 60);
    expect(shrunk.clips[0].lines).toHaveLength(2);
    expect(shrunk.clips[0].scale).toBeLessThan(1);
    expect(shrunk.rebreaks[0].exceeds_width).toBe(true);
    const none = buildGraphicsClips(plan, frame, opts({ fit: "none", text_fields: fields }), 60);
    expect(none.clips[0].lines).toHaveLength(2);
    expect(none.clips[0].scale).toBe(1);
    expect(none.outside_safe[0]).toMatchObject({ n: 1, reason: "too_wide" });
    expect(none.warnings.join(" ")).toMatch(/outside_safe/);
  });

  it("leaves captions that already fit the field count alone, and a text_field template unlimited", () => {
    const two = planOf(srt(["Hello there my friend. How are you doing today?"]), { max_lines: 2 });
    const same = buildGraphicsClips(two, frame, opts({ text_fields: { line_fields: ["A", "B"] } }), 30);
    expect(same.rebreaks).toEqual([]);
    const single = buildGraphicsClips(tooManyForTwo(), frame, opts({ text_fields: { text_field: "Text" } }), 30);
    expect(single.rebreaks).toEqual([]);
    expect(single.clips[0].lines.length).toBeGreaterThanOrEqual(3);
  });

  it("re-breaks from a saved plan too, keeping the timing", async () => {
    const dir = makeTempDir("graphics-rebreak-");
    const resolved = resolveCaptionPlan({ transcript_text: srt([TEXT]), standard: "social_9x16", frame_rate: 25 });
    const saved = writeCaptionPlanDocument(resolved.document, dir, path.join(dir, "plan.json"));
    const { host } = install();
    const result = await run({ plan_path: saved, approved_workspace_path: dir, fit: "both", text_fields: { line_fields: ["Line 1", "Line 2"] } });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data.fit.effective_max_lines).toBe(2);
    expect(result.data.fit.rebreak_count).toBe(1);
    const clip = (host.tracks[1].clips[0] as any)._clip;
    expect(clip.texts["Line 2"]).not.toBe("");
    expect(clip.texts["Line 1"].split(" ").length + clip.texts["Line 2"].split(" ").length).toBe(resolved.plan.captions[0].text.split(" ").length);
  });
});

describe("template preflight before anything is sent to Premiere", () => {
  const dir = makeTempDir("graphics-preflight-");
  const control = (type: number, name: string) => ({ type, uiName: { strDB: [{ localeString: "de_DE", str: `${name} de` }, { localeString: "en_US", str: name }] } });
  const writeMogrt = (file: string, author: string, controls: unknown[], extraEntries: string[] = []) => {
    const full = path.join(dir, file);
    writeFileSync(full, writeZip([{ name: "definition.json", data: Buffer.from(JSON.stringify({ authorApp: author, clientControls: controls })) }, ...extraEntries.map((name) => ({ name, data: Buffer.from("x") }))]));
    return full;
  };
  const useReal = () => {
    vi.mocked(validateMogrtArchive).mockImplementation(((p: string) => (existsSync(p) ? null : "missing")) as never);
  };

  it("refuses a Premiere-authored template with a message naming the After Effects route, before dispatch", async () => {
    useReal();
    const file = writeMogrt("bold.mogrt", "ppro", [control(6, "TextLayer")], ["project.prgraphic"]);
    install();
    const result = await run({ transcript_text: THREE, mogrt_path: file, text_fields: { text_field: "TextLayer" } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/built in Premiere Pro/);
    expect(result.error).toMatch(/does not expose a Premiere-built graphic's text to scripts/);
    expect(result.error).toMatch(/ae_captions make_template/);
    expect(result.error).toMatch(/create_mogrt_recipe/);
    expect(result.data).toMatchObject({ outcome: "not_applied" });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("refuses text and colour names the template does not have, listing the available controls", async () => {
    useReal();
    const file = writeMogrt("ae.mogrt", "aefx", [control(6, "Line 1"), control(6, "Line 2"), control(4, "Fill"), control(2, "Size")]);
    install();
    const missing = await run({ transcript_text: THREE, mogrt_path: file, text_fields: { line_fields: ["Line 1", "Line 3"] }, color_field: "Colour" });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('text field "Line 3" is not a text control');
    expect(missing.error).toContain('color_field "Colour" is not a colour control');
    expect(missing.error).toContain('Text controls available: "Line 1", "Line 2"');
    expect(missing.error).toContain('Colour controls available: "Fill"');
    const swapped = await run({ transcript_text: THREE, mogrt_path: file, text_fields: { line_fields: ["Line 1", "Fill"] }, color_field: "Line 2" });
    expect(swapped.error).toContain("(it is a colour control)");
    expect(swapped.error).toContain("(it is a text control)");
    const other = await run({ transcript_text: THREE, mogrt_path: file, text_fields: { text_field: "Size" } });
    expect(other.error).toContain("(it is not a text control)");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("lets a template with the named controls through to the host, and skips what it cannot read", async () => {
    useReal();
    const file = writeMogrt("good.mogrt", "aefx", [control(6, "Line 1"), control(6, "Line 2"), control(4, "Color")]);
    install();
    const ok = await run({ transcript_text: THREE, mogrt_path: file, color_field: "Color" });
    expect(ok.error).toBeUndefined();
    expect(ok.success).toBe(true);
    expect(mockedSend).toHaveBeenCalled();
    expect(readMogrtControls(path.join(dir, "nope.mogrt"))).toBeNull();
    expect(preflightCaptionTemplate(path.join(dir, "nope.mogrt"), { textFields: ["x"] })).toBeNull();
    const noDefinition = path.join(dir, "empty.mogrt");
    writeFileSync(noDefinition, writeZip([{ name: "other.txt", data: Buffer.from("x") }]));
    expect(readMogrtControls(noDefinition)).toBeNull();
    const bad = path.join(dir, "bad.mogrt");
    writeFileSync(bad, writeZip([{ name: "definition.json", data: Buffer.from("[1]") }]));
    expect(readMogrtControls(bad)).toBeNull();
  });

  it("treats project.prgraphic as Premiere-authored even without authorApp, and falls back to the first locale name", () => {
    const file = path.join(dir, "noauthor.mogrt");
    writeFileSync(file, writeZip([
      { name: "definition.json", data: Buffer.from(JSON.stringify({ clientControls: [{ type: 6, uiName: { strDB: [{ localeString: "de_DE", str: "Text" }] } }, { type: 6, uiName: "Plain" }, null, { type: "x", uiName: 5 }] })) },
      { name: "project.prgraphic", data: Buffer.from("x") },
    ]));
    const info = readMogrtControls(file)!;
    expect(info.author_app).toBeNull();
    expect(isPremiereAuthored(info)).toBe(true);
    expect(info.text).toEqual(["Text", "Plain"]);
    expect(info.other).toEqual([" (type ?)"]);
  });
});

afterAll(() => cleanupTempDirs());
