import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAudioTransitionTools } from "../../src/tools/audio-transitions.js";

const mockedSendCommand = vi.mocked(sendCommand);
const options: BridgeOptions = { tempDir: "/tmp/audio-crossfade-tests", timeoutMs: 5000 };
const tools = getAudioTransitionTools(options);
const TICKS = 254016000000;
const frameTicks = TICKS / 25;

function mockHost(settings: { existing?: boolean; transitionExists?: boolean; throwAfterWrite?: boolean; audioOnly?: boolean; legacyCatalog?: boolean } = {}) {
  const state = { writes: 0, names: [] as string[], starts: [] as boolean[], timecodes: [] as string[] };
  const transition = { name: "Constant Power" };
  const transitions: Array<{ start: { ticks: string }; end: { ticks: string }; nodeId: string }> = [];
  if (settings.existing) {
    transitions.push({
      start: { ticks: String(1.5 * TICKS) }, end: { ticks: String(2.5 * TICKS) }, nodeId: "existing-transition",
    });
  }
  const outgoing = { nodeId: "outgoing", start: { ticks: "0" }, end: { ticks: String(2 * TICKS) } };
  const incoming = { nodeId: "incoming", start: { ticks: String(2 * TICKS) }, end: { ticks: String(4 * TICKS) } };
  const clips = settings.audioOnly ? [incoming] : [outgoing, incoming];
  const track = { clips: { numItems: clips.length, ...Object.fromEntries(clips.map((clip, index) => [index, clip])) }, transitions: { get numItems() { return transitions.length; } } as Record<string, unknown> };
  for (const clip of clips) {
    const qeClip = {
      type: "Clip", start: clip.start, addTransition: (named: { name: string }, atStart: boolean, durationCode: string) => {
        state.writes++;
        state.names.push(named.name);
        state.starts.push(atStart);
        state.timecodes.push(durationCode);
        const cut = atStart ? Number(clip.start.ticks) : Number(clip.end.ticks);
        const half = TICKS / 2;
        transitions.push({ start: { ticks: String(cut - half) }, end: { ticks: String(cut + half) }, nodeId: "written-transition" });
        if (settings.throwAfterWrite) throw new Error("QE failed after mutation");
      },
    };
    (clip as typeof clip & { qeClip?: typeof qeClip }).qeClip = qeClip;
  }
  const qeTrack = { numItems: clips.length, getItemAt: (i: number) => (clips[i] as typeof incoming & { qeClip: object }).qeClip };
  const context = {
    app: {
      enableQE: () => {},
      project: { activeSequence: {
        timebase: String(frameTicks),
        audioTracks: { numTracks: 1, 0: track },
        videoTracks: { numTracks: 0 },
      } },
    },
    qe: {
      project: {
        getActiveSequence: () => ({ getAudioTrackAt: (index: number) => (index === 0 ? qeTrack : null) }),
        getAudioTransitionByName: (name: string) => settings.transitionExists === false ? null : (name === "Constant Power" ? transition : null),
        getAudioTransitionList: () => settings.legacyCatalog ? ({ numItems: 1, 0: transition }) : ["Constant Power"],
      },
    },
  };
  Object.assign(track.transitions, Object.fromEntries(transitions.map((t, i) => [i, t])));
  mockedSendCommand.mockImplementation(async (script: string) => {
    const result = JSON.parse(String(runInNewContext(getHelpersSource() + "\n" + script, context)));
    Object.assign(track.transitions, Object.fromEntries(transitions.map((t, i) => [i, t])));
    return result;
  });
  // A DOM transition collection is live and must expose new items during readback.
  Object.defineProperty(track, "transitions", { value: new Proxy(track.transitions, {
    get(target, property) {
      if (property === "numItems") return transitions.length;
      if (typeof property === "string" && /^\d+$/.test(property)) return transitions[Number(property)];
      return Reflect.get(target, property);
    },
  }) });
  return state;
}

beforeEach(() => vi.resetAllMocks());

describe("native QE audio transitions", () => {
  it("adds Constant Power at the exact shared audio cut and verifies the stored span", async () => {
    const state = mockHost();
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2, duration_seconds: 1 });
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", transition: "Constant Power", transitionsAdded: 1 } });
    expect(state.names).toEqual(["Constant Power"]);
    expect(state.starts).toEqual([true]);
    expect(state.timecodes).toEqual(["00:00:01:00"]);
  });

  it("allows native fade-out on an audio clip's end", async () => {
    const state = mockHost();
    const result = await tools.add_audio_transition_to_clip.handler({ node_id: "incoming", position: "end" });
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified" } });
    expect(state.starts).toEqual([false]);
  });

  it("refuses a missing adjacent clip for a crossfade", async () => {
    const state = mockHost({ audioOnly: true });
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2 });
    expect(result).toMatchObject({ success: false });
    expect(state.writes).toBe(0);
    expect(JSON.stringify(result)).toMatch(/adjacent audio clips/);
  });

  it("refuses a duplicate transition before attempting QE mutation", async () => {
    const state = mockHost({ existing: true });
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2 });
    expect(result).toMatchObject({ success: false });
    expect(state.writes).toBe(0);
    expect(JSON.stringify(result)).toMatch(/already covers/);
  });

  it("fails closed when the transition is unavailable", async () => {
    const state = mockHost({ transitionExists: false });
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2 });
    expect(result).toMatchObject({ success: false });
    expect(state.writes).toBe(0);
  });

  it("resolves legacy catalog entries even when by-name is absent", async () => {
    const state = mockHost({ legacyCatalog: true, transitionExists: false });
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2 });
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(state.writes).toBe(1);
  });

  it("reports committed-unverified if a QE write throws after mutation, without retrying", async () => {
    const state = mockHost({ throwAfterWrite: true });
    const result = await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2 });
    expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
    expect(state.writes).toBe(1);
  });

  it("escapes hostile clip IDs and returns not_applied before a host write", async () => {
    const state = mockHost();
    const result = await runWithUndoTracking(true, () => tools.add_audio_transition_to_clip.handler({ node_id: 'missing"\\\n\u2028id', position: "end" }));
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(state.writes).toBe(0);
  });

  it("validates unsafe input before invoking the bridge", async () => {
    expect(await tools.add_audio_transition.handler({ track_index: -1, cut_point_seconds: 2 })).toMatchObject({ success: false });
    expect(await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: Number.NaN })).toMatchObject({ success: false });
    expect(await tools.add_audio_transition.handler({ track_index: 0, cut_point_seconds: 2, duration_seconds: 0 })).toMatchObject({ success: false });
    expect(await tools.add_audio_transition_to_clip.handler({ node_id: "incoming", position: "other" as "start" })).toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("audio transition tool schemas", () => {
  // O servidor converte `parameters` com jsonSchemaToInputSchema antes de chamar o
  // handler. Um mapa de propriedades solto faz o schema validar um objeto vazio e
  // descartar todos os argumentos: a ferramenta responde, mas sempre recusa por
  // falta de campo. O teste de handler não pega isso porque chama o handler direto.
  for (const name of ["add_audio_transition", "add_audio_transition_to_clip"] as const) {
    it(`${name} declares a JSON Schema object with properties`, () => {
      const parameters = (tools[name] as { parameters: Record<string, unknown> }).parameters;
      expect(parameters.type).toBe("object");
      expect(parameters.properties).toBeTypeOf("object");

      const properties = parameters.properties as Record<string, unknown>;
      const required = parameters.required as string[];
      expect(Array.isArray(required)).toBe(true);
      for (const key of required) {
        expect(properties[key], `${name} requires "${key}" but does not declare it`).toBeTruthy();
      }
    });
  }
});

