import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
  sendRawCommand: vi.fn(),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getProjectTools } from "../../src/tools/project.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

type Item = { name: string; nodeId: string; type: number; kids?: Item[]; children?: unknown; isSequence?: () => boolean };
type Seq = { name: string; sequenceID: string; projectItem?: Item; clone?: () => void };

function bin(name: string, nodeId: string, kids: Item[]): Item {
  const item: Item = { name, nodeId, type: 2, kids };
  Object.defineProperty(item, "children", {
    get: () => {
      const collection: Record<string, unknown> = { numItems: kids.length };
      kids.forEach((kid, index) => { collection[index] = kid; });
      return collection;
    },
  });
  return item;
}

function sequenceItem(name: string, nodeId: string): Item {
  return { name, nodeId, type: 1, isSequence: () => true };
}

/** A project whose sequence project items carry node IDs unrelated to their sequence GUIDs, as on Premiere 26.5.2. */
function project() {
  const reelItem = sequenceItem("CIF Reel 1x1", "000f4251");
  const copyItem = sequenceItem("CIF Reel 1x1 Copy", "000f4252");
  const clip: Item = { name: "clip.mov", nodeId: "000f4240", type: 1, isSequence: () => false };
  const sequencesBin = bin("Sequences", "000f4250", [reelItem, copyItem]);
  const root = bin("Project", "000f0000", [clip, sequencesBin]);
  const list: Seq[] = [
    { name: "CIF Reel 1x1", sequenceID: "6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10", projectItem: reelItem },
    { name: "CIF Reel 1x1 Copy", sequenceID: "b1994a73-cbd2-4500-bc24-e642f66f8962", projectItem: copyItem },
  ];
  const sequences = new Proxy({}, { get: (_t, k) => (k === "numSequences" ? list.length : list[Number(k)]) });
  return { app: { project: { rootItem: root, sequences } }, root, list, reelItem, copyItem, clip };
}

function run(script: string, app: unknown) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app })));
}

function find(app: unknown, expression: string): unknown {
  return runInNewContext(`${getHelpersSource()}\n(function(){ var found = ${expression}; return found ? found.nodeId : null; })()`, { app });
}

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown): Promise<string> {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalled();
  return mockedSendCommand.mock.calls.at(-1)![0] as string;
}

beforeEach(() => vi.clearAllMocks());

describe("project-item lookup by sequence ID", () => {
  it("renames a sequence by the sequence ID duplicate_sequence returned", async () => {
    const host = project();
    const script = await scriptFor(getUtilityTools(bridgeOptions).rename_project_item, {
      item_id: "b1994a73-cbd2-4500-bc24-e642f66f8962",
      new_name: "CIF Reel 1x1 Square",
    });
    const result = run(script, host.app);
    expect(result).toMatchObject({ success: true, data: { oldName: "CIF Reel 1x1 Copy", newName: "CIF Reel 1x1 Square", sequenceVerified: true } });
    expect(host.copyItem.name).toBe("CIF Reel 1x1 Square");
    expect(host.list[1].name).toBe("CIF Reel 1x1 Square");
    expect(host.reelItem.name).toBe("CIF Reel 1x1");
  });

  it("still refuses an unknown sequence ID without renaming anything", async () => {
    const host = project();
    const script = await scriptFor(getUtilityTools(bridgeOptions).rename_project_item, {
      item_id: "00000000-0000-0000-0000-000000000000",
      new_name: "Nope",
    });
    expect(run(script, host.app)).toMatchObject({ success: false, error: "Item not found" });
    expect(host.copyItem.name).toBe("CIF Reel 1x1 Copy");
    expect(host.list[1].name).toBe("CIF Reel 1x1 Copy");
  });

  it("escapes a hostile sequence ID before embedding it", async () => {
    const script = await scriptFor(getUtilityTools(bridgeOptions).rename_project_item, { item_id: 'x"); evil(); ("', new_name: "n" });
    expect(script).toContain('__findProjectItem("x\\"); evil(); (\\"")');
  });

  it("keeps node-ID and name matches ahead of the sequence-ID fallback", () => {
    const host = project();
    // An item whose node ID or name equals another sequence's GUID still wins.
    host.clip.nodeId = "6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10";
    expect(find(host.app, '__findProjectItem("6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10")')).toBe("6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10");
    host.clip.nodeId = "000f4240";
    host.clip.name = "b1994a73-cbd2-4500-bc24-e642f66f8962";
    expect(find(host.app, '__findProjectItem("b1994a73-cbd2-4500-bc24-e642f66f8962")')).toBe("000f4240");
    // Plain node-ID and name lookups are unchanged.
    expect(find(host.app, '__findProjectItem("000f4251")')).toBe("000f4251");
    expect(find(host.app, '__findProjectItem("CIF Reel 1x1 Copy")')).toBe("000f4252");
  });

  it("returns the tree item for a sequence ID and never falls back inside a scoped search", () => {
    const host = project();
    expect(find(host.app, '__findProjectItem("6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10")')).toBe("000f4251");
    // A bin-scoped walk is a recursion step; it must not jump out to the sequence list.
    expect(find(host.app, '__findProjectItem("6a1e4f2c-7d0b-4f43-9b8e-2b1d4f3c5a10", app.project.rootItem)')).toBeNull();
  });

  it("returns null when the sequence list or the sequence's project item is unreadable", () => {
    const host = project();
    host.list[1].projectItem = undefined;
    expect(find(host.app, '__findProjectItem("b1994a73-cbd2-4500-bc24-e642f66f8962")')).toBeNull();
    // A project item that is no longer in the tree does not resolve either.
    host.list[1].projectItem = sequenceItem("Orphan", "000fdead");
    expect(find(host.app, '__findProjectItem("b1994a73-cbd2-4500-bc24-e642f66f8962")')).toBeNull();
    const noSequences = { project: { rootItem: host.root } };
    expect(find(noSequences, '__findProjectItem("b1994a73-cbd2-4500-bc24-e642f66f8962")')).toBeNull();
    const throwing = { project: { rootItem: host.root, get sequences() { throw new Error("busy"); } } };
    expect(find(throwing, '__findProjectItem("b1994a73-cbd2-4500-bc24-e642f66f8962")')).toBeNull();
    expect(find(host.app, '__findProjectItem("")')).toBeNull();
  });
});

describe("duplicate_sequence receipt", () => {
  function host(withProjectItem: boolean) {
    const list: Seq[] = [];
    let nextNode = 0x4300;
    const make = (name: string, id: string): Seq => {
      const seq: Seq = { name, sequenceID: id };
      if (withProjectItem) seq.projectItem = sequenceItem(name, (nextNode++).toString(16).padStart(8, "0"));
      seq.clone = () => { list.push(make(`${name} Copy`, `copy-${list.length}`)); };
      return seq;
    };
    list.push(make("CIF Reel 1x1", "orig"));
    const sequences = new Proxy({}, { get: (_t, k) => (k === "numSequences" ? list.length : list[Number(k)]) });
    return { app: { project: { sequences, activeSequence: list[0] } }, list };
  }

  it("reports the copy's project item node ID alongside its sequence ID", async () => {
    const h = host(true);
    mockedSendCommand.mockImplementation(async (script: string) => run(script, h.app));
    const result = await getSequenceTools(bridgeOptions).duplicate_sequence.handler({ sequence_id: "orig" });
    expect(result).toMatchObject({ success: true, data: { id: "copy-1", name: "CIF Reel 1x1 Copy", projectItemNodeId: h.list[1].projectItem!.nodeId } });
    expect(h.list[1].projectItem!.nodeId).not.toBe("copy-1");
  });

  it("omits projectItemNodeId when the copy's project item is unreadable", async () => {
    const h = host(false);
    mockedSendCommand.mockImplementation(async (script: string) => run(script, h.app));
    const result = (await getSequenceTools(bridgeOptions).duplicate_sequence.handler({ sequence_id: "orig" })) as { success: boolean; data: Record<string, unknown> };
    expect(result).toMatchObject({ success: true, data: { id: "copy-1", verified: true } });
    expect(result.data).not.toHaveProperty("projectItemNodeId");
  });
});

describe("bin-only lookups refuse a sequence ID", () => {
  // A real file and folder so the handlers' disk pre-checks pass.
  const file = fileURLToPath(import.meta.url);
  const folder = dirname(file);

  for (const [tool, args] of [
    ["import_media", { file_paths: [file] }],
    ["import_folder", { folder_path: folder }],
  ] as const) {
    it(`${tool} refuses a sequence ID as target_bin before calling the host import`, async () => {
      const host = project();
      const importFiles = vi.fn(() => true);
      Object.assign(host.app.project, { importFiles });
      const script = await scriptFor(getMediaTools(bridgeOptions)[tool], { ...args, target_bin: host.list[1].sequenceID });
      expect(script).toContain(`var targetBin = __findBin("${host.list[1].sequenceID}");`);
      const result = run(script, host.app);
      expect(result).toEqual({ success: false, error: `${host.list[1].sequenceID} is not a bin; nothing was imported.` });
      expect(importFiles).not.toHaveBeenCalled();
    });
  }

  it("import_media still imports into a bin found by node ID or name and reports a missing bin", async () => {
    class File { constructor(public fsName: string) {} get exists() { return true; } }
    for (const target of ["000f4250", "Sequences"]) {
      const host = project();
      const importFiles = vi.fn(() => { throw new Error("stop after dispatch"); });
      Object.assign(host.app.project, { importFiles });
      const script = await scriptFor(getMediaTools(bridgeOptions).import_media, { file_paths: [fileURLToPath(import.meta.url)], target_bin: target });
      runInNewContext(`${getHelpersSource()}\n${script}`, { app: host.app, File });
      expect(importFiles).toHaveBeenCalledTimes(1);
      expect((importFiles.mock.calls[0] as unknown[])[2]).toMatchObject({ name: "Sequences", type: 2 });
    }
    const missing = run(await scriptFor(getMediaTools(bridgeOptions).import_media, { file_paths: [fileURLToPath(import.meta.url)], target_bin: 'no"bin' }), project().app);
    expect(missing).toEqual({ success: false, error: 'Bin not found: no"bin' });
  });

  it("import_ae_comps and import_fcp_xml resolve target_bin through the bin-only lookup", async () => {
    const projectTools = getProjectTools(bridgeOptions);
    const xml = await scriptFor(projectTools.import_fcp_xml, { path: fileURLToPath(import.meta.url), mode: "into_open_project", target_bin: 'Seq"1' });
    expect(xml).toContain('var targetBin = __findBin("Seq\\"1");');
    expect(xml).toContain('"Seq\\"1 is not a bin; nothing was imported."');
    expect(xml).not.toContain('var targetBin = __findProjectItem(');
  });
});

describe("item parameters advertise sequence IDs", () => {
  const modules = import.meta.glob("../../src/tools/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
  const resolvedThroughProjectLookup: string[] = [];
  const missing: string[] = [];
  for (const mod of Object.values(modules)) {
    for (const [key, factory] of Object.entries(mod)) {
      if (!/^get\w+Tools$/.test(key) || typeof factory !== "function") continue;
      let tools: Record<string, { handler?: unknown; parameters?: { properties?: Record<string, { description?: string }> } }>;
      try { tools = (factory as (o: BridgeOptions) => typeof tools)(bridgeOptions); } catch { continue; }
      for (const [name, tool] of Object.entries(tools ?? {})) {
        if (!tool || typeof tool.handler !== "function") continue;
        const source = String(tool.handler);
        for (const [param, spec] of Object.entries(tool.parameters?.properties ?? {})) {
          if (!/item_id/.test(param)) continue;
          const lookup = new RegExp(`__findProjectItem\\("\\$\\{[^}]*escapeForExtendScript\\)?\\((String\\()?args\\.${param}\\)?\\)\\}"\\)`);
          if (!lookup.test(source)) continue;
          resolvedThroughProjectLookup.push(`${name}.${param}`);
          if (!/sequence ID/.test(spec.description ?? "")) missing.push(`${name}.${param}`);
        }
      }
    }
  }

  it("every item_id resolved by the whole-project lookup says it accepts a sequence ID", () => {
    expect(resolvedThroughProjectLookup).toEqual(expect.arrayContaining(["delete_project_item.item_id", "move_item_to_bin.item_id", "rename_project_item.item_id", "set_metadata.item_id"]));
    expect(missing).toEqual([]);
  });
});
