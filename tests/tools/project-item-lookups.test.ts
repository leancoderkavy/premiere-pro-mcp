import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getInspectionTools } from "../../src/tools/inspection.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

let nextId = 1000;

/** Minimal model of Premiere's ExtendScript ProjectItem tree. */
class FakeItem {
  parent: FakeItem | null = null;
  kids: FakeItem[] = [];
  nodeId: string;
  constructor(public name: string, public type: number, public hasChildren = type === 2 || type === 3) {
    this.nodeId = String(nextId++);
  }
  get children() {
    if (!this.hasChildren) return undefined;
    const collection: Record<string, unknown> = { numItems: this.kids.length };
    this.kids.forEach((kid, index) => { collection[index] = kid; });
    return collection;
  }
  get treePath(): string {
    return this.parent ? `${this.parent.treePath}\\${this.name}` : `\\${this.name}`;
  }
  add(child: FakeItem): FakeItem {
    child.parent?.kids.splice(child.parent.kids.indexOf(child), 1);
    child.parent = this;
    this.kids.push(child);
    return child;
  }
  createBin(name: string): FakeItem {
    return this.add(new FakeItem(name, 2));
  }
  moveBin(target: FakeItem): void {
    target.add(this);
  }
}

function project() {
  const root = new FakeItem("Project", 3);
  const footage = root.add(new FakeItem("Footage", 2));
  const raw = footage.add(new FakeItem("Raw", 2));
  raw.add(new FakeItem("clip.mov", 1, false));
  // A bin-typed item with no children collection (e.g. a search bin) must not
  // abort a recursive walk (#589).
  root.add(new FakeItem("Search", 2, false));
  root.add(new FakeItem("Selects", 1, false));
  return { root, footage, raw };
}

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown): Promise<string> {
  mockedSendCommand.mockClear();
  const result = await tool.handler(args as never);
  if (!mockedSendCommand.mock.calls.length) return JSON.stringify(result);
  return mockedSendCommand.mock.calls[0][0] as string;
}

function run(script: string, app: unknown) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app })));
}

beforeEach(() => vi.clearAllMocks());

describe("get_bin_contents lookup (#589)", () => {
  const inspection = getInspectionTools(bridgeOptions);

  it("resolves a nested bin by node ID past a bin with no children collection", async () => {
    const { root, raw } = project();
    // Move the childless search bin ahead so the walk must pass it first.
    root.kids.unshift(root.kids.splice(root.kids.findIndex((k) => k.name === "Search"), 1)[0]);
    const script = await scriptFor(inspection.get_bin_contents, { bin_id: raw.nodeId });
    const result = run(script, { project: { rootItem: root } });
    expect(result.success).toBe(true);
    expect(result.data.binNodeId).toBe(raw.nodeId);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0].name).toBe("clip.mov");
  });

  it("matches a numeric host nodeId against the string argument", async () => {
    const { root, footage } = project();
    (footage as unknown as { nodeId: number }).nodeId = 4242;
    const script = await scriptFor(inspection.get_bin_contents, { bin_id: "4242", recursive: false });
    const result = run(script, { project: { rootItem: root } });
    expect(result.success).toBe(true);
    expect(result.data.binName).toBe("Footage");
  });

  it("still resolves bins by path and by name", async () => {
    const { root, raw } = project();
    for (const binId of ["Footage/Raw", "Raw"]) {
      const result = run(await scriptFor(inspection.get_bin_contents, { bin_id: binId }), { project: { rootItem: root } });
      expect(result.data.binNodeId).toBe(raw.nodeId);
    }
  });

  it("returns clean actionable errors for a non-bin and a missing bin", async () => {
    const { root } = project();
    const clip = root.kids.find((k) => k.name === "Selects")!;
    const notBin = run(await scriptFor(inspection.get_bin_contents, { bin_id: clip.nodeId }), { project: { rootItem: root } });
    expect(notBin).toEqual({ success: false, error: expect.stringContaining("is not a bin") });
    const missing = run(await scriptFor(inspection.get_bin_contents, { bin_id: "nope" }), { project: { rootItem: root } });
    expect(missing).toEqual({ success: false, error: expect.stringContaining("Bin not found: nope") });
    expect(missing.error).not.toContain("TypeError");
  });

  it("escapes the bin identifier", async () => {
    const script = await scriptFor(inspection.get_bin_contents, { bin_id: 'a"b\\c' });
    expect(script).toContain('var requestedBin = "a\\"b\\\\c";');
  });
});

describe("create_bin parent resolution (#591)", () => {
  const media = getMediaTools(bridgeOptions);

  it("creates the bin inside a nested parent_bin_id and verifies it", async () => {
    const { root, raw } = project();
    const result = run(await scriptFor(media.create_bin, { name: "Child", parent_bin_id: raw.nodeId }), { project: { rootItem: root } });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ created: true, verified: true, outcome: "verified", name: "Child", parentNodeId: raw.nodeId });
    expect(raw.kids.map((k) => k.name)).toContain("Child");
    expect(root.kids.map((k) => k.name)).not.toContain("Child");
    expect(result.data.treePath).toBe("\\Project\\Footage\\Raw\\Child");
  });

  it("moves a bin Premiere placed at the root into the requested parent", async () => {
    const { root, footage } = project();
    footage.createBin = (name: string) => root.createBin(name);
    const result = run(await scriptFor(media.create_bin, { name: "Child", parent_bin_id: footage.nodeId }), { project: { rootItem: root } });
    expect(result.data).toMatchObject({ verified: true, outcome: "verified" });
    expect(footage.kids.map((k) => k.name)).toContain("Child");
  });

  it("reports committed_unverified when the bin cannot be placed in the parent", async () => {
    const { root, footage } = project();
    footage.createBin = (name: string) => {
      const bin = root.createBin(name);
      bin.moveBin = () => undefined;
      return bin;
    };
    const result = run(await scriptFor(media.create_bin, { name: "Child", parent_bin_id: footage.nodeId }), { project: { rootItem: root } });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ created: true, verified: false, outcome: "committed_unverified", treePath: "\\Project\\Child" });
  });

  it("creates at the root without a parent and resolves parent_bin paths", async () => {
    const { root, raw } = project();
    const rootResult = run(await scriptFor(media.create_bin, { name: "Top" }), { project: { rootItem: root } });
    expect(rootResult.data).toMatchObject({ verified: true, parentIsRoot: true });
    const pathResult = run(await scriptFor(media.create_bin, { name: "ByPath", parent_bin: "Footage/Raw" }), { project: { rootItem: root } });
    expect(pathResult.data.parentNodeId).toBe(raw.nodeId);
  });

  it("fails cleanly for a missing or non-bin parent", async () => {
    const { root } = project();
    const clip = root.kids.find((k) => k.name === "Selects")!;
    const missing = run(await scriptFor(media.create_bin, { name: "X", parent_bin_id: "999999" }), { project: { rootItem: root } });
    expect(missing).toEqual({ success: false, error: expect.stringContaining("Parent bin not found") });
    const notBin = run(await scriptFor(media.create_bin, { name: "X", parent_bin_id: clip.nodeId }), { project: { rootItem: root } });
    expect(notBin).toEqual({ success: false, error: expect.stringContaining("is not a bin") });
    expect(root.kids.map((k) => k.name)).not.toContain("X");
  });

  it("validates arguments before contacting Premiere", async () => {
    await expect(media.create_bin.handler({ name: " " })).resolves.toMatchObject({ success: false });
    await expect(media.create_bin.handler({ name: "X", parent_bin_id: "1", parent_bin: "2" })).resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("escapes the bin name and parent ID", async () => {
    const script = await scriptFor(media.create_bin, { name: 'a"b', parent_bin_id: "x\\\"y" });
    expect(script).toContain('var requestedName = "a\\"b";');
    expect(script).toContain('__findProjectItemByNodeId("x\\\\\\"y")');
  });
});

describe("create_bars_and_tone readback (#588)", () => {
  const projectTools = getProjectTools(bridgeOptions);

  function hostApp(root: FakeItem, returnValue: (item: FakeItem) => unknown) {
    return {
      project: {
        rootItem: root,
        activeSequence: null,
        newBarsAndTone: (_w: number, _h: number, _tb: number, _pn: number, _pd: number, _sr: number, name: string) => {
          const item = root.add(new FakeItem(name, 1, false));
          return returnValue(item);
        },
      },
    };
  }

  it("returns the created item's name and nodeId when the host returns no usable item", async () => {
    const { root } = project();
    const script = await scriptFor(projectTools.create_bars_and_tone, { name: "Leader" });
    const result = run(script, hostApp(root, () => ({})));
    const created = root.kids.find((k) => k.name === "Leader")!;
    expect(result.data).toMatchObject({ created: true, verified: true, name: "Leader", nodeId: created.nodeId, treePath: "\\Project\\Leader" });
  });

  it("uses the returned item's nodeId when Premiere provides one", async () => {
    const { root } = project();
    const script = await scriptFor(projectTools.create_bars_and_tone, {});
    const result = run(script, hostApp(root, (item) => item));
    expect(result.data.name).toBe("Bars and Tone");
    expect(result.data.nodeId).toBe(root.kids.find((k) => k.name === "Bars and Tone")!.nodeId);
  });

  it("fails when nothing new appears in the project", async () => {
    const { root } = project();
    const script = await scriptFor(projectTools.create_bars_and_tone, {});
    const app = { project: { rootItem: root, activeSequence: null, newBarsAndTone: () => true } };
    expect(run(script, app)).toEqual({ success: false, error: expect.stringContaining("readback found no new project item") });
  });

  it("escapes the requested name", async () => {
    const script = await scriptFor(projectTools.create_bars_and_tone, { name: 'Bars "A"' });
    expect(script).toContain('var requestedName = "Bars \\"A\\"";');
  });
});
