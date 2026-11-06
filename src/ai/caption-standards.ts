/**
 * src/ai/caption-standards.ts
 *
 * The caption standards (timing, reading speed, line limits) and the grammar
 * rules for where a line or caption may break. Shared by the planner
 * (caption-plan.ts / caption-rules.ts), the QA lint (caption-qa.ts) and the
 * exporters, so every tool judges a caption by the same numbers.
 *
 * Numbers are from the public style guides cited on each standard's `source`.
 * Pure: no file or Premiere access.
 */

export const CAPTION_STANDARD_IDS = ["netflix_adult", "netflix_kids", "bbc", "dcmp", "social_9x16"] as const;
export type CaptionStandardId = (typeof CAPTION_STANDARD_IDS)[number];

export interface CaptionStandard {
  id: CaptionStandardId;
  label: string;
  source: string;
  /** Characters per second, spaces and punctuation counted, line breaks not. */
  max_cps?: number;
  /** Words per minute (BBC, DCMP state reading speed in words). */
  max_wpm?: number;
  /** Seconds on screen per word at least (BBC: about 0.33). Checked with min_duration_s. */
  min_s_per_word?: number;
  max_cpl: number;
  max_lines: number;
  min_duration_s: number;
  max_duration_s: number;
  /** Frames between two captions at least (the eye needs a blank to see a change). */
  min_gap_frames: number;
  /** A gap shorter than this (seconds) but longer than min_gap is closed to min_gap: a flicker reads as a glitch. */
  close_gap_under_s: number;
  /** Seconds a caption may stay after its speech ends when nothing follows soon. */
  linger_s: number;
  /** Shot changes: an in-time is on the cut or at least this long before it; an out-time is min_gap before it or at least this long after. */
  cut_zone_s: number;
  /** Prefer the lower line longer in two-line captions. */
  bottom_heavy: boolean;
}

export const CAPTION_STANDARDS: Record<CaptionStandardId, CaptionStandard> = {
  netflix_adult: {
    id: "netflix_adult",
    label: "Netflix English (adult)",
    source: "https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide",
    max_cps: 20,
    max_cpl: 42,
    max_lines: 2,
    min_duration_s: 5 / 6,
    max_duration_s: 7,
    min_gap_frames: 2,
    close_gap_under_s: 0.5,
    linger_s: 0.5,
    cut_zone_s: 0.5,
    bottom_heavy: true,
  },
  netflix_kids: {
    id: "netflix_kids",
    label: "Netflix English (children's)",
    source: "https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide",
    max_cps: 17,
    max_cpl: 42,
    max_lines: 2,
    min_duration_s: 5 / 6,
    max_duration_s: 7,
    min_gap_frames: 2,
    close_gap_under_s: 0.5,
    linger_s: 0.5,
    cut_zone_s: 0.5,
    bottom_heavy: true,
  },
  bbc: {
    id: "bbc",
    label: "BBC subtitle guidelines",
    source: "https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/",
    max_wpm: 180,
    min_s_per_word: 0.33,
    max_cpl: 37,
    max_lines: 2,
    min_duration_s: 0.8,
    max_duration_s: 7,
    min_gap_frames: 2,
    // BBC: a gap left for a pause is at least 1 s (better 1.5 s); anything shorter is closed.
    close_gap_under_s: 1,
    linger_s: 0.5,
    cut_zone_s: 0.5,
    bottom_heavy: true,
  },
  dcmp: {
    id: "dcmp",
    label: "DCMP Captioning Key",
    source: "https://dcmp.org/learn/captioningkey",
    max_wpm: 160,
    max_cpl: 32,
    max_lines: 2,
    // 40 frames at 29.97 fps.
    min_duration_s: 40 / 29.97,
    max_duration_s: 6,
    min_gap_frames: 2,
    close_gap_under_s: 0.5,
    linger_s: 0.5,
    cut_zone_s: 0.5,
    bottom_heavy: true,
  },
  social_9x16: {
    id: "social_9x16",
    label: "Social vertical (9:16)",
    source: "house rule: short lines for a narrow frame; see the captions skill",
    max_cps: 20,
    max_cpl: 25,
    max_lines: 3,
    min_duration_s: 0.5,
    max_duration_s: 5,
    min_gap_frames: 2,
    close_gap_under_s: 0.5,
    linger_s: 0.5,
    cut_zone_s: 0.5,
    bottom_heavy: true,
  },
};

// ---------- grammar ----------

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

export const ARTICLES = set("a an the");
export const PREPOSITIONS = set(
  "about above across after against along among around at before behind below beneath beside between beyond by despite down during except for from in inside into near of off on onto out outside over past since through throughout to toward towards under underneath until unto up upon via with within without"
);
export const CONJUNCTIONS = set("and but or nor so yet because although though if unless while whereas than that whether");
export const AUXILIARIES = set(
  "am is are was were be been being have has had do does did will would shall should can could may might must i'm you're we're they're he's she's it's i've you've we've they've i'll you'll we'll they'll he'll she'll i'd you'd we'd they'd won't don't doesn't didn't can't couldn't wouldn't shouldn't isn't aren't wasn't weren't hasn't haven't hadn't"
);
export const SUBJECT_PRONOUNS = set("i you he she it we they who");
export const POSSESSIVES = set("my your his her its our their whose");

/** Lower case, without surrounding punctuation (keeps inner apostrophes: "don't"). */
export function bareWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

const capitalised = (w: string) => /^[\p{Lu}]/u.test(w.replace(/^[^\p{L}]+/u, ""));
const endsClause = (w: string) => /[.,;:!?…—-]["')\]]?$/.test(w);
const endsSentence = (w: string) => /[.!?…]["')\]]?$/.test(w);

/** Words that are capitalised only because a sentence or caption starts with them ("Today", "So"), never a name on their own. */
const SENTENCE_OPENERS = set(
  "so then now today yesterday tomorrow tonight here there this these those what when where why how who which well yes no yeah okay ok please thanks thank hello hi hey welcome first second third next finally also still just maybe again once after before later meanwhile however instead actually basically honestly sometimes always never every each some many most all both either neither one two three"
);

/** True when a capitalised word may be part of a name: not a function word, an opener or the pronoun I. */
function canBeName(w: string): boolean {
  if (!capitalised(w)) return false;
  const p = bareWord(w);
  if (p === "i" || p === "i'm" || p === "i've" || p === "i'll" || p === "i'd") return false;
  return !(ARTICLES.has(p) || PREPOSITIONS.has(p) || CONJUNCTIONS.has(p) || AUXILIARIES.has(p) || SUBJECT_PRONOUNS.has(p) || POSSESSIVES.has(p) || SENTENCE_OPENERS.has(p));
}

/**
 * Runs of two or more consecutive capitalised words that read as one name ("Land Rover", "Sarah Jones",
 * "Land Rover Defender"), as inclusive [first, last] word indexes. A capitalised word that only starts a
 * sentence or the caption ("Today we're", "So Sarah") is not part of a name unless a capitalised word follows
 * it; a run stops at a clause end (a comma, full stop ...). `words` is the text to judge by (its original case).
 */
export function properNounRuns(words: string[]): Array<[number, number]> {
  const n = words.length;
  const initial = (i: number) => i === 0 || endsSentence(words[i - 1]);
  const isName = (i: number): boolean => {
    if (!canBeName(words[i])) return false;
    if (!initial(i)) return true;
    // A sentence-initial capital is a name only when a capitalised word follows it in the same clause.
    return i + 1 < n && !endsClause(words[i]) && canBeName(words[i + 1]) && !initial(i + 1);
  };
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < n) {
    if (!isName(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && !endsClause(words[j]) && isName(j + 1)) j++;
    if (j > i) runs.push([i, j]);
    i = j + 1;
  }
  return runs;
}

/** Words that read as the unit of a number ("10 km", "5 pm", "3 dollars"), lower case. */
const UNITS = set(
  "km m cm mm kg g mg lb lbs oz mph kph km/h am pm % percent s ms sec secs second seconds min mins minute minutes h hr hrs hour hours day days week weeks month months year years degrees degree bn k x kb mb gb tb hz khz mhz ghz dollars dollar pounds pound euros euro pence cents cent bucks quid million billion trillion thousand hundred miles mile feet foot inches inch metres meters kilometres kilometers litres liters"
);

/** A number followed by its unit: they stay together. Any other short word after a number is not a unit. */
function numberUnit(prev: string, next: string): boolean {
  if (!/^\d[\d.,:]*$/.test(bareWord(prev))) return false;
  const u = next
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, "");
  return UNITS.has(u);
}

/**
 * The cost of breaking a line (or a caption) after `prev` and before `next`.
 * 0 is a clean break (after punctuation); higher is worse. A break the style
 * guides forbid outright (after an article, between a first name and a surname)
 * costs most. `kind` "caption" weighs the same rules a little higher: a caption
 * break splits the thought across time, not just across a line.
 */
export function breakPenalty(prev: string, next: string | undefined, kind: "line" | "caption" = "line"): number {
  if (next === undefined) return 0;
  if (endsClause(prev)) return 0;
  const p = bareWord(prev);
  let cost = 1; // any break mid-phrase costs a little
  if (ARTICLES.has(p) || POSSESSIVES.has(p)) cost = 10;
  else if (PREPOSITIONS.has(p)) cost = 7;
  else if (CONJUNCTIONS.has(p)) cost = 6;
  else if (AUXILIARIES.has(p)) cost = 6;
  else if (SUBJECT_PRONOUNS.has(p) && p !== "it" && p !== "you") cost = 5;
  // First name before surname: two capitalised words, neither sentence-initial punctuation.
  if (capitalised(prev) && capitalised(next) && canBeName(prev)) cost = Math.max(cost, 8);
  // A number and its unit ("10 km", "5 pm") stay together.
  if (numberUnit(prev, next)) cost = Math.max(cost, 8);
  return kind === "caption" ? cost * 1.5 : cost;
}

/** A line or caption ending on this word breaks a grammar rule (for warnings and QA). */
export function isWeakEnd(prev: string, next: string | undefined): boolean {
  return breakPenalty(prev, next) >= 5;
}

/** The grammar rule a weak break breaks, for QA messages. */
export function weakEndReason(prev: string, next: string | undefined): string | undefined {
  if (next === undefined || endsClause(prev)) return undefined;
  const p = bareWord(prev);
  if (ARTICLES.has(p)) return "ends on an article";
  if (POSSESSIVES.has(p)) return "ends on a possessive";
  if (PREPOSITIONS.has(p)) return "ends on a preposition";
  if (CONJUNCTIONS.has(p)) return "ends on a conjunction";
  if (AUXILIARIES.has(p)) return "ends on an auxiliary verb";
  if (SUBJECT_PRONOUNS.has(p) && p !== "it" && p !== "you") return "splits a subject pronoun from its verb";
  if (capitalised(prev) && capitalised(next) && canBeName(prev)) return "splits a name";
  if (numberUnit(prev, next)) return "splits a number from its unit";
  return undefined;
}

// ---------- reading speed ----------

/** Characters per second of a caption: its lines joined with a space. */
export function cpsOf(lines: string[], start: number, end: number): number {
  return lines.join(" ").length / Math.max(end - start, 0.001);
}

export function wpmOf(lines: string[], start: number, end: number): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return (words * 60) / Math.max(end - start, 0.001);
}

// ---------- speakers ----------

/** BBC order for speaker colours. */
export const SPEAKER_COLORS = ["#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00"] as const;

/** A compact, plain-data view of the standards table, for guidance tools. */
export function describeCaptionStandards(): Array<{
  id: CaptionStandardId;
  label: string;
  source: string;
  max_cps?: number;
  max_wpm?: number;
  min_s_per_word?: number;
  max_cpl: number;
  max_lines: number;
  min_duration_s: number;
  max_duration_s: number;
  min_gap_frames: number;
  close_gaps_under_s: number;
  linger_s: number;
  notes: string[];
}> {
  return CAPTION_STANDARD_IDS.map((id) => {
    const s = CAPTION_STANDARDS[id];
    const notes: string[] = [];
    if (s.max_cps !== undefined) notes.push(`Reading speed limit ${s.max_cps} characters per second (spaces and punctuation count).`);
    if (s.max_wpm !== undefined) notes.push(`Reading speed limit ${s.max_wpm} words per minute.`);
    if (s.min_s_per_word !== undefined) notes.push(`At least ${s.min_s_per_word} s on screen per word.`);
    notes.push(`Gaps shorter than ${s.close_gap_under_s} s (but longer than ${s.min_gap_frames} frames) close to ${s.min_gap_frames} frames.`);
    notes.push(`In-times sit on a shot change or at least ${s.cut_zone_s} s before it.`);
    if (s.bottom_heavy) notes.push("In two-line captions the lower line is the longer.");
    if (id === "social_9x16") notes.push("House rule, not a published standard: short lines for a narrow frame.");
    return {
      id,
      label: s.label,
      source: s.source,
      ...(s.max_cps !== undefined ? { max_cps: s.max_cps } : {}),
      ...(s.max_wpm !== undefined ? { max_wpm: s.max_wpm } : {}),
      ...(s.min_s_per_word !== undefined ? { min_s_per_word: s.min_s_per_word } : {}),
      max_cpl: s.max_cpl,
      max_lines: s.max_lines,
      min_duration_s: Math.round(s.min_duration_s * 1000) / 1000,
      max_duration_s: s.max_duration_s,
      min_gap_frames: s.min_gap_frames,
      close_gaps_under_s: s.close_gap_under_s,
      linger_s: s.linger_s,
      notes,
    };
  });
}
