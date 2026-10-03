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
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getSourceMonitorTools({ tempDir: "/tmp/source-monitor", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
type Item = { nodeId: string; name: string; type: number };

beforeEach(() => vi.clearAllMocks());

type Placement = { item: Item; startTicks: number; inTicks?: number };

/**
 * Source Monitor as measured on Premiere 25.2.3: opening pushes a clip,
 * closeClip shows the previously opened one, closeAllClips empties it.
 */
function host(options: { ignoreOpen?: boolean; ignoreClose?: boolean; ignoreOverwrite?: boolean; videoTracks?: number; audioTracks?: number; playheadSeconds?: number; replaceExisting?: boolean; unreadablePlacement?: boolean } = {}) {
  const items: Item[] = [
    { nodeId: "a1", name: "mono-440.wav", type: 1 },
    { nodeId: "v1", name: "CCI DAY 1.mp4", type: 1 },
  ];
  const opened: Item[] = [];
  const track = () => {
    const placements: Placement[] = [];
    return {
      placements,
      clips: new Proxy({}, {
        get: (_t, key) => key === "numItems"
          ? placements.length
          : (placements[Number(key)] && { nodeId: `clip-${Number(key)}`, projectItem: placements[Number(key)].item, end: { ticks: String(placements[Number(key)].startTicks + 2 * TICKS) }, outPoint: { ticks: String((placements[Number(key)].inTicks ?? 0) + 2 * TICKS) }, start: { ticks: String(placements[Number(key)].startTicks) }, get inPoint() { if (options.unreadablePlacement) throw new Error("unreadable"); return { ticks: String(placements[Number(key)].inTicks ?? 0) }; } }),
      }),
    };
  };
  const video = Array.from({ length: options.videoTracks ?? 1 }, track);
  const audio = Array.from({ length: options.audioTracks ?? 1 }, track);
  const playerTicks = Math.round((options.playheadSeconds ?? 5) * TICKS);
  const seq = {
    timebase: String(TICKS / 25),
    videoTracks: Object.assign({ numTracks: video.length }, video),
    audioTracks: Object.assign({ numTracks: audio.length }, audio),
    getPlayerPosition: () => ({ ticks: String(playerTicks) }),
    overwriteClip: (item: Item, ticks: string, v: number, a: number) => {
      if (options.ignoreOverwrite) return;
      if (options.replaceExisting && video[v].placements.length) video[v].placements[0] = { item, startTicks: Number(ticks), inTicks: 2 * TICKS };
      else video[v].placements.push({ item, startTicks: Number(ticks) });
      if (!options.replaceExisting) audio[a].placements.push({ item, startTicks: Number(ticks) });
    },
  };
  const sourceMonitor = {
    openProjectItem: (item: Item) => { if (!item) throw new Error("crash"); if (!options.ignoreOpen) opened.push(item); return true; },
    getProjectItem: () => opened[opened.length - 1] ?? null,
    closeClip: () => { if (!options.ignoreClose) opened.pop(); return true; },
    closeAllClips: () => { if (!options.ignoreClose) opened.length = 0; return true; },
  };
  const rootItem = { children: Object.assign({ numItems: items.length }, items) };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { rootItem, activeSequence: seq }, sourceMonitor } }))));
  return { opened, video, audio, sourceMonitor };
}

describe("open and close read the Source Monitor back", () => {
  it("open_in_source confirms the clip now showing", async () => {
    host();
    await expect(tools.open_in_source.handler({ item_id: "a1" })).resolves.toMatchObject({ success: true, data: { verified: true, item: "mono-440.wav", nodeId: "a1" } });
  });

  it("open_in_source fails when Premiere does not show the clip", async () => {
    host({ ignoreOpen: true });
    await expect(tools.open_in_source.handler({ item_id: "a1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not show mono-440.wav") });
  });

  it("open_in_source refuses a missing item without calling Premiere", async () => {
    const state = host();
    await expect(tools.open_in_source.handler({ item_id: "nope" })).resolves.toMatchObject({ success: false, error: "Project item not found" });
    expect(state.opened).toEqual([]);
  });

  it("close_source_monitor names the clip it closed and the one now showing", async () => {
    host();
    await tools.open_in_source.handler({ item_id: "a1" });
    await tools.open_in_source.handler({ item_id: "v1" });
    await expect(tools.close_source_monitor.handler()).resolves.toMatchObject({ success: true, data: { item: "CCI DAY 1.mp4", nowShowing: "mono-440.wav" } });
  });

  it("close_source_monitor fails when nothing is open or the clip stays", async () => {
    host();
    await expect(tools.close_source_monitor.handler()).resolves.toMatchObject({ success: false, error: "No clip open in Source Monitor" });
    host({ ignoreClose: true });
    await tools.open_in_source.handler({ item_id: "a1" });
    await expect(tools.close_source_monitor.handler()).resolves.toMatchObject({ success: false, error: expect.stringContaining("still shows mono-440.wav") });
  });

  it("close_all_source_clips verifies the monitor is empty", async () => {
    host();
    await tools.open_in_source.handler({ item_id: "a1" });
    await expect(tools.close_all_source_clips.handler()).resolves.toMatchObject({ success: true, data: { verified: true } });
    host({ ignoreClose: true });
    await tools.open_in_source.handler({ item_id: "a1" });
    await expect(tools.close_all_source_clips.handler()).resolves.toMatchObject({ success: false });
  });
});

describe("unreadable Source Monitor state", () => {
  it.each([false, ""])("does not certify an invalid empty-monitor state %s", async (value) => {
    const state = host();
    state.sourceMonitor.getProjectItem = (() => value) as typeof state.sourceMonitor.getProjectItem;
    await expect(tools.close_all_source_clips.handler()).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
  });

  it.each(["open", "close", "closeAll"])("does not verify %s when post-read throws", async (operation) => {
    const state = host();
    await tools.open_in_source.handler({ item_id: "a1" });
    const originalRead = state.sourceMonitor.getProjectItem;
    let calls = 0;
    state.sourceMonitor.getProjectItem = () => {
      calls++;
      if (operation === "close" && calls === 1) return originalRead();
      throw new Error("unavailable");
    };
    const result = operation === "open" ? await tools.open_in_source.handler({ item_id: "v1" })
      : operation === "close" ? await tools.close_source_monitor.handler()
      : await tools.close_all_source_clips.handler();
    expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null } });
  });

  it("refuses close when the pre-read throws", async () => {
    const state = host();
    await tools.open_in_source.handler({ item_id: "a1" });
    state.sourceMonitor.getProjectItem = () => { throw new Error("unavailable"); };
    await expect(tools.close_source_monitor.handler()).resolves.toMatchObject({ success: false, error: expect.stringContaining("no close was attempted") });
    expect(state.opened).toHaveLength(1);
  });
});

describe("overwrite_from_source verifies the placement", () => {
  it("does not certify an overwrite when placement metadata cannot be read", async () => {
    host({ unreadablePlacement: true });
    await tools.open_in_source.handler({ item_id: "v1" });
    await expect(tools.overwrite_from_source.handler({})).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null } });
  });

  it("verifies a replacement of the same source at the same cut with different source timing", async () => {
    const state = host({ replaceExisting: true });
    await tools.open_in_source.handler({ item_id: "v1" });
    const item = state.opened[0];
    state.video[0].placements.push({ item, startTicks: 5 * TICKS, inTicks: TICKS });
    await expect(tools.overwrite_from_source.handler({})).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("reports a verified placement at the playhead", async () => {
    const state = host();
    await tools.open_in_source.handler({ item_id: "v1" });
    await expect(tools.overwrite_from_source.handler({})).resolves.toMatchObject({
      success: true,
      data: { verified: true, item: "CCI DAY 1.mp4", atSeconds: 5, placedOnVideoTrack: true, placedOnAudioTrack: true },
    });
    expect(state.video[0].placements).toHaveLength(1);
  });

  it("fails when Premiere places nothing", async () => {
    host({ ignoreOverwrite: true });
    await tools.open_in_source.handler({ item_id: "v1" });
    await expect(tools.overwrite_from_source.handler({})).resolves.toMatchObject({ success: false, error: expect.stringContaining("no verifiable new placement") });
  });

  it("refuses an out-of-range or invalid track before writing", async () => {
    const state = host({ videoTracks: 2, audioTracks: 1 });
    await tools.open_in_source.handler({ item_id: "v1" });
    await expect(tools.overwrite_from_source.handler({ audio_track_index: 3 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Audio track index 3 is out of range") });
    await expect(tools.overwrite_from_source.handler({ video_track_index: 1.5 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative integers") });
    expect(state.video[0].placements).toHaveLength(0);
  });
});
