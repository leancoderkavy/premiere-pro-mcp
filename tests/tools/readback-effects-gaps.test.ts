import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getEffectsTools } from "../../src/tools/effects.js";

const send = vi.mocked(sendCommand);
const options = { tempDir: "/tmp/readback-effects", timeoutMs: 1000 };
const keyframes = getKeyframeTools(options);
const effects = getEffectsTools(options);
function collection<T>(items: T[]) { return Object.assign(items, { numItems: items.length }); }
function evaluate(script: string, extras: Record<string, unknown>) {
  return JSON.parse(runInNewContext(script, {
    __findClip: () => extras.result,
    __result: (data: unknown) => JSON.stringify({ success: true, data }),
    __error: (error: string, data?: unknown) => JSON.stringify({ success: false, error, data }),
    __resolveProperty: (component: { properties: unknown[] }) => ({ property: component.properties[0], index: 0 }),
    __readColorValue: () => null,
    ...extras,
  }));
}
beforeEach(() => { send.mockReset(); });

async function setProperty(mode: "write" | "ignore" | "unreadable" | "varying", name = 'Fx"\\\n') {
  let value = 3;
  const property = {
    isTimeVarying: () => mode === "varying",
    setValue: (next: number) => { if (mode !== "ignore") value = next; },
    getValue: () => { if (mode === "unreadable") throw new Error("unreadable"); return value; },
  };
  send.mockImplementation(async (script) => evaluate(script, { result: { clip: { components: collection([{ displayName: name, properties: collection([property]) }]) } } }));
  return keyframes.set_effect_property.handler({ node_id: 'a"\\\n', effect_name: name, property_name: 'Prop"\\\n', value: 9 });
}

describe("effect property write receipts", () => {
  it("verifies readback and executes escaped strings", async () => {
    expect(await setProperty("write")).toMatchObject({ success: true, data: { value: 9, requestedValue: 9, appliedValue: 9, verified: true, outcome: "verified" } });
  });
  it("reports an ignored write as failed with the observed value", async () => {
    expect(await setProperty("ignore")).toMatchObject({ success: false, data: { value: 3, appliedValue: 3, outcome: "failed", verified: false } });
  });
  it("does not echo the request when readback throws", async () => {
    expect(await setProperty("unreadable")).toMatchObject({ success: true, data: { set: null, value: null, appliedValue: null, requestedValue: 9, outcome: "committed_unverified", verified: false } });
  });
  it("refuses animated static writes", async () => {
    expect(await setProperty("varying")).toMatchObject({ success: false, error: expect.stringContaining("time-specific") });
  });
  it("rejects invalid input without touching the host", async () => {
    expect(await keyframes.set_effect_property.handler({ node_id: "a", effect_name: "Fx", property_name: "P", value: NaN })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
});

async function stabilize(mode: "write" | "ignore-add" | "ignore-value" | "numeric-method" | "unreadable") {
  let smoothness = 50;
  const components = collection<Array<unknown>[number]>([]);
  const properties = collection([
    { displayName: "Smoothness", setValue: (value: number | string) => { if (mode !== "ignore-value") smoothness = Number(value); }, getValue: () => { if (mode === "unreadable") throw new Error("unreadable"); return smoothness; } },
    { displayName: "Method", setValue: vi.fn(), getValue: () => 4 },
  ]);
  const clip = { name: 'Clip"\\\n', components };
  const qeClip = { addVideoEffect: () => { if (mode !== "ignore-add") { components.push({ displayName: "Warp Stabilizer", properties }); components.numItems = components.length; } } };
  send.mockImplementation(async (script) => evaluate(script, {
    result: { clip, trackType: "video", trackIndex: 0 },
    app: { enableQE: () => {} },
    qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: () => ({}) }) } },
    __findQeClipByDomClip: () => qeClip,
    __getQeEffectCatalog: () => ({ ok: true, effects: collection([{ name: "Warp Stabilizer" }]) }),
    __qeEffectObject: () => ({}),
  }));
  const receipt = await effects.stabilize_clip.handler({ node_id: 'a"\\\n', smoothness: 75, ...(mode === "numeric-method" ? { method: "Position" } : {}) });
  return { receipt, methodSetter: properties[1].setValue };
}
describe("stabilization write receipts", () => {
  it("verifies addition and parameter readback, without claiming analysis completed", async () => {
    expect((await stabilize("write")).receipt).toMatchObject({ success: true, data: { applied: { smoothness: 75 }, verified: true, outcome: "verified", analysisStatus: "unknown" } });
  });
  it("fails an ignored component addition", async () => {
    expect((await stabilize("ignore-add")).receipt).toMatchObject({ success: false, data: { outcome: "failed", verified: false } });
  });
  it("fails an ignored parameter write", async () => {
    expect((await stabilize("ignore-value")).receipt).toMatchObject({ success: false, data: { applied: { smoothness: 50 }, outcome: "failed" } });
  });
  it("keeps unreadable parameters unverified", async () => {
    expect((await stabilize("unreadable")).receipt).toMatchObject({ success: true, data: { outcome: "committed_unverified", applied: { smoothness: null } } });
  });
  it("never guesses a numeric Method popup mapping", async () => {
    const { receipt, methodSetter } = await stabilize("numeric-method");
    expect(receipt).toMatchObject({ success: true, data: { outcome: "committed_unverified", applied: { method: null } } });
    expect(methodSetter).not.toHaveBeenCalled();
  });
  it("refuses invalid smoothness before host access", async () => {
    expect(await effects.stabilize_clip.handler({ node_id: "a", smoothness: Infinity })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
});
