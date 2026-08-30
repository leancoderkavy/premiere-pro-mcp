import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("node:https", () => ({ default: { get: mocks.get } }));

function request() {
  const value = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
  };
  value.destroy = vi.fn((error?: Error) => {
    if (error) value.emit("error", error);
  });
  value.setTimeout = vi.fn();
  return value;
}

function response(statusCode = 200) {
  const value = new EventEmitter() as EventEmitter & {
    resume: ReturnType<typeof vi.fn>;
    setEncoding: ReturnType<typeof vi.fn>;
    statusCode: number;
  };
  value.statusCode = statusCode;
  value.resume = vi.fn();
  value.setEncoding = vi.fn();
  return value;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("npm update registry checks", () => {
  it("returns the latest registry version from a bounded successful response", async () => {
    const received = response();
    const pending = request();
    mocks.get.mockImplementation((_url, _options, callback) => {
      callback(received);
      queueMicrotask(() => {
        received.emit("data", '{"dist-tags":{"latest":"v1.14.5"}}');
        received.emit("end");
      });
      return pending;
    });

    const { fetchLatestNpmVersion } = await import("../src/update.js");
    await expect(fetchLatestNpmVersion("premiere-pro-mcp")).resolves.toBe("1.14.5");
    expect(received.setEncoding).toHaveBeenCalledWith("utf8");
    expect(pending.setTimeout).toHaveBeenCalledWith(10_000, expect.any(Function));
  });

  it("rejects a non-success response and a malformed registry record", async () => {
    const unavailable = response(503);
    const unavailableRequest = request();
    mocks.get.mockImplementationOnce((_url, _options, callback) => {
      callback(unavailable);
      return unavailableRequest;
    });

    let update = await import("../src/update.js");
    await expect(update.fetchLatestNpmVersion("premiere-pro-mcp")).rejects.toThrow("HTTP 503");
    expect(unavailable.resume).toHaveBeenCalledOnce();

    vi.resetModules();
    const malformed = response();
    const malformedRequest = request();
    mocks.get.mockImplementationOnce((_url, _options, callback) => {
      callback(malformed);
      queueMicrotask(() => {
        malformed.emit("data", '{"dist-tags":{"latest":"nightly"}}');
        malformed.emit("end");
      });
      return malformedRequest;
    });
    update = await import("../src/update.js");
    await expect(update.fetchLatestNpmVersion("premiere-pro-mcp")).rejects.toThrow("valid latest version");
  });

  it("times out and rejects unexpectedly large responses", async () => {
    const timedOut = response();
    const timeoutRequest = request();
    mocks.get.mockImplementationOnce((_url, _options, callback) => {
      callback(timedOut);
      return timeoutRequest;
    });

    let update = await import("../src/update.js");
    const timeout = update.fetchLatestNpmVersion("premiere-pro-mcp");
    const timeoutHandler = timeoutRequest.setTimeout.mock.calls[0][1] as () => void;
    timeoutHandler();
    await expect(timeout).rejects.toThrow("timed out");

    vi.resetModules();
    const oversized = response();
    const oversizedRequest = request();
    mocks.get.mockImplementationOnce((_url, _options, callback) => {
      callback(oversized);
      queueMicrotask(() => oversized.emit("data", "x".repeat(64 * 1024 + 1)));
      return oversizedRequest;
    });
    update = await import("../src/update.js");
    await expect(update.fetchLatestNpmVersion("premiere-pro-mcp")).rejects.toThrow("unexpectedly large");
    expect(oversizedRequest.destroy).toHaveBeenCalledOnce();
  });
});
