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
  sent.mockImplementation(async script => {
    const source = getHelpersSource() + "\n" + script;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(source, { app: { project: { rootItem: root, sequences: { numSequences: 0 } } } })));
  });
  return { bin, removed };
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
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified" } });
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "delete_multiple_project_items").outcome).toBe("committed_unverified");
  });
});
