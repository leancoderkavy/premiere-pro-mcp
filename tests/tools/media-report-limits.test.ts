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
import { getUtilityTools } from "../../src/tools/utility.js";
import { getProjectTools } from "../../src/tools/project.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };
const utility = getUtilityTools(bridgeOptions);
const projectTools = getProjectTools(bridgeOptions);

let nextId = 5000;

/** Minimal model of Premiere's ExtendScript ProjectItem tree with media paths. */
class FakeItem {
  parent: FakeItem | null = null;
  kids: FakeItem[] = [];
  nodeId = String(nextId++);
  constructor(public name: string, public type: number, public mediaPath = "", public hasChildren = type === 2 || type === 3) {}
  get children() {
    if (!this.hasChildren) return undefined;
    const collection: Record<string, unknown> = { numItems: this.kids.length };
    this.kids.forEach((kid, index) => { collection[index] = kid; });
    return collection;
  }
  get treePath(): string {
    return this.parent ? `${this.parent.treePath}\\${this.name}` : `\\${this.name}`;
  }
  getMediaPath(): string {
    return this.mediaPath;
  }
  add(child: FakeItem): FakeItem {
    child.parent = this;
    this.kids.push(child);
    return child;
  }
}

function hostApp(root: FakeItem, usedItems: FakeItem[] = []) {
  const clips: Record<string, unknown> = { numItems: usedItems.length };
  usedItems.forEach((item, index) => { clips[index] = { projectItem: item }; });
  const sequence = {
    videoTracks: { numTracks: 1, 0: { clips } },
    audioTracks: { numTracks: 0 },
  };
  return { project: { rootItem: root, sequences: { numSequences: 1, 0: sequence } } };
}

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown): Promise<string> {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return mockedSendCommand.mock.calls[0][0] as string;
}

function run(script: string, app: unknown) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app })));
}

beforeEach(() => vi.clearAllMocks());

describe("get_unused_media paging and filtering (#642)", () => {
  function unusedProject(count: number) {
    const root = new FakeItem("Project", 3);
    const bin = root.add(new FakeItem("Footage", 2));
    root.add(new FakeItem("Search", 2, "", false));
    const clips: FakeItem[] = [];
    for (let i = 0; i < count; i++) {
      clips.push(bin.add(new FakeItem(i % 2 === 0 ? `Interview_${i}.mov` : `Broll_${i}.mov`, 1, `/media/${i}.mov`)));
    }
    return { root, clips };
  }

  it("defaults to 100 items and reports the next page", async () => {
    const { root } = unusedProject(150);
    const result = run(await scriptFor(utility.get_unused_media, {}), hostApp(root));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      unusedCount: 150, total: 150, offset: 0, limit: 100, returned: 100, truncated: true, nextOffset: 100, contains: null,
    });
    expect(result.data.items).toHaveLength(100);
    expect(result.data.items[0]).toMatchObject({ name: "Interview_0.mov", mediaPath: "/media/0.mov", treePath: "\\Project\\Footage\\Interview_0.mov" });
  });

  it("pages with offset and limit and excludes used items", async () => {
    const { root, clips } = unusedProject(10);
    const app = hostApp(root, [clips[0], clips[1]]);
    const first = run(await scriptFor(utility.get_unused_media, { offset: 0, limit: 5 }), app);
    expect(first.data).toMatchObject({ total: 8, returned: 5, truncated: true, nextOffset: 5 });
    expect(first.data.items.map((item: { name: string }) => item.name)).not.toContain("Interview_0.mov");
    const last = run(await scriptFor(utility.get_unused_media, { offset: 5, limit: 5 }), app);
    expect(last.data).toMatchObject({ total: 8, offset: 5, returned: 3, truncated: false, nextOffset: null });
    expect(last.data.items.map((item: { name: string }) => item.name)).toEqual(["Broll_7.mov", "Interview_8.mov", "Broll_9.mov"]);
  });

  it("filters by a case-insensitive name substring before paging", async () => {
    const { root } = unusedProject(10);
    const result = run(await scriptFor(utility.get_unused_media, { contains: "INTERVIEW", limit: 2 }), hostApp(root));
    expect(result.data).toMatchObject({ total: 5, returned: 2, truncated: true, nextOffset: 2, contains: "interview" });
    expect(result.data.items.every((item: { name: string }) => item.name.startsWith("Interview_"))).toBe(true);
  });

  it("escapes the contains filter", async () => {
    const script = await scriptFor(utility.get_unused_media, { contains: 'a"b\\c' });
    expect(script).toContain('var needle = "a\\"b\\\\c".toLowerCase();');
  });

  it("rejects invalid paging arguments before contacting Premiere", async () => {
    for (const args of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 501 }, { contains: "x".repeat(257) }]) {
      await expect(utility.get_unused_media.handler(args as never)).resolves.toMatchObject({ success: false });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("get_duplicate_media paging and After Effects comps (#642)", () => {
  function duplicateProject() {
    const root = new FakeItem("Project", 3);
    const bin = root.add(new FakeItem("Footage", 2));
    for (let i = 0; i < 6; i++) {
      bin.add(new FakeItem(`Clip_${i}.mov`, 1, `/media/clip_${i}.mov`));
      root.add(new FakeItem(`Clip_${i} copy.mov`, 1, `/media/clip_${i}.mov`));
    }
    const ae = root.add(new FakeItem("Dynamic Link", 2));
    ae.add(new FakeItem("Lower Third", 1, "/ae/graphics.aep"));
    ae.add(new FakeItem("Title Card", 1, "/ae/graphics.aep"));
    ae.add(new FakeItem("End Slate", 1, "/ae/GRAPHICS.AEPX"));
    return { root, ae };
  }

  it("does not group distinct After Effects comps from the same project", async () => {
    const { root } = duplicateProject();
    const result = run(await scriptFor(utility.get_duplicate_media, {}), hostApp(root));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ duplicateGroupCount: 6, total: 6, returned: 6, truncated: false, nextOffset: null });
    expect(result.data.duplicates.some((group: { mediaPath: string }) => /\.aepx?$/i.test(group.mediaPath))).toBe(false);
    expect(result.data.duplicates[0]).toEqual({
      mediaPath: "/media/clip_0.mov",
      count: 2,
      items: [
        expect.objectContaining({ name: "Clip_0.mov", treePath: "\\Project\\Footage\\Clip_0.mov" }),
        expect.objectContaining({ name: "Clip_0 copy.mov", treePath: "\\Project\\Clip_0 copy.mov" }),
      ],
    });
  });

  it("still groups the same After Effects comp imported twice", async () => {
    const { root, ae } = duplicateProject();
    ae.add(new FakeItem("Lower Third", 1, "/ae/graphics.aep"));
    const result = run(await scriptFor(utility.get_duplicate_media, { contains: "lower" }), hostApp(root));
    expect(result.data).toMatchObject({ total: 1, returned: 1 });
    expect(result.data.duplicates[0]).toMatchObject({ mediaPath: "/ae/graphics.aep", aeCompName: "Lower Third", count: 2 });
  });

  it("pages duplicate groups and filters by item name", async () => {
    const { root } = duplicateProject();
    const page = run(await scriptFor(utility.get_duplicate_media, { offset: 2, limit: 3 }), hostApp(root));
    expect(page.data).toMatchObject({ total: 6, offset: 2, limit: 3, returned: 3, truncated: true, nextOffset: 5 });
    expect(page.data.duplicates.map((group: { mediaPath: string }) => group.mediaPath)).toEqual([
      "/media/clip_2.mov", "/media/clip_3.mov", "/media/clip_4.mov",
    ]);
    const filtered = run(await scriptFor(utility.get_duplicate_media, { contains: "CLIP_5 COPY" }), hostApp(root));
    expect(filtered.data).toMatchObject({ total: 1, returned: 1, truncated: false });
    expect(filtered.data.duplicates[0].count).toBe(2);
  });

  it("rejects invalid paging arguments and escapes contains", async () => {
    await expect(utility.get_duplicate_media.handler({ limit: 1000 } as never)).resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    const script = await scriptFor(utility.get_duplicate_media, { contains: 'x"y' });
    expect(script).toContain('var needle = "x\\"y".toLowerCase();');
  });
});

describe("get_project_panel_metadata max_chars (#642)", () => {
  const metadataApp = (metadata: string) => ({ project: { getProjectPanelMetadata: () => metadata } });

  it("returns short metadata untruncated with the default cap", async () => {
    const result = run(await scriptFor(projectTools.get_project_panel_metadata, {}), metadataApp("<xml/>"));
    expect(result.data).toEqual({ metadata: "<xml/>", truncated: false, totalChars: 6, returnedChars: 6, maxChars: 20000 });
  });

  it("truncates metadata longer than max_chars and reports totalChars", async () => {
    const xml = `<root>${"a".repeat(1000)}</root>`;
    const result = run(await scriptFor(projectTools.get_project_panel_metadata, { max_chars: 256 }), metadataApp(xml));
    expect(result.data).toMatchObject({ truncated: true, totalChars: xml.length, returnedChars: 256, maxChars: 256 });
    expect(result.data.metadata).toBe(xml.slice(0, 256));
    expect(result.data.note).toContain("do not pass truncated XML");
  });

  it("applies the 20000-character default to large metadata", async () => {
    const xml = "b".repeat(25000);
    const result = run(await scriptFor(projectTools.get_project_panel_metadata, undefined), metadataApp(xml));
    expect(result.data).toMatchObject({ truncated: true, totalChars: 25000, returnedChars: 20000 });
    expect(result.data.metadata).toHaveLength(20000);
  });

  it("rejects out-of-range max_chars before contacting Premiere", async () => {
    for (const max_chars of [255, 200001, 1000.5]) {
      await expect(projectTools.get_project_panel_metadata.handler({ max_chars } as never)).resolves.toMatchObject({ success: false });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
