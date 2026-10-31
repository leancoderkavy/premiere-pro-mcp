import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { effectRemovalHost, type RemovalMode } from "../helpers/effect-removal-host.js";
const tools = { ...getEffectsTools({}), ...getClipboardTools({}), ...getAdvancedTools({}) };
const names = ["remove_effect", "remove_effect_by_name", "remove_all_effects"] as const;
function bridge(host: ReturnType<typeof effectRemovalHost>) { vi.mocked(sendCommand).mockImplementation(async script => host.run(script)); }
beforeEach(() => { vi.mocked(sendCommand).mockReset(); });
describe("uncovered effect-removal preflight refusals", () => {
  it.each([["Volume", "Internal Volume Mono"], ["Panner", "Internal Audio Panner"], ["Motion", "AE.ADBE Motion"], ["Opacity", "AE.ADBE Opacity"]])("refuses intrinsic %s without dispatching a removal", async (name, match) => {
    const host = effectRemovalHost({ names: [[name, match]] }); bridge(host);
    for (const args of [{ effect_name: name }, { effect_index: 0 }]) {
      const result = await tools.remove_effect.handler({ node_id: host.clip.nodeId, ...args });
      expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("not_applied");
    }
    expect(host.attempts).toBe(0);
  });
  it.each(["Channel Volume", 'Missing "effect" \\ name\n'])("reports a missing effect %s as not applied", async effect_name => {
    const host = effectRemovalHost(); bridge(host);
    for (const name of ["remove_effect", ...(effect_name === "Channel Volume" ? [] : ["remove_effect_by_name"])] as const) {
      const result = await tools[name].handler({ node_id: host.clip.nodeId, effect_name });
      expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
    }
    expect(host.attempts).toBe(0);
  });
  it("covers the late match-name intrinsic refusal without duplicating the early display-name guard", async () => {
    const host = effectRemovalHost({ names: [["Deckkraft", "AE.ADBE Opacity"]] }); bridge(host);
    expect(await tools.remove_effect_by_name.handler({ node_id: host.clip.nodeId, effect_name: "Deckkraft" })).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(host.attempts).toBe(0);
  });
  it.each([-1, 0.5, NaN, Infinity, '0; throw "bad"'])("rejects invalid index %s before the bridge", async effect_index => {
    const result = await tools.remove_effect.handler({ node_id: "fixture", effect_index: effect_index as number });
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it("refuses an out-of-range component index without changing the clip", async () => {
    const host = effectRemovalHost(); bridge(host);
    expect(await tools.remove_effect.handler({ node_id: host.clip.nodeId, effect_index: 99 })).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(host.attempts).toBe(0);
  });
  for (const name of names) {
    it(name + " reports a capability preflight as not applied", async () => {
      const host = effectRemovalHost({ mode: "unsupported" }); bridge(host);
      expect(await tools[name].handler({ node_id: host.clip.nodeId, effect_name: "Tint" })).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
      expect(host.attempts).toBe(0);
    });
    it(name + " reports localization preflight as not applied", async () => {
      const host = effectRemovalHost({ names: [["Deckkraft", "AE.ADBE Opacity"], ["Tint", "AE.ADBE Tint"]] }); bridge(host);
      expect(await tools[name].handler({ node_id: host.clip.nodeId, effect_name: "Tint" })).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
      expect(host.attempts).toBe(0);
    });
    it.each(["throw", "remove_then_throw", "ignore", "qe_remove_then_throw"] as RemovalMode[])(name + " keeps post-attempt %s uncertain without QE retry", async mode => {
      const host = effectRemovalHost({ mode }); bridge(host);
      const result = await tools[name].handler({ node_id: host.clip.nodeId, effect_name: "Tint" });
      expect(result.success).toBe(false);
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("unknown");
      expect(host.attempts).toBe(1); expect(host.qeAttempts).toBe(mode === "qe_remove_then_throw" ? 1 : 0);
      if (mode === "remove_then_throw" || mode === "qe_remove_then_throw") expect(host.list.map(c => c.displayName)).not.toContain("Tint");
    });
    it(name + " still verifies a completed documented removal", async () => {
      const host = effectRemovalHost(); bridge(host);
      expect(await tools[name].handler({ node_id: host.clip.nodeId, effect_name: "Tint" })).toMatchObject({ success: true, data: { verified: true } });
      expect(host.attempts).toBe(1); expect(host.qeAttempts).toBe(0);
    });
  }
});
