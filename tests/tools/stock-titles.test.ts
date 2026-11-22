vi.mock("../../src/tools/mogrt-validation.js", () => ({ validateMogrtArchive: vi.fn(() => null) }));
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { deflateRawSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/bridge/file-bridge.js")>()),
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  findStockTitle,
  getStockTitleTools,
  listStockTitles,
  readMogrtTextFields,
  readZipEntry,
  stockTitleRoots,
  type StockTitleTemplate,
} from "../../src/tools/stock-titles.js";
import { getTextTools } from "../../src/tools/text.js";
import { readPremiereTitleText, writeZip } from "../../src/tools/mogrt-bake.js";
import { gzipSync } from "node:zlib";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/stock-titles", timeoutMs: 5000 };
const TICKS = 254016000000;
const workspace = mkdtempSync(join(tmpdir(), "stock-titles-"));

afterAll(() => rmSync(workspace, { recursive: true, force: true }));
beforeEach(() => vi.clearAllMocks());

/** Minimal zip writer: one local header + central directory entry per file. */
function makeZip(files: Record<string, Buffer | string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const loc = (en: string) => ({ strDB: [{ localeString: "de_DE", str: `de-${en}` }, { localeString: "en_US", str: en }] });

function definition(textDefaults: string[]): string {
  const controls = [
    { type: 8, uiName: loc("LayerName"), value: loc("Clip") },
    ...textDefaults.map((text, id) => ({ id, type: 6, uiName: loc("TextLayer"), value: loc(text) })),
  ];
  return "﻿" + JSON.stringify({ capsuleName: "x", clientControls: controls });
}

function writeMogrt(path: string, textDefaults: string[]): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, makeZip({ "thumb.png": Buffer.alloc(64), "definition.json": definition(textDefaults) }));
  return path;
}

describe("readZipEntry", () => {
  it("reads deflated and stored entries and returns null when absent", () => {
    const deflated = makeZip({ "a.txt": "alpha", "b.txt": "bravo" });
    expect(readZipEntry(deflated, "b.txt")?.toString()).toBe("bravo");
    expect(readZipEntry(deflated, "missing.txt")).toBeNull();
    expect(readZipEntry(makeZip({ "a.txt": "stored" }, false), "a.txt")?.toString()).toBe("stored");
  });

  it("rejects non-zip data and oversized entries", () => {
    expect(() => readZipEntry(Buffer.from("not a zip at all, definitely not"), "a")).toThrow(/Not a zip/);
    expect(() => readZipEntry(makeZip({ "a.txt": "x".repeat(100) }), "a.txt", 10)).toThrow(/exceeds/);
  });
});

describe("stock title catalog", () => {
  const root = join(workspace, "Essential Graphics");
  writeMogrt(join(root, "Basic Title.mogrt"), ["Your Title Here"]);
  writeMogrt(join(root, "Basic Lower Third.mogrt"), ["Second Line is Smaller", "Your Name Here"]);
  writeMogrt(join(root, "Titles", "Bold Title.mogrt"), ["BOLD"]);
  writeMogrt(join(root, "Graphic Overlays", "No Text.mogrt"), []);
  writeFileSync(join(root, "Broken.mogrt"), "garbage");
  const newer = join(workspace, "Newer");
  writeMogrt(join(newer, "Basic Title.mogrt"), ["Newer Default"]);

  it("reads text fields in order with English labels, skipping non-text controls", () => {
    expect(readMogrtTextFields(join(root, "Basic Lower Third.mogrt"))).toEqual([
      { index: 0, label: "TextLayer", defaultText: "Second Line is Smaller" },
      { index: 1, label: "TextLayer", defaultText: "Your Name Here" },
    ]);
  });

  it("lists templates with categories, drops text-less ones, reports broken files, and lets the first root win", () => {
    const { templates, skipped } = listStockTitles([newer, root]);
    const names = templates.map((t) => `${t.category}/${t.name}`).sort();
    expect(names).toEqual(["/Basic Lower Third", "/Basic Title", "Titles/Bold Title"]);
    expect(templates.find((t) => t.name === "Basic Title")?.textFields[0].defaultText).toBe("Newer Default");
    expect(skipped.map((s) => s.path)).toEqual([join(root, "Broken.mogrt")]);
  });

  it("finds templates by name or category/name, case-insensitively", () => {
    const { templates } = listStockTitles([root]);
    expect(findStockTitle(templates, "basic title")?.name).toBe("Basic Title");
    expect(findStockTitle(templates, "Titles/Bold Title.mogrt")?.name).toBe("Bold Title");
    expect(findStockTitle(templates, "Nope")).toBeUndefined();
  });

  it("honors PREMIERE_STOCK_MOGRT_DIRS and ignores folders that do not exist", () => {
    expect(stockTitleRoots({ PREMIERE_STOCK_MOGRT_DIRS: [root, join(workspace, "missing")].join(process.platform === "win32" ? ";" : ":") }, "linux")).toEqual([root]);
  });

  it("list_stock_titles returns the catalog and fails clearly when nothing is installed", async () => {
    vi.stubEnv("PREMIERE_STOCK_MOGRT_DIRS", root);
    try {
      const tools = getStockTitleTools(bridgeOptions);
      const result = await tools.list_stock_titles.handler({ category: "titles" }) as { success: boolean; data: { count: number; templates: Array<{ name: string }> } };
      expect(result.success).toBe(true);
      expect(result.data.templates.map((t) => t.name)).toEqual(["Bold Title"]);
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("PREMIERE_STOCK_MOGRT_DIRS", join(workspace, "missing"));
    try {
      const empty = await getStockTitleTools(bridgeOptions).list_stock_titles.handler({});
      expect(empty).toMatchObject({ success: false, error: expect.stringMatching(/PREMIERE_STOCK_MOGRT_DIRS/) });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---- host simulation ------------------------------------------------------

const textJson = (value: string) => JSON.stringify({ fontSize: 72, textEditValue: value, fontName: "Font" });

interface FakeClipOptions {
  textDefaults?: string[];
  ignoreSetAt?: number;
  defaultSeconds?: number;
  ignoreEndWrite?: boolean;
  noMgt?: boolean;
  snapFrameTicks?: number;
  unreadableStart?: boolean;
  /** Live displayName of each text control, in host order (default: "TextLayer"). */
  labels?: string[];
}

function fakeClip(opts: FakeClipOptions, requestedSeconds: number) {
  const startSeconds = opts.snapFrameTicks ? Math.round(requestedSeconds * TICKS / opts.snapFrameTicks) * opts.snapFrameTicks / TICKS : requestedSeconds;
  const props = (opts.textDefaults ?? ["Your Title Here"]).map((text, i) => ({
    displayName: opts.labels?.[i] ?? "TextLayer",
    value: textJson(text) as unknown,
    getValue() { return this.value; },
    setValue(v: unknown) { if (opts.ignoreSetAt !== i) this.value = v; },
  }));
  const all = [{ displayName: "Position", value: [0.5, 0.5], getValue() { return this.value; }, setValue() {} }, ...props];
  const properties: Record<string | number, unknown> = { numItems: all.length };
  all.forEach((p, i) => { properties[i] = p; });
  let endTicks = (startSeconds + (opts.defaultSeconds ?? 10)) * TICKS;
  const clip = {
    name: "Graphic",
    nodeId: "node-1",
    get start() { if (opts.unreadableStart) throw new Error("start unreadable"); return { ticks: String(startSeconds * TICKS) }; },
    get end() { return { ticks: String(endTicks) }; },
    set end(value: unknown) {
      if (opts.ignoreEndWrite) return;
      endTicks = parseFloat(typeof value === "string" ? value : (value as { ticks: string }).ticks);
    },
    getMGTComponent: opts.noMgt ? undefined : () => ({ properties }),
  };
  return { clip, props };
}

function hostWith(opts: FakeClipOptions = {}, others: Array<{ name: string; startSeconds: number }> = []) {
  const state: { clip?: ReturnType<typeof fakeClip>; imported?: unknown[] } = {};
  const trackClips: Record<string | number, unknown> = { numItems: others.length };
  others.forEach((o, i) => { trackClips[i] = { name: o.name, start: { ticks: String(o.startSeconds * TICKS) } }; });
  const context = {
    app: {
      project: {
        activeSequence: {
          timebase: String(TICKS / 25),
          videoTracks: { 0: { clips: trackClips }, 1: { clips: trackClips } },
          importMGT: (...importArgs: unknown[]) => {
            state.imported = importArgs;
            state.clip = fakeClip(opts, Number(importArgs[1]) / TICKS);
            return state.clip.clip;
          },
        },
      },
    },
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return state;
}

const catalog: StockTitleTemplate[] = [
  { name: "Basic Title", category: "", path: "/stock/Basic Title.mogrt", kind: "after_effects", textFields: [{ index: 0, label: "TextLayer", defaultText: "Your Title Here" }] },
  {
    name: "Basic Lower Third",
    category: "",
    path: "/stock/Basic Lower Third.mogrt",
    kind: "after_effects",
    textFields: [
      { index: 0, label: "TextLayer", defaultText: "Second Line is Smaller" },
      { index: 1, label: "TextLayer", defaultText: "Your Name Here" },
    ],
  },
];
const tools = getStockTitleTools(bridgeOptions, () => catalog);
type TitleResult = { success: boolean; error?: string; data: Record<string, any> };

describe("add_title", () => {
  it("documents the baked-copy location and preserves the path in the result", () => {
    expect(tools.add_title.description).toContain("~/Library/Application Support/premiere-pro-mcp/titles");
    expect(tools.add_title.description).toContain("templateFile");
    expect(tools.add_title.description).toContain("newest 50 baked copies");
  });

  it("imports the default template on V2, writes the text, trims to duration, and verifies both", async () => {
    const state = hostWith();
    const result = await tools.add_title.handler({ text: 'Say "hi" \\ there' }) as TitleResult;
    expect(result.success).toBe(true);
    expect(state.imported).toEqual(["/stock/Basic Title.mogrt", "0", 1, 1]);
    expect(result.data.outcome).toBe("verified");
    expect(result.data.textChecks[0]).toMatchObject({ status: "verified", actual: 'Say "hi" \\ there' });
    expect(JSON.parse(String(state.clip!.props[0].value))).toMatchObject({ fontSize: 72, textEditValue: 'Say "hi" \\ there' });
    expect(result.data.duration).toMatchObject({ status: "verified", actualSeconds: 5 });
  });

  it("fills same-named fields by position for multi-line templates", async () => {
    const state = hostWith({ textDefaults: ["Second Line is Smaller", "Your Name Here"] });
    const result = await tools.add_title.handler({ lines: ["Director", "Ada Lovelace"], template: "basic lower third", start_seconds: 2, duration_seconds: 3 }) as TitleResult;
    expect(result.data.outcome).toBe("verified");
    expect(state.clip!.props.map((p) => JSON.parse(String(p.value)).textEditValue)).toEqual(["Director", "Ada Lovelace"]);
    expect(state.imported?.[1]).toBe(String(2 * TICKS));
    expect(result.data.duration.actualSeconds).toBe(3);
  });

  it("reports the frame-snapped start Premiere stored alongside the requested start", async () => {
    hostWith({ snapFrameTicks: TICKS * 1001 / 30000 });
    const result = await tools.add_title.handler({ text: "T", start_seconds: 5 }) as TitleResult;
    expect(result.data).toMatchObject({ requestedStartSeconds: 5 });
    expect(result.data.appliedStartSeconds).toBeCloseTo(5.005, 9);
    expect(result.data.startSeconds).toBeCloseTo(5.005, 9);
  });

  it("falls back to the requested start when the placed clip start cannot be read", async () => {
    hostWith({ unreadableStart: true });
    const result = await tools.add_title.handler({ text: "T", start_seconds: 2 }) as TitleResult;
    expect(result.data).toMatchObject({ startSeconds: 2, requestedStartSeconds: 2, appliedStartSeconds: null });
  });

  it("reports a mismatch when Premiere ignores a text write", async () => {
    hostWith({ ignoreSetAt: 0 });
    const result = await tools.add_title.handler({ text: "New" }) as TitleResult;
    expect(result.data.textVerification).toBe("mismatch");
    expect(result.data.outcome).toBe("mismatch");
    expect(result.data.warnings.length).toBeGreaterThan(0);
  });

  it("keeps the default length rather than overlapping the next clip", async () => {
    hostWith({ defaultSeconds: 10 }, [{ name: "Next", startSeconds: 12 }]);
    const result = await tools.add_title.handler({ text: "T", duration_seconds: 20 }) as TitleResult;
    expect(result.data.duration).toMatchObject({ status: "blocked", actualSeconds: 10 });
    expect(result.data.outcome).toBe("committed_unverified");
  });

  it("flags an unverified duration when the end write is ignored", async () => {
    hostWith({ ignoreEndWrite: true });
    const result = await tools.add_title.handler({ text: "T" }) as TitleResult;
    expect(result.data.duration.status).toBe("mismatch");
  });

  it("reports committed_unverified when the clip has no MGT component", async () => {
    hostWith({ noMgt: true });
    const result = await tools.add_title.handler({ text: "T" }) as TitleResult;
    expect(result.data.textVerification).toBe("committed_unverified");
  });

  it("validates arguments before contacting Premiere", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{}, /exactly one of text or lines/],
      [{ text: "a", lines: ["b"] }, /exactly one of text or lines/],
      [{ lines: [] }, /non-empty array/],
      [{ lines: ["a", "b"] }, /1 text field\(s\) but 2 line/],
      [{ text: "a", template: "Nope" }, /not found/],
      [{ text: "a", duration_seconds: 0 }, /duration_seconds/],
      [{ text: "a", track_index: 1.5 }, /integer/],
      [{ text: "x".repeat(2001) }, /at most/],
    ];
    for (const [args, pattern] of cases) {
      const result = await tools.add_title.handler(args as never) as TitleResult;
      expect(result.success).toBe(false);
      expect(result.error).toMatch(pattern);
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("add_title reports every text field and the ones it left untouched", () => {
  it("lists all textFields, flags untouched defaults, and warns without changing the outcome", async () => {
    const state = hostWith({ textDefaults: ["Second Line is Smaller", "Your Name Here"] });
    const result = await tools.add_title.handler({ lines: ["Director"], template: "Basic Lower Third" }) as TitleResult;
    expect(result.success).toBe(true);
    expect(result.data.outcome).toBe("verified");
    expect(result.data.textFields).toEqual([
      { index: 0, label: "TextLayer", defaultText: "Second Line is Smaller", requestedText: "Director", status: "verified", actual: "Director" },
      { index: 1, label: "TextLayer", defaultText: "Your Name Here", status: "untouched" },
    ]);
    expect(result.data.untouchedFields).toEqual([{ index: 1, label: "TextLayer", defaultText: "Your Name Here" }]);
    expect(result.data.warnings).toEqual([expect.stringMatching(/1 of 2 text field\(s\) .*not written.*#2.*Your Name Here/)]);
    expect(JSON.parse(String(state.clip!.props[1].value)).textEditValue).toBe("Your Name Here");
  });

  it("reports an empty untouchedFields list and no warning when every field is written", async () => {
    hostWith({ textDefaults: ["Second Line is Smaller", "Your Name Here"] });
    const result = await tools.add_title.handler({ lines: ["Director", "Ada"], template: "Basic Lower Third" }) as TitleResult;
    expect(result.data.textFields.map((f: { status: string }) => f.status)).toEqual(["verified", "verified"]);
    expect(result.data.untouchedFields).toEqual([]);
    expect(result.data.warnings).toBeUndefined();
  });

  it("still reports textFields when the clip exposes no MGT component", async () => {
    hostWith({ noMgt: true, textDefaults: ["Second Line is Smaller", "Your Name Here"] });
    const result = await tools.add_title.handler({ lines: ["Director"], template: "Basic Lower Third" }) as TitleResult;
    expect(result.data.textFields[0]).toMatchObject({ index: 0, requestedText: "Director", status: "committed_unverified", actual: null });
    expect(result.data.untouchedFields).toHaveLength(1);
  });
});

describe("add_title fields mapping", () => {
  // Two controls whose default text is identical; only their labels differ.
  const duplicateDefaults: StockTitleTemplate[] = [{
    name: "Name Role",
    category: "",
    path: "/stock/Name Role.mogrt",
    kind: "after_effects",
    textFields: [
      { index: 0, label: "Name", defaultText: "Your Text" },
      { index: 1, label: "Role", defaultText: "Your Text" },
    ],
  }];
  const dupLabels: StockTitleTemplate[] = [{
    name: "Twin",
    category: "",
    path: "/stock/Twin.mogrt",
    kind: "after_effects",
    textFields: [
      { index: 0, label: "TextLayer", defaultText: "Same" },
      { index: 1, label: "TextLayer", defaultText: "Same" },
    ],
  }];
  const mapped = getStockTitleTools(bridgeOptions, () => [...duplicateDefaults, ...dupLabels, ...catalog]);
  const valueOf = (prop: { value: unknown }) => JSON.parse(String(prop.value)).textEditValue;

  it("writes only the named control when default text is duplicated, targeting it by label", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Name", "Role"] });
    const result = await mapped.add_title.handler({ fields: { Role: "Director" }, template: "Name Role" }) as TitleResult;
    expect(result.success).toBe(true);
    expect(state.clip!.props.map(valueOf)).toEqual(["Your Text", "Director"]);
    expect(result.data.outcome).toBe("verified");
    expect(result.data.fieldMapping).toEqual([{ name: "Role", index: 1, label: "Role" }]);
    expect(result.data.untouchedFields).toEqual([{ index: 0, label: "Name", defaultText: "Your Text" }]);
    expect(result.data.warnings).toEqual([expect.stringMatching(/not written/)]);
    expect(result.data.textChecks).toEqual([expect.objectContaining({ displayName: "Role #2", expected: "Director", status: "verified" })]);
  });

  it("maps several named fields and allows an empty value", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Name", "Role"] });
    const result = await mapped.add_title.handler({ fields: { Role: "", Name: "Ada" }, template: "Name Role" }) as TitleResult;
    expect(result.data.outcome).toBe("verified");
    expect(state.clip!.props.map(valueOf)).toEqual(["Ada", ""]);
    expect(result.data.untouchedFields).toEqual([]);
    expect(result.data.warnings).toBeUndefined();
  });

  it("refuses a label that names several controls and attempts no change", async () => {
    const result = await mapped.add_title.handler({ fields: { TextLayer: "x" }, template: "Twin" }) as TitleResult;
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/"TextLayer" is ambiguous.*#1.*#2/) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("validates fields before contacting Premiere", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ fields: { Missing: "x" }, template: "Name Role" }, /no text field labelled "Missing"/],
      [{ fields: { ["__proto__"]: "x", Name: "Ada" }, template: "Name Role" }, /no text field labelled "__proto__"/],
      [{ fields: { "": "x" }, template: "Name Role" }, /non-empty/],
      [{ fields: { "   ": "x" }, template: "Name Role" }, /non-empty/],
      [{ fields: {}, template: "Name Role" }, /at least one/],
      [{ fields: ["Name"], template: "Name Role" }, /object/],
      [{ fields: { Name: 5 }, template: "Name Role" }, /must be a string/],
      [{ fields: { Name: "x".repeat(2001) }, template: "Name Role" }, /exceeds/],
      [{ fields: { Name: "a", " Name": "b" }, template: "Name Role" }, /both target text field #1/],
      [{ fields: { Name: "a" }, text: "b", template: "Name Role" }, /exactly one of text or lines/],
      [{ fields: { Name: "a" }, lines: ["b"], template: "Name Role" }, /exactly one of text or lines/],
    ];
    for (const [args, pattern] of cases) {
      const result = await mapped.add_title.handler(args as never) as TitleResult;
      expect(result.success, JSON.stringify(args)).toBe(false);
      expect(result.error).toMatch(pattern);
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("writes nothing when live labels do not match the catalog order (swapped controls)", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Role", "Name"] });
    const result = await mapped.add_title.handler({ fields: { Name: "Ada" }, template: "Name Role" }) as TitleResult;
    expect(state.clip!.props.map(valueOf)).toEqual(["Your Text", "Your Text"]);
    expect(result.data.textVerification).toBe("missing_property");
    expect(result.data.outcome).toBe("missing_property");
    expect(result.data.textChecks[0]).toMatchObject({ status: "missing_property", actual: null, reason: expect.stringMatching(/labelled "Role".*expected "Name"/) });
    expect(result.data.warnings.join(" ")).toMatch(/label check/);
  });

  it("keeps positional writes when the host localizes text control labels", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Nom", "Fonction"] });
    const result = await mapped.add_title.handler({ lines: ["A", "B"], template: "Name Role" }) as TitleResult;
    expect(state.clip!.props.map(valueOf)).toEqual(["A", "B"]);
    expect(result.data.textVerification).toBe("verified");
  });

  it("refuses a named write when the matching live label appears twice", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Role", "Role"] });
    const result = await mapped.add_title.handler({ fields: { Role: "Director" }, template: "Name Role" }) as TitleResult;
    expect(state.clip!.props.map(valueOf)).toEqual(["Your Text", "Your Text"]);
    expect(result.data.textVerification).toBe("missing_property");
    expect(result.data.textChecks[0].reason).toMatch(/ambiguous/i);
  });

  it("writes nothing when the live text-control count differs from the catalog", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text", "Extra"], labels: ["Name", "Role", "Extra"] });
    const result = await mapped.add_title.handler({ fields: { Role: "R" }, template: "Name Role" }) as TitleResult;
    expect(state.clip!.props.map(valueOf)).toEqual(["Your Text", "Your Text", "Extra"]);
    expect(result.data.textVerification).toBe("missing_property");
  });

  it("does not apply font styling through a failed label check", async () => {
    const state = hostWith({ textDefaults: ["Your Text", "Your Text"], labels: ["Role", "Name"] });
    const result = await mapped.add_title.handler({ fields: { Name: "Ada" }, font_size: 40, template: "Name Role" }) as TitleResult;
    expect(state.clip!.props.map(valueOf)).toEqual(["Your Text", "Your Text"]);
    expect(result.data.styleChecks).toEqual([expect.objectContaining({ field: "font_size", index: 0, status: "committed_unverified" })]);
  });
});

describe("add_title fields mapping with a Premiere-built template", () => {
  function blob(text: string): string {
    const body = Buffer.from(JSON.stringify({ mTextParam: { mStyleSheet: { mText: text } }, mVersion: 1 }), "utf16le");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]).toString("base64");
  }
  function native(file: string, defaults: string[], labels: string[]): string {
    const path = join(workspace, file);
    const layers = defaults.map((text) => `<StartKeyframeValue Encoding="base64">${blob(text)}</StartKeyframeValue>`).join("");
    writeFileSync(path, writeZip([
      { name: "definition.json", data: Buffer.from(JSON.stringify({ capsuleID: "c", clientControls: defaults.map((text, i) => ({ type: 6, uiName: loc(labels[i]), value: loc(text) })) })) },
      { name: "project.prgraphic", data: writeZip([{ name: "p.prproj", data: gzipSync(Buffer.from(`<X>${layers}</X>`)) }]) },
    ]));
    return path;
  }
  const distinct = native("Distinct.mogrt", ["Role Here", "Name Here"], ["Role", "Name"]);
  const twins = native("Twins.mogrt", ["Text", "Text"], ["Name", "Role"]);
  const premiereCatalog: StockTitleTemplate[] = [
    { name: "Distinct", category: "", path: distinct, kind: "premiere", textFields: [{ index: 0, label: "Role", defaultText: "Role Here" }, { index: 1, label: "Name", defaultText: "Name Here" }] },
    { name: "Twins", category: "", path: twins, kind: "premiere", textFields: [{ index: 0, label: "Name", defaultText: "Text" }, { index: 1, label: "Role", defaultText: "Text" }] },
  ];
  const premiereTools = getStockTitleTools(bridgeOptions, () => premiereCatalog);

  it("bakes only the named field, leaves the other layer at its default, and reports it untouched", async () => {
    vi.stubEnv("PREMIERE_MCP_TITLE_DIR", join(workspace, "baked-fields"));
    try {
      const state = hostWith({ noMgt: true });
      const result = await premiereTools.add_title.handler({ fields: { Name: "Ada" }, template: "Distinct" }) as TitleResult;
      expect(result.success).toBe(true);
      expect(readPremiereTitleText(String(state.imported?.[0]))).toEqual(["Role Here", "Ada"]);
      expect(result.data.outcome).toBe("template_verified");
      expect(result.data.untouchedFields).toEqual([{ index: 0, label: "Role", defaultText: "Role Here" }]);
      expect(result.data.warnings).toEqual([expect.stringMatching(/not written.*Role Here/)]);
      expect(result.data.fieldMapping).toEqual([{ name: "Name", index: 1, label: "Name" }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a named field whose layer cannot be told apart by default text, before touching Premiere", async () => {
    const result = await premiereTools.add_title.handler({ fields: { Role: "Director" }, template: "Twins" }) as TitleResult;
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Could not prepare Twins.*ambiguous.*No change was made/) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("import_mogrt duration", () => {
  const text = getTextTools(bridgeOptions);

  it("applies duration_seconds after import instead of ignoring it", async () => {
    hostWith({ defaultSeconds: 10 });
    const result = await text.import_mogrt.handler({ mogrt_path: "/t.mogrt", start_seconds: 1, duration_seconds: 4 }) as TitleResult;
    expect(result.data.duration).toMatchObject({ status: "verified", actualSeconds: 4 });
    expect(result.data.warnings).toBeUndefined();
  });

  it("warns when the duration cannot be applied", async () => {
    hostWith({ ignoreEndWrite: true });
    const result = await text.import_mogrt.handler({ mogrt_path: "/t.mogrt" }) as TitleResult;
    expect(result.data.warnings[0]).toMatch(/duration was not verified \(mismatch\)/);
  });

  it("rejects an invalid duration without contacting Premiere", async () => {
    const result = await text.import_mogrt.handler({ mogrt_path: "/t.mogrt", duration_seconds: -1 }) as TitleResult;
    expect(result.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("add_title with a Premiere-built template", () => {
  function blob(text: string): string {
    const body = Buffer.from(JSON.stringify({ mTextParam: { mStyleSheet: { mText: text } }, mVersion: 1 }), "utf16le");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]).toString("base64");
  }
  const templatePath = join(workspace, "Native Title.mogrt");
  writeFileSync(templatePath, writeZip([
    { name: "definition.json", data: Buffer.from(JSON.stringify({ capsuleID: "c", clientControls: [{ type: 6, uiName: loc("TextLayer"), value: loc("Your Title Here") }] })) },
    { name: "project.prgraphic", data: writeZip([{ name: "p.prproj", data: gzipSync(Buffer.from(`<X><StartKeyframeValue Encoding="base64">${blob("Your Title Here")}</StartKeyframeValue></X>`)) }]) },
  ]));
  const nativeCatalog: StockTitleTemplate[] = [
    { name: "Native Title", category: "", path: templatePath, kind: "premiere", textFields: [{ index: 0, label: "TextLayer", defaultText: "Your Title Here" }] },
  ];
  const nativeTools = getStockTitleTools(bridgeOptions, () => nativeCatalog);

  it("bakes the text into a template copy, imports that copy, and reports template_verified", async () => {
    vi.stubEnv("PREMIERE_MCP_TITLE_DIR", join(workspace, "baked-titles"));
    try {
      const state = hostWith({ noMgt: true });
      const result = await nativeTools.add_title.handler({ text: "Hello Premiere", template: "Native Title", duration_seconds: 3 }) as TitleResult;
      expect(result.success).toBe(true);
      const importedPath = String(state.imported?.[0]);
      expect(importedPath.startsWith(join(workspace, "baked-titles"))).toBe(true);
      expect(readPremiereTitleText(importedPath)).toEqual(["Hello Premiere"]);
      expect(result.data).toMatchObject({
        outcome: "template_verified",
        textVerification: "template_verified",
        templateFile: importedPath,
        duration: { status: "verified", actualSeconds: 3 },
      });
      expect(result.data.textChecks[0]).toMatchObject({ expected: "Hello Premiere", actual: "Hello Premiere", status: "template_verified" });
      expect(result.data.warnings).toBeUndefined();
      expect(mockedSendCommand.mock.calls[0][0]).not.toContain("__mogrtWriteTextAt(textProps");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails before touching Premiere when the template cannot be prepared", async () => {
    const broken: StockTitleTemplate[] = [{ ...nativeCatalog[0], path: join(workspace, "missing.mogrt") }];
    const result = await getStockTitleTools(bridgeOptions, () => broken).add_title.handler({ text: "x", template: "Native Title" }) as TitleResult;
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Could not prepare Native Title.*No change was made/) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
