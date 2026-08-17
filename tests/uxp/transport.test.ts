import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  UxpBridgeError,
  UxpWebSocketBridge,
} from "../../src/bridge/uxp-websocket-bridge.js";

const TOKEN = "test-token-at-least-16-characters";
const bridges: UxpWebSocketBridge[] = [];

async function createBridge(options: {
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
} = {}) {
  const bridge = new UxpWebSocketBridge({
    token: TOKEN,
    port: 0,
    ...options,
  });
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}

function bridgeUrl(bridge: UxpWebSocketBridge, token = TOKEN): string {
  const address = bridge.address();
  return `ws://${address.host}:${address.port}${address.path}?token=${encodeURIComponent(token)}`;
}

async function connectHost(
  bridge: UxpWebSocketBridge,
  commands: Record<string, { supported: boolean }> = {
    "state.get": { supported: true },
    "frame.export": { supported: true },
  },
) {
  const client = new WebSocket(bridgeUrl(bridge));
  await once(client, "open");
  const connected = once(bridge, "connected");
  client.send(JSON.stringify({
    protocolVersion: 1,
    type: "hello",
    payload: {
      backend: "uxp",
      protocolVersion: 1,
      commands,
    },
  }));
  await connected;
  return client;
}

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
});

describe("UXP WebSocket bridge", () => {
  it("binds only to IPv4 loopback and requires the configured token", async () => {
    const bridge = await createBridge();
    expect(bridge.address()).toMatchObject({ host: "127.0.0.1", path: "/uxp" });

    const unauthorized = new WebSocket(bridgeUrl(bridge, "wrong-token"));
    unauthorized.on("error", () => {});
    const [, response] = await once(unauthorized, "unexpected-response");
    expect(response.statusCode).toBe(401);
    response.resume();
    expect(bridge.getState()).toEqual({ status: "listening", connected: false });
  });

  it("validates the versioned hello before reporting capabilities", async () => {
    const bridge = await createBridge();
    const client = await connectHost(bridge);
    expect(bridge.getState()).toMatchObject({
      status: "connected",
      connected: true,
      protocolVersion: 1,
      capabilities: {
        backend: "uxp",
        commands: { "state.get": { supported: true } },
      },
    });
    client.close();
  });

  it("correlates concurrent command results by request id", async () => {
    const bridge = await createBridge();
    const client = await connectHost(bridge);
    const commands: any[] = [];
    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      commands.push(message);
      if (commands.length !== 2) return;
      for (const command of [...commands].reverse()) {
        client.send(JSON.stringify({
          protocolVersion: 1,
          type: "result",
          requestId: command.requestId,
          payload: { ok: true, result: { command: command.command } },
        }));
      }
    });

    const [state, frame] = await Promise.all([
      bridge.request("state.get"),
      bridge.request("frame.export", { filename: "frame.png" }),
    ]);
    expect(state).toEqual({ command: "state.get" });
    expect(frame).toEqual({ command: "frame.export" });
    client.close();
  });

  it("rejects unsupported commands before sending them", async () => {
    const bridge = await createBridge();
    const client = await connectHost(bridge, { "state.get": { supported: true } });
    await expect(bridge.request("frame.export")).rejects.toMatchObject({
      code: "UXP_COMMAND_UNSUPPORTED",
    });
    client.close();
  });

  it("times out requests and rejects in-flight work on disconnect", async () => {
    const bridge = await createBridge({ requestTimeoutMs: 30 });
    const client = await connectHost(bridge);
    await expect(bridge.request("state.get")).rejects.toMatchObject({
      code: "UXP_TIMEOUT",
    });

    const pending = bridge.request("state.get");
    client.close();
    await expect(pending).rejects.toMatchObject({ code: "UXP_DISCONNECTED" });
  });

  it("honors a per-request minimum timeout for bounded host waits", async () => {
    const bridge = await createBridge({ requestTimeoutMs: 20 });
    const client = await connectHost(bridge);
    client.once("message", (data) => {
      const command = JSON.parse(data.toString());
      setTimeout(() => {
        client.send(JSON.stringify({
          protocolVersion: 1,
          type: "result",
          requestId: command.requestId,
          payload: { ok: true, result: { waited: true } },
        }));
      }, 40);
    });

    await expect(bridge.request("state.get", {}, { minimumTimeoutMs: 100 }))
      .resolves.toEqual({ waited: true });
    client.close();
  });

  it("rejects invalid per-request minimum timeouts before dispatch", async () => {
    const bridge = await createBridge();
    const client = await connectHost(bridge);

    await expect(bridge.request("state.get", {}, { minimumTimeoutMs: -1 }))
      .rejects.toThrow("non-negative integer");
    await expect(bridge.request("state.get", {}, { minimumTimeoutMs: 1.5 }))
      .rejects.toThrow("non-negative integer");
    client.close();
  });

  it("rejects invalid configuration without opening a listener", () => {
    expect(() => new UxpWebSocketBridge({ token: "short" })).toThrow(
      "at least 16 characters",
    );
    expect(() => new UxpWebSocketBridge({
      token: TOKEN,
      port: 70_000,
    })).toThrow("between 0 and 65535");
    expect(new UxpBridgeError("CODE", "message")).toMatchObject({
      code: "CODE",
      message: "message",
    });
    expect(() => new UxpWebSocketBridge({ token: TOKEN, path: "uxp" }))
      .toThrow("must begin with '/'");
  });

  it("forwards host events and command failures", async () => {
    const bridge = await createBridge();
    const client = await connectHost(bridge);
    const event = once(bridge, "event");
    client.send(JSON.stringify({ protocolVersion: 1, type: "event", payload: { kind: "projectChanged" } }));
    await expect(event).resolves.toEqual([{ kind: "projectChanged" }]);

    client.once("message", (data) => {
      const command = JSON.parse(data.toString());
      client.send(JSON.stringify({
        protocolVersion: 1, type: "result", requestId: command.requestId,
        payload: { ok: false, error: { code: "HOST_BUSY", message: "Dialog open" } },
      }));
    });
    await expect(bridge.request("state.get")).rejects.toMatchObject({ code: "HOST_BUSY", message: "Dialog open" });
    client.close();
  });

  it("rejects requests while stopped and rejects work when a host reconnects", async () => {
    const bridge = await createBridge();
    await expect(bridge.request("state.get")).rejects.toMatchObject({ code: "UXP_NOT_CONNECTED" });
    const first = await connectHost(bridge);
    const pending = bridge.request("state.get");
    const rejection = expect(pending).rejects.toMatchObject({ code: "UXP_RECONNECTED" });
    const second = await connectHost(bridge);
    await rejection;
    first.on("error", () => {});
    second.close();
  });

  it("closes clients that send invalid JSON or an invalid handshake", async () => {
    const bridge = await createBridge();
    const invalidJson = new WebSocket(bridgeUrl(bridge));
    await once(invalidJson, "open");
    invalidJson.send("{");
    const [jsonCode] = await once(invalidJson, "close");
    expect(jsonCode).toBe(1007);

    const invalidHello = new WebSocket(bridgeUrl(bridge));
    await once(invalidHello, "open");
    invalidHello.send(JSON.stringify({ protocolVersion: 99, type: "hello", payload: { backend: "uxp", protocolVersion: 99, commands: {} } }));
    const [helloCode] = await once(invalidHello, "close");
    expect(helloCode).toBe(1008);
  });
});
