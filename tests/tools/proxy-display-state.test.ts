import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };
const tools = getExportTools(bridgeOptions);

interface FakeProxyHost {
  enabled: number;
  writes: number[];
  ignoreWrites: boolean;
}

function fakeHost(enabled: number, ignoreWrites = false): FakeProxyHost {
  return { enabled, writes: [], ignoreWrites };
}

async function runToggle(host: FakeProxyHost, args: Record<string, unknown>) {
  mockedSendCommand.mockClear();
  await tools.manage_proxies.handler({ item_id: "clip1", action: "toggle", ...args } as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  const script = mockedSendCommand.mock.calls[0][0] as string;
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: {
      project: { rootItem: { children: { numItems: 1, 0: { nodeId: "clip1", name: "Clip", type: 1 } } } },
      getEnableProxies: () => host.enabled,
      setEnableProxies: (value: number) => {
        host.writes.push(value);
        if (!host.ignoreWrites) host.enabled = value;
      },
    },
  })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendCommand.mockResolvedValue({ success: true, data: {} });
});

describe("manage_proxies toggle sets the application-wide proxy display state", () => {
  it("describes toggle as application-wide and exposes enabled", () => {
    expect(tools.manage_proxies.description).toMatch(/application-wide, not per item/);
    const properties = tools.manage_proxies.parameters.properties as Record<string, { type: string; description: string }>;
    expect(properties.enabled.type).toBe("boolean");
    expect(properties.enabled.description).toMatch(/application-wide proxy display/);
  });

  it("leaves proxies on when enabled: true is requested and they are already on", async () => {
    const host = fakeHost(1);
    const result = await runToggle(host, { enabled: true });

    expect(result).toMatchObject({
      success: true,
      data: { action: "toggle", mode: "set", previousEnabled: true, proxiesEnabled: true, changed: false, verified: true },
    });
    expect(host.writes).toEqual([]);
    expect(host.enabled).toBe(1);
  });

  it("turns proxies off when enabled: false is requested from on", async () => {
    const host = fakeHost(1);
    const result = await runToggle(host, { enabled: false });

    expect(result).toMatchObject({
      success: true,
      data: { mode: "set", previousEnabled: true, proxiesEnabled: false, changed: true, verified: true, scope: "application-wide proxy display" },
    });
    expect(host.writes).toEqual([0]);
    expect(host.enabled).toBe(0);
  });

  it("fails when Premiere ignores the write", async () => {
    const host = fakeHost(0, true);
    const result = await runToggle(host, { enabled: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("requested enabled, read back disabled");
    expect(result.data).toMatchObject({ previousEnabled: false, requestedEnabled: true, proxiesEnabled: false, verified: false, outcome: "failed" });
    expect(host.writes).toEqual([1]);
  });

  it("still flips the current state when enabled is omitted and reports the previous state", async () => {
    const host = fakeHost(1);
    const result = await runToggle(host, {});

    expect(result).toMatchObject({
      success: true,
      data: { mode: "flip", previousEnabled: true, proxiesEnabled: false, changed: true, verified: true },
    });
    expect(host.writes).toEqual([0]);
  });

  it("refuses a non-boolean enabled before contacting Premiere", async () => {
    mockedSendCommand.mockClear();
    const result = await tools.manage_proxies.handler({ item_id: "clip1", action: "toggle", enabled: "true" } as never);

    expect(result).toMatchObject({ success: false, error: "enabled must be a boolean" });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
  it("refuses an unknown action before building a script", async () => {
    const before = vi.mocked(sendCommand).mock.calls.length;
    const result = await tools.manage_proxies.handler({ item_id: "i", action: 'toggle"; evil(); "' } as never);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("action must be") });
    expect(vi.mocked(sendCommand).mock.calls.length).toBe(before);
  });
});
