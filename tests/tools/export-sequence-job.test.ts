import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { existsSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationSeconds: vi.fn() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { probeMediaDurationSeconds } from "../../src/tools/media-evidence.js";
import { getExportTools } from "../../src/tools/export.js";
import { MAX_EXPORT_JOBS, resetExportJobs } from "../../src/tools/export-job-store.js";

const TICKS = 254016000000;
const mockedSend = vi.mocked(sendCommand);
const mockedProbe = vi.mocked(probeMediaDurationSeconds);
const tools = getExportTools({ tempDir: "/tmp/bridge", timeoutMs: 5000 });
type Handler = (jobID: unknown, detail?: unknown) => void;

let workDir: string;
let presetPath: string;

/** A fake Premiere/AME host that really runs the generated ExtendScript. */
function makeHost(options: { bind?: boolean; jobId?: string; savedPath?: string; extension?: string } = {}) {
  const handlers: Record<string, Handler> = {};
  const dollar = { global: {} as Record<string, unknown> };
  const scripts: string[] = [];
  class File {
    fsName: string;
    constructor(path: string) { this.fsName = path; }
    get exists() { return this.fsName === presetPath || existsSync(this.fsName); }
    get parent() { return { exists: existsSync(dirname(this.fsName)), fsName: dirname(this.fsName) }; }
  }
  const encoder: Record<string, unknown> = {
    ENCODE_ENTIRE: 0, ENCODE_IN_TO_OUT: 1, ENCODE_WORKAREA: 2,
    launchEncoder: vi.fn(),
    encodeSequence: vi.fn(() => options.jobId ?? "ame-7"),
    startBatch: vi.fn(() => true),
    isRunning: vi.fn(() => true),
  };
  if (options.bind !== false) encoder.bind = vi.fn((name: string, fn: Handler) => { handlers[name] = fn; });
  const seq = {
    end: String(TICKS * 10), timebase: String(TICKS / 25),
    getExportFileExtension: () => options.extension ?? "mp4",
    getInPoint: () => "2", getOutPoint: () => "6",
  };
  const app = { project: { activeSequence: seq, path: options.savedPath ?? "/work/show.prproj" }, encoder };
  const run = (script: string) => {
    scripts.push(script);
    return JSON.parse(String(runInNewContext(script, {
      app, File, $: dollar, TICKS_PER_SECOND: TICKS,
      __sequencePointSeconds: (value: unknown) => Number(value),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
      __error: (message: string, data?: unknown) => JSON.stringify({ success: false, error: message, data }),
    })));
  };
  mockedSend.mockImplementation(async (script) => run(String(script)));
  return { handlers, dollar, encoder, scripts };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExportJobs();
  workDir = mkdtempSync(join(tmpdir(), "export-job-"));
  presetPath = join(workDir, "H264.epr");
  writeFileSync(presetPath, "<ExportPreset><Name>H.264</Name></ExportPreset>");
  mockedProbe.mockResolvedValue(null);
});
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

async function start(args: Record<string, unknown> = {}) {
  return tools.export_sequence_job_start.handler({ output_path: join(workDir, "episode.mp4"), preset_path: presetPath, ...args } as never);
}
const status = (jobId: string) => tools.get_export_job_status.handler({ job_id: jobId, stability_window_ms: 250 });

describe("export_sequence_job_start", () => {
  it("queues an AME job, binds job events once, and returns a tracked job id at once", async () => {
    const host = makeHost();
    const result = await start();
    expect(result).toMatchObject({
      success: true,
      data: { accepted: true, verified: false, outcome: "committed_unverified", ameJobId: "ame-7", status: "queued", eventsBound: true, queueBatchStart: "requested", expectedDurationSeconds: 10, range: "entire" },
    });
    expect((result.data as { jobId: string }).jobId).toMatch(/^cepexp-[0-9a-f]{12}-[0-9a-f]{16}$/);
    expect(host.encoder.encodeSequence).toHaveBeenCalledWith(expect.anything(), join(workDir, "episode.mp4"), presetPath, 0, true);
    expect(Object.keys(host.handlers).sort()).toEqual(["onEncoderJobCanceled", "onEncoderJobComplete", "onEncoderJobError", "onEncoderJobProgress", "onEncoderJobQueued"]);
    await start({ output_path: join(workDir, "second.mp4") });
    expect(host.encoder.bind).toHaveBeenCalledTimes(5);
    expect(host.scripts[0]).not.toMatch(/\blet\b|\bconst\b|=>/);
  });

  it("only queues when start_batch is false and says how to start the queue", async () => {
    const host = makeHost();
    const result = await start({ start_batch: false });
    expect(host.encoder.startBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, data: { queueBatchStart: "not_requested", nextStep: expect.stringContaining("start_batch_encode") } });
  });

  it("passes the requested range mode and refuses ranges that would encode the whole timeline", async () => {
    const host = makeHost();
    expect(await start({ range: "in_to_out" })).toMatchObject({ success: true, data: { rangeStartSeconds: 2, expectedDurationSeconds: 4 } });
    expect(host.encoder.encodeSequence).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), expect.any(String), 1, true);
    const refused = await start({ output_path: join(workDir, "wa.mp4"), range: "work_area" });
    expect(refused).toMatchObject({ success: false, error: expect.stringContaining("work area enabled") });
    expect(host.encoder.encodeSequence).toHaveBeenCalledTimes(1);
  });

  it("refuses before contacting Premiere without a preset, with a Same as Project preset, or with an existing output", async () => {
    makeHost();
    expect(await tools.export_sequence_job_start.handler({ output_path: join(workDir, "a.mp4") } as never)).toMatchObject({ success: false, error: expect.stringContaining("preset_path is required") });
    const sameAsProject = join(workDir, "same.epr");
    writeFileSync(sameAsProject, "<Destination>SameAsProject</Destination>");
    expect(await start({ preset_path: sameAsProject })).toMatchObject({ success: false, error: expect.stringContaining("Same as Project") });
    expect(await start({ preset_path: join(workDir, "preset.txt") })).toMatchObject({ success: false, error: expect.stringContaining(".epr") });
    writeFileSync(join(workDir, "episode.mp4"), "old");
    expect(await start()).toMatchObject({ success: false, error: expect.stringContaining("already exists") });
    expect(await start({ range: "everything" })).toMatchObject({ success: false, error: expect.stringContaining("range must be") });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("refuses unsaved projects, missing folders, and extension mismatches inside Premiere without queuing", async () => {
    let host = makeHost({ savedPath: "" });
    expect(await start()).toMatchObject({ success: false, error: expect.stringContaining("Save the Premiere project") });
    host = makeHost();
    expect(await start({ output_path: join(workDir, "missing", "a.mp4") })).toMatchObject({ success: false, error: expect.stringContaining("output folder does not exist") });
    host = makeHost({ extension: "mov" });
    expect(await start()).toMatchObject({ success: false, error: expect.stringContaining("preset writes .mov") });
    expect(host.encoder.encodeSequence).not.toHaveBeenCalled();
  });

  it("escapes paths with quotes, backslashes, and newlines before embedding them", async () => {
    makeHost();
    const tricky = join(workDir, 'ep "1"\\x\n");app.quit();(".mp4');
    await start({ output_path: tricky });
    const script = String(mockedSend.mock.calls[0][0]);
    expect(script).toContain('ep \\"1\\"\\\\x\\n\\");app.quit();(\\".mp4');
    expect(script).not.toContain('ep "1"');
  });

  it("reports a host rejection without registering a job", async () => {
    const host = makeHost({ jobId: "0" });
    expect(await start()).toMatchObject({ success: false, error: expect.stringContaining("did not queue") });
    expect(host.encoder.startBatch).not.toHaveBeenCalled();
  });

  it("fails closed when the host receipt has no usable AME job id", async () => {
    mockedSend.mockResolvedValue({ success: true, data: { ameJobId: "bad id with spaces", outputPath: "/x.mp4" } });
    expect(await start()).toMatchObject({ success: false, data: { outcome: "unknown" } });
  });
});

describe("get_export_job_status", () => {
  it("reports queued, then encoding with AME progress, then a verified completion", async () => {
    const host = makeHost();
    const started = await start();
    const jobId = (started.data as { jobId: string }).jobId;
    const output = join(workDir, "episode.mp4");

    expect(await status(jobId)).toMatchObject({ success: true, data: { status: "queued", terminal: false, verified: false, progressPercent: null } });

    host.handlers.onEncoderJobProgress("ame-7", 0.42);
    writeFileSync(output, "partial");
    expect(await status(jobId)).toMatchObject({ success: true, data: { status: "encoding", progressPercent: 42, progressSource: "ame_job_progress_event", evidenceSources: ["ame_job_events", "output_file_observation"] } });

    appendFileSync(output, "-rest");
    host.handlers.onEncoderJobComplete("ame-7", output);
    mockedProbe.mockResolvedValue(10.01);
    const done = await status(jobId);
    expect(done).toMatchObject({
      success: true,
      data: {
        status: "completed", terminal: true, verified: true, outcome: "verified", verificationIssues: [],
        evidence: { outputFile: { exists: true, sizeBytes: 12, stableAcrossWindow: true }, duration: { verified: true, actualSeconds: 10.01 } },
      },
    });
    expect(mockedProbe).toHaveBeenCalledWith(output);
    // A terminal report is cached; Premiere is not asked again.
    const calls = mockedSend.mock.calls.length;
    expect(await status(jobId)).toMatchObject({ data: { status: "completed", cached: true } });
    expect(mockedSend.mock.calls.length).toBe(calls);
  });

  it("never reads an ambiguous progress of 1 as 100 % or completes a stable file on it", async () => {
    const host = makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    writeFileSync(join(workDir, "episode.mp4"), "header");
    host.handlers.onEncoderJobProgress("ame-7", 2);
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", progressPercent: 2 } });
    // This host has now shown it reports percent, so 1 means 1 %, not done,
    // even though the file did not change across two polls.
    host.handlers.onEncoderJobProgress("ame-7", 1);
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", progressPercent: 1, terminal: false } });
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", terminal: false } });
  });

  it("does not complete on progress alone while the progress scale is unknown", async () => {
    const host = makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    writeFileSync(join(workDir, "episode.mp4"), "header");
    host.handlers.onEncoderJobProgress("ame-7", 1);
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", terminal: false } });
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", terminal: false } });
  });

  it("does not verify a completed render whose duration is wrong or cannot be probed", async () => {
    const host = makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    writeFileSync(join(workDir, "episode.mp4"), "data");
    host.handlers.onEncoderJobComplete("ame-7", join(workDir, "episode.mp4"));
    mockedProbe.mockResolvedValue(3);
    expect(await status(jobId)).toMatchObject({ data: { status: "completed", verified: false, outcome: "committed_unverified", verificationIssues: ["duration_mismatch"] } });
  });

  it("flags an AME completion event for a different file and a completion with no file", async () => {
    const host = makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    host.handlers.onEncoderJobComplete("ame-7", join(workDir, "episode_1.mp4"));
    expect(await status(jobId)).toMatchObject({ data: { status: "failed", terminal: false, reason: expect.stringContaining("no non-empty file") } });
    writeFileSync(join(workDir, "episode.mp4"), "data");
    mockedProbe.mockResolvedValue(10);
    expect(await status(jobId)).toMatchObject({ data: { status: "completed", verified: false, verificationIssues: ["ame_reported_a_different_output_path"] } });
  });

  it("reports AME job errors and cancellations as terminal", async () => {
    const host = makeHost();
    const failedId = ((await start()).data as { jobId: string }).jobId;
    host.handlers.onEncoderJobError("ame-7", "Disk full");
    expect(await status(failedId)).toMatchObject({ data: { status: "failed", terminal: true, verified: false, reason: expect.stringContaining("Disk full") } });

    (host.encoder.encodeSequence as ReturnType<typeof vi.fn>).mockReturnValue("ame-8");
    const cancelledId = ((await start({ output_path: join(workDir, "b.mp4") })).data as { jobId: string }).jobId;
    host.handlers.onEncoderJobCanceled("ame-8");
    expect(await status(cancelledId)).toMatchObject({ data: { status: "cancelled", terminal: true } });
    // Events for jobs this server did not start are ignored.
    host.handlers.onEncoderJobComplete("someone-else", "/elsewhere.mp4");
    expect(Object.keys((host.dollar.global.__premiereMcpAmeExportJobsV1 as { jobs: object }).jobs)).toEqual(["ame-7", "ame-8"]);
  });

  it("falls back to file stability when no AME event reaches the engine, without claiming verification", async () => {
    makeHost({ bind: false });
    const started = await start();
    expect(started).toMatchObject({ data: { eventsBound: false } });
    const jobId = (started.data as { jobId: string }).jobId;
    const output = join(workDir, "episode.mp4");
    writeFileSync(output, "frames");
    utimesSync(output, new Date(1_000_000), new Date(1_000_000));
    mockedProbe.mockResolvedValue(10);
    // First sighting: stable within the window but no earlier poll to compare against.
    expect(await status(jobId)).toMatchObject({ data: { status: "encoding", evidenceSources: ["output_file_observation"] } });
    const second = await status(jobId);
    expect(second).toMatchObject({
      data: { status: "completed", terminal: false, verified: false, outcome: "committed_unverified", verificationIssues: ["no_ame_completion_event_observed"], reason: expect.stringContaining("paused encode") },
    });
  });

  it("reports unknown when Premiere is unreachable and no file exists, without failing the status read", async () => {
    makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    mockedSend.mockResolvedValueOnce({ success: false, error: "Command timed out" });
    expect(await status(jobId)).toMatchObject({ success: true, data: { status: "unknown", evidence: { hostEvents: { available: false } }, reason: expect.stringContaining("Unknown is not success") } });
  });

  it("reports unknown when Premiere lost the engine-global event record", async () => {
    const host = makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    delete host.dollar.global.__premiereMcpAmeExportJobsV1;
    expect(await status(jobId)).toMatchObject({ data: { status: "unknown", evidence: { hostEvents: { eventStore: "absent" } } } });
  });

  it("distinguishes a server restart from an unknown or malformed job id", async () => {
    makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    resetExportJobs({ simulateRestart: true });
    expect(await status(jobId)).toMatchObject({ success: false, data: { status: "unknown", reason: "server_restarted" }, error: expect.stringContaining("earlier or different MCP server process") });
    const fresh = jobId.replace(/-[0-9a-f]{16}$/, "-0000000000000000").replace(/^cepexp-[0-9a-f]{12}/, `cepexp-${"f".repeat(12)}`);
    expect((await status(fresh)).data).toMatchObject({ status: "unknown" });
    expect(await status("not-a-job")).toMatchObject({ success: false, data: { reason: "malformed_job_id" } });
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it("reports a same-process id that is no longer tracked as not found", async () => {
    makeHost();
    const jobId = ((await start()).data as { jobId: string }).jobId;
    resetExportJobs();
    expect(await status(jobId)).toMatchObject({ success: false, data: { reason: "not_found_or_evicted" } });
  });

  it("escapes the AME job id in the status script and validates the window", async () => {
    makeHost({ jobId: 'a"b' });
    expect(await start()).toMatchObject({ success: false });
    makeHost({ jobId: "job:1.2" });
    const jobId = ((await start()).data as { jobId: string }).jobId;
    await status(jobId);
    expect(String(mockedSend.mock.calls.at(-1)![0])).toContain('store.jobs["job:1.2"]');
    expect(mockedSend.mock.calls.at(-1)![1]).toMatchObject({ mutating: false });
    expect(await tools.get_export_job_status.handler({ job_id: jobId, stability_window_ms: 50 })).toMatchObject({ success: false, error: expect.stringContaining("stability_window_ms") });
  });

  it("refuses new jobs when every slot holds an unfinished job", async () => {
    const host = makeHost();
    let counter = 0;
    (host.encoder.encodeSequence as ReturnType<typeof vi.fn>).mockImplementation(() => `ame-${++counter}`);
    for (let index = 0; index < MAX_EXPORT_JOBS; index++) expect(await start({ output_path: join(workDir, `out-${index}.mp4`) })).toMatchObject({ success: true });
    const before = mockedSend.mock.calls.length;
    expect(await start({ output_path: join(workDir, "overflow.mp4") })).toMatchObject({ success: false, error: expect.stringContaining("EXPORT_JOB_CAPACITY") });
    expect(mockedSend.mock.calls.length).toBe(before);
  });
});
