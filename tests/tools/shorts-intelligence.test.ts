import { describe, expect, it } from "vitest";
import { getShortsIntelligenceTools } from "../../src/tools/shorts-intelligence.js";

const REVISION = `sha256:${"d".repeat(64)}`;
const ALLOWED_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function timeline(sentences: string[], wps = 2.5) {
  const words: Array<{ text: string; start_seconds: number; end_seconds: number }> = [];
  let cursor = 0;
  for (const sentence of sentences) {
    for (const token of sentence.split(/\s+/).filter(Boolean)) {
      words.push({ text: token, start_seconds: Number(cursor.toFixed(3)), end_seconds: Number((cursor + 0.9 / wps).toFixed(3)) });
      cursor += 1 / wps;
    }
    cursor += 0.2;
  }
  return { source_project_item_id: "item-1", transcript_revision: REVISION, words };
}

const TALK = [
  "Why do most editors waste hours every week on imports?",
  "Because nobody builds a proxy workflow before the edit starts.",
  "Here is the secret that saves me twenty minutes a day.",
  "Generate proxies in the background while you log footage.",
  "Stop waiting for renders and start cutting immediately today.",
  "Now let us move on to color grading and scopes.",
  "Lumetri shows exposure and saturation on the waveform clearly.",
  "Skin tones should sit on the vectorscope line every time.",
  "Finally export with a preset built for the target platform.",
  "Match source settings unless the client asks for something else.",
  "Thanks for watching and see you in the next video.",
];

function walkSchema(schema: Record<string, unknown>, path: string, problems: string[], isItems = false) {
  if (!ALLOWED_TYPES.has(String(schema.type))) problems.push(`${path}: unsupported type ${String(schema.type)}`);
  // Array item objects describe themselves through their properties; every named property must carry a description.
  if (!(isItems && schema.type === "object") && (typeof schema.description !== "string" || !schema.description.trim())) problems.push(`${path}: missing description`);
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, child] of Object.entries(properties)) walkSchema(child, `${path}.${name}`, problems);
    for (const required of (schema.required ?? []) as string[]) if (!(required in properties)) problems.push(`${path}: required ${required} is not a property`);
  }
  if (schema.type === "array") {
    if (typeof schema.maxItems !== "number") problems.push(`${path}: arrays must set maxItems`);
    if (!schema.items || typeof schema.items !== "object") problems.push(`${path}: arrays must define items`);
    else walkSchema(schema.items as Record<string, unknown>, `${path}[]`, problems, true);
  }
  if (schema.type === "string" && typeof schema.maxLength !== "number" && typeof schema.pattern !== "string") problems.push(`${path}: strings must set maxLength or pattern`);
  if ((schema.type === "number" || schema.type === "integer") && ((typeof schema.minimum !== "number" && typeof schema.exclusiveMinimum !== "number") || typeof schema.maximum !== "number")) problems.push(`${path}: numbers must set minimum and maximum`);
}

describe("getShortsIntelligenceTools", () => {
  const tools = getShortsIntelligenceTools();

  it("exposes exactly the two shorts-intelligence tools", () => {
    expect(Object.keys(tools).sort()).toEqual(["plan_chapter_markers", "rank_short_form_candidates"]);
  });

  it.each(Object.entries(tools))("%s has a bounded, fully described schema", (_name, tool) => {
    const problems: string[] = [];
    const schema = tool.parameters as unknown as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    for (const [name, child] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) walkSchema(child, name, problems);
    expect(problems).toEqual([]);
    expect(schema.required).toEqual(["word_timeline"]);
    expect(tool.description.length).toBeLessThanOrEqual(400);
    expect(tool.description).toMatch(/never changes Premiere/);
  });

  it("returns a ranked short-form plan on the happy path", async () => {
    const result = await tools.rank_short_form_candidates.handler({ word_timeline: timeline(TALK), min_seconds: 8, max_seconds: 20, max_candidates: 3, keywords: ["proxy"], marker_seconds: [12] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.applied).toBe(false);
    expect(data.plan_revision).toMatch(/^sha256:/);
    const candidates = data.candidates as Array<Record<string, unknown>>;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual(["components", "duration_seconds", "end_frame", "end_seconds", "hook_text", "rank", "reasons", "score", "sentence_count", "speakers", "start_frame", "start_seconds", "word_count"]);
      expect(Object.keys(candidate.components as object).sort()).toEqual(["completeness", "density", "duration_fit", "evidence", "hook", "keyword", "speaker_consistency"]);
    }
    expect(Array.isArray(data.routes)).toBe(true);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(Array.isArray(data.assumptions)).toBe(true);
    expect((data.evidence as Record<string, unknown>).transcript_revision).toBe(REVISION);
  });

  it("returns a chapter plan on the happy path", async () => {
    const result = await tools.plan_chapter_markers.handler({ word_timeline: timeline(TALK), min_chapter_seconds: 20, block_words: 20, max_chapters: 4 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.applied).toBe(false);
    expect(data.plan_revision).toMatch(/^sha256:/);
    const chapters = data.chapters as Array<Record<string, unknown>>;
    expect(chapters.length).toBeGreaterThanOrEqual(1);
    expect(chapters.length).toBeLessThanOrEqual(4);
    expect(chapters[0].start_seconds).toBe(0);
    expect(String(data.youtube_timestamps)).toMatch(/^0:00 /);
    const markers = data.markers as Array<Record<string, unknown>>;
    expect(markers).toHaveLength(chapters.length);
    for (const marker of markers) expect(Object.keys(marker).sort()).toEqual(["comment", "name", "time_seconds", "type"]);
    expect((data.routes as Array<{ routes: string[] }>).flatMap((route) => route.routes)).toContain("add_marker");
  });

  it.each([
    ["missing word_timeline", {}],
    ["null word_timeline", { word_timeline: null }],
    ["string word_timeline", { word_timeline: "nope" }],
    ["bad revision", { word_timeline: { ...timeline(TALK), transcript_revision: "abc" } }],
    ["unknown timeline field", { word_timeline: { ...timeline(TALK), extra: 1 } }],
    ["empty words", { word_timeline: { ...timeline(TALK), words: [] } }],
  ])("rank_short_form_candidates rejects %s without throwing", async (_label, args) => {
    const result = await tools.rank_short_form_candidates.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/word_timeline/);
  });

  it.each([
    ["min above max", { min_seconds: 100, max_seconds: 20 }, /min_seconds/],
    ["fractional max_candidates", { max_candidates: 1.5 }, /max_candidates/],
    ["bad hook_words", { hook_words: [1] }, /hook_words/],
    ["bad keywords", { keywords: "proxy" }, /keywords/],
    ["negative markers", { marker_seconds: [-2] }, /marker_seconds/],
    ["bad frame_rate", { frame_rate: 0 }, /frame_rate/],
  ])("rank_short_form_candidates rejects %s", async (_label, overrides, message) => {
    const result = await tools.rank_short_form_candidates.handler({ word_timeline: timeline(TALK), ...overrides });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });

  it.each([
    ["missing word_timeline", {}, /word_timeline/],
    ["array word_timeline", { word_timeline: [] }, /word_timeline/],
    ["low min_chapter_seconds", { word_timeline: timeline(TALK), min_chapter_seconds: 5 }, /min_chapter_seconds/],
    ["max_chapters too high", { word_timeline: timeline(TALK), max_chapters: 61 }, /max_chapters/],
    ["title_words too high", { word_timeline: timeline(TALK), title_words: 12 }, /title_words/],
    ["bad stop_words", { word_timeline: timeline(TALK), stop_words: [null] }, /stop_words/],
    ["bad block_words", { word_timeline: timeline(TALK), block_words: 1000 }, /block_words/],
  ])("plan_chapter_markers rejects %s without throwing", async (_label, args, message) => {
    const result = await tools.plan_chapter_markers.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });

  it("produces identical plans for identical input", async () => {
    const args = { word_timeline: timeline(TALK), min_seconds: 8, max_seconds: 20 };
    const [first, second] = await Promise.all([tools.rank_short_form_candidates.handler(args), tools.rank_short_form_candidates.handler(args)]);
    expect(first).toEqual(second);
    const chapterArgs = { word_timeline: timeline(TALK), min_chapter_seconds: 20 };
    const [thirdResult, fourthResult] = await Promise.all([tools.plan_chapter_markers.handler(chapterArgs), tools.plan_chapter_markers.handler(chapterArgs)]);
    expect(thirdResult).toEqual(fourthResult);
  });
});
