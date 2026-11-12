/**
 * src/ai/caption-export.ts
 *
 * Writers for caption sidecar files (SRT, WebVTT, TTML/IMSC 1.1 text profile),
 * a parser that reads SRT and WebVTT back for the QA lint and for checking
 * our own output, and the mapping from a caption plan to export cues.
 * Pure functions: no file or Premiere access.
 */
import type { CaptionPlan } from "./caption-plan-types.js";
import { cleanCueLine } from "./caption-transcript.js";

export const CAPTION_EXPORT_FORMATS = ["srt", "vtt", "ttml"] as const;
export type CaptionExportFormat = (typeof CAPTION_EXPORT_FORMATS)[number];
export type CueAlign = "start" | "center" | "end";

/** Where a cue sits. Percent of the frame; line_pct is the top of the text. */
export interface CuePosition {
  line_pct?: number;
  align?: CueAlign;
  /** Width of the text box in percent of the frame (VTT size, TTML region extent). */
  region_width_pct?: number;
}

export interface ExportCue {
  start: number;
  end: number;
  lines: string[];
  speaker?: string;
  italic?: boolean;
  /** Text colour as #RRGGBB (a speaker colour). */
  color?: string;
  position?: CuePosition;
}

export interface WriteResult {
  text: string;
  warnings: string[];
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));
const pctText = (n: number) => `${Math.round(clampPct(n) * 100) / 100}%`;

/** Whole milliseconds, never negative. */
const toMs = (s: number) => Math.max(0, Math.round(s * 1000));

/** "HH:MM:SS<sep>mmm"; hours are at least two digits and grow past 99. */
export function formatTime(seconds: number, sep: "," | "."): string {
  const total = toMs(seconds);
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}${sep}${p(ms, 3)}`;
}

/** Start and end as written: rounded to ms, end always after start. */
function timesOf(c: ExportCue): [number, number] {
  const a = toMs(c.start);
  let b = toMs(c.end);
  if (b <= a) b = a + 1;
  return [a / 1000, b / 1000];
}

/** Characters XML 1.0 forbids (and VTT/SRT players choke on): C0 controls except tab, LF and CR, and U+FFFE / U+FFFF. */
const ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
const stripIllegal = (s: string) => s.replace(ILLEGAL_CHARS, "");

/** The lines with empty ones dropped, stray carriage returns and control characters removed (a blank line would end the cue). */
function cleanLines(lines: string[]): string[] {
  return lines
    .flatMap((l) => stripIllegal(String(l)).split(/\r\n?|\n/))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------- SRT ----------

export function writeSrt(cues: ExportCue[]): WriteResult {
  const warnings: string[] = [];
  const out: string[] = [];
  let usedItalic = false;
  let usedColor = false;
  cues.forEach((c, i) => {
    const [a, b] = timesOf(c);
    let lines = cleanLines(c.lines);
    if (c.italic && lines.length) {
      usedItalic = true;
      lines = lines.map((l) => `<i>${l}</i>`);
    }
    if (c.color && lines.length) {
      usedColor = true;
      lines = lines.map((l) => `<font color="${c.color}">${l}</font>`);
    }
    out.push(`${i + 1}\r\n${formatTime(a, ",")} --> ${formatTime(b, ",")}\r\n${lines.join("\r\n")}\r\n`);
  });
  if (usedItalic) warnings.push("SRT has no styling standard. <i> italics are written because most players show them, but some ignore them or print the tags.");
  if (usedColor) warnings.push("SRT has no colour standard. <font color> is written because most players show it, but some ignore it or print the tags.");
  return { text: out.join("\r\n"), warnings };
}

// ---------- WebVTT ----------

const escapeVtt = (s: string) => stripIllegal(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function vttSettings(p: CuePosition | undefined): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.line_pct !== undefined) parts.push(`line:${pctText(p.line_pct)}`);
  const align = p.align ?? (p.line_pct !== undefined ? "center" : undefined);
  if (align === "center") parts.push("position:50%");
  if (align) parts.push(`align:${align}`);
  if (p.region_width_pct !== undefined) parts.push(`size:${pctText(p.region_width_pct)}`);
  return parts.length ? " " + parts.join(" ") : "";
}

export function writeVtt(cues: ExportCue[], opts: { speaker_voice?: boolean } = {}): WriteResult {
  const voice = opts.speaker_voice !== false;
  const out: string[] = ["WEBVTT\n"];
  const colors = [...new Set(cues.flatMap((c) => (c.color ? [c.color.toUpperCase()] : [])))];
  if (colors.length) out.push("STYLE\n" + colors.map((k) => `::cue(.c${k.slice(1)}) { color: ${k}; }`).join("\n") + "\n");
  cues.forEach((c) => {
    const [a, b] = timesOf(c);
    const lines = cleanLines(c.lines).map(escapeVtt);
    let body = lines.join("\n");
    if (c.italic && body) body = `<i>${body}</i>`;
    if (c.color && body) body = `<c.c${c.color.slice(1).toUpperCase()}>${body}</c>`;
    if (voice && c.speaker) body = `<v ${escapeVtt(c.speaker).replace(/\s+/g, " ")}>${body}</v>`;
    out.push(`${formatTime(a, ".")} --> ${formatTime(b, ".")}${vttSettings(c.position)}\n${body}\n`);
  });
  return { text: out.join("\n"), warnings: [] };
}

// ---------- TTML / IMSC 1.1 text profile ----------

const escapeXml = (s: string) => stripIllegal(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Region {
  id: string;
  origin: string;
  extent: string;
  textAlign: CueAlign;
  displayAlign: "before" | "after";
}

function regionOf(p: CuePosition | undefined): Omit<Region, "id"> {
  const width = clampPct(p?.region_width_pct ?? 80);
  const x = Math.round(((100 - width) / 2) * 100) / 100;
  const textAlign = p?.align ?? "center";
  if (p?.line_pct === undefined) {
    return { origin: `${x}% 80%`, extent: `${width}% 15%`, textAlign, displayAlign: "after" };
  }
  const y = Math.round(clampPct(p.line_pct) * 100) / 100;
  const h = Math.max(5, Math.min(15, 100 - y));
  return { origin: `${x}% ${y}%`, extent: `${width}% ${Math.round(h * 100) / 100}%`, textAlign, displayAlign: "before" };
}

export function writeTtml(cues: ExportCue[], opts: { lang?: string } = {}): WriteResult {
  const regions: Region[] = [];
  const regionFor = (p: CuePosition | undefined): string => {
    const r = regionOf(p);
    const hit = regions.find((x) => x.origin === r.origin && x.extent === r.extent && x.textAlign === r.textAlign && x.displayAlign === r.displayAlign);
    if (hit) return hit.id;
    const id = `r${regions.length + 1}`;
    regions.push({ id, ...r });
    return id;
  };
  const paras: string[] = [];
  const styles: string[] = [];
  cues.forEach((c, i) => {
    const [a, b] = timesOf(c);
    const lines = cleanLines(c.lines).map(escapeXml);
    let body = lines.join("<br/>");
    if (c.italic && body) body = `<span tts:fontStyle="italic">${body}</span>`;
    if (c.color && body) {
      const key = c.color.toUpperCase();
      if (!styles.includes(key)) styles.push(key);
      body = `<span style="s${styles.indexOf(key) + 1}">${body}</span>`;
    }
    paras.push(`      <p xml:id="c${i + 1}" region="${regionFor(c.position)}" begin="${formatTime(a, ".")}" end="${formatTime(b, ".")}">${body}</p>`);
  });
  if (!regions.length) regionFor(undefined);
  const regionXml = regions
    .map((r) => `      <region xml:id="${r.id}" tts:origin="${r.origin}" tts:extent="${r.extent}" tts:textAlign="${r.textAlign}" tts:displayAlign="${r.displayAlign}"/>`)
    .join("\n");
  const styleXml = styles.length ? `    <styling>\n${styles.map((c, i) => `      <style xml:id="s${i + 1}" tts:color="${c}"/>`).join("\n")}\n    </styling>\n` : "";
  const text =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ` +
    `xml:lang="${escapeXml(opts.lang ?? "en")}" ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text">\n` +
    `  <head>\n${styleXml}    <layout>\n${regionXml}\n    </layout>\n  </head>\n` +
    `  <body>\n    <div>\n${paras.join("\n")}\n    </div>\n  </body>\n` +
    `</tt>\n`;
  return { text, warnings: [] };
}

/** Writes cues in the chosen format. */
export function writeCaptions(format: CaptionExportFormat, cues: ExportCue[], opts: { speaker_voice?: boolean; lang?: string } = {}): WriteResult {
  if (format === "srt") return writeSrt(cues);
  if (format === "vtt") return writeVtt(cues, opts);
  return writeTtml(cues, opts.lang !== undefined ? { lang: opts.lang } : {});
}

/** Number of cues in our own TTML output (one p per cue). */
export function countTtmlCues(text: string): number {
  return (text.match(/<p[\s>]/g) ?? []).length;
}

// ---------- plan to cues ----------

export interface PlanToCuesOptions {
  /** Write speaker names as VTT voice spans (the cue's `speaker`). Default true. */
  include_speaker?: boolean;
  /** Display names per speaker id; falls back to the id. */
  speaker_names?: Record<string, string>;
  /** Write the speaker colour (speaker_style color plans carry one). Default true. */
  use_color?: boolean;
  /** Position for every cue (VTT line/align/size, TTML region). */
  position?: CuePosition;
}

/**
 * Plan captions as export cues. Lines are used as planned: a lyric caption already carries its music
 * notes, a sound event its square brackets, a speaker label or hyphen is already in the lines.
 * Lyrics are italic; a speaker colour is carried when the plan has one.
 */
export function planToExportCues(plan: Pick<CaptionPlan, "captions">, opts: PlanToCuesOptions = {}): ExportCue[] {
  return plan.captions.map((c) => {
    const cue: ExportCue = { start: c.start, end: c.end, lines: c.lines.slice() };
    if (opts.include_speaker !== false && c.speaker !== undefined && c.kind !== "sound") cue.speaker = opts.speaker_names?.[c.speaker] ?? c.speaker;
    if (c.kind === "lyric" || c.italic) cue.italic = true;
    if (opts.use_color !== false && c.color) cue.color = c.color;
    if (opts.position) cue.position = { ...opts.position };
    return cue;
  });
}

// ---------- parser (SRT and WebVTT) ----------

export interface ParsedCue {
  /** 1-based order in the file. */
  n: number;
  /** The cue identifier line, when there was one. */
  id?: string;
  start: number;
  end: number;
  /** Text lines with markup tags removed and VTT entities decoded. */
  lines: string[];
  /** Text lines as written, tags included. */
  raw_lines: string[];
  /** VTT cue settings after the end time, as written. */
  settings?: string;
  italic?: boolean;
  speaker?: string;
}

export interface ParseResult {
  format: "srt" | "vtt";
  cues: ParsedCue[];
  warnings: string[];
}

const TS = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})`;
const TIMING = new RegExp(`^\\s*${TS}\\s*-->\\s*${TS}(.*)$`);

function secs(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms + "00").slice(0, 3)) / 1000;
}

export function detectSubtitleFormat(text: string): "srt" | "vtt" {
  return /^﻿?WEBVTT/.test(text) ? "vtt" : "srt";
}

/** Parses SRT or WebVTT. Tolerates a BOM, CRLF, NOTE/STYLE/REGION blocks, cue ids and cue settings. Never throws. */
export function parseSubtitles(input: string, format?: "srt" | "vtt"): ParseResult {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fmt = format ?? detectSubtitleFormat(text);
  const warnings: string[] = [];
  const cues: ParsedCue[] = [];
  const blocks = text.split(/\n[ \t]*\n/);
  let skipped = 0;
  blocks.forEach((block, bi) => {
    const lines = block.replace(/^\n+|\n+$/g, "").split("\n");
    if (!lines.length || (lines.length === 1 && !lines[0].trim())) return;
    if (fmt === "vtt") {
      if (bi === 0 && /^WEBVTT/.test(lines[0])) {
        // A header block can run straight into a cue without a blank line only in broken files; ignore it whole.
        if (!lines.some((l) => TIMING.test(l))) return;
      }
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) return;
    }
    let ti = -1;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      if (TIMING.test(lines[i])) {
        ti = i;
        break;
      }
    }
    if (ti < 0) {
      skipped++;
      return;
    }
    const m = TIMING.exec(lines[ti])!;
    const start = secs(m[1], m[2], m[3], m[4]);
    const end = secs(m[5], m[6], m[7], m[8]);
    const settings = (m[9] ?? "").trim();
    const raw = lines.slice(ti + 1);
    const body = raw.join("\n");
    const italic = /<i>/i.test(body);
    const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/i.exec(body);
    const shown = raw.map((l) => cleanCueLine(l).replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
    const idLine = ti > 0 ? lines[ti - 1].trim() : "";
    cues.push({
      n: cues.length + 1,
      ...(idLine ? { id: idLine } : {}),
      start,
      end,
      lines: shown,
      raw_lines: raw,
      ...(settings ? { settings } : {}),
      ...(italic ? { italic: true } : {}),
      ...(voice ? { speaker: voice[1].trim() } : {}),
    });
  });
  if (skipped) warnings.push(`${skipped} block${skipped === 1 ? "" : "s"} had no readable timing line and were skipped.`);
  return { format: fmt, cues, warnings };
}
