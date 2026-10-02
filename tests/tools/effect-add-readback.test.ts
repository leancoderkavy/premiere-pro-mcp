import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource, escapeForExtendScript } from "../../src/bridge/script-builder.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
const send = vi.mocked(sendCommand);
const tools = getEffectsTools({ tempDir: "/tmp/effect-readback", timeoutMs: 5000 });
beforeEach(() => vi.resetAllMocks());

describe.each(["apply_effect", "apply_audio_effect"] as const)("%s readback", (tool) => {
  function host(mode = "add", name = "Test effect") {
    const initial = { displayName: name, matchName: "existing" };
    const added = { displayName: name, matchName: "new-match" };
    const components = Object.assign([initial], { numItems: 1 });
    const clip = { name: "Clip", components };
    const add = vi.fn(() => {
      if (mode === "add" || mode === "throw-after") {
        components.unshift(added); // New effect need not be the last component.
        components.numItems++;
      }
      if (mode === "duplicate") { components.push(initial); components.numItems++; }
      if (mode === "replace") components[0] = added;
      if (mode === "unreadable") Object.defineProperty(clip, "components", { get() { throw Error("DOM unavailable"); } });
      if (mode === "throw" || mode === "throw-after") throw Error("QE failed");
    });
    if (mode === "invalid") components.numItems = NaN;
    const lookup = vi.fn((requested: string) => mode === "missing" ? null : ({ name: requested }));
    const qeClip = { addVideoEffect: add, addAudioEffect: add };
    const context = {
      app: { enableQE() {} },
      qe: { project: {
        getActiveSequence: () => ({ getVideoTrackAt: () => ({}), getAudioTrackAt: () => ({}) }),
        getVideoEffectByName: lookup, getAudioEffectByName: lookup,
        getVideoEffectList: () => [], getAudioEffectList: () => [],
      } },
      findClip: (id: string) => id === "missing" ? null : ({ clip, trackType: "video", trackIndex: 0 }),
      findQeClip: () => { if (mode === "tracked-noop") { context.__undoStart = 3; } return qeClip; },
      __undoStart: null as number | null,
      readUndo: () => mode === "tracked-noop" ? 3 : null,
    };
    send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(
      getHelpersSource() + "\n__findClip = findClip; __findQeClipByDomClip = findQeClip; __readUndoIndex = readUndo;\n" + script, context,
    ))));
    return { add, lookup, added };
  }
  it("verifies growth and reports the newly inserted component's names", async () => {
    const h = host();
    const result = await tools[tool].handler({ node_id: "clip", effect_name: "Test effect" });
    expect(result).toMatchObject({ success: true, data: { applied: true, verified: true, outcome: "verified", componentCountBefore: 1, componentCountAfter: 2, addedComponents: [h.added], renderVerified: false } });
    expect(h.add).toHaveBeenCalledTimes(1);
  });
  it("recognizes another instance of an existing effect", async () => {
    host("duplicate");
    expect(await tools[tool].handler({ node_id: "clip", effect_name: "Test effect" })).toMatchObject({ success: true, data: { verified: true, addedComponents: [{ matchName: "existing" }] } });
  });
  it.each(["unchanged", "unreadable", "throw", "throw-after"])("reports uncertainty after %s without retrying", async (mode) => {
    const h = host(mode);
    const result = await tools[tool].handler({ node_id: "clip", effect_name: "Test effect" });
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", note: expect.stringContaining("Do not retry blindly") } });
    if (mode === "throw-after") expect(result).toMatchObject({ data: { timelineChanged: true } });
    expect(h.add).toHaveBeenCalledTimes(1);
  });
  it("reports not_applied when tracked undo and components are unchanged", async () => {
    host("tracked-noop", "Time Remapping");
    const result = await tools[tool].handler({ node_id: "clip", effect_name: "Time Remapping" });
    expect(result).toMatchObject({ success: false, error: "Premiere added no component for Time Remapping; nothing was changed.", data: { outcome: "not_applied", addedComponents: [] } });
    expect(result.data).not.toHaveProperty("note");
  });
  it("does not call a same-count component replacement a no-op", async () => {
    host("replace");
    expect(await tools[tool].handler({ node_id: "clip", effect_name: "Test effect" })).toMatchObject({
      success: false,
      data: { outcome: "committed_unverified", componentCountBefore: 1, componentCountAfter: 1, addedComponents: [{ matchName: "new-match" }] },
    });
  });
  it("does not claim Time Remapping was added when QE silently does nothing", async () => {
    host("unchanged", "Time Remapping");
    expect(await tools[tool].handler({ node_id: "clip", effect_name: "Time Remapping" })).toMatchObject({ success: false, data: { componentCountBefore: 1, componentCountAfter: 1, outcome: "committed_unverified" } });
  });
  it.each(["invalid", "missing"])("refuses before mutation on %s preconditions", async (mode) => {
    const h = host(mode);
    expect(await tools[tool].handler({ node_id: "clip", effect_name: "Test effect" })).toMatchObject({ success: false });
    expect(h.add).not.toHaveBeenCalled();
  });
  it("refuses a missing clip before mutation", async () => {
    const h = host();
    expect(await tools[tool].handler({ node_id: "missing", effect_name: "Test effect" })).toMatchObject({ success: false });
    expect(h.add).not.toHaveBeenCalled();
  });
  it("escapes names and node IDs in the generated ES3 script", async () => {
    const nodeId = 'node"\\\n\u2028';
    const effectName = 'effect"\\\n\u2029';
    const h = host("add", effectName);
    expect(await tools[tool].handler({ node_id: nodeId, effect_name: effectName })).toMatchObject({ success: true });
    expect(h.lookup).toHaveBeenCalledWith(effectName);
    const script = send.mock.calls[0][0];
    expect(script).toContain(escapeForExtendScript(nodeId));
    expect(script).toContain(escapeForExtendScript(effectName));
    expect(script).not.toMatch(/\b(?:let|const)\s|=>|\.forEach\(/);
  });
});
