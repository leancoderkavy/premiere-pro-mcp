import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getEditorRequestTools } from "../../src/tools/editor-requests.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
const options = { tempDir: "/tmp/marker-barrier", timeoutMs: 5000 };
const markersTool = getMarkerTools(options), projectTools = getProjectTools(options), targeting = getTrackTargetingTools(options);
const projectA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", projectB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function host(options: { unknownIndex?: boolean; unknownIdentity?: boolean; noGlobal?: boolean; throwingMarker?: boolean; markerAdvancesIndex?: boolean } = {}) {
  let index = 52, readable = !options.unknownIndex;
  const list: any[] = [];
  const markers = {
    createMarker(seconds: number) {
      const marker = { name: "", comments: "", start: { seconds, ticks: String(seconds * 254016000000) }, end: { seconds }, getColorByIndex: () => 0 };
      list.push(marker);
      if (options.markerAdvancesIndex) index++;
      if (options.throwingMarker) throw Error("create failed after mutation");
      return marker;
    },
    getFirstMarker: () => list[0] || null,
    getNextMarker: (marker: unknown) => list[list.indexOf(marker) + 1] || null,
    deleteMarker: (marker: unknown) => list.splice(list.indexOf(marker), 1),
  };
  const project = { documentID: options.unknownIdentity ? "" : projectA, path: "/A.prproj", activeSequence: { markers, end: String(100 * 254016000000), timebase: String(254016000000 / 30) }, rootItem: { children: { 0: { nodeId: "source", name: "Source", getMarkers: () => markers }, numItems: 1 } } };
  const sequences = { 0: project.activeSequence, numSequences: 1 };
  Object.assign(project, { sequences });
  const undo = vi.fn(() => { index--; }), redo = vi.fn(() => { index++; });
  const global = {};
  const context = createContext({ $: options.noGlobal ? {} : { global }, app: { enableQE() {}, project }, qe: { project: { undoStackIndex: () => readable ? index : undefined, undo, redo } } });
  vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInContext(`${getHelpersSource()}\n${script}`, context))));
  return { undo, redo, list, project, setIndex: (value: number) => { index = value; }, makeReadable: () => { readable = true; }, index: () => index, global };
}
beforeEach(() => vi.resetAllMocks());
describe("persistent CEP marker undo boundary (#733)", () => {
  it("does not undo timeline actions for marker operations", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2, name: "Marker" });
    await expect(targeting.multiple_undo.handler({ count: 5, expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false, data: { undone: 0, stackStatus: "marker_boundary" } });
    expect(state.undo).not.toHaveBeenCalled();
    expect(state.list).toHaveLength(1);
  });
  it.each(["batch", "project_item"] as const)("protects the alternative %s marker writer", async (writer) => {
    const state = host();
    if (writer === "batch") await getEditorRequestTools(options).add_markers_batch.handler({ markers: [{ time_seconds: 2 }] });
    else await getUtilityTools(options).add_marker_to_project_item.handler({ item_id: "source", time_seconds: 2 });
    expect(state.list).toHaveLength(1);
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("does not interpret stack movement as proof of marker reversal", async () => {
    const state = host({ markerAdvancesIndex: true });
    await expect(markersTool.add_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: true, data: { undoTracked: true, qeMarkerUndoVerified: false } });
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 53 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("permits later QE actions wholly above the boundary but refuses a crossing count", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    state.setIndex(54);
    await expect(projectTools.undo.handler({ count: 2, expected_undo_stack_index: 54 })).resolves.toMatchObject({ success: true, data: { undone: 2 } });
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).toHaveBeenCalledTimes(2);
  });
  it("permits explicit intentional non-marker reversal with warning", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52, acknowledge_untracked_markers: true })).resolves.toMatchObject({ success: true, data: { undone: 1, untrackedMarkersAcknowledged: true, markerUndoWarning: expect.stringContaining("not verified") } });
    expect(state.undo).toHaveBeenCalledTimes(1);
    expect(state.list).toHaveLength(1);
  });
  it("isolates projects by documentID and retains the original barrier after returning", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    state.project.documentID = projectB;
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: true });
    state.project.documentID = projectA;
    state.setIndex(52);
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).toHaveBeenCalledTimes(1);
  });
  it("does not bypass the barrier after Save As changes the project path", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    state.project.path = "/B.prproj";
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("retains an unknown-index barrier after the host index becomes readable", async () => {
    const state = host({ unknownIndex: true });
    await markersTool.add_marker.handler({ time_seconds: 2 });
    state.makeReadable();
    state.setIndex(60);
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 60 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("fails closed for an unknown project identity", async () => {
    const state = host({ unknownIdentity: true });
    await markersTool.add_marker.handler({ time_seconds: 2 });
    state.project.documentID = projectB;
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("refuses before marker creation when engine state cannot persist", async () => {
    const state = host({ noGlobal: true });
    await expect(markersTool.add_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("persist") });
    expect(state.list).toHaveLength(0);
  });
  it("refuses marker writes and undo when retained barrier state is corrupt", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    const retained = state.global as Record<string, any>;
    retained.__premiereMcpMarkerUndoBarrierV1.entries[0].index = "unknown";
    await expect(markersTool.add_marker.handler({ time_seconds: 3 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("persist") });
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.list).toHaveLength(1);
    expect(state.undo).not.toHaveBeenCalled();
  });
  it("refuses redo across the protected boundary unless deliberately acknowledged", async () => {
    const state = host();
    await markersTool.add_marker.handler({ time_seconds: 2 });
    await projectTools.undo.handler({ expected_undo_stack_index: 52, acknowledge_untracked_markers: true });
    await expect(targeting.redo.handler({ expected_undo_stack_index: 51 })).resolves.toMatchObject({ success: false });
    expect(state.redo).not.toHaveBeenCalled();
    await expect(targeting.redo.handler({ expected_undo_stack_index: 51, acknowledge_untracked_markers: true })).resolves.toMatchObject({ success: true });
    expect(state.redo).toHaveBeenCalledTimes(1);
  });
  it("protects a marker that was created before its API threw", async () => {
    const state = host({ throwingMarker: true });
    await expect(markersTool.add_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({ success: false, data: { timelineChanged: true, outcome: "committed_unverified", verified: false, markerUndoBarrier: true } });
    expect(state.list).toHaveLength(1);
    await expect(projectTools.undo.handler({ expected_undo_stack_index: 52 })).resolves.toMatchObject({ success: false });
    expect(state.undo).not.toHaveBeenCalled();
  });
});
