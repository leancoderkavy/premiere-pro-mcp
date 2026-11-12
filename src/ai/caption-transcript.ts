/**
 * src/ai/caption-transcript.ts
 *
 * Transcript parsing for the caption planner: SRT, WebVTT and JSON (ElevenLabs
 * Scribe, Whisper-style segments, a plain array of {text, start, end}, and
 * Premiere Pro's native transcript JSON), plus the repo's word_timeline shape.
 * Pure: the tool layer reads files and passes text in.
 */
import type { CaptionTranscriptFormat, CaptionTranscriptSegment, CaptionTranscriptWord } from "./caption-plan-types.js";
import type { WordTimeline } from "./word-timeline.js";

type TranscriptWord = CaptionTranscriptWord;
type TranscriptSegment = CaptionTranscriptSegment;
type TranscriptFormat = CaptionTranscriptFormat;

export class CaptionTranscriptError extends Error {}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** "01:02:03,456", "01:02:03.456", "02:03.456" or "123.4" to seconds. */
export function parseTimecode(s: string): number {
  const t = s.trim().replace(",", ".");
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) {
    throw new CaptionTranscriptError(`Bad timecode "${s}"`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

/** Decodes the HTML entities subtitle files carry (&amp; &lt; &gt; &quot; &#39; &nbsp; &#x27; ...) in one pass, so &amp;lt; stays "&lt;". */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return code === 0xa0 ? " " : String.fromCodePoint(code);
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

/** One line of cue text as shown: markup tags (<i>, <c.x>, <00:01.000>) and ASS overrides ({\an8}) removed, entities decoded. */
export function cleanCueLine(line: string): string {
  // Consume each complete markup region once, including nested delimiters.
  // A single regex replacement can expose a new tag (<scr<script>ipt>).
  let text = "";
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "<") {
      // Unclosed literal text (for example "Tom <3") is not a markup region.
      if (depth === 0 && line.indexOf(">", i + 1) === -1) {
        text += line.slice(i);
        break;
      }
      depth++;
    } else if (char === ">" && depth > 0) {
      depth--;
    } else if (depth === 0) {
      text += char;
    }
  }
  return decodeEntities(text.replace(/\{\\[^}]*\}/g, ""));
}

/** Matches "NAME: text" at the start of a cue body. */
const SPEAKER_PREFIX = /^([A-Z][\w .'-]{0,30}):\s+(.+)$/s;

/** All capitals ("ANNA", "DR. SMITH"): the usual way subtitle exports write a speaker. */
const isAllCaps = (name: string) => /[A-Z]/.test(name) && name === name.toUpperCase();

/** The text of a cue body as shown: tags and ASS overrides removed, entities decoded, lines trimmed. */
export function cleanCueText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => cleanCueLine(l).trim())
    .filter(Boolean)
    .join("\n");
}

/** Splits a VTT cue body at its `<v Name>` voice spans: [{speaker, text}] with cleaned text; text before the first span has no speaker. */
function splitVoices(raw: string): Array<{ speaker?: string; text: string }> {
  const tag = /<v(?:\.[^\s>]*)?\s+([^>]*)>/gi;
  const parts: Array<{ speaker?: string; text: string }> = [];
  let last = 0;
  let speaker: string | undefined;
  for (let m = tag.exec(raw); m; m = tag.exec(raw)) {
    parts.push({ ...(speaker !== undefined ? { speaker } : {}), text: cleanCueText(raw.slice(last, m.index)) });
    speaker = decodeEntities(m[1]).trim() || undefined;
    last = m.index + m[0].length;
  }
  parts.push({ ...(speaker !== undefined ? { speaker } : {}), text: cleanCueText(raw.slice(last)) });
  return parts;
}

function parseCueBlocks(text: string, isVtt: boolean): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  // "NAME: text" prefix candidates, decided once the whole file is read.
  const candidates: Array<{ seg: TranscriptSegment; name: string; rest: string }> = [];
  let untagged = 0;
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const arrow = lines.findIndex((l) => l.includes("-->"));
    if (arrow < 0) continue;
    const [a, rest] = lines[arrow].split("-->");
    // VTT cue settings follow the end time ("00:02.000 align:start").
    const b = rest.trim().split(/\s+/)[0];
    const rawBody = lines.slice(arrow + 1).join("\n");
    const start = parseTimecode(a);
    const end = parseTimecode(b);
    // VTT voice spans "<v Name>text</v>": each speaker's text becomes a segment of its own, sharing the cue's time by character count.
    const parts = isVtt ? splitVoices(rawBody) : [{ text: cleanCueText(rawBody) }];
    const voiced = parts.filter((p) => p.text);
    if (!voiced.length) continue;
    if (voiced.length === 1 && voiced[0].speaker === undefined) {
      const body = voiced[0].text;
      const seg: TranscriptSegment = { text: body, start, end };
      untagged++;
      const m = SPEAKER_PREFIX.exec(body);
      if (m) candidates.push({ seg, name: m[1].trim(), rest: m[2].trim() });
      out.push(seg);
      continue;
    }
    const total = voiced.reduce((n, p) => n + p.text.length, 0) || 1;
    let t = start;
    voiced.forEach((p, i) => {
      const e = i === voiced.length - 1 ? end : t + ((end - start) * p.text.length) / total;
      out.push({ text: p.text, start: t, end: e, ...(p.speaker ? { speaker: p.speaker } : {}) });
      t = e;
    });
  }
  // A prefix is a speaker when it is all caps, or when most cues in the file carry a
  // prefix and this one repeats. Otherwise "Note: ..." or "Step 1: ..." keeps its text.
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const mostlyPrefixed = candidates.length * 2 > untagged;
  for (const c of candidates) {
    if (isAllCaps(c.name) || (mostlyPrefixed && (counts.get(c.name) ?? 0) >= 2)) {
      c.seg.speaker = c.name;
      c.seg.text = c.rest;
    }
  }
  return out;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** The end of a timed entry: `end`, else `start + duration` (Premiere's transcript JSON gives a duration). */
function timeEnd(o: Record<string, unknown>, start: number | undefined): number | undefined {
  const end = num(o.end);
  if (end !== undefined) return end;
  const d = num(o.duration);
  return start !== undefined && d !== undefined ? start + d : undefined;
}

function wordsFrom(list: unknown[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    // Premiere's own transcript JSON can carry punctuation as separate tokens: glue it to the word before.
    if (o.type === "punctuation") {
      const p = String(o.text ?? o.word ?? "").trim();
      if (p && words.length) words[words.length - 1].text += p;
      continue;
    }
    // ElevenLabs marks gaps and sounds with type "spacing" / "audio_event".
    if (o.type !== undefined && o.type !== "word") continue;
    const text = String(o.text ?? o.word ?? "").trim();
    const start = num(o.start);
    const end = timeEnd(o, start);
    if (!text || start === undefined || end === undefined) continue;
    const speaker = o.speaker_id ?? o.speaker;
    words.push({ text, start, end, ...(speaker !== undefined && speaker !== null ? { speaker: String(speaker) } : {}) });
  }
  return words;
}

/** ElevenLabs `audio_event` entries: "(laughter)", "(music)". Kept for the captions path only. */
function eventsFrom(list: unknown[]): TranscriptWord[] {
  const events: TranscriptWord[] = [];
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (o.type !== "audio_event") continue;
    const text = String(o.text ?? o.word ?? "").trim();
    const start = num(o.start);
    const end = timeEnd(o, start);
    if (!text || start === undefined || end === undefined) continue;
    const speaker = o.speaker_id ?? o.speaker;
    events.push({ text, start, end, ...(speaker !== undefined && speaker !== null ? { speaker: String(speaker) } : {}) });
  }
  return events;
}

/** Groups words into segments at a speaker change or a pause longer than `gap` seconds. */
export function segmentWords(words: TranscriptWord[], gap = 0.8): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      text: cur.map((w) => w.text).join(" "),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      ...(cur[0].speaker !== undefined ? { speaker: cur[0].speaker } : {}),
      words: cur,
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.speaker !== prev.speaker || w.start - prev.end > gap)) flush();
    cur.push(w);
  }
  flush();
  return out;
}

function speakerNames(data: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(data.speakers)) return map;
  for (const sp of data.speakers) {
    if (!sp || typeof sp !== "object") continue;
    const o = sp as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (o.id !== undefined && o.id !== null && name) map.set(String(o.id), name);
  }
  return map;
}

function parseJson(text: string): TranscriptSegment[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new CaptionTranscriptError(`Transcript is not valid JSON: ${(err as Error).message}`);
  }
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (Array.isArray(data)) {
    const segs: TranscriptSegment[] = [];
    for (const s of data) {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const start = num(o.start);
      const end = timeEnd(o, start);
      const t = String(o.text ?? o.word ?? "").trim();
      if (t && start !== undefined && end !== undefined) {
        const speaker = o.speaker ?? o.speaker_id;
        segs.push({ text: t, start, end, ...(speaker !== undefined && speaker !== null ? { speaker: String(speaker) } : {}) });
      }
    }
    return segs;
  }
  if (Array.isArray(obj.segments)) {
    const topWords = Array.isArray(obj.words) ? wordsFrom(obj.words as unknown[]) : [];
    const segmentHasWords = (obj.segments as unknown[]).some((s) => s && typeof s === "object" && Array.isArray((s as Record<string, unknown>).words) && ((s as Record<string, unknown>).words as unknown[]).length > 0);
    // Whisper verbose_json with word timestamps: `words` at the top level, `segments` without words. Those exact times
    // beat estimating, so each word goes to the segment it starts in.
    if (topWords.length && !segmentHasWords) return segmentsWithTopWords(obj, topWords);
    // Whisper-style segments, and Premiere Pro's exported transcript JSON:
    //   { language, segments: [{ start, duration, speaker, words: [{ text, start, duration, confidence, eos, tags, type }] }],
    //     speakers: [{ id, name }] }  (seconds). That shape is from Premiere's exported transcript JSON and is unverified
    // against every host version, so every field is optional here: a missing field is treated as absent.
    const names = speakerNames(obj);
    const named = (v: string | undefined) => (v === undefined ? undefined : (names.get(v) ?? v));
    return (obj.segments as unknown[]).flatMap((s) => {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const words = Array.isArray(o.words) ? wordsFrom(o.words as unknown[]) : undefined;
      const events = Array.isArray(o.words) ? eventsFrom(o.words as unknown[]) : [];
      const start = num(o.start) ?? words?.[0]?.start;
      const end = (start === undefined ? undefined : timeEnd(o, start)) ?? words?.[words.length - 1]?.end;
      if (start === undefined || end === undefined) return [];
      const rawSpeaker = o.speaker ?? o.speaker_id;
      const speaker = named(rawSpeaker !== undefined && rawSpeaker !== null ? String(rawSpeaker) : undefined);
      const joined = words && words.length ? words.map((w) => w.text).join(" ") : "";
      return [
        {
          text: String(o.text ?? joined).trim(),
          start,
          end,
          ...(speaker !== undefined ? { speaker } : {}),
          ...(words && words.length ? { words: words.map((w) => (w.speaker !== undefined ? { ...w, speaker: named(w.speaker) } : w)) } : {}),
          ...(events.length ? { sound_events: events } : {}),
        },
      ];
    });
  }
  if (Array.isArray(obj.words)) {
    const segs = segmentWords(wordsFrom(obj.words as unknown[]));
    // Each sound event goes with the last segment that started before it (the first, when none did).
    for (const ev of eventsFrom(obj.words as unknown[])) {
      let host = segs[0];
      for (const sg of segs) if (sg.start <= ev.start) host = sg;
      if (host) (host.sound_events ??= []).push(ev);
    }
    return segs;
  }
  throw new CaptionTranscriptError("JSON transcript needs `words`, `segments`, or an array of {text, start, end}");
}

/** Whisper verbose_json: top-level `words` (exact times) placed in the `segments` they start in; a segment with no word keeps its text. */
function segmentsWithTopWords(obj: Record<string, unknown>, topWords: TranscriptWord[]): TranscriptSegment[] {
  const names = speakerNames(obj);
  const named = (v: string | undefined) => (v === undefined ? undefined : (names.get(v) ?? v));
  const segs = (obj.segments as unknown[]).flatMap((s) => {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const start = num(o.start);
    const end = start === undefined ? undefined : timeEnd(o, start);
    if (start === undefined || end === undefined) return [];
    const rawSpeaker = o.speaker ?? o.speaker_id;
    const speaker = named(rawSpeaker !== undefined && rawSpeaker !== null ? String(rawSpeaker) : undefined);
    return [{ seg: { text: String(o.text ?? "").trim(), start, end, ...(speaker !== undefined ? { speaker } : {}) } as TranscriptSegment, words: [] as TranscriptWord[] }];
  });
  if (!segs.length) return segmentWords(topWords);
  for (const w of topWords) {
    let host = segs.find((x) => w.start >= x.seg.start - 1e-6 && w.start < x.seg.end - 1e-6);
    if (!host) {
      host = segs[0];
      for (const x of segs) if (x.seg.start <= w.start) host = x;
    }
    host.words.push(w.speaker !== undefined ? { ...w, speaker: named(w.speaker) } : w);
  }
  const events = eventsFrom(obj.words as unknown[]);
  return segs.map(({ seg, words }) => {
    if (!words.length) return seg;
    const evs = events.filter((e) => e.start >= seg.start - 1e-6 && e.start < seg.end - 1e-6);
    return { ...seg, text: seg.text || words.map((w) => w.text).join(" "), words, ...(evs.length ? { sound_events: evs } : {}) };
  });
}

/**
 * The media duration a JSON transcript states at its top level (Whisper verbose_json `duration`, ElevenLabs
 * `audio_duration_secs`), in transcript seconds; undefined for SRT/VTT, a bare array or a file without one.
 * Never a segment's own duration.
 */
export function transcriptDurationSeconds(text: string, format?: TranscriptFormat): number | undefined {
  const f = format ?? detectFormat(text);
  if (f !== "json") return undefined;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const o = data as Record<string, unknown>;
  for (const key of ["audio_duration_secs", "audio_duration", "duration", "duration_s", "duration_seconds"]) {
    const v = num(o[key]);
    if (v !== undefined && v > 0) return v;
  }
  return undefined;
}

/** SRT, VTT or JSON from a file name hint, else from the content. */
export function detectFormat(text: string, hint?: string): TranscriptFormat {
  const h = (hint ?? "").toLowerCase();
  if (h.endsWith("srt")) return "srt";
  if (h.endsWith("vtt")) return "vtt";
  if (h.endsWith("json")) return "json";
  const t = text.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("WEBVTT")) return "vtt";
  return "srt";
}

export function parseTranscript(text: string, format?: TranscriptFormat): TranscriptSegment[] {
  const f = format ?? detectFormat(text);
  const segs = f === "json" ? parseJson(text) : parseCueBlocks(text, f === "vtt");
  if (!segs.length) throw new CaptionTranscriptError(`No timed lines found in the ${f.toUpperCase()} transcript`);
  return segs.sort((a, b) => a.start - b.start);
}

/**
 * parseTranscript for the captions path. A JSON transcript holding only sound events (ElevenLabs
 * `audio_event` entries, no words) is not an error here: it comes back as one segment with no
 * words and the events, which buildCaptions turns into sound captions. Marker cues keep using
 * parseTranscript, which still refuses such a file.
 */
export function parseCaptionTranscript(text: string, format?: TranscriptFormat): TranscriptSegment[] {
  try {
    return parseTranscript(text, format);
  } catch (err) {
    const f = format ?? detectFormat(text);
    if (f !== "json") throw err;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw err;
    }
    const list = Array.isArray(data) ? data : Array.isArray((data as Record<string, unknown>)?.words) ? ((data as Record<string, unknown>).words as unknown[]) : [];
    const events = eventsFrom(list).sort((a, b) => a.start - b.start);
    if (!events.length) throw err;
    return [{ text: "", start: events[0].start, end: Math.max(...events.map((e) => e.end)), sound_events: events }];
  }
}

function wordsOf(seg: TranscriptSegment): TranscriptSegment[] {
  if (seg.words && seg.words.length) return seg.words.map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker ?? seg.speaker }));
  // No word timings: spread the words across the segment by character share.
  const words = seg.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length, 0) || 1;
  const span = seg.end - seg.start;
  let t = seg.start;
  return words.map((w) => {
    const d = (span * w.length) / total;
    const s = { text: w, start: t, end: t + d, speaker: seg.speaker };
    t += d;
    return s;
  });
}

/** A segment's words with times; words without their own times are spread over the segment by character share. */
export function timedWords(seg: TranscriptSegment): { words: TranscriptWord[]; estimated: boolean } {
  const estimated = !(seg.words && seg.words.length);
  const raw: TranscriptWord[] = wordsOf(seg).map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    ...(w.speaker !== undefined ? { speaker: w.speaker } : {}),
  }));
  // AE counts words by whitespace, so a "word" holding spaces becomes several, sharing its time.
  const out: TranscriptWord[] = [];
  for (const w of raw) {
    const parts = w.text.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      if (parts.length === 1) out.push({ ...w, text: parts[0] });
      continue;
    }
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let t = w.start;
    for (const p of parts) {
      const d = ((w.end - w.start) * p.length) / total;
      out.push({ ...w, text: p, start: t, end: t + d });
      t += d;
    }
  }
  return { words: out, estimated };
}


/** The repo's word_timeline (source seconds) as one transcript segment per speaker turn or pause. */
export function segmentsFromWordTimeline(timeline: WordTimeline): CaptionTranscriptSegment[] {
  const words: TranscriptWord[] = timeline.words.map((w) => ({
    text: w.text,
    start: w.start_seconds,
    end: w.end_seconds,
    ...(w.speaker_label !== undefined ? { speaker: w.speaker_label } : {}),
  }));
  const segs = segmentWords(words);
  if (!segs.length) throw new CaptionTranscriptError("The word timeline has no words");
  return segs;
}
