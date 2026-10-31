import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getProjectTools } from "../../src/tools/project.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

const send = vi.mocked(sendCommand);
const tools = getProjectTools({ tempDir: "/tmp/tests", timeoutMs: 1000 });
const invalidCounts = [undefined, null, NaN, Infinity, -1, 0.5, "2"];
const scope = "Target-bin item-count increase only; composition identity and rendered content are not verified.";

function setup(before: unknown, after: unknown, throwsAt?: "before" | "after") {
  let imported = false;
  const root = { children: { get numItems() {
    if (throwsAt === (imported ? "after" : "before")) throw new Error("count unreadable");
    return imported ? after : before;
  } } };
  const importComps = vi.fn(() => { imported = true; });
  const host = { rootItem: root, importAEComps: importComps, importAllAEComps: importComps };
  function FakeFile(this: { exists: boolean }, _path: string) { this.exists = true; }
  send.mockImplementation(async script => JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, { app: { project: host }, File: FakeFile })));
  return importComps;
}

beforeEach(() => vi.clearAllMocks());

for (const mode of ["all", "named"] as const) {
  const args = { ae_project_path: '/tmp/title"\\\n.aep', ...(mode === "named" ? { comp_names: ['Lower"\\\nThird'] } : {}) };
  describe(`${mode} composition import count readback`, () => {
    it("reports only the target-bin count evidence after an observed increase", async () => {
      const imported = setup(2, 3);
      const result = await tools.import_ae_comps.handler(args);
      expect(imported).toHaveBeenCalledTimes(1);
      expect(mutationReceipt(result.success, result.data, { dispatched: true }, "import_ae_comps")).toMatchObject({ outcome: "verified", verification: { boundary: scope } });
      expect(result).toMatchObject({ success: true, data: { verified: true, addedItems: 1, binItemsBefore: 2, binItemsAfter: 3, verificationScope: scope } });
      if (mode === "named") expect(imported).toHaveBeenCalledWith(args.ae_project_path, args.comp_names, expect.anything());
      else expect(imported).toHaveBeenCalledWith(args.ae_project_path, expect.anything());
    });
    it.each(invalidCounts)("refuses an unreadable baseline count %s before import", async count => {
      const imported = setup(count, 3);
      const result = await tools.import_ae_comps.handler(args);
      expect(imported).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, data: { verified: false, mutationOutcome: "not_applied" } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("not_applied");
    });
    it.each(invalidCounts)("keeps an unreadable post-import count %s unverified", async count => {
      const imported = setup(2, count);
      const result = await tools.import_ae_comps.handler(args);
      expect(imported).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", binItemsBefore: 2, binItemsAfter: null } });
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).toBe("committed_unverified");
    });
    it("refuses a throwing baseline count before import", async () => {
      const imported = setup(2, 3, "before");
      expect(await tools.import_ae_comps.handler(args)).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
      expect(imported).not.toHaveBeenCalled();
    });
    it("keeps a throwing post-import count unverified", async () => {
      const imported = setup(2, 3, "after");
      expect(await tools.import_ae_comps.handler(args)).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
      expect(imported).toHaveBeenCalledTimes(1);
    });
    it("does not verify a host import return without a count increase", async () => {
      setup(2, 2);
      const result = await tools.import_ae_comps.handler(args);
      expect(result.success).toBe(false);
      expect(mutationReceipt(result.success, result.data, { dispatched: true }).outcome).not.toBe("verified");
    });
  });
}
