import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUxpTools } from "../../src/tools/uxp.js";
import { getUxpWorkflowTools } from "../../src/tools/uxp-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

type Schema = { type?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema };
type Tool = { parameters: Schema; handler: (args: Record<string, unknown>) => Promise<unknown> };

const values: Record<string, unknown> = {
  name: "Coverage Name", query: "coverage", preset_path: "/tmp/preset.sqpreset",
  output_file_path: "/tmp/output.otio", project_item_id: "item-1", track_index: 0,
  start_seconds: 1, end_seconds: 2, transcript_revision: `sha256:${"a".repeat(64)}`,
};

function valueFor(schema: Schema, field: string, all: boolean): unknown {
  if (field in values) return values[field];
  if (schema.enum?.length) return all ? schema.enum.at(-1) : schema.enum[0];
  if (schema.type === "boolean") return all;
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "array") return [valueFor(schema.items ?? { type: "string" }, field, all)];
  if (schema.type === "object") return argsFor(schema, all);
  return `coverage-${field}`;
}

function argsFor(schema: Schema, all: boolean) {
  const result: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (all || required.has(field)) result[field] = valueFor(property, field, all);
  }
  return result;
}

describe("UXP tool handler coverage", () => {
  const request = vi.fn();
  const getState = vi.fn(() => ({ connected: true, authenticated: true }));
  const bridge = { request, getState } as unknown as UxpWebSocketBridge;
  const tools = getUxpTools(bridge) as Record<string, Tool>;

  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue({
      json: JSON.stringify({ words: [], segments: [] }),
      projectItemId: "item-1",
      projectItemName: "Coverage",
    });
  });

  for (const [name, tool] of Object.entries(tools)) {
    it.each([["required", false], ["all", true]])(`${name} handles %s arguments`, async (_label, all) => {
      const args = argsFor(tool.parameters, all);
      if (name === "manage_timeline_selection_uxp" && all) args.action = "replace";
      const result = await tool.handler(args);
      expect(result).toBeDefined();
      if (name === "get_uxp_capabilities") expect(getState).toHaveBeenCalled();
      else expect(request).toHaveBeenCalled();
    });
  }

  it("normalizes Error and non-Error bridge rejections", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(tools.get_uxp_state.handler({})).resolves.toEqual({ success: false, error: "offline" });
    request.mockRejectedValueOnce("disconnected");
    await expect(tools.get_uxp_state.handler({})).resolves.toEqual({ success: false, error: "disconnected" });
  });

  it("rejects an empty exported transcript", async () => {
    request.mockResolvedValueOnce({ json: "" });
    await expect(tools.get_clip_transcript_uxp.handler({ project_item_id: "item-1" }))
      .resolves.toEqual({ success: false, error: "Premiere returned an empty transcript" });
  });
});

describe("UXP workflow handler branch coverage", () => {
  const request = vi.fn();
  const bridge = { request } as unknown as UxpWebSocketBridge;
  const tools = getUxpWorkflowTools(bridge) as Record<string, Tool>;

  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue({ covered: true });
  });

  for (const [name, tool] of Object.entries(tools)) {
    it.each([["required", false], ["all", true]])(`${name} handles %s arguments`, async (_label, all) => {
      await expect(tool.handler(argsFor(tool.parameters, all))).resolves.toBeDefined();
    });

    for (const [field, property] of Object.entries(tool.parameters.properties ?? {})) {
      for (const enumValue of property.enum ?? []) {
        it(`${name} handles ${field}=${String(enumValue)}`, async () => {
          const args = argsFor(tool.parameters, true);
          args[field] = enumValue;
          await expect(tool.handler(args)).resolves.toBeDefined();
        });
      }
      if (property.type === "boolean") {
        it(`${name} handles ${field}=false`, async () => {
          const args = argsFor(tool.parameters, true);
          args[field] = false;
          await expect(tool.handler(args)).resolves.toBeDefined();
        });
      }
    }

    if (tool.parameters.properties?.action?.enum) {
      it(`${name} rejects an unsupported action`, async () => {
        const args = argsFor(tool.parameters, true);
        args.action = "unsupported-action";
        await expect(tool.handler(args)).resolves.toMatchObject({ success: false });
      });
    }
  }

  it("normalizes workflow bridge failures", async () => {
    request.mockRejectedValueOnce(new Error("workflow offline"));
    await expect(tools.manage_clip_effects_uxp.handler({ action: "catalog" }))
      .resolves.toEqual({ success: false, error: "workflow offline" });
    request.mockRejectedValueOnce("disconnected");
    await expect(tools.manage_clip_effects_uxp.handler({ action: "catalog" }))
      .resolves.toEqual({ success: false, error: "disconnected" });
  });
});
