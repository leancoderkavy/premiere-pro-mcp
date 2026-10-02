import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { buildScript, getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { capabilitiesForToolInvocation } from "../../src/security/capabilities.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/qe-undo", timeoutMs: 5000 };
const project = getProjectTools(bridgeOptions);
const targeting = getTrackTargetingTools(bridgeOptions);

beforeEach(() => vi.clearAllMocks());

it("refuses undo and redo without a current stack index", async () => {
  await expect(project.undo.handler({})).resolves.toMatchObject({ success: false, error: expect.stringContaining("required") });
  await expect(targeting.redo.handler({})).resolves.toMatchObject({ success: false, error: expect.stringContaining("required") });
  await expect(targeting.multiple_undo.handler({ count: 2 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("required") });
  expect(mockedSendCommand).not.toHaveBeenCalled();
});

function run(context: Record<string, unknown>) {
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
}

/** Live 25.2: undo()/redo() return true and move undoStackIndex() by one; at the ends nothing moves. */
function undoHost(index: number, top: number, extra: Record<string, unknown> = {}) {
  const stack = {
    index,
    undoStackIndex: () => stack.index,
    undo: () => { if (stack.index > 0) stack.index -= 1; return true; },
    redo: () => { if (stack.index < top) stack.index += 1; return true; },
    ...extra,
  };
  run({ app: { enableQE: () => {} }, qe: { project: stack } });
  return stack;
}

describe("undo, redo and multiple_undo step QE's undo stack and check its position", () => {
  it("undoes one action and reports the stack indices (live: 367 -> 366)", async () => {
    const stack = undoHost(367, 367);
    const result = await project.undo.handler({ expected_undo_stack_index: 367 });
    expect(result).toMatchObject({
      success: true,
      data: { undone: 1, undoStackIndexBefore: 367, undoStackIndexAfter: 366, stackStatus: "stack_verified", stackVerified: true },
    });
    // Only the stack position is checked, so the result does not claim a verified timeline.
    expect((result as { data: Record<string, unknown> }).data.verified).toBeUndefined();
    expect(stack.index).toBe(366);
  });

  it("redoes one action", async () => {
    undoHost(366, 367);
    await expect(targeting.redo.handler({ expected_undo_stack_index: 366 })).resolves.toMatchObject({
      success: true,
      data: { redone: 1, undoStackIndexAfter: 367, stackVerified: true },
    });
  });

  it("multiple_undo that runs out part way reports the committed steps as committed_unverified, not a plain failure", async () => {
    undoHost(2, 5);
    await expect(targeting.multiple_undo.handler({ count: 3, expected_undo_stack_index: 2 })).resolves.toMatchObject({
      success: true,
      data: {
        undone: 2, undoStackIndexAfter: 0, stackStatus: "did_not_move", outcome: "committed_unverified", stackVerified: false,
        warning: expect.stringMatching(/Only 2 of 3 undo steps.*Do not retry/),
      },
    });
  });

  it("reports nothing to redo when the stack is already at the top", async () => {
    undoHost(5, 5);
    await expect(targeting.redo.handler({ expected_undo_stack_index: 5 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Nothing to redo"),
      data: { stackStatus: "did_not_move", redone: 0 },
    });
  });

  it("does not undo at all on a host without undoStackIndex", async () => {
    const undo = vi.fn();
    run({ app: { enableQE: () => {} }, qe: { project: { undo } } });
    await expect(project.undo.handler({ count: 2, expected_undo_stack_index: 0 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("undoStackIndex"),
    });
    expect(undo).not.toHaveBeenCalled();
  });
});

describe("an undo that moves the stack unexpectedly is never reported as nothing happening", () => {
  it("a jump of two (10 -> 8) is committed_unverified and says not to retry", async () => {
    const stack = undoHost(10, 10, { undo: () => { stack.index -= 2; return true; } });
    const result = await project.undo.handler({ expected_undo_stack_index: 10 });
    expect(result).toMatchObject({
      success: true,
      data: { outcome: "committed_unverified", stackStatus: "moved_unexpectedly", stackVerified: false, undone: 0, undoStackIndexAfter: 8, warning: expect.stringContaining("Do not retry") },
    });
    expect(JSON.stringify(result)).not.toContain("Nothing to undo");
  });

  it("a move the wrong way is committed_unverified", async () => {
    const stack = undoHost(10, 20, { undo: () => { stack.index += 1; return true; } });
    await expect(targeting.multiple_undo.handler({ count: 2, expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: true,
      data: { outcome: "committed_unverified", stackStatus: "moved_unexpectedly", undoStackIndexAfter: 11 },
    });
  });

  it("an index that cannot be read after the step is committed_unverified", async () => {
    let reads = 0;
    const stack = undoHost(10, 10, {
      undoStackIndex: () => { reads += 1; if (reads > 2) throw new Error("gone"); return stack.index; }, // SEC FORK: guard consumes read 1
    });
    await expect(project.undo.handler({ expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: true,
      data: { outcome: "committed_unverified", stackStatus: "index_unreadable", stackVerified: false },
    });
  });

  it("a step Premiere rejects after earlier steps is committed_unverified with the count that ran", async () => {
    let calls = 0;
    const stack = undoHost(10, 10, { undo: () => { calls += 1; if (calls === 2) throw new Error("busy"); stack.index -= 1; return true; } });
    await expect(targeting.multiple_undo.handler({ count: 3, expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: true,
      data: { stackStatus: "rejected", undone: 1, undoStackIndexAfter: 9, outcome: "committed_unverified", warning: expect.stringContaining("Do not retry") },
    });
  });

  it("a step that undoes and then throws is reported as an unexpected move, not a rejection", async () => {
    let calls = 0;
    const stack = undoHost(10, 10, { undo: () => { calls += 1; stack.index -= 1; if (calls === 2) throw new Error("busy"); return true; } });
    await expect(targeting.multiple_undo.handler({ count: 3, expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: true,
      data: { stackStatus: "moved_unexpectedly", undone: 1, undoStackIndexAfter: 8, outcome: "committed_unverified", warning: expect.stringContaining("Do not retry") },
    });
  });

  it("a step that throws with an unreadable index afterwards is index_unreadable", async () => {
    let broken = false;
    const stack = undoHost(10, 10, {
      undoStackIndex: () => { if (broken) throw new Error("gone"); return stack.index; },
      undo: () => { broken = true; throw new Error("busy"); },
    });
    await expect(project.undo.handler({ expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: true,
      data: { stackStatus: "index_unreadable", outcome: "committed_unverified" },
    });
  });

  it("a first step Premiere rejects without moving the stack is a plain failure", async () => {
    undoHost(10, 10, { undo: () => { throw new Error("busy"); } });
    await expect(project.undo.handler({ expected_undo_stack_index: 10 })).resolves.toMatchObject({
      success: false,
      data: { stackStatus: "rejected", undone: 0 },
    });
  });
});

describe("results report the undo steps a command added", () => {
  // The server builds scripts inside runWithUndoTracking(<call needs edit>, ...).
  const exec = (code: string, qeProject: Record<string, unknown>, mutating = true) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${runWithUndoTracking(mutating, () => buildScript(code))}`, { app: { enableQE: () => {} }, qe: { project: qeProject } })));

  it("tags an edit that pushed undo entries (live: razor_all_tracks pushed 8)", () => {
    const stack = { index: 401, undoStackIndex: () => stack.index };
    const bump = () => { stack.index += 8; };
    expect(exec("qe.project.bump(); return __result({ cut: true });", Object.assign(stack, { bump }))).toEqual({
      success: true,
      data: { cut: true, undoSteps: 8, undoStackIndex: 409 },
    });
  });

  it("tags a failure that came after undo entries were recorded", () => {
    const stack = { index: 401, undoStackIndex: () => stack.index };
    const bump = () => { stack.index += 2; };
    expect(exec("qe.project.bump(); return __error(\"second write failed; nothing was changed.\");", Object.assign(stack, { bump }))).toEqual({
      success: false,
      error: "second write failed; nothing was changed. Premiere recorded 2 undo entries during this command, so the project may have changed.",
      data: { undoSteps: 2, undoStackIndex: 403, timelineChanged: true },
    });
    expect(exec("return __error(\"refused\");", { undoStackIndex: () => 5 })).toEqual({ success: false, error: "refused" });
  });

  it("leaves results alone when nothing was recorded (live: set_clip_opacity) or QE is absent", () => {
    const stack = { undoStackIndex: () => 409 };
    expect(exec("return __result({ opacity: 50 });", stack)).toEqual({ success: true, data: { opacity: 50 } });
    expect(JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${runWithUndoTracking(true, () => buildScript("return __result({ a: 1 });"))}`, {})))).toEqual({ success: true, data: { a: 1 } });
  });

  it("read-only tools never read the undo stack, even in an engine a mutating command used before", () => {
    const stack = { index: 401, undoStackIndex: vi.fn(() => stack.index) };
    const context = { app: { enableQE: vi.fn() }, qe: { project: stack } };
    const runIn = (code: string, mutating: boolean) =>
      JSON.parse(String(runInNewContext(`${runWithUndoTracking(mutating, () => buildScript(code))}`, context)));
    runInNewContext(getHelpersSource(), context);
    expect(runIn("qe.project.index += 2; return __result({ cut: true });", true)).toMatchObject({ data: { undoSteps: 2 } });
    stack.undoStackIndex.mockClear();
    context.app.enableQE.mockClear();
    expect(runIn("return __result({ clips: 3 });", false)).toEqual({ success: true, data: { clips: 3 } });
    expect(stack.undoStackIndex).not.toHaveBeenCalled();
    expect(context.app.enableQE).not.toHaveBeenCalled();
  });

  it("scripts built outside a tool call do not track undo", () => {
    expect(buildScript("return 1;")).toContain("__undoStart = null;");
    expect(runWithUndoTracking(true, () => buildScript("return 1;"))).toContain("__readUndoIndex()");
  });

  it("tracks every call that needs more than inspect, including imports; inspect-only tools are not tracked", () => {
    const tracked = (name: string) => capabilitiesForToolInvocation(name, {}).some((capability) => capability !== "inspect");
    for (const name of ["ping", "has_proxy", "is_work_area_enabled", "verify_premiere_connection", "match_frame", "get_active_sequence"]) {
      expect(tracked(name), name).toBe(false);
    }
    for (const name of ["trim_clip", "import_mogrt", "import_media", "relink_media", "consolidate_duplicates", "apply_lut"]) {
      expect(tracked(name), name).toBe(true);
    }
  });

  it("undo refuses, without undoing, when the stack position differs from the guard", async () => {
    const stack = undoHost(368, 368);
    await expect(targeting.multiple_undo.handler({ count: 8, expected_undo_stack_index: 367 })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("the undo-stack position changed since that call"),
      data: { undoStackIndex: 368, expectedUndoStackIndex: 367 },
    });
    expect(stack.index).toBe(368);
    await expect(project.undo.handler({ expected_undo_stack_index: 368 })).resolves.toMatchObject({ success: true, data: { undone: 1 } });
  });

  it("describes the guard as a position check that can match again after new edits", () => {
    for (const tool of [project.undo, targeting.multiple_undo]) {
      const guard = (tool.parameters as { properties: Record<string, { description: string }> }).properties.expected_undo_stack_index;
      expect(guard.description).toContain("compares the position only");
    }
  });
});
