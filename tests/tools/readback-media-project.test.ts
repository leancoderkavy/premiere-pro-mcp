import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getProjectTools } from "../../src/tools/project.js";

const send = vi.mocked(sendCommand);
const options = { tempDir: "/tmp/tests", timeoutMs: 1000 };
const media = getMediaTools(options);
const project = getProjectTools(options);
// A double quote exercises escaping but is not a legal Windows filename character.
const folder = mkdtempSync(join(tmpdir(), process.platform === "win32" ? "readback-folder-" : 'readback-"folder-'));
afterAll(() => rmSync(folder, { recursive: true }));
beforeEach(() => vi.clearAllMocks());
function children(items: any[]) { return Object.assign(items, { numItems: items.length }); }
function execute(host: any, extra = {}) {
  send.mockImplementation(async (script) => JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, { app: { project: host }, ...extra })));
}

function FakeFile(this: any, path: string) { this.fsName = path; this.name = path.split("/").pop(); this.exists = true; }
function FakeFolder(this: any, path: string) {
  this.exists = true;
  this.getFiles = () => [new (FakeFile as any)(`${path}/clip.mov`)];
}

describe("media and project mutation receipts", () => {
  it("verifies a detached proxy through hasProxy", async () => {
    let attached = true;
    const item = { nodeId: "item", name: 'quoted"\\\nitem', detachProxy() { attached = false; }, hasProxy() { return attached; } };
    execute({ rootItem: { children: children([item]) } });
    const result = await media.detach_proxy.handler({ item_id: item.name });
    expect(result).toMatchObject({ success: true, data: { detached: true, verified: true, hasProxy: false, outcome: "verified" } });
  });
  it("refuses an ignored proxy detach", async () => {
    execute({ rootItem: { children: children([{ nodeId: "item", name: "item", detachProxy() {}, hasProxy() { return 1; } }]) } });
    expect(await media.detach_proxy.handler({ item_id: "item" })).toMatchObject({ success: false, data: { outcome: "failed", detached: false } });
  });
  it("keeps unreadable proxy state unverified", async () => {
    execute({ rootItem: { children: children([{ nodeId: "item", name: "item", detachProxy() {}, hasProxy() { throw new Error("unreadable"); } }]) } });
    expect(await media.detach_proxy.handler({ item_id: "item" })).toMatchObject({ success: true, data: { detached: null, verified: false, outcome: "committed_unverified" } });
  });
  it("rejects empty proxy identity before sending", async () => {
    expect(await media.detach_proxy.handler({ item_id: " " })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("checks smart-bin identity while keeping its unreadable query unverified and escaped", async () => {
    const name = 'Search"\\\nname', query = 'name="source"\\\n';
    const root = { children: children([]), createSmartBin(receivedName: string, receivedQuery: string) {
      expect(receivedName).toBe(name); expect(receivedQuery).toBe(query);
      this.children = children([{ nodeId: "new", name: receivedName }]);
    } };
    execute({ rootItem: root });
    expect(await project.create_smart_bin.handler({ name, query })).toMatchObject({ success: true, data: { created: true, identityVerified: true, verified: false, outcome: "committed_unverified", nodeId: "new", name, query } });
  });
  it("refuses smart-bin creation when host keeps the old tree", async () => {
    execute({ rootItem: { children: children([{ nodeId: "old", name: "Search" }]), createSmartBin() {} } });
    expect(await project.create_smart_bin.handler({ name: "Search", query: "source" })).toMatchObject({ success: false, data: { outcome: "failed" } });
  });
  it("does not infer smart-bin creation when identity getters are absent", async () => {
    execute({ rootItem: { createSmartBin() {} } });
    expect(await project.create_smart_bin.handler({ name: "Search", query: "source" })).toMatchObject({ success: true, data: { created: null, identityVerified: false, outcome: "committed_unverified" } });
  });
  it("rejects invalid smart-bin query before sending", async () => {
    expect(await project.create_smart_bin.handler({ name: "Search", query: " " })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts newly imported matching files from a nested destination tree", async () => {
    const root = { nodeId: "root", name: "Root", children: children([]) };
    execute({ rootItem: root, importFiles(paths: string[]) {
      expect(paths).toEqual([`${folder}/clip.mov`]);
      root.children = children([{ nodeId: "bin", name: "Nested", type: 2, children: children([{ nodeId: "new", name: "Clip", getMediaPath: () => paths[0] }]) }]);
      return true;
    } }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder })).toMatchObject({ success: true, data: { imported: 1, requestedCount: 1, observedNewItemCount: 2, verified: true, outcome: "verified", folder } });
  });
  it("rejects an import return value when no items were added", async () => {
    execute({ rootItem: { name: "Root", children: children([]) }, importFiles: () => true }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder })).toMatchObject({ success: false, data: { imported: 0, requestedCount: 1, outcome: "failed" } });
  });
  it("keeps unmatched added items unverified instead of claiming the requested file count", async () => {
    const root = { name: "Root", children: children([]) };
    execute({ rootItem: root, importFiles() { root.children = children([{ nodeId: "new", name: "Sequence" }]); return true; } }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder })).toMatchObject({ success: true, data: { imported: 0, observedNewItemCount: 1, verified: false, outcome: "committed_unverified" } });
  });
  it("reports unknown import counts when the destination cannot be read", async () => {
    execute({ rootItem: { name: "Root" }, importFiles: () => true }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder })).toMatchObject({ success: true, data: { imported: null, observedNewItemCount: null, verified: false, outcome: "committed_unverified" } });
  });
  it("rejects invalid folder input before sending", async () => {
    expect(await media.import_folder.handler({ folder_path: " " })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not count an existing same-path item as a newly imported file", async () => {
    execute({ rootItem: { name: "Root", children: children([{ nodeId: "old", name: "Clip", getMediaPath: () => `${folder}/clip.mov` }]) }, importFiles: () => true }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder })).toMatchObject({ success: false, data: { imported: 0, outcome: "failed" } });
  });
  it("rejects an invalid optional destination before sending", async () => {
    expect(await media.import_folder.handler({ folder_path: folder, target_bin: " " })).toMatchObject({ success: false });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not call a new smart bin with the wrong name verified", async () => {
    const root = { children: children([]), createSmartBin() { this.children = children([{ nodeId: "new", name: "Wrong" }]); } };
    execute({ rootItem: root });
    expect(await project.create_smart_bin.handler({ name: "Search", query: "source" })).toMatchObject({ success: false, data: { outcome: "failed" } });
  });
  it("escapes destination names while finding the correct bin", async () => {
    const name = 'Bin"\\\n';
    const bin = { nodeId: "bin", name, type: 2, children: children([]) };
    execute({ rootItem: { children: children([bin]) }, importFiles(paths: string[], _ui: boolean, receivedBin: any) {
      expect(receivedBin).toBe(bin);
      bin.children = children([{ nodeId: "new", name: "Clip", getMediaPath: () => paths[0] }]);
      return true;
    } }, { File: FakeFile, Folder: FakeFolder });
    expect(await media.import_folder.handler({ folder_path: folder, target_bin: name })).toMatchObject({ success: true, data: { verified: true, targetBin: name } });
  });

});
