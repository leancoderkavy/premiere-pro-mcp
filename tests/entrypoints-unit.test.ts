import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHandler: undefined as undefined | ((req: any, res: any) => Promise<void>),
  listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
  closeHttp: vi.fn(),
  capture: vi.fn(),
  shutdown: vi.fn(async () => {}),
  cleanup: vi.fn(),
  connect: vi.fn(async () => {}),
  closeMcp: vi.fn(async () => {}),
  handleRequest: vi.fn(async (_req: any, res: any) => { res.statusCode = 204; }),
  closeTransport: vi.fn(async () => {}),
  uxpStart: vi.fn(async () => {}),
  uxpStop: vi.fn(async () => {}),
  execFileSync: vi.fn(),
  fsExists: vi.fn(() => false),
  pipe: vi.fn(),
}));

vi.mock("node:http", () => ({
  default: {
    createServer: vi.fn((handler: any) => {
      mocks.requestHandler = handler;
      return { listen: mocks.listen, close: mocks.closeHttp };
    }),
  },
}));
vi.mock("../src/server.js", () => ({
  createServer: vi.fn(() => ({ connect: mocks.connect, close: mocks.closeMcp })),
}));
vi.mock("../src/bridge/file-bridge.js", () => ({
  cleanupTempDir: mocks.cleanup,
  getTempDir: vi.fn(() => "C:\\temp\\premiere"),
}));
vi.mock("../src/telemetry.js", async (original) => {
  const actual = await original<typeof import("../src/telemetry.js")>();
  return { ...actual, getTelemetry: () => ({ enabled: true, capture: mocks.capture, shutdown: mocks.shutdown }) };
});
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    handleRequest = mocks.handleRequest;
    close = mocks.closeTransport;
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("../src/http-security.js", () => ({ applyHttpSecurityHeaders: vi.fn() }));
vi.mock("../src/bridge/uxp-websocket-bridge.js", () => ({
  UxpWebSocketBridge: class {
    start = mocks.uxpStart;
    stop = mocks.uxpStop;
    address() { return { host: "127.0.0.1", port: 7788, path: "/premiere-uxp" }; }
  },
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mocks.fsExists,
      createReadStream: vi.fn(() => ({ pipe: mocks.pipe })),
    },
  };
});

const originalArgv = process.argv;
const env = { ...process.env };
const originalSignalListeners = {
  SIGINT: new Set(process.listeners("SIGINT")),
  SIGTERM: new Set(process.listeners("SIGTERM")),
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.requestHandler = undefined;
  mocks.fsExists.mockReturnValue(false);
  process.env = { ...env };
});
afterEach(() => {
  process.argv = originalArgv;
  process.env = { ...env };
  vi.restoreAllMocks();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!originalSignalListeners[signal].has(listener)) process.removeListener(signal, listener);
    }
  }
});

function response() {
  const res: any = {
    statusCode: 200, headersSent: false, body: "", closeHandler: undefined,
    writeHead: vi.fn((status: number) => { res.statusCode = status; res.headersSent = true; }),
    end: vi.fn((body = "") => { res.body = body; }),
    on: vi.fn((name: string, handler: () => void) => { if (name === "close") res.closeHandler = handler; }),
  };
  return res;
}

async function importCli(args: string[]) {
  process.argv = [process.execPath, "index.js", ...args];
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`EXIT:${code}`);
  }) as never);
  return { promise: import("../src/index.js"), exit };
}

describe("stdio CLI entry point", () => {
  it("prints help and exits successfully", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { promise, exit } = await importCli(["--help"]);
    await expect(promise).rejects.toThrow("EXIT:0");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("prints version and machine-readable doctor output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let loaded = await importCli(["--version"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+$/));
    vi.resetModules();
    log.mockClear();
    loaded = await importCli(["--doctor", "--json"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ schemaVersion: "premiere-pro-mcp.doctor.v1" });
  });

  it("prints human doctor and privacy-safe support bundle output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let loaded = await importCli(["--doctor"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Premiere MCP local check"));
    vi.resetModules();
    log.mockClear();
    loaded = await importCli(["--support-bundle"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      schemaVersion: "premiere-pro-mcp.support-bundle.v1",
    });
  });

  it("rejects CEP installation on unsupported platforms", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { promise, exit } = await importCli(["--install-cep"]);
    await expect(promise).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("supported only"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts the stdio server with configured bridge options", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_TEMP_DIR = "C:\\custom-temp";
    process.env.PREMIERE_TIMEOUT_MS = "4321";
    delete process.env.PREMIERE_UXP_TOKEN;
    await import("../src/index.js");
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.cleanup).toHaveBeenCalledWith({ tempDir: "C:\\custom-temp", timeoutMs: 4321 });
    expect(process.env.PREMIERE_MCP_TRANSPORT).toBe("stdio");
  });

  it("starts the authenticated UXP bridge and emits debug readiness details", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_UXP_TOKEN = "a-secure-token-with-length";
    process.env.PREMIERE_UXP_PORT = "7788";
    process.env.PREMIERE_MCP_DEBUG = "true";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../src/index.js");
    await vi.waitFor(() => expect(mocks.uxpStart).toHaveBeenCalledOnce());
    expect(error).toHaveBeenCalledWith(expect.stringContaining("UXP bridge listening"));
  });

  it("reports a fatal stdio startup failure", async () => {
    process.argv = [process.execPath, "index.js"];
    mocks.connect.mockRejectedValueOnce(new Error("connect failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await import("../src/index.js");
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
      "[premiere-pro-mcp] Fatal error:",
      expect.objectContaining({ message: "connect failed" }),
    ));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("runs and diagnoses the Windows CEP installer", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let loaded = await importCli(["--install-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-File"]),
      expect.objectContaining({ stdio: "inherit" }),
    );
    vi.resetModules();
    mocks.execFileSync.mockClear();
    log.mockClear();
    loaded = await importCli(["--diagnose-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync.mock.calls[0][1]).toContain("-Diagnose");
  });

  it("runs the macOS CEP diagnostic script", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const loaded = await importCli(["--diagnose-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/install-cep\.sh$/), "--diagnose"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(loaded.exit).toHaveBeenCalledWith(0);
  });

  it("reports a failed CEP installer command", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.execFileSync.mockImplementationOnce(() => { throw new Error("installer failed"); });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = await importCli(["--install-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("installation failed"));
  });
});

describe("HTTP entry point", () => {
  async function loadHttp(auth = "strong-test-token") {
    process.env.MCP_AUTH_TOKEN = auth;
    delete process.env.ALLOW_UNAUTHENTICATED;
    await import("../src/http-server.js");
    return mocks.requestHandler!;
  }

  it("serves health and rejects missing bearer credentials", async () => {
    const handler = await loadHttp();
    const health = response();
    await handler({ method: "GET", url: "/health", headers: {} }, health);
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ status: "ok" });

    const denied = response();
    await handler({ method: "POST", url: "/mcp", headers: {} }, denied);
    expect(denied.statusCode).toBe(401);
    expect(mocks.capture).toHaveBeenCalledWith("mcp_connection_attempt", expect.objectContaining({ outcome: "unauthorized" }));
  });

  it("rejects malformed and incorrect bearer credentials", async () => {
    const handler = await loadHttp();
    for (const authorization of ["Basic strong-test-token", "Bearer short", "Bearer xxxxxxxxxxxxxxxxx"]) {
      const denied = response();
      await handler({ method: "POST", url: "/mcp", headers: { authorization } }, denied);
      expect(denied.statusCode).toBe(401);
    }
  });

  it("allows an explicitly unauthenticated deployment", async () => {
    process.env.ALLOW_UNAUTHENTICATED = "1";
    delete process.env.MCP_AUTH_TOKEN;
    await import("../src/http-server.js");
    const res = response();
    await mocks.requestHandler!({ method: "POST", url: "/mcp", headers: {} }, res);
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
  });

  it("refuses to start without authentication or an explicit override", async () => {
    delete process.env.ALLOW_UNAUTHENTICATED;
    delete process.env.MCP_AUTH_TOKEN;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    await expect(import("../src/http-server.js")).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Refusing to start"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles authorized MCP requests and closes request resources", async () => {
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, res);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({ outcome: "succeeded", status_code: 204 }));
    res.closeHandler();
    expect(mocks.closeTransport).toHaveBeenCalled();
    expect(mocks.closeMcp).toHaveBeenCalled();
  });

  it("returns 500 when MCP request handling fails", async () => {
    const handler = await loadHttp();
    mocks.handleRequest.mockRejectedValueOnce(new TypeError("broken"));
    const res = response();
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: "Internal server error" });
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({ outcome: "failed", error_type: "TypeError" }));
  });

  it("records an MCP response status failure and preserves an already-started response", async () => {
    let handler = await loadHttp();
    mocks.handleRequest.mockImplementationOnce(async (_req, res) => { res.statusCode = 422; });
    const failedStatus = response();
    await handler({ method: undefined, url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, failedStatus);
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({
      outcome: "failed", method: "unknown", status_code: 422,
    }));

    vi.resetModules();
    handler = await loadHttp();
    mocks.handleRequest.mockRejectedValueOnce("non-error failure");
    const started = response();
    started.headersSent = true;
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, started);
    expect(started.writeHead).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({ error_type: "UnknownError" }));
  });

  it("serves a landing asset with its MIME type", async () => {
    mocks.fsExists.mockReturnValue(true);
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/docs/", headers: {} }, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8" });
    expect(mocks.pipe).toHaveBeenCalledWith(res);
  });

  it("returns 404 when no landing asset matches", async () => {
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/missing", headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
  });
});
