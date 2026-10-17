import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getEditorRequestTools } from "../../src/tools/editor-requests.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
const TPS = 254016000000, exact = "127135008000", options = { tempDir: "/tmp/marker-ticks" };
const send = vi.mocked(sendCommand);
beforeEach(() => vi.clearAllMocks());
class Clock {
  constructor(private value = 0) {}
  get ticks() { return String(this.value); } set ticks(v: string) { this.value = Number(v); }
  get seconds() { return this.value / TPS; } set seconds(v: number) { this.value = Math.floor(v * TPS); }
}
function host({ detached = false, ignored = false, whitespace = false } = {}) {
  const list: any[] = [], keys = new Map<string, number>();
  const markers = {
    createMarker(seconds: number) {
      const start = new Clock(Math.floor(seconds * TPS)), end = new Clock(Math.floor(seconds * TPS));
      const wrap = (t: Clock) => whitespace ? { get ticks() { return "  " + t.ticks + "  "; }, set ticks(v: string) { t.ticks = v; }, get seconds() { return t.seconds; } } : ignored ? { get ticks() { return t.ticks; }, set ticks(_v: string) {}, get seconds() { return t.seconds; } } : detached ? new Clock(Number(t.ticks)) : t;
      const m = { guid: 'guid-' + list.length, name: '', comments: '', type: 'Comment', color: 0,
        get start(): any { return wrap(start); }, set start(v: any) { if (!ignored) { if (typeof v !== "number") throw Error("Illegal parameter type"); start.seconds = v; } },
        get end(): any { return wrap(end); }, set end(v: any) { if (!ignored) { if (typeof v !== "number") throw Error("Illegal parameter type"); end.seconds = v; } },
        setColorByIndex(v: number) { m.color = v; }, getColorByIndex() { return m.color; } };
      list.push(m); return m;
    },
    getFirstMarker: () => list[0] ?? null,
    getNextMarker: (m: any) => list[list.indexOf(m) + 1] ?? null,
  };
  const source = { nodeId: 'source"id', name: 'Temporary source', type: 1, getMarkers: () => markers };
  const prop = { displayName: "Opacity", areKeyframesSupported: () => true, isTimeVarying: () => true, setTimeVarying() {},
    addKey(t: Clock) { keys.set(t.ticks, 0); }, setValueAtKey(t: Clock, v: number) { keys.set(t.ticks, v); }, getValueAtKey(t: Clock) { return keys.get(t.ticks); },
    getKeys: () => [...keys.keys()].map(t => new Clock(Number(t))), getValue: () => 40 };
  const clip = { nodeId: 'clip', name: 'Temporary', inPoint: new Clock(), start: new Clock(), end: new Clock(5 * TPS), duration: new Clock(5 * TPS), markers, getSpeed: () => 1, isSpeedReversed: () => false,
    components: { numItems: 1, 0: { displayName: 'Opacity', matchName: 'Opacity', properties: { numItems: 1, 0: prop } } } };
  const seq = { sequenceID: 'seq', timebase: '8475667200', end: String(5 * TPS), markers,
    videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } }, audioTracks: { numTracks: 0 } };
  const context = { Time: Clock, $: { global: {} }, app: { enableQE() {}, project: { documentID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', activeSequence: seq, sequences: { numSequences: 1, 0: seq }, rootItem: { children: { numItems: 1, 0: source } } } }, qe: { project: { undoStackIndex: () => 1 } } };
  send.mockImplementation(async script => { parse(script, { ecmaVersion: 3, allowReserved: "never" }); return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))); });
  return { list, keys, source, markers, clip };
}
describe("marker integer tick storage", () => {
  it("models the measured floating seconds floor", () => { expect(Math.floor(.5005 * TPS)).toBe(127135007999); });
  it.each([false, true])("stores sequence start and duration exactly, detached Time wrappers: %s", async detached => {
    const h = host({ detached });
    const r = await getMarkerTools(options).add_marker.handler({ time_seconds: .5005, duration_seconds: .5005, name: ' boundary " \\ \n', comments: 'temporary' });
    expect(r).toMatchObject({ success: true, data: { requestedTicks: exact, storedTicks: exact, storedEndTicks: '254270016000' } });
    expect(h.list[0].start.ticks).toBe(exact); expect(h.list[0].end.ticks).toBe('254270016000');
  });
  it.each(['sequence', 'clip'])("stores batch %s marker starts and ends exactly", async target => {
    const h = host({ detached: true });
    const r = await getEditorRequestTools(options).add_markers_batch.handler({ ...(target === 'clip' ? { node_id: h.clip.nodeId } : {}), markers: [{ time_seconds: .5005, duration_seconds: .5005, name: 'Chapter "one"' }] } as any);
    expect(r, JSON.stringify(r)).toMatchObject({ success: true }); expect(h.list[0].start.ticks).toBe(exact); expect(h.list[0].end.ticks).toBe('254270016000');
  });
  it("stores a source Chapter marker exactly", async () => {
    const h = host({ detached: true });
    const r = await getUtilityTools(options).add_marker_to_project_item.handler({ item_id: h.source.nodeId, time_seconds: .5005, duration_seconds: .5005, type: 'Chapter', name: 'Chapter "one"' });
    expect(r).toMatchObject({ success: true, data: { requestedTicks: exact, storedTicks: exact } }); expect(h.list[0].start.ticks).toBe(exact);
  });
  it("refuses unverified ignored time writes and reports the created marker", async () => {
    const h = host({ ignored: true });
    expect(await getMarkerTools(options).add_marker.handler({ time_seconds: .5005 })).toMatchObject({ success: false, data: { outcome: 'committed_unverified', timelineChanged: true, guid: 'guid-0' } });
    expect(h.list).toHaveLength(1); expect(h.list[0].start.ticks).toBe('127135007999');
  });
  it("updates metadata without moving an existing early marker and exposes its clock", async () => {
    const h = host(); h.markers.createMarker(.5005);
    expect(await getMarkerTools(options).update_marker.handler({ time_seconds: .5005, name: 'Renamed' })).toMatchObject({ success: true, data: { requestedTicks: exact, storedTicks: '127135007999' } });
    expect(h.list[0].start.ticks).toBe('127135007999');
  });
  it("keyframe Time.ticks already stores the exact clock", async () => {
    const h = host();
    expect(await getKeyframeTools(options).add_keyframe.handler({ node_id: 'clip', effect_name: 'Opacity', property_name: 'Opacity', time_seconds: .5005, value: 40 })).toMatchObject({ success: true });
    expect([...h.keys]).toEqual([[exact, 40]]);
  });
  it("exposes actual keyframe ticks from native key enumeration", async () => {
    host(); const tools = getKeyframeTools(options);
    const args = { node_id: 'clip', effect_name: 'Opacity', property_name: 'Opacity' };
    await tools.add_keyframe.handler({ ...args, time_seconds: .5005, value: 40 });
    expect(await tools.get_keyframes.handler(args)).toMatchObject({ success: true, data: { keyframes: [{ mediaTicks: exact, value: 40 }] } });
  });
  it("reads whitespace-padded tick values without inventing a different clock", async () => {
    host({ whitespace: true });
    expect(await getMarkerTools(options).add_marker.handler({ time_seconds: .5005 })).toMatchObject({ success: true, data: { storedTicks: exact } });
  });
  it.each([NaN, Infinity, -1])("refuses invalid marker time %s before dispatch", async time_seconds => {
    host(); expect(await getMarkerTools(options).add_marker.handler({ time_seconds })).toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
});
