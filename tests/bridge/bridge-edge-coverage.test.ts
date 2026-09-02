import { once } from "node:events";
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
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  UxpWebSocketBridge,
  type UxpHello,
} from "../../src/bridge/uxp-websocket-bridge.js";

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

const originalGetuid = Object.getOwnPropertyDescriptor(process, "getuid");

function ownedStat(mode = 0o700): ReturnType<typeof statSync> {
  return {
    uid: 4242,
    mode,
    mtimeMs: Date.now(),
  } as unknown as ReturnType<typeof statSync>;
}

function usePosixProcess(uid = 4242): void {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  Object.defineProperty(process, "getuid", {
    configurable: true,
    value: () => uid,
  });
}

function restoreGetuid(): void {
  if (originalGetuid) {
    Object.defineProperty(process, "getuid", originalGetuid);
  } else {
    delete (process as { getuid?: () => number }).getuid;
  }
}

describe("file bridge uncovered security and fallback paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fs.watch.mockImplementation(() => {
      throw new Error("watch unavailable");
    });
    fs.stat.mockReturnValue(ownedStat());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreGetuid();
  });

  it("rejects a pre-existing POSIX directory owned by another user", async () => {
    usePosixProcess();
    fs.exists.mockReturnValue(true);
    fs.stat.mockReturnValue(ownedStat());
    fs.stat.mockReturnValueOnce({
      uid: 31337,
      mode: 0o700,
      mtimeMs: Date.now(),
    } as unknown as ReturnType<typeof statSync>);

    await expect(sendCommand("var unsafe = true;", {
      tempDir: "/tmp/untrusted-bridge",
    })).rejects.toThrow(/owned by uid 31337/);
  });

  it("restores private POSIX permissions on an owned directory", async () => {
    usePosixProcess();
    fs.exists.mockReturnValue(true);
    fs.stat.mockReturnValueOnce(ownedStat(0o755));
    fs.read.mockReturnValue('{"success":true,"data":{"repaired":true}}');

    await expect(sendCommand("var repair = true;", {
      tempDir: "/tmp/owned-bridge",
    })).resolves.toEqual({ success: true, data: { repaired: true } });

    expect(fs.chmod).toHaveBeenCalledWith("/tmp/owned-bridge", 0o700);
  });

  it("reports a busy Premiere operation when its heartbeat cannot be statted", async () => {
    usePosixProcess();
    fs.exists.mockImplementation((path) => {
      const value = String(path);
      if (value.includes("res_")) return false;
      if (value.includes("busy_")) return true;
      return true;
    });
    fs.stat.mockImplementation(((path) => {
      if (String(path).includes("busy_")) throw new Error("heartbeat locked");
      return ownedStat();
    }) as typeof statSync);

    const response = sendCommand("var waiting = true;", {
      tempDir: "/tmp/busy-stat-error",
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(110);

    await expect(response).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("modal dialog"),
    });
  });

  it("normalizes non-Error response read failures into command results", async () => {
    usePosixProcess();
    fs.exists.mockImplementation((path) => !String(path).includes("busy_"));
    fs.read.mockImplementation(() => {
      throw "response file is locked";
    });

    const response = sendCommand("var parse = true;", {
      tempDir: "/tmp/non-error-read-failure",
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(110);

    await expect(response).resolves.toEqual({
      success: false,
      error: "Failed to parse response: response file is locked",
    });
  });
});

const TOKEN = "bridge-edge-token-at-least-16-characters";
const liveBridges: UxpWebSocketBridge[] = [];

async function startBridge(options: {
  port?: number;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
} = {}): Promise<UxpWebSocketBridge> {
  const bridge = new UxpWebSocketBridge({ token: TOKEN, port: 0, ...options });
  liveBridges.push(bridge);
  await bridge.start();
  return bridge;
}

function bridgeUrl(bridge: UxpWebSocketBridge, token = TOKEN): string {
  const address = bridge.address();
  return `ws://${address.host}:${address.port}${address.path}?token=${encodeURIComponent(token)}`;
}

async function connectHost(
  bridge: UxpWebSocketBridge,
  protocolVersion = 1,
  commands: Record<string, { supported: boolean }> = { "state.get": { supported: true } },
): Promise<WebSocket> {
  const client = new WebSocket(bridgeUrl(bridge));
  await once(client, "open");
  const connected = once(bridge, "connected");
  client.send(JSON.stringify({
    protocolVersion,
    type: "hello",
    payload: {
      backend: "uxp",
      protocolVersion,
      commands,
    },
  }));
  await connected;
  return client;
}

afterEach(async () => {
  await Promise.all(liveBridges.splice(0).map((bridge) => bridge.stop()));
});

describe("UXP WebSocket bridge rejected-message and cleanup paths", () => {
  it("serves a 404 for regular HTTP traffic and ignores duplicate starts", async () => {
    const bridge = await startBridge();
    const listening = vi.fn();
    bridge.on("listening", listening);

    await bridge.start();
    const address = bridge.address();
    const response = await fetch(`http://${address.host}:${address.port}/not-a-websocket`);

    expect(listening).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not found");
  });

  it("uses configured address data before it has started", () => {
    const bridge = new UxpWebSocketBridge({ token: TOKEN, port: 7911, path: "/panel" });
    expect(bridge.address()).toEqual({ host: "127.0.0.1", port: 7911, path: "/panel" });
    expect(bridge.getState()).toEqual({ status: "stopped", connected: false });
  });

  it("uses a timing-safe comparison for equal-length incorrect tokens", async () => {
    const bridge = await startBridge();
    const client = new WebSocket(bridgeUrl(bridge, "x".repeat(TOKEN.length)));
    client.on("error", () => {});
    const [, response] = await once(client, "unexpected-response");

    expect(response.statusCode).toBe(401);
    response.resume();
  });

  it("closes a host that never sends the versioned hello", async () => {
    const bridge = await startBridge({ handshakeTimeoutMs: 20 });
    const client = new WebSocket(bridgeUrl(bridge));
    await once(client, "open");

    const [code, reason] = await once(client, "close");
    expect(code).toBe(1008);
    expect(reason.toString()).toContain("Versioned hello required");
  });

  it("rejects each malformed hello shape before accepting capabilities", async () => {
    const bridge = await startBridge();
    const malformedMessages = [
      { protocolVersion: 1, type: "event", payload: {} },
      { protocolVersion: 1, type: "hello", payload: { backend: "cep", protocolVersion: 1, commands: {} } },
      { protocolVersion: 3, type: "hello", payload: { backend: "uxp", protocolVersion: 3, commands: {} } },
      { protocolVersion: 1, type: "hello", payload: { backend: "uxp", protocolVersion: 2, commands: {} } },
      { protocolVersion: 1, type: "hello", payload: { backend: "uxp", protocolVersion: 1 } },
      { protocolVersion: 1, type: "hello", payload: { backend: "uxp", protocolVersion: 1, commands: "invalid" } },
      { protocolVersion: 1, type: "hello", payload: { backend: "uxp", protocolVersion: 1, commands: [] } },
    ];

    for (const message of malformedMessages) {
      const client = new WebSocket(bridgeUrl(bridge));
      await once(client, "open");
      const closed = once(client, "close");
      client.send(JSON.stringify(message));
      const [code] = await closed;
      expect(code).toBe(1008);
    }
  });

  it("accepts protocol 2 and closes the connection when its protocol changes", async () => {
    const bridge = await startBridge();
    const client = await connectHost(bridge, 2);
    expect(bridge.getState()).toMatchObject({ connected: true, protocolVersion: 2 });

    const closed = once(client, "close");
    client.send(JSON.stringify({ protocolVersion: 1, type: "event", payload: { kind: "wrong-version" } }));
    const [code, reason] = await closed;
    expect(code).toBe(1008);
    expect(reason.toString()).toContain("Protocol version changed");
  });

  it("ignores unknown messages and reports default host command failures", async () => {
    const bridge = await startBridge();
    const client = await connectHost(bridge);
    client.send(JSON.stringify({ protocolVersion: 1, type: "notice", payload: {} }));
    client.send(JSON.stringify({
      protocolVersion: 1,
      type: "result",
      requestId: "unknown-request",
      payload: { ok: true, result: "ignored" },
    }));

    client.once("message", (data) => {
      const command = JSON.parse(data.toString());
      client.send(JSON.stringify({
        protocolVersion: 1,
        type: "result",
        requestId: command.requestId,
        payload: { ok: false },
      }));
    });
    await expect(bridge.request("state.get")).rejects.toMatchObject({
      code: "UXP_COMMAND_FAILED",
      message: "UXP command 'state.get' failed",
    });
    expect(bridge.getState()).toMatchObject({ connected: true });
  });

  it("forwards client errors from an accepted connection", async () => {
    const bridge = await startBridge();
    await connectHost(bridge);
    const emitted = once(bridge, "clientError");
    const expected = new Error("client transport error");
    const serverClient = (bridge as unknown as { socket: WebSocket }).socket;

    serverClient.emit("error", expected);
    await expect(emitted).resolves.toEqual([expected]);
  });

  it("rejects a request if the socket reports a send failure exactly once", async () => {
    const bridge = new UxpWebSocketBridge({ token: TOKEN });
    const internal = bridge as unknown as {
      socket: {
        readyState: number;
        send: (message: string, callback: (error?: Error) => void) => void;
        close: () => void;
      } | null;
      hello: UxpHello | null;
    };
    internal.socket = {
      readyState: WebSocket.OPEN,
      send: (_message, callback) => {
        callback(new Error("socket write failed"));
        callback(new Error("duplicate completion"));
      },
      close: vi.fn(),
    };
    internal.hello = {
      backend: "uxp",
      protocolVersion: 1,
      commands: { "state.get": { supported: true } },
    };

    await expect(bridge.request("state.get")).rejects.toMatchObject({
      code: "UXP_SEND_FAILED",
      message: "socket write failed",
    });
  });
});
