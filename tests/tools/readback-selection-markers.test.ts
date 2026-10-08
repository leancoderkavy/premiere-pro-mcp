import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), sendRawCommand: vi.fn(), getTempDir: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getSelectionTools } from "../../src/tools/selection.js";
import { getMarkerTools } from "../../src/tools/markers.js";
const send = vi.mocked(sendCommand);
const selections = getSelectionTools({});
const markerTools = getMarkerTools({});
const TICKS = 254016000000;
beforeEach(() => vi.clearAllMocks());

function execute(sequence: unknown) {
  const context = createContext({ $: { global: {} }, app: { enableQE() {}, project: { documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", activeSequence: sequence } }, qe: { project: { undoStackIndex: () => 3 } } });
  send.mockImplementation(async script => JSON.parse(String(runInContext(`${getHelpersSource()}\n${script}`, context))));
}
function selectionHost(options: { ignore?: boolean; unreadable?: boolean; selected?: boolean; name?: string } = {}) {
  const state = { selected: options.selected ?? false };
  const clips = { numItems: 1, get 0() { return { nodeId: "clip-1", name: options.name ?? "Target", start: { ticks: "0" }, end: { ticks: String(TICKS * 5) }, disabled: true, projectItem: { getColorLabel: () => 2 }, setSelected(value: boolean) { if (!options.ignore) state.selected = value; }, isSelected() { if (options.unreadable) throw new Error("unreadable"); return state.selected; } }; } };
  execute({ videoTracks: { numTracks: 1, 0: { clips } }, audioTracks: { numTracks: 0 } });
  return state;
}
const cases = [
  ["select_clips_by_name", { name: "Target" }],
  ["select_all_clips", {}],
  ["deselect_all_clips", {}],
  ["select_clips_in_range", { start_seconds: 1, end_seconds: 2 }],
  ["select_clips_by_color", { color_index: 2 }],
  ["invert_selection", {}],
  ["select_disabled_clips", {}],
] as const;
function invoke(name: keyof typeof selections, args: unknown) { return (selections[name].handler as (args: never) => Promise<unknown>)(args as never); }

describe("selection receipts verify final stored selection", () => {
  it.each(cases)("%s succeeds with fresh wrappers", async (name, args) => {
    selectionHost({ selected: name === "deselect_all_clips" });
    await expect(invoke(name, args)).resolves.toMatchObject({ success: true, data: { verified: true, outcome: "verified" } });
  });
  it.each(cases)("%s detects ignored writes", async (name, args) => {
    selectionHost({ ignore: true, selected: name === "deselect_all_clips" });
    await expect(invoke(name, args)).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "failed" } });
  });
  it.each(cases)("%s refuses a missing sequence", async (name, args) => {
    execute(null);
    await expect(invoke(name, args)).resolves.toMatchObject({ success: false, error: "No active sequence" });
  });
  it("reports unavailable readback without counting attempts as selected clips", async () => {
    selectionHost({ unreadable: true });
    await expect(selections.select_all_clips.handler({})).resolves.toMatchObject({ success: true, data: { selected: null, requestedSelected: 1, appliedSelected: 0, unverifiedClips: 1, verified: false, outcome: "committed_unverified" } });
  });
  it("refuses inversion before writing when the initial selection is unreadable", async () => {
    const state = selectionHost({ unreadable: true });
    await expect(selections.invert_selection.handler()).resolves.toMatchObject({ success: false, error: expect.stringContaining("nothing was changed") });
    expect(state.selected).toBe(false);
  });
  it("keeps quoted and newline names literal in emitted script", async () => {
    const name = 'Target"; throw new Error("bad"); //\n\\';
    selectionHost({ name });
    await expect(selections.select_clips_by_name.handler({ name })).resolves.toMatchObject({ success: true, data: { query: name, selected: 1 } });
  });
  it.each([
    ["select_clips_by_name", { name: "" }],
    ["select_all_clips", { track_type: 'video"; throw 1;' }],
    ["select_all_clips", { track_index: -1 }],
    ["select_clips_in_range", { start_seconds: 2, end_seconds: 1 }],
    ["select_clips_by_color", { color_index: 2.5 }],
  ])("refuses invalid %s inputs before sending", async (name, args) => {
    await expect(invoke(name as keyof typeof selections, args)).resolves.toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
});

function markerHost(options: { ignore?: boolean; wrong?: boolean; noGuid?: boolean; unreadableAfter?: boolean } = {}) {
  const list = [0, 1, 2].map(index => ({ guid: options.noGuid ? "" : `marker-${index}`, start: { ticks: String(TICKS * (index === 2 ? 5 : 2)) } }));
  let attempted = false;
  const markers = {
    getFirstMarker() { if (attempted && options.unreadableAfter) throw new Error("unreadable"); return list[0] ?? null; },
    getNextMarker(marker: typeof list[number]) { return list[list.indexOf(marker) + 1] ?? null; },
    deleteMarker(marker: typeof list[number]) { attempted = true; if (!options.ignore) list.splice(options.wrong ? 1 : list.indexOf(marker), 1); },
  };
  execute({ markers });
  return list;
}
describe("delete_marker rescans the collection", () => {
  it("verifies the chosen marker disappeared and preserves its colocated neighbour", async () => {
    const list = markerHost();
    await expect(markerTools.delete_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: true, data: { deleted: true, verified: true, outcome: "verified", appliedDeleted: 1 } });
    expect(list.map(m => m.guid)).toEqual(["marker-1", "marker-2"]);
  });
  it("rejects an ignored deletion", async () => {
    markerHost({ ignore: true });
    await expect(markerTools.delete_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: false, data: { deleted: false, outcome: "failed", appliedDeleted: 0 } });
  });
  it("rejects deleting the wrong colocated marker despite the matching count", async () => {
    markerHost({ wrong: true });
    await expect(markerTools.delete_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "failed" } });
  });
  it.each([{ noGuid: true }, { unreadableAfter: true }])("reports unavailable identity readback %j", async options => {
    markerHost(options);
    await expect(markerTools.delete_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: true, data: { deleted: null, verified: false, outcome: "committed_unverified" } });
  });
  it("refuses invalid time before sending", async () => {
    await expect(markerTools.delete_marker.handler({ time_seconds: NaN })).resolves.toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("escapes an unknown clip identifier in the emitted script", async () => {
    execute({ videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 0 } });
    await expect(markerTools.delete_marker.handler({ time_seconds: 2, node_id: 'x"; throw new Error("bad"); //\n\\' })).resolves.toMatchObject({ success: false, error: "Clip not found" });
  });
});
