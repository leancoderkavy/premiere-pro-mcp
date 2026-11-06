/**
 * Speech-to-text engines for transcribe_audio.
 *
 * An engine takes one audio or video file and returns the engine's own JSON,
 * kept as returned, plus a summary. ElevenLabs Scribe is the first engine; a
 * local Whisper engine can implement the same interface and be added to
 * TRANSCRIPTION_ENGINES without touching the tool flow.
 *
 * The file is streamed from disk into a multipart body over node:https and is
 * never held in memory. The API key is passed in per call, never stored here.
 */

import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const ELEVENLABS_KEY_VAR = "ELEVENLABS_API_KEY";
export const ELEVENLABS_DEFAULT_MODEL = "scribe_v1";
/** The request fails when the socket sees no data for this long. */
export const UPLOAD_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export const SOURCE_EXTENSIONS = [".wav", ".aif", ".aiff", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4", ".mov", ".webm"];

export type TranscriptionErrorCode = "no_api_key" | "upload_failed" | "api_error" | "bad_response";

export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface TranscriptionOptions {
  model: string;
  language?: string;
  diarize: boolean;
  num_speakers?: number;
  tag_audio_events: boolean;
}

export interface TranscriptSummary {
  language_code: string | null;
  language_probability: number | null;
  duration_s: number;
  words: number;
  speakers: string[];
  audio_events: number;
  /** First ~30 words as text. */
  preview: string;
}

export interface EngineResult {
  /** The engine's response as returned; this is what is written to disk. */
  raw: unknown;
  summary: TranscriptSummary;
}

export interface TranscriptionEngine {
  id: string;
  /** Name shown in privacy text. */
  label: string;
  defaultModel: string;
  /** Environment variable holding the key; undefined for an engine that needs none (local). */
  keyEnvVar?: string;
  /** One sentence for the result's privacy field. */
  privacy: string;
  transcribe(file: string, options: TranscriptionOptions, apiKey: string | undefined): Promise<EngineResult>;
}

/** Removes the key and anything shaped like an ElevenLabs key from text that may reach a result. */
export function redactKey(text: string, key?: string): string {
  let out = text;
  if (key) out = out.split(key).join("[key]");
  return out.replace(/\bsk[_-][A-Za-z0-9_-]{8,}/g, "[key]");
}

interface ScribeWord {
  text?: unknown;
  end?: unknown;
  type?: unknown;
  speaker_id?: unknown;
}

/** Counts words, speakers and audio events in an ElevenLabs Scribe response. */
export function summariseScribe(raw: Record<string, unknown>): TranscriptSummary {
  const items = (raw.words as ScribeWord[]).filter((w) => w && typeof w === "object");
  const words = items.filter((w) => w.type === undefined || w.type === "word");
  const speakers: string[] = [];
  for (const w of words) {
    if (w.speaker_id !== undefined && w.speaker_id !== null) {
      const s = String(w.speaker_id);
      if (!speakers.includes(s)) speakers.push(s);
    }
  }
  let duration = 0;
  for (const w of items) if (typeof w.end === "number" && w.end > duration) duration = w.end;
  const prob = raw.language_probability;
  return {
    language_code: typeof raw.language_code === "string" ? raw.language_code : null,
    language_probability: typeof prob === "number" ? prob : null,
    duration_s: Math.round(duration * 1000) / 1000,
    words: words.length,
    speakers: speakers.slice(0, 500),
    audio_events: items.filter((w) => w.type === "audio_event").length,
    preview: words
      .slice(0, 30)
      .map((w) => String(w.text ?? ""))
      .join(" ")
      .trim()
      .slice(0, 2000),
  };
}

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** What the API says is wrong, from its usual {"detail": {"message"}} or {"detail": "..."} body. */
function apiMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object") {
      const o = d as { message?: unknown };
      if (typeof o.message === "string") return o.message;
      return JSON.stringify(d).slice(0, 400);
    }
    if (typeof j.message === "string") return j.message;
  } catch {
    // Not JSON.
  }
  return body.slice(0, 300);
}

export interface ElevenLabsEngineOptions {
  /** Default https.request; tests pass a fake. */
  request?: typeof https.request;
  host?: string;
  idleTimeoutMs?: number;
}

export function createElevenLabsEngine(options: ElevenLabsEngineOptions = {}): TranscriptionEngine {
  const request = options.request ?? https.request;
  const host = options.host ?? "api.elevenlabs.io";
  const idleMs = options.idleTimeoutMs ?? UPLOAD_IDLE_TIMEOUT_MS;

  return {
    id: "elevenlabs",
    label: "ElevenLabs",
    defaultModel: ELEVENLABS_DEFAULT_MODEL,
    keyEnvVar: ELEVENLABS_KEY_VAR,
    privacy: "The audio or video file was uploaded to ElevenLabs (third party, US-hosted) for transcription; the picture went too when the file is a video.",
    async transcribe(file, opts, apiKey) {
      if (!apiKey) throw new TranscriptionError("no_api_key", `No ${ELEVENLABS_KEY_VAR} is set; nothing was sent.`);
      const key = apiKey;
      const size = fs.statSync(file).size;
      const boundary = `----premiereMcp${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
      const fields: Array<[string, string]> = [["model_id", opts.model]];
      if (opts.language) fields.push(["language_code", opts.language]);
      fields.push(["diarize", String(opts.diarize)]);
      if (opts.num_speakers !== undefined) fields.push(["num_speakers", String(opts.num_speakers)]);
      fields.push(["tag_audio_events", String(opts.tag_audio_events)], ["timestamps_granularity", "word"]);
      const text = fields.map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("");
      const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      const filename = path.basename(file).replace(/["\r\n\\]/g, "_");
      const head = Buffer.from(
        `${text}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        "utf8",
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

      const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        let settled = false;
        const fail = (err: unknown) => {
          if (settled) return;
          settled = true;
          reject(new TranscriptionError("upload_failed", redactKey(`Upload to ElevenLabs failed: ${err instanceof Error ? err.message : String(err)}`, key)));
        };
        const req = request(
          {
            method: "POST",
            host,
            path: "/v1/speech-to-text",
            headers: {
              "xi-api-key": key,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": head.length + size + tail.length,
              Accept: "application/json",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on("error", fail);
            res.on("end", () => {
              if (settled) return;
              settled = true;
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
            });
          },
        );
        // An idle socket fails the job; a slow but moving upload does not.
        req.setTimeout(idleMs, () => req.destroy(new Error(`no data for ${Math.round(idleMs / 60000)} minutes`)));
        req.on("error", fail);
        req.write(head);
        const stream = fs.createReadStream(file);
        stream.on("error", (e) => {
          fail(e);
          req.destroy();
        });
        stream.on("end", () => {
          req.write(tail);
          req.end();
        });
        stream.on("data", (chunk) => {
          if (!req.write(chunk)) {
            stream.pause();
            req.once("drain", () => stream.resume());
          }
        });
      });

      if (status < 200 || status >= 300) {
        throw new TranscriptionError("api_error", redactKey(`ElevenLabs returned HTTP ${status}: ${apiMessage(body)}`, key), status);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new TranscriptionError("bad_response", "ElevenLabs answered 200 but the body was not JSON", status);
      }
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as { words?: unknown }).words)) {
        throw new TranscriptionError("bad_response", "ElevenLabs answered 200 but the JSON has no words array", status);
      }
      return { raw, summary: summariseScribe(raw as Record<string, unknown>) };
    },
  };
}

/** Engine factories by id. A local Whisper engine is one more entry here. */
export const TRANSCRIPTION_ENGINES: Record<string, (request?: typeof https.request) => TranscriptionEngine> = {
  elevenlabs: (request) => createElevenLabsEngine({ request }),
};
