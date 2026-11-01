import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { cleanupTempDir, sendCommand } from "../../src/bridge/file-bridge.js";

// File transport unit tests isolate ownership; real multi-process lease behavior
// is exercised by host-lease.test.ts using the actual filesystem.
vi.mock("../../src/bridge/host-lease.js", () => ({
  withHostLease: async (_directory: string, _timeout: number, work: () => Promise<unknown>) => work(),
  ownsHostLease: () => false,
  inspectHostRecovery: () => ({ version: 1, recoveryRequired: false, recoveryRevision: null }),
  markHostRecovery: vi.fn(),
  HostLeaseError: class extends Error {},
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  lstatSync: vi.fn(),
  realpathSync: vi.fn(),
  writeFileSync: vi.fn(),
  openSync: vi.fn(() => 3),
  closeSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(),
  chmodSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const fs = {
  exists: vi.mocked(existsSync),
  mkdir: vi.mocked(mkdirSync),
  lstat: vi.mocked(lstatSync),
  realpath: vi.mocked(realpathSync),
  write: vi.mocked(writeFileSync),
  read: vi.mocked(readFileSync),
  unlink: vi.mocked(unlinkSync),
  readdir: vi.mocked(readdirSync),
  rename: vi.mocked(renameSync),
  stat: vi.mocked(statSync),
  chmod: vi.mocked(chmodSync),
  watch: vi.mocked(watch),
  execFile: vi.mocked(execFileSync),
};

describe("file bridge fallback and cleanup branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fs.mkdir.mockReturnValue(undefined);
    fs.realpath.mockImplementation((value) => String(value));
    fs.lstat.mockReturnValue({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as ReturnType<typeof lstatSync>);
    fs.execFile.mockReturnValue(JSON.stringify({
      ownerSid: "S-1-5-21-1000",
      currentUserSid: "S-1-5-21-1000",
      unsafeWriteAces: [],
    }) as never);
    fs.stat.mockReturnValue({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      mtimeMs: Date.now(),
    } as ReturnType<typeof statSync>);
    fs.watch.mockImplementation(() => { throw new Error("watch unavailable"); });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("extends a busy operation, then reports a likely modal dialog", async () => {
    let busy = true;
    fs.exists.mockImplementation((path) => {
      const value = String(path);
      if (value.includes("res_")) return false;
      if (value.includes("busy_")) return busy;
      return true;
    });
    fs.stat.mockImplementation(() => ({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      mtimeMs: Date.now(),
    } as ReturnType<typeof statSync>));

    const response = sendCommand("var operation = true;", {
      tempDir: "/tmp/busy-bridge",
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(500);
    busy = false;
    await vi.advanceTimersByTimeAsync(300);

    await expect(response).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("modal dialog"),
    });
  });

  it("fails at once instead of waiting for the hard cap when the busy file has not changed for 10 s (crashed panel)", async () => {
    fs.exists.mockImplementation((path) => {
      const value = String(path);
      if (value.includes("res_")) return false;
      if (value.includes("busy_")) return true;
      return true;
    });
    const staleSince = Date.now() - 60_000;
    fs.stat.mockImplementation(((path) => ({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      mtimeMs: String(path).includes("busy_") ? staleSince : Date.now(),
      size: 64,
    })) as unknown as typeof statSync);
    const response = sendCommand("var stuck = true;", { tempDir: "/tmp/stuck-busy-bridge", timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(response).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("CEP panel appears stuck"),
    });
  });

  it("keeps waiting for a claimed command while its own busy file is still being refreshed", async () => {
    let responded = false;
    fs.exists.mockImplementation((path) => {
      const value = String(path);
      if (value.includes("res_")) return responded;
      if (value.includes("busy_")) return !responded;
      if (value.includes("cmd_")) return false; // CEP claimed the command before starting it
      return true;
    });
    fs.stat.mockImplementation((() => ({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      mtimeMs: Date.now(),
      size: 64,
    })) as unknown as typeof statSync);
    fs.read.mockReturnValue('{"success":true,"data":{"imported":5}}');

    const response = sendCommand("var longImport = true;", { tempDir: "/tmp/fresh-busy-bridge", timeoutMs: 100 });
    let settled = false;
    void response.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    responded = true;
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(response).resolves.toMatchObject({ success: true, data: { imported: 5 } });
  });

  it("names the configured host in the no-connector timeout", async () => {
    fs.exists.mockImplementation((path) => !String(path).includes("res_") && !String(path).includes("busy_"));
    fs.stat.mockImplementation((() => ({
      uid: typeof process.getuid === "function" ? process.getuid() : 0,
      mode: 0o700,
      mtimeMs: Date.now(),
    })) as unknown as typeof statSync);
    const response = sendCommand("var ae = true;", { tempDir: "/tmp/ae-bridge", timeoutMs: 50, hostLabel: "After Effects" });
    await vi.advanceTimersByTimeAsync(500);
    await expect(response).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Is the MCP connector panel running in After Effects?"),
    });
  });

  it("ignores unrelated watch events and disables a failed watcher", async () => {
    let responseExists = false;
    let change: ((event: string, filename: string | Buffer | null) => void) | undefined;
    let watcherError: (() => void) | undefined;
    const watcher = {
      close: vi.fn(),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "error") watcherError = callback;
        return watcher;
      }),
    };
    fs.watch.mockImplementation(((_path, _options, callback) => {
      change = callback;
      return watcher;
    }) as typeof watch);
    fs.exists.mockImplementation((path) => String(path).includes("res_") ? responseExists : true);
    fs.read.mockReturnValue('{"success":true,"data":{"watched":true}}');

    const response = sendCommand("var watched = true;", { tempDir: "/tmp/watch-bridge" });
    change?.("rename", null);
    change?.("rename", "unrelated.json");
    watcherError?.();
    responseExists = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(response).resolves.toEqual({ success: true, data: { watched: true } });
    expect(watcher.close).toHaveBeenCalled();
  });

  it("tolerates unlink failures and removes busy protocol files", async () => {
    fs.exists.mockReturnValue(true);
    fs.read.mockReturnValue('{"success":true}');
    fs.unlink.mockImplementation(() => { throw new Error("locked"); });

    const response = sendCommand("var cleanup = true;", { tempDir: "/tmp/cleanup-bridge" });
    await expect(response).resolves.toEqual({ success: true });

    fs.readdir.mockReturnValue([
      "busy_1.json", "cmd_1.jsx", "res_1.json", "helpers.jsx",
    ] as ReturnType<typeof readdirSync>);
    expect(() => cleanupTempDir({ tempDir: "/tmp/cleanup-bridge" })).not.toThrow();
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining("busy_1.json"));
  });

  it("skips POSIX ownership changes on Windows while checking response bounds", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    fs.exists.mockReturnValue(true);
    fs.read.mockReturnValue('{"success":true}');

    await expect(sendCommand("var windows = true;", {
      tempDir: "C:\\Temp\\premiere-bridge",
    })).resolves.toEqual({ success: true });
    expect(fs.stat).toHaveBeenCalledWith(expect.stringContaining("res_"));
    expect(fs.chmod).not.toHaveBeenCalled();
  });
});
