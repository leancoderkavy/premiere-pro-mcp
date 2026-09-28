import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const TOKEN = "symlink-guard-token-0123456789abcdef";
const bridges: UxpWebSocketBridge[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("UXP bridge symlink confinement (#640)", () => {
  it("refuses symlinked path arguments before sending anything to the host", async () => {
    const base = mkdtempSync(join(tmpdir(), "uxp-link-"));
    dirs.push(base);
    const outside = join(base, "outside");
    const linked = join(base, "linked");
    mkdirSync(outside);
    symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");

    const bridge = new UxpWebSocketBridge({ token: TOKEN, port: 0 });
    bridges.push(bridge);
    await bridge.start();
    const address = bridge.address();
    const client = new WebSocket(`ws://${address.host}:${address.port}${address.path}?token=${TOKEN}`);
    await once(client, "open");
    const connected = once(bridge, "connected");
    client.send(JSON.stringify({
      protocolVersion: 1,
      type: "hello",
      payload: { backend: "uxp", protocolVersion: 1, commands: { "media.import": { supported: true } } },
    }));
    await connected;

    let sent = 0;
    client.on("message", () => { sent += 1; });
    await expect(bridge.request("media.import", { filePaths: [join(linked, "clip.mp4")] })).rejects.toMatchObject({
      code: "UXP_PATH_SYMLINK_REFUSED",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toBe(0);
    client.close();
  });
});
