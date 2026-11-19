import { runWithExpectedProject } from "../../src/bridge/project-guard.js";
import { createServer, request } from "node:http";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { cleanupTempDirs, makePrivateBridgeTempDir } from "../helpers/temp-dir.js";

const TOKEN = "handoff-test-token-at-least-sixteen";
const bridges: UxpWebSocketBridge[] = [];
const panels: { stop: () => void }[] = [];

afterEach(async () => {
  panels.splice(0).forEach((panel) => panel.stop());
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  cleanupTempDirs();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function makeBridge(port: number, token = TOKEN, tempDir?: string): UxpWebSocketBridge {
  const bridge = new UxpWebSocketBridge({
    token, port, requestTimeoutMs: 500, claimTimeoutMs: 2_000,
    tempDir: tempDir ?? makePrivateBridgeTempDir("uxp-handoff-"),
  });
  bridges.push(bridge);
  return bridge;
}

/** Minimal stand-in for the UXP panel: connects, says hello, answers state.get, reconnects on close. */
function fakePanel(port: number, reconnectMs = 50, onRequest?: (reply: () => void) => void) {
  let stopped = false;
  let socket: WebSocket | null = null;
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(`ws://127.0.0.1:${port}/uxp?token=${TOKEN}`);
    socket.on("open", () => socket?.send(JSON.stringify({
      protocolVersion: 2, type: "hello",
      payload: { backend: "uxp", protocolVersion: 2, commands: { "state.get": { supported: true, readOnly: true } } },
    })));
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      const current = socket;
      const reply = () => current?.send(JSON.stringify({ protocolVersion: 2, type: "result", requestId: frame.requestId, payload: { ok: true, result: { answeredBy: "panel" } } }));
      if (onRequest) onRequest(reply); else reply();
    });
    socket.on("error", () => undefined);
    socket.on("close", () => { if (!stopped) setTimeout(connect, reconnectMs); });
  };
  connect();
  const panel = { stop: () => { stopped = true; socket?.terminate(); } };
  panels.push(panel);
  return panel;
}

function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => (check() ? resolve() : Date.now() - started > timeoutMs ? reject(new Error("timed out")) : setTimeout(tick, 10));
    tick();
  });
}

function postHandoff(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/uxp/handoff", method: "POST", headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end();
  });
}

describe("UXP loopback port handoff between server processes", () => {
  it("lets a second instance join as a relay instead of stealing the panel (KAV-388 / #992)", async () => {
    const port = await freePort();
    const owner = makeBridge(port);
    await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);

    const second = makeBridge(port);
    await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(second.getState()).toMatchObject({ status: "stopped", connected: false });

    await second.startOrJoin();
    expect(second.getState()).toMatchObject({ connected: true, route: "relay" });
    await expect(second.request("state.get")).resolves.toEqual({ answeredBy: "panel" });
    await expect(owner.request("state.get")).resolves.toEqual({ answeredBy: "panel" });
    expect(owner.getState()).toMatchObject({ status: "connected", connected: true, route: "local" });
  });

  it("rejects caller project guards before a relay can dispatch", async () => {
    const port = await freePort();
    const owner = makeBridge(port); await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port); await second.startOrJoin();
    await expect(runWithExpectedProject("C:/private/project.prproj", () => second.request("state.get")))
      .rejects.toMatchObject({ code: "UXP_PROJECT_GUARD_UNSUPPORTED" });
  });

  it("rejects excessive relay timeouts before dispatch", async () => {
    const port = await freePort();
    const owner = makeBridge(port); await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port); await second.startOrJoin();
    await expect(second.request("state.get", {}, { minimumTimeoutMs: 2147483647 }))
      .rejects.toThrow("timeout");
  });

  it("refreshes unsupported capabilities without reacquiring the caller's shared lease", async () => {
    const port = await freePort();
    const tempDir = makePrivateBridgeTempDir("uxp-shared-lease-");
    const owner = makeBridge(port, TOKEN, tempDir); await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port, TOKEN, tempDir); await second.startOrJoin();
    await expect(second.request("unsupported.command")).rejects.toMatchObject({ code: "UXP_COMMAND_UNSUPPORTED" });
  });

  it("explicitly claims a local socket after joining as a relay", async () => {
    const port = await freePort();
    const owner = makeBridge(port); await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port); await second.startOrJoin();
    expect(second.getState().route).toBe("relay");
    await expect(second.claim()).resolves.toBe(true);
    expect(second.getState()).toMatchObject({ connected: true, route: "local" });
    expect(owner.getState().connected).toBe(false);
  });

  it("does not trust an unsigned port owner or disclose the shared token", async () => {
    const port = await freePort();
    let leaked: unknown;
    const imposter = createServer((req, res) => {
      leaked = req.headers["x-premiere-uxp-token"];
      res.end(JSON.stringify({ connected: false, status: "listening" }));
    });
    await new Promise<void>(resolve => imposter.listen(port, "127.0.0.1", resolve));
    try {
      expect(await makeBridge(port).attachRelay()).toBe(false);
      expect(leaked).toBeUndefined();
    } finally { await new Promise<void>(resolve => imposter.close(() => resolve())); }
  });

  it("keeps both sessions usable when they request the panel in turn", async () => {
    const port = await freePort();
    const a = makeBridge(port); await a.start();
    fakePanel(port);
    await until(() => a.getState().connected);
    const b = makeBridge(port);
    await expect(b.request("state.get")).resolves.toEqual({ answeredBy: "panel" });
    expect(b.getState()).toMatchObject({ connected: true, route: "relay" });
    await expect(a.request("state.get")).resolves.toEqual({ answeredBy: "panel" });
    expect(a.getState()).toMatchObject({ connected: true, route: "local" });
  });

  it("still lets an explicit claim take the port over from the owner", async () => {
    const port = await freePort();
    const owner = makeBridge(port);
    await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port);
    await expect(second.claim()).resolves.toBe(true);
    expect(second.getState()).toMatchObject({ connected: true, route: "local" });
    expect(owner.getState()).toMatchObject({ status: "stopped", connected: false });
  });

  it("refuses a handoff without the shared token or from a non-loopback Host", async () => {
    const port = await freePort();
    const owner = makeBridge(port); await owner.start();
    expect(await postHandoff(port, {})).toBe(404);
    expect(await postHandoff(port, { "x-premiere-uxp-token": "wrong-token-wrong-token" })).toBe(404);
    expect(await postHandoff(port, { "x-premiere-uxp-token": TOKEN, host: "evil.example:7777" })).toBe(404);
    expect(owner.getState().status).toBe("listening");
  });

  it("keeps the panel attached until an in-flight host command finishes", async () => {
    const port = await freePort();
    const owner = makeBridge(port); await owner.start();
    let reply: (() => void) | undefined;
    fakePanel(port, 50, (respond) => { reply = respond; });
    await until(() => owner.getState().connected);
    const pending = owner.request("state.get");
    await until(() => !!reply);
    expect(await postHandoff(port, { "x-premiere-uxp-token": TOKEN })).toBe(409);
    expect(owner.getState().connected).toBe(true);
    reply!();
    await expect(pending).resolves.toEqual({ answeredBy: "panel" });
    expect(await postHandoff(port, { "x-premiere-uxp-token": TOKEN })).toBe(200);
  });

  it("does not take the port from a server configured with a different token", async () => {
    const port = await freePort();
    const owner = makeBridge(port, "a-completely-different-token-123"); await owner.start();
    const other = makeBridge(port);
    await expect(other.claim(200)).resolves.toBe(false);
    expect(owner.getState().status).toBe("listening");
    await expect(other.request("state.get")).rejects.toMatchObject({ code: "UXP_NOT_CONNECTED" });
  });

  it("still reports not connected when no panel arrives after a claim", async () => {
    const port = await freePort();
    const lone = makeBridge(port);
    await expect(lone.claim(150)).resolves.toBe(false);
    expect(lone.getState().status).toBe("listening");
  });

  it("does not bind again after startOrJoin attaches as a relay client", async () => {
    const port = await freePort();
    const owner = makeBridge(port);
    await owner.start();
    fakePanel(port);
    await until(() => owner.getState().connected);
    const second = makeBridge(port);
    await second.startOrJoin();
    expect(second.getState().route).toBe("relay");
    await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
