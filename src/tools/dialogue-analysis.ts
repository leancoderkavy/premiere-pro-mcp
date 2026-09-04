import { createHash } from "node:crypto";

export type DialogueSegment = {
  id: string;
  source_project_item_id: string;
  transcript_revision: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  speaker_label?: string;
};

export type DialogueCandidateReason = "filler_word" | "repeated_phrase" | "long_silence";

export type DialogueEditCandidate = {
  id: string;
  reason: DialogueCandidateReason;
  confidence: "deterministic" | "review_required";
  source_project_item_id: string;
  start_seconds: number;
  end_seconds: number;
  segment_ids: string[];
  matched_text?: string;
};

const MAX_SEGMENTS = 10_000;
const MAX_CANDIDATES = 512;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const REVISION = /^sha256:[a-f0-9]{64}$/;

function finiteRange(start: unknown, end: unknown, label: string) {
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) throw new Error(`${label}.start_seconds must be a finite non-negative number`);
  if (typeof end !== "number" || !Number.isFinite(end) || end <= start || end > 86_400) throw new Error(`${label}.end_seconds must be greater than start_seconds and at most 86400`);
  return { start_seconds: Number(start.toFixed(6)), end_seconds: Number(end.toFixed(6)) };
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function normalizeWords(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ").trim().replace(/\s+/g, " ");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

export function normalizeDialogueSegments(value: unknown): DialogueSegment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEGMENTS) throw new Error(`segments must contain between 1 and ${MAX_SEGMENTS} entries`);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_INPUT_BYTES) throw new Error("segments exceed the 5 MiB input limit");
  const ids = new Set<string>();
  const result = value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`segments[${index}] must be an object`);
    const item = raw as Record<string, unknown>;
    const allowed = ["id", "source_project_item_id", "transcript_revision", "start_seconds", "end_seconds", "text", "speaker_label"];
    const unknown = Object.keys(item).find((key) => !allowed.includes(key));
    if (unknown) throw new Error(`segments[${index}] has an unknown field: ${unknown}`);
    const id = text(item.id, `segments[${index}].id`, 128);
    if (ids.has(id)) throw new Error(`segments contains duplicate id: ${id}`);
    ids.add(id);
    const revision = text(item.transcript_revision, `segments[${index}].transcript_revision`, 71);
    if (!REVISION.test(revision)) throw new Error(`segments[${index}].transcript_revision must be a sha256 revision`);
    const range = finiteRange(item.start_seconds, item.end_seconds, `segments[${index}]`);
    const body = typeof item.text === "string" && item.text.length <= 1_000 ? item.text : undefined;
    if (body === undefined) throw new Error(`segments[${index}].text must be a string of at most 1000 characters`);
    const speaker = item.speaker_label === undefined ? undefined : text(item.speaker_label, `segments[${index}].speaker_label`, 128);
    return {
      id,
      source_project_item_id: text(item.source_project_item_id, `segments[${index}].source_project_item_id`, 512),
      transcript_revision: revision,
      ...range,
      text: body,
      ...(speaker ? { speaker_label: speaker } : {}),
    };
  });
  return result.sort((a, b) => a.source_project_item_id.localeCompare(b.source_project_item_id) || a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds);
}

function unionDuration(candidates: DialogueEditCandidate[]): number {
  const bySource = new Map<string, Array<{ start: number; end: number }>>();
  for (const item of candidates) {
    const list = bySource.get(item.source_project_item_id) ?? [];
    list.push({ start: item.start_seconds, end: item.end_seconds });
    bySource.set(item.source_project_item_id, list);
  }
  let total = 0;
  for (const ranges of bySource.values()) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    let current: { start: number; end: number } | undefined;
    for (const range of ranges) {
      if (!current || range.start > current.end) {
        if (current) total += current.end - current.start;
        current = { ...range };
      } else current.end = Math.max(current.end, range.end);
    }
    if (current) total += current.end - current.start;
  }
  return Number(total.toFixed(6));
}

export function analyzeDialogueEditCandidates(input: {
  segments: unknown;
  fillerWords?: unknown;
  silenceRanges?: unknown;
  minimumSilenceSeconds?: unknown;
}) {
  const segments = normalizeDialogueSegments(input.segments);
  const fillerWords = input.fillerWords === undefined ? [] : (() => {
    if (!Array.isArray(input.fillerWords) || input.fillerWords.length > 64) throw new Error("filler_words must contain at most 64 entries");
    const words = input.fillerWords.map((value, index) => normalizeWords(text(value, `filler_words[${index}]`, 64))).filter(Boolean);
    if (new Set(words).size !== words.length) throw new Error("filler_words contains duplicates");
    return words;
  })();
  const minimumSilence = input.minimumSilenceSeconds === undefined ? 0.7 : input.minimumSilenceSeconds;
  if (typeof minimumSilence !== "number" || !Number.isFinite(minimumSilence) || minimumSilence < 0.1 || minimumSilence > 30) throw new Error("minimum_silence_seconds must be between 0.1 and 30");

  const candidates: DialogueEditCandidate[] = [];
  const add = (candidate: Omit<DialogueEditCandidate, "id">) => {
    if (candidates.length >= MAX_CANDIDATES) return;
    candidates.push({ ...candidate, id: digest(candidate) });
  };
  for (const segment of segments) {
    const normalized = normalizeWords(segment.text);
    for (const filler of fillerWords) {
      const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "u").test(normalized)) {
        add({ reason: "filler_word", confidence: "review_required", source_project_item_id: segment.source_project_item_id, start_seconds: segment.start_seconds, end_seconds: segment.end_seconds, segment_ids: [segment.id], matched_text: filler });
        break;
      }
    }
  }
  const priorBySource = new Map<string, DialogueSegment>();
  for (const segment of segments) {
    const prior = priorBySource.get(segment.source_project_item_id);
    const normalized = normalizeWords(segment.text);
    if (prior && normalized.length >= 8 && normalized === normalizeWords(prior.text)) {
      add({ reason: "repeated_phrase", confidence: "review_required", source_project_item_id: segment.source_project_item_id, start_seconds: segment.start_seconds, end_seconds: segment.end_seconds, segment_ids: [prior.id, segment.id], matched_text: normalized.slice(0, 128) });
    }
    priorBySource.set(segment.source_project_item_id, segment);
  }
  if (input.silenceRanges !== undefined) {
    if (!Array.isArray(input.silenceRanges) || input.silenceRanges.length > 2_000) throw new Error("silence_ranges must contain at most 2000 entries");
    for (let index = 0; index < input.silenceRanges.length; index++) {
      const raw = input.silenceRanges[index];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`silence_ranges[${index}] must be an object`);
      const item = raw as Record<string, unknown>;
      const unknown = Object.keys(item).find((key) => !["source_project_item_id", "start_seconds", "end_seconds"].includes(key));
      if (unknown) throw new Error(`silence_ranges[${index}] has an unknown field: ${unknown}`);
      const range = finiteRange(item.start_seconds, item.end_seconds, `silence_ranges[${index}]`);
      if (range.end_seconds - range.start_seconds < minimumSilence) continue;
      add({ reason: "long_silence", confidence: "deterministic", source_project_item_id: text(item.source_project_item_id, `silence_ranges[${index}].source_project_item_id`, 512), ...range, segment_ids: [] });
    }
  }
  candidates.sort((a, b) => a.source_project_item_id.localeCompare(b.source_project_item_id) || a.start_seconds - b.start_seconds || a.reason.localeCompare(b.reason));
  const truncated = candidates.length === MAX_CANDIDATES;
  return {
    analysis_revision: digest({ segments, fillerWords, silenceRanges: input.silenceRanges ?? [], minimumSilence }),
    candidate_count: candidates.length,
    candidates,
    projected_removed_seconds: unionDuration(candidates),
    truncated,
    applied: false,
    limitations: [
      "Candidates are deterministic suggestions, not editorial approval.",
      "Filler and repeated-phrase candidates cover whole supplied segments because word-level timing was not supplied.",
      "No transcript text is retained or sent to a model provider by this server.",
    ],
  };
}

export function getDialogueAnalysisTools() {
  return {
    analyze_dialogue_edit_candidates: {
      description: "Analyze caller-supplied, revision-bound transcript segments and optional local silence ranges for deterministic dialogue-edit candidates. It never calls a model, persists transcript text, or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          segments: { type: "array", minItems: 1, maxItems: MAX_SEGMENTS, description: "Normalized transcript segments with stable IDs, source IDs, transcript revisions, time ranges, text, and optional speaker labels.", items: { type: "object", additionalProperties: false, properties: {
            id: { type: "string", minLength: 1, maxLength: 128, description: "Caller-stable segment ID." },
            source_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact Premiere source project-item ID." },
            transcript_revision: { type: "string", pattern: "^sha256:[a-f0-9]{64}$", description: "Revision returned by get_clip_transcript_uxp." },
            start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Source-time segment start." },
            end_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Source-time segment end." },
            text: { type: "string", maxLength: 1000, description: "Local transcript text for this segment." },
            speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Optional caller-normalized speaker label." },
          }, required: ["id", "source_project_item_id", "transcript_revision", "start_seconds", "end_seconds", "text"] } },
          filler_words: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 64 }, description: "Exact normalized filler words or phrases to flag for review." },
          silence_ranges: { type: "array", maxItems: 2000, description: "Optional source-time silence ranges returned by local analysis.", items: { type: "object", additionalProperties: false, properties: {
            source_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact Premiere source project-item ID." },
            start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Silence start in source seconds." },
            end_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Silence end in source seconds." },
          }, required: ["source_project_item_id", "start_seconds", "end_seconds"] } },
          minimum_silence_seconds: { type: "number", minimum: 0.1, maximum: 30, description: "Minimum silence duration to return; defaults to 0.7 seconds." },
        },
        required: ["segments"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          return { success: true, data: analyzeDialogueEditCandidates({ segments: args.segments, fillerWords: args.filler_words, silenceRanges: args.silence_ranges, minimumSilenceSeconds: args.minimum_silence_seconds }) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
