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

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getMarkerTools({ tempDir: "/tmp/marker-readback", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

type FakeMarker = { name: string; comments: string; color: number; start: { ticks: string; seconds: number }; end: { seconds: number } };

/** Sequence markers; options make Premiere ignore a color or end write. */
function host(options: { ignoreColor?: boolean; ignoreEnd?: boolean; undoIndex?: number } = {}) {
  const list: FakeMarker[] = [];
  const make = (seconds: number): FakeMarker => {
    let end = seconds;
    const marker = {
      name: "", comments: "", color: 0,
      start: { ticks: String(Math.round(seconds * TICKS)), seconds },
      get end() { return { seconds: end }; },
      set end(value: unknown) { if (!options.ignoreEnd) end = Number(value); },
      setColorByIndex(index: number) { if (!options.ignoreColor) marker.color = index; },
      getColorByIndex() { return marker.color; },
    };
    return marker as unknown as FakeMarker;
  };
  const markers = {
    createMarker(seconds: number) { const m = make(seconds); list.push(m); return m; },
    getFirstMarker: () => list[0] ?? null,
    getNextMarker: (m: FakeMarker) => list[list.indexOf(m) + 1] ?? null,
    deleteMarker: (m: FakeMarker) => { list.splice(list.indexOf(m), 1); },
  };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { enableQE() {}, project: { activeSequence: { markers } } },
      qe: { project: { undoStackIndex: () => options.undoIndex } },
    }))));
  return list;
}

describe("add_marker and update_marker read the marker back", () => {
  it("verifies name, comments, color and duration", async () => {
    const list = host();
    await expect(tools.add_marker.handler({ time_seconds: 3, name: 'Say "hi" ', comments: "c2", color: 1, duration_seconds: 1.5 }))
      .resolves.toMatchObject({ success: true, data: { verified: true, endSeconds: 4.5, name: 'Say "hi" ' } });
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

  it("says the marker was created when Premiere ignores part of the request", async () => {
    host({ ignoreColor: true });
    const result = await tools.add_marker.handler({ time_seconds: 3, name: "M", color: 6 }) as Result;
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true } });
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
    host({ ignoreColor: true });
    await tools.add_marker.handler({ time_seconds: 2, name: "Old" });
    await expect(tools.update_marker.handler({ time_seconds: 2, color: 6 })).resolves.toMatchObject({ success: false, data: { timelineChanged: true } });
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
});
