import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { cleanupTempDir, sendCommand } from "../../src/bridge/file-bridge.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(),
  chmodSync: vi.fn(),
  watch: vi.fn(),
}));

const fs = {
  exists: vi.mocked(existsSync),
  mkdir: vi.mocked(mkdirSync),
  write: vi.mocked(writeFileSync),
  read: vi.mocked(readFileSync),
  unlink: vi.mocked(unlinkSync),
  readdir: vi.mocked(readdirSync),
  rename: vi.mocked(renameSync),
  stat: vi.mocked(statSync),
  chmod: vi.mocked(chmodSync),
  watch: vi.mocked(watch),
};

describe("file bridge fallback and cleanup branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

  it("skips POSIX ownership checks on Windows", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    fs.exists.mockReturnValue(true);
    fs.read.mockReturnValue('{"success":true}');

    await expect(sendCommand("var windows = true;", {
      tempDir: "C:\\Temp\\premiere-bridge",
    })).resolves.toEqual({ success: true });
    expect(fs.stat).not.toHaveBeenCalled();
    expect(fs.chmod).not.toHaveBeenCalled();
  });
});
