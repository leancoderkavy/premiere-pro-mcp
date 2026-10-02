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
import { getMarkerTools } from "../../src/tools/markers.js";
import { getEditorRequestTools } from "../../src/tools/editor-requests.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridge = { tempDir: "/tmp/clip-markers", timeoutMs: 5000 } as BridgeOptions;
const markers = getMarkerTools(bridge);
const editor = getEditorRequestTools(bridge);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string };
type Tool = { handler: (args: never) => Promise<unknown> };
const run = (tool: Tool, args: Record<string, unknown>) => tool.handler(args as never) as Promise<Result>;

beforeEach(() => vi.clearAllMocks());

/**
 * Premiere 25.2.3: a timeline clip (TrackItem) has no `markers` collection.
 * The clip starts at 25 s on the timeline with its in-point at media 30 s.
 */
function host() {
  const sequenceMarkers = { createMarker: vi.fn(), getFirstMarker: () => null, getNextMarker: () => null, deleteMarker: vi.fn() };
  const clip = {
    nodeId: "c1",
    name: "CCI DAY 1.mp4",
    getSpeed: () => 1, isSpeedReversed: () => false,
    start: { ticks: String(25 * TICKS) },
    end: { ticks: String(35 * TICKS) },
    duration: { ticks: String(10 * TICKS) },
    inPoint: { ticks: String(30 * TICKS) },
  };
  const seq = {
    name: "Seq",
    sequenceID: "s1",
    end: String(121 * TICKS),
    timebase: String(TICKS / 25),
    markers: sequenceMarkers,
    videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } },
    audioTracks: { numTracks: 0 },
  };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { $: { global: {} }, qe: { project: { undoStackIndex: () => 52 } }, app: { project: { documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", activeSequence: seq, sequences: { numSequences: 1, 0: seq } } } }))));
  return sequenceMarkers;
}

const refusal = expect.stringContaining("this clip's in-point is 30s, so clip time t is source time t + 30s");

describe("marker tools refuse a timeline clip without a marker collection", () => {
  it("add_marker refuses with the source time instead of throwing", async () => {
    const sequenceMarkers = host();
    await expect(run(markers.add_marker, { time_seconds: 2, name: "x", node_id: "c1" })).resolves.toMatchObject({ success: false, error: refusal });
    expect(sequenceMarkers.createMarker).not.toHaveBeenCalled();
  });

  it("delete_marker refuses instead of throwing", async () => {
    host();
    await expect(run(markers.delete_marker, { time_seconds: 2, node_id: "c1" })).resolves.toMatchObject({ success: false, error: refusal });
  });

  it("add_markers_batch refuses before writing any marker", async () => {
    const sequenceMarkers = host();
    await expect(run(editor.add_markers_batch, { node_id: "c1", markers: [{ time_seconds: 3, name: "a" }, { time_seconds: 4 }] })).resolves.toMatchObject({ success: false, error: refusal });
    expect(sequenceMarkers.createMarker).not.toHaveBeenCalled();
  });
});

describe("add_markers_batch reads every created marker back", () => {
  /** Sequence markers whose color write or second createMarker can be made to fail. */
  function batchHost(options: { ignoreColor?: boolean; failAt?: number; colorReadback?: { value: unknown } } = {}) {
    const list: Record<string, any>[] = [];
    const sequenceMarkers = {
      createMarker(seconds: number) {
        if (options.failAt === list.length) throw new Error("rejected");
        let end = seconds;
        const marker: Record<string, any> = {
          name: "", comments: "", color: 0,
          start: { ticks: String(Math.round(seconds * TICKS)) },
          get end() { return { ticks: String(Math.round(end * TICKS)) }; },
          set end(value: number) { end = value; },
          setColorByIndex(index: number) { if (!options.ignoreColor) marker.color = index; },
          getColorByIndex() { return options.colorReadback ? options.colorReadback.value : marker.color; },
        };
        list.push(marker);
        return marker;
      },
      getFirstMarker: () => list[0] ?? null,
      getNextMarker: (m: Record<string, any>) => list[list.indexOf(m) + 1] ?? null,
    };
    const seq = {
      name: "Seq", sequenceID: "s1", end: String(121 * TICKS), timebase: String(TICKS / 25), markers: sequenceMarkers,
      videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 0 },
    };
    mockedSendCommand.mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { $: { global: {} }, qe: { project: { undoStackIndex: () => 52 } }, app: { project: { documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", activeSequence: seq, sequences: { numSequences: 1, 0: seq } } } }))));
    return list;
  }

  it.each([null, false, true, "0", Number.NaN])("keeps invalid color readback %s unverified", async (value) => {
    batchHost({ colorReadback: { value } });
    await expect(run(editor.add_markers_batch, { markers: [{ time_seconds: 3, color: value === true ? 1 : 0 }] })).resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", unverifiedFields: [{ markerIndex: 0, field: "color" }], qeMarkerUndoVerified: false } });
  });

  it("retains uncertainty when the first create attempt throws", async () => {
    batchHost({ failAt: 0 });
    await expect(run(editor.add_markers_batch, { markers: [{ time_seconds: 3 }] })).resolves.toMatchObject({ success: false, data: { createdCount: 0, timelineChanged: null, outcome: "failed", mutationOutcome: "unknown", mutationAttempted: true, qeMarkerUndoVerified: false } });
  });

  it("verifies name, end and color", async () => {
    batchHost();
    await expect(run(editor.add_markers_batch, { markers: [{ time_seconds: 3, name: "A", duration_seconds: 2, color: 2 }] }))
      .resolves.toMatchObject({ success: true, data: { markers: [{ name: "A", endSeconds: 5, color: 2 }] } });
  });

  it("reports a color Premiere ignored as committed_unverified", async () => {
    batchHost({ ignoreColor: true });
    await expect(run(editor.add_markers_batch, { markers: [{ time_seconds: 3, color: 2 }] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("color index reads back as 0"), data: { outcome: "committed_unverified", timelineChanged: true } });
  });

  it("reports markers already written when a later one is rejected", async () => {
    batchHost({ failAt: 1 });
    await expect(run(editor.add_markers_batch, { markers: [{ time_seconds: 3 }, { time_seconds: 4 }] }))
      .resolves.toMatchObject({ success: false, data: { createdCount: 1, timelineChanged: true, outcome: "committed_unverified" } });
  });
});
