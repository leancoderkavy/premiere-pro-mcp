import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bridge/file-bridge.js")>();
  return { ...actual, sendCommand: vi.fn(), sendRawCommand: vi.fn() };
});

import {
  BRIDGE_HEARTBEAT_FILE,
  diagnoseBridgeBlocking,
  sendCommand,
  sendRawCommand,
} from "../../src/bridge/file-bridge.js";
import { getRecoveryTools } from "../../src/tools/recovery.js";
import { beginOperation, finishOperation, resetOperationLog } from "../../src/workflows/operation-log.js";

const NOW = 1_800_000_000_000;
const COMMAND_ID = "2f7f0f8e-secret-command-id";
const directories: string[] = [];

function bridgeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-blocking-test-"));
  directories.push(directory);
  return directory;
}

function writeAged(file: string, contents: string, ageMs: number): void {
  writeFileSync(file, contents);
  const when = new Date(NOW - ageMs);
  utimesSync(file, when, when);
}

function heartbeat(directory: string, state: "running" | "waiting", ageMs = 500): void {
  writeAged(join(directory, BRIDGE_HEARTBEAT_FILE), JSON.stringify({ protocolVersion: 1, commandSchemaVersion: 1, receiptVersion: 1, state }), ageMs);
}

function busyMarker(directory: string, elapsedMs: number | null, ageMs: number, id = COMMAND_ID): void {
  const body = elapsedMs === null ? "not json" : JSON.stringify({ id, elapsedMs });
  writeAged(join(directory, `busy_${id}.json`), body, ageMs);
}

function queued(directory: string, ageMs: number, id = "queued-command"): void {
  writeAged(join(directory, `cmd_${id}.jsx`), "var secret = '/Users/me/Private Media.mov';", ageMs);
}

function diagnose(directory: string, input: Parameters<typeof diagnoseBridgeBlocking>[2] = {}) {
  return diagnoseBridgeBlocking({ tempDir: directory }, NOW, input);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  resetOperationLog();
  vi.mocked(sendCommand).mockReset();
  vi.mocked(sendRawCommand).mockReset();
});

describe("diagnoseBridgeBlocking", () => {
  it("reports a missing bridge directory as a connector that has not started", () => {
    const directory = join(bridgeDirectory(), "never-created");
    expect(diagnose(directory)).toMatchObject({ state: "connector_not_running", reason: "bridge_directory_missing", commandSent: false });
  });

  it("refuses to read markers from a directory owned by another user or a symlink", () => {
    const directory = bridgeDirectory();
    busyMarker(directory, 60_000, 100);
    expect(diagnose(directory, { platform: "darwin", myUid: 987654 })).toMatchObject({
      state: "unknown", reason: "bridge_directory_untrusted", counts: { busyMarkers: 0 },
    });
    const link = join(bridgeDirectory(), "link");
    symlinkSync(directory, link);
    expect(diagnose(link)).toMatchObject({ state: "unknown", reason: "bridge_directory_untrusted" });
  });

  it("reports idle when the heartbeat is live and nothing is in flight", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    const result = diagnose(directory);
    expect(result).toMatchObject({
      state: "idle",
      reason: "panel_idle",
      heartbeat: { state: "running", ageMs: 500 },
      activeCommand: null,
      counts: { queuedCommands: 0, busyMarkers: 0 },
      windowProbe: { performed: false },
    });
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("reports busy with marker age, elapsed time, and the running tool name", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, 6_000, 1_000);
    const result = diagnose(directory, { runningToolCalls: [{ tool: "add_to_timeline", startedAt: new Date(NOW - 7_000).toISOString() }] });
    expect(result).toMatchObject({
      state: "busy",
      reason: "command_executing",
      activeCommand: { markerAgeMs: 1_000, elapsedMs: 6_000, expectedMs: 30_000, tool: "add_to_timeline" },
      counts: { busyMarkers: 1, freshBusyMarkers: 1, stalledBusyMarkers: 0 },
      runningToolCalls: [{ tool: "add_to_timeline", ageMs: 7_000 }],
    });
  });

  it("reports likely_blocked_by_dialog when a live panel's command runs past the expected time", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, 45_000, 800);
    busyMarker(directory, 3_000, 200, "other-engine");
    const result = diagnose(directory, {
      runningToolCalls: [
        { tool: "a", startedAt: new Date(NOW - 1).toISOString() },
        { tool: "b", startedAt: new Date(NOW - 2).toISOString() },
      ],
    });
    expect(result).toMatchObject({
      state: "likely_blocked_by_dialog",
      reason: "command_exceeded_expected_time",
      activeCommand: { elapsedMs: 45_000, tool: null },
      counts: { freshBusyMarkers: 2 },
    });
    expect(result.nextSteps.join(" ")).toMatch(/dismiss any open dialog/);
    expect(diagnose(directory, { expectedCommandMs: 60_000 }).state).toBe("busy");
  });

  it("uses the bridge timeout as the default expectation", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, 12_000, 100);
    expect(diagnoseBridgeBlocking({ tempDir: directory, timeoutMs: 10_000 }, NOW).state).toBe("likely_blocked_by_dialog");
  });

  it("stays busy when the marker elapsed time is unreadable or oversized", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, null, 100);
    expect(diagnose(directory)).toMatchObject({ state: "busy", activeCommand: { elapsedMs: null } });
    writeAged(join(directory, `busy_${COMMAND_ID}.json`), JSON.stringify({ elapsedMs: 99_000, pad: "x".repeat(400) }), 100);
    expect(diagnose(directory)).toMatchObject({ state: "busy", activeCommand: { elapsedMs: null } });
    writeAged(join(directory, `busy_${COMMAND_ID}.json`), "null", 100);
    expect(diagnose(directory)).toMatchObject({ state: "busy", activeCommand: { elapsedMs: null } });
  });

  it("reports stuck with an orphaned marker when the heartbeat is still live", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, 4_000, 20_000);
    busyMarker(directory, 2_000, 15_000, "older");
    expect(diagnose(directory)).toMatchObject({
      state: "stuck",
      reason: "busy_marker_orphaned",
      activeCommand: { markerAgeMs: 20_000 },
      counts: { stalledBusyMarkers: 2, freshBusyMarkers: 0 },
    });
  });

  it("reports stuck with a frozen panel when heartbeat and marker both stopped", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running", 25_000);
    busyMarker(directory, 4_000, 20_000);
    const result = diagnose(directory);
    expect(result).toMatchObject({ state: "stuck", reason: "panel_frozen_with_command_in_flight", heartbeat: { state: "stale" } });
    expect(result.nextSteps[0]).toMatch(/dismiss any open dialog/);
  });

  it("distinguishes stale, stopped, missing, and unreadable heartbeats", () => {
    const stale = bridgeDirectory();
    heartbeat(stale, "running", 9_000);
    expect(diagnose(stale)).toMatchObject({ state: "connector_not_running", reason: "heartbeat_stale" });

    const stopped = bridgeDirectory();
    heartbeat(stopped, "waiting");
    expect(diagnose(stopped)).toMatchObject({ state: "connector_not_running", reason: "connector_stopped" });

    const missing = bridgeDirectory();
    expect(diagnose(missing)).toMatchObject({ state: "connector_not_running", reason: "no_heartbeat" });

    const unreadable = bridgeDirectory();
    writeAged(join(unreadable, BRIDGE_HEARTBEAT_FILE), "{", 100);
    expect(diagnose(unreadable)).toMatchObject({ state: "unknown", reason: "heartbeat_unreadable" });
  });

  it("separates a starting command from a queue that is not draining", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    queued(directory, 300);
    mkdirSync(join(directory, "cmd_directory.jsx"));
    writeAged(join(directory, "cmd_staged.jsx.staged"), "x", 60_000);
    expect(diagnose(directory)).toMatchObject({ state: "busy", reason: "command_starting", counts: { queuedCommands: 1, oldestQueuedAgeMs: 300 } });
    queued(directory, 40_000, "old");
    expect(diagnose(directory)).toMatchObject({ state: "unknown", reason: "queue_not_draining", counts: { queuedCommands: 2, oldestQueuedAgeMs: 40_000 } });
  });

  it("never returns paths, file names, command ids, or command contents", () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running");
    busyMarker(directory, 45_000, 100);
    queued(directory, 100);
    const text = JSON.stringify(diagnose(directory));
    expect(text).not.toContain(directory);
    expect(text).not.toContain(COMMAND_ID);
    expect(text).not.toContain("busy_");
    expect(text).not.toContain("cmd_");
    expect(text).not.toContain("Private Media");
  });
});

describe("get_bridge_telemetry blocking diagnosis", () => {
  it("returns the diagnosis with the logged running tool and sends no command", async () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running", 0);
    writeFileSync(join(directory, `busy_${COMMAND_ID}.json`), JSON.stringify({ id: COMMAND_ID, elapsedMs: 50_000 }));
    const done = beginOperation("finished_tool");
    finishOperation(done, true, "verified");
    beginOperation("trim_clip");

    const result = await getRecoveryTools({ tempDir: directory }).get_bridge_telemetry.handler({});
    expect(result).toMatchObject({
      success: true,
      data: { busyOperations: 1, blocking: { state: "likely_blocked_by_dialog", activeCommand: { tool: "trim_clip" }, commandSent: false } },
    });
    expect(JSON.stringify(result)).not.toContain(directory);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(sendRawCommand).not.toHaveBeenCalled();
  });

  it("honors and validates expected_command_ms", async () => {
    const directory = bridgeDirectory();
    heartbeat(directory, "running", 0);
    writeFileSync(join(directory, `busy_${COMMAND_ID}.json`), JSON.stringify({ elapsedMs: 50_000 }));
    const tool = getRecoveryTools({ tempDir: directory }).get_bridge_telemetry;
    await expect(tool.handler({ expected_command_ms: 120_000 })).resolves.toMatchObject({ success: true, data: { blocking: { state: "busy" } } });
    await expect(tool.handler({ expected_command_ms: 10 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ expected_command_ms: 1.5 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler()).resolves.toMatchObject({ success: true });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
