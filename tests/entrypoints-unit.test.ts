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

const originalArgv = process.argv;
const env = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.requestHandler = undefined;
  process.env = { ...env };
});
afterEach(() => {
  process.argv = originalArgv;
  process.env = { ...env };
  vi.restoreAllMocks();
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

  it("rejects CEP installation on unsupported platforms", async () => {
    if (process.platform === "win32" || process.platform === "darwin") return;
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

  it("returns 404 when no landing asset matches", async () => {
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/missing", headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
  });
});
