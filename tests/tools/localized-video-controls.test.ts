import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const send = vi.mocked(sendCommand);
const tools = getTrackTargetingTools({ tempDir: "/tmp/localized-video", timeoutMs: 5000 } as BridgeOptions);

function spanishHost(ignoredWrite?: string) {
  const values: Record<string, unknown> = {
    "Posición": [0.5, 0.5], "Escala": 100, "Anchura de escala": 100,
    "Escala uniforme": false, "Rotación": 0, "Opacidad": 100,
  };
  function property(displayName: string) {
    return {
      displayName,
      getValue: () => values[displayName],
      setValue: (value: unknown) => { if (displayName !== ignoredWrite) values[displayName] = value; },
    };
  }
  function component(displayName: string, matchName: string, names: string[]) {
    const props = names.map(property);
    return { displayName, matchName, properties: { numItems: props.length, ...props } };
  }
  const motion = component("Movimiento", "AE.ADBE Motion", ["Posición", "Escala", "Anchura de escala", "Escala uniforme", "Rotación"]);
  const opacity = component("Opacidad", "AE.ADBE Opacity", ["Opacidad"]);
  const clip = { nodeId: "c1", name: "Video", components: { numItems: 2, 0: motion, 1: opacity } };
  const sequence = { frameSizeHorizontal: 1920, frameSizeVertical: 1080, videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
  send.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: sequence } } }))));
  return values;
}

beforeEach(() => vi.clearAllMocks());

describe("Spanish built-in video controls (#722)", () => {
  it("writes Position in normalized host units and reads it back", async () => {
    const values = spanishHost();
    await expect(tools.set_clip_position.handler({ node_id: "c1", x: 1152, y: 540 })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(values["Posición"]).toEqual([0.6, 0.5]);
  });

  it("scales both axes when Escala uniforme is off", async () => {
    const values = spanishHost();
    await expect(tools.set_clip_scale.handler({ node_id: "c1", scale: 120 })).resolves.toMatchObject({ success: true, data: { verified: true, uniformScale: false } });
    expect(values["Escala"]).toBe(120);
    expect(values["Anchura de escala"]).toBe(120);
  });

  it("writes Rotation and Opacity with readback", async () => {
    const values = spanishHost();
    await expect(tools.set_clip_rotation.handler({ node_id: "c1", degrees: 15 })).resolves.toMatchObject({ success: true, data: { verified: true } });
    await expect(tools.set_clip_opacity.handler({ node_id: "c1", opacity: 60 })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(values["Rotación"]).toBe(15);
    expect(values["Opacidad"]).toBe(60);
  });

  it("does not claim verified when Premiere ignores the localized write", async () => {
    spanishHost("Rotación");
    await expect(tools.set_clip_rotation.handler({ node_id: "c1", degrees: 15 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("read back") });
  });
});
