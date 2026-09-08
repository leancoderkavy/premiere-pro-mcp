import { describe, expect, it } from "vitest";
import {
  HOOK_LEXICON,
  OVERLAP_SUPPRESSION_RATIO,
  SHORT_FORM_WEIGHTS,
  countInRange,
  rankShortFormCandidates,
  scoreHook,
} from "../../src/ai/short-form-candidates.js";
import { normalizeToken } from "../../src/ai/word-timeline.js";

const REVISION = `sha256:${"b".repeat(64)}`;

type Word = { text: string; start_seconds: number; end_seconds: number; speaker_label?: string };

/** Builds a word timeline from sentences at a fixed words-per-second pace with a short pause between sentences. */
function timelineFromSentences(sentences: Array<string | { text: string; speaker?: string; wps?: number }>, options: { wps?: number; gap?: number; startAt?: number } = {}) {
  const words: Word[] = [];
  let cursor = options.startAt ?? 0;
  const gap = options.gap ?? 0.2;
  for (const entry of sentences) {
    const text = typeof entry === "string" ? entry : entry.text;
    const speaker = typeof entry === "string" ? undefined : entry.speaker;
    const wps = (typeof entry === "string" ? undefined : entry.wps) ?? options.wps ?? 2.5;
    const step = 1 / wps;
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const word: Word = { text: token, start_seconds: Number(cursor.toFixed(3)), end_seconds: Number((cursor + step * 0.9).toFixed(3)) };
      if (speaker) word.speaker_label = speaker;
      words.push(word);
      cursor += step;
    }
    cursor += gap;
  }
  return { source_project_item_id: "item-long-video", transcript_revision: REVISION, words };
}

const TOPIC_SENTENCES = [
  "Today we are going to talk about editing workflows in Premiere.",
  "Most people start by importing every single clip into one bin.",
  "That is fine for tiny projects but it collapses fast.",
  "Why do most editors lose hours every single week?",
  "Because they never build a proxy workflow before the edit.",
  "Here is the secret that nobody tells you about proxies.",
  "You can generate them in the background while you log footage.",
  "Stop waiting for renders and start cutting immediately.",
  "The second mistake is ignoring keyboard shortcuts entirely.",
  "Ripple delete alone saves me twenty minutes a day.",
  "Now let us move on to color grading basics.",
  "Lumetri has scopes that show exposure and saturation clearly.",
  "Always check the waveform before you trust your monitor.",
  "Skin tones should sit on the line in the vectorscope.",
  "That is the whole trick and it works every time.",
  "Finally we export with a preset built for the platform.",
  "Match source settings unless the client asks for something else.",
  "And that is how I ship three videos a week.",
  "Thanks for watching and see you in the next one.",
  "Leave a comment if you want a deeper tutorial on proxies.",
];

function fixture(overrides: Record<string, unknown> = {}) {
  return rankShortFormCandidates({ word_timeline: timelineFromSentences(TOPIC_SENTENCES), min_seconds: 10, max_seconds: 25, ...overrides });
}

describe("rankShortFormCandidates", () => {
  it("returns a plan with candidates inside the duration range, sorted by score", () => {
    const plan = fixture();
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.candidates.length).toBeGreaterThan(0);
    expect(plan.candidates.length).toBeLessThanOrEqual(8);
    for (const candidate of plan.candidates) {
      expect(candidate.duration_seconds).toBeGreaterThanOrEqual(10);
      expect(candidate.duration_seconds).toBeLessThanOrEqual(25);
      expect(candidate.end_seconds).toBeGreaterThan(candidate.start_seconds);
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
      expect(candidate.word_count).toBeGreaterThan(0);
      expect(candidate.hook_text.length).toBeLessThanOrEqual(120);
      expect(Array.isArray(candidate.reasons)).toBe(true);
    }
    const scores = plan.candidates.map((candidate) => candidate.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(plan.candidates.map((candidate) => candidate.rank)).toEqual(plan.candidates.map((_, index) => index + 1));
  });

  it("exposes weights and components in [0,1] that reproduce the score", () => {
    const plan = fixture();
    expect(plan.weights).toEqual(SHORT_FORM_WEIGHTS);
    const weightSum = Object.values(SHORT_FORM_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(weightSum).toBeCloseTo(1, 6);
    for (const candidate of plan.candidates) {
      let expected = 0;
      for (const [key, weight] of Object.entries(SHORT_FORM_WEIGHTS)) {
        const component = candidate.components[key as keyof typeof SHORT_FORM_WEIGHTS];
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(1);
        expected += weight * component;
      }
      expect(candidate.score).toBeCloseTo(expected, 2);
    }
  });

  it("suppresses candidates that overlap a higher-scored one by more than the ratio", () => {
    const plan = fixture({ max_candidates: 50 });
    expect(plan.overlap_suppression_ratio).toBe(OVERLAP_SUPPRESSION_RATIO);
    expect(plan.windows_suppressed).toBeGreaterThan(0);
    for (let a = 0; a < plan.candidates.length; a += 1) {
      for (let b = a + 1; b < plan.candidates.length; b += 1) {
        const left = plan.candidates[a];
        const right = plan.candidates[b];
        const intersection = Math.min(left.end_seconds, right.end_seconds) - Math.max(left.start_seconds, right.start_seconds);
        const shorter = Math.min(left.duration_seconds, right.duration_seconds);
        expect(Math.max(0, intersection) / shorter).toBeLessThanOrEqual(OVERLAP_SUPPRESSION_RATIO + 1e-6);
      }
    }
  });

  it("is deterministic across runs", () => {
    const first = fixture({ keywords: ["proxy"], marker_seconds: [12, 40] });
    const second = fixture({ keywords: ["proxy"], marker_seconds: [12, 40] });
    expect(first.plan_revision).toBe(second.plan_revision);
    expect(first.candidates).toEqual(second.candidates);
  });

  it("changes plan_revision when parameters or evidence change", () => {
    const base = fixture();
    expect(fixture({ max_seconds: 30 }).plan_revision).not.toBe(base.plan_revision);
    expect(fixture({ marker_seconds: [5] }).plan_revision).not.toBe(base.plan_revision);
    expect(fixture({ keywords: ["proxy"] }).plan_revision).not.toBe(base.plan_revision);
  });

  it("respects max_candidates", () => {
    expect(fixture({ max_candidates: 2 }).candidates).toHaveLength(2);
    expect(fixture({ max_candidates: 1 }).candidates).toHaveLength(1);
  });

  it("snaps frames using frame_rate", () => {
    const plan = fixture({ frame_rate: 24 });
    for (const candidate of plan.candidates) {
      expect(candidate.start_frame).toBe(Math.floor(candidate.start_seconds * 24 + 1e-7));
      expect(candidate.end_frame).toBe(Math.ceil(candidate.end_seconds * 24 - 1e-7));
    }
    expect(plan.parameters.frame_rate).toBe(24);
  });

  it("rewards windows that open with a question or hook words", () => {
    const plan = fixture({ max_candidates: 50 });
    const question = plan.candidates.find((candidate) => candidate.hook_text.startsWith("Why do most editors"));
    const plain = plan.candidates.find((candidate) => candidate.hook_text.startsWith("Lumetri has scopes"));
    expect(question).toBeDefined();
    expect(question?.components.hook).toBeGreaterThan(0.5);
    expect(question?.reasons).toContain("Opens with a question");
    if (plain) expect(plain.components.hook).toBeLessThan(question!.components.hook);
  });

  it("boosts the evidence component for windows containing markers and laughter", () => {
    const single = { word_timeline: timelineFromSentences(["Lumetri has scopes that show exposure and saturation clearly.", "Always check the waveform before you trust your monitor."]), min_seconds: 6, max_seconds: 10 };
    const withoutEvidence = rankShortFormCandidates(single);
    expect(withoutEvidence.candidates).toHaveLength(1);
    const target = withoutEvidence.candidates[0];
    const middle = (target.start_seconds + target.end_seconds) / 2;
    const withEvidence = rankShortFormCandidates({ ...single, marker_seconds: [middle], laughter_seconds: [middle + 0.5, middle - 0.5], audio_energy_peaks: [middle + 1] });
    const boosted = withEvidence.candidates[0];
    expect(boosted.start_seconds).toBe(target.start_seconds);
    expect(target!.components.evidence).toBe(0);
    expect(boosted!.components.evidence).toBeGreaterThan(0);
    expect(boosted!.score).toBeGreaterThan(target!.score);
    expect(boosted!.reasons.some((reason) => reason.startsWith("Evidence inside window"))).toBe(true);
    expect(withEvidence.evidence.evidence_counts).toEqual({ audio_energy_peaks: 1, motion_peaks: 0, laughter_seconds: 2, marker_seconds: 1 });
    expect(withEvidence.warnings.some((warning) => warning.includes("No audio/motion"))).toBe(false);
    expect(withoutEvidence.warnings.some((warning) => warning.includes("No audio/motion"))).toBe(true);
  });

  it("rewards keyword hits including multi-word phrases", () => {
    const plan = fixture({ max_candidates: 50, keywords: ["proxy workflow", "Lumetri"] });
    const proxy = plan.candidates.find((candidate) => candidate.reasons.some((reason) => reason.includes("proxy workflow")));
    expect(proxy).toBeDefined();
    expect(proxy!.components.keyword).toBeGreaterThan(0);
    expect(plan.parameters.keywords).toEqual(["lumetri", "proxy workflow"]);
  });

  it("penalizes windows that span more than two speakers", () => {
    const sentences = [
      { text: "Alright let us get into the first big question today.", speaker: "A" },
      { text: "I think the answer is proxies honestly.", speaker: "B" },
      { text: "No way, it is keyboard shortcuts every single time.", speaker: "C" },
      { text: "Fine, we can agree that both matter a lot.", speaker: "A" },
      { text: "Now let us talk about color grading for a bit.", speaker: "A" },
      { text: "Scopes matter more than the monitor you own.", speaker: "A" },
      { text: "Skin tones sit on the vectorscope line always.", speaker: "A" },
      { text: "That is the entire trick and it works.", speaker: "A" },
    ];
    const plan = rankShortFormCandidates({ word_timeline: timelineFromSentences(sentences), min_seconds: 8, max_seconds: 20, max_candidates: 50 });
    const multi = plan.candidates.find((candidate) => candidate.speakers.length >= 3);
    const single = plan.candidates.find((candidate) => candidate.speakers.length === 1);
    expect(multi).toBeDefined();
    expect(single).toBeDefined();
    expect(multi!.components.speaker_consistency).toBeLessThan(single!.components.speaker_consistency);
    expect(multi!.reasons.some((reason) => reason.startsWith("Spans"))).toBe(true);
    expect(plan.evidence.speakers).toEqual(["A", "B", "C"]);
  });

  it("penalizes completeness when a window ends on a dangling conjunction at a pause", () => {
    const sentences = ["So the first thing you should know about proxies is that they are fast and", "they render in the background while you keep editing the timeline normally."];
    const plan = rankShortFormCandidates({ word_timeline: timelineFromSentences(sentences, { gap: 1.5, wps: 2 }), min_seconds: 5, max_seconds: 12, max_candidates: 50 });
    const dangling = plan.candidates.find((candidate) => candidate.reasons.some((reason) => reason.includes("dangling")));
    expect(dangling).toBeDefined();
    expect(dangling!.components.completeness).toBeLessThan(0.6);
  });

  it("produces a duration_fit of 1 at the centre of the range and lower at the extremes", () => {
    const plan = fixture({ max_candidates: 50 });
    const mid = (10 + 25) / 2;
    for (const candidate of plan.candidates) {
      const expected = Math.max(0, Math.min(1, 1 - Math.abs(candidate.duration_seconds - mid) / ((25 - 10) / 2)));
      expect(candidate.components.duration_fit).toBeCloseTo(expected, 2);
    }
  });

  it("returns an empty plan with a warning when nothing fits", () => {
    const plan = rankShortFormCandidates({ word_timeline: timelineFromSentences(["Hi there."]), min_seconds: 30, max_seconds: 40 });
    expect(plan.candidates).toEqual([]);
    expect(plan.windows_evaluated).toBe(0);
    expect(plan.warnings.some((warning) => warning.includes("No sentence window"))).toBe(true);
  });

  it("includes apply routes and evidence bound to the transcript", () => {
    const plan = fixture();
    const routeNames = plan.routes.flatMap((route) => route.routes);
    for (const name of ["create_subclip_uxp", "create_subclip", "preview_derived_dialogue_sequence_uxp", "search_workflow_recipes", "auto_reframe_sequence", "build_caption_artifact"]) expect(routeNames).toContain(name);
    expect(plan.routes.find((route) => route.step === "recipe")?.recipe_id).toBe("shorts-cutdown");
    expect(plan.evidence.transcript_revision).toBe(REVISION);
    expect(plan.evidence.source_project_item_id).toBe("item-long-video");
    expect(plan.evidence.word_count).toBeGreaterThan(150);
    expect(plan.assumptions.some((line) => line.includes("not a virality prediction"))).toBe(true);
  });

  it("truncates long hook text to 120 characters", () => {
    const long = `${"Imagine ".repeat(30)}this.`;
    const plan = rankShortFormCandidates({ word_timeline: timelineFromSentences([long, "Short follow up sentence here."], { wps: 4 }), min_seconds: 5, max_seconds: 20 });
    expect(plan.candidates[0]?.hook_text.length).toBeLessThanOrEqual(120);
  });

  it.each([
    [{ min_seconds: 4 }, /min_seconds/],
    [{ max_seconds: 400 }, /max_seconds/],
    [{ min_seconds: 60, max_seconds: 30 }, /min_seconds must not exceed/],
    [{ max_candidates: 2.5 }, /max_candidates must be an integer/],
    [{ max_candidates: 0 }, /max_candidates/],
    [{ frame_rate: 0 }, /frame_rate/],
    [{ frame_rate: "30" }, /frame_rate must be a finite number/],
    [{ hook_words: "why" }, /hook_words/],
    [{ hook_words: [""] }, /hook_words\[0\]/],
    [{ hook_words: Array.from({ length: 129 }, (_, index) => `w${index}`) }, /hook_words/],
    [{ keywords: [42] }, /keywords\[0\]/],
    [{ marker_seconds: [-1] }, /marker_seconds\[0\]/],
    [{ laughter_seconds: "12" }, /laughter_seconds/],
    [{ audio_energy_peaks: [Number.NaN] }, /audio_energy_peaks\[0\]/],
    [{ motion_peaks: Array.from({ length: 2001 }, () => 1) }, /motion_peaks/],
  ])("rejects invalid options %j", (overrides, message) => {
    expect(() => fixture(overrides)).toThrow(message);
  });

  it("rejects invalid word timelines", () => {
    expect(() => rankShortFormCandidates({ word_timeline: null })).toThrow(/word_timeline/);
    expect(() => rankShortFormCandidates({ word_timeline: { source_project_item_id: "x", transcript_revision: "nope", words: [] } })).toThrow(/transcript_revision/);
  });
});

describe("scoreHook", () => {
  const analyze = (text: string, extra?: string[]) => scoreHook({ text, tokens: text.split(/\s+/).map(normalizeToken).filter(Boolean) }, new Set(extra ?? []));

  it("detects questions", () => {
    const result = analyze("What happens when you skip proxies?");
    expect(result.reasons).toContain("Opens with a question");
    expect(result.score).toBeGreaterThanOrEqual(0.4);
  });

  it("detects imperative and second-person openers", () => {
    expect(analyze("Stop doing this in your edits.").reasons.some((reason) => reason.startsWith("Imperative opener"))).toBe(true);
    expect(analyze("You need to see this.").reasons).toContain("Addresses the viewer directly");
    expect(analyze("The timeline rendered overnight.").score).toBe(0);
  });

  it("detects numbers and lexicon words with a capped contribution", () => {
    const numeric = analyze("I saved 3 hours this week.");
    expect(numeric.reasons).toContain("Contains a number");
    const stacked = analyze("The secret mistake why everyone fails.");
    expect(stacked.reasons.some((reason) => reason.startsWith("Hook words:"))).toBe(true);
    expect(stacked.score).toBeLessThanOrEqual(1);
    expect(HOOK_LEXICON).toContain("secret");
  });

  it("honours caller-supplied hook words", () => {
    const withCustom = analyze("Proxies changed everything for me.", ["proxies"]);
    const without = analyze("Proxies changed everything for me.");
    expect(withCustom.score).toBeGreaterThan(without.score);
    expect(withCustom.reasons.some((reason) => reason.includes("proxies"))).toBe(true);
  });
});

describe("countInRange", () => {
  it("counts inclusive matches in a sorted list", () => {
    const sorted = [1, 2, 3, 5, 8, 13];
    expect(countInRange(sorted, 2, 5)).toBe(3);
    expect(countInRange(sorted, 0, 0.5)).toBe(0);
    expect(countInRange(sorted, 13, 13)).toBe(1);
    expect(countInRange(sorted, 9, 1)).toBe(0);
    expect(countInRange([], 0, 10)).toBe(0);
  });
});
