import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getEffectsTools } from "../../src/tools/effects.js";
const send = vi.mocked(sendCommand);
const tool = getEffectsTools({ tempDir: "/tmp/color-correct", timeoutMs: 5000 }).color_correct;
function collection<T>(values: T[]) { return Object.assign(values, { numItems: values.length }); }
function host(options: { missingCatalog?: boolean; ignoreAdd?: boolean; existing?: boolean; ignoredWrite?: boolean; localized?: boolean; throwAfterAdd?: boolean } = {}) {
  let value = 0;
  const property = { displayName: options.localized ? "Exposición" : "Exposure", setValue: vi.fn((next: number) => { if (!options.ignoredWrite) value = next; }), getValue: () => value };
  const lumetri = { displayName: "Lumetri Color", properties: collection([property]) };
  const components = collection(options.existing ? [lumetri] : []);
  const clip = { nodeId: "c1", name: "Video", start: { ticks: "0" }, components };
  const add = vi.fn(() => { if (!options.ignoreAdd) { components.push(lumetri); components.numItems = components.length; } if (options.throwAfterAdd) throw Error("partial add"); });
  const qeClip = { type: "Clip", name: "Video", start: { ticks: "0" }, addVideoEffect: add };
  const qeProject = { getActiveSequence: () => ({ getVideoTrackAt: () => ({ numItems: 1, getItemAt: () => qeClip }) }), getVideoEffectList: () => collection([{ name: options.missingCatalog ? "Other" : "Lumetri Color" }]), getVideoEffectByName: (name: string) => ({ name }) };
  const app = { enableQE: vi.fn(), project: { activeSequence: { videoTracks: { numTracks: 1, 0: { clips: collection([clip]) } }, audioTracks: { numTracks: 0 } } } };
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, qe: { project: qeProject } }))));
  return { add, property };
}
beforeEach(() => vi.resetAllMocks());
describe("color_correct verified receipts (#720)", () => {
  it("requires at least one value before sending a command", async () => {
    await expect(tool.handler({ node_id: "c1" })).resolves.toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("fails before mutation when Lumetri is absent from the catalog", async () => {
    const state = host({ missingCatalog: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false });
    expect(state.add).not.toHaveBeenCalled();
  });
  it("does not report success when QE silently ignores insertion", async () => {
    host({ ignoreAdd: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { colorCorrected: false, outcome: "committed_unverified", renderVerified: false } });
  });
  it("reports missing localized properties instead of empty successful changes", async () => {
    const state = host({ localized: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { colorCorrected: false, errors: { exposure: expect.any(String) } } });
    expect(state.property.setValue).not.toHaveBeenCalled();
  });
  it("fails readback when a setter silently ignores a requested value", async () => {
    host({ existing: true, ignoredWrite: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { timelineChanged: true, colorCorrected: false } });
  });
  it("requires every requested value", async () => {
    host({ existing: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5, contrast: 10 })).resolves.toMatchObject({ success: false, data: { changes: { exposure: 0.5 }, errors: { contrast: expect.any(String) } } });
  });
  it("keeps a throw-after-add result unverified", async () => {
    host({ throwAfterAdd: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { hostError: "Error: partial add" } });
  });
  it("returns requested zero with property verification and a render boundary", async () => {
    const state = host();
    await expect(tool.handler({ node_id: "c1", exposure: 0 })).resolves.toMatchObject({ success: true, data: { colorCorrected: true, verified: true, renderVerified: false, changes: { exposure: 0 } } });
    expect(state.property.setValue).toHaveBeenCalledTimes(1);
  });
});
