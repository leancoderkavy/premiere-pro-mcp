import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTextTools } from "../../src/tools/text.js";
const bridge = { tempDir: "/tmp/host-limits", timeoutMs: 1000 };
const command = vi.mocked(sendCommand);
function host(project: object, undoStack?: { index: number }) {
  command.mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project, enableQE: () => {} },
    qe: { project: { undoStackIndex: () => undoStack?.index ?? 0 } },
    Time: function () { this.seconds = 0; this.ticks = "0"; },
  }))));
}
beforeEach(() => { command.mockReset(); });
describe("#641 host acceptance is not independent verification", () => {
  it("qualifies a setter no-op as an unverified request", async () => {
    const setter = vi.fn(() => undefined);
    host({ setEnableTranscodeOnIngest: setter });
    const result = await getProjectTools(bridge).set_transcode_on_ingest.handler({ enabled: true });
    expect(setter).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ success: true, data: { requestedEnabled: true, outcome: "requested_unverified", verified: false } });
    expect(result.data).not.toHaveProperty("set");
    expect(result.data).not.toHaveProperty("transcodeOnIngest");
  });
  it("refuses missing ingest setter before mutation", async () => {
    host({});
    expect(await getProjectTools(bridge).set_transcode_on_ingest.handler({ enabled: false })).toMatchObject({ success: false, error: expect.stringContaining("no change was attempted") });
  });
  it("preserves possible ingest mutation when setter throws", async () => {
    const setter = vi.fn(() => { throw new Error("host failed after write"); });
    host({ setEnableTranscodeOnIngest: setter });
    expect(await getProjectTools(bridge).set_transcode_on_ingest.handler({ enabled: false })).toMatchObject({ success: false, data: { mutationAttempted: true, verified: false, outcome: "failed", mutationOutcome: "unknown" } });
    expect(setter).toHaveBeenCalledTimes(1);
  });
  it("reports tab closure as unverified when close silently does nothing", async () => {
    const close = vi.fn();
    const seq = { name: "Sequence", sequenceID: "seq", close };
    host({ activeSequence: seq, sequences: { numSequences: 1, 0: seq } });
    expect(await getAdvancedTools(bridge).close_sequence.handler({})).toMatchObject({ success: true, data: { timelineTabCloseRequested: true, outcome: "requested_unverified", verified: false, sequenceRetainedInProject: true } });
    expect(close).toHaveBeenCalledOnce();
  });
  it("retains the close request when project retention cannot be read", async () => {
    host({ activeSequence: { name: "Sequence", sequenceID: "seq", close: () => {} } });
    expect(await getAdvancedTools(bridge).close_sequence.handler({})).toMatchObject({ success: true, data: { timelineTabCloseRequested: true, sequenceRetainedInProject: null, verified: false } });
  });
  it("refuses a missing close method without claiming an attempted mutation", async () => {
    host({ activeSequence: { name: "Sequence", sequenceID: "seq" } });
    expect(await getAdvancedTools(bridge).close_sequence.handler({})).toMatchObject({ success: false, error: expect.stringContaining("no tab-close request"), data: { mutationAttempted: false, outcome: "failed" } });
  });
  it("preserves possible tab closure after a native throw", async () => {
    const close = vi.fn(() => { throw new Error("tab error"); });
    host({ activeSequence: { name: "Sequence", sequenceID: "seq", close } });
    expect(await getAdvancedTools(bridge).close_sequence.handler({})).toMatchObject({ success: false, error: expect.stringContaining("tab error"), data: { mutationAttempted: true, outcome: "failed", mutationOutcome: "unknown", verified: false } });
    expect(close).toHaveBeenCalledOnce();
  });
  it("does not promote a truthy library result into verified import", async () => {
    host({ activeSequence: { importMGTFromLibrary: () => true } });
    const result = await getTextTools(bridge).import_mogrt_from_library.handler({ library_name: 'Library \"A\"', mogrt_name: "Lower Third" });
    expect(result).toMatchObject({ success: true, data: { hostAccepted: true, outcome: "committed_unverified", verified: false, renderVerified: false } });
    expect(result.data).not.toHaveProperty("imported");
  });
  it("refuses a missing library API before attempting an import", async () => {
    host({ activeSequence: {} });
    expect(await getTextTools(bridge).import_mogrt_from_library.handler({ library_name: "Brand", mogrt_name: "Title" })).toMatchObject({ success: false, error: expect.stringContaining("no import was attempted") });
  });
  it("names library failure causes without claiming no mutation", async () => {
    host({ activeSequence: { importMGTFromLibrary: () => false } });
    expect(await getTextTools(bridge).import_mogrt_from_library.handler({ library_name: "Brand", mogrt_name: "Title" })).toMatchObject({ success: false, error: expect.stringContaining("Creative Cloud sign-in"), data: { mutationAttempted: true, verified: false } });
  });
  it.each(["throw", "falsy"])("preserves import Undo evidence after %s host failure", async (failure) => {
    const stack = { index: 7 };
    host({ activeSequence: { importMGTFromLibrary: () => { stack.index++; if (failure === "throw") throw new Error("after insertion"); return false; } } }, stack);
    const result = await runWithUndoTracking(true, () => getTextTools(bridge).import_mogrt_from_library.handler({ library_name: "Brand", mogrt_name: "Title" }));
    expect(result).toMatchObject({ success: false, data: { outcome: "failed", mutationOutcome: "unknown", mutationAttempted: true, undoSteps: 1, undoStackIndex: 8, timelineChanged: true } });
  });
  it("preserves Premiere's native library error without retrying", async () => {
    const importer = vi.fn(() => { throw new Error("Adobe native failure"); });
    host({ activeSequence: { importMGTFromLibrary: importer } });
    expect(await getTextTools(bridge).import_mogrt_from_library.handler({ library_name: "Brand", mogrt_name: "Title" })).toMatchObject({ success: false, error: expect.stringContaining("Adobe native failure"), data: { outcome: "failed", mutationOutcome: "unknown", mutationAttempted: true } });
    expect(importer).toHaveBeenCalledOnce();
  });
});
