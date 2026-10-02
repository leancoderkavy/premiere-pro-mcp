import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getUtilityTools } from "../../src/tools/utility.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getUtilityTools({ tempDir: "/tmp/utility", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string; data?: Record<string, any> };
type Tool = { handler: (args: never) => Promise<unknown> };
const run = (tool: Tool, args: Record<string, unknown>) => tool.handler(args as never) as Promise<Result>;

beforeEach(() => vi.clearAllMocks());

function children(list: Record<string, any>[]) {
  return new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
}

/** Runs a script against a context; `override` is appended after the helpers to replace one. */
function useContext(context: Record<string, unknown>, override = "") {
  const app = context.app as { project?: Record<string, unknown> };
  if (app?.project) app.project.documentID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  context.$ = { global: {} };
  context.qe ??= { project: { undoStackIndex: () => 52 } };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${override}\n${script}`, context))));
}

describe("add_marker_to_project_item", () => {
  /** Project-item markers as measured on 25.2.3: `end` takes seconds and throws on a Time object. */
  function markerHost(options: { ignoreType?: boolean; colorReadback?: { value: unknown } } = {}) {
    const created: Record<string, any>[] = [];
    const markers = {
      createMarker(seconds: number) {
        let end = seconds;
        let type = "Comment";
        const marker: Record<string, any> = {
          name: "", comments: "", color: 0,
          start: { seconds },
          get end() { return { seconds: end }; },
          set end(value: unknown) { if (typeof value !== "number") throw new Error("Illegal Parameter type"); end = value; },
          get type() { return type; },
          set type(value: string) { if (!options.ignoreType) type = value; },
          setColorByIndex(index: number) { marker.color = index; },
          getColorByIndex() { return options.colorReadback ? options.colorReadback.value : marker.color; },
        };
        created.push(marker);
        return marker;
      },
    };
    const item = { nodeId: "i1", name: "a.wav", type: 1, getMarkers: () => markers };
    useContext({ app: { project: { rootItem: { children: children([item]) } } } });
    return created;
  }

  it("writes the end in seconds and verifies every field", async () => {
    const created = markerHost();
    await expect(run(tools.add_marker_to_project_item, { item_id: "i1", time_seconds: 1, duration_seconds: 1.5, name: 'A "b"', comments: "c", type: "Chapter", color_index: 3 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, endSeconds: 2.5, type: "Chapter" } });
    expect(created[0]).toMatchObject({ name: 'A "b"', color: 3 });
  });

  it.each([null, false, true, "0", Number.NaN])("does not certify unreadable requested color %s", async (value) => {
    markerHost({ colorReadback: { value } });
    await expect(run(tools.add_marker_to_project_item, { item_id: "i1", time_seconds: 1, color_index: value === true ? 1 : 0 })).resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", unverifiedFields: ["color"], qeMarkerUndoVerified: false } });
  });

  it("reports a created marker whose type did not stick", async () => {
    markerHost({ ignoreType: true });
    await expect(run(tools.add_marker_to_project_item, { item_id: "i1", time_seconds: 1, type: "Chapter" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("type reads back as Comment"), data: { markerCreated: true, outcome: "committed_unverified" } });
  });

  it("refuses invalid times, colors and types before building a script", async () => {
    for (const args of [{ time_seconds: -1 }, { time_seconds: 1, duration_seconds: -2 }, { time_seconds: 1, color_index: 9 }, { time_seconds: 1, type: "Bogus" }]) {
      await expect(run(tools.add_marker_to_project_item, { item_id: "i1", ...args })).resolves.toMatchObject({ success: false });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("move_playhead_to_edit reads the playhead back", () => {
  function playheadHost(options: { ignoreMove?: boolean } = {}) {
    let player = 26 * TICKS;
    const clip = (start: number, end: number) => ({ start: { ticks: String(start * TICKS) }, end: { ticks: String(end * TICKS) } });
    const seq = {
      videoTracks: { numTracks: 1, 0: { clips: { numItems: 2, 0: clip(25, 35), 1: clip(40, 46) } } },
      audioTracks: { numTracks: 0 },
      getPlayerPosition: () => ({ ticks: String(player) }),
      setPlayerPosition: (ticks: string) => { if (!options.ignoreMove) player = Number(ticks); },
    };
    useContext({ app: { project: { activeSequence: seq } } });
  }

  it("moves to the next edit and verifies", async () => {
    playheadHost();
    await expect(run(tools.move_playhead_to_edit, { direction: "next" })).resolves.toMatchObject({ success: true, data: { movedTo: 35, verified: true } });
  });

  it("fails when Premiere leaves the playhead where it was", async () => {
    playheadHost({ ignoreMove: true });
    await expect(run(tools.move_playhead_to_edit, { direction: "next" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("left the playhead at 26s") });
  });
});

describe("freeze_frame confirms the imported still", () => {
  const exportOk = 'function __exportStillFrame(path, ticks) { return { ok: true, path: path, method: "qe", notes: [] }; }';

  function freezeHost(options: { skipImport?: boolean } = {}) {
    const root: Record<string, any>[] = [{ nodeId: "old", name: "old.png", type: 1, getMediaPath: () => "/frames/f.png" }];
    const app = {
      project: {
        rootItem: { children: children(root) },
        activeSequence: { getPlayerPosition: () => ({ ticks: "0" }) },
        importFiles: (paths: string[]) => { if (!options.skipImport) root.push({ nodeId: "new", name: "f.png", type: 1, getMediaPath: () => paths[0] }); return true; },
      },
    };
    function File(this: { fsName: string }, path: string) { this.fsName = path; }
    useContext({ app, File }, exportOk);
  }

  it("reports the new item, not an older one with the same path", async () => {
    freezeHost();
    await expect(run(tools.freeze_frame, { time_seconds: 2, output_path: "/frames/f.png" })).resolves.toMatchObject({ success: true, data: { imported: true, nodeId: "new" } });
  });

  it("fails when the export worked but nothing was imported", async () => {
    freezeHost({ skipImport: true });
    await expect(run(tools.freeze_frame, { time_seconds: 2, output_path: "/frames/f.png" })).resolves.toMatchObject({ success: false, data: { exported: true, imported: false } });
  });
});

describe("add_adjustment_layer", () => {
  function adjustmentHost(options: { legacy?: boolean; modern?: boolean; placeNothing?: boolean; throwAfterInsert?: boolean; throwLegacy?: boolean; existingLayer?: boolean; ordinaryLayer?: boolean } = {}) {
    const root: Record<string, any>[] = [{ nodeId: "old-adj", name: "Adjustment Layer", type: 1 }];
    const trackClips: Record<string, any>[] = [];
    const playerTicks = 10 * TICKS;
    const seq = {
      videoTracks: { numTracks: 2, 0: { clips: children(trackClips) }, 1: { clips: children([]) } },
      getPlayerPosition: () => ({ ticks: String(playerTicks) }),
    };
    const place = (item: Record<string, any>) => { if (!options.placeNothing) trackClips.push({ nodeId: `clip-${trackClips.length}`, start: { ticks: String(playerTicks) }, projectItem: item, isAdjustmentLayer: () => !options.ordinaryLayer }); };
    if (options.existingLayer) place(root[0]);
    const fallback = vi.fn();
    const qeSeq: Record<string, any> = { getVideoTrackAt: () => ({ insert: (item: Record<string, any>) => { place(item); if (options.throwAfterInsert) throw new Error("after mutation"); }, insertClip: fallback }) };
    if (options.legacy) qeSeq.addAdjustmentLayer = () => { place({ nodeId: "legacy", name: "Capa" }); if (options.throwLegacy) throw new Error("after mutation"); };
    const qeProject: Record<string, any> = { getActiveSequence: () => qeSeq };
    if (options.modern) qeProject.newAdjustmentLayer = () => { root.push({ nodeId: "fresh", name: "Adjustment Layer", type: 1 }); };
    useContext({ app: { enableQE: () => {}, project: { activeSequence: seq, rootItem: { children: children(root) } } }, qe: { project: qeProject } });
    return { fallback, trackClips };
  }

  it("does not retry insertion after a throwing mutation", async () => {
    const state = adjustmentHost({ modern: true, throwAfterInsert: true });
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: false, data: { outcome: "failed", mutationAttempted: true, mutationOutcome: "unknown", verified: false, timelineChanged: null } });
    expect(state.trackClips).toHaveLength(1);
    expect(state.fallback).not.toHaveBeenCalled();
  });

  it("verifies a new localized adjustment layer beside an existing layer", async () => {
    adjustmentHost({ legacy: true, existingLayer: true });
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("does not classify an ordinary clip by its Adjustment Layer name", async () => {
    adjustmentHost({ modern: true, ordinaryLayer: true });
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified" } });
  });

  it("refuses cleanly when neither QE API exists (Premiere 25.2.3)", async () => {
    adjustmentHost();
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: false, error: expect.stringContaining("No supported adjustment-layer API") });
  });

  it("places the newly created item, never an older adjustment layer, and verifies it", async () => {
    adjustmentHost({ modern: true });
    await expect(run(tools.add_adjustment_layer, { track_index: 0 })).resolves.toMatchObject({ success: true, data: { verified: true, nodeId: "fresh" } });
  });

  it("reports an insert that placed nothing, and verifies the legacy path", async () => {
    adjustmentHost({ modern: true, placeNothing: true });
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified" } });
    adjustmentHost({ legacy: true });
    await expect(run(tools.add_adjustment_layer, {})).resolves.toMatchObject({ success: true, data: { method: "qeSeq.addAdjustmentLayer", verified: true } });
  });

  it("refuses an out-of-range track before touching QE", async () => {
    adjustmentHost({ modern: true });
    await expect(run(tools.add_adjustment_layer, { track_index: 5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("out of range") });
  });
});
