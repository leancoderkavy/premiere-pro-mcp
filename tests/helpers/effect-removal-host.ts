import { createContext, runInContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
export type RemovalMode = "remove" | "ignore" | "throw" | "remove_then_throw" | "qe_remove" | "qe_remove_then_throw" | "unsupported";
export interface RemovalHostOptions { mode?: RemovalMode; names?: Array<[string, string]>; trackType?: "video" | "audio"; }
export function effectRemovalHost(options: RemovalHostOptions = {}) {
  let attempts = 0, qeAttempts = 0;
  const mode = options.mode ?? "remove";
  const list = (options.names ?? [["Opacity", "AE.ADBE Opacity"], ["Motion", "AE.ADBE Motion"], ["Tint", "AE.ADBE Tint"]]).map(([displayName, matchName]) => {
    const component: any = { displayName, matchName };
    if (mode !== "unsupported" && mode !== "qe_remove" && mode !== "qe_remove_then_throw") component.remove = () => {
      attempts++;
      if (mode === "throw") throw new Error("host removal failed");
      if (mode !== "ignore") list.splice(list.indexOf(component), 1);
      if (mode === "remove_then_throw") throw new Error("host changed then failed");
    };
    return component;
  });
  const components = new Proxy({}, { get: (_t, key) => key === "numItems" ? list.length : list[Number(key)] });
  const clip = { nodeId: 'clip"\\id', name: "Scratch clip", start: { ticks: "0" }, end: { ticks: "254016000000" }, components };
  const track = { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } };
  const sequence = { sequenceID: "sequence-1", videoTracks: options.trackType === "audio" ? { numTracks: 0 } : track, audioTracks: options.trackType === "audio" ? track : { numTracks: 0 } };
  const item = { nodeId: "item-1", name: "Original", type: 1, isSequence: () => false };
  const qeClip = { type: "Clip", start: { ticks: "0" }, getComponentAt: (index: number) => mode === "unsupported" ? null : { name: list[index]?.displayName, remove() { attempts++; qeAttempts++; list.splice(index, 1); if (mode === "qe_remove_then_throw") throw new Error("QE changed then failed"); } } };
  const qeTrack = { numItems: 1, getItemAt: () => qeClip };
  const context = createContext({
    app: { enableQE() {}, project: { documentID: "project-1", path: "/fixture/scratch.prproj", activeSequence: sequence, sequences: { numSequences: 1, 0: sequence }, rootItem: { children: { numItems: 1, 0: item } } } },
    qe: { project: { undoStackIndex: () => 10, getActiveSequence: () => ({ getVideoTrackAt: () => qeTrack, getAudioTrackAt: () => qeTrack }) } },
    $: { os: "Macintosh", global: {} },
  });
  const helpers = getHelpersSource();
  parse(helpers, { ecmaVersion: 3, allowReserved: "never" });
  runInContext(helpers, context);
  return { clip, item, list, get attempts() { return attempts; }, get qeAttempts() { return qeAttempts; },
    run(script: string) { parse(script, { ecmaVersion: 3, allowReserved: "never" }); return JSON.parse(String(runInContext(script, context))); },
  };
}
