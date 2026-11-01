import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { parse } from "acorn";
import { getSendToAfterEffectsTools } from "../../src/tools/send-to-after-effects.js";
import { resolveCapabilities, capabilitiesForToolInvocation } from "../../src/security/capabilities.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

const TPS = 254016000000;
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

interface HostClip { speed?: number; reversed?: boolean; scale?: number; extraEffect?: string; mediaPath?: string; trackType?: string }

/** A Premiere host fake that executes the generated clip-read script for real. */
function premiereHost(clipOptions: HostClip = {}) {
  const mediaPath = clipOptions.mediaPath ?? "/media/interview.mp4";
  const prop = (displayName: string, value: unknown) => ({ displayName, isTimeVarying: () => false, getValue: () => value });
  const components = [
    { matchName: "AE.ADBE Opacity", displayName: "Opacity", properties: { numItems: 1, 0: prop("Opacity", 100) } },
    { matchName: "AE.ADBE Motion", displayName: "Motion", properties: { numItems: 3, 0: prop("Position", [0.5, 0.5]), 1: prop("Scale", clipOptions.scale ?? 100), 2: prop("Rotation", 0) } },
    ...(clipOptions.extraEffect ? [{ matchName: "AE.ADBE Lumetri", displayName: clipOptions.extraEffect, properties: { numItems: 0 } }] : []),
  ];
  const clip = {
    nodeId: "clip-1", name: 'Talk "A" \\ cut', start: { ticks: String(2 * TPS) }, end: { ticks: String(5 * TPS) }, inPoint: { ticks: String(4 * TPS) },
    projectItem: { nodeId: "item-1", getMediaPath: () => mediaPath },
    getSpeed: () => clipOptions.speed ?? 1, isSpeedReversed: () => clipOptions.reversed ?? false,
    components: Object.assign({ numItems: components.length }, components),
  };
  const seq = { sequenceID: "seq-1", frameSizeHorizontal: 1920, frameSizeVertical: 1080, getSettings: () => ({ videoPixelAspectRatio: "1:1", videoFrameRate: { ticks: String(TPS / 25) } }) };
  function File(this: { fsName: string; exists: boolean }, name: string) { this.fsName = name; this.exists = true; }
  return async (script: string) => {
    parse(`${getHelpersSource()}\n${script}`, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(vm.runInNewContext(script, {
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
      __error: (error: string, data?: unknown) => JSON.stringify({ success: false, error, data }),
      app: { project: { path: "/projects/edit.prproj", documentID: "doc-1", activeSequence: seq } },
      __findClip: () => ({ clip, trackType: clipOptions.trackType ?? "video", trackIndex: 0 }),
      File,
    })));
  };
}

function fixture(clipOptions: HostClip = {}, overrides: { importAudioSpan?: number; replaceFails?: boolean; aeName?: string } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "send-to-ae-")));
  folders.push(root);
  const aep = path.join(root, "motion.aep");
  writeFileSync(aep, "fixture");
  const readClip = premiereHost(clipOptions);
  const calls: string[] = [];
  const aeScripts: string[] = [];
  const sendPremiere = vi.fn(async (script: string) => {
    if (script.includes("importAEComps")) {
      calls.push("premiere_import");
      parse(`${getHelpersSource()}\n${script}`, { ecmaVersion: 3, allowReserved: "never" });
      return { success: true, data: { itemId: "linked-1", itemName: "x/motion.aep", videoIn: 0, videoOut: 3, audioSpan: overrides.importAudioSpan ?? 0, unexpectedItems: 0 } };
    }
    calls.push("premiere_read");
    return readClip(script);
  });
  const sendAfterEffects = vi.fn(async (script: string) => {
    aeScripts.push(script);
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    if (script.includes("taken[name]")) { calls.push("ae_name"); return { success: true, data: { compName: overrides.aeName ?? 'Talk "A" \\ cut Linked Comp' } }; }
    calls.push("ae_build");
    return { success: true, data: { compId: "7", compName: overrides.aeName ?? 'Talk "A" \\ cut Linked Comp', saved: true } };
  });
  const replaceClip = vi.fn(async () => overrides.replaceFails
    ? { success: false, error: "Replace refused; nothing was changed." }
    : { success: true, data: { replaced: true, verified: true, outcome: "verified", startSeconds: 2, endSeconds: 5 } });
  const tools = getSendToAfterEffectsTools({ tempDir: root, timeoutMs: 500 }, { capabilities: resolveCapabilities(), sendPremiere, sendAfterEffects, replaceClip, now: () => 1000 });
  const args = { node_id: "clip-1", ae_project_path: aep, approved_workspace_path: root };
  const preview = async (extra: Record<string, unknown> = {}) => tools.preview_send_clip_to_after_effects.handler({ ...args, ...extra }) as Promise<any>;
  const apply = (token: string) => tools.apply_send_clip_to_after_effects.handler({ preview_token: token, confirm_send: true }) as Promise<any>;
  return { tools, preview, apply, calls, aeScripts, replaceClip, root };
}

describe("send a timeline clip to After Effects", () => {
  it("previews the comp from the clip's exact source range without changing anything", async () => {
    const f = fixture();
    const result = await f.preview();
    expect(result.data.plan.clip).toMatchObject({ startSeconds: 2, endSeconds: 5, sourceInSeconds: 4, sourceMedia: "/media/interview.mp4" });
    expect(result.data.plan.composition).toMatchObject({ width: 1920, height: 1080, pixelAspect: 1, frameRate: 25, durationSeconds: 3 });
    expect(result.data.plan.effectsNotCarried).toEqual([]);
    expect(f.calls).toEqual(["premiere_read", "ae_name"]);
    expect(f.replaceClip).not.toHaveBeenCalled();
  });

  it("creates the comp, imports it and swaps it in only after confirmation, once", async () => {
    const f = fixture();
    const { data } = await f.preview();
    await expect(f.tools.apply_send_clip_to_after_effects.handler({ preview_token: data.previewToken, confirm_send: false })).rejects.toThrow("confirm_send");
    const result = await f.apply(data.previewToken);
    expect(result).toMatchObject({ success: true, data: { stage: "complete", outcome: "verified", linkedItemId: "linked-1", timelineChanged: true } });
    expect(f.calls).toEqual(["premiere_read", "ae_name", "premiere_read", "ae_build", "premiere_import"]);
    expect(f.replaceClip).toHaveBeenCalledWith({ node_id: "clip-1", new_item_id: "linked-1" });
    const build = f.aeScripts[f.aeScripts.length - 1];
    expect(build).toContain("layer.startTime = -4;");
    expect(build).toContain("layer.audioEnabled = false");
    expect(build).toContain("addComp(\"Talk \\\"A\\\" \\\\ cut Linked Comp\", 1920, 1080, 1, 3, 25)");
    await expect(f.apply(data.previewToken)).rejects.toThrow("already used");
  });

  it.each([
    [{ speed: 2 }, "Speed-changed"],
    [{ reversed: true }, "Speed-changed"],
    [{ trackType: "audio" }, "Only a video clip"],
    [{ mediaPath: "/projects/titles.aep" }, "already a linked composition"],
    [{ mediaPath: "" }, "no file path"],
  ])("refuses %j before touching After Effects", async (clipOptions, message) => {
    const f = fixture(clipOptions);
    await expect(f.preview()).rejects.toThrow(message);
    expect(f.calls).toEqual(["premiere_read"]);
  });

  it("lists effects and changed Motion that the swap does not carry over", async () => {
    const f = fixture({ scale: 120, extraEffect: "Lumetri Color" });
    const { data } = await f.preview();
    expect(data.plan.effectsNotCarried).toEqual(["Motion", "Lumetri Color"]);
    expect(data.warnings[0]).toContain("Motion, Lumetri Color");
  });

  it("stops before replacing when the linked comp carries audio", async () => {
    const f = fixture({}, { importAudioSpan: 3 });
    const { data } = await f.preview();
    const result = await f.apply(data.previewToken);
    expect(result).toMatchObject({ success: false, data: { failedStage: "premiere_import", mutationOutcome: "unknown" } });
    expect(f.replaceClip).not.toHaveBeenCalled();
  });

  it("reports a failed swap with the linked item kept for a manual replace", async () => {
    const f = fixture({}, { replaceFails: true });
    const { data } = await f.preview();
    const result = await f.apply(data.previewToken);
    expect(result).toMatchObject({ success: false, data: { failedStage: "replace_clip", timelineChanged: null, import: { itemId: "linked-1" } } });
    expect(result.data.nextStep).toContain("replace_clip");
  });

  it("keeps the After Effects project inside the approved workspace", async () => {
    const f = fixture();
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "outside-")));
    folders.push(outside);
    writeFileSync(path.join(outside, "other.aep"), "fixture");
    await expect(f.preview({ ae_project_path: path.join(outside, "other.aep") })).rejects.toThrow("approved_workspace_path");
    await expect(f.preview({ extra: true })).rejects.toThrow("Unsupported field");
  });

  it("requires filesystem for preview and edit for apply", () => {
    expect(capabilitiesForToolInvocation("preview_send_clip_to_after_effects", {})).toEqual(["inspect", "filesystem"]);
    expect(capabilitiesForToolInvocation("apply_send_clip_to_after_effects", {})).toEqual(["inspect", "edit", "filesystem"]);
  });
});
