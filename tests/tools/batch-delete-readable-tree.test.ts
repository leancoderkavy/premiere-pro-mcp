import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
const sent = vi.mocked(sendCommand);
const tool = getUtilityTools({ tempDir: "/tmp/delete-readback", timeoutMs: 1000 }).delete_multiple_project_items;
function collection(items: unknown[]) { return Object.assign({ numItems: items.length }, items); }
function host(after: () => unknown) {
  const root: any = { nodeId: "root", name: "Root", type: 3, children: collection([]) };
  const removed = vi.fn(() => { root.children = after(); });
  const bin = { nodeId: 'bin"\\id', name: "Temporary", type: 2, children: collection([]), deleteBin: removed };
  root.children = collection([bin]);
  const project = { documentID: "document-a", rootItem: root, sequences: { numSequences: 0 } };
  sent.mockImplementation(async script => {
    const source = getHelpersSource() + "\n" + script;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(source, { app: { project } })));
  });
  return { bin, removed, root, project };
}
beforeEach(() => vi.clearAllMocks());

describe("batch project deletion final tree readback", () => {
  it("verifies absent targets only after walking readable nested bins", async () => {
    host(() => collection([{ nodeId: "folder", type: 2, children: collection([{ nodeId: "clip", type: 1 }]) }]));
    const result = await tool.handler({ item_ids: ['bin"\\id'] });
    expect(result).toMatchObject({ success: true, data: { deleted: 1, verified: true } });
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "delete_multiple_project_items").outcome).toBe("verified");
  });
  const cases: Array<[string, () => unknown]> = [
    ["missing children", () => undefined],
    ["undefined count", () => ({ numItems: undefined })],
    ["NaN count", () => ({ numItems: NaN })],
    ["negative count", () => ({ numItems: -1 })],
    ["fractional count", () => ({ numItems: 0.5 })],
    ["infinite count", () => ({ numItems: Infinity })],
    ["string count", () => ({ numItems: "0" })],
    ["throwing count", () => ({ get numItems() { throw new Error("unreadable"); } })],
    ["missing child", () => ({ numItems: 1 })],
    ["throwing child", () => ({ numItems: 1, get 0() { throw new Error("unreadable"); } })],
    ["missing ID", () => collection([{ type: 1 }])],
    ["empty ID", () => collection([{ nodeId: "", type: 1 }])],
    ["throwing ID", () => collection([{ get nodeId() { throw new Error("unreadable"); }, type: 1 }])],
    ["unreadable type", () => collection([{ nodeId: "clip" }])],
    ["nested unreadable bin", () => collection([{ nodeId: "nested", type: 2, children: { numItems: undefined } }])],
    ["duplicate IDs", () => collection([{ nodeId: "same", type: 1 }, { nodeId: "same", type: 1 }])],
    ["oversized tree", () => ({ numItems: 100001 })],
  ];
  it.each(cases)("does not interpret %s as target absence", async (_label, after) => {
    const { removed } = host(after);
    const result = await tool.handler({ item_ids: ['bin"\\id'] });
    expect(removed).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", mutationOutcome: "committed_unverified", deleted: 0, items: [] } });
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "delete_multiple_project_items").outcome).toBe("committed_unverified");
  });
});

describe("batch deletion lookup and aggregate evidence", () => {
  it("refuses an unreadable tree before the first deletion", async () => {
    const { root, removed } = host(() => collection([]));
    const execute = sent.getMockImplementation()!;
    let calls = 0;
    sent.mockImplementation(async (...args) => {
      if (++calls === 2) root.children = undefined;
      return execute(...args);
    });
    const result = await tool.handler({ item_ids: ['bin"\\id'] });
    expect(removed).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", deleted: 0, projectChanged: false } });
  });

  it("preserves explicit final-readback evidence through aggregation", async () => {
    host(() => collection([]));
    const execute = sent.getMockImplementation()!;
    let calls = 0;
    sent.mockImplementation(async (...args) => ++calls === 1 ? execute(...args) : ({
      success: false,
      data: { outcome: "committed_unverified", verified: false, items: [] },
    }));
    const result = await tool.handler({ item_ids: ['bin"\\id'] });
    expect(mutationReceipt(false, result.data, { dispatched: true }).outcome).toBe("committed_unverified");
  });

  it("retains unknown when a mutation throws before returning", async () => {
    const { bin } = host(() => collection([]));
    bin.deleteBin = vi.fn(() => { throw new Error("Host disconnected"); });
    const result = await tool.handler({ item_ids: ['bin"\\id'] });
    expect(result.success).toBe(false);
    expect(mutationReceipt(false, result.data, { dispatched: true }).outcome).toBe("unknown");
  });
});


describe("chunk safety revalidation", () => {
  it("refuses a switched project even when all targets are absent", async () => {
    const h = host(() => collection([]));
    const execute = sent.getMockImplementation()!;
    let calls = 0;
    sent.mockImplementation(async (...args) => {
      if (++calls === 2) { h.project.documentID = "document-b"; h.root.children = collection([]); }
      return execute(...args);
    });
    const result = await tool.handler({ item_ids: [h.bin.nodeId] });
    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ deleted: 0, mutationOutcome: "not_applied" });
    expect(h.removed).not.toHaveBeenCalled();
  });
  it("escapes ES3 line separators in project names", async () => {
    const h = host(() => collection([]));
    h.bin.name = "name\u2028line\u2029end";
    expect((await tool.handler({ item_ids: [h.bin.nodeId] })).success).toBe(true);
  });
  it("refuses newly offline media before deleting any chunk target", async () => {
    const h = host(() => collection([]));
    const execute = sent.getMockImplementation()!;
    let calls = 0;
    sent.mockImplementation(async (...args) => {
      if (++calls === 2) h.bin.children = collection([{ nodeId: "offline", name: "Offline", type: 1, isOffline: () => true }]);
      return execute(...args);
    });
    const result = await tool.handler({ item_ids: [h.bin.nodeId] });
    expect(result.success).toBe(false);
    expect(h.removed).not.toHaveBeenCalled();
  });
});
