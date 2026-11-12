/**
 * src/ai/caption-cleanup.ts
 *
 * Transcript clean-up, run on the words before they are grouped into captions
 * (buildCaptionPlan in caption-plan.ts). Pure: words in, words and a report out.
 *
 * Words are in transcript time (before the caption offset). The default-on
 * clean-ups (music tokens, words under 0.05 s) run only when a `cleanup`
 * object is passed at all, so a plan without it behaves exactly as before.
 */
import type { CaptionTranscriptWord, CleanupOptions, CleanupReport } from "./caption-plan-types.js";
import { bareWord } from "./caption-standards.js";

export type { CleanupOptions };

/** A transcript word plus what the planner needs to remember about it while it is cleaned. */
export interface CleanWord extends CaptionTranscriptWord {
  /** First word of a subtitle cue (SRT/VTT): a new caption starts here. */
  cue_start?: boolean;
  /** The word time is a guess (spread over a cue by character share), not the voice's. */
  estimated?: boolean;
  /** The original text ended a sentence; set by clean-up so stripping punctuation does not lose it. */
  sentence_end?: boolean;
  /** The text as it was before case and punctuation changes: grammar-aware breaks read this. */
  gram?: string;
}

export const DEFAULT_FILLERS = ["um", "uh", "erm", "er", "ah", "hmm", "mm", "mhm", "uhm"];

export const SENTENCE_END_RE = /[.!?…]["')\]]?$/;
const TRAIL_PUNCT = /([.,;:!?…]+["')\]]?)$/;

export const emptyReport = (): CleanupReport => ({
  dropped_after_end: 0,
  dropped_music_tokens: 0,
  dropped_short: 0,
  fillers_removed: 0,
  stutters_removed: 0,
  glossary_replacements: 0,
});

/** The word without edge punctuation; case kept unless `fold`. */
function core(s: string, fold: boolean): string {
  const t = s.replace(/[‘’]/g, "'").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
  return fold ? t.toLowerCase() : t;
}

/** A dropped word hands its "starts a cue" mark to the next word that survives. */
export class Out {
  words: CleanWord[] = [];
  private carry = false;
  push(w: CleanWord) {
    if (this.carry && !w.cue_start) w = { ...w, cue_start: true };
    this.carry = false;
    this.words.push(w);
  }
  drop(w: CleanWord) {
    if (w.cue_start) this.carry = true;
  }
  get last(): CleanWord | undefined {
    return this.words[this.words.length - 1];
  }
}

const sameSpeaker = (a: CleanWord, b: CleanWord) => a.speaker === b.speaker;

/** Words said twice on purpose, for emphasis: "no, no", "very, very". A comma between them keeps both. */
const EMPHATIC = new Set(["no", "yes", "yeah", "ok", "okay", "oh", "hey", "wait", "please", "very", "really", "never", "sorry", "thanks", "stop", "go", "come", "hello", "hi", "bye", "more", "so", "ha", "ho"]);

/** Words that are correct twice in a row ("I know that that is true", "he had had enough") when no comma separates them. */
const LEGIT_REPEATS = new Set(["that", "had"]);

/** "i.e." and "e.g." end in a full stop but not a sentence. */
const ABBREVIATION = /^[^\p{L}\p{N}]*(?:i\.e|e\.g)\.?["')\]]?$/iu;

function isFragment(prev: CleanWord, next: CleanWord): boolean {
  if (!sameSpeaker(prev, next)) return false;
  const pb = bareWord(prev.text);
  const nb = bareWord(next.text);
  if (!pb || !nb || /^\d+$/.test(pb)) return false;
  // "I- I", "th- the": a cut-off start, then the word.
  if (/[-–—]$/.test(prev.text.trim())) return nb === pb || nb.startsWith(pb);
  // "the, the" and "the the": a repeat. Not across a sentence end or ; : ("no, no" is meant, so a repeated emphatic word stays).
  const trail = prev.text.trim();
  if (/[.!?…;:]["')\]]?$/.test(trail)) return false;
  const comma = /,["')\]]?$/.test(trail);
  if (comma && EMPHATIC.has(pb)) return false;
  if (!comma && LEGIT_REPEATS.has(pb)) return false;
  return pb === nb;
}

function titleCaseFirst(s: string): string {
  return s.replace(/\p{L}/u, (m) => m.toUpperCase());
}

/**
 * Strips punctuation from one token. Edges lose everything but symbols that belong to a number or
 * amount ($ £ € %). Inside, characters that join two parts are kept or turned into a split, never
 * deleted (deleting glued "well—known" into "wellknown"):
 * - an em or en dash becomes a hyphen ("well-known"); hyphens and apostrophes stay;
 * - "/" between letters or digits stays ("and/or"); a single "." between letters stays ("U.S");
 * - a run of dots, an ellipsis, or , : ; ! ? between letters splits the token into two words
 *   (the caller shares the word's time between them by character count);
 * - the separators of numbers (3.5, 1,000, 9:30) stay; anything else is dropped.
 */
function stripPunct(text: string): string {
  let t = text.replace(/^[^\p{L}\p{N}$£€]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
  t = t.replace(/[–—―]+/g, "-");
  t = t.replace(/[.…]{2,}|[…;!?]/gu, " ");
  t = t.replace(/(?<=[\p{L}])[,:]+(?=[\p{L}])/gu, " ");
  t = t.replace(/[^\p{L}\p{N}'’\-$£€%.,:/ ]/gu, "");
  t = t.replace(/(?<![\p{L}\p{N}])[.,:/]+|[.,:/]+(?![\p{L}\p{N}])/gu, "");
  t = t.replace(/(?<=\p{L})[,:]+(?=\p{N})|(?<=\p{N})[,:]+(?=\p{L})/gu, " ");
  t = t.replace(/(^|\s)-+|-+(?=\s|$)/g, "$1").replace(/-{2,}/g, "-");
  return t.replace(/\s+/g, " ").trim();
}

/** Splits a replacement holding spaces into words that share the span in proportion to length. */
function spreadWords(base: CleanWord, text: string): CleanWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts.length ? [{ ...base, text: parts[0] }] : [];
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  const out: CleanWord[] = [];
  let t = base.start;
  parts.forEach((p, i) => {
    const d = ((base.end - base.start) * p.length) / total;
    const w: CleanWord = { ...base, text: p, start: t, end: i === parts.length - 1 ? base.end : t + d };
    if (i > 0) delete w.cue_start;
    out.push(w);
    t += d;
  });
  return out;
}

/**
 * Cleans the words in this order: words after `drop_after_s`, music tokens, very short words,
 * fillers, stutters, glossary, then case and punctuation (which keep the original sentence ends
 * and wording in `sentence_end` and `gram`).
 *
 * `case: "sentence"` is deliberately simple: everything is lower-cased, then the first letter of
 * each sentence and the word "I" (also I'm, I'll ...) are capitalised. Acronyms and names the
 * transcript capitalised are lost; use the glossary to put them back (it runs first).
 */
export function cleanupWords(input: CleanWord[], opts: CleanupOptions): { words: CleanWord[]; report: CleanupReport } {
  const report = emptyReport();
  let words = input.map((w) => ({ ...w }));

  const filterWords = (keep: (w: CleanWord) => boolean, count: (n: number) => void) => {
    const o = new Out();
    for (const w of words) {
      if (keep(w)) o.push(w);
      else {
        o.drop(w);
        count(1);
      }
    }
    words = o.words;
  };

  if (opts.drop_after_s !== undefined) {
    const limit = opts.drop_after_s;
    filterWords(
      (w) => w.start < limit,
      (n) => (report.dropped_after_end += n)
    );
  }

  if (opts.drop_music_tokens !== false) {
    filterWords(
      (w) => /[\p{L}\p{N}]/u.test(w.text),
      (n) => (report.dropped_music_tokens += n)
    );
  }

  const minWord = opts.min_word_s ?? 0.05;
  if (minWord > 0) {
    filterWords(
      (w) => w.estimated === true || w.end - w.start >= minWord - 1e-9,
      (n) => (report.dropped_short += n)
    );
  }

  if (opts.remove_fillers) {
    const fillers = new Set((opts.filler_words ?? DEFAULT_FILLERS).map((f) => bareWord(f)).filter(Boolean));
    const o = new Out();
    // "Um, we left.": a filler that opened a sentence hands its capital to the next word.
    let capNext = false;
    for (const w of words) {
      if (fillers.has(bareWord(w.text))) {
        o.drop(w);
        report.fillers_removed++;
        const prev = o.last;
        const opensSentence = !prev || /[.!?…]["')\]]?$/.test(prev.text.trim());
        if (opensSentence && /^[^\p{L}]*\p{Lu}/u.test(w.text)) capNext = true;
        // "Well um, then": the comma belongs to the word before.
        const trail = TRAIL_PUNCT.exec(w.text.trim())?.[1];
        if (trail && prev && !TRAIL_PUNCT.test(prev.text.trim())) prev.text += trail;
      } else {
        o.push(capNext ? { ...w, text: w.text.replace(/\p{Ll}/u, (c) => c.toUpperCase()) } : w);
        capNext = false;
      }
    }
    words = o.words;
  }

  if (opts.remove_stutters) {
    const o = new Out();
    for (const w of words) {
      const prev = o.last;
      if (prev && isFragment(prev, w)) {
        // The later word is the one meant: its text and end, from where the stutter began.
        o.words[o.words.length - 1] = { ...w, start: prev.start, ...(prev.cue_start ? { cue_start: true } : {}) };
        report.stutters_removed++;
      } else o.push(w);
    }
    words = o.words;
  }

  for (const g of opts.glossary ?? []) {
    const tokens = g.find.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const fold = !g.case_sensitive;
    const want = tokens.map((t) => core(t, fold));
    const o = new Out();
    for (let i = 0; i < words.length; i++) {
      let match = i + tokens.length <= words.length;
      for (let k = 0; match && k < tokens.length; k++) {
        if (core(words[i + k].text, fold) !== want[k] || (k > 0 && !sameSpeaker(words[i], words[i + k]))) match = false;
      }
      if (!match) {
        o.push(words[i]);
        continue;
      }
      const first = words[i];
      const lastW = words[i + tokens.length - 1];
      const lead = /^[^\p{L}\p{N}]*/u.exec(first.text)?.[0] ?? "";
      const trail = /[^\p{L}\p{N}']*$/u.exec(lastW.text)?.[0] ?? "";
      report.glossary_replacements++;
      if (g.replace.trim() === "") {
        for (let k = 0; k < tokens.length; k++) o.drop(words[i + k]);
      } else {
        const merged: CleanWord = { ...first, text: lead + g.replace.trim() + trail, end: lastW.end };
        for (const w of spreadWords(merged, merged.text)) o.push(w);
      }
      i += tokens.length - 1;
    }
    words = o.words;
  }

  // Sentence ends and the grammar text are read before case and punctuation change.
  for (const w of words) {
    w.sentence_end = SENTENCE_END_RE.test(w.text) && !ABBREVIATION.test(w.text);
    w.gram = w.text;
  }

  if (opts.case === "upper") {
    for (const w of words) w.text = w.text.toUpperCase();
  } else if (opts.case === "sentence") {
    words.forEach((w, i) => {
      let t = w.text.toLowerCase();
      t = t.replace(/^(\W*)i(?=$|['’]|[^\p{L}\p{N}])(?!\.e\b)/u, (_m, p1: string) => p1 + "I");
      if (i === 0 || words[i - 1].sentence_end) t = titleCaseFirst(t);
      w.text = t;
    });
  }

  if (opts.strip_punctuation) {
    const o = new Out();
    for (const w of words) {
      const t = stripPunct(w.text);
      if (!t) o.drop(w);
      else for (const part of spreadWords(w, t)) o.push(part);
    }
    words = o.words;
  }

  return { words, report };
}
