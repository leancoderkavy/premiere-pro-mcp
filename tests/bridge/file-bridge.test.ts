import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getTempDir,
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
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);
const mockedReaddirSync = vi.mocked(readdirSync);

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

  it("prefers options.tempDir over env var", () => {
    process.env.PREMIERE_TEMP_DIR = "/env/dir";
    expect(getTempDir({ tempDir: "/custom/dir" })).toBe("/custom/dir");
  });
});

describe("sendCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

  it("writes command file as .jsx", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue('{"success":true,"data":{}}');

    const promise = sendCommand("var x = 1;", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    const writeCall = mockedWriteFileSync.mock.calls[0];
    expect(String(writeCall[0])).toMatch(/cmd_.*\.jsx$/);
    expect(writeCall[1]).toBe("var x = 1;");
    expect(writeCall[2]).toBe("utf-8");
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

  it("returns error on JSON parse failure", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (String(path).includes("res_")) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue("not valid json{{{");

    const promise = sendCommand("test", { tempDir: "/tmp/test-bridge" });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse response");
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
