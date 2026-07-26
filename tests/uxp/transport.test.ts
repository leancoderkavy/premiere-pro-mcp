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
  });
});
