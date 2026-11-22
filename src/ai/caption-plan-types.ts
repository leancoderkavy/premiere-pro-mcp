/**
 * src/ai/caption-plan-types.ts
 *
 * Types shared by the caption planner modules (caption-plan, caption-rules,
 * caption-cleanup, caption-transcript). Types only: nothing here runs.
 */
import type { CaptionStandardId } from "./caption-standards.js";

export interface CaptionTranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface CaptionTranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  words?: CaptionTranscriptWord[];
  /** Sound events the transcript carries (ElevenLabs `audio_event` entries such as "(laughter)"). */
  sound_events?: CaptionTranscriptWord[];
}

export type CaptionTranscriptFormat = "srt" | "vtt" | "json";

export type CaptionKind = "speech" | "sound" | "lyric";

/** What the planner changed to meet the standard (or the clean-up / snapping rules). */
export interface PlanChange {
  /** 1-based caption number in the final plan (after merges and splits). */
  n: number;
  rule: "min_duration" | "max_duration" | "cps" | "cpl" | "lines" | "gap" | "close_gap" | "shot_change" | "linger" | "single_word" | "max_words" | "overlap" | "sequence_end";
  action: "extended" | "shortened" | "merged" | "split" | "moved_in" | "moved_out" | "closed_gap" | "opened_gap" | "merged_over_max_words" | "dropped";
  detail: string;
}

/** A rule still broken after fixing (or with fix: false). */
export interface PlanViolation {
  n: number;
  rule: PlanChange["rule"] | "grammar";
  detail: string;
}

export interface CleanupReport {
  dropped_after_end: number;
  dropped_music_tokens: number;
  dropped_short: number;
  fillers_removed: number;
  stutters_removed: number;
  glossary_replacements: number;
}

export interface GlossaryEntry {
  find: string;
  replace: string;
  case_sensitive?: boolean;
}

export interface CleanupOptions {
  drop_after_s?: number;
  drop_music_tokens?: boolean;
  min_word_s?: number;
  remove_fillers?: boolean;
  filler_words?: string[];
  remove_stutters?: boolean;
  glossary?: GlossaryEntry[];
  case?: "as_is" | "upper" | "sentence";
  strip_punctuation?: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface SdhOptions {
  sound_events?: boolean;
  lyric_ranges?: TimeRange[];
}

export type SpeakerStyle = "none" | "color" | "hyphen" | "label";

/** Every planner option, after validation. */
export interface CaptionPlanOptions {
  standard?: CaptionStandardId;
  fix?: boolean;
  frame_rate?: number;
  max_chars_per_line?: number;
  max_lines?: number;
  /** A caption stays up at least this long when the next one allows it. */
  min_duration?: number;
  max_duration?: number;
  /** Seconds a caption stays after its last word, within the gap to the next. */
  linger?: number;
  /** A pause between words longer than this starts a new caption. */
  pause_break?: number;
  /** Seconds added to every transcript time. */
  offset?: number;
  /** Only transcript words that overlap this time and later (before offset). Straddling words are clipped. */
  from_s?: number;
  /** Only transcript words that overlap times before this (before offset). Straddling words are clipped. */
  to_s?: number;
  min_gap_frames?: number;
  close_gaps_under?: number;
  cut_times?: number[];
  cleanup?: CleanupOptions;
  max_words?: number;
  single_word?: boolean;
  highlight_lead_frames?: number;
  speaker_style?: SpeakerStyle;
  speaker_colors?: string[];
  speaker_names?: Record<string, string>;
  accessibility?: boolean;
  sdh?: SdhOptions;
  /** Sequence (or media) end in seconds, after offset: no caption ends past it and one that would start at or after it is dropped. */
  end_s?: number;
  /** Duration of the transcript's media (transcript seconds) when the transcript states one; the clamp is its end plus offset. Set by the tools, not a user option. */
  transcript_duration_s?: number;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
  /** When the highlight switches to this word. Always set by the planner. */
  show_at?: number;
}

/** A caption while the planner works on it. */
export interface Caption {
  start: number;
  end: number;
  lines: string[];
  words: CaptionWord[];
  speaker?: string;
  kind?: CaptionKind;
  speaker_index?: number;
  color?: string;
  italic?: boolean;
}

/** A caption as the plan reports it. */
export interface PlanCaption {
  /** 1-based number. */
  n: number;
  start: number;
  end: number;
  lines: string[];
  /** The lines joined with a space. */
  text: string;
  speaker?: string;
  speaker_index?: number;
  /** Hex colour for the speaker; only with speaker_style "color". */
  color?: string;
  kind: CaptionKind;
  italic?: boolean;
  words: Array<{ text: string; start: number; end: number }>;
  /** Per word: when its highlight switches on (seconds); same length as `words`. Absent for sound captions. */
  highlight?: number[];
}

export interface PlanSettings {
  frame_rate: number;
  /** True when no frame rate was given and 30 was assumed. */
  frame_rate_assumed: boolean;
  standard?: CaptionStandardId;
  fix: boolean;
  max_chars_per_line: number;
  max_lines: number;
  min_duration: number;
  max_duration: number;
  linger: number;
  pause_break: number;
  offset: number;
  min_gap_frames: number;
  close_gaps_under: number;
  max_words?: number;
  single_word: boolean;
  highlight_lead_frames: number;
  speaker_style: SpeakerStyle;
  cut_count: number;
  /** The end (seconds) every caption was clamped to, when one applied. */
  end_s?: number;
}

export interface CaptionPlan {
  captions: PlanCaption[];
  changes: PlanChange[];
  violations: PlanViolation[];
  cleanup: CleanupReport | undefined;
  warnings: string[];
  settings: PlanSettings;
  /** True when some words had no times of their own and were spread over their segment by character share. */
  estimated_word_times: boolean;
}
