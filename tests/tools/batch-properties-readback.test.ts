import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

const tool = getCompetitorGapTools({}).set_clip_properties_batch;
const nodeId = "clip '\" \\ \n fixture";
type PropertyName = "Opacity" | "Scale" | "Scale Width" | "Rotation" | "Position";
type BatchItem = Parameters<typeof tool.handler>[0]["items"][number];

function host(target: PropertyName, readback?: { value: unknown }) {
  const values: Record<string, unknown> = {
    Opacity: 100, Scale: 100, "Scale Width": 100, "Uniform Scale": false,
    Rotation: 10, Position: [0.5, 0.5],
  };
  const writes: Record<string, number> = {};
  function property(displayName: string) {
    return {
      displayName,
      getValue: () => displayName === target && writes[displayName] === 1 && readback
        ? readback.value : values[displayName],
      setValue: (value: unknown) => {
        writes[displayName] = (writes[displayName] ?? 0) + 1;
        values[displayName] = value;
      },
    };
  }
  const motionNames = ["Scale", "Scale Width", "Uniform Scale", "Rotation", "Position"];
  const components = [
    { displayName: "Opacity", matchName: "AE.ADBE Opacity", properties: { numItems: 1, 0: property("Opacity") } },
    { displayName: "Motion", matchName: "AE.ADBE Motion", properties: { numItems: motionNames.length, ...motionNames.map(property) } },
  ];
  const clip = { nodeId, name: "Fixture", components: { numItems: components.length, ...components } };
  const sequence = {
    frameSizeHorizontal: 1920, frameSizeVertical: 1080,
    videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } },
    audioTracks: { numTracks: 0 },
  };
  vi.mocked(sendCommand).mockImplementation(async (script) => {
    const source = getHelpersSource() + "\n" + script;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(source, { app: { project: { activeSequence: sequence } } })));
  });
  return { values, writes };
}

function item(property: PropertyName): BatchItem {
  if (property === "Opacity") return { node_id: nodeId, opacity: 0 };
  if (property === "Scale" || property === "Scale Width") return { node_id: nodeId, scale: 120 };
  if (property === "Rotation") return { node_id: nodeId, rotation: 0 };
  return { node_id: nodeId, position_x: 0.25, position_y: 0.75, units: "normalized" };
}

beforeEach(() => { vi.mocked(sendCommand).mockReset(); });

describe("batch property host readback", () => {
  const scalarProperties: PropertyName[] = ["Opacity", "Scale", "Scale Width", "Rotation"];
  const unreadable = [
    ["undefined", undefined], ["NaN", NaN], ["infinity", Infinity],
    ["null", null], ["numeric string", "0"], ["boolean", false],
  ] as const;

  for (const property of scalarProperties) {
    it("verifies finite numeric " + property + " including an escaped clip ID", async () => {
      const fixture = host(property);
      const result = await tool.handler({ items: [item(property)] });
      expect(result).toMatchObject({ success: true, data: { verified: true } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }, "set_clip_properties_batch").outcome).toBe("verified");
      expect(fixture.writes[property]).toBe(1);
    });
    for (const [label, value] of unreadable) {
      it("refuses " + property + " readback containing " + label, async () => {
        const fixture = host(property, { value });
        const result = await tool.handler({ items: [item(property)] });
        expect(result).toMatchObject({ success: false, error: expect.stringContaining("did not verify batch item") });
        expect(mutationReceipt(result.success, result.data, { dispatched: true }, "set_clip_properties_batch").outcome).not.toBe("verified");
        expect(fixture.writes[property]).toBe(2);
        expect(fixture.values[property]).toBe(property === "Rotation" ? 10 : 100);
      });
    }
  }

  it("verifies both finite numeric Position components", async () => {
    const fixture = host("Position");
    expect(await tool.handler({ items: [item("Position")] })).toMatchObject({ success: true, data: { verified: true } });
    expect(fixture.values.Position).toEqual([0.25, 0.75]);
  });

  const invalidPositions = [
    ["missing component", [0.25]], ["extra component", [0.25, 0.75, 1]],
    ["undefined component", [0.25, undefined]], ["NaN component", [NaN, 0.75]],
    ["infinite component", [0.25, Infinity]], ["null component", [0.25, null]],
    ["string component", ["0.25", 0.75]],
    ["array-like object", { 0: 0.25, 1: 0.75, length: 2 }],
  ] as const;
  for (const [label, value] of invalidPositions) {
    it("refuses Position readback with " + label, async () => {
      const fixture = host("Position", { value });
      expect(await tool.handler({ items: [item("Position")] })).toMatchObject({ success: false, error: expect.stringContaining("did not verify batch item") });
      expect(fixture.values.Position).toEqual([0.5, 0.5]);
      expect(fixture.writes.Position).toBe(2);
    });
  }
});
