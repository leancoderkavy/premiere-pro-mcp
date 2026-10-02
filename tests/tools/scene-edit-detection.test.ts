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
import { getAdvancedTools } from "../../src/tools/advanced.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const tools = getAdvancedTools({ tempDir: "/tmp/scene-detect", timeoutMs: 5000 } as BridgeOptions);

beforeEach(() => vi.clearAllMocks());

type Marker = { type: string; guid?: string; start: { seconds: number; ticks: string } };

/**
 * Live 25.2: CreateMarkers adds one Segmentation marker per detected cut to the
 * selected clip's source project item - not to the sequence - and a second run
 * adds an identical copy of every marker.
 */
function host(detectedSourceSeconds: number[], existing: number[] = [], cutsAdded = 0, options: { guids?: boolean } = {}) {
  let nextGuid = 0;
  const at = (seconds: number): Marker => ({
    type: "Segmentation",
    ...(options.guids === false ? {} : { guid: `g${nextGuid++}` }),
    start: { seconds, ticks: String(Math.round(seconds * TICKS)) },
  });
  const list: Marker[] = [{ type: "Comment", start: { seconds: 26, ticks: String(26 * TICKS) } }, ...existing.map(at)];
  const markers = {
    getFirstMarker: () => list[0] ?? null,
    getNextMarker: (m: Marker) => list[list.indexOf(m) + 1] ?? null,
    deleteMarker: (m: Marker) => { list.splice(list.indexOf(m), 1); },
  };
  const item = { nodeId: "item-1", name: "Interview A.mp4", getMarkers: () => markers };
  const clip = (mediaType: string) => ({
    mediaType,
    projectItem: item,
    start: { seconds: 0 },
    inPoint: { seconds: 10 },
    outPoint: { seconds: 121.6 },
  });
  const trackClips = { numItems: 1 };
  const seq = {
    getSelection: () => [clip("Video"), clip("Audio")],
    videoTracks: { numTracks: 1, 0: { clips: trackClips } },
    audioTracks: { numTracks: 1, 0: { clips: { numItems: 1 } } },
    performSceneEditDetectionOnSelection: (action: string) => {
      if (action === "ApplyCuts") trackClips.numItems += cutsAdded;
      else list.push(...detectedSourceSeconds.map(at));
      return true;
    },
  };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { $: { global: {} }, app: { project: { activeSequence: seq } } }))));
  return list;
}

describe("scene_edit_detection", () => {
  it("reports where the markers went and maps each cut onto the timeline", async () => {
    host([5, 14.92, 23.16]);
    const result = await tools.scene_edit_detection.handler({}) as { success: boolean; data: Record<string, unknown> };
    expect(result).toMatchObject({
      success: true,
      data: {
        markerLocation: expect.stringContaining("source project items"),
        markersAdded: 3,
        timelineCutSeconds: [4.92, 13.16],
        items: [{ itemId: "item-1", markersBefore: 0, markersAdded: 3, duplicatesRemoved: 0, sourceCutSeconds: [5, 14.92, 23.16] }],
        verified: true,
      },
    });
  });

  it("removes only the duplicates this run created and does not claim verified when nothing was added", async () => {
    const list = host([14.92, 23.16], [14.92, 23.16]);
    const originals = list.filter((m) => m.type === "Segmentation").map((m) => m.guid);
    await expect(tools.scene_edit_detection.handler({})).resolves.toMatchObject({
      success: true,
      data: { markersAdded: 0, verified: false, note: expect.stringContaining("No new Segmentation markers"), items: [{ markersBefore: 2, duplicatesRemoved: 2, duplicateCheck: "marker_guid" }] },
    });
    expect(list.filter((m) => m.type === "Segmentation").map((m) => m.guid)).toEqual(originals);
    expect(list.some((m) => m.type === "Comment")).toBe(true);
  });

  it("never deletes Segmentation markers the user already had, even identical ones", async () => {
    const list = host([30], [14.92, 14.92]);
    await expect(tools.scene_edit_detection.handler({})).resolves.toMatchObject({
      success: true,
      data: { markersAdded: 1, verified: true, items: [{ duplicatesRemoved: 0, newSourceCutSeconds: [30] }] },
    });
    expect(list.filter((m) => m.type === "Segmentation").map((m) => m.start.seconds)).toEqual([14.92, 14.92, 30]);
  });

  it("deletes nothing when markers have no GUID to tell runs apart", async () => {
    const list = host([14.92, 40], [14.92], 0, { guids: false });
    await expect(tools.scene_edit_detection.handler({})).resolves.toMatchObject({
      success: true,
      data: { markersAdded: 1, items: [{ duplicatesRemoved: 0, duplicateCheck: "not_possible_without_marker_guids", newSourceCutSeconds: [40] }] },
    });
    expect(list.filter((m) => m.type === "Segmentation")).toHaveLength(3);
  });

  it("fails ApplyCuts when no clip was actually cut", async () => {
    host([], [], 0);
    await expect(tools.scene_edit_detection.handler({ action: "ApplyCuts" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no cuts were applied"),
    });
    host([], [], 4);
    await expect(tools.scene_edit_detection.handler({ action: "ApplyCuts" })).resolves.toMatchObject({
      success: true,
      data: { cutsApplied: 4, verified: true },
    });
  });
});

describe("scene_edit_detection timeout", () => {
  it("waits long enough for the analysis (live: a 121 s clip overran the default 30 s)", async () => {
    host([5]);
    await tools.scene_edit_detection.handler({});
    const options = mockedSendCommand.mock.calls.at(-1)?.[1] as { timeoutMs?: number };
    expect(options.timeoutMs).toBeGreaterThanOrEqual(600000);
  });
});
