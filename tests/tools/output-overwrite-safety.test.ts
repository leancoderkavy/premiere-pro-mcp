import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", async importOriginal => ({ ...(await importOriginal<typeof import("../../src/bridge/file-bridge.js")>()), sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getUtilityTools } from "../../src/tools/utility.js";
const options = { tempDir: "/tmp/output-overwrite-test" };
const cases = [
  ["save_project_as", getProjectTools(options).save_project_as, { path: "/outputs/ẹ̀ṣọ́ 'quoted'.prproj" }],
  ["export_as_project", getAdvancedTools(options).export_as_project, { output_path: "/outputs/ẹ̀ṣọ́ 'quoted'.prproj" }],
  ["freeze_frame", getUtilityTools(options).freeze_frame, { output_path: "/outputs/ẹ̀ṣọ́ 'quoted'.png" }],
] as const;
beforeEach(() => vi.clearAllMocks());

function fakeHost() {
  const writes = vi.fn();
  const seq = { sequenceID: "sequence", exportAsProject: writes, getPlayerPosition: () => ({ ticks: "0" }) };
  const project = { path: "/current.prproj", activeSequence: seq, saveAs: writes };
  function File(this: Record<string, unknown>, file: string) { this.exists = true; this.length = 100; this.fsName = file; this.parent = { exists: true }; }
  vi.mocked(sendCommand).mockImplementation(async script => {
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    const context = { app: { project }, File, writes, $: { global: {} } };
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\nfunction __exportStillFrame() { writes(); return {ok:false,error:"stopped after dispatch",notes:[]}; }\n${script}`, context)));
  });
  return writes;
}
describe("explicit replacement of host-written outputs", () => {
  it.each(cases)("%s refuses an existing output before the host write", async (_name, tool, args) => {
    const writes = fakeHost();
    await expect(tool.handler(args as never)).resolves.toMatchObject({ success: false, error: expect.stringContaining("Output already exists") });
    expect(writes).not.toHaveBeenCalled();
  });
  it.each(cases)("%s dispatches replacement only after overwrite true", async (_name, tool, args) => {
    const writes = fakeHost();
    await tool.handler({ ...args, overwrite: true } as never);
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it("checks the implied .png destination before a freeze-frame export", async () => {
    const writes = fakeHost();
    await expect(cases[2][1].handler({ output_path: "/outputs/still" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Output already exists") });
    expect(writes).not.toHaveBeenCalled();
  });
});
