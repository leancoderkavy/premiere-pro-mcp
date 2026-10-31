import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { refusalHost, type RefusalHostOptions } from "../helpers/refusal-host.js";

const tools = { ...getProjectTools({}), ...getTrackTargetingTools({}) };
const path = '/fixture/new "quoted" \\ Unicode-é\nproject.prproj';
function setup(options: RefusalHostOptions = {}) {
  const host = refusalHost(options);
  vi.mocked(sendCommand).mockImplementation(async script => host.run(script));
  return host;
}
beforeEach(() => { vi.mocked(sendCommand).mockReset(); });

describe("pre-undo guard refusals", () => {
  for (const name of ["undo", "multiple_undo", "redo"] as const) {
    it(name + " reports a stale stack guard as not applied", async () => {
      const host = setup();
      const result = await tools[name].handler({ count: 1, expected_undo_stack_index: 0 });
      expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false, undoStackIndex: 91 } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("not_applied");
      expect(host.undoCalls + host.redoCalls).toBe(0);
    });
    it(name + " reports an unreadable guard as not applied", async () => {
      const host = setup({ unreadableIndex: true });
      const result = await tools[name].handler({ count: 1, expected_undo_stack_index: 91 });
      expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
      expect(host.undoCalls + host.redoCalls).toBe(0);
    });
    it(name + " still steps a matching stack guard", async () => {
      const host = setup();
      const result = await tools[name].handler({ count: 1, expected_undo_stack_index: 91 });
      expect(result).toMatchObject({ success: true, data: { stackVerified: true } });
      expect(host.undoCalls + host.redoCalls).toBe(1);
    });
    it(name + " never reports a post-step unreadable stack as not applied", async () => {
      const host = setup({ unreadableAfterStep: true });
      const result = await tools[name].handler({ count: 1, expected_undo_stack_index: 91 });
      expect(result).toMatchObject({ success: true, data: { stackVerified: false, outcome: "committed_unverified" } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("committed_unverified");
      expect(host.undoCalls + host.redoCalls).toBe(1);
    });
  }
});

describe("new-project directory preflight", () => {
  for (const folderExists of [false, undefined, null, "true"]) {
    it("refuses missing or unreadable directory state " + String(folderExists) + " before creation", async () => {
      const host = setup({ folderExists });
      const result = await tools.create_project.handler({ path });
      expect(result).toMatchObject({ success: false, error: expect.stringContaining(path), data: { mutationOutcome: "not_applied", timelineChanged: false } });
      expect(host.newProjectCalls).toBe(0);
      expect(host.app.project.path).toBe("/fixture/original.prproj");
    });
  }
  it("refuses a throwing directory lookup before creation", async () => {
    const host = setup({ folderThrows: true });
    expect(await tools.create_project.handler({ path })).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(host.newProjectCalls).toBe(0);
  });
  it("creates a project with escaped path characters when its directory exists", async () => {
    const host = setup();
    expect(await tools.create_project.handler({ path })).toMatchObject({ success: true, data: { created: true, path } });
    expect(host.app.project.path).toBe(path);
    expect(host.newProjectCalls).toBe(1);
  });
  for (const newProject of ["ignore", "throw", "change_then_throw"] as const) {
    it("keeps uncertainty after the host creation call " + newProject, async () => {
      const host = setup({ newProject });
      const result = await tools.create_project.handler({ path });
      expect(result.success).toBe(false);
      expect(host.newProjectCalls).toBe(1);
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("unknown");
    });
  }
});
