import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as acorn from "acorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: actual, statSync: vi.fn(actual.statSync), unlinkSync: vi.fn(actual.unlinkSync) };
});
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
const exportHandler = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/export.js", () => ({ getExportTools: vi.fn(() => ({ export_sequence: { handler: exportHandler } })) }));

import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { buildSequenceAudioScript, getCaptionTranscriptionTools, safeFileStem } from "../../src/tools/caption-transcription.js";
import {
  TRANSCRIPTION_ENGINES,
  TranscriptionError,
  createElevenLabsEngine,
  redactKey,
  summariseScribe,
  type TranscriptionEngine,
} from "../../src/tools/transcription-engines.js";

const KEY = "sk_test1234567890abcdef";
const realStat = (await vi.importActual<typeof import("node:fs")>("node:fs")).statSync;
const realUnlink = (await vi.importActual<typeof import("node:fs")>("node:fs")).unlinkSync;

const SCRIBE = {
  language_code: "eng",
  language_probability: 0.98,
  text: "Hello world",
  words: [
    { text: "Hello", start: 0.1, end: 0.5, type: "word", speaker_id: "speaker_0" },
    { text: " ", start: 0.5, end: 0.55, type: "spacing" },
    { text: "world", start: 0.55, end: 1.2, type: "word", speaker_id: "speaker_1" },
    { text: "(laughter)", start: 1.3, end: 2.5, type: "audio_event" },
    { text: "again", start: 2.6, end: 3.0, speaker_id: "speaker_0" },
    null,
  ],
};

let workspace: string;
let media: string;

const wavBytes = Buffer.from("RIFFxxxxWAVEfmt ");

function fakeEngine(over: Partial<TranscriptionEngine> = {}) {
  const transcribe = vi.fn(async () => ({ raw: SCRIBE, summary: summariseScribe(SCRIBE as never) }));
  const engine: TranscriptionEngine = { id: "elevenlabs", label: "ElevenLabs", defaultModel: "scribe_v1", keyEnvVar: "ELEVENLABS_API_KEY", privacy: "Audio was uploaded to ElevenLabs (third party).", transcribe, ...over };
  return { engine, transcribe };
}

function tool(deps: Parameters<typeof getCaptionTranscriptionTools>[1] = {}) {
  // No audio-only preset by default: the real finder would read this machine's Media Encoder install.
  return getCaptionTranscriptionTools({}, { findAudioPreset: () => null, ...deps }).transcribe_audio;
}

function fakeSize(file: string, size: number) {
  vi.mocked(fs.statSync).mockImplementation(((p: string, o?: unknown) => {
    if (p === file) return { isFile: () => true, isDirectory: () => false, size } as fs.Stats;
    return (realStat as (p: string, o?: unknown) => fs.Stats)(p, o);
  }) as never);
}

beforeEach(() => {
  // realpath: the tool returns canonical paths, and on macOS tmpdir() (/var/...) is a link to /private/var/....
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "caption-transcription-")));
  media = join(workspace, "..", `ct-media-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  writeFileSync(media, wavBytes);
  vi.stubEnv("ELEVENLABS_API_KEY", KEY);
  vi.mocked(sendCommand).mockReset();
  exportHandler.mockReset();
  vi.mocked(fs.statSync).mockImplementation(realStat as never);
  vi.mocked(fs.unlinkSync).mockImplementation(realUnlink as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(media, { force: true });
});

// ---------------------------------------------------------------- schema

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; additionalProperties?: boolean };
function assertSchema(schema: Schema, path: string) {
  expect(schema.type, `${path} has a type`).toBeTruthy();
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      expect(child.description, `${path}.${key} has a description`).toBeTruthy();
      assertSchema(child, `${path}.${key}`);
    }
  }
}

describe("transcribe_audio schema", () => {
  it("is the one tool, fully described, closed, and names its privacy and the Adobe alternative", () => {
    const tools = getCaptionTranscriptionTools({});
    expect(Object.keys(tools)).toEqual(["transcribe_audio"]);
    const t = tools.transcribe_audio;
    assertSchema(t.parameters as Schema, "transcribe_audio");
    expect(t.parameters.additionalProperties).toBe(false);
    expect(t.parameters.required).toEqual(["confirm_upload", "approved_workspace_path"]);
    expect(t.parameters.properties.engine.enum).toEqual(Object.keys(TRANSCRIPTION_ENGINES));
    expect(t.description).toMatch(/THIRD-PARTY/);
    expect(t.description).toMatch(/UPLOADED to ElevenLabs/);
    expect(t.description).toMatch(/audio or video file/);
    expect(t.description).toMatch(/picture is uploaded too/);
    expect(t.description).toMatch(/exported_file_left_in_workspace/);
    expect(t.parameters.properties.confirm_upload.description).toMatch(/audio or video file/);
    expect(t.parameters.properties.delete_export_after_upload.description).toMatch(/only that file/);
    expect(t.description).toMatch(/prepare_transcript_workflow/);
    expect(t.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  });
});

// ---------------------------------------------------------------- refusals

describe("refusals before anything is sent", () => {
  it.each([undefined, false, "true", 1])("refuses confirm_upload %s with a plain statement", async (confirm) => {
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: confirm, approved_workspace_path: workspace, media_path: media })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/uploaded to ElevenLabs, a third-party service \(US-hosted\)/);
    expect(r.error).toMatch(/audio or video file/);
    expect(r.error).toMatch(/picture is uploaded too when the source is a video file/);
    expect(r.error).toMatch(/nothing was sent/);
    expect(transcribe).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects non-object arguments", async () => {
    for (const bad of [null, [], "x"]) {
      expect(await tool().handler(bad as never)).toMatchObject({ success: false, error: expect.stringContaining("arguments must be an object") });
    }
  });

  it("names the env var when the key is missing and sends nothing", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as { error: string };
    expect(r.error).toContain("ELEVENLABS_API_KEY is not set");
    expect(r.error).toContain("nothing was sent");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("treats an unsubstituted ${user_config.x} placeholder as no key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "${user_config.elevenlabs_api_key}");
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as { error: string };
    expect(r.error).toContain("ELEVENLABS_API_KEY is not set");
  });

  it.each(["whisper", "constructor", "__proto__", 5])("rejects unknown engine %s", async (engine) => {
    const r = (await tool().handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media, engine })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toContain("Unknown engine");
    expect(r.error).toContain("elevenlabs");
  });

  it("a registered second engine is selectable without touching the flow, and a key-less engine needs no key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const local = fakeEngine({ id: "whisper", label: "Whisper", keyEnvVar: undefined, privacy: "Audio stayed on this machine." });
    const r = (await tool({ engines: { whisper: local.engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media, engine: "whisper" })) as { success: boolean; data: { engine: string; privacy: string; transcript_path: string } };
    expect(r.success).toBe(true);
    expect(r.data.engine).toBe("whisper");
    expect(r.data.privacy).toContain("stayed on this machine");
    expect(r.data.transcript_path).toMatch(/\.whisper\.json$/);
    expect(local.transcribe).toHaveBeenCalledWith(media, expect.anything(), undefined);
  });

  it.each([
    [{}, "exactly one"],
    [{ media_path: "x", sequence_id: "s" }, "exactly one"],
    [{ media_path: "x", use_active_sequence: true }, "exactly one"],
  ])("needs exactly one source %j", async (extra, message) => {
    const r = (await tool().handler({ confirm_upload: true, approved_workspace_path: workspace, ...extra })) as { error: string };
    expect(r.error).toContain(message);
  });

  it("use_active_sequence false is not a source", async () => {
    const r = (await tool().handler({ confirm_upload: true, approved_workspace_path: workspace, use_active_sequence: false })) as { error: string };
    expect(r.error).toContain("exactly one");
  });

  it.each([
    [{ media_path: "" }, "media_path"],
    [{ media_path: 5 }, "media_path"],
    [{ sequence_id: "" }, "sequence_id"],
    [{ sequence_id: 7 }, "sequence_id"],
    [{ sequence_id: "s".repeat(513) }, "sequence_id"],
    [{ media_path: "x", export_preset_path: "relative.epr" }, "export_preset_path"],
    [{ media_path: "x", model: "" }, "model"],
    [{ media_path: "x", model: 3 }, "model"],
    [{ media_path: "x", language: "english-us-long" }, "language"],
    [{ media_path: "x", language: 4 }, "language"],
    [{ media_path: "x", diarize: "yes" }, "diarize"],
    [{ media_path: "x", tag_audio_events: "no" }, "tag_audio_events"],
    [{ media_path: "x", num_speakers: 0 }, "num_speakers"],
    [{ media_path: "x", num_speakers: 33 }, "num_speakers"],
    [{ media_path: "x", num_speakers: 1.5 }, "num_speakers"],
    [{ media_path: "x", num_speakers: "2" }, "num_speakers"],
  ])("validates %j", async (extra, field) => {
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, ...extra })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toContain(field);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "relative/dir", "x".repeat(5000), join(tmpdir(), "does-not-exist-ct-dir")])("rejects workspace %s", async (ws) => {
    const r = (await tool().handler({ confirm_upload: true, approved_workspace_path: ws, media_path: media })) as { error: string };
    expect(r.error).toContain("approved_workspace_path");
  });

  it("rejects a workspace that is a file", async () => {
    const r = (await tool().handler({ confirm_upload: true, approved_workspace_path: media, media_path: media })) as { error: string };
    expect(r.error).toContain("existing directory");
  });

  it("refuses an output_path outside the workspace, with the wrong extension, or that exists", async () => {
    const other = mkdtempSync(join(tmpdir(), "caption-transcription-other-"));
    try {
      const { engine, transcribe } = fakeEngine();
      const run = (output_path: unknown) => tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media, output_path }) as Promise<{ error: string }>;
      expect((await run(join(other, "t.json"))).error).toContain("contained within");
      expect((await run(join(workspace, "t.txt"))).error).toContain(".json");
      writeFileSync(join(workspace, "taken.json"), "{}");
      expect((await run(join(workspace, "taken.json"))).error).toContain("already exists");
      expect((await run("relative.json")).error).toContain("absolute");
      expect(transcribe).not.toHaveBeenCalled();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- media_path

describe("media_path source", () => {
  const base = () => ({ confirm_upload: true, approved_workspace_path: workspace });

  it("uploads the file, writes the raw JSON with a revision, and plans the next step", async () => {
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media, language: "eng", num_speakers: 2, diarize: false, tag_audio_events: false, model: "scribe_v2" })) as { success: boolean; data: Record<string, any> };
    expect(r.success).toBe(true);
    expect(transcribe).toHaveBeenCalledWith(media, { model: "scribe_v2", language: "eng", diarize: false, num_speakers: 2, tag_audio_events: false }, KEY);
    expect(sendCommand).not.toHaveBeenCalled();
    const d = r.data;
    expect(d).toMatchObject({ engine: "elevenlabs", model: "scribe_v2", source: "media_path", offset_seconds: 0, audible_source_range: null, upload_bytes: wavBytes.length });
    expect(d.media).toEqual({ name: expect.stringMatching(/^ct-media-.*\.wav$/) });
    expect(JSON.stringify(d)).not.toContain(KEY);
    expect(d.transcript_path).toMatch(/ct-media-.*\.elevenlabs\.json$/);
    const written = readFileSync(d.transcript_path, "utf8");
    expect(JSON.parse(written).text).toBe("Hello world");
    expect(d.transcript_revision).toBe(`sha256:${createHash("sha256").update(written).digest("hex")}`);
    expect(d.transcript_bytes).toBe(Buffer.byteLength(written));
    expect(d.summary).toMatchObject({ language_code: "eng", words: 3, speakers: ["speaker_0", "speaker_1"], audio_events: 1 });
    expect(d.privacy).toContain("uploaded to ElevenLabs (third party");
    expect(d.next[0]).toMatchObject({ tool: "plan_captions", arguments: { transcript_path: d.transcript_path, approved_workspace_path: workspace, offset: 0 } });
    expect(d.next[0].arguments).not.toHaveProperty("from_s");
    expect(d.next[1]).toMatchObject({ tool: "create_caption_track", alternative: "add_caption_graphics" });
  });

  it("defaults: scribe_v1, diarize and audio events on, no language", async () => {
    const { engine, transcribe } = fakeEngine();
    await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media });
    expect(transcribe).toHaveBeenCalledWith(media, { model: "scribe_v1", diarize: true, tag_audio_events: true }, KEY);
  });

  it("never overwrites: a taken name gets ' 2', ' 3'", async () => {
    const { engine } = fakeEngine();
    const t = tool({ engines: { elevenlabs: engine } });
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) paths.push(((await t.handler({ ...base(), media_path: media })) as { data: { transcript_path: string } }).data.transcript_path);
    expect(new Set(paths).size).toBe(3);
    expect(paths[1]).toMatch(/ 2\.elevenlabs\.json$/);
    expect(paths[2]).toMatch(/ 3\.elevenlabs\.json$/);
  });

  it("writes to an explicit output_path inside the workspace", async () => {
    const { engine } = fakeEngine();
    const target = join(workspace, "mine.json");
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media, output_path: target })) as { data: { transcript_path: string } };
    expect(r.data.transcript_path).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("Hello world");
  });

  it("returns canonical paths when the workspace is reached through a link (macOS /var -> /private/var)", async () => {
    const holder = realpathSync(mkdtempSync(join(tmpdir(), "caption-transcription-link-")));
    try {
      const link = join(holder, "ws");
      try {
        symlinkSync(workspace, link, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return; // no link support here
      }
      const { engine } = fakeEngine();
      const t = tool({ engines: { elevenlabs: engine } });
      type R = { success: boolean; error?: string; data: { transcript_path: string; next: Array<{ arguments: Record<string, unknown> }> } };
      const byDefault = (await t.handler({ ...base(), approved_workspace_path: link, media_path: media })) as R;
      expect(byDefault.data.transcript_path.startsWith(join(workspace, "ct-media-"))).toBe(true);
      expect(byDefault.data.next[0].arguments.approved_workspace_path).toBe(workspace);
      const mixed = (await t.handler({ ...base(), approved_workspace_path: link, media_path: media, output_path: join(workspace, "mixed.json") })) as R;
      expect(mixed.data.transcript_path).toBe(join(workspace, "mixed.json"));
      const refused = (await t.handler({ ...base(), approved_workspace_path: workspace, media_path: media, output_path: join(link, "mixed.json") })) as R;
      expect(refused.success).toBe(false);
      expect(refused.error).toContain("already exists");
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });

  it("fails if the file appears at output_path after the upload (wx), without a key leak", async () => {
    const target = join(workspace, "race.json");
    const { engine } = fakeEngine({ transcribe: vi.fn(async () => { writeFileSync(target, "{}"); return { raw: SCRIBE, summary: summariseScribe(SCRIBE as never) }; }) });
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media, output_path: target })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/EEXIST/);
  });

  it("surfaces a write failure that is not a name clash", async () => {
    const gone = join(workspace, "gone");
    mkdirSync(gone);
    const { engine } = fakeEngine({ transcribe: vi.fn(async () => { rmSync(gone, { recursive: true, force: true }); return { raw: SCRIBE, summary: summariseScribe(SCRIBE as never) }; }) });
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), approved_workspace_path: gone, media_path: media })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/ENOENT/);
  });

  it("gives up after 999 taken names", async () => {
    const { engine } = fakeEngine();
    const stem = media.split(/[\\/]/).pop()!.replace(/\.wav$/, "");
    writeFileSync(join(workspace, `${stem}.elevenlabs.json`), "{}");
    for (let n = 2; n < 1000; n++) writeFileSync(join(workspace, `${stem} ${n}.elevenlabs.json`), "{}");
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media })) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toContain("is taken");
  });

  it.each([
    ["a relative path", "clip.wav", "absolute"],
    ["a bad extension", "ct-bad.txt", ".txt is not a format"],
    ["no extension", "ct-noext", "(no extension)"],
    ["a missing file", "ct-missing.wav", "not readable"],
    ["an empty file", "ct-empty.wav", "empty"],
  ])("refuses %s", async (_label, name, message) => {
    const abs = name.startsWith("clip") ? name : join(workspace, "..", name);
    if (name === "ct-bad.txt" || name === "ct-noext") writeFileSync(abs, "x");
    if (name === "ct-empty.wav") writeFileSync(abs, "");
    try {
      const { engine, transcribe } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: abs })) as { success: boolean; error: string };
      expect(r.success).toBe(false);
      expect(r.error).toContain(message);
      if (!name.startsWith("clip")) expect(r.error).toContain("Nothing was sent");
      expect(transcribe).not.toHaveBeenCalled();
    } finally {
      rmSync(abs, { force: true });
    }
  });

  it("refuses a directory and a file over 1 GB", async () => {
    const { engine, transcribe } = fakeEngine();
    const dir = join(workspace, "folder.wav");
    mkdirSync(dir);
    expect(((await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: dir })) as { error: string }).error).toContain("not a file");
    fakeSize(media, 2 * 1024 ** 3);
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...base(), media_path: media })) as { error: string };
    expect(r.error).toContain("2048 MB");
    expect(r.error).toContain("limit is 1024 MB");
    expect(transcribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- key redaction

describe("key redaction", () => {
  it("redacts the key from an engine error that echoes it, keeping code and status", async () => {
    const { engine } = fakeEngine({ transcribe: vi.fn(async () => { throw new TranscriptionError("api_error", `ElevenLabs returned HTTP 401: bad key ${KEY}`, 401); }) });
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as { success: boolean; error: string; data: Record<string, unknown> };
    expect(r.success).toBe(false);
    expect(r.error).toContain("[key]");
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.data).toEqual({ code: "api_error", status: 401 });
  });

  it("redacts a plain Error, a code without a status, and a non-Error throw", async () => {
    for (const thrown of [new Error(`boom ${KEY}`), new TranscriptionError("upload_failed", `net ${KEY}`), `text ${KEY}`]) {
      const { engine } = fakeEngine({ transcribe: vi.fn(async () => { throw thrown; }) });
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as { error: string; data?: Record<string, unknown> };
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect(r.error).toContain("[key]");
      if (thrown instanceof TranscriptionError) expect(r.data).toEqual({ code: "upload_failed" });
    }
  });

  it("redactKey handles sk- shaped strings without a known key", () => {
    expect(redactKey("a sk_abcdefghij1234 b")).toBe("a [key] b");
    expect(redactKey("plain")).toBe("plain");
  });
});

// ---------------------------------------------------------------- the real engine with a fake HTTP function

function fakeRequest(responder: (info: { opts: any; body: Buffer }) => { status: number; body: string } | Error, behaviour: { backpressure?: boolean; resError?: boolean } = {}) {
  const calls: Array<{ opts: any; body: Buffer }> = [];
  const request = ((opts: any, cb: (res: any) => void) => {
    const req: any = new EventEmitter();
    const chunks: Buffer[] = [];
    let writes = 0;
    req.setTimeout = vi.fn((_ms: number, fn: () => void) => { req.timeoutFn = fn; });
    req.write = (c: Buffer) => {
      chunks.push(Buffer.from(c));
      writes++;
      if (behaviour.backpressure && writes === 2) { setImmediate(() => req.emit("drain")); return false; }
      return true;
    };
    req.destroy = (e?: Error) => { if (e) req.emit("error", e); };
    req.end = () => {
      const body = Buffer.concat(chunks);
      calls.push({ opts, body });
      const out = responder({ opts, body });
      setImmediate(() => {
        if (out instanceof Error) { req.emit("error", out); return; }
        const res: any = new EventEmitter();
        res.statusCode = out.status;
        cb(res);
        if (behaviour.resError) { res.emit("error", new Error(`socket ${KEY}`)); return; }
        res.emit("data", out.body);
        res.emit("end");
      });
    };
    return req;
  }) as never;
  return { request, calls };
}

describe("ElevenLabs engine over a mocked https.request", () => {
  const ok = { status: 200, body: JSON.stringify(SCRIBE) };

  it("posts multipart with the key header, the fields and the file bytes", async () => {
    const { request, calls } = fakeRequest(() => ok);
    const engine = createElevenLabsEngine({ request });
    const result = await engine.transcribe(media, { model: "scribe_v1", language: "eng", diarize: true, num_speakers: 3, tag_audio_events: false }, KEY);
    expect(result.summary.words).toBe(3);
    const { opts, body } = calls[0];
    expect(opts).toMatchObject({ method: "POST", host: "api.elevenlabs.io", path: "/v1/speech-to-text" });
    expect(opts.headers["xi-api-key"]).toBe(KEY);
    expect(opts.headers["Content-Length"]).toBe(body.length);
    const text = body.toString("latin1");
    for (const field of ['name="model_id"\r\n\r\nscribe_v1', 'name="language_code"\r\n\r\neng', 'name="diarize"\r\n\r\ntrue', 'name="num_speakers"\r\n\r\n3', 'name="tag_audio_events"\r\n\r\nfalse', 'name="timestamps_granularity"\r\n\r\nword', "Content-Type: audio/wav", "RIFFxxxxWAVE"]) {
      expect(text).toContain(field);
    }
    expect(text).not.toContain(KEY);
  });

  it("omits optional fields, uses a generic content type, and honours backpressure", async () => {
    const odd = join(workspace, "we ird.bin");
    writeFileSync(odd, "data");
    const { request, calls } = fakeRequest(() => ok, { backpressure: true });
    await createElevenLabsEngine({ request }).transcribe(odd, { model: "m", diarize: false, tag_audio_events: true }, KEY);
    const text = calls[0].body.toString("latin1");
    expect(text).not.toContain("language_code");
    expect(text).not.toContain("num_speakers");
    expect(text).toContain("application/octet-stream");
    expect(text).toContain('filename="we ird.bin"');
  });

  it("registers the default factory (real https.request is only referenced, never called)", () => {
    expect(TRANSCRIPTION_ENGINES.elevenlabs().id).toBe("elevenlabs");
    expect(createElevenLabsEngine().label).toBe("ElevenLabs");
  });

  it("refuses to run without a key", async () => {
    const { request, calls } = fakeRequest(() => ok);
    await expect(createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, undefined)).rejects.toMatchObject({ code: "no_api_key" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["detail string", { detail: `bad ${KEY}` }, "bad [key]"],
    ["detail object message", { detail: { message: "quota", status: "quota_exceeded" } }, "quota"],
    ["detail object without message", { detail: { code: 7 } }, '{"code":7}'],
    ["detail array", { detail: [{ loc: ["body"] }] }, '[{"loc":["body"]}]'],
    ["top-level message", { message: "nope" }, "nope"],
    ["neither", { other: 1 }, '{"other":1}'],
  ])("reports api_error with status and a redacted message (%s)", async (_label, payload, expected) => {
    const { request } = fakeRequest(() => ({ status: 422, body: JSON.stringify(payload) }));
    const error = (await createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY).catch((e) => e)) as TranscriptionError;
    expect(error).toBeInstanceOf(TranscriptionError);
    expect(error.code).toBe("api_error");
    expect(error.status).toBe(422);
    expect(error.message).toContain("HTTP 422");
    expect(error.message).toContain(expected);
    expect(error.message).not.toContain(KEY);
  });

  it("reports a non-JSON error body as text", async () => {
    const { request } = fakeRequest(() => ({ status: 502, body: "<html>bad gateway</html>" }));
    await expect(createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY)).rejects.toThrow("bad gateway");
  });

  it.each([
    ["a non-JSON body", "not json"],
    ["JSON without words", JSON.stringify({ text: "x" })],
    ["a JSON null", "null"],
  ])("rejects a 200 with %s as bad_response", async (_label, body) => {
    const { request } = fakeRequest(() => ({ status: 200, body }));
    await expect(createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY)).rejects.toMatchObject({ code: "bad_response", status: 200 });
  });

  it("maps a network error, redacting the key", async () => {
    const { request } = fakeRequest(() => new Error(`ECONNRESET talking with ${KEY}`));
    const error = (await createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("upload_failed");
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain("[key]");
  });

  it("maps a response stream error and a non-Error rejection", async () => {
    const { request } = fakeRequest(() => ok, { resError: true });
    const error = (await createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("upload_failed");
    expect(error.message).not.toContain(KEY);
  });

  it("fails an idle socket through the timeout hook (15 minutes by default)", async () => {
    let hook: (() => void) | undefined;
    let ms = 0;
    const request = ((_opts: unknown, _cb: unknown) => {
      const req: any = new EventEmitter();
      req.setTimeout = (m: number, fn: () => void) => { ms = m; hook = fn; };
      req.write = () => true;
      req.destroy = (e?: Error) => { if (e) req.emit("error", e); };
      req.end = () => { hook?.(); };
      return req;
    }) as never;
    const error = (await createElevenLabsEngine({ request }).transcribe(media, { model: "m", diarize: true, tag_audio_events: true }, KEY).catch((e) => e)) as TranscriptionError;
    expect(ms).toBe(15 * 60 * 1000);
    expect(error.code).toBe("upload_failed");
    expect(error.message).toContain("no data for 15 minutes");
  });

  it("fails when the file cannot be read mid-upload", async () => {
    const dir = join(workspace, "dir.wav");
    mkdirSync(dir);
    const { request } = fakeRequest(() => ok);
    const error = (await createElevenLabsEngine({ request }).transcribe(dir, { model: "m", diarize: true, tag_audio_events: true }, KEY).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("upload_failed");
  });

  it("works end to end through the tool and never returns or logs the key", async () => {
    const { request, calls } = fakeRequest(() => ok);
    const log = vi.spyOn(console, "log");
    const r = await tool({ request }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media });
    expect(r).toMatchObject({ success: true });
    expect(calls[0].opts.headers["xi-api-key"]).toBe(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("api_error surfaces through the tool with status and no key", async () => {
    const { request } = fakeRequest(() => ({ status: 401, body: JSON.stringify({ detail: { message: `Invalid API key ${KEY}` } }) }));
    const r = (await tool({ request }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as { success: boolean; error: string; data: unknown };
    expect(r.success).toBe(false);
    expect(r.data).toEqual({ code: "api_error", status: 401 });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------- summary

describe("summariseScribe", () => {
  it("counts words (typed or untyped), skips spacing, lists speakers and audio events", () => {
    const s = summariseScribe(SCRIBE as never);
    expect(s).toMatchObject({ language_code: "eng", language_probability: 0.98, duration_s: 3, words: 3, speakers: ["speaker_0", "speaker_1"], audio_events: 1 });
    expect(s.preview).toBe("Hello world again");
  });
  it("copes with a bare response", () => {
    expect(summariseScribe({ words: [{ text: "hi", end: "x", speaker_id: null }] })).toEqual({ language_code: null, language_probability: null, duration_s: 0, words: 1, speakers: [], audio_events: 0, preview: "hi" });
    expect(summariseScribe({ words: [{ end: 1 }] }).preview).toBe("");
  });
});

describe("safeFileStem", () => {
  it("strips path characters and dots, trims, truncates, and falls back", () => {
    expect(safeFileStem('Cut v1.2: "final"/x')).toBe("Cut v1_2_ _final_x");
    expect(safeFileStem("...")).toBe("transcript");
    expect(safeFileStem("???", "sequence")).toBe("sequence");
    expect(safeFileStem("a".repeat(300))).toHaveLength(100);
  });
});

// ---------------------------------------------------------------- sequence sources

interface FakeClipOptions {
  mutate?: (clip: any) => void;
  file?: string;
}

function goodClip(file: string, options: FakeClipOptions = {}) {
  const level = { displayName: "Level", isTimeVarying: () => false, getValue: () => 0.17782794 };
  const clip: any = {
    nodeId: "clip-1",
    disabled: false,
    start: { seconds: 10 },
    inPoint: { seconds: 2.5 },
    outPoint: { seconds: 30 },
    getSpeed: () => 1,
    isSpeedReversed: () => 0,
    projectItem: { name: "Interview.mov", nodeId: "pi-1", type: 1, isSequence: () => false, getMediaPath: () => file },
    components: {
      numItems: 3,
      0: { displayName: "Volume", matchName: "Internal Volume", properties: { numItems: 2, 0: { displayName: "Bypass" }, 1: level } },
      1: { displayName: "Channel Volume", matchName: "Internal Channel Volume", properties: { numItems: 0 } },
      2: { displayName: "Panner", matchName: "Internal Panner", properties: { numItems: 0 } },
    },
    level,
  };
  options.mutate?.(clip);
  return clip;
}

function host(config: { tracks?: Array<{ muted?: boolean | "throw"; clips?: any[] | "throw" }>; activeId?: string | null; id?: string; name?: string; audioTracksThrow?: boolean }) {
  const tracks = (config.tracks ?? []).map((t) => ({
    isMuted: () => {
      if (t.muted === "throw") throw new Error("no mute");
      return t.muted ? 1 : 0;
    },
    clips: t.clips === "throw" ? new Proxy({}, { get() { throw new Error("no clips"); } }) : Object.assign({ numItems: t.clips?.length ?? 0 }, t.clips),
  }));
  const seq: any = {
    sequenceID: config.id ?? "seq-1",
    name: config.name ?? "Main Cut",
    audioTracks: config.audioTracksThrow ? new Proxy({}, { get() { throw new Error("no tracks"); } }) : Object.assign({ numTracks: tracks.length }, tracks),
  };
  const active = config.activeId === undefined ? seq : config.activeId === null ? null : { sequenceID: config.activeId };
  const app = { project: { activeSequence: active, sequences: { numSequences: 1, 0: seq } } };
  vi.mocked(sendCommand).mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app }))));
  return seq;
}

const seqArgs = () => ({ confirm_upload: true, approved_workspace_path: workspace, sequence_id: "seq-1" });
type Result = { success: boolean; error?: string; data: Record<string, any> };

describe("sequence source: direct media shortcut", () => {
  it("uses the clip's media file with offset = start - inPoint and the audible range", async () => {
    host({ tracks: [{ clips: [goodClip(media)] }] });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(true);
    expect(transcribe).toHaveBeenCalledWith(media, expect.anything(), KEY);
    expect(r.data).toMatchObject({
      source: "project_item_media",
      offset_seconds: 7.5,
      audible_source_range: { from_s: 2.5, to_s: 30 },
      media_shortcut_skipped: [],
      sequence: { id: "seq-1", name: "Main Cut" },
      upload_bytes: wavBytes.length,
    });
    expect(r.data.media).toEqual({ project_item_name: "Interview.mov", project_item_node_id: "pi-1", clip_node_id: "clip-1" });
    expect(JSON.stringify(r.data)).not.toContain(media);
    expect(r.data.transcript_path).toMatch(/Main Cut\.elevenlabs\.json$/);
    expect(r.data.next[0].arguments).toMatchObject({ offset: 7.5, from_s: 2.5, to_s: 30 });
    expect(exportHandler).not.toHaveBeenCalled();
  });

  it("returns the media path only when include_media_path is true", async () => {
    host({ tracks: [{ clips: [goodClip(media)] }] });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), include_media_path: true })) as Result;
    expect(r.data.media.path).toBe(media);
  });

  it("works for use_active_sequence and ignores muted tracks and disabled clips", async () => {
    const disabled = goodClip(media, { mutate: (c) => { c.disabled = true; } });
    host({ tracks: [{ muted: true, clips: [goodClip(media)] }, { clips: [disabled, goodClip(media)] }] });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, use_active_sequence: true })) as Result;
    expect(r.data.source).toBe("project_item_media");
    expect(vi.mocked(sendCommand).mock.calls[0][0]).toContain("__getCurrentActiveSequence()");
    expect(vi.mocked(sendCommand).mock.calls[0][0]).not.toContain("__findSequence(");
  });

  it("works for a sequence that is not active", async () => {
    host({ tracks: [{ clips: [goodClip(media)] }], activeId: "other" });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.data.source).toBe("project_item_media");
  });

  it("media_shortcut: false forces the export and says why", async () => {
    host({ tracks: [{ clips: [goodClip(media)] }] });
    const exported = join(workspace, "Main Cut transcription audio.mp3");
    writeFileSync(exported, wavBytes);
    exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: exported } });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), media_shortcut: false })) as Result;
    expect(r.data.source).toBe("sequence_export");
    expect(r.data.media_shortcut_skipped).toEqual(["media_shortcut was false"]);
    expect(transcribe).toHaveBeenCalledWith(exported, expect.anything(), KEY);
  });

  it("the generated script is ES3 and escapes the sequence id", () => {
    const hostile = 'seq"\\\n\'); app.project.injected = true; //';
    const script = buildSequenceAudioScript(hostile);
    acorn.parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true });
    acorn.parse(buildSequenceAudioScript(null), { ecmaVersion: 3, allowReturnOutsideFunction: true });
    expect(script).not.toContain(hostile);
    expect(script).not.toMatch(/\b(let|const)\b|=>|`/);
    expect(script).toContain('\\"');
  });
});

describe("sequence source: shortcut skipped, sequence exported", () => {
  const skipCases: Array<[string, (clip: any) => void, string]> = [
    ["nested sequence", (c) => { c.projectItem.isSequence = () => true; }, "nested sequence"],
    ["no project item", (c) => { c.projectItem = null; }, "no project item"],
    ["no media path", (c) => { c.projectItem.getMediaPath = () => ""; }, "no media file path"],
    ["media path throws", (c) => { c.projectItem.getMediaPath = () => { throw new Error("x"); }; }, "no media file path"],
    ["speed 2", (c) => { c.getSpeed = () => 2; }, "speed is 2"],
    ["speed throws", (c) => { c.getSpeed = () => { throw new Error("x"); }; }, "could not read the clip speed"],
    ["reversed", (c) => { c.isSpeedReversed = () => 1; }, "is reversed"],
    ["reversed unreadable", (c) => { c.isSpeedReversed = () => { throw new Error("x"); }; }, "whether the clip is reversed"],
    ["extra effect", (c) => { c.components[3] = { displayName: "Parametric Equalizer", matchName: "AE.ADBE Param EQ", properties: { numItems: 0 } }; c.components.numItems = 4; }, "extra audio component: Parametric Equalizer"],
    ["extra effect with only a match name", (c) => { c.components[3] = { displayName: "", matchName: "AE.Mystery", properties: { numItems: 0 } }; c.components.numItems = 4; }, "extra audio component: AE.Mystery"],
    ["extra effect with no names", (c) => { c.components[3] = { displayName: "", matchName: "", properties: { numItems: 0 } }; c.components.numItems = 4; }, "extra audio component: "],
    ["component names unreadable", (c) => { c.components[3] = { get displayName() { throw new Error("x"); }, get matchName() { throw new Error("y"); }, properties: { numItems: 0 } }; c.components.numItems = 4; }, "extra audio component: "],
    ["components unreadable", (c) => { c.components = new Proxy({}, { get() { throw new Error("x"); } }); }, "could not read the clip audio components"],
    ["no Volume component", (c) => { c.components = { numItems: 0 }; }, "no Volume > Level"],
    ["Volume without Level", (c) => { c.components[0].properties = { numItems: 1, 0: { displayName: "Bypass" } }; }, "no Volume > Level"],
    ["keyframed level", (c) => { c.level.isTimeVarying = () => true; }, "Volume Level has keyframes"],
    ["keyframes unreadable", (c) => { c.level.isTimeVarying = () => { throw new Error("x"); }; }, "whether Volume Level has keyframes"],
    ["level -6 dB", (c) => { c.level.getValue = () => 0.0891; }, "Volume Level is -6 dB, not 0 dB"],
    ["level silent", (c) => { c.level.getValue = () => 0; }, "Volume Level is silent"],
    ["level unreadable", (c) => { c.level.getValue = () => { throw new Error("x"); }; }, "could not read Volume Level"],
    ["times unreadable", (c) => { Object.defineProperty(c, "start", { get() { throw new Error("x"); } }); }, "clip start and source in/out"],
  ];

  it.each(skipCases)("skips the shortcut when %s", async (_label, mutate, reason) => {
    host({ tracks: [{ clips: [goodClip(media, { mutate })] }] });
    const exported = join(workspace, "Main Cut transcription audio.mp4");
    writeFileSync(exported, wavBytes);
    exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: exported } });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(true);
    expect(r.data.source).toBe("sequence_export");
    expect(r.data.offset_seconds).toBe(0);
    expect(r.data.audible_source_range).toBeNull();
    expect(r.data.media_shortcut_skipped.join(" | ")).toContain(reason);
    expect(transcribe).toHaveBeenCalledWith(exported, expect.anything(), KEY);
    expect(r.data.next[0].arguments).toMatchObject({ offset: 0 });
    expect(r.data.next[0].arguments).not.toHaveProperty("to_s");
  });

  it("skips when two clips are audible, one is on an unreadable track, or mute state cannot be read", async () => {
    host({ tracks: [{ clips: [goodClip(media)] }, { clips: [goodClip(media)] }, { muted: "throw", clips: [] }, { clips: "throw" }] });
    const exported = join(workspace, "Main Cut transcription audio.mp4");
    writeFileSync(exported, wavBytes);
    exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: exported } });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    const joined = r.data.media_shortcut_skipped.join(" | ");
    expect(joined).toContain("2 enabled clips on unmuted audio tracks");
    expect(joined).toContain("mute state of audio track A3");
    expect(joined).toContain("clips of audio track A4");
  });

  it("skips and says so when the clip's media file cannot be uploaded directly", async () => {
    for (const [file, text] of [[join(workspace, "..", "ct-odd.xyz"), "xyz is not a format"], [join(workspace, "..", "ct-gone.wav"), "not readable"]] as const) {
      if (file.endsWith(".xyz")) writeFileSync(file, "x");
      try {
        host({ tracks: [{ clips: [goodClip(file)] }] });
        const exported = join(workspace, `Main Cut transcription audio${file.endsWith(".xyz") ? "" : " 2"}.mp4`);
        writeFileSync(exported, wavBytes);
        exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: exported } });
        const { engine } = fakeEngine();
        const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
        expect(r.data.source).toBe("sequence_export");
        expect(r.data.media_shortcut_skipped.join(" ")).toContain(text.includes("xyz") ? ".xyz is not a format" : text);
      } finally {
        rmSync(file, { force: true });
      }
    }
  });

  describe("picture upload and the exported file", () => {
    const exportingTo = (ext: string) =>
      exportHandler.mockImplementation(async (args: { output_path: string }) => {
        const file = `${args.output_path}${ext}`;
        writeFileSync(file, wavBytes);
        return { success: true, data: { verified: true, outputPath: file } };
      });
    const twoClips = () => host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });

    it("warns that the default export carries the picture and names the file left in the workspace", async () => {
      twoClips();
      exportingTo(".mp4");
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
      const file = join(workspace, "Main Cut transcription audio.mp4");
      expect(r.success).toBe(true);
      expect(r.data.exported_file_left_in_workspace).toBe(file);
      expect(r.data.exported_file_deleted).toBe(false);
      expect(r.data.uploaded_file_kind).toBe("video (picture and sound)");
      expect(r.data.warnings.join(" ")).toMatch(/default H\.264 preset exported picture and sound/);
      expect(r.data.warnings.join(" ")).toMatch(/audio-only/);
      expect(fs.existsSync(file)).toBe(true);
    });

    it("exports with the audio-only preset it finds, uploads sound only and reports the preset", async () => {
      twoClips();
      exportingTo(".wav");
      const found = { path: join(workspace, "Waveform Audio 48kHz 16-bit.epr"), name: "Waveform Audio 48kHz 16-bit", format: "WAV", install: "Adobe Media Encoder 2026" };
      const findAudioPreset = vi.fn(() => found);
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine }, findAudioPreset }).handler(seqArgs())) as Result;
      expect(r.success).toBe(true);
      expect(findAudioPreset).toHaveBeenCalledOnce();
      expect(exportHandler).toHaveBeenCalledWith({ output_path: join(workspace, "Main Cut transcription audio"), preset_path: found.path, range: "entire" });
      expect(r.data.export_preset_used).toMatchObject({ source: "audio_only_default", path: found.path, format: "WAV" });
      expect(r.data.uploaded_file_kind).toBe("audio");
      expect(r.data.warnings).toEqual([]);
    });

    it("falls back to the default export with a warning when no audio-only preset is found, and when the search throws", async () => {
      for (const findAudioPreset of [() => null, () => { throw new Error("denied"); }]) {
        twoClips();
        exportingTo(".mp4");
        const { engine } = fakeEngine();
        const r = (await tool({ engines: { elevenlabs: engine }, findAudioPreset }).handler(seqArgs())) as Result;
        expect(r.success).toBe(true);
        expect(exportHandler.mock.calls.at(-1)![0]).not.toHaveProperty("preset_path");
        expect(r.data.export_preset_used).toEqual({ path: null, source: "h264_default" });
        expect(r.data.warnings.join(" ")).toMatch(/No audio-only Adobe Media Encoder preset was found/);
        rmSync(join(workspace, "Main Cut transcription audio.mp4"), { force: true });
      }
    });

    it("an explicit export_preset_path wins and the audio-only search is not run", async () => {
      twoClips();
      exportingTo(".mp3");
      const findAudioPreset = vi.fn(() => null);
      const preset = join(workspace, "mine.epr");
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine }, findAudioPreset }).handler({ ...seqArgs(), export_preset_path: preset })) as Result;
      expect(findAudioPreset).not.toHaveBeenCalled();
      expect(r.data.export_preset_used).toMatchObject({ source: "export_preset_path", path: preset });
    });

    it("deletes only that exported file after a successful upload when delete_export_after_upload is true", async () => {
      twoClips();
      exportingTo(".mp4");
      const other = join(workspace, "keep.txt");
      writeFileSync(other, "keep");
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r.success).toBe(true);
      expect(r.data.exported_file_deleted).toBe(true);
      expect(r.data.exported_file_left_in_workspace).toBeNull();
      expect(fs.existsSync(join(workspace, "Main Cut transcription audio.mp4"))).toBe(false);
      expect(fs.existsSync(other)).toBe(true);
      expect(fs.existsSync(r.data.transcript_path)).toBe(true);
    });

    it("keeps the exported file when the upload fails", async () => {
      twoClips();
      exportingTo(".mp4");
      const { engine } = fakeEngine({ transcribe: vi.fn(async () => { throw new TranscriptionError("api_error", "nope", 500); }) });
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r.success).toBe(false);
      expect(fs.existsSync(join(workspace, "Main Cut transcription audio.mp4"))).toBe(true);
    });

    it("does not delete a file it did not create inside the workspace", async () => {
      twoClips();
      exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: media } });
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r.success).toBe(true);
      expect(r.data.exported_file_deleted).toBe(false);
      expect(r.data.exported_file_left_in_workspace).toBe(media);
      expect(r.data.warnings.join(" ")).toMatch(/not a plain file this call created inside approved_workspace_path/);
      expect(fs.existsSync(media)).toBe(true);
    });

    it("does not delete a file in a sub-folder or with another name", async () => {
      twoClips();
      mkdirSync(join(workspace, "sub"));
      const nested = join(workspace, "sub", "Main Cut transcription audio.mp3");
      writeFileSync(nested, wavBytes);
      exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: nested } });
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r.data.exported_file_deleted).toBe(false);
      expect(fs.existsSync(nested)).toBe(true);
      const renamed = join(workspace, "Something else.mp3");
      writeFileSync(renamed, wavBytes);
      exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: renamed } });
      const r2 = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r2.data.exported_file_deleted).toBe(false);
      expect(fs.existsSync(renamed)).toBe(true);
    });

    it("reports a delete that fails and keeps naming the file", async () => {
      twoClips();
      exportingTo(".mp4");
      vi.mocked(fs.unlinkSync).mockImplementation((() => { throw new Error(`locked ${KEY}`); }) as never);
      const { engine } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r.success).toBe(true);
      expect(r.data.exported_file_deleted).toBe(false);
      expect(r.data.exported_file_left_in_workspace).toBe(join(workspace, "Main Cut transcription audio.mp4"));
      expect(r.data.warnings.join(" ")).toMatch(/could not be deleted \(locked /);
      expect(JSON.stringify(r)).not.toContain(KEY);
      vi.mocked(fs.unlinkSync).mockImplementation((() => { throw "plain failure"; }) as never);
      const r2 = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), delete_export_after_upload: true })) as Result;
      expect(r2.data.warnings.join(" ")).toMatch(/plain failure/);
    });

    it("gives no picture warning for an audio-only preset and an audio export, and a different one for a video export", async () => {
      twoClips();
      exportingTo(".mp3");
      const { engine } = fakeEngine();
      const audio = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), export_preset_path: join(workspace, "audio.epr") })) as Result;
      expect(audio.data.warnings).toEqual([]);
      expect(audio.data.uploaded_file_kind).toBe("audio");
      expect(audio.data.exported_file_left_in_workspace).toMatch(/\.mp3$/);
      exportingTo(".mov");
      const video = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), export_preset_path: join(workspace, "pic.epr") })) as Result;
      expect(video.data.warnings.join(" ")).toMatch(/exported file is a video file/);
    });

    it("warns for a video media_path and a video clip file, and says delete_export_after_upload has no effect without an export", async () => {
      const mov = media.replace(/\.wav$/, ".mov");
      writeFileSync(mov, wavBytes);
      const { engine } = fakeEngine();
      const direct = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: mov, delete_export_after_upload: true })) as Result;
      expect(direct.success).toBe(true);
      expect(direct.data.warnings.join(" ")).toMatch(/media_path is a video file: the picture is uploaded/);
      expect(direct.data.warnings.join(" ")).toMatch(/had no effect/);
      expect(direct.data).not.toHaveProperty("exported_file_left_in_workspace");
      host({ tracks: [{ clips: [goodClip(mov)] }] });
      const clip = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
      expect(clip.data.source).toBe("project_item_media");
      expect(clip.data.warnings.join(" ")).toMatch(/clip's media file is a video file/);
      const wav = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media })) as Result;
      expect(wav.data.warnings).toEqual([]);
      rmSync(mov, { force: true });
    });

    it("rejects a non-boolean delete_export_after_upload before anything is sent", async () => {
      const { engine, transcribe } = fakeEngine();
      const r = (await tool({ engines: { elevenlabs: engine } }).handler({ confirm_upload: true, approved_workspace_path: workspace, media_path: media, delete_export_after_upload: "yes" })) as Result;
      expect(r.success).toBe(false);
      expect(r.error).toContain("delete_export_after_upload must be a boolean");
      expect(transcribe).not.toHaveBeenCalled();
    });
  });

  it("passes the preset, a never-overwrite stem and an extensionless path to export_sequence", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    writeFileSync(join(workspace, "Main Cut transcription audio.mp4"), "old");
    writeFileSync(join(workspace, "Main Cut transcription audio 2.wav"), "old");
    const exported = join(workspace, "Main Cut transcription audio 3.mp4");
    exportHandler.mockImplementation(async () => { writeFileSync(exported, wavBytes); return { success: true, data: { verified: true, outputPath: exported, durationVerified: true } }; });
    const preset = join(tmpdir(), "x.epr");
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler({ ...seqArgs(), export_preset_path: preset })) as Result;
    expect(exportHandler).toHaveBeenCalledWith({ output_path: join(workspace, "Main Cut transcription audio 3"), preset_path: preset, range: "entire" });
    expect(r.data.media).toEqual({ name: "Main Cut transcription audio 3.mp4", path: exported });
  });

  it("omits preset_path when none is given, and cleans a dotted sequence name", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }], name: "Cut v1.2" });
    const exported = join(workspace, "Cut v1_2 transcription audio.mp4");
    exportHandler.mockImplementation(async () => { writeFileSync(exported, wavBytes); return { success: true, data: { verified: true, outputPath: exported } }; });
    const { engine } = fakeEngine();
    await tool({ engines: { elevenlabs: engine } }).handler(seqArgs());
    expect(exportHandler).toHaveBeenCalledWith({ output_path: join(workspace, "Cut v1_2 transcription audio"), range: "entire" });
  });

  it("gives up if every export name is taken", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    writeFileSync(join(workspace, "Main Cut transcription audio.mp4"), "x");
    for (let n = 2; n < 1000; n++) writeFileSync(join(workspace, `Main Cut transcription audio ${n}.mp4`), "x");
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.error).toContain("is taken");
  });

  it("uses an injected exportSequence instead of export_sequence", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    const exported = join(workspace, "Main Cut transcription audio.mp4");
    writeFileSync(exported, wavBytes);
    const exportSequence = vi.fn(async () => ({ success: true, data: { verified: true, outputPath: exported } }));
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine }, exportSequence }).handler(seqArgs())) as Result;
    expect(r.data.source).toBe("sequence_export");
    expect(exportSequence).toHaveBeenCalledOnce();
    expect(exportHandler).not.toHaveBeenCalled();
  });

  it("propagates a failed export with its diagnostics and sends nothing", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    exportHandler.mockResolvedValue({ success: false, error: "Premiere rejected the sequence export", data: { mutationOutcome: "not_applied" } });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.error).toContain("Premiere rejected the sequence export");
    expect(r.error).toContain("Nothing was sent");
    expect(r.data.export).toEqual({ mutationOutcome: "not_applied" });
    expect(r.data.media_shortcut_skipped.length).toBeGreaterThan(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("propagates a failed export that returned no data or no error text", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    exportHandler.mockResolvedValue({ success: false });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.error).toContain("unknown error");
    expect(r.data.export).toBeNull();
  });

  it("treats an unverified export as an error", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    exportHandler.mockResolvedValue({ success: true, data: { verified: false, outcome: "committed_unverified", outputPath: join(workspace, "a.mp4") } });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.error).toContain("not verified");
    expect(r.data.export).toMatchObject({ outcome: "committed_unverified" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("treats an unverified export with no data at all as an error", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    exportHandler.mockResolvedValue({ success: true });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.data.export).toBeNull();
  });

  it("refuses a verified export with no output path or an un-uploadable file", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }] });
    const { engine, transcribe } = fakeEngine();
    exportHandler.mockResolvedValue({ success: true, data: { verified: true } });
    expect(((await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result).error).toContain("no output path");
    const weird = join(workspace, "weird.xyz");
    writeFileSync(weird, "x");
    exportHandler.mockResolvedValue({ success: true, data: { verified: true, outputPath: weird } });
    expect(((await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result).error).toContain(".xyz is not a format");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("refuses to export a sequence that is not the active one and tells the caller what to do", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }], activeId: "other" });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.error).toContain("set_active_sequence");
    expect(r.data.media_shortcut_skipped.join(" ")).toContain("2 enabled clips");
    expect(exportHandler).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("refuses when there is no active sequence at all", async () => {
    host({ tracks: [{ clips: [goodClip(media), goodClip(media)] }], activeId: null });
    const { engine } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.error).toContain("set_active_sequence");
  });
});

describe("sequence source: nothing to transcribe or host trouble", () => {
  it("refuses a sequence with no audible clip", async () => {
    host({ tracks: [{ muted: true, clips: [goodClip(media)] }, { clips: [] }] });
    const { engine, transcribe } = fakeEngine();
    const r = (await tool({ engines: { elevenlabs: engine } }).handler(seqArgs())) as Result;
    expect(r.success).toBe(false);
    expect(r.error).toContain("nothing to transcribe");
    expect(transcribe).not.toHaveBeenCalled();
    expect(exportHandler).not.toHaveBeenCalled();
  });

  it("passes on a host error (sequence not found, audio tracks unreadable) and a bridge failure", async () => {
    host({ tracks: [], id: "other-id", name: "Other" });
    const { engine, transcribe } = fakeEngine();
    const run = () => tool({ engines: { elevenlabs: engine } }).handler(seqArgs()) as Promise<Result>;
    expect((await run()).error).toContain("Sequence not found");
    host({ audioTracksThrow: true });
    expect((await run()).error).toContain("Could not read the sequence audio tracks");
    vi.mocked(sendCommand).mockResolvedValue({ success: false });
    expect((await run()).error).toContain("Could not read the sequence audio; nothing was sent");
    vi.mocked(sendCommand).mockResolvedValue({ success: false, error: "Premiere is not responding" });
    expect((await run()).error).toBe("Premiere is not responding; nothing was sent.");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("does not call Premiere until the key, confirmation and workspace are checked", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    await tool().handler(seqArgs());
    await tool().handler({ ...seqArgs(), confirm_upload: false });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
