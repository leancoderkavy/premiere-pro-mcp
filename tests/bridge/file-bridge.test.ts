import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  renameSync,
  statSync,
  chmodSync,
  watch,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  getDarwinUserTempDirectory,
  getTempDir,
  getDefaultBridgeTempDir,
  getBridgeLiveness,
  MAX_BRIDGE_RESPONSE_BYTES,
  sendCommand,
  sendRawCommand,
  cleanupTempDir,
} from "../../src/bridge/file-bridge.js";

// Mock fs module
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
  watch: vi.fn(() => {
    throw new Error("watch unavailable in unit-test fallback");
  }),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedRenameSync = vi.mocked(renameSync);
const mockedStatSync = vi.mocked(statSync);
const mockedChmodSync = vi.mocked(chmodSync);
const mockedWatch = vi.mocked(watch);
const mockedExecFileSync = vi.mocked(execFileSync);

// ensureDir on an existing dir stat-checks ownership; default to a dir owned by us
// with safe perms so the existing tests exercise the happy path.
const myUid = typeof process.getuid === "function" ? process.getuid() : 0;
mockedStatSync.mockReturnValue({ uid: myUid, mode: 0o700 } as unknown as ReturnType<typeof statSync>);

describe("getTempDir", () => {
  const originalEnv = process.env.PREMIERE_TEMP_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PREMIERE_TEMP_DIR = originalEnv;
    } else {
      delete process.env.PREMIERE_TEMP_DIR;
    }
  });

  it("returns custom dir from options", () => {
    expect(getTempDir({ tempDir: "/custom/dir" })).toBe("/custom/dir");
  });

  it("returns env var when no options", () => {
    process.env.PREMIERE_TEMP_DIR = "/env/dir";
    expect(getTempDir()).toBe("/env/dir");
  });

  it("returns env var when options have no tempDir", () => {
    process.env.PREMIERE_TEMP_DIR = "/env/dir";
    expect(getTempDir({})).toBe("/env/dir");
  });

  it("returns default when no options or env", () => {
    delete process.env.PREMIERE_TEMP_DIR;
    const result = getTempDir();
    expect(result).toBe(join(tmpdir(), "premiere-mcp-bridge"));
  });

  it("uses the Darwin per-user temporary root when a GUI client omits TMPDIR", () => {
    expect(getDefaultBridgeTempDir(
      "darwin",
      "/tmp",
      () => "/var/folders/example/T",
      {},
    ).replaceAll("\\", "/")).toBe("/var/folders/example/T/premiere-mcp-bridge");
  });

  it("falls back safely when the Darwin temporary-root lookup is unavailable", () => {
    expect(getDefaultBridgeTempDir("darwin", "/tmp", () => null, {}).replaceAll("\\", "/"))
      .toBe("/tmp/premiere-mcp-bridge");
  });

  it("preserves a configured Darwin temporary root", () => {
    expect(getDefaultBridgeTempDir(
      "darwin",
      "/configured/T",
      () => "/var/folders/example/T",
      { TMPDIR: "/configured/T" },
    ).replaceAll("\\", "/")).toBe("/configured/T/premiere-mcp-bridge");
  });

  it("prefers options.tempDir over env var", () => {
    process.env.PREMIERE_TEMP_DIR = "/env/dir";
    expect(getTempDir({ tempDir: "/custom/dir" })).toBe("/custom/dir");
  });
});

describe("getDarwinUserTempDirectory", () => {
  it("uses the per-user macOS temporary root reported by getconf", () => {
    mockedExecFileSync.mockReturnValue("/var/folders/example/T/\n" as never);

    expect(getDarwinUserTempDirectory()).toBe("/var/folders/example/T/");
    expect(mockedExecFileSync).toHaveBeenCalledWith("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("rejects a non-absolute getconf result", () => {
    mockedExecFileSync.mockReturnValue("relative-temp\n" as never);

    expect(getDarwinUserTempDirectory()).toBeNull();
  });

  it("falls back when the getconf lookup fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("unavailable"); });

    expect(getDarwinUserTempDirectory()).toBeNull();
  });
});

describe("sendCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedStatSync.mockReturnValue({ uid: myUid, mode: 0o700 } as unknown as ReturnType<typeof statSync>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates temp directory if it does not exist", async () => {
    let dirCreated = false;
    mockedExistsSync.mockImplementation((path) => {
      const p = String(path);
      // The temp dir itself does not exist (until mkdirSync is called)
      if (p === "/tmp/test-bridge" && !dirCreated) return false;
      if (p.includes("res_")) return true; // response exists immediately
      return true;
    });
    mockedMkdirSync.mockImplementation(() => {
      dirCreated = true;
      return undefined;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{"ok":true}}');

    const promise = sendCommand("test script", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(mockedMkdirSync).toHaveBeenCalledWith("/tmp/test-bridge", {
      recursive: true,
      mode: 0o700,
    });
  });

  // Security: the bridge temp dir sits at a predictable, world-accessible path, and the
  // CEP panel executes any cmd_*.jsx it finds there. On shared machines that dir must be
  // ours and private. See the ensureDir hardening.
  it("refuses to use an existing temp dir owned by another user", async () => {
    if (typeof process.getuid !== "function") return; // POSIX-only guard
    mockedExistsSync.mockReturnValue(true); // dir already exists
    mockedStatSync.mockReturnValueOnce({
      uid: process.getuid!() + 1, // someone else owns it
      mode: 0o700,
    } as unknown as ReturnType<typeof statSync>);

    await expect(sendCommand("var x = 1;", { tempDir: "/tmp/evil-bridge" })).rejects.toThrow(
      /owned by uid .* not this user/
    );
  });

  it("clamps a group/world-accessible existing temp dir back to 0700", async () => {
    if (typeof process.getuid !== "function") return;
    mockedExistsSync.mockImplementation((p) => (String(p).includes("res_") ? true : true));
    mockedStatSync.mockReturnValueOnce({
      uid: process.getuid!(),
      mode: 0o755, // ours, but world-readable
    } as unknown as ReturnType<typeof statSync>);
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendCommand("var x = 1;", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(mockedChmodSync).toHaveBeenCalledWith("/tmp/test-bridge", 0o700);
  });

  it("atomically publishes a complete command file as .jsx", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendCommand("var x = 1;", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    const writeCall = mockedWriteFileSync.mock.calls.find(([path]) => String(path).endsWith(".jsx.staged"));
    expect(writeCall).toBeDefined();
    expect(String(writeCall?.[0])).toMatch(/cmd_.*\.jsx\.staged$/);
    const publishedPath = mockedRenameSync.mock.calls[0]?.[1];
    expect(String(publishedPath)).toMatch(/cmd_.*\.jsx$/);
    // command = one-line helpers bootstrap, then the script itself
    const content = String(writeCall?.[1]);
    expect(content.endsWith("\nvar x = 1;")).toBe(true);
    expect(content.replaceAll("\\\\", "/")).toContain('$.evalFile("/tmp/test-bridge/helpers_');
    expect(writeCall?.[2]).toBe("utf-8");
  });

  it("returns parsed JSON response", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{"version":"24.0"}}');

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toEqual({ success: true, data: { version: "24.0" } });
  });

  it("rejects an oversized bridge response before reading it into memory", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedStatSync.mockReturnValue({
      uid: myUid,
      mode: 0o700,
      size: MAX_BRIDGE_RESPONSE_BYTES + 1,
    } as unknown as ReturnType<typeof statSync>);

    await expect(sendCommand("test", { tempDir: "/tmp/test-bridge" })).resolves.toEqual({
      success: false,
      error: `Bridge response exceeds the ${MAX_BRIDGE_RESPONSE_BYTES}-byte limit`,
    });
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it("uses distinct cryptographic IDs for concurrently-created command files", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{"success":true}');

    await Promise.all([
      sendCommand("first", { tempDir: "/tmp/test-bridge" }),
      sendCommand("second", { tempDir: "/tmp/test-bridge" }),
    ]);

    const publishedPaths = mockedRenameSync.mock.calls.map(([, target]) => String(target));
    expect(publishedPaths).toHaveLength(2);
    expect(new Set(publishedPaths).size).toBe(2);
    expect(publishedPaths.every((path) => /cmd_[0-9a-f-]{36}\.jsx$/.test(path))).toBe(true);
  });

  it("attempts event-driven response watching before using the polling fallback", async () => {
    mockedExistsSync.mockImplementation((path) => String(path).includes("res_"));
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(mockedWatch).toHaveBeenCalledWith(
      dirname(join("/tmp/test-bridge", "response.json")),
      { persistent: false },
      expect.any(Function),
    );
  });

  it("resolves immediately when the watcher reports the response file", async () => {
    let responseExists = false;
    let onChange: ((event: string, filename: string) => void) | undefined;
    const fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
    mockedWatch.mockImplementationOnce(((_path, _options, listener) => {
      onChange = listener as (event: string, filename: string) => void;
      return fakeWatcher;
    }) as typeof watch);
    mockedExistsSync.mockImplementation((path) =>
      String(path).includes("res_") ? responseExists : true,
    );
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{"eventDriven":true}}');

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge" });
    const responsePath = mockedWatch.mock.calls[0]?.[0];
    expect(responsePath).toBeDefined();
    responseExists = true;
    const commandPath = String(mockedRenameSync.mock.calls[0]?.[1]);
    const responseName = commandPath.replace(/.*[\\/]+cmd_/, "res_").replace(/\.jsx$/, ".json");
    onChange?.("rename", responseName);

    await expect(promise).resolves.toEqual({ success: true, data: { eventDriven: true } });
    expect(fakeWatcher.close).toHaveBeenCalled();
  });

  it("serializes concurrent bridge commands before they reach CEP", async () => {
    const readyResponses = new Set<string>();
    let onChange: ((event: string, filename: string) => void) | undefined;
    const fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
    mockedWatch.mockImplementation(((_path, _options, listener) => {
      onChange = listener as (event: string, filename: string) => void;
      return fakeWatcher;
    }) as typeof watch);
    mockedExistsSync.mockImplementation((path) => {
      const value = String(path);
      return value.includes("res_") ? readyResponses.has(value) : true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{"shared":true}}');

    const pending = [
      sendCommand("first", { tempDir: "/tmp/shared-watch-bridge" }),
      sendCommand("second", { tempDir: "/tmp/shared-watch-bridge" }),
    ];
    expect(mockedWatch).toHaveBeenCalledTimes(1);
    expect(mockedRenameSync).toHaveBeenCalledTimes(1);

    const signalResponse = (commandPath: unknown) => {
      const responsePath = String(commandPath)
        .replace(/cmd_/, "res_")
        .replace(/\.jsx$/, ".json");
      readyResponses.add(responsePath);
      onChange?.("rename", responsePath.split(/[\\/]/).pop()!);
    };
    signalResponse(mockedRenameSync.mock.calls[0]?.[1]);
    await expect(pending[0]).resolves.toEqual({ success: true, data: { shared: true } });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedWatch).toHaveBeenCalledTimes(2);
    signalResponse(mockedRenameSync.mock.calls[1]?.[1]);

    await expect(pending[1]).resolves.toEqual({ success: true, data: { shared: true } });
    expect(fakeWatcher.close).toHaveBeenCalledTimes(2);
  });

  it("fails fast when a bridge directory already has the bounded command backlog", async () => {
    mockedExistsSync.mockImplementation((path) => !String(path).includes("res_"));
    const commands = Array.from({ length: 34 }, (_, index) => sendCommand(`queued-${index}`, {
      tempDir: "/tmp/queue-capacity-bridge",
    }));

    await expect(commands[33]).resolves.toEqual({
      success: false,
      error: "Bridge command queue is full (32 waiting); retry after an active command finishes",
    });
  });

  it("keeps polling a malformed response without resending the command", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      if (String(path).includes("busy_")) return false;
      return true;
    });
    mockedReadFileSync.mockReturnValue("not valid json{{{");

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge", timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse response");
    expect(mockedRenameSync).toHaveBeenCalledTimes(1);
  });

  it("returns timeout error when response file never appears", async () => {
    mockedExistsSync.mockReturnValue(false);

    const promise = sendCommand("test", {
      tempDir: "/tmp/test-bridge",
      timeoutMs: 500,
    });

    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.error).toContain("CEP plugin");
  });

  it("fails health-style commands before publication when a current connector is waiting", async () => {
    vi.setSystemTime(new Date(10_000));
    mockedExistsSync.mockImplementation((path) => String(path).includes("bridge-heartbeat"));
    mockedReadFileSync.mockReturnValue('{"protocolVersion":1,"state":"waiting"}');
    mockedStatSync.mockReturnValue({
      uid: myUid,
      mode: 0o700,
      mtimeMs: 9_500,
    } as unknown as ReturnType<typeof statSync>);

    await expect(sendCommand("var health = true;", {
      tempDir: "/tmp/test-bridge",
      failFastOnUnreadyHeartbeat: true,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not running") });
    expect(mockedRenameSync).not.toHaveBeenCalled();
  });

  it("fails health-style commands before publication when a known connector heartbeat is stale", async () => {
    vi.setSystemTime(new Date(10_000));
    mockedExistsSync.mockImplementation((path) => String(path).includes("bridge-heartbeat"));
    mockedReadFileSync.mockReturnValue('{"protocolVersion":1,"state":"running"}');
    mockedStatSync.mockReturnValue({
      uid: myUid,
      mode: 0o700,
      mtimeMs: 1_000,
    } as unknown as ReturnType<typeof statSync>);

    await expect(sendCommand("var health = true;", {
      tempDir: "/tmp/test-bridge",
      failFastOnUnreadyHeartbeat: true,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("heartbeat is stale") });
    expect(mockedRenameSync).not.toHaveBeenCalled();
  });

  it("falls back to normal command delivery when no heartbeat exists", async () => {
    mockedExistsSync.mockImplementation((path) => String(path).includes("res_"));
    mockedReadFileSync.mockReturnValue('{"success":true}');

    await expect(sendCommand("var legacy = true;", {
      tempDir: "/tmp/test-bridge",
      failFastOnUnreadyHeartbeat: true,
    })).resolves.toEqual({ success: true });
    expect(mockedRenameSync).toHaveBeenCalled();
  });

  it("cleans up command and response files after success", async () => {
    let responseExists = false;
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return responseExists;
      return true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge" });
    responseExists = true;
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    // unlinkSync should be called for both cmd and res files
    expect(mockedUnlinkSync).toHaveBeenCalled();
  });

  it("rejects scripts containing eval()", async () => {
    await expect(
      sendCommand('eval("dangerous")', { tempDir: "/tmp/test-bridge" })
    ).rejects.toThrow("blocked pattern");
  });

  it("rejects scripts containing new Function()", async () => {
    await expect(
      sendCommand('new Function("code")', { tempDir: "/tmp/test-bridge" })
    ).rejects.toThrow("blocked pattern");
  });

  it("rejects scripts containing System.callSystem()", async () => {
    await expect(
      sendCommand('System.callSystem("rm -rf /")', {
        tempDir: "/tmp/test-bridge",
      })
    ).rejects.toThrow("blocked pattern");
  });

  it("rejects scripts exceeding 500KB", async () => {
    const largeScript = "x".repeat(501 * 1024);
    await expect(
      sendCommand(largeScript, { tempDir: "/tmp/test-bridge" })
    ).rejects.toThrow("500KB size limit");
  });
});

describe("getBridgeLiveness", () => {
  it("reports fresh, stale, and unknown states without exposing heartbeat contents", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{"protocolVersion":1,"state":"running"}');
    mockedStatSync.mockReturnValue({ mtimeMs: 9_000 } as ReturnType<typeof statSync>);
    expect(getBridgeLiveness({ tempDir: "/tmp/test-bridge" }, 10_000)).toEqual({
      state: "running",
      ageMs: 1_000,
    });

    mockedStatSync.mockReturnValue({ mtimeMs: 1_000 } as ReturnType<typeof statSync>);
    expect(getBridgeLiveness({ tempDir: "/tmp/test-bridge" }, 10_000)).toEqual({
      state: "stale",
      ageMs: 9_000,
    });

    mockedReadFileSync.mockReturnValue('{"state":"running"}');
    expect(getBridgeLiveness({ tempDir: "/tmp/test-bridge" }, 10_000)).toEqual({
      state: "unknown",
      ageMs: null,
    });

    // This module-level fs mock is shared with the following raw-command
    // suite, which exercises the POSIX ownership guard.
    mockedStatSync.mockReturnValue({
      uid: myUid,
      mode: 0o700,
      mtimeMs: Date.now(),
    } as unknown as ReturnType<typeof statSync>);
  });
});

describe("sendRawCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows eval() in raw commands", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendRawCommand('eval("1+1")', {
      tempDir: "/tmp/test-bridge",
    });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.success).toBe(true);
  });

  it("still enforces size limit on raw commands", async () => {
    const largeScript = "x".repeat(501 * 1024);
    await expect(
      sendRawCommand(largeScript, { tempDir: "/tmp/test-bridge" })
    ).rejects.toThrow("500KB size limit");
  });
});

describe("cleanupTempDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes cmd_ and res_ files", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([
      "cmd_123.jsx" as any,
      "cmd_124.jsx.staged" as any,
      "res_123.json" as any,
      "other_file.txt" as any,
    ]);

    cleanupTempDir({ tempDir: "/tmp/test-bridge" });

    // Should unlink cmd_ and res_ files but not other_file.txt
    const unlinkCalls = mockedUnlinkSync.mock.calls.map((c) => String(c[0]));
    expect(unlinkCalls).toContainEqual(
      join("/tmp/test-bridge", "cmd_123.jsx")
    );
    expect(unlinkCalls).toContainEqual(
      join("/tmp/test-bridge", "res_123.json")
    );
    expect(unlinkCalls).toContainEqual(
      join("/tmp/test-bridge", "cmd_124.jsx.staged")
    );
    expect(unlinkCalls).not.toContainEqual(
      join("/tmp/test-bridge", "other_file.txt")
    );
  });

  it("does nothing if temp dir does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    cleanupTempDir({ tempDir: "/tmp/nonexistent" });
    expect(mockedReaddirSync).not.toHaveBeenCalled();
  });

  it("handles errors gracefully", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    // Should not throw
    expect(() => cleanupTempDir({ tempDir: "/tmp/test-bridge" })).not.toThrow();
  });
});
