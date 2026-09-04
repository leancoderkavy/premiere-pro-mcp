import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("node:util", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:util")>();
  return {
    ...original,
    promisify: () => (...args: any[]) => new Promise((resolve, reject) => {
      mockExecFile(...args, (error: Error | null, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
  };
});
vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { confirmationToken, getEditPlanTools, validateEditPlan } from "../../src/tools/edit-plans.js";
import {
  getExportTools,
  inspectExportPresetFile,
  MAX_CAPTURE_FRAME_BYTES,
  verifyDeliveryFile,
} from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const temporaryDirectories: string[] = [];
const bridgeOptions = { tempDir: "/tmp/coverage-tools", timeoutMs: 500 };

function temporaryPath(name: string, contents = "test content"): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-tool-coverage-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-tool-coverage-"));
  temporaryDirectories.push(directory);
  return directory;
}

function execSucceeds(stderr = ""): void {
  mockExecFile.mockImplementationOnce((...args: any[]) => {
    args.at(-1)(null, "", stderr);
  });
}

function execFails(error: Error): void {
  mockExecFile.mockImplementationOnce((...args: any[]) => {
    args.at(-1)(error, "", "");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendCommand.mockResolvedValue({ success: true, data: { host: "ok" } });
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("audio tool analysis coverage", () => {
  it("resolves a project item, runs ffmpeg, and returns silent and retained ranges", async () => {
    const mediaPath = temporaryPath("speech.mp4");
    mockedSendCommand.mockResolvedValueOnce({
      success: true,
      data: { mediaPath, name: "Interview" },
    });
    execSucceeds();
    execSucceeds([
      "Duration: 00:00:12.00, start: 0.000000",
      "[silencedetect] silence_start: 2",
      "[silencedetect] silence_end: 4.5 | silence_duration: 2.5",
      "[silencedetect] silence_start: 10",
    ].join("\n"));

    const result = await getAudioTools(bridgeOptions).detect_silence.handler({
      project_item_id: "interview-item",
      noise_threshold_db: -42,
      min_duration_seconds: 0.75,
    });

    expect(mockedSendCommand).toHaveBeenCalledOnce();
    expect(mockedSendCommand.mock.calls[0][0]).toContain("getMediaPath");
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: true,
      data: {
        mediaPath,
        projectItemName: "Interview",
        noiseThresholdDb: -42,
        minDurationSeconds: 0.75,
        totalDurationSeconds: 12,
        silenceIntervals: [
          { start: 2, end: 4.5, duration: 2.5 },
          { start: 10, end: 12, duration: 2 },
        ],
        segments: [
          { start: 0, end: 2, duration: 2 },
          { start: 4.5, end: 10, duration: 5.5 },
        ],
        silentSeconds: 4.5,
      },
    });
  });

  it("reports missing ffmpeg, timeouts, and useful analyser failure details", async () => {
    const mediaPath = temporaryPath("speech.mp4");
    const tools = getAudioTools(bridgeOptions);

    execFails(new Error("ENOENT"));
    await expect(tools.detect_silence.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("ffmpeg was not found") });

    execSucceeds();
    execFails(Object.assign(new Error("slow"), { killed: true }));
    await expect(tools.detect_silence.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out after 300s") });

    execSucceeds();
    execFails(Object.assign(new Error("failed"), {
      stderr: "first line\n\nsecond line\nthird line\nfourth line",
    }));
    await expect(tools.detect_silence.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("second line third line fourth line") });
  });

  it("renders audio adjustment, keyframe, and unmute options into the bridge script", async () => {
    const tools = getAudioTools(bridgeOptions);

    await tools.adjust_audio_levels.handler({ node_id: "clip\"id", level_db: -6 });
    // Premiere's Volume > Level uses +15 dB as its normalized maximum.
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("0.08912509381337455");

    await tools.add_audio_keyframes.handler({
      node_id: "clip",
      keyframes: [{ time_seconds: 1.25, level_db: -Infinity }],
    });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("1e-7");

    await tools.mute_track.handler({ track_index: 3, muted: false });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("track.setMute(0)");
  });
});

describe("edit plan validation and apply coverage", () => {
  it.each([
    [null, "plan must be an object"],
    [{}, "plan.operations must contain at least one operation"],
    [{ operations: Array.from({ length: 101 }, () => ({ type: "remove_clip", node_id: "clip" })) }, "limited to 100"],
    [{ operations: [null] }, "operation 0 must be an object"],
    [{ operations: [{ type: "insert_clip", start_seconds: 0 }] }, "requires item_id"],
    [{ operations: [{ type: "insert_clip", item_id: "item", start_seconds: Number.NaN }] }, "non-negative number"],
    [{ operations: [{ type: "insert_clip", item_id: "item", start_seconds: 0, video_track_index: -1 }] }, "video_track_index"],
    [{ operations: [{ type: "insert_clip", item_id: "item", start_seconds: 0, audio_track_index: 1.5 }] }, "audio_track_index"],
    [{ operations: [{ type: "remove_clip", node_id: "" }] }, "requires node_id"],
  ])("rejects %j", (value, message) => {
    expect(() => validateEditPlan(value)).toThrow(message);
  });

  it("previews destructive and non-destructive work with stable confirmation", async () => {
    const plan = {
      operations: [
        { type: "insert_clip" as const, item_id: "source", start_seconds: 2 },
        { type: "remove_clip" as const, node_id: "old-clip", ripple: true },
      ],
    };
    const tools = getEditPlanTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect"]), source: "explicit" },
      operationIdFactory: () => "preview-mixed",
    });

    const result = await tools.preview_edit_plan.handler({ plan });
    expect(result).toMatchObject({
      success: true,
      data: {
        operationId: "preview-mixed",
        confirmationToken: confirmationToken(plan),
        changes: [
          { type: "insert_clip", target: "source", destructive: false },
          { type: "remove_clip", target: "old-clip", destructive: true },
        ],
      },
    });
    expect(confirmationToken({ ...plan, sequence_id: "other" })).not.toBe(confirmationToken(plan));
  });

  it("builds a remove plan against a named sequence and decorates bridge failures", async () => {
    const plan = {
      sequence_id: "seq\"one",
      operations: [
        { type: "remove_clip" as const, node_id: "old-clip", ripple: true },
        { type: "insert_clip" as const, item_id: "new-item", start_seconds: 3, video_track_index: 2, audio_track_index: 4 },
      ],
    };
    const auditSink = vi.fn();
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "Premiere rejected the edit" });
    const tools = getEditPlanTools(bridgeOptions, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink,
      operationIdFactory: () => "apply-remove",
    });

    const result = await tools.apply_edit_plan.handler({
      plan,
      confirmation_token: confirmationToken(plan),
    });
    const script = String(mockedSendCommand.mock.calls[0][0]);

    expect(script).toContain('__findSequence("seq\\"one")');
    expect(script).toContain("function __planFindClip");
    expect(script).toContain("found0.remove(true, true)");
    expect(result).toEqual({ success: false, error: "Premiere rejected the edit (operation apply-remove)" });
    expect(auditSink.mock.calls.map(([event]) => event.outcome)).toEqual(["started", "failed"]);
  });
});

describe("export verification and host-result coverage", () => {
  it("validates a SHA-512 delivery and rejects malformed size constraints", async () => {
    const delivery = temporaryPath("delivery.mov", "delivery data");
    const checksum = createHash("sha512").update("delivery data").digest("hex");

    await expect(verifyDeliveryFile(delivery, { minimumSizeBytes: -1 })).rejects.toThrow("minimum_size_bytes");
    await expect(verifyDeliveryFile(delivery, { expectedSizeBytes: 1.5 })).rejects.toThrow("expected_size_bytes");
    await expect(verifyDeliveryFile(temporaryDirectory())).rejects.toThrow("not a regular file");

    await expect(verifyDeliveryFile(delivery, {
      algorithm: "sha512",
      expectedChecksum: ` ${checksum.toUpperCase()} `,
      expectedSizeBytes: 13,
      minimumSizeBytes: 0,
    })).resolves.toMatchObject({
      checksum: { algorithm: "sha512", value: checksum },
      matchesExpectedChecksum: true,
      matchesExpectedSize: true,
      valid: true,
    });
  });

  it("surfaces local preset and delivery errors, then merges a host-validated preset response", async () => {
    const tools = getExportTools(bridgeOptions);
    const invalid = temporaryPath("preset.xml", "preset");
    await expect(tools.validate_export_preset.handler({ preset_path: invalid }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining(".epr") });
    expect(mockedSendCommand).not.toHaveBeenCalled();

    const preset = temporaryPath("preset.epr", "preset");
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "No active sequence" });
    await expect(tools.validate_export_preset.handler({ preset_path: preset }))
      .resolves.toEqual({ success: false, error: "No active sequence" });

    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { outputExtension: ".mov" } });
    await expect(tools.validate_export_preset.handler({ preset_path: preset }))
      .resolves.toMatchObject({ success: true, data: { path: preset, outputExtension: ".mov", hostValidated: true } });
    expect(inspectExportPresetFile(preset).sizeBytes).toBe(6);

    await expect(tools.verify_delivery_file.handler({ output_path: join(tmpdir(), "missing-delivery.mov") }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("does not exist") });
  });

  it("reads a host-exported frame, reports unreadable output, and covers proxy script choices", async () => {
    const tools = getExportTools(bridgeOptions);
    const frame = temporaryPath("frame.png", "png bytes");
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { outputPath: frame } });
    await expect(tools.capture_frame.handler({ time_seconds: 3 })).resolves.toMatchObject({
      success: true,
      data: { captured: true, mimeType: "image/png", base64: Buffer.from("png bytes").toString("base64") },
    });
    expect(existsSync(frame)).toBe(false);

    const oversizedFrame = temporaryPath("oversized-frame.png", "x".repeat(MAX_CAPTURE_FRAME_BYTES + 1));
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { outputPath: oversizedFrame } });
    await expect(tools.capture_frame.handler({})).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("inline response limit"),
    });
    expect(existsSync(oversizedFrame)).toBe(false);

    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { outputPath: temporaryDirectory() } });
    await expect(tools.capture_frame.handler({})).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Failed to read captured frame"),
    });

    await tools.manage_proxies.handler({ item_id: "item", action: "create" });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("output_path is required");
    await tools.manage_proxies.handler({ item_id: "item", action: "create", output_path: "proxy.mov" });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("__findProxyPreset()");
    await tools.manage_proxies.handler({ item_id: "item", action: "create", output_path: "proxy.mov", preset_path: "proxy.epr" });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain('var presetPath = "proxy.epr"');
    await tools.manage_proxies.handler({ item_id: "item", action: "attach" });
    expect(mockedSendCommand.mock.calls.at(-1)?.[0]).toContain("proxy_path is required for attach action");
  });
});
