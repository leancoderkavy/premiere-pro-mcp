import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getEffectsTools } from "../../src/tools/effects.js";
const send = vi.mocked(sendCommand);
const tool = getEffectsTools({ tempDir: "/tmp/color-correct", timeoutMs: 5000 }).color_correct;
function collection<T>(values: T[]) { return Object.assign(values, { numItems: values.length }); }
function host(options: { missingCatalog?: boolean; ignoreAdd?: boolean; existing?: boolean; ignoredWrite?: boolean; localized?: boolean; throwAfterAdd?: boolean; duplicateSaturation?: boolean; sectionedSaturation?: boolean; missingBasicCorrection?: boolean } = {}) {
  let value = 0;
  const property = { displayName: options.localized ? "Exposición" : "Exposure", setValue: vi.fn((next: number) => { if (!options.ignoredWrite) value = next; }), getValue: () => value };
  let firstSaturationValue = 100;
  const saturation = { displayName: "Saturation", setValue: vi.fn((next: number) => { firstSaturationValue = next; }), getValue: () => firstSaturationValue };
  const secondSaturation = { displayName: "Saturation", setValue: vi.fn(), getValue: () => 100 };
  const header = (displayName: string) => ({ displayName, getValue: () => undefined, setValue: vi.fn() });
  const sectionedProperties = options.missingBasicCorrection
    ? [saturation, header("Creative"), secondSaturation]
    : [header("Basic Correction"), saturation, header("Creative"), secondSaturation];
  const lumetriProperties = options.sectionedSaturation
    ? sectionedProperties
    : [property, ...(options.duplicateSaturation ? [saturation, secondSaturation] : [])];
  const lumetri = { displayName: "Lumetri Color", properties: collection(lumetriProperties) };
  const components = collection(options.existing ? [lumetri] : []);
  const clip = { nodeId: "c1", name: "Video", start: { ticks: "0" }, components };
  const add = vi.fn(() => { if (!options.ignoreAdd) { components.push(lumetri); components.numItems = components.length; } if (options.throwAfterAdd) throw Error("partial add"); });
  const qeClip = { type: "Clip", name: "Video", start: { ticks: "0" }, addVideoEffect: add };
  const qeProject = { getActiveSequence: () => ({ getVideoTrackAt: () => ({ numItems: 1, getItemAt: () => qeClip }) }), getVideoEffectList: () => collection([{ name: options.missingCatalog ? "Other" : "Lumetri Color" }]), getVideoEffectByName: (name: string) => ({ name }) };
  const app = { enableQE: vi.fn(), project: { activeSequence: { videoTracks: { numTracks: 1, 0: { clips: collection([clip]) } }, audioTracks: { numTracks: 0 } } } };
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, qe: { project: qeProject } }))));
  return { add, property, saturation, secondSaturation, lumetri };
}
beforeEach(() => vi.resetAllMocks());
describe("color_correct verified receipts (#720)", () => {
  it("requires at least one value before sending a command", async () => {
    await expect(tool.handler({ node_id: "c1" })).resolves.toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("fails before mutation when Lumetri is absent from the catalog", async () => {
    const state = host({ missingCatalog: true });
    const result = await runWithUndoTracking(true, () => tool.handler({ node_id: "c1", exposure: 0.5 }));
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true } });
    expect(mutationReceipt(false, result.data, { dispatched: true }, "color_correct").outcome).toBe("not_applied");
    expect(state.add).not.toHaveBeenCalled();
  });
  it("does not report success when QE silently ignores insertion", async () => {
    host({ ignoreAdd: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { colorCorrected: false, outcome: "committed_unverified", renderVerified: false } });
  });
  it("reports missing localized properties instead of empty successful changes", async () => {
    const state = host({ localized: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Exposure"), data: { colorCorrected: false },
    });
    expect(state.property.setValue).not.toHaveBeenCalled();
  });
  it("reports no mutation when existing Lumetri has none of the requested controls", async () => {
    const state = host({ existing: true, localized: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { colorCorrected: false, timelineChanged: false, outcome: "not_applied" } });
    expect(state.add).not.toHaveBeenCalled();
    expect(state.property.setValue).not.toHaveBeenCalled();
  });
  it("refuses duplicate Lumetri display names with their indices before writing", async () => {
    const state = host({ existing: true, duplicateSaturation: true });
    await expect(tool.handler({ node_id: "c1", saturation: 80 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Saturation at property indices [1, 2]"),
      data: { timelineChanged: false, outcome: "not_applied" },
    });
    expect(state.saturation.setValue).not.toHaveBeenCalled();
  });
  it("sets the Basic Correction Saturation and refuses duplicate names when that section is missing", async () => {
    const state = host({ existing: true, sectionedSaturation: true });
    await expect(tool.handler({ node_id: "c1", saturation: 80 })).resolves.toMatchObject({
      success: true,
      data: { colorCorrected: true, changes: { saturation: 80 } },
    });
    expect(state.saturation.setValue).toHaveBeenCalledWith(80, true);
    expect(state.secondSaturation.setValue).not.toHaveBeenCalled();

    const missingHeaderState = host({ existing: true, sectionedSaturation: true, missingBasicCorrection: true });
    await expect(tool.handler({ node_id: "c1", saturation: 80 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Saturation at property indices [0, 2]"),
      data: { timelineChanged: false, outcome: "not_applied" },
    });
    expect(missingHeaderState.saturation.setValue).not.toHaveBeenCalled();
    expect(missingHeaderState.secondSaturation.setValue).not.toHaveBeenCalled();
  });
  it("fails readback when a setter silently ignores a requested value", async () => {
    host({ existing: true, ignoredWrite: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5 })).resolves.toMatchObject({ success: false, data: { timelineChanged: true, colorCorrected: false } });
  });
  it("requires every requested value", async () => {
    host({ existing: true });
    await expect(tool.handler({ node_id: "c1", exposure: 0.5, contrast: 10 })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Contrast"), data: { changes: {}, errors: {}, timelineChanged: false, outcome: "not_applied" },
    });
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
