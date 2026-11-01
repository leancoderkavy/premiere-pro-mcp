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
const namedScope = "Each requested composition was read back as a new bin item from this .aep (by name and media path); rendered content is not verified.";

function setup(before: unknown, after: unknown, throwsAt?: "before" | "after") {
  let imported = false;
  // Indexable children let the named path read each new comp back by name and source .aep.
  const children: Record<string | number, unknown> = { get numItems() {
    if (throwsAt === (imported ? "after" : "before")) throw new Error("count unreadable");
    return imported ? after : before;
  } };
  const counted = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
  if (counted(before)) for (let i = 0; i < before; i++) children[i] = { nodeId: `old-${i}`, name: `Existing ${i}`, getMediaPath: () => "/media/existing.mp4" };
  const root = { children };
  const importComps = vi.fn((path: string, names?: unknown) => {
    imported = true;
    const added = Array.isArray(names) ? names as string[] : ["Comp 1"];
    if (counted(before) && counted(after)) for (let i = before; i < after; i++) children[i] = { nodeId: `new-${i}`, name: `${added[(i - before) % added.length]}/title.aep`, getMediaPath: () => path };
  });
  const host = { rootItem: root, importAEComps: importComps, importAllAEComps: importComps };
  function FakeFile(this: { exists: boolean; fsName: string }, path: string) { this.exists = true; this.fsName = path; }
  send.mockImplementation(async script => JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, { app: { project: host }, File: FakeFile })));
  return importComps;
}

beforeEach(() => vi.clearAllMocks());

for (const mode of ["all", "named"] as const) {
  const args = { ae_project_path: '/tmp/title"\\\n.aep', ...(mode === "named" ? { comp_names: ['Lower"\\\nThird'] } : {}) };
  describe(`${mode} composition import count readback`, () => {
    // Named imports verify each requested comp by name and source; all-comps imports verify the count only.
    const expectedScope = mode === "named" ? namedScope : scope;
    it(mode === "named" ? "verifies each requested composition by name and source after an observed increase" : "reports only the target-bin count evidence after an observed increase", async () => {
      const imported = setup(2, 3);
      const result = await tools.import_ae_comps.handler(args);
      expect(imported).toHaveBeenCalledTimes(1);
      expect(mutationReceipt(result.success, result.data, { dispatched: true }, "import_ae_comps")).toMatchObject({ outcome: "verified", verification: { boundary: expectedScope } });
      expect(result).toMatchObject({ success: true, data: { verified: true, addedItems: 1, binItemsBefore: 2, binItemsAfter: 3, verificationScope: expectedScope } });
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
