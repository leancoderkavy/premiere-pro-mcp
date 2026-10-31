import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { buildToolScript } from "../../src/bridge/script-builder.js";
import { rippleDeleteScriptBody } from "../../src/tools/ripple-delete-script.js";

const TICKS = 254016000000;

describe("ripple delete linear lookups", () => {
  it("uses fewer than ten indexed reads per clip on 1,500 clips across six tracks", () => {
    let indexedReads = 0;
    let moveCalls = 0;
    let edgeWrites = 0;
    const tracks: Array<{ transitions: { numItems: number }; clips: { numItems: number; [index: number]: any }; _items: any[] }> = [];
    for (let t = 0; t < 6; t++) {
      const items: any[] = [];
      for (let c = 0; c < 250; c++) {
        const id = t === 0 && c === 0 ? "target" : `t${t}c${c}`;
        const start = t === 0 && c === 0 ? 0 : 1 + c * 2;
        let s = start * TICKS;
        let e = (start + 1) * TICKS;
        const clip: any = { nodeId: id, name: id, get start() { return { ticks: String(s) }; }, set start(v: any) { edgeWrites++; s = Number(v && v.ticks !== undefined ? v.ticks : v); }, get end() { return { ticks: String(e) }; }, set end(v: any) { edgeWrites++; e = Number(v && v.ticks !== undefined ? v.ticks : v); }, move(delta: any) { moveCalls++; s += Number(delta.ticks); e += Number(delta.ticks); }, remove() { const at = items.indexOf(clip); if (at >= 0) items.splice(at, 1); } };
        items.push(clip);
      }
      const clips: any = new Proxy({ get numItems() { return items.length; } }, { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) indexedReads++; const at = typeof key === "string" && /^\d+$/.test(key) ? Number(key) : -1; return at >= 0 ? items[at] : Reflect.get(target, key, receiver); } });
      tracks.push({ transitions: { numItems: 0 }, clips, isLocked: () => false, _items: items });
    }
    const seq: any = { videoTracks: { numTracks: 6, ...tracks }, audioTracks: { numTracks: 0 }, timebase: String(TICKS / 24) };
    const qe: any = { project: { getActiveSequence: () => ({ getVideoTrackAt: (i: number) => ({ isSyncLocked: () => true }), getAudioTrackAt: () => null }) } };
    const sandbox: any = { app: { enableQE() {}, project: { activeSequence: seq } }, qe, Time: function Time(this: { ticks: string }) { this.ticks = "0"; } };
    const script = buildToolScript(rippleDeleteScriptBody({ nodeId: "target", scope: "sync_locked", rangeDelete: false, dryRun: false, allowLargeRipple: true }));
    const response = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, sandbox)));
    expect(response.success).toBe(true);
    expect(response.data.clipsShifted).toBe(1499);
    expect(indexedReads).toBeLessThan(1500 * 10);
    expect(moveCalls).toBe(1499);
    expect(edgeWrites).toBe(0);
  });
});
