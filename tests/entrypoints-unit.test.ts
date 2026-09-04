import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname } from "node:path";
import { RequestBodyTooLargeError } from "../src/http-admission.js";

const mocks = vi.hoisted(() => ({
  requestHandler: undefined as undefined | ((req: any, res: any) => Promise<void>),
  listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
  closeHttp: vi.fn(),
  capture: vi.fn(),
  shutdown: vi.fn(async () => {}),
  cleanup: vi.fn(),
  connect: vi.fn(async () => {}),
  serveStdio: vi.fn(),
  stdioServerTransport: vi.fn(),
  closeMcp: vi.fn(async () => {}),
  handleRequest: vi.fn(async (_req: any, res: any) => { res.statusCode = 204; }),
  closeTransport: vi.fn(async () => {}),
  uxpStart: vi.fn(async () => {}),
  uxpStop: vi.fn(async () => {}),
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
  fetchLatestNpmVersion: vi.fn(async () => "1.14.7"),
  fsExists: vi.fn(() => false),
  fsStat: vi.fn(() => ({ isDirectory: () => false, isFile: () => true })),
  fsCreateReadStream: vi.fn(),
  fsReadFileSync: vi.fn(),
  streamOnce: vi.fn(),
  pipe: vi.fn(),
  readBoundedBody: vi.fn(async () => Buffer.from("{}")),
  oauthAuthenticate: vi.fn(async () => ({
    authenticated: true,
    principal: { subject: "user-1", scopes: ["premiere:mcp"], rateLimitKey: "opaque-user-key" },
  })),
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
vi.mock("@modelcontextprotocol/server", () => ({
  createMcpHandler: vi.fn((factory: any) => ({
    factory,
    close: mocks.closeTransport,
  })),
}));
vi.mock("@modelcontextprotocol/node", () => ({
  toNodeHandler: vi.fn((handler: any) => async (req: any, res: any, body: unknown) => {
    handler.factory();
    await mocks.connect();
    res.on?.("close", () => {
      void mocks.closeMcp();
      void mocks.closeTransport();
    });
    await mocks.handleRequest(req, res, body);
  }),
}));
vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: (...args: any[]) => mocks.serveStdio(...args),
  StdioServerTransport: class {
    constructor() { mocks.stdioServerTransport(); }
    close = mocks.closeTransport;
  },
}));
vi.mock("../src/http-security.js", () => ({ applyHttpSecurityHeaders: vi.fn() }));
vi.mock("../src/http-admission.js", async (original) => {
  const actual = await original<typeof import("../src/http-admission.js")>();
  return { ...actual, readBoundedRequestBody: mocks.readBoundedBody };
});
vi.mock("../src/oauth-resource-server.js", () => ({
  OAuthResourceServer: class {
    authenticate = mocks.oauthAuthenticate;
    metadata() {
      return {
        resource: "https://premiere.example.com/mcp",
        authorization_servers: ["https://identity.example.com"],
        bearer_methods_supported: ["header"],
        scopes_supported: ["premiere:mcp"],
      };
    }
    challenge(error?: string) {
      return `Bearer resource_metadata="https://premiere.example.com/.well-known/oauth-protected-resource/mcp", scope="premiere:mcp"${error && error !== "missing_token" ? `, error="${error}"` : ""}`;
    }
  },
}));
vi.mock("../src/bridge/uxp-websocket-bridge.js", () => ({
  UxpWebSocketBridge: class {
    start = mocks.uxpStart;
    stop = mocks.uxpStop;
    address() { return { host: "127.0.0.1", port: 7788, path: "/premiere-uxp" }; }
  },
}));
vi.mock("../src/update.js", () => ({
  compareVersions: (left: string, right: string) => left.localeCompare(right),
  fetchLatestNpmVersion: mocks.fetchLatestNpmVersion,
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync, spawnSync: mocks.spawnSync }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mocks.fsExists,
      statSync: mocks.fsStat,
      createReadStream: mocks.fsCreateReadStream,
      readFileSync: mocks.fsReadFileSync,
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
  mocks.fetchLatestNpmVersion.mockResolvedValue("1.14.7");
  mocks.spawnSync.mockReturnValue({ status: 1, stdout: "" });
  mocks.fsExists.mockReturnValue(false);
  mocks.fsStat.mockReturnValue({ isDirectory: () => false, isFile: () => true });
  mocks.fsCreateReadStream.mockReturnValue({ once: mocks.streamOnce, pipe: mocks.pipe });
  mocks.fsReadFileSync.mockReturnValue("<html><head><script>bootstrap()</script></head></html>");
  mocks.readBoundedBody.mockResolvedValue(Buffer.from("{}"));
  mocks.serveStdio.mockImplementation((factory: () => unknown) => {
    factory();
    void mocks.connect();
    return { close: mocks.closeMcp };
  });
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
    destroy: vi.fn(),
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

  it("prints a no-write doctor repair plan and applies no writes without the closure confirmation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let loaded = await importCli(["--doctor", "--plan-fixes"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      schemaVersion: "premiere-pro-mcp.doctor-repair-plan.v1",
    });

    vi.resetModules();
    log.mockClear();
    loaded = await importCli(["--doctor", "--apply-fixes"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      schemaVersion: "premiere-pro-mcp.doctor-repair-result.v1",
    });
    expect(JSON.parse(String(log.mock.calls[0][0])).applied).toBe(false);
  });

  it("checks for a newer release and updates a global npm installation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.fetchLatestNpmVersion.mockResolvedValueOnce("1.14.8");
    let loaded = await importCli(["--check-update"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("1.14.7 → 1.14.8"));

    vi.resetModules();
    vi.clearAllMocks();
    log.mockClear();
    mocks.fetchLatestNpmVersion.mockResolvedValueOnce("1.14.8");
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: `${dirname(process.cwd())}\n` });
    loaded = await importCli(["--update"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["install", "--global", "premiere-pro-mcp@latest"]),
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["--install-cep"]),
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });

  it("rejects conflicting update actions and leaves a current installation untouched", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let loaded = await importCli(["--check-update", "--update"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("only one update action"));

    vi.resetModules();
    vi.clearAllMocks();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.fetchLatestNpmVersion.mockResolvedValueOnce("1.14.7");
    loaded = await importCli(["--update"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("is current"));
    expect(mocks.execFileSync).not.toHaveBeenCalled();
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

  it("offers an explicit legacy stdio fallback for clients that cannot negotiate server/discover", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_MCP_PROTOCOL_MODE = "legacy";

    await import("../src/index.js");

    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.stdioServerTransport).toHaveBeenCalledOnce();
    expect(mocks.serveStdio).not.toHaveBeenCalled();
  });

  it("rejects an unknown MCP protocol mode before opening stdio", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_MCP_PROTOCOL_MODE = "unsupported";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(mocks.serveStdio).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[premiere-pro-mcp] Fatal error:",
      expect.objectContaining({ message: "PREMIERE_MCP_PROTOCOL_MODE must be either auto or legacy." }),
    );
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

  it("continues with CEP-only tools when another MCP instance owns the UXP loopback port", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_UXP_TOKEN = "a-secure-token-with-length";
    mocks.uxpStart.mockRejectedValueOnce(Object.assign(new Error("address already in use"), { code: "EADDRINUSE" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../src/index.js");

    await vi.waitFor(() => expect(mocks.serveStdio).toHaveBeenCalledOnce());
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("continuing with CEP-only tools"));
  });

  it("keeps non-port UXP startup failures fatal", async () => {
    process.argv = [process.execPath, "index.js"];
    process.env.PREMIERE_UXP_TOKEN = "a-secure-token-with-length";
    mocks.uxpStart.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("../src/index.js");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(mocks.serveStdio).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[premiere-pro-mcp] Fatal error:",
      expect.objectContaining({ message: "permission denied" }),
    );
  });

  it("reports a fatal stdio startup failure", async () => {
    process.argv = [process.execPath, "index.js"];
    mocks.serveStdio.mockImplementationOnce(() => { throw new Error("connect failed"); });
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
    vi.resetModules();
    mocks.execFileSync.mockClear();
    loaded = await importCli(["--uninstall-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync.mock.calls[0][1]).toEqual(expect.arrayContaining([
      expect.stringMatching(/uninstall-cep\.ps1$/),
    ]));
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

  it("runs the macOS CEP uninstaller and rejects conflicting CEP actions", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(console, "log").mockImplementation(() => {});
    let loaded = await importCli(["--uninstall-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:0");
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "bash",
      [expect.stringMatching(/uninstall-cep\.sh$/), "--user"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    vi.resetModules();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loaded = await importCli(["--install-cep", "--uninstall-cep"]);
    await expect(loaded.promise).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("only one CEP action"));
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
    process.env.NODE_ENV = "test";
    await import("../src/http-server.js");
    return mocks.requestHandler!;
  }

  async function loadOAuth() {
    delete process.env.MCP_AUTH_TOKEN;
    delete process.env.ALLOW_UNAUTHENTICATED;
    process.env.NODE_ENV = "production";
    process.env.MCP_OAUTH_ISSUER = "https://identity.example.com";
    process.env.MCP_OAUTH_AUDIENCE = "https://premiere.example.com/mcp";
    process.env.MCP_OAUTH_JWKS_URI = "https://identity.example.com/.well-known/jwks.json";
    process.env.MCP_PUBLIC_URL = "https://premiere.example.com";
    process.env.MCP_OAUTH_REQUIRED_SCOPES = "premiere:mcp";
    process.env.MCP_OAUTH_ALLOWED_SUBJECTS = "user-1";
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

  it("publishes OAuth protected-resource metadata without authentication", async () => {
    const handler = await loadOAuth();
    const res = response();
    await handler({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp", headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      resource: "https://premiere.example.com/mcp",
      authorization_servers: ["https://identity.example.com"],
    });
    expect(mocks.oauthAuthenticate).not.toHaveBeenCalled();
  });

  it("returns discoverable OAuth challenges and separates invalid token from insufficient scope", async () => {
    let handler = await loadOAuth();
    mocks.oauthAuthenticate.mockResolvedValueOnce({ authenticated: false, error: "invalid_token" });
    const invalid = response();
    await handler({ method: "POST", url: "/mcp", headers: {} }, invalid);
    expect(invalid.statusCode).toBe(401);
    expect(invalid.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({
      "WWW-Authenticate": expect.stringContaining("/.well-known/oauth-protected-resource/mcp"),
      "Cache-Control": "no-store",
    }));

    vi.resetModules();
    handler = await loadOAuth();
    mocks.oauthAuthenticate.mockResolvedValueOnce({ authenticated: false, error: "insufficient_scope" });
    const insufficient = response();
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer redacted" } }, insufficient);
    expect(insufficient.statusCode).toBe(403);
    expect(insufficient.writeHead).toHaveBeenCalledWith(403, expect.objectContaining({
      "WWW-Authenticate": expect.stringContaining('error="insufficient_scope"'),
    }));
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it("rate-limits before OAuth verification work", async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = "1";
    process.env.MCP_RATE_LIMIT_BURST = "1";
    const handler = await loadOAuth();
    const request = { method: "POST", url: "/mcp", headers: {}, socket: { remoteAddress: "203.0.113.9" } };
    const first = response();
    await handler(request, first);
    const second = response();
    await handler(request, second);
    expect(mocks.oauthAuthenticate).toHaveBeenCalledOnce();
    expect(second.statusCode).toBe(429);
  });

  it("allows an explicitly unauthenticated deployment", async () => {
    process.env.ALLOW_UNAUTHENTICATED = "1";
    delete process.env.MCP_AUTH_TOKEN;
    process.env.NODE_ENV = "test";
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
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Refusing to start"), expect.stringContaining("MCP_AUTH_TOKEN"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses an unauthenticated production HTTP deployment", async () => {
    process.env.ALLOW_UNAUTHENTICATED = "1";
    delete process.env.MCP_AUTH_TOKEN;
    process.env.NODE_ENV = "production";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
    await expect(import("../src/http-server.js")).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Refusing to start"), expect.stringContaining("MCP_AUTH_TOKEN"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("rejects non-exact MCP paths and unsupported methods before server construction", async () => {
    const handler = await loadHttp();
    const incorrectPath = response();
    await handler({ method: "POST", url: "/mcp-typo", headers: {} }, incorrectPath);
    expect(incorrectPath.statusCode).toBe(404);
    expect(mocks.connect).not.toHaveBeenCalled();

    const wrongMethod = response();
    await handler({ method: "PUT", url: "/mcp?client=test", headers: {} }, wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.writeHead).toHaveBeenCalledWith(405, expect.objectContaining({ Allow: "GET, POST, DELETE" }));
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects chunked over-limit and malformed POST bodies before transport construction", async () => {
    const handler = await loadHttp();
    mocks.readBoundedBody.mockRejectedValueOnce(new RequestBodyTooLargeError());
    const tooLarge = response();
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, tooLarge);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.writeHead).toHaveBeenCalledWith(413, expect.objectContaining({ Connection: "close" }));
    expect(mocks.connect).not.toHaveBeenCalled();

    mocks.readBoundedBody.mockResolvedValueOnce(Buffer.from("not-json"));
    const malformed = response();
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, malformed);
    expect(malformed.statusCode).toBe(400);
    expect(JSON.parse(malformed.body)).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 }, id: null });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("handles authorized MCP requests and closes request resources", async () => {
    const handler = await loadHttp();
    const res = response();
    const req = {
      method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" },
    };
    await handler(req, res);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({ outcome: "succeeded", status_code: 204 }));
    res.closeHandler();
    expect(mocks.closeTransport).toHaveBeenCalled();
    expect(mocks.closeMcp).toHaveBeenCalled();
  });

  it("bounds DELETE request bodies before the MCP transport handles them", async () => {
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "DELETE", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, res);
    expect(mocks.readBoundedBody).toHaveBeenCalledOnce();
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
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
    await handler({ method: "POST", url: "/mcp", headers: { authorization: "Bearer strong-test-token" } }, failedStatus);
    expect(mocks.capture).toHaveBeenCalledWith("mcp_request", expect.objectContaining({
      outcome: "failed", method: "POST", status_code: 422,
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
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, must-revalidate",
    }));
    expect(res.body).toContain("<script nonce=");
  });

  it("serves landing document headers without a body for HEAD", async () => {
    mocks.fsExists.mockReturnValue(true);
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "HEAD", url: "/docs/", headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(mocks.fsReadFileSync).toHaveBeenCalledOnce();
  });

  it("serves extensionless landing routes from their index file", async () => {
    mocks.fsExists.mockReturnValue(true);
    mocks.fsStat
      .mockReturnValueOnce({ isDirectory: () => true, isFile: () => false })
      .mockReturnValueOnce({ isDirectory: () => false, isFile: () => true });
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/changelog", headers: {} }, res);
    expect(mocks.fsReadFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]changelog[\\/]index\.html$/),
      "utf8",
    );
    expect(res.statusCode).toBe(200);
  });

  it("marks hashed Next static assets immutable", async () => {
    mocks.fsExists.mockReturnValue(true);
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/_next/static/chunks/app.js", headers: {} }, res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Cache-Control": "public, max-age=31536000, immutable",
    }));
  });

  it("serves nested static-export Flight payloads requested with Next's flattened path", async () => {
    mocks.fsExists.mockImplementation((candidate) => (
      String(candidate).endsWith("landing-dist") ||
      /[\\/]blog[\\/]guide[\\/]__next\.blog[\\/]\$d\$slug[\\/]__PAGE__\.txt$/.test(String(candidate))
    ));
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/blog/guide/__next.blog.$d$slug.__PAGE__.txt?_rsc=test", headers: {} }, res);
    expect(mocks.fsCreateReadStream).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]blog[\\/]guide[\\/]__next\.blog[\\/]\$d\$slug[\\/]__PAGE__\.txt$/),
    );
    expect(res.statusCode).toBe(200);
  });

  it("does not crash when a landing asset read fails after validation", async () => {
    mocks.fsExists.mockReturnValue(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/analytics.js", headers: {} }, res);
    const streamError = mocks.streamOnce.mock.calls.find(([event]) => event === "error")?.[1];
    expect(streamError).toBeTypeOf("function");
    streamError(new Error("read failed"));
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[premiere-pro-mcp] Landing asset read failed:",
      expect.any(Error),
    );
  });

  it("rejects landing paths that escape the static root", async () => {
    mocks.fsExists.mockReturnValue(true);
    const handler = await loadHttp();
    for (const url of ["/../outside.txt", "/%2e%2e/outside.txt", "/..\\outside.txt"]) {
      const res = response();
      await handler({ method: "GET", url, headers: {} }, res);
      expect(res.statusCode).toBe(404);
    }
    expect(mocks.fsCreateReadStream).not.toHaveBeenCalled();
  });

  it("returns 404 when no landing asset matches", async () => {
    const handler = await loadHttp();
    const res = response();
    await handler({ method: "GET", url: "/missing", headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Not found");
  });
});
