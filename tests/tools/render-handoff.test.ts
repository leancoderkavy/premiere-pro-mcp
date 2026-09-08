import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { getRenderHandoffTools } from "../../src/tools/render-handoff.js";
import { resolveCapabilities, capabilitiesForToolInvocation } from "../../src/security/capabilities.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "render-handoff-")));
  folders.push(root);
  const output = path.join(root, "render.mov");
  const aePath = path.join(root, "source.aep");
  const ppPath = path.join(root, "edit.prproj");
  for (const name of [output, aePath, ppPath]) writeFileSync(name, "fixture");
  const args = { approved_workspace_path: root, output_path: output, ae_project_path: aePath, premiere_project_path: ppPath, queue_item_index: 1, target_bin_id: "bin-1" };
  const state = { status: "DONE", output, projectPath: ppPath, projectId: "project-1", binName: "Renders", compId: 5, imports: 0, aeCalls: 0, noReadback: false, timeout: false, clock: 100, modules: 1, binId: "bin-1" };
  const children: Array<{ nodeId: string; getMediaPath: () => string }> = [];
  function File(this: { fsName: string; exists: boolean }, name: string) { this.fsName = path.normalize(name); this.exists = true; }
  const result = (data: unknown) => ({ success: true, data });
  const error = (message: string) => ({ success: false, error: message });
  const tools = getRenderHandoffTools({ tempDir: root, timeoutMs: 500 }, {
    now: () => state.clock,
    sendAfterEffects: async (script) => {
      state.aeCalls++;
      return vm.runInNewContext(script, { File, __aeResult: result, __aeError: error, RQItemStatus: { DONE: "DONE" }, app: { project: {
        file: { fsName: aePath }, renderQueue: { rendering: false, numItems: 1, item: () => ({ status: state.status, numOutputModules: state.modules, comp: { id: state.compId }, outputModule: () => ({ file: { fsName: state.output, exists: true } }) }) },
      } } });
    },
    sendPremiere: async (script) => {
      const target = { nodeId: state.binId, name: state.binName, type: 2, children: new Proxy(children, { get: (array, key) => key === "numItems" ? array.length : Reflect.get(array, key) }) };
      return vm.runInNewContext(script, { File, __result: result, __error: error, __findProjectItem: () => target, app: { project: {
        path: state.projectPath, documentID: state.projectId,
        importFiles: () => { state.imports++; if (state.timeout) throw new Error("host timeout"); if (!state.noReadback) children.push({ nodeId: "media-1", getMediaPath: () => output }); return true; },
      } } });
    },
  });
  const preview = async () => (await tools.preview_after_effects_render_handoff.handler(args)).data.previewToken;
  const apply = (token: string) => tools.apply_after_effects_render_handoff.handler({ preview_token: token, confirm_import: true });
  return { tools, state, args, preview, apply, output, children, root };
}

describe("completed AE render handoff", () => {
  it("executes both generated host scripts and imports only after confirmation, with readback and no replay", async () => {
    const f = fixture();
    const token = await f.preview();
    expect(f.state.imports).toBe(0);
    await expect(f.tools.apply_after_effects_render_handoff.handler({ preview_token: token, confirm_import: false })).rejects.toThrow("confirm_import");
    expect(await f.apply(token)).toMatchObject({ success: true, data: { projectItemId: "media-1", importVerified: true, timelineChanged: false, visualVerified: false } });
    expect(f.state.imports).toBe(1);
    await expect(f.apply(token)).rejects.toThrow("already used");
    await expect(f.preview()).rejects.toThrow("already in the target bin");
  });

  it.each(["QUEUED", "RENDERING", "ERR_STOPPED", "USER_STOPPED"])("rejects AE status %s without importing", async (status) => {
    const f = fixture(); f.state.status = status;
    await expect(f.preview()).rejects.toThrow("not completed");
    expect(f.state.imports).toBe(0);
  });

  it("rejects output mismatch and multi-output renders", async () => {
    const f = fixture(); f.state.output = "other.mov";
    await expect(f.preview()).rejects.toThrow("does not match");
    f.state.output = f.output; f.state.modules = 2;
    await expect(f.preview()).rejects.toThrow("single-output");
  });

  it.each(["projectId", "projectPath", "binName", "binId", "compId"] as const)("rechecks %s before mutation", async (field) => {
    const f = fixture(); const token = await f.preview();
    if (field === "compId") f.state.compId = 9; else f.state[field] = "changed";
    expect(await f.apply(token)).toMatchObject({ success: false });
    expect(f.state.imports).toBe(0);
  });

  it("rejects media changed after preview before any new host call", async () => {
    const f = fixture(); const token = await f.preview();
    writeFileSync(f.output, "different longer media");
    expect(await f.apply(token)).toMatchObject({ success: false, data: { failedStage: "file_recheck", importMayHaveOccurred: false } });
    expect(f.state.aeCalls).toBe(1);
  });

  it.each(["noReadback", "timeout"] as const)("reports ambiguous import for %s and consumes approval", async (field) => {
    const f = fixture(); const token = await f.preview(); f.state[field] = true;
    expect(await f.apply(token)).toMatchObject({ success: false, data: { failedStage: "premiere_import", importMayHaveOccurred: true, rollbackAttempted: false } });
    await expect(f.apply(token)).rejects.toThrow("already used");
  });

  it("enforces expiry and capability gates", async () => {
    const f = fixture(); const token = await f.preview(); f.state.clock += 600000;
    await expect(f.apply(token)).rejects.toThrow("expired");
    const tools = getRenderHandoffTools({ tempDir: f.root, timeoutMs: 500 }, { capabilities: resolveCapabilities("inspect") });
    await expect(tools.preview_after_effects_render_handoff.handler(f.args)).rejects.toThrow("filesystem");
    expect(capabilitiesForToolInvocation("apply_after_effects_render_handoff", {})).toEqual(["inspect", "edit", "filesystem"]);
  });

  it("rejects empty media, traversal, and directory symlinks outside the workspace", async () => {
    const f = fixture(); writeFileSync(f.output, "");
    await expect(f.preview()).rejects.toThrow("nonempty");
    const other = fixture();
    await expect(f.tools.preview_after_effects_render_handoff.handler({ ...f.args, output_path: other.output })).rejects.toThrow("inside");
    const link = path.join(f.root, "escape");
    symlinkSync(other.root, link, process.platform === "win32" ? "junction" : "dir");
    await expect(f.tools.preview_after_effects_render_handoff.handler({ ...f.args, output_path: path.join(link, "render.mov") })).rejects.toThrow("inside");
  });
});
