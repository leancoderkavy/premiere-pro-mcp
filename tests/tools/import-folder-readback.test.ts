import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("node:fs", () => ({ existsSync: () => true, statSync: () => ({ isDirectory: () => true }) }));
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMediaTools } from "../../src/tools/media.js";

const tool = getMediaTools({ tempDir: "/tmp/folder-readback", timeoutMs: 5000 }).import_folder;
const folderPath = resolve('/media/folder "quoted"');
const paths = [resolve(folderPath, "a.wav"), resolve(folderPath, "b.wav")];
type Item = { nodeId: string; name: string; getMediaPath: () => unknown };
type Options = {
  skip?: number[]; returnValue?: boolean; throwAfter?: boolean; unreadablePath?: boolean;
  unreadableBefore?: boolean; unreadableAfter?: boolean; invalidCount?: boolean; empty?: boolean;
};

function host(options: Options = {}) {
  const items: Item[] = [{ nodeId: "existing", name: "a.wav", getMediaPath: () => paths[0] }];
  let attempted = false;
  function File(this: { fsName: string }, path: string) { this.fsName = path; }
  function Folder(this: { exists: boolean; getFiles: () => unknown[] }, path: string) {
    this.exists = path === folderPath;
    this.getFiles = () => options.empty ? [] : [...paths.map(p => new (File as any)(p)), { fsName: "nested-folder" }];
  }
  const children = new Proxy({}, { get: (_target, key) => {
    if (typeof key === "symbol") return undefined;
    if ((!attempted && options.unreadableBefore) || (attempted && options.unreadableAfter)) throw new Error("Readback unavailable");
    if (key === "numItems") return options.invalidCount ? "2" : items.length;
    return items[Number(key)];
  } });
  const importFiles = vi.fn((files: string[], suppress: boolean, target: unknown, numbered: boolean) => {
    attempted = true;
    files.forEach((path, index) => {
      if (options.skip?.includes(index)) return;
      items.push({ nodeId: `new-${index}`, name: `item-${index}`, getMediaPath: () => {
        if (options.unreadablePath) throw new Error("Path unavailable");
        return path;
      } });
    });
    if (options.throwAfter) throw new Error("Host threw after import");
    return options.returnValue ?? true;
  });
  const rootItem = { children };
  vi.mocked(sendCommand).mockImplementation(async script => JSON.parse(String(runInNewContext(
    `${getHelpersSource()}\n${script}`, { app: { project: { rootItem, sequences: { numSequences: 0 }, importFiles } }, File, Folder },
  ))));
  return { importFiles, rootItem };
}

beforeEach(() => vi.clearAllMocks());

describe("import_folder project readback", () => {
  it("verifies each new item, escapes folder paths, and skips nested folders", async () => {
    const { importFiles, rootItem } = host();
    const result = await tool.handler({ folder_path: folderPath });
    expect(result).toMatchObject({ success: true, data: { imported: 2, verified: true, outcome: "verified", folder: folderPath } });
    expect(importFiles).toHaveBeenCalledExactlyOnceWith(paths, true, rootItem, false);
  });

  it("catches partial imports despite a true host return", async () => {
    host({ skip: [1] });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: true, data: {
      outcome: "committed_unverified", verified: false, projectChanged: true,
      importReturned: true, notImported: [paths[1]], imported: 1, items: [{ nodeId: "new-0", mediaPath: paths[0] }],
    } });
  });

  it("never counts preexisting items as new imports", async () => {
    host({ skip: [0, 1], returnValue: false });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: false, data: {
      verified: false, projectChanged: null, notImported: paths, imported: 0, items: [],
    } });
  });

  it("reads back partial changes even when importFiles throws", async () => {
    const { importFiles } = host({ skip: [1], throwAfter: true });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: false, data: {
      outcome: "committed_unverified", projectChanged: true, hostError: "Error: Host threw after import", notImported: [paths[1]],
    } });
    expect(importFiles).toHaveBeenCalledTimes(1);
  });

  it("uses observed items instead of a false host return to prove success", async () => {
    host({ returnValue: false });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: true, data: { verified: true, importReturned: false } });
  });

  it("reports unreadable media paths without claiming success", async () => {
    host({ unreadablePath: true });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: true, data: {
      outcome: "committed_unverified", verified: false, notImported: paths,
    } });
  });

  it("preserves uncertainty when project readback throws after import", async () => {
    host({ unreadableAfter: true });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: true, data: {
      outcome: "committed_unverified", verified: false, projectChanged: null, imported: null,
    } });
  });

  it.each([{ unreadableBefore: true }, { invalidCount: true }])("refuses mutation without readable baseline: %j", async options => {
    const { importFiles } = host(options);
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: false, error: expect.stringContaining("Nothing was imported") });
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("rejects empty folders and invalid arguments without mutation", async () => {
    const { importFiles } = host({ empty: true });
    expect(await tool.handler({ folder_path: folderPath })).toMatchObject({ success: false, error: "No files found in folder" });
    expect(importFiles).not.toHaveBeenCalled();
    vi.clearAllMocks();
    expect(await tool.handler({ folder_path: " " })).toMatchObject({ success: false });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
