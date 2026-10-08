import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
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

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getMarkerTools({ tempDir: "/tmp/marker-readback", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

type FakeMarker = { name: string; comments: string; color: number; start: { ticks: string; seconds: number }; end: { seconds: number } };

/** Sequence markers; options make Premiere ignore a color or end write. */
function host(options: { ignoreColor?: boolean; ignoreEnd?: boolean; colorUnreadable?: boolean; colorReadback?: { value: unknown }; undoIndex?: number; advanceOnCreate?: boolean } = {}) {
  const list: FakeMarker[] = [];
  let undoIndex = options.undoIndex;
  const make = (seconds: number): FakeMarker => {
    let end = seconds;
    const marker = {
      name: "", comments: "", color: 0,
      start: { ticks: String(Math.round(seconds * TICKS)), seconds },
      get end() { return { seconds: end }; },
      set end(value: unknown) { if (!options.ignoreEnd) end = Number(value); },
      setColorByIndex(index: number) { if (!options.ignoreColor) marker.color = index; },
      getColorByIndex() { if (options.colorUnreadable) throw new Error("no getter"); return options.colorReadback ? options.colorReadback.value : marker.color; },
      guid: `guid-${seconds}`,
    };
    return marker as unknown as FakeMarker;
  };
  const markers = {
    createMarker(seconds: number) { const m = make(seconds); list.push(m); if (options.advanceOnCreate && undoIndex !== undefined) undoIndex++; return m; },
    getFirstMarker: () => list[0] ?? null,
    getNextMarker: (m: FakeMarker) => list[list.indexOf(m) + 1] ?? null,
    deleteMarker: (m: FakeMarker) => { list.splice(list.indexOf(m), 1); },
  };
  const context = createContext({
    $: { global: {} },
    app: { enableQE() {}, project: { documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", activeSequence: { markers, timebase: String(TICKS / 25) } } },
    qe: { project: { undoStackIndex: () => undoIndex } },
  });
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInContext(`${getHelpersSource()}\n${script}`, context))));
  return list;
}

describe("add_marker and update_marker read the marker back", () => {
  it("verifies name, comments, color and duration", async () => {
    const list = host();
    await expect(tools.add_marker.handler({ time_seconds: 3, name: 'Say "hi" ', comments: "c2", color: 1, duration_seconds: 1.5 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, endSeconds: 4.52, requestedEndSeconds: 4.5, appliedEndSeconds: 4.52, name: 'Say "hi" ' } });
    expect(list[0]).toMatchObject({ comments: "c2", color: 1 });
  });

  it("warns when marker writes do not enter Premiere's undo stack", async () => {
    host({ undoIndex: 52 });
    const added = await tools.add_marker.handler({ time_seconds: 2, name: "Marker" }) as Result;
    expect(added).toMatchObject({ success: true, data: { undoTracked: false, undoWarning: expect.stringContaining("earlier action") } });
    expect(added.data).not.toHaveProperty("undoSteps");
    const updated = await tools.update_marker.handler({ time_seconds: 2, name: "Updated" }) as Result;
    expect(updated).toMatchObject({ success: true, data: { undoTracked: false } });
    const deleted = await tools.delete_marker.handler({ time_seconds: 2 }) as Result;
    expect(deleted).toMatchObject({ success: true, data: { undoTracked: false } });
  });

  it("reports an unreadable undo index without promising the marker is undoable", async () => {
    host();
    await expect(tools.add_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({
      success: true, data: { undoTracked: null, undoWarning: expect.stringContaining("could not be verified") },
    });
  });

  it("reports a marker write when Premiere records an undo step", async () => {
    host({ undoIndex: 52, advanceOnCreate: true });
    await expect(tools.add_marker.handler({ time_seconds: 2 })).resolves.toMatchObject({
      success: true, data: { undoTracked: true, undoSteps: 1, undoStackIndex: 53 },
    });
  });

  it("says the marker was created when Premiere ignores part of the request", async () => {
    host({ ignoreColor: true, undoIndex: 52 });
    const result = await tools.add_marker.handler({ time_seconds: 3, name: "M", color: 6 }) as Result;
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, undoTracked: false, undoWarning: expect.stringContaining("earlier action") } });
    expect(result.error).toMatch(/^The marker was created at 3s, but color index reads back as 0/);
  });

  it("reports an ignored duration", async () => {
    host({ ignoreEnd: true });
    await expect(tools.add_marker.handler({ time_seconds: 3, duration_seconds: 2 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("end reads back as 3s") });
  });

  it("update_marker verifies what it changed", async () => {
    const list = host();
    await tools.add_marker.handler({ time_seconds: 2, name: "Old" });
    await expect(tools.update_marker.handler({ time_seconds: 2, name: "New", color: 6 })).resolves.toMatchObject({ success: true, data: { verified: true, name: "New" } });
    expect(list[0]).toMatchObject({ name: "New", color: 6 });
    host({ ignoreColor: true, undoIndex: 52 });
    await tools.add_marker.handler({ time_seconds: 2, name: "Old" });
    await expect(tools.update_marker.handler({ time_seconds: 2, color: 6 })).resolves.toMatchObject({ success: false, data: { timelineChanged: true, undoTracked: false } });
  });

  it("update_marker reports the stored marker start, not the requested time", async () => {
    const list = host();
    const storedTicks = Math.round(7.5075 * TICKS);
    list.push({ name: "Old", comments: "", color: 0, start: { ticks: String(storedTicks), seconds: 7.5075 }, end: { seconds: 7.5075 }, setColorByIndex() {}, getColorByIndex: () => 0, guid: "g-7" } as unknown as FakeMarker);
    const result = await tools.update_marker.handler({ time_seconds: 7.5, name: "New" }) as Result;
    expect(result).toMatchObject({ success: true, data: { verified: true, requestedSeconds: 7.5, name: "New" } });
    expect(result.data?.timeSeconds).toBeCloseTo(7.5075, 9);
  });

  it.each([
    [{ time_seconds: -1 }, "time_seconds"],
    [{ time_seconds: 1, color: 9 }, "color"],
    [{ time_seconds: 1, color: 1.5 }, "color"],
    [{ time_seconds: 1, duration_seconds: Number.NaN }, "duration_seconds"],
  ])("rejects %j before building a script", async (args, field) => {
    await expect(tools.add_marker.handler(args as never)).resolves.toMatchObject({ success: false, error: expect.stringContaining(field) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("returns the new marker's guid", async () => {
    host();
    await expect(tools.add_marker.handler({ time_seconds: 6, name: "G" })).resolves.toMatchObject({ success: true, data: { guid: "guid-6", outcome: "verified" } });
  });

  it.each([23.976, 29.97, 25])("snaps sequence marker times to the %s fps grid with requested/applied receipt", async (fps) => {
    const frameTicks = TICKS * (fps === 23.976 ? 1001 / 24000 : fps === 29.97 ? 1001 / 30000 : 1 / 25);
    const list: FakeMarker[] = [];
    const make = (seconds: number) => ({ name: "", comments: "", color: 0, start: { ticks: String(Math.round(seconds * TICKS)), seconds }, end: { seconds }, guid: "snap", setColorByIndex() {}, getColorByIndex: () => 0 });
    const markers = { createMarker(seconds: number) { const marker = make(seconds); list.push(marker); return marker; }, getFirstMarker: () => list[0] ?? null, getNextMarker: () => null };
    const context = createContext({ $: { global: {} }, app: { enableQE() {}, project: { documentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", activeSequence: { markers, timebase: String(frameTicks) } } }, qe: { project: { undoStackIndex: () => undefined } } });
    mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInContext(`${getHelpersSource()}\n${script}`, context))));
    const result = await tools.add_marker.handler({ time_seconds: 0.5 }) as Result;
    expect(Number(list[0].start.ticks) / (TICKS * frameTicks / TICKS)).toBeCloseTo(Math.round(Number(list[0].start.ticks) / frameTicks), 6);
    expect(result.data).toMatchObject({ requestedSeconds: 0.5 });
    expect(result.data?.appliedSeconds as number).toBeCloseTo(list[0].start.seconds, 7);
  });

  it.each([false, true, "0", Number.NaN])("does not coerce invalid marker color %s", async (value) => {
    host({ colorReadback: { value } });
    await expect(tools.add_marker.handler({ time_seconds: 6, color: value === true ? 1 : 0 })).resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", unverifiedFields: ["color"] } });
  });

  it("reports committed_unverified, not verified, when the color cannot be read back", async () => {
    host({ colorUnreadable: true });
    await expect(tools.add_marker.handler({ time_seconds: 6, name: "C", color: 3 }))
      .resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", unverifiedFields: ["color"] } });
    host({ colorUnreadable: true });
    await tools.add_marker.handler({ time_seconds: 6, name: "C" });
    await expect(tools.update_marker.handler({ time_seconds: 6, color: 2 }))
      .resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", unverifiedFields: ["color"] } });
  });
});
