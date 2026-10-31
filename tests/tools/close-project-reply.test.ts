import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), withBridgeWorkflow: (_o: unknown, work: () => unknown) => work() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithExpectedProject } from "../../src/bridge/project-guard.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
const tool = getProjectTools({ tempDir: "/tmp/close-reply", timeoutMs: 1000 }).close_project;
const path = '/scratch/a"quote.prproj';
beforeEach(() => vi.clearAllMocks());
function host({ ignore = false, unreadable = false } = {}) {
  let closed = false, calls = 0, nativeCloses = 0, invalidReads = 0;
  const scripts: string[] = [];
  const project = { name: 'a"quote', path, documentID: "saved-id", closeDocument: vi.fn(() => { nativeCloses++; closed = !ignore; return !ignore; }) };
  const read = <T>(value: T): T => { if (closed && (calls === 1 || unreadable)) { invalidReads++; throw Error("Project context torn down"); } return value; };
  const app = { get project() { return read(closed ? null : project); }, get projects() { return read(closed ? { numProjects: 0 } : { numProjects: 1, 0: project }); }, enableQE() { read(null); } };
  vi.mocked(sendCommand).mockImplementation(async (script, options) => {
    calls++; scripts.push(script);parse(script, { ecmaVersion: 3, allowReserved: "never" });
    // Only the close itself goes to the headless engine, which survives the panel teardown.
    if (calls === 1) expect(options).toMatchObject({ mutating: true, hostEngine: "headless" });
    else expect(options).not.toHaveProperty("hostEngine");
    if (calls > 1) expect(options).toMatchObject({ mutating: false, mutationOnTimeout: false });
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, File: class { fsName: string; constructor(p: string) { this.fsName = p; } }, $: { os: "Macintosh", global: {} } })));
  });
  return { scripts, get: () => ({ calls, nativeCloses, invalidReads }), project };
}
describe("project-close reply survives project context teardown", () => {
  it.each([true, false])("returns before touching closed host objects and verifies separately (save=%s)", async save => {
    const h = host();
    expect(await tool.handler({ save_first: save })).toMatchObject({ success: true, data: { closed: true, verified: true, name: 'a"quote', path, saved: save, activeProjectPath: null, openProjects: [] } });
    expect(h.get()).toEqual({ calls: 2, nativeCloses: 1, invalidReads: 0 });
    expect(h.scripts[0].slice(h.scripts[0].indexOf("var closed = project.closeDocument"))).not.toMatch(/app\.project|__findOpenProject|__openProjectPaths|return __result/);
  });
  it("keeps guard and undo checks before closing, without requiring the closed project on verification", async () => {
    const h = host();
    const result = await runWithExpectedProject(path, () => runWithUndoTracking(true, () => tool.handler({})));
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(h.scripts[0]).toContain("Expected project guard");
    expect(h.scripts[1]).not.toContain("Expected project guard");
  });
  it("never certifies an ignored close", async () => {
    const h = host({ ignore: true });
    expect(await tool.handler({ save_first: false })).toMatchObject({ success: false, data: { closed: false, verified: false, outcome: "failed" } });
    expect(h.get().nativeCloses).toBe(1);
  });
  it("keeps closure unknown when independent readback is unavailable", async () => {
    const h = host({ unreadable: true });
    expect(await tool.handler({})).toMatchObject({ success: true, data: { closed: null, verified: false, outcome: "committed_unverified", closeRequested: true } });
    expect(h.get().nativeCloses).toBe(1);
  });
  it("refuses an invalid target path without closing another project", async () => {
    const h = host();
    expect(await tool.handler({ project_path: 'missing"\n' })).toMatchObject({ success: false });
    expect(h.get().nativeCloses).toBe(0);
  });
  it("does not retry or infer closure from a missing close reply", async () => {
    vi.mocked(sendCommand).mockResolvedValue({ success: false, error: "Host busy timeout", data: { mutationOutcome: "unknown" } });
    expect(await tool.handler({})).toMatchObject({ success: false, data: { mutationOutcome: "unknown" } });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
});
