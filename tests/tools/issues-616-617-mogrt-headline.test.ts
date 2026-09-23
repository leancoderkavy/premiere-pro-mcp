import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTextTools } from "../../src/tools/text.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { extractMogrtText, validateMogrtTextMap } from "../../src/tools/mogrt-text.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/issue-616", timeoutMs: 5000 };
const text = getTextTools(bridgeOptions);
const advanced = getAdvancedTools(bridgeOptions);

const textJson = (value: string) => JSON.stringify({ textEditValue: value, fontSize: 72, fontName: "Font" });

type FakeProp = { displayName: string; value: unknown; getValue: () => unknown; setValue: (v: unknown, u?: boolean) => void };

function makeMgt(props: Record<string, unknown>, opts: { ignoreSet?: string; throwRead?: string } = {}) {
  const list: FakeProp[] = Object.entries(props).map(([displayName, value]) => ({
    displayName,
    value,
    getValue() {
      if (opts.throwRead === displayName && this.value !== value) throw new Error("unreadable");
      return this.value;
    },
    setValue(v: unknown) {
      if (opts.ignoreSet === displayName) return;
      this.value = v;
    },
  }));
  const properties: Record<string | number, unknown> = { numItems: list.length };
  list.forEach((p, i) => { properties[i] = p; });
  return { properties, list };
}

function runHost(script: string, context: Record<string, unknown>) {
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context)));
}

function hostWith(context: Record<string, unknown>) {
  mockedSendCommand.mockImplementation(async (script: string) => runHost(script, context));
}

beforeEach(() => vi.clearAllMocks());

describe("issue #617 — import_mogrt writes text explicitly and verifies by readback", () => {
  it("overwrites a stale template Headline and reports verified", async () => {
    const mgt = makeMgt({ Headline: textJson("Placeholder"), Subtitle: textJson("old") });
    hostWith({ app: { project: { activeSequence: { importMGT: () => ({ getMGTComponent: () => mgt }) } } } });
    const result = await text.import_mogrt.handler({
      mogrt_path: "C:/cards/title.mogrt",
      text_values: { Headline: 'Chapter "3": Q&A \\ done' },
    }) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data.textVerification).toBe("verified");
    expect(result.data.textChecks).toEqual([
      { displayName: "Headline", expected: 'Chapter "3": Q&A \\ done', actual: 'Chapter "3": Q&A \\ done', status: "verified" },
    ]);
    const stored = JSON.parse(String(mgt.list[0].value));
    expect(stored).toEqual({ textEditValue: 'Chapter "3": Q&A \\ done', fontSize: 72, fontName: "Font" });
    expect(mgt.list[1].value).toBe(textJson("old"));
    expect(result.data).not.toHaveProperty("textReadback");
  });

  it("reports mismatch when the host keeps the stale value", async () => {
    const mgt = makeMgt({ Headline: textJson("Placeholder") }, { ignoreSet: "Headline" });
    hostWith({ app: { project: { activeSequence: { importMGT: () => ({ getMGTComponent: () => mgt }) } } } });
    const result = await text.import_mogrt.handler({ mogrt_path: "a.mogrt", text_values: { Headline: "Real" } }) as { data: Record<string, unknown> };
    expect(result.data.textVerification).toBe("mismatch");
    expect(result.data.textChecks).toEqual([{ displayName: "Headline", expected: "Real", actual: "Placeholder", status: "mismatch" }]);
    expect(result.data.warnings).toBeDefined();
  });

  it("reports missing_property and committed_unverified outcomes", async () => {
    const mgt = makeMgt({ Headline: "plain" }, { throwRead: "Headline" });
    hostWith({ app: { project: { activeSequence: { importMGT: () => ({ getMGTComponent: () => mgt }) } } } });
    const unverified = await text.import_mogrt.handler({ mogrt_path: "a.mogrt", text_values: { Headline: "New" } }) as { data: Record<string, unknown> };
    expect(mgt.list[0].value).toBe("New");
    expect(unverified.data.textVerification).toBe("committed_unverified");

    const missing = await text.import_mogrt.handler({ mogrt_path: "a.mogrt", text_values: { Title: "x" } }) as { data: Record<string, unknown> };
    expect(missing.data.textVerification).toBe("missing_property");
  });

  it("reports committed_unverified when the imported clip has no MGT component", async () => {
    hostWith({ app: { project: { activeSequence: { importMGT: () => ({ getMGTComponent: () => null }) } } } });
    const result = await text.import_mogrt.handler({ mogrt_path: "a.mogrt", text_values: { Headline: "x" } }) as { data: Record<string, unknown> };
    expect(result.data.textVerification).toBe("committed_unverified");
    expect(result.data.warnings).toEqual([expect.stringMatching(/no MGT component/)]);
  });

  it("keeps the legacy import path unchanged without text_values", async () => {
    hostWith({ app: { project: { activeSequence: { importMGT: () => ({}) } } } });
    const result = await text.import_mogrt.handler({ mogrt_path: "a.mogrt" }) as { success: boolean; data: Record<string, unknown> };
    expect(result.success).toBe(true);
    expect(result.data.textReadback).toBeNull();
    expect(mockedSendCommand.mock.calls[0][0]).not.toContain("__mogrtWriteText");
  });

  it("escapes names and text before embedding them in ExtendScript", async () => {
    mockedSendCommand.mockResolvedValue({ success: false, error: "no host" });
    await text.import_mogrt.handler({ mogrt_path: "a.mogrt", text_values: { 'He"ad': 'x"); evil(); ("' } });
    const script = mockedSendCommand.mock.calls[0][0] as string;
    expect(script).not.toContain('x"); evil();');
  });

  it("validates text_values", async () => {
    await expect(text.import_mogrt.handler({ mogrt_path: "a", text_values: [] as never })).rejects.toThrow(/must be an object/);
    expect(validateMogrtTextMap({}, "x")).toBeUndefined();
    await expect(text.import_mogrt.handler({ mogrt_path: "a", text_values: { H: 1 as never } })).rejects.toThrow(/must be a string/);
    await expect(text.import_mogrt.handler({ mogrt_path: "a", text_values: { " ": "x" } })).rejects.toThrow(/non-empty/);
    await expect(text.import_mogrt.handler({ mogrt_path: "a", text_values: { H: "x".repeat(2001) } })).rejects.toThrow(/exceeds/);
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, "x"]));
    await expect(text.import_mogrt.handler({ mogrt_path: "a", text_values: many })).rejects.toThrow(/at most/);
    expect(validateMogrtTextMap(undefined, "x")).toBeUndefined();
  });
});

describe("issues #616/#617 — get_mogrt_component audits stored Headline text", () => {
  async function audit(mgt: ReturnType<typeof makeMgt>, expected?: Record<string, string>) {
    mockedSendCommand.mockResolvedValue({
      success: true,
      data: { clipName: "Card", parameters: mgt.list.map((p) => ({ displayName: p.displayName, value: p.value })) },
    });
    return advanced.get_mogrt_component.handler({ node_id: "n1", ...(expected ? { expected_values: expected } : {}) }) as Promise<{ success: boolean; data: Record<string, unknown> }>;
  }

  it("flags a clip whose Headline retained a stale value", async () => {
    const result = await audit(makeMgt({ Headline: textJson("Placeholder") }), { Headline: "Episode 4", Missing: "y" });
    expect(result.data.audit).toMatchObject({
      status: "mismatch",
      checks: [
        { displayName: "Headline", expected: "Episode 4", actual: "Placeholder", status: "mismatch" },
        { displayName: "Missing", status: "missing_property" },
      ],
    });
    expect((result.data.audit as { scope: string }).scope).toMatch(/Essential Graphics panel display is not read/);
  });

  it("verifies matching text and adds textValue to every parameter", async () => {
    const result = await audit(makeMgt({ Headline: textJson("Episode 4"), Size: 12 }), { Headline: "Episode 4" });
    expect((result.data.audit as { status: string }).status).toBe("verified");
    expect(result.data.parameters).toEqual([
      { displayName: "Headline", value: textJson("Episode 4"), textValue: "Episode 4" },
      { displayName: "Size", value: 12, textValue: "12" },
    ]);
  });

  it("omits audit without expected_values and passes failures through", async () => {
    const plain = await audit(makeMgt({ Headline: "x" }));
    expect(plain.data).not.toHaveProperty("audit");
    mockedSendCommand.mockResolvedValue({ success: false, error: "Clip not found" });
    expect(await advanced.get_mogrt_component.handler({ node_id: "n" })).toEqual({ success: false, error: "Clip not found" });
    mockedSendCommand.mockResolvedValue({ success: true, data: undefined });
    const empty = await advanced.get_mogrt_component.handler({ node_id: "n" }) as { data: Record<string, unknown> };
    expect(empty.data.parameters).toEqual([]);
  });

  it("documents the panel-display limitation honestly", () => {
    expect(advanced.get_mogrt_component.description).toMatch(/not the Essential Graphics panel display/);
  });
});

describe("extractMogrtText", () => {
  it("handles JSON strings, objects, plain strings, and invalid JSON", () => {
    expect(extractMogrtText(textJson("a"))).toBe("a");
    expect(extractMogrtText({ textEditValue: "b" })).toBe("b");
    expect(extractMogrtText({ other: 1 })).toBeNull();
    expect(extractMogrtText("{not json")).toBe("{not json");
    expect(extractMogrtText("plain")).toBe("plain");
    expect(extractMogrtText(null)).toBeNull();
    expect(extractMogrtText(true)).toBe("true");
  });
});
