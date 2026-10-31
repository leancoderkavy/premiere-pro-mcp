import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getProjectTools } from "../../src/tools/project.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), getTempDir: () => "/tmp/path-identity" }));
import { sendCommand } from "../../src/bridge/file-bridge.js";

function fixture(a: string, b: string, ignore = false) {
  const first = { path: a, name: "First", activeSequence: { name: "First", sequenceID: "first" }, sequences: { numSequences: 0 }, openSequence: () => false };
  const second = { path: b, name: "Second", activeSequence: { name: "Second", sequenceID: "second" }, sequences: { numSequences: 0 }, openSequence: vi.fn(() => { if (!ignore) app.project = second as typeof first; return !ignore; }) };
  const app = { project: first, projects: { 0: first, 1: second, numProjects: 2 }, openDocument: vi.fn(() => false) };
  function File(this: Record<string, unknown>, value: string) { this.fsName = value; this.exists = value === a || value === b; }
  vi.mocked(sendCommand).mockImplementation(async script => { parse(script, { ecmaVersion: 3, allowReserved: "never" }); return JSON.parse(String(runInNewContext(getHelpersSource() + script, { app, File, $: { os: "Macintosh" } }))); });
  return { app, first, second };
}
describe("project path collisions", () => {
  it.each([["/work/shot.prproj", "/work/Shot.prproj"], ["/work/a/b.prproj", "/work/a\\b.prproj"]])("activates the exact requested POSIX project: %s", async (a,b) => {
    const f = fixture(a,b);const result = await getProjectTools({}).open_project.handler({ path: b });
    expect(result).toMatchObject({ success: true, data: { verified: true, path: b, alreadyOpen: true } });
    expect(f.app.project).toBe(f.second);expect(f.second.openSequence).toHaveBeenCalledOnce();
  });
  it.each([["/work/shot.prproj", "/work/Shot.prproj"], ["/work/a/b.prproj", "/work/a\\b.prproj"]])("does not verify an ignored switch to a colliding path: %s", async (a,b) => {
    const f = fixture(a,b,true);expect(await getProjectTools({}).open_project.handler({ path:b })).toMatchObject({ success:false });expect(f.app.project).toBe(f.first);
  });
  it("refuses a nonexistent hostile path without opening it", async () => {
    const f=fixture("/work/a.prproj","/work/b.prproj");expect(await getProjectTools({}).open_project.handler({ path:'/work/missing "quote"\\file.prproj' })).toMatchObject({ success:false,error:expect.stringContaining("not found") });expect(f.app.openDocument).not.toHaveBeenCalled();
  });
});
