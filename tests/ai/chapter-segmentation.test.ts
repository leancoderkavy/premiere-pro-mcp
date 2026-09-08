import { describe, expect, it } from "vitest";
import { DEFAULT_STOP_WORDS, cosineSimilarity, formatYoutubeTimestamp, planChapterMarkers } from "../../src/ai/chapter-segmentation.js";

const REVISION = `sha256:${"c".repeat(64)}`;

type Word = { text: string; start_seconds: number; end_seconds: number; speaker_label?: string };

const TOPICS: Record<string, string[]> = {
  camera: ["camera", "lens", "aperture", "shutter", "sensor", "exposure", "focus", "bokeh", "tripod", "zoom"],
  audio: ["microphone", "audio", "gain", "preamp", "noise", "boom", "lavalier", "recorder", "levels", "waveform"],
  color: ["color", "grade", "lumetri", "curves", "saturation", "contrast", "scopes", "vectorscope", "highlights", "lut"],
  export: ["export", "bitrate", "codec", "preset", "render", "queue", "encoder", "upload", "resolution", "delivery"],
};

/** Deterministic pseudo-random picker so fixtures vary without being flaky. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Builds ~sentencesPerTopic sentences per topic; each sentence mixes stop words with topic vocabulary. */
function topicSentences(topics: string[], sentencesPerTopic: number, seed = 7): string[] {
  const random = lcg(seed);
  const sentences: string[] = [];
  for (const topic of topics) {
    const vocab = TOPICS[topic];
    for (let index = 0; index < sentencesPerTopic; index += 1) {
      const pick = () => vocab[Math.floor(random() * vocab.length)];
      sentences.push(`the ${pick()} and the ${pick()} ${pick()} of the ${pick()} ${pick()}.`);
    }
  }
  return sentences;
}

function timelineFromSentences(sentences: string[], options: { wps?: number; gap?: number } = {}) {
  const words: Word[] = [];
  let cursor = 0;
  const wps = options.wps ?? 2;
  const gap = options.gap ?? 0.2;
  for (const sentence of sentences) {
    for (const token of sentence.split(/\s+/).filter(Boolean)) {
      words.push({ text: token, start_seconds: Number(cursor.toFixed(3)), end_seconds: Number((cursor + (1 / wps) * 0.9).toFixed(3)) });
      cursor += 1 / wps;
    }
    cursor += gap;
  }
  return { timeline: { source_project_item_id: "item-lecture", transcript_revision: REVISION, words }, duration: cursor - gap };
}

/** Source-time at which the nth topic starts, for boundary assertions. */
function topicStarts(sentences: string[], sentencesPerTopic: number, wps = 2, gap = 0.2): number[] {
  const starts: number[] = [];
  let cursor = 0;
  sentences.forEach((sentence, index) => {
    if (index % sentencesPerTopic === 0) starts.push(cursor);
    cursor += sentence.split(/\s+/).length / wps + gap;
  });
  return starts;
}

const SENTENCES_PER_TOPIC = 12;
const FOUR_TOPICS = topicSentences(["camera", "audio", "color", "export"], SENTENCES_PER_TOPIC);
const fourTopicFixture = timelineFromSentences(FOUR_TOPICS);
const baseOptions = { word_timeline: fourTopicFixture.timeline, min_chapter_seconds: 20, block_words: 30 };

describe("planChapterMarkers", () => {
  it("places boundaries near topic changes on a four-topic transcript", () => {
    const plan = planChapterMarkers(baseOptions);
    expect(plan.applied).toBe(false);
    expect(plan.chapters).toHaveLength(4);
    const expected = topicStarts(FOUR_TOPICS, SENTENCES_PER_TOPIC).slice(1);
    const actual = plan.chapters.slice(1).map((chapter) => chapter.start_seconds);
    actual.forEach((time, index) => expect(Math.abs(time - expected[index])).toBeLessThanOrEqual(6));
    expect(plan.chapters[0].start_seconds).toBe(0);
    const lastWord = fourTopicFixture.timeline.words[fourTopicFixture.timeline.words.length - 1];
    expect(plan.chapters[plan.chapters.length - 1].end_seconds).toBeCloseTo(lastWord.end_seconds, 2);
    for (const chapter of plan.chapters.slice(1)) expect(chapter.boundary_similarity).toBeLessThan(0.2);
    expect(plan.evidence.word_count).toBeGreaterThanOrEqual(300);
  });

  it("titles chapters from their distinctive vocabulary", () => {
    const plan = planChapterMarkers({ ...baseOptions, title_words: 3 });
    const topicOrder = ["camera", "audio", "color", "export"];
    plan.chapters.forEach((chapter, index) => {
      const vocab = TOPICS[topicOrder[index]];
      const words = chapter.name.split(" ");
      expect(words.length).toBeLessThanOrEqual(3);
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) {
        expect(word.charAt(0)).toBe(word.charAt(0).toLocaleUpperCase());
        expect(vocab).toContain(word.toLocaleLowerCase());
      }
      expect(chapter.keywords.length).toBeLessThanOrEqual(8);
      for (const keyword of chapter.keywords) expect(vocab).toContain(keyword);
    });
  });

  it("emits YouTube timestamps starting at 0:00 with one line per chapter", () => {
    const plan = planChapterMarkers(baseOptions);
    const lines = plan.youtube_timestamps.split("\n");
    expect(lines).toHaveLength(plan.chapters.length);
    expect(lines[0]).toMatch(/^0:00 /);
    for (const line of lines) expect(line).toMatch(/^(\d+:)?\d{1,2}:\d{2} .+$/);
    lines.slice(1).forEach((line, index) => expect(line).toBe(`${formatYoutubeTimestamp(plan.chapters[index + 1].start_seconds)} ${plan.chapters[index + 1].name}`));
  });

  it("produces add_marker-ready Chapter markers and routes", () => {
    const plan = planChapterMarkers(baseOptions);
    expect(plan.markers).toHaveLength(plan.chapters.length);
    plan.markers.forEach((marker, index) => {
      expect(marker.type).toBe("Chapter");
      expect(marker.time_seconds).toBe(plan.chapters[index].start_seconds);
      expect(marker.name).toBe(plan.chapters[index].name);
      expect(marker.comment).toContain(`Chapter ${index + 1}`);
    });
    const routes = plan.routes.flatMap((route) => route.routes);
    for (const name of ["add_marker", "manage_markers_uxp", "get_sequence_markers_by_type"]) expect(routes).toContain(name);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.evidence.transcript_revision).toBe(REVISION);
  });

  it("caps the chapter count at max_chapters keeping the deepest valleys", () => {
    const plan = planChapterMarkers({ ...baseOptions, max_chapters: 2 });
    expect(plan.chapters).toHaveLength(2);
    expect(plan.evidence.rejected_boundaries.some((entry) => entry.reason === "max_chapters reached")).toBe(true);
    const full = planChapterMarkers(baseOptions);
    const deepest = [...full.evidence.accepted_boundaries].sort((a, b) => b.depth - a.depth)[0];
    expect(plan.chapters[1].start_seconds).toBe(deepest.time_seconds);
  });

  it("enforces min_chapter_seconds", () => {
    const plan = planChapterMarkers({ ...baseOptions, min_chapter_seconds: 70 });
    for (const chapter of plan.chapters) expect(chapter.duration_seconds).toBeGreaterThanOrEqual(70);
    expect(plan.chapters.length).toBeLessThan(4);
    expect(plan.evidence.rejected_boundaries.some((entry) => entry.reason === "min_chapter_seconds")).toBe(true);
  });

  it("returns a single chapter with a warning when the transcript is shorter than two chapters", () => {
    const short = timelineFromSentences(topicSentences(["camera", "audio"], 3));
    const plan = planChapterMarkers({ word_timeline: short.timeline, min_chapter_seconds: 60 });
    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0].start_seconds).toBe(0);
    expect(plan.youtube_timestamps).toMatch(/^0:00 /);
    expect(plan.warnings.some((warning) => warning.includes("single chapter"))).toBe(true);
  });

  it("finds only shallow, high-similarity valleys when the vocabulary never shifts", () => {
    const uniform = timelineFromSentences(topicSentences(["camera"], 48));
    const plan = planChapterMarkers({ word_timeline: uniform.timeline, min_chapter_seconds: 20, block_words: 30 });
    const topical = planChapterMarkers(baseOptions);
    for (const boundary of plan.evidence.accepted_boundaries) {
      expect(boundary.similarity).toBeGreaterThan(0.5);
      for (const strong of topical.evidence.accepted_boundaries) expect(boundary.depth).toBeLessThan(strong.depth);
    }
    expect(plan.evidence.similarity_mean).toBeGreaterThan(topical.evidence.similarity_mean);
  });

  it("is deterministic and orders chapters by time", () => {
    const first = planChapterMarkers(baseOptions);
    const second = planChapterMarkers(baseOptions);
    expect(first.plan_revision).toBe(second.plan_revision);
    expect(first).toEqual(second);
    const starts = first.chapters.map((chapter) => chapter.start_seconds);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    first.chapters.forEach((chapter, index) => expect(chapter.index).toBe(index));
    for (let index = 1; index < first.chapters.length; index += 1) expect(first.chapters[index].start_seconds).toBe(first.chapters[index - 1].end_seconds);
  });

  it("changes plan_revision when parameters change", () => {
    const base = planChapterMarkers(baseOptions).plan_revision;
    expect(planChapterMarkers({ ...baseOptions, max_chapters: 3 }).plan_revision).not.toBe(base);
    expect(planChapterMarkers({ ...baseOptions, stop_words: ["lens"] }).plan_revision).not.toBe(base);
  });

  it("removes caller stop words from titles and keywords", () => {
    const plan = planChapterMarkers({ ...baseOptions, stop_words: TOPICS.camera.slice(0, 5) });
    for (const banned of TOPICS.camera.slice(0, 5)) {
      expect(plan.chapters[0].keywords).not.toContain(banned);
      expect(plan.chapters[0].name.toLocaleLowerCase().split(" ")).not.toContain(banned);
    }
    expect(plan.parameters.stop_words).toEqual([...TOPICS.camera.slice(0, 5)].sort());
  });

  it("snaps frames with frame_rate", () => {
    const plan = planChapterMarkers({ ...baseOptions, frame_rate: 25 });
    for (const chapter of plan.chapters) {
      expect(chapter.start_frame).toBe(Math.floor(chapter.start_seconds * 25 + 1e-7));
      expect(chapter.end_frame).toBe(Math.ceil(chapter.end_seconds * 25 - 1e-7));
    }
  });

  it("falls back to a generic name when a chapter has no content tokens", () => {
    const stopOnly = timelineFromSentences(["the and of the it is.", "we are so very just here now.", "you and me and them too."]);
    const plan = planChapterMarkers({ word_timeline: stopOnly.timeline, min_chapter_seconds: 20 });
    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0].name).toBe("Chapter 1");
    expect(plan.chapters[0].keywords).toEqual([]);
  });

  it("formats hours in youtube timestamps", () => {
    const plan = planChapterMarkers({ ...baseOptions, word_timeline: { ...fourTopicFixture.timeline, words: fourTopicFixture.timeline.words.map((word) => ({ ...word, start_seconds: word.start_seconds + 3600, end_seconds: word.end_seconds + 3600 })) } });
    expect(plan.chapters[0].start_seconds).toBe(0);
    expect(plan.youtube_timestamps.split("\n")[1]).toMatch(/^1:\d{2}:\d{2} /);
  });

  it.each([
    [{ min_chapter_seconds: 10 }, /min_chapter_seconds/],
    [{ max_chapters: 1 }, /max_chapters/],
    [{ max_chapters: 3.5 }, /max_chapters must be an integer/],
    [{ title_words: 0 }, /title_words/],
    [{ title_words: 9 }, /title_words/],
    [{ block_words: 5 }, /block_words/],
    [{ frame_rate: 500 }, /frame_rate/],
    [{ stop_words: "the" }, /stop_words/],
    [{ stop_words: [123] }, /stop_words\[0\]/],
    [{ stop_words: Array.from({ length: 257 }, (_, index) => `s${index}`) }, /stop_words/],
  ])("rejects invalid options %j", (overrides, message) => {
    expect(() => planChapterMarkers({ ...baseOptions, ...overrides })).toThrow(message);
  });

  it("rejects invalid word timelines", () => {
    expect(() => planChapterMarkers({ word_timeline: [] })).toThrow(/word_timeline/);
    expect(() => planChapterMarkers({ word_timeline: { source_project_item_id: "x", transcript_revision: REVISION, words: [{ text: "a", start_seconds: 1, end_seconds: 0.5 }] } })).toThrow(/end_seconds/);
  });
});

describe("helpers", () => {
  it("formats timestamps as m:ss or h:mm:ss", () => {
    expect(formatYoutubeTimestamp(0)).toBe("0:00");
    expect(formatYoutubeTimestamp(83.9)).toBe("1:23");
    expect(formatYoutubeTimestamp(3600)).toBe("1:00:00");
    expect(formatYoutubeTimestamp(3725)).toBe("1:02:05");
    expect(formatYoutubeTimestamp(-4)).toBe("0:00");
  });

  it("computes cosine similarity with empty-side fallback", () => {
    const a = new Map([["x", 2], ["y", 1]]);
    const b = new Map([["x", 2], ["y", 1]]);
    const c = new Map([["z", 3]]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 9);
    expect(cosineSimilarity(a, c)).toBe(0);
    expect(cosineSimilarity(a, new Map())).toBe(1);
    expect(cosineSimilarity(new Map([["x", 1]]), new Map([["x", 1], ["y", 1]]))).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("ships a lower-case stop word list", () => {
    expect(DEFAULT_STOP_WORDS.length).toBeGreaterThan(100);
    for (const word of DEFAULT_STOP_WORDS) expect(word).toBe(word.toLocaleLowerCase());
  });
});
