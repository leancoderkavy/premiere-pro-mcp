import { describe, expect, it, vi } from "vitest";
import cases from "../fixtures/authority/catalog.json";
import { collectTools } from "../../src/server.js";
import { CAPABILITIES, CapabilityDeniedError, capabilitiesForToolInvocation, guardToolHandler, isToolPermitted, type Capability } from "../../src/security/capabilities.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const mockBridge = { request: vi.fn(async () => ({})), getState: () => ({ connected: true, status: "connected" }) } as unknown as UxpWebSocketBridge;
const catalog = collectTools({}, { capabilities: new Set(), source: "explicit" }, mockBridge);
const config = (names: readonly string[]) => ({ capabilities: new Set(names as Capability[]), source: "explicit" as const });

describe("catalog authority before handler dispatch", () => {
  it("covers every registered tool and action, including native facades", () => {
    expect(Object.keys(catalog)).toHaveLength(541);
    expect(new Set(cases.map(row => row.tool))).toEqual(new Set(Object.keys(catalog)));
    for (const [name, tool] of Object.entries(catalog)) {
      const actions = (tool.parameters as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum ?? [];
      for (const action of actions) expect(cases.some(row => row.tool === name && "action" in row.args && row.args.action === action), `${name}:${action}`).toBe(true);
    }
  });

  for (const row of cases) {
    const label = `${row.tool}:${JSON.stringify(row.args)}`;
    it(`${label} matches the reviewed authority and admits its least set`, async () => {
      expect(capabilitiesForToolInvocation(row.tool, row.args)).toEqual(row.required);
      const handler = vi.fn(async () => ({ success: true }));
      await expect(guardToolHandler(row.tool, handler, config(row.required))(row.args)).resolves.toEqual({ success: true });
      expect(handler).toHaveBeenCalledExactlyOnceWith(row.args);
    });
    it(`${label} refuses empty and each missing authority before dispatch`, async () => {
      const deniedProfiles = [[], ...row.required.map(missing => CAPABILITIES.filter(value => value !== missing))];
      for (const names of deniedProfiles) {
        const handler = vi.fn(async () => ({ success: true }));
        await expect(guardToolHandler(row.tool, handler, config(names))(row.args)).rejects.toBeInstanceOf(CapabilityDeniedError);
        expect(handler).not.toHaveBeenCalled();
      }
    });
  }

  for (const name of Object.keys(catalog)) {
    it(`${name} refuses hostile shapes with no authority before dispatch`, async () => {
      const payloads: unknown[] = [undefined, null, false, 0, "", [], {}, { action: "__proto__" }, { action: "constructor" }, { action: "toString" }, { action: [] }, { action: {} }];
      for (const payload of payloads) {
        const handler = vi.fn(async () => ({ success: true }));
        await expect(guardToolHandler(name, handler, config([]))(payload)).rejects.toBeInstanceOf(CapabilityDeniedError);
        expect(handler).not.toHaveBeenCalled();
      }
    });
  }

  it("advertises inline EDL serialization without filesystem authority", () => {
    expect(isToolPermitted("export_sequence_edl", config(["export"]))).toBe(true);
    expect(isToolPermitted("export_sequence_edl", config([]))).toBe(false);
  });

  it("blocks a real native render before its mocked bridge, then allows exact authority", async () => {
    const args = { output_directory: "/approved", filename: "frame.png" };
    mockBridge.request = vi.fn(async () => ({ accepted: true })) as UxpWebSocketBridge["request"];
    const tool = collectTools({}, config(["edit", "export", "filesystem"]), mockBridge).export_frame_uxp;
    await expect(guardToolHandler("export_frame_uxp", tool.handler, config(["export", "filesystem"]))(args)).rejects.toBeInstanceOf(CapabilityDeniedError);
    expect(mockBridge.request).not.toHaveBeenCalled();
    await guardToolHandler("export_frame_uxp", tool.handler, config(["edit", "export", "filesystem"]))(args);
    expect(mockBridge.request).toHaveBeenCalledOnce();
  });
});
